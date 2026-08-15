import * as fs from 'node:fs';
import * as path from 'node:path';
import { VISKOD_STORAGE_DIR } from '@viskod/shared';
import {
  ErrorCategory,
  ErrorSeverity,
  type Result,
  type ViskodError,
  err,
  ok,
} from '@viskod/shared';
import { AgentHandoffSchema } from './schemas';
import type { AgentHandoff } from './types';

const HANDOFFS_DIR = 'handoffs';
const HANDOFF_FILE = 'handoff.json';
const INDEX_FILE = 'index.json';

/**
 * Handoff ids are opaque, single-path-segment tokens. Anything with path
 * separators, traversal, or absolute-path shapes is rejected before it can
 * become a filesystem lookup (Phase 29 security requirement).
 */
const SAFE_HANDOFF_ID = /^[A-Za-z0-9_-]{1,64}$/;

function isValidHandoffId(id: string): boolean {
  return typeof id === 'string' && SAFE_HANDOFF_ID.test(id);
}

export interface HandoffIndex {
  version: 1;
  handoffs: Array<{
    handoffId: string;
    issueId: string;
    title: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }>;
  updatedAt: string;
}

export class HandoffPersistence {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? path.join(process.cwd(), VISKOD_STORAGE_DIR, HANDOFFS_DIR);
    try {
      fs.mkdirSync(this.baseDir, { recursive: true });
    } catch {
      /* best effort */
    }
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  private handoffDir(handoffId: string): string {
    return path.join(this.baseDir, handoffId);
  }

  private handoffFilePath(handoffId: string): string {
    return path.join(this.handoffDir(handoffId), HANDOFF_FILE);
  }

  private indexPath(): string {
    return path.join(this.baseDir, INDEX_FILE);
  }

  async saveHandoff(handoff: AgentHandoff): Promise<Result<void>> {
    if (!isValidHandoffId(handoff.handoffId)) {
      return err(this.heError('INVALID_HANDOFF_ID', `Invalid handoff ID: ${handoff.handoffId}`));
    }
    const parsed = AgentHandoffSchema.safeParse(handoff);
    if (!parsed.success) {
      return err(
        this.heError(
          'SCHEMA_VALIDATION_FAILED',
          `Schema validation failed: ${parsed.error.message}`,
        ),
      );
    }

    const dir = this.handoffDir(handoff.handoffId);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
      return err(
        this.heError(
          'PERSISTENCE_WRITE_FAILED',
          `Cannot create handoff directory: ${String(error)}`,
        ),
      );
    }

    const filePath = this.handoffFilePath(handoff.handoffId);
    const tempPath = `${filePath}.tmp`;
    try {
      const content = JSON.stringify(handoff, null, 2);
      fs.writeFileSync(tempPath, content, 'utf-8');
      fs.renameSync(tempPath, filePath);
      try {
        if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
      } catch {
        /* best effort */
      }
    } catch (error) {
      return err(
        this.heError('PERSISTENCE_WRITE_FAILED', `Failed to write handoff file: ${String(error)}`),
      );
    }

    await this.updateIndex();
    return ok(undefined);
  }

  async loadHandoff(handoffId: string): Promise<Result<AgentHandoff>> {
    if (!isValidHandoffId(handoffId)) {
      return err(this.heError('INVALID_HANDOFF_ID', `Invalid handoff ID: ${handoffId}`));
    }
    const filePath = this.handoffFilePath(handoffId);
    if (!fs.existsSync(filePath)) {
      return err(this.heError('HANDOFF_NOT_FOUND', `Handoff '${handoffId}' not found`));
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const validated = AgentHandoffSchema.safeParse(parsed);
      if (!validated.success) {
        return err(
          this.heError(
            'SCHEMA_VALIDATION_FAILED',
            `Corrupt handoff file: ${validated.error.message}`,
          ),
        );
      }
      return ok(validated.data as AgentHandoff);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return err(
          this.heError(
            'CORRUPT_HANDOFF_FILE',
            `Handoff file is corrupt for '${handoffId}': ${String(error)}`,
          ),
        );
      }
      return err(
        this.heError('PERSISTENCE_READ_FAILED', `Failed to read handoff: ${String(error)}`),
      );
    }
  }

  async deleteHandoff(handoffId: string): Promise<Result<void>> {
    if (!isValidHandoffId(handoffId)) {
      return err(this.heError('INVALID_HANDOFF_ID', `Invalid handoff ID: ${handoffId}`));
    }
    const dir = this.handoffDir(handoffId);
    if (!fs.existsSync(dir)) return ok(undefined);

    try {
      fs.rmSync(dir, { recursive: true, force: true });
      await this.updateIndex();
      return ok(undefined);
    } catch (error) {
      return err(
        this.heError('PERSISTENCE_WRITE_FAILED', `Failed to delete handoff: ${String(error)}`),
      );
    }
  }

  async listHandoffs(): Promise<Result<AgentHandoff[]>> {
    const handoffs: AgentHandoff[] = [];

    if (!fs.existsSync(this.baseDir)) {
      return ok([]);
    }

    const entries = fs.readdirSync(this.baseDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '__index_cache') continue;

      const result = await this.loadHandoff(entry.name);
      if (result.ok) {
        handoffs.push(result.value);
      }
    }

    handoffs.sort((a, b) => {
      const cmp = b.updatedAt.localeCompare(a.updatedAt);
      if (cmp !== 0) return cmp;
      return b.createdAt.localeCompare(a.createdAt);
    });

    return ok(handoffs);
  }

  async rebuildIndex(): Promise<Result<void>> {
    const handoffs = await this.listHandoffs();
    if (!handoffs.ok) return handoffs;

    const index: HandoffIndex = {
      version: 1,
      handoffs: handoffs.value.map((h) => ({
        handoffId: h.handoffId,
        issueId: h.issueId,
        title: h.brief.title,
        status: h.status,
        createdAt: h.createdAt,
        updatedAt: h.updatedAt,
      })),
      updatedAt: new Date().toISOString(),
    };

    const indexPath = this.indexPath();
    const tempPath = `${indexPath}.tmp`;
    try {
      fs.writeFileSync(tempPath, JSON.stringify(index, null, 2), 'utf-8');
      fs.renameSync(tempPath, indexPath);
    } catch {
      // Index is optional — source of truth is handoff files
    }

    return ok(undefined);
  }

  private async updateIndex(): Promise<void> {
    await this.rebuildIndex().catch(() => {
      /* index is optional */
    });
  }

  handoffExists(handoffId: string): boolean {
    if (!isValidHandoffId(handoffId)) return false;
    return fs.existsSync(this.handoffFilePath(handoffId));
  }

  private heError(code: string, message: string): ViskodError {
    return {
      code,
      category: ErrorCategory.STORAGE,
      severity: ErrorSeverity.RECOVERABLE,
      message,
      correlationId: crypto.randomUUID(),
      subsystem: 'agent-handoff',
      timestamp: new Date().toISOString(),
    };
  }
}
