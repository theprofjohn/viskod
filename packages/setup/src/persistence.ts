import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Result } from '@viskod/shared';
import { ErrorCategory, ErrorSeverity, VISKOD_STORAGE_DIR, err, ok } from '@viskod/shared';
import type { FirstRunSetupState, SetupStateKind } from './types';

const SETUP_DIR = 'setup';
const STATUS_FILE = 'status.json';
const SCHEMA_VERSION = 2;

const SETUP_STATE_KINDS: SetupStateKind[] = ['complete', 'limited', 'incomplete'];

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

/**
 * Minimal v2 shape validation. Guards the persisted file against corruption
 * without re-implementing the full state contract here.
 */
function isV2SetupState(parsed: unknown): parsed is FirstRunSetupState {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const candidate = parsed as Record<string, unknown>;
  return (
    typeof candidate.setupId === 'string' &&
    typeof candidate.state === 'string' &&
    SETUP_STATE_KINDS.includes(candidate.state as SetupStateKind) &&
    typeof candidate.completed === 'boolean' &&
    typeof candidate.project === 'object' &&
    candidate.project !== null &&
    typeof candidate.capabilityStatus === 'object' &&
    candidate.capabilityStatus !== null
  );
}

export function loadSetupState(projectRoot: string): Result<FirstRunSetupState | null> {
  const filePath = getSetupFilePath(projectRoot);

  if (!fs.existsSync(filePath)) {
    return ok(null);
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);

    // Schema validation. A v1 file (schemaVersion 1) is deliberately treated
    // as "not set up": the v1 state predates the complete/limited/incomplete
    // model and must go through re-verification to produce trustworthy v2
    // fields (state, capabilityStatus, verifiedAt).
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      (parsed as Record<string, unknown>).schemaVersion !== SCHEMA_VERSION
    ) {
      return ok(null);
    }

    if (!isV2SetupState(parsed)) {
      return err(setupError('SETUP_STATE_CORRUPT', 'Setup state file is corrupted.'));
    }

    return ok(parsed);
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
    state: 'incomplete',
    limitedMode: false,
    limitedReasons: [],
    setupVersion: '0.0.0-dev',
    sourceResolution: fs.existsSync(projectRoot) ? 'ready' : 'unavailable',
    capabilityStatus: {},
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
