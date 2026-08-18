import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { completeSetup, detectAndConfigureProject } from './index';
import type { SetupCheckResult, SetupCheckStatus } from './types';

/**
 * Phase 32B — capability independence matrix.
 *
 * Proves the three observations are independent:
 *   MCP runtime  /  browser runtime  /  capture smoke
 *
 * CASE A: MCP verified + browser verified + capture smoke failed
 *   → mcpServer = verified, browserRuntime = verified, captureContext =
 *     failed; setup incomplete unless explicit limited mode applies.
 * CASE B: MCP failed while the capture fixture would otherwise be valid
 *   → MCP capability stays failed; capture/static checks NEVER infer MCP
 *     success.
 * CASE C: all three work → all verified; setup can become complete.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FAKE_PACKET_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

function check(id: string, status: SetupCheckStatus): SetupCheckResult {
  return {
    checkId: id,
    name: id,
    severity: 'required',
    status,
    summary: `${id}: ${status}`,
  };
}

function passingBaseChecks(): SetupCheckResult[] {
  return [check('node-version', 'pass'), check('package-manager', 'pass')];
}

function smokeWithPacket(status: 'pass' | 'fail', packetId?: string) {
  return {
    lastRunAt: new Date().toISOString(),
    status,
    warnings: status === 'fail' ? ['Capture failed (fixture)'] : [],
    ...(packetId !== undefined ? { packetId } : {}),
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join(
    tmpdir(),
    `viskod-capability-matrix-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

async function projectFor(name: string) {
  const root = path.join(tmpDir, name);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name, version: '0.0.1' }, null, 2),
  );
  const project = detectAndConfigureProject({ projectRoot: root });
  expect(project.ok).toBe(true);
  if (!project.ok) throw new Error('project detection failed');
  return { root, project: project.value };
}

describe('Phase 32B — capture capability independence', () => {
  it('CASE A: MCP + browser verified, capture smoke failed → captureContext failed, incomplete without consent', async () => {
    const { root, project } = await projectFor('case-a');
    const checks = [
      ...passingBaseChecks(),
      check('mcp-tools-runtime', 'pass'),
      check('browser-runtime', 'pass'),
    ];
    const smoke = smokeWithPacket('fail'); // no packetId

    const setup = completeSetup({ projectRoot: root, project, checks, smoke, limitedMode: false });
    expect(setup.ok).toBe(true);
    if (!setup.ok) throw new Error('completeSetup failed');

    // Independent capability observations.
    expect(setup.value.capabilityStatus.mcpServer).toBe('verified');
    expect(setup.value.capabilityStatus.browserRuntime).toBe('verified');
    expect(setup.value.capabilityStatus.captureContext).toBe('failed');
    // Boolean matrix mirrors the statuses.
    expect(setup.value.capabilities.mcpServer).toBe(true);
    expect(setup.value.capabilities.browserRuntime).toBe(true);
    expect(setup.value.capabilities.captureContext).toBe(false);

    // Required-gate contract: no consent → incomplete.
    expect(setup.value.state).toBe('incomplete');
    expect(setup.value.completed).toBe(false);
    expect(setup.value.limitedMode).toBe(false);
    expect(setup.value.limitedReasons).toContain('captureContext');

    // Explicit limited consent under the same conditions → limited.
    const limited = completeSetup({
      projectRoot: root,
      project,
      checks,
      smoke,
      limitedMode: true,
    });
    if (!limited.ok) throw new Error('completeSetup failed');
    expect(limited.value.state).toBe('limited');
    expect(limited.value.limitedMode).toBe(true);
    expect(limited.value.capabilityStatus.captureContext).toBe('failed');
  });

  it('CASE B: MCP failed, capture valid → MCP stays failed (never inferred from capture)', async () => {
    const { root, project } = await projectFor('case-b');
    const checks = [
      ...passingBaseChecks(),
      check('mcp-tools-runtime', 'fail'),
      check('browser-runtime', 'pass'),
    ];
    // The capture fixture itself is valid: a real-looking packet.
    const smoke = smokeWithPacket('pass', FAKE_PACKET_ID);
    expect(UUID_PATTERN.test(FAKE_PACKET_ID)).toBe(true);

    const setup = completeSetup({ projectRoot: root, project, checks, smoke, limitedMode: false });
    expect(setup.ok).toBe(true);
    if (!setup.ok) throw new Error('completeSetup failed');

    // Capture works and is verified independently…
    expect(setup.value.capabilityStatus.captureContext).toBe('verified');
    expect(setup.value.capabilityStatus.browserRuntime).toBe('verified');
    // …but MCP capability is NOT inferred from capture/static checks.
    expect(setup.value.capabilityStatus.mcpServer).toBe('failed');
    expect(setup.value.capabilities.mcpServer).toBe(false);

    // MCP is a required gate → still incomplete without consent.
    expect(setup.value.state).toBe('incomplete');
    expect(setup.value.limitedReasons).toContain('mcpServer');
  });

  it('CASE C: all three work → all verified, setup completes', async () => {
    const { root, project } = await projectFor('case-c');
    const checks = [
      ...passingBaseChecks(),
      check('mcp-tools-runtime', 'pass'),
      check('browser-runtime', 'pass'),
    ];
    const smoke = smokeWithPacket('pass', FAKE_PACKET_ID);

    const setup = completeSetup({ projectRoot: root, project, checks, smoke, limitedMode: false });
    expect(setup.ok).toBe(true);
    if (!setup.ok) throw new Error('completeSetup failed');

    expect(setup.value.capabilityStatus.mcpServer).toBe('verified');
    expect(setup.value.capabilityStatus.browserRuntime).toBe('verified');
    expect(setup.value.capabilityStatus.captureContext).toBe('verified');
    expect(setup.value.capabilities.captureContext).toBe(true);

    expect(setup.value.state).toBe('complete');
    expect(setup.value.completed).toBe(true);
    expect(setup.value.limitedMode).toBe(false);
    expect(setup.value.limitedReasons).toHaveLength(0);
  });
});
