import * as fs from 'node:fs';
import * as path from 'node:path';
import { VISKOD_STORAGE_DIR } from '@viskod/shared';
import { type Result, type ViskodError, ErrorCategory, ErrorSeverity, err, ok } from '@viskod/shared';
import type { VisualIssue } from './types';
import { VisualIssueSchema } from './schemas';

const ISSUES_DIR = 'issues';
const ISSUE_FILE = 'issue.json';
const ISSUE_INDEX_FILE = 'index.json';

export interface IssueIndex {
  version: 1;
  issues: Array<{
    issueId: string;
    updatedAt: string;
    createdAt: string;
    title: string;
    status: string;
    severity: string;
    archived: boolean;
    deleted: boolean;
  }>;
  updatedAt: string;
}

export class IssuePersistence {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? path.join(process.cwd(), VISKOD_STORAGE_DIR, ISSUES_DIR);
    try { fs.mkdirSync(this.baseDir, { recursive: true }); } catch { /* best effort */ }
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  private issueDir(issueId: string): string {
    return path.join(this.baseDir, issueId);
  }

  private issueFilePath(issueId: string): string {
    return path.join(this.issueDir(issueId), ISSUE_FILE);
  }

  private indexPath(): string {
    return path.join(this.baseDir, ISSUE_INDEX_FILE);
  }

  async saveIssue(issue: VisualIssue): Promise<Result<void>> {
    const parsed = VisualIssueSchema.safeParse(issue);
    if (!parsed.success) {
      return err(this.peError('SCHEMA_VALIDATION_FAILED', `Schema validation failed: ${parsed.error.message}`));
    }

    const dir = this.issueDir(issue.issueId);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
      return err(this.peError('PERSISTENCE_WRITE_FAILED', `Cannot create issue directory: ${String(error)}`));
    }

    const filePath = this.issueFilePath(issue.issueId);
    const tempPath = `${filePath}.tmp`;
    try {
      const content = JSON.stringify(issue, null, 2);
      fs.writeFileSync(tempPath, content, 'utf-8');
      fs.renameSync(tempPath, filePath);
      try { if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true }); } catch { /* best effort */ }
    } catch (error) {
      return err(this.peError('PERSISTENCE_WRITE_FAILED', `Failed to write issue file: ${String(error)}`));
    }

    await this.updateIndex();
    return ok(undefined);
  }

  async loadIssue(issueId: string): Promise<Result<VisualIssue>> {
    const filePath = this.issueFilePath(issueId);
    if (!fs.existsSync(filePath)) {
      return err(this.peError('ISSUE_NOT_FOUND', `Issue '${issueId}' not found`));
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const validated = VisualIssueSchema.safeParse(parsed);
      if (!validated.success) {
        return err(this.peError('SCHEMA_VALIDATION_FAILED', `Corrupt issue file: ${validated.error.message}`));
      }
      return ok(validated.data as VisualIssue);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return err(this.peError('CORRUPT_ISSUE_FILE', `Issue file is corrupt for '${issueId}': ${String(error)}`));
      }
      return err(this.peError('PERSISTENCE_READ_FAILED', `Failed to read issue: ${String(error)}`));
    }
  }

  async deleteIssue(issueId: string): Promise<Result<void>> {
    const dir = this.issueDir(issueId);
    if (!fs.existsSync(dir)) return ok(undefined);

    try {
      fs.rmSync(dir, { recursive: true, force: true });
      await this.updateIndex();
      return ok(undefined);
    } catch (error) {
      return err(this.peError('PERSISTENCE_WRITE_FAILED', `Failed to delete issue: ${String(error)}`));
    }
  }

  async listIssues(includeArchived: boolean = false, includeDeleted: boolean = false): Promise<Result<VisualIssue[]>> {
    const issues: VisualIssue[] = [];

    if (!fs.existsSync(this.baseDir)) {
      return ok([]);
    }

    const entries = fs.readdirSync(this.baseDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '__index_cache') continue;

      const result = await this.loadIssue(entry.name);
      if (result.ok) {
        const issue = result.value;
        if (!includeArchived && issue.status === 'archived') continue;
        if (!includeDeleted && issue.deletedAt) continue;
        issues.push(issue);
      }
    }

    issues.sort((a, b) => {
      const cmp = b.updatedAt.localeCompare(a.updatedAt);
      if (cmp !== 0) return cmp;
      return b.createdAt.localeCompare(a.createdAt);
    });

    return ok(issues);
  }

  async rebuildIndex(): Promise<Result<void>> {
    const issues = await this.listIssues(true, true);
    if (!issues.ok) return issues;

    const index: IssueIndex = {
      version: 1,
      issues: issues.value.map((i) => ({
        issueId: i.issueId,
        updatedAt: i.updatedAt,
        createdAt: i.createdAt,
        title: i.title,
        status: i.status,
        severity: i.severity,
        archived: i.status === 'archived',
        deleted: !!i.deletedAt,
      })),
      updatedAt: new Date().toISOString(),
    };

    const indexPath = this.indexPath();
    const tempPath = `${indexPath}.tmp`;
    try {
      fs.writeFileSync(tempPath, JSON.stringify(index, null, 2), 'utf-8');
      fs.renameSync(tempPath, indexPath);
    } catch {
      // Index is optional — source of truth is issue files
    }

    return ok(undefined);
  }

  private async updateIndex(): Promise<void> {
    await this.rebuildIndex().catch(() => { /* index is optional */ });
  }

  issueExists(issueId: string): boolean {
    return fs.existsSync(this.issueFilePath(issueId));
  }

  private peError(code: string, message: string): ViskodError {
    return {
      code,
      category: ErrorCategory.STORAGE,
      severity: ErrorSeverity.RECOVERABLE,
      message,
      correlationId: crypto.randomUUID(),
      subsystem: 'visual-issue',
      timestamp: new Date().toISOString(),
    };
  }
}
