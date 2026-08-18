import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runDoctor } from './doctor';
import { createInitialSetupState, saveSetupState } from './persistence';
import type { FirstRunSetupState } from './types';

// Mock heavy dependencies so we never launch MCP/browser/studio
vi.mock('./mcp-runtime', () => ({
  verifyMcpToolsRuntime: vi.fn().mockResolvedValue({
    ok: false,
    error: new Error('mocked MCP failure'),
  }),
}));

vi.mock('./agent-config', () => ({
  checkAgentConfigReadiness: vi.fn().mockReturnValue({
    detected: false,
    kind: 'unknown' as const,
    verified: false,
  }),
}));

// Stub the studio HTTP HEAD so it doesn't hit the network
const fetchSpy = vi.fn().mockRejectedValue(new Error('mocked'));
vi.stubGlobal('fetch', fetchSpy);

let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join(
    os.tmpdir(),
    `viskod-doctor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(tmpDir, { recursive: true });
  // Create a minimal project so detectProject succeeds naturally
  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({ name: 'test-project' }),
    'utf-8',
  );
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

function makeCompleteState(): FirstRunSetupState {
  const state = createInitialSetupState(tmpDir, 'test-fingerprint');
  state.state = 'complete';
  state.completed = true;
  state.verifiedAt = new Date().toISOString();
  return state;
}

function makeIncompleteState(): FirstRunSetupState {
  return createInitialSetupState(tmpDir, 'test-fingerprint');
}

describe('doctor stale state detection', () => {
  it('persisted complete state + mcp.ok=false → stale=true', async () => {
    const state = makeCompleteState();
    saveSetupState(tmpDir, state);

    const report = await runDoctor({ projectRoot: tmpDir });

    expect(report.setupState.exists).toBe(true);
    expect(report.setupState.state).toBe('complete');
    expect(report.setupState.stale).toBe(true);
    expect(report.setupState.staleReason).toContain('live MCP verification failed');
  });

  it('persisted incomplete state → stale=false', async () => {
    const state = makeIncompleteState();
    saveSetupState(tmpDir, state);

    const report = await runDoctor({ projectRoot: tmpDir });

    expect(report.setupState.exists).toBe(true);
    expect(report.setupState.state).toBe('incomplete');
    expect(report.setupState.stale).toBe(false);
  });

  it('no persisted state → exists=false, stale=false', async () => {
    const report = await runDoctor({ projectRoot: tmpDir });

    expect(report.setupState.exists).toBe(false);
    expect(report.setupState.stale).toBe(false);
  });

  it('no projectRoot → exists=false, stale=false', async () => {
    const report = await runDoctor({});

    expect(report.setupState.exists).toBe(false);
    expect(report.setupState.stale).toBe(false);
  });

  it('persisted limited state + mcp.ok=false → stale=true', async () => {
    const state = makeCompleteState();
    state.state = 'limited';
    state.limitedMode = true;
    saveSetupState(tmpDir, state);

    const report = await runDoctor({ projectRoot: tmpDir });

    expect(report.setupState.exists).toBe(true);
    expect(report.setupState.state).toBe('limited');
    expect(report.setupState.stale).toBe(true);
  });
});
