import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Result } from '@viskod/shared';
import { ErrorCategory, ErrorSeverity, VISKOD_STORAGE_DIR, err, ok } from '@viskod/shared';
import type { FirstRunSetupState } from './types';

const SETUP_DIR = 'setup';
const STATUS_FILE = 'status.json';
const SCHEMA_VERSION = 1;

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

function getSetupFilePath(projectRoot: string): string {
  return path.join(projectRoot, VISKOD_STORAGE_DIR, SETUP_DIR, STATUS_FILE);
}

function ensureSetupDir(projectRoot: string): void {
  const setupDir = path.join(projectRoot, VISKOD_STORAGE_DIR, SETUP_DIR);
  if (!fs.existsSync(setupDir)) {
    fs.mkdirSync(setupDir, { recursive: true });
  }
}

export function loadSetupState(projectRoot: string): Result<FirstRunSetupState | null> {
  const filePath = getSetupFilePath(projectRoot);

  if (!fs.existsSync(filePath)) {
    return ok(null);
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);

    // Basic schema validation
    if (parsed.schemaVersion !== SCHEMA_VERSION) {
      return ok(null); // Incompatible version, treat as not setup
    }

    if (typeof parsed.setupId !== 'string') {
      return err(setupError('SETUP_STATE_CORRUPT', 'Setup state file is corrupted.'));
    }

    return ok(parsed as FirstRunSetupState);
  } catch (e) {
    return err(
      setupError(
        'SETUP_STATE_CORRUPT',
        `Failed to read setup state: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export function saveSetupState(projectRoot: string, state: FirstRunSetupState): Result<void> {
  ensureSetupDir(projectRoot);
  const filePath = getSetupFilePath(projectRoot);

  try {
    const json = JSON.stringify(state, null, 2);
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, filePath);
    return ok(undefined);
  } catch (e) {
    return err(
      setupError(
        'SETUP_STATE_WRITE_FAILED',
        `Failed to save setup state: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

export function createInitialSetupState(
  projectRoot: string,
  fingerprint: string,
): FirstRunSetupState {
  return {
    schemaVersion: SCHEMA_VERSION,
    setupId: crypto.randomUUID(),
    project: {
      rootDisplayName: path.basename(projectRoot),
      rootFingerprint: fingerprint,
    },
    workspace: {
      initialized: false,
      directories: [],
    },
    checks: [],
    capabilities: {
      captureContext: false,
      recaptureContext: false,
      exportContext: false,
      visualSelection: false,
      visualIssue: false,
      agentHandoff: false,
      visualReview: false,
      usageSiteSourceHints: false,
      mcpServer: false,
      browserRuntime: false,
      appReachable: false,
      agentConfigReady: false,
    },
    completed: false,
    updatedAt: new Date().toISOString(),
    redaction: {
      applied: true,
      rules: ['path-sanitization', 'secret-detection'],
    },
  };
}
