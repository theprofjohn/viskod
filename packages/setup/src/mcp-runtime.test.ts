import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { McpServeCommand } from './command-factory';
import { verifyMcpToolsRuntime } from './mcp-runtime';

/**
 * Phase 32B — deterministic MCP timeout + cleanup proof.
 *
 * The fixture process starts successfully but never returns the `initialize`
 * readiness response. A short injected TEST timeout (not the production
 * timeout) forces the timeout deterministically — no machine slowness.
 *
 * Asserted contract:
 *  - typed failure Result (not a throw) with a timeout message;
 *  - the child receives SIGTERM and survives it (SIGTERM trapped) → the
 *    grace period elapses → SIGKILL escalates and the tree dies;
 *  - the child AND its descendant are gone after the call (no orphan);
 *  - stdio pipes close with the tree (process death closes fds; the retry
 *    below re-spawns cleanly, proving no handle blocks reuse);
 *  - a subsequent retry starts a FRESH process and succeeds.
 *
 * Real timing is required here on purpose: the KILL_GRACE_MS window is the
 * production cleanup behavior under test; fake timers cannot observe an
 * external child process.
 */

const REQUIRED_TOOL_NAMES = [
  'viskod_capture_context',
  'create_agent_handoff',
  'get_agent_handoff',
  'list_agent_handoffs',
  'create_visual_review',
  'get_visual_review',
  'recapture_visual_review',
  'resolve_usage_site_hints',
];

const HANG_FIXTURE = String.raw`
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const evidence = process.argv[2];
const gcEvidence = process.argv[3];
const marks = process.argv[4];
fs.writeFileSync(evidence, JSON.stringify({ started: true, pid: process.pid }));
const gc = spawn(process.execPath, ['-e', [
  "const fs = require('node:fs');",
  "fs.writeFileSync(process.argv[2], JSON.stringify({ gpid: process.pid }));",
  "setInterval(() => {}, 1000);"
].join('\n'), gcEvidence], {
  stdio: 'ignore',
});
// Wait for the grandchild to record its pid, then publish it.
setTimeout(() => {
  try {
    const gcData = JSON.parse(fs.readFileSync(gcEvidence, 'utf-8'));
    const data = JSON.parse(fs.readFileSync(evidence, 'utf-8'));
    fs.writeFileSync(evidence, JSON.stringify({ ...data, grandchildPid: gcData.gpid }));
  } catch {}
}, 300);
process.on('SIGTERM', () => {
  // Trap SIGTERM and keep running: forces the SIGTERM -> grace -> SIGKILL
  // escalation path in killProcess. Record that we survived SIGTERM.
  fs.appendFileSync(marks, 'SIGTERM-trapped\n');
});
process.on('exit', () => {
  fs.appendFileSync(marks, 'clean-exit\n');
});
setInterval(() => {}, 1000);
`;

const RESPOND_FIXTURE = String.raw`
const fs = require('node:fs');
const tools = JSON.parse(process.argv[3]);
fs.writeFileSync(process.argv[2], JSON.stringify({ started: true, pid: process.pid }));
process.on('SIGTERM', () => process.exit(0));
let buf = '';
process.stdin.on('data', (d) => {
  buf += d.toString();
  const lines = buf.split('\n');
  buf = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    let result;
    if (msg.method === 'initialize') {
      result = { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fixture-mcp', version: '0.0.0' } };
    } else if (msg.method === 'tools/list') {
      result = { tools: tools.map((name) => ({ name, description: 'fixture', inputSchema: { type: 'object', properties: {} } })) };
    } else if (msg.method === 'tools/call' && msg.params && msg.params.name === 'get_setup_state') {
      result = { content: [{ type: 'text', text: '{}' }] };
    } else {
      result = {};
    }
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n');
  }
});
`;

function writeFixture(dir: string, mode: 'hang' | 'respond', extraArgs: string[]): McpServeCommand {
  const fixturePath = path.join(dir, `${mode}.cjs`);
  fs.writeFileSync(fixturePath, mode === 'hang' ? HANG_FIXTURE : RESPOND_FIXTURE, 'utf-8');
  return {
    command: process.execPath,
    args: [fixturePath, ...extraArgs],
    mode: 'dev',
    source: 'test',
  };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * A killed process can linger as a zombie for a few milliseconds until the
 * parent reaps it; `kill(pid, 0)` reports zombies as alive. Poll with a
 * bounded deadline instead of asserting on one instant.
 */
async function waitForGone(pid: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isAlive(pid)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`process ${pid} still alive after ${timeoutMs}ms`);
}

function readEvidence(file: string): string {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return '';
  }
}

let tmpDir: string;
let projectRoot: string;

beforeEach(() => {
  tmpDir = path.join(
    tmpdir(),
    `viskod-mcp-runtime-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  projectRoot = path.join(tmpDir, 'project');
  fs.mkdirSync(projectRoot, { recursive: true });
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe('verifyMcpToolsRuntime — deterministic timeout cleanup', () => {
  it('times out with a typed failure, traps SIGTERM, escalates through grace to SIGKILL, and leaves no tree behind', async () => {
    const evidence = path.join(tmpDir, 'hang-evidence.json');
    const gcEvidence = path.join(tmpDir, 'hang-evidence.gc.json');
    const marks = path.join(tmpDir, 'hang-evidence.marks');
    const cmd = writeFixture(tmpDir, 'hang', [evidence, gcEvidence, marks]);
    const startedAt = Date.now();

    const result = await verifyMcpToolsRuntime(projectRoot, {
      serveCommand: { ...cmd, args: [...cmd.args] },
      timeoutMs: 300,
    });

    // Typed failure Result — not a throw, not ok.
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.code).toBe('MCP_RUNTIME_VERIFY_FAILED');
    expect(result.error.message).toMatch(/timed out after 300ms/);

    // The fixture started (a real process was spawned and fed initialize).
    const ev = JSON.parse(readEvidence(evidence)) as { started: boolean; pid: number };
    expect(ev.started).toBe(true);
    expect(typeof ev.pid).toBe('number');

    // Child received termination: SIGTERM was delivered and trapped.
    const markerOutput = readEvidence(marks);
    expect(markerOutput).toContain('SIGTERM-trapped');
    // The grace window elapsed: the fixture survived SIGTERM, so the call
    // could not complete before the 500ms KILL_GRACE_MS window.
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(700);
    // It never exited on its own — SIGKILL escalation was required.
    expect(markerOutput).not.toContain('clean-exit');

    // Child is gone after the call.
    await waitForGone(ev.pid, 3000);

    // No descendant remains: the grandchild (same process group) is gone.
    const withGrandchild = JSON.parse(readEvidence(evidence)) as {
      grandchildPid?: number;
    };
    if (typeof withGrandchild.grandchildPid === 'number') {
      await waitForGone(withGrandchild.grandchildPid, 3000);
    }
  }, 20000);

  it('retry after timeout starts a fresh process and succeeds', async () => {
    const hangEvidence = path.join(tmpDir, 'hang-evidence.json');
    const hangGcEvidence = path.join(tmpDir, 'hang-evidence.gc.json');
    const hangMarks = path.join(tmpDir, 'hang-evidence.marks');
    const hangCmd = writeFixture(tmpDir, 'hang', [hangEvidence, hangGcEvidence, hangMarks]);
    const first = await verifyMcpToolsRuntime(projectRoot, {
      serveCommand: { ...hangCmd, args: [...hangCmd.args] },
      timeoutMs: 300,
    });
    expect(first.ok).toBe(false);
    const hangPid = (JSON.parse(readEvidence(hangEvidence)) as { pid: number }).pid;

    // Fresh retry against a responder fixture: must succeed with all tools.
    const respondEvidence = path.join(tmpDir, 'respond-evidence.json');
    const respondCmd = writeFixture(tmpDir, 'respond', [
      respondEvidence,
      JSON.stringify(REQUIRED_TOOL_NAMES),
    ]);
    const second = await verifyMcpToolsRuntime(projectRoot, {
      serveCommand: { ...respondCmd, args: [...respondCmd.args] },
      timeoutMs: 5000,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('expected success');
    expect(second.value.serverReachable).toBe(true);
    expect(second.value.requiredToolsPresent).toBe(true);
    expect(second.value.toolsFound.length).toBe(REQUIRED_TOOL_NAMES.length);

    const respondEv = JSON.parse(readEvidence(respondEvidence)) as { pid: number };
    // A FRESH process was spawned — not the timed-out one.
    expect(respondEv.pid).not.toBe(hangPid);

    // The successful retry's child is also terminated (clean shutdown).
    await waitForGone(respondEv.pid, 3000);
    // The timed-out process is still gone.
    await waitForGone(hangPid, 3000);
  }, 20000);
});
