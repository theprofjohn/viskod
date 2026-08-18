import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { McpServeCommand } from './command-factory';
import {
  completeSetup,
  detectAndConfigureProject,
  initializeProjectWorkspace,
  runAllChecks,
  runSmoke,
} from './index';
import { loadSetupState } from './persistence';

/**
 * Phase 32B — failed MCP → setup incomplete → explicit limited → recovery.
 *
 * Connects the deterministic MCP timeout to the real setup orchestration:
 * a controlled hang fixture (never returns `initialize` readiness) with a
 * short injected TEST timeout drives `runAllChecks` through the REAL
 * `verifyMcpToolsRuntime` boundary, and `completeSetup` persists the v2
 * state machine.
 *
 * Flow asserted:
 *   1. controlled MCP timeout → setup → persisted state:
 *        state = incomplete, completed = false, limitedMode = false,
 *        mcpServer capability = failed
 *   2. explicit limited consent under the same failed MCP:
 *        state = limited, limitedMode = true
 *   3. working MCP restored (real live initialize + tools/list):
 *        state = complete, limitedMode = false, limitedReasons empty
 *
 * Only the MCP timing is injected (fixture + short timeout). Every other
 * boundary — checks, browser runtime, capture smoke, persistence — is real.
 */

const HANG_FIXTURE = String.raw`
const fs = require('node:fs');
const evidence = process.argv[2];
fs.writeFileSync(evidence, JSON.stringify({ started: true, pid: process.pid }));
process.on('SIGTERM', () => { /* trapped: forces SIGTERM -> grace -> SIGKILL */ });
setInterval(() => {}, 1000);
`;

const testState = vi.hoisted(() => ({
  mode: 'hang' as 'hang' | 'real',
  hangFixture: '',
  hangEvidence: '',
}));

vi.mock('./mcp-runtime', async (importOriginal) => {
  const original = await importOriginal<typeof import('./mcp-runtime')>();
  return {
    ...original,
    verifyMcpToolsRuntime: vi.fn(
      async (
        projectRoot?: string,
        opts?: { serveCommand?: McpServeCommand; timeoutMs?: number },
      ) => {
        if (testState.mode === 'hang') {
          // Deterministic timeout: a fixture that starts but never responds
          // to `initialize`, verified through the REAL timeout/cleanup
          // boundary.
          return original.verifyMcpToolsRuntime(projectRoot, {
            ...(opts ?? {}),
            serveCommand: {
              command: process.execPath,
              args: [testState.hangFixture, testState.hangEvidence],
              mode: 'dev',
              source: 'test',
            },
            timeoutMs: 300,
          });
        }
        // Healthy mode: the real serve command (live initialize + tools/list).
        return original.verifyMcpToolsRuntime(projectRoot, opts);
      },
    ),
  };
});

let tmpDir: string;
let projectRoot: string;

function findCheck(checks: Array<{ checkId: string; status: string; summary: string }>) {
  return checks.find((c) => c.checkId === 'mcp-tools-runtime');
}

beforeAll(() => {
  tmpDir = path.join(
    tmpdir(),
    `viskod-setup-timeout-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  projectRoot = path.join(tmpDir, 'project');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({ name: 'timeout-test', version: '0.0.1' }, null, 2),
  );

  testState.hangFixture = path.join(tmpDir, 'hang.cjs');
  fs.writeFileSync(testState.hangFixture, HANG_FIXTURE, 'utf-8');
  testState.hangEvidence = path.join(tmpDir, 'hang-evidence.json');

  const init = initializeProjectWorkspace({ projectRoot });
  if (!init.ok) throw new Error(`workspace init failed: ${init.error.message}`);
});

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe('Phase 32B — MCP timeout through setup', () => {
  it('controlled MCP timeout → setup persists incomplete (completed false, mcpServer failed)', async () => {
    testState.mode = 'hang';

    const checks = await runAllChecks({ projectRoot });
    const mcpCheck = findCheck(checks);
    expect(mcpCheck).toBeDefined();
    expect(mcpCheck?.status).toBe('fail');
    expect(mcpCheck?.summary).toMatch(/timed out after 300ms/);

    // The hang fixture really was spawned and timed out.
    const evidence = JSON.parse(fs.readFileSync(testState.hangEvidence, 'utf-8')) as {
      started: boolean;
    };
    expect(evidence.started).toBe(true);

    const project = detectAndConfigureProject({ projectRoot });
    expect(project.ok).toBe(true);
    if (!project.ok) throw new Error('project detection failed');

    const setup = completeSetup({
      projectRoot,
      project: project.value,
      checks,
      limitedMode: false,
    });
    expect(setup.ok).toBe(true);
    if (!setup.ok) throw new Error('completeSetup failed');

    expect(setup.value.state).toBe('incomplete');
    expect(setup.value.completed).toBe(false);
    expect(setup.value.limitedMode).toBe(false);
    expect(setup.value.capabilityStatus.mcpServer).toBe('failed');
    expect(setup.value.limitedReasons).toContain('mcpServer');

    // Persisted state matches the returned state.
    const persisted = loadSetupState(projectRoot);
    expect(persisted.ok).toBe(true);
    if (!persisted.ok || !persisted.value) throw new Error('no persisted state');
    expect(persisted.value.state).toBe('incomplete');
    expect(persisted.value.completed).toBe(false);
    expect(persisted.value.limitedMode).toBe(false);
    expect(persisted.value.capabilityStatus.mcpServer).toBe('failed');
  }, 120_000);

  it('explicit limited consent under the same failed MCP → persisted limited, limitedMode true', async () => {
    testState.mode = 'hang';

    const checks = await runAllChecks({ projectRoot });
    expect(findCheck(checks)?.status).toBe('fail');

    const project = detectAndConfigureProject({ projectRoot });
    if (!project.ok) throw new Error('project detection failed');

    const setup = completeSetup({
      projectRoot,
      project: project.value,
      checks,
      limitedMode: true,
    });
    expect(setup.ok).toBe(true);
    if (!setup.ok) throw new Error('completeSetup failed');

    expect(setup.value.state).toBe('limited');
    expect(setup.value.limitedMode).toBe(true);
    expect(setup.value.completed).toBe(true);
    expect(setup.value.capabilityStatus.mcpServer).toBe('failed');
    expect(setup.value.limitedReasons).toContain('mcpServer');

    const persisted = loadSetupState(projectRoot);
    if (!persisted.ok || !persisted.value) throw new Error('no persisted state');
    expect(persisted.value.state).toBe('limited');
    expect(persisted.value.limitedMode).toBe(true);
  }, 120_000);

  it('restored working MCP → live initialize/tools-list → setup complete, limitedMode cleared', async () => {
    testState.mode = 'real';

    // Healthy run: the REAL MCP serve command must pass live tools/list.
    const checks = await runAllChecks({ projectRoot });
    const mcpCheck = findCheck(checks);
    expect(mcpCheck).toBeDefined();
    expect(mcpCheck?.status).toBe('pass');
    expect(mcpCheck?.summary).toMatch(/tools\/list/);

    const smoke = await runSmoke({ projectRoot });
    expect(smoke.ok).toBe(true);
    if (!smoke.ok) throw new Error('smoke failed');
    expect(smoke.value.status).toBe('pass');
    expect(smoke.value.packetId).toBeTruthy();

    const project = detectAndConfigureProject({ projectRoot });
    if (!project.ok) throw new Error('project detection failed');

    const setup = completeSetup({
      projectRoot,
      project: project.value,
      checks,
      smoke: smoke.value,
      limitedMode: false,
    });
    expect(setup.ok).toBe(true);
    if (!setup.ok) throw new Error('completeSetup failed');

    expect(setup.value.state).toBe('complete');
    expect(setup.value.completed).toBe(true);
    expect(setup.value.limitedMode).toBe(false);
    expect(setup.value.limitedReasons).toHaveLength(0);
    expect(setup.value.capabilityStatus.mcpServer).toBe('verified');

    const persisted = loadSetupState(projectRoot);
    if (!persisted.ok || !persisted.value) throw new Error('no persisted state');
    expect(persisted.value.state).toBe('complete');
    expect(persisted.value.limitedMode).toBe(false);
    expect(persisted.value.limitedReasons).toHaveLength(0);
  }, 180_000);
});
