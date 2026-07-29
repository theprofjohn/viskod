import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ErrorCategory,
  ErrorSeverity,
  type Result,
  type ViskodError,
  err,
  ok,
} from '@viskod/shared';

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
  captureDir: string;
  packetFilePath?: string;
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

const STORAGE_DIR = '.viskod';
const CAPTURES_DIR = 'captures';
const STORAGE_THRESHOLD_BYTES = 50 * 1024 * 1024;

export class CapturePipeline {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? path.join(process.cwd(), STORAGE_DIR, CAPTURES_DIR);
  }

  async persistCapture(
    packet: { packetId: string; packetJson?: string },
    screenshots: Screenshot[],
    pageUrl: string,
    viewport: { width: number; height: number },
  ): Promise<Result<StoredCapture>> {
    const captureId = crypto.randomUUID();

    if (!this.validateCaptureId(captureId)) {
      return err(this.cpError('CP_INVALID_CAPTURE_ID', `Invalid capture ID: ${captureId}`));
    }

    const availableSpace = this.getAvailableSpace();
    if (availableSpace < STORAGE_THRESHOLD_BYTES) {
      return err(
        this.cpError(
          'CP_STORAGE_FULL',
          `Storage full: ${availableSpace} bytes available, minimum ${STORAGE_THRESHOLD_BYTES} bytes required`,
        ),
      );
    }

    const captureDir = path.join(this.baseDir, captureId);

    try {
      fs.mkdirSync(captureDir, { recursive: true });

      const screenshotMetas: CaptureMetadata['screenshots'] = [];
      let totalSizeBytes = 0;

      for (const shot of screenshots) {
        const fileName = `${shot.type}.${shot.format}`;
        const filePath = path.join(captureDir, fileName);

        try {
          fs.writeFileSync(filePath, shot.buffer);
          totalSizeBytes += shot.buffer.length;

          screenshotMetas.push({
            type: shot.type,
            path: fileName,
            format: shot.format,
            width: shot.width,
            height: shot.height,
            sizeBytes: shot.buffer.length,
          });
        } catch (writeError) {
          this.cleanup(captureDir);
          return err(
            this.cpError('CP_WRITE_FAILED', `Write failed for ${fileName}: ${String(writeError)}`),
          );
        }
      }

      const now = new Date().toISOString();

      const metadata: CaptureMetadata = {
        captureId,
        packetId: packet.packetId,
        schemaVersion: '1.0.0',
        createdAt: now,
        screenshots: screenshotMetas,
        page: { url: pageUrl, viewport },
        tags: [],
      };

      const metadataPath = path.join(captureDir, 'metadata.json');
      const tempPath = `${metadataPath}.tmp`;

      try {
        fs.writeFileSync(tempPath, JSON.stringify(metadata, null, 2), 'utf-8');
        fs.renameSync(tempPath, metadataPath);
        // Safety: remove any leftover .tmp (shouldn't exist after successful rename)
        try {
          if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
        } catch {
          // best-effort
        }
      } catch (writeError) {
        this.cleanup(captureDir);
        return err(
          this.cpError('CP_WRITE_FAILED', `Failed to write metadata: ${String(writeError)}`),
        );
      }

      // Persist full packet JSON when provided
      let packetFilePath: string | undefined;
      if (packet.packetJson) {
        packetFilePath = path.join(captureDir, 'packet.json');
        try {
          fs.writeFileSync(packetFilePath, packet.packetJson, 'utf-8');
        } catch (writeError) {
          this.cleanup(captureDir);
          return err(
            this.cpError('CP_WRITE_FAILED', `Failed to write packet.json: ${String(writeError)}`),
          );
        }
      }

      const stored: StoredCapture = {
        captureId,
        packetId: packet.packetId,
        timestamp: now,
        screenshotCount: screenshots.length,
        totalSizeBytes,
        page: { url: pageUrl, viewport },
        captureDir,
        packetFilePath,
      };

      return ok(stored);
    } catch (error) {
      this.cleanup(captureDir);
      return err(this.cpError('CP_WRITE_FAILED', `Persist failed: ${String(error)}`));
    }
  }

  async getCapture(captureId: string): Promise<Result<StoredCapture>> {
    if (!this.validateCaptureId(captureId)) {
      return err(this.cpError('CP_INVALID_CAPTURE_ID', `Invalid capture ID: ${captureId}`));
    }

    const captureDir = path.join(this.baseDir, captureId);
    const metadataPath = path.join(captureDir, 'metadata.json');

    if (!fs.existsSync(captureDir)) {
      return err(this.cpError('CP_CAPTURE_NOT_FOUND', `Capture '${captureId}' not found`));
    }

    try {
      const raw = fs.readFileSync(metadataPath, 'utf-8');
      const meta: CaptureMetadata = JSON.parse(raw);

      const totalSize = meta.screenshots.reduce((acc, s) => acc + s.sizeBytes, 0);

      return ok({
        captureId: meta.captureId,
        packetId: meta.packetId,
        timestamp: meta.createdAt,
        screenshotCount: meta.screenshots.length,
        totalSizeBytes: totalSize,
        page: meta.page,
        captureDir,
      });
    } catch (parseError) {
      return err(
        this.cpError(
          'CP_METADATA_CORRUPT',
          `Metadata corrupt for capture '${captureId}' at '${metadataPath}': ${String(parseError)}`,
        ),
      );
    }
  }

  async listCaptures(filter: CaptureFilter = {}): Promise<Result<StoredCapture[]>> {
    try {
      if (!fs.existsSync(this.baseDir)) {
        return ok([]);
      }

      const entries = fs.readdirSync(this.baseDir, { withFileTypes: true });
      const captures: StoredCapture[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const metaResult = await this.getCapture(entry.name);
        if (metaResult.ok) {
          captures.push(metaResult.value);
        }
      }

      captures.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

      let results = captures;
      const { fromDate, toDate, pageUrl } = filter;
      if (fromDate) results = results.filter((c) => c.timestamp >= fromDate);
      if (toDate) results = results.filter((c) => c.timestamp <= toDate);
      if (pageUrl) results = results.filter((c) => c.page.url.includes(pageUrl));

      const offset = filter.offset ?? 0;
      const limit = filter.limit ?? 50;
      return ok(results.slice(offset, offset + limit));
    } catch {
      return ok([]);
    }
  }

  async deleteCapture(captureId: string): Promise<Result<void>> {
    if (!this.validateCaptureId(captureId)) {
      return err(this.cpError('CP_INVALID_CAPTURE_ID', `Invalid capture ID: ${captureId}`));
    }

    const captureDir = path.join(this.baseDir, captureId);
    if (!fs.existsSync(captureDir)) {
      return ok(undefined);
    }

    try {
      fs.rmSync(captureDir, { recursive: true, force: true });
      return ok(undefined);
    } catch (error) {
      return err(this.cpError('CP_DELETE_FAILED', `Failed to delete capture: ${String(error)}`));
    }
  }

  async getStorageStats(): Promise<Result<CaptureStorageStats>> {
    const totalSizeBytes = this.getDirSize(this.baseDir);
    const availableSpaceBytes = this.getAvailableSpace();

    try {
      if (!fs.existsSync(this.baseDir)) {
        return ok({
          totalCaptures: 0,
          totalSizeBytes: 0,
          availableSpaceBytes,
          oldestCaptureDate: new Date().toISOString(),
          newestCaptureDate: new Date().toISOString(),
        });
      }

      const entries = fs.readdirSync(this.baseDir, { withFileTypes: true });
      const captures = entries.filter((e) => e.isDirectory());
      const timestamps: string[] = [];

      for (const capture of captures) {
        const metaPath = path.join(this.baseDir, capture.name, 'metadata.json');
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as CaptureMetadata;
          timestamps.push(meta.createdAt);
        } catch {
          // skip corrupt captures
        }
      }

      const sorted = timestamps.sort();

      return ok({
        totalCaptures: captures.length,
        totalSizeBytes,
        availableSpaceBytes,
        oldestCaptureDate: sorted[0] ?? new Date().toISOString(),
        newestCaptureDate: sorted[sorted.length - 1] ?? new Date().toISOString(),
      });
    } catch {
      return ok({
        totalCaptures: 0,
        totalSizeBytes: 0,
        availableSpaceBytes,
        oldestCaptureDate: new Date().toISOString(),
        newestCaptureDate: new Date().toISOString(),
      });
    }
  }

  async runRetentionCleanup(retentionDays: number): Promise<Result<number>> {
    if (retentionDays < 0) {
      return err(
        this.cpError(
          'CP_RETENTION_INVALID',
          `Invalid retention period '${retentionDays}': must be non-negative integer`,
        ),
      );
    }

    if (!fs.existsSync(this.baseDir)) {
      return ok(0);
    }

    try {
      const entries = fs.readdirSync(this.baseDir, { withFileTypes: true });
      const captures = entries.filter((e) => e.isDirectory());

      const withDates: Array<{ id: string; createdAt: string }> = [];
      for (const capture of captures) {
        const metaPath = path.join(this.baseDir, capture.name, 'metadata.json');
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as CaptureMetadata;
          withDates.push({ id: meta.captureId, createdAt: meta.createdAt });
        } catch {
          // skip corrupt captures
        }
      }

      withDates.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      if (withDates.length === 0) return ok(0);

      const mostRecent = withDates[0];
      if (!mostRecent) return ok(0);
      const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();

      let deleted = 0;
      for (const capture of withDates) {
        if (capture.id === mostRecent.id) continue;
        if (capture.createdAt < cutoff) {
          const captureDir = path.join(this.baseDir, capture.id);
          try {
            fs.rmSync(captureDir, { recursive: true, force: true });
            deleted++;
          } catch {
            // skip if can't delete
          }
        }
      }

      return ok(deleted);
    } catch {
      return ok(0);
    }
  }

  private validateCaptureId(id: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
  }

  private getAvailableSpace(): number {
    try {
      const stats = fs.statfsSync ? fs.statfsSync(this.baseDir) : null;
      if (stats?.bfree && stats?.bsize) {
        return Number(stats.bfree) * Number(stats.bsize);
      }
      return Number.MAX_SAFE_INTEGER;
    } catch {
      return Number.MAX_SAFE_INTEGER;
    }
  }

  private getDirSize(dir: string): number {
    try {
      if (!fs.existsSync(dir)) return 0;
      let totalSize = 0;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          totalSize += this.getDirSize(fullPath);
        } else {
          try {
            totalSize += fs.statSync(fullPath).size;
          } catch {
            // skip
          }
        }
      }
      return totalSize;
    } catch {
      return 0;
    }
  }

  private cleanup(dir: string): void {
    try {
      if (fs.existsSync(dir)) {
        // Clean up any stray .tmp files before recursive removal
        try {
          const entries = fs.readdirSync(dir);
          for (const entry of entries) {
            if (entry.endsWith('.tmp')) {
              fs.rmSync(path.join(dir, entry), { force: true });
            }
          }
        } catch {
          // best-effort stray cleanup
        }
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      // best-effort cleanup
    }
  }

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
