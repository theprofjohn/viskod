import { ok, err, ErrorCategory, ErrorSeverity } from '@viskod/shared';
import type { Result, ViskodError } from '@viskod/shared';
import { VISKOD_STORAGE_DIR, CAPTURE_DIR } from '@viskod/shared';

export interface Screenshot {
  captureId: string;
  type: 'viewport' | 'selection' | 'full-page';
  buffer: Buffer;
  format: 'png' | 'jpeg';
  width: number;
  height: number;
}
export interface StoredCapture {
  captureId: string;
  packetId: string;
  timestamp: string;
  screenshotCount: number;
  totalSizeBytes: number;
  retentionDays?: number;
  tags?: string[];
  page: { url: string; viewport: { width: number; height: number } };
}
export interface CaptureFilter {
  fromDate?: string;
  toDate?: string;
  pageUrl?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}
export interface CaptureStorageStats {
  totalCaptures: number;
  totalSizeBytes: number;
  availableSpaceBytes: number;
  oldestCaptureDate: string;
  newestCaptureDate: string;
}

interface CaptureMetadata {
  captureId: string;
  packetId: string;
  schemaVersion: string;
  createdAt: string;
  screenshots: {
    type: string;
    path: string;
    format: string;
    width: number;
    height: number;
    sizeBytes: number;
  }[];
  page: { url: string; viewport: { width: number; height: number } };
  tags: string[];
}

export class CapturePipeline {
  private captures = new Map<string, CaptureMetadata>();
  private baseDir = `${VISKOD_STORAGE_DIR}/${CAPTURE_DIR}`;

  async persistCapture(
    packet: { packetId: string },
    screenshots: Screenshot[],
    pageUrl: string,
    viewport: { width: number; height: number },
  ): Promise<Result<StoredCapture>> {
    const captureId = crypto.randomUUID();
    const now = new Date().toISOString();
    const screenshotMetas = screenshots.map((s) => ({
      type: s.type,
      path: `${captureId}/${s.type}.${s.format}`,
      format: s.format,
      width: s.width,
      height: s.height,
      sizeBytes: s.buffer.length,
    }));

    const totalSize = screenshots.reduce((acc, s) => acc + s.buffer.length, 0);

    const metadata: CaptureMetadata = {
      captureId,
      packetId: packet.packetId,
      schemaVersion: '1.0.0',
      createdAt: now,
      screenshots: screenshotMetas,
      page: { url: pageUrl, viewport },
      tags: [],
    };

    this.captures.set(captureId, metadata);

    const stored: StoredCapture = {
      captureId,
      packetId: packet.packetId,
      timestamp: now,
      screenshotCount: screenshots.length,
      totalSizeBytes: totalSize,
      page: { url: pageUrl, viewport },
    };

    return ok(stored);
  }

  async getCapture(captureId: string): Promise<Result<StoredCapture>> {
    const meta = this.captures.get(captureId);
    if (!meta) return err(this.cpError('CP_CAPTURE_NOT_FOUND', `Capture not found: ${captureId}`));
    const totalSize = meta.screenshots.reduce((acc, s) => acc + s.sizeBytes, 0);
    return ok({
      captureId: meta.captureId,
      packetId: meta.packetId,
      timestamp: meta.createdAt,
      screenshotCount: meta.screenshots.length,
      totalSizeBytes: totalSize,
      page: meta.page,
    });
  }

  async listCaptures(filter: CaptureFilter = {}): Promise<Result<StoredCapture[]>> {
    let results = Array.from(this.captures.values()).map((m) => ({
      captureId: m.captureId,
      packetId: m.packetId,
      timestamp: m.createdAt,
      screenshotCount: m.screenshots.length,
      totalSizeBytes: m.screenshots.reduce((acc, s) => acc + s.sizeBytes, 0),
      page: m.page,
    }));

    if (filter.fromDate) results = results.filter((c) => c.timestamp >= filter.fromDate!);
    if (filter.toDate) results = results.filter((c) => c.timestamp <= filter.toDate!);
    if (filter.pageUrl) results = results.filter((c) => c.page.url.includes(filter.pageUrl!));

    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 50;
    return ok(results.slice(offset, offset + limit));
  }

  async deleteCapture(captureId: string): Promise<Result<void>> {
    if (!this.captures.has(captureId)) return ok(undefined);
    this.captures.delete(captureId);
    return ok(undefined);
  }

  async getStorageStats(): Promise<Result<CaptureStorageStats>> {
    const entries = Array.from(this.captures.values());
    const dates = entries.map((e) => e.createdAt).sort();
    return ok({
      totalCaptures: entries.length,
      totalSizeBytes: entries.reduce(
        (acc, e) => acc + e.screenshots.reduce((a, s) => a + s.sizeBytes, 0),
        0,
      ),
      availableSpaceBytes: Number.MAX_SAFE_INTEGER,
      oldestCaptureDate: dates[0] ?? new Date().toISOString(),
      newestCaptureDate: dates[dates.length - 1] ?? new Date().toISOString(),
    });
  }

  async runRetentionCleanup(retentionDays: number): Promise<Result<number>> {
    const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
    let deleted = 0;
    for (const [id, meta] of this.captures) {
      if (meta.createdAt < cutoff) {
        this.captures.delete(id);
        deleted++;
      }
    }
    return ok(deleted);
  }

  // NEVER analyses data, NEVER accesses browser
  private cpError(code: string, message: string): ViskodError {
    return {
      code,
      category: ErrorCategory.STORAGE,
      severity: ErrorSeverity.RECOVERABLE,
      message,
      correlationId: crypto.randomUUID(),
      subsystem: 'capture-pipeline',
      timestamp: new Date().toISOString(),
    };
  }
}
