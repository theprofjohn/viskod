import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Result } from '@viskod/shared';
import { ErrorCategory, ErrorSeverity, VISKOD_STORAGE_DIR, err, ok } from '@viskod/shared';
import type { WorkspaceDirInfo, WorkspaceInitResult } from './types';

const SETUP_DIR = 'setup';
const ISSUES_DIR = 'issues';
const CAPTURES_DIR = 'captures';
const HANDOFFS_DIR = 'handoffs';
const REVIEWS_DIR = 'reviews';
const LOGS_DIR = 'logs';

const REQUIRED_DIRS = [
  { key: 'captures', dir: CAPTURES_DIR },
  { key: 'issues', dir: ISSUES_DIR },
  { key: 'handoffs', dir: HANDOFFS_DIR },
  { key: 'reviews', dir: REVIEWS_DIR },
  { key: 'setup', dir: SETUP_DIR },
];

const OPTIONAL_DIRS = [{ key: 'logs', dir: LOGS_DIR }];

function setupError(code: string, message: string) {
  return {
    code,
    category: ErrorCategory.STORAGE,
    severity: ErrorSeverity.RECOVERABLE,
    message,
    correlationId: crypto.randomUUID(),
    subsystem: 'setup',
    timestamp: new Date().toISOString(),
  };
}

function ensureDir(dirPath: string): { exists: boolean; writable: boolean } {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    // Test write access
    const testFile = path.join(dirPath, '.viskod-write-test');
    fs.writeFileSync(testFile, '', 'utf-8');
    fs.unlinkSync(testFile);
    return { exists: true, writable: true };
  } catch {
    return { exists: fs.existsSync(dirPath), writable: false };
  }
}

export function initializeWorkspace(input: { projectRoot: string }): Result<WorkspaceInitResult> {
  const { projectRoot } = input;
  const viskodDir = path.join(projectRoot, VISKOD_STORAGE_DIR);
  const warnings: string[] = [];

  if (!fs.existsSync(projectRoot)) {
    return err(
      setupError('SETUP_PROJECT_ROOT_MISSING', `Project root does not exist: ${projectRoot}`),
    );
  }

  // Create .viskod root
  const rootStatus = ensureDir(viskodDir);
  if (!rootStatus.writable) {
    return err(
      setupError(
        'SETUP_WORKSPACE_NOT_WRITABLE',
        `Cannot write to ${VISKOD_STORAGE_DIR} directory. Check folder permissions.`,
      ),
    );
  }

  const directories: WorkspaceDirInfo[] = [];

  // Create required directories
  for (const { key, dir } of REQUIRED_DIRS) {
    const dirPath = path.join(viskodDir, dir);
    const status = ensureDir(dirPath);
    directories.push({ key, path: `${VISKOD_STORAGE_DIR}/${dir}`, ...status });
    if (!status.writable) {
      warnings.push(`Directory ${VISKOD_STORAGE_DIR}/${dir} is not writable.`);
    }
  }

  // Create optional directories
  for (const { key, dir } of OPTIONAL_DIRS) {
    const dirPath = path.join(viskodDir, dir);
    const status = ensureDir(dirPath);
    directories.push({ key, path: `${VISKOD_STORAGE_DIR}/${dir}`, ...status });
  }

  return ok({
    initialized: true,
    directories,
    warnings,
  });
}

export function repairWorkspace(input: { projectRoot: string }): Result<WorkspaceInitResult> {
  return initializeWorkspace(input);
}
