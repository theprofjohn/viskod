import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ErrorCategory,
  ErrorSeverity,
  type Result,
  type ViskodError,
  err,
  isSafeRelativeSourcePath,
  ok,
} from '@viskod/shared';
import { z } from 'zod';

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
  captureStatus: 'complete' | 'partial';
  screenshotCount: number;
  totalSizeBytes: number;
  retentionDays?: number;
  tags?: string[];
  page: { url: string; viewport: { width: number; height: number } };
  /** Internal persistence location — never exposed to agents. */
  captureDir: string;
  packetFilePath?: string;
  packetPresent: boolean;
}

export interface PersistCaptureInput {
  /** Durable opaque capture id; must match the packet's `captureId`. */
  captureId: string;
  /**
   * FINAL, already-redacted, normalized packet JSON. The persisted
   * representation is validated against `PersistedPacketSchema` BEFORE any
   * disk write; nothing is serialized-then-mutated afterwards.
   */
  packetJson: string;
  /** Raw screenshot buffers to persist (explicit opt-in only). */
  screenshots?: Screenshot[];
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

export type PersistFailureStage =
  | 'before-metadata'
  | 'after-artifact'
  | 'before-packet'
  | 'during-packet'
  | 'before-commit';

/** Deterministic failure injection for atomic-persistence tests. */
export interface PersistenceTestHooks {
  failOn?: PersistFailureStage;
}

const EvidenceStatusSchema = z.object({
  state: z.enum([
    'collected',
    'disabled',
    'unavailable',
    'failed',
    'redacted',
    'omitted_sensitive',
  ]),
  diagnostic: z.object({ provider: z.string(), code: z.string(), reason: z.string() }).optional(),
});

/**
 * Phase 30A — durable source-hint candidate. The persisted capture must not
 * carry arbitrary/opaque source data: every semantic field is explicitly
 * validated so a corrupt or tampered capture fails safely at load.
 *
 * - `filePath`/`displayPath`: repository-relative only (absolute, drive-letter,
 *   URI, and traversal paths are rejected by `isSafeRelativeSourcePath`).
 * - `confidence`: finite and within 0..1 (the calibrated evidence score).
 * - `qualification`: recognized Phase 30 semantic qualification.
 * - `reasons`: bounded string array.
 * - `matchType`/`exists`: bounded/enum-shaped when retained.
 *
 * `.passthrough()` tolerates additive legacy metadata (location/symbol/route/
 * ranking/safety) without revalidating it as semantic source evidence.
 */
const PersistedSourceHintSchema = z
  .object({
    filePath: z.string().min(1).refine(isSafeRelativeSourcePath, 'unsafe source path'),
    displayPath: z
      .string()
      .min(1)
      .refine(isSafeRelativeSourcePath, 'unsafe source path')
      .optional(),
    confidence: z.number().finite().min(0).max(1),
    qualification: z.enum(['exact', 'probable', 'possible', 'weak']),
    reasons: z.array(z.string().max(500)).max(10).optional(),
    matchType: z.string().min(1).max(64).optional(),
    exists: z.boolean().optional(),
    isPrimary: z.boolean().optional(),
    kind: z.string().max(64).optional(),
    status: z.string().max(64).optional(),
    evidence: z.string().max(2000).optional(),
    reason: z.string().max(2000).optional(),
    relatedSelector: z.string().max(500).optional(),
    location: z
      .object({
        line: z.number().int().nonnegative().optional(),
        column: z.number().int().nonnegative().optional(),
      })
      .optional(),
    symbol: z
      .object({
        componentName: z.string().max(200).optional(),
        jsxTag: z.string().max(100).optional(),
      })
      .optional(),
    route: z
      .object({
        routePath: z.string().max(500).optional(),
        routeFile: z.string().max(500).optional(),
        isCurrentRoute: z.boolean().optional(),
      })
      .optional(),
    ranking: z
      .object({
        score: z.number().finite(),
        confidence: z.number().finite().min(0).max(1),
        rank: z.number().int().nonnegative(),
        reasons: z.array(z.string().max(500)).max(10),
        penalties: z.array(z.string().max(500)).max(10),
      })
      .optional(),
    safety: z
      .object({
        redactionApplied: z.boolean(),
        userVisible: z.boolean(),
        containsAbsolutePath: z.boolean(),
      })
      .optional(),
  })
  .passthrough();

/**
 * Phase 30A — durable capture-time source-resolution snapshot. Records what
 * Viskod concluded at capture time: the resolution state and the source-hint
 * model/schema version that produced it. A fresh process MUST report this
 * persisted conclusion instead of recomputing resolution under newer rules.
 *
 * `modelVersion` is validated as a semver-shaped string; any future version
 * is accepted because a persisted snapshot is interpretable using its own
 * result regardless of the current model.
 */
const PersistedSourceResolutionSchema = z.object({
  status: z.enum(['resolved', 'ambiguous', 'unavailable']),
  modelVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  topCandidate: z.string().min(1).refine(isSafeRelativeSourcePath, 'unsafe source path').optional(),
});

/**
 * Schema of the PERSISTED safe capture representation (Phase 29).
 * A persisted record must make its schema/privacy version unambiguous and
 * must never be silently interpreted as a new privacy-safe packet when it
 * was written by an older, unredacted pipeline.
 */
export const PersistedPacketSchema = z.object({
  packetId: z.string().min(1),
  schemaVersion: z.string().min(1),
  timestamp: z.string().min(1),
  captureId: z.string().min(1),
  captureStatus: z.enum(['complete', 'partial']),
  evidence: z.object({
    dom: EvidenceStatusSchema,
    hierarchy: EvidenceStatusSchema,
    styles: EvidenceStatusSchema,
    screenshot: EvidenceStatusSchema,
    runtime: EvidenceStatusSchema,
    sourceHints: EvidenceStatusSchema,
  }),
  browser: z.object({
    url: z.string(),
    viewport: z.object({
      width: z.number(),
      height: z.number(),
      deviceScaleFactor: z.number(),
    }),
    userAgent: z.string(),
  }),
  selection: z.object({
    selector: z.string(),
    tagName: z.string(),
    boundingBox: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    }),
    text: z.string().optional(),
  }),
  dom: z
    .object({
      tagName: z.string(),
      attributes: z.record(z.string(), z.string()),
      childCount: z.number(),
      depth: z.number(),
    })
    .passthrough(),
  styles: z
    .object({
      computed: z.record(z.string(), z.string()),
      layout: z.unknown().nullable(),
    })
    .passthrough(),
  hierarchy: z
    .object({
      selectedNode: z.object({ tagName: z.string(), depth: z.number() }).passthrough(),
      parents: z.array(
        z
          .object({ tagName: z.string(), depth: z.number(), text: z.string().optional() })
          .passthrough(),
      ),
      siblings: z.array(
        z
          .object({ tagName: z.string(), depth: z.number(), text: z.string().optional() })
          .passthrough(),
      ),
      children: z.array(
        z
          .object({ tagName: z.string(), depth: z.number(), text: z.string().optional() })
          .passthrough(),
      ),
    })
    .passthrough(),
  screenshots: z.array(
    z
      .object({
        captureId: z.string(),
        type: z.string(),
        path: z.string().nullable(),
        width: z.number(),
        height: z.number(),
        format: z.string(),
        sizeBytes: z.number(),
        status: z.enum(['collected', 'omitted_sensitive']).optional(),
        sensitive: z.boolean().optional(),
      })
      .passthrough(),
  ),
  confidence: z
    .object({
      sourceMapping: z.number().nullable(),
      semanticLabeling: z.number().nullable(),
      layoutAnalysis: z.number().nullable(),
      frameworkDetection: z.number().nullable(),
    })
    .passthrough(),
  metadata: z
    .object({
      engineVersion: z.string(),
      processingTimeMs: z.number(),
      evidenceSources: z.array(z.string()),
      redactions: z.array(z.string()),
      capturePolicy: z
        .object({
          screenshot: z.enum(['omitted_sensitive', 'raw_sensitive']),
        })
        .optional(),
    })
    .passthrough(),
  diagnostics: z.array(z.unknown()).default([]),
  sourceHints: z.array(PersistedSourceHintSchema).default([]),
  sourceHintsResolution: PersistedSourceResolutionSchema.optional(),
  runtimeEvidence: z
    .object({
      console: z
        .array(
          z
            .object({
              level: z.string(),
              message: z.string(),
              timestamp: z.string(),
              source: z.string().optional(),
              stack: z.string().optional(),
            })
            .passthrough(),
        )
        .optional(),
      network: z
        .array(
          z
            .object({
              request: z
                .object({
                  method: z.string(),
                  url: z.string(),
                  headers: z.record(z.string(), z.string()).optional(),
                })
                .passthrough(),
              response: z
                .object({
                  status: z.number(),
                  statusText: z.string(),
                  headers: z.record(z.string(), z.string()).optional(),
                })
                .passthrough()
                .optional(),
              durationMs: z.number().optional(),
              sizeBytes: z.number().optional(),
              timestamp: z.string(),
            })
            .passthrough(),
        )
        .optional(),
      selectedElement: z
        .object({
          selector: z.string(),
          tagName: z.string(),
          text: z.string().optional(),
          attributes: z.record(z.string(), z.string()).optional(),
          boundingBox: z
            .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
            .optional(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough()
    .optional(),
});

export type PersistedPacket = z.infer<typeof PersistedPacketSchema>;

interface CaptureMetadata {
  captureId: string;
  packetId: string;
  schemaVersion: string;
  captureStatus: 'complete' | 'partial';
  createdAt: string;
  screenshots: Array<{
    type: string;
    path: string;
    format: string;
    width: number;
    height: number;
    sizeBytes: number;
    status?: 'collected' | 'omitted_sensitive';
    sensitive?: boolean;
  }>;
  page: { url: string; viewport: { width: number; height: number } };
  tags: string[];
}

const STORAGE_DIR = '.viskod';
const CAPTURES_DIR = 'captures';
const STORAGE_THRESHOLD_BYTES = 50 * 1024 * 1024;

export class CapturePipeline {
  private baseDir: string;
  private hooks: PersistenceTestHooks;

  constructor(baseDir?: string, hooks: PersistenceTestHooks = {}) {
    this.baseDir = baseDir ?? path.join(process.cwd(), STORAGE_DIR, CAPTURES_DIR);
    this.hooks = hooks;
    // Eagerly create storage dir so first capture always has a writable target
    try {
      fs.mkdirSync(this.baseDir, { recursive: true });
    } catch {
      /* best effort */
    }
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  /**
   * Atomic capture persistence (VISKOD-AUDIT-011 / Phase 29).
   *
   * All artifacts are written to a sibling temporary directory that is never
   * listable (its name is not a valid capture id). The FINAL normalized
   * packet is validated before any write, then the whole directory is
   * atomically renamed to the opaque final capture directory. A committed
   * capture is therefore always complete and schema-valid; a failed capture
   * never becomes listable.
   */
  async persistCapture(input: PersistCaptureInput): Promise<Result<StoredCapture>> {
    const { captureId, packetJson, screenshots = [] } = input;

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

    // Validate the persisted representation BEFORE any disk write.
    let envelope: PersistedPacket;
    try {
      const parsed: unknown = JSON.parse(packetJson);
      const validated = PersistedPacketSchema.safeParse(parsed);
      if (!validated.success) {
        return err(
          this.cpError(
            'CP_PACKET_INVALID',
            `Packet failed persisted-schema validation: ${validated.error.issues[0]?.message ?? 'invalid'}`,
          ),
        );
      }
      envelope = validated.data;
    } catch (parseError) {
      return err(
        this.cpError(
          'CP_PACKET_INVALID',
          `Packet is not valid JSON: ${parseError instanceof SyntaxError ? 'syntax error' : 'invalid'}`,
        ),
      );
    }

    if (envelope.captureId !== captureId) {
      return err(
        this.cpError(
          'CP_PACKET_MISMATCH',
          'Packet captureId does not match the persistence capture',
        ),
      );
    }

    const tempDir = path.join(
      this.baseDir,
      `${captureId}.tmp-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    );
    const finalDir = path.join(this.baseDir, captureId);

    try {
      fs.mkdirSync(tempDir, { recursive: true });
      this.throwIfHook('before-metadata');

      const screenshotMetas: CaptureMetadata['screenshots'] = [];
      let totalSizeBytes = 0;

      for (const shot of screenshots) {
        const fileName = `${shot.type}.${shot.format}`;
        fs.writeFileSync(path.join(tempDir, fileName), shot.buffer);
        totalSizeBytes += shot.buffer.length;
        screenshotMetas.push({
          type: shot.type,
          path: fileName,
          format: shot.format,
          width: shot.width,
          height: shot.height,
          sizeBytes: shot.buffer.length,
          status: 'collected',
          sensitive: true,
        });
        this.throwIfHook('after-artifact');
      }
      this.throwIfHook('before-metadata');

      const metadata: CaptureMetadata = {
        captureId,
        packetId: envelope.packetId,
        schemaVersion: envelope.schemaVersion,
        captureStatus: envelope.captureStatus,
        createdAt: new Date().toISOString(),
        screenshots: screenshotMetas,
        page: {
          url: envelope.browser.url,
          viewport: {
            width: envelope.browser.viewport.width,
            height: envelope.browser.viewport.height,
          },
        },
        tags: [],
      };

      this.writeAtomic(path.join(tempDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
      this.throwIfHook('before-packet');

      // Packet written with FINAL durable references — serialized once,
      // never mutated in memory afterwards.
      const packetPath = path.join(tempDir, 'packet.json');
      const packetTmp = `${packetPath}.tmp`;
      fs.writeFileSync(packetTmp, packetJson, 'utf-8');
      this.throwIfHook('during-packet');
      this.bestEffortFlush(packetTmp);
      fs.renameSync(packetTmp, packetPath);

      this.throwIfHook('before-commit');

      // Directory-atomic commit: a reader either sees nothing (temp name
      // never listable) or the complete capture under its final opaque id.
      fs.renameSync(tempDir, finalDir);

      return ok({
        captureId,
        packetId: envelope.packetId,
        timestamp: metadata.createdAt,
        captureStatus: envelope.captureStatus,
        screenshotCount: screenshotMetas.length,
        totalSizeBytes,
        page: metadata.page,
        captureDir: finalDir,
        packetFilePath: path.join(finalDir, 'packet.json'),
        packetPresent: true,
      });
    } catch (error) {
      this.cleanup(tempDir);
      return err(
        this.cpError(
          'CP_PERSIST_FAILED',
          `Capture persistence failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
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
      const meta = JSON.parse(raw) as CaptureMetadata;

      if (meta.captureId !== captureId) {
        return err(
          this.cpError(
            'CP_METADATA_CORRUPT',
            `Metadata references a different capture '${captureId}'`,
          ),
        );
      }

      const totalSize = meta.screenshots.reduce((acc, s) => acc + s.sizeBytes, 0);
      const packetPath = path.join(captureDir, 'packet.json');
      const packetPresent = fs.existsSync(packetPath);

      return ok({
        captureId: meta.captureId,
        packetId: meta.packetId,
        timestamp: meta.createdAt,
        captureStatus: meta.captureStatus ?? 'complete',
        screenshotCount: meta.screenshots.length,
        totalSizeBytes: totalSize,
        page: meta.page,
        captureDir,
        packetFilePath: packetPresent ? packetPath : undefined,
        packetPresent,
      });
    } catch (parseError) {
      return err(
        this.cpError(
          'CP_METADATA_CORRUPT',
          `Metadata corrupt for capture '${captureId}': ${String(parseError)}`,
        ),
      );
    }
  }

  /** Deterministic persistence lookup: packetId → persisted safe capture. */
  async getPacketCapture(packetId: string): Promise<Result<StoredCapture>> {
    if (!this.validateCaptureId(packetId)) {
      return err(this.cpError('CP_INVALID_PACKET_ID', `Invalid packet ID: ${packetId}`));
    }
    if (!fs.existsSync(this.baseDir)) {
      return err(
        this.cpError('CP_CAPTURE_NOT_FOUND', `No persisted capture for packet '${packetId}'`),
      );
    }

    const entries = fs.readdirSync(this.baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!this.validateCaptureId(entry.name)) continue;
      try {
        const metaPath = path.join(this.baseDir, entry.name, 'metadata.json');
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as CaptureMetadata;
        if (meta.packetId === packetId) {
          return this.getCapture(entry.name);
        }
      } catch {
        // skip unreadable captures
      }
    }
    return err(
      this.cpError('CP_CAPTURE_NOT_FOUND', `No persisted capture references packet '${packetId}'`),
    );
  }

  /**
   * Load and schema-validate the persisted SAFE packet for a capture.
   * Corrupt or mismatched persisted state returns a typed failure — never a
   * malformed partial context.
   */
  async loadPersistedPacket(captureId: string): Promise<Result<PersistedPacket>> {
    if (!this.validateCaptureId(captureId)) {
      return err(this.cpError('CP_INVALID_CAPTURE_ID', `Invalid capture ID: ${captureId}`));
    }

    const captureDir = path.join(this.baseDir, captureId);
    if (!fs.existsSync(captureDir)) {
      return err(this.cpError('CP_CAPTURE_NOT_FOUND', `Capture '${captureId}' not found`));
    }

    const packetPath = path.join(captureDir, 'packet.json');
    if (!fs.existsSync(packetPath)) {
      return err(this.cpError('CP_PACKET_NOT_FOUND', `Capture '${captureId}' has no packet.json`));
    }

    let raw: string;
    try {
      raw = fs.readFileSync(packetPath, 'utf-8');
    } catch {
      return err(this.cpError('CP_PACKET_CORRUPT', `Packet unreadable for capture '${captureId}'`));
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return err(
        this.cpError('CP_PACKET_CORRUPT', `Packet is not valid JSON for capture '${captureId}'`),
      );
    }

    const validated = PersistedPacketSchema.safeParse(parsed);
    if (!validated.success) {
      return err(
        this.cpError(
          'CP_PACKET_CORRUPT',
          `Packet failed schema validation for capture '${captureId}'`,
        ),
      );
    }

    if (validated.data.captureId !== captureId) {
      return err(
        this.cpError(
          'CP_PACKET_MISMATCH',
          `Persisted packet references a different capture than '${captureId}'`,
        ),
      );
    }

    // Cross-check the metadata index for handoff/capture mismatch safety.
    try {
      const meta = JSON.parse(
        fs.readFileSync(path.join(captureDir, 'metadata.json'), 'utf-8'),
      ) as CaptureMetadata;
      if (meta.packetId !== validated.data.packetId) {
        return err(
          this.cpError(
            'CP_PACKET_MISMATCH',
            `Persisted packet and metadata disagree for capture '${captureId}'`,
          ),
        );
      }
    } catch {
      return err(
        this.cpError('CP_METADATA_CORRUPT', `Metadata corrupt for capture '${captureId}'`),
      );
    }

    return ok(validated.data);
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
        // Temporary/partial directories are never listable by construction.
        if (!this.validateCaptureId(entry.name)) continue;

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
      const captures = entries.filter((e) => e.isDirectory() && this.validateCaptureId(e.name));
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
      const captures = entries.filter((e) => e.isDirectory() && this.validateCaptureId(e.name));

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

  private writeAtomic(filePath: string, content: string): void {
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, content, 'utf-8');
    fs.renameSync(tempPath, filePath);
    try {
      if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
    } catch {
      // best-effort
    }
  }

  private bestEffortFlush(filePath: string): void {
    try {
      const fd = fs.openSync(filePath, 'r+');
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      // best-effort flush
    }
  }

  private throwIfHook(stage: PersistFailureStage): void {
    if (this.hooks.failOn === stage) {
      throw new Error(`Injected persistence failure at stage: ${stage}`);
    }
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
