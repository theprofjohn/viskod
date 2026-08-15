import type { ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROOT, STUDIO_URL, killTree, sleep, spawnProc, waitForHttp } from './harness';

/**
 * Phase 31 — visual review privacy boundary (§24).
 *
 * LOCAL SENSITIVE review artifacts are a SEPARATE class from the Phase 29
 * agent-safe packet:
 *
 * - with the policy explicitly enabled, a local target crop IS persisted and
 *   marked sensitive/localOnly;
 * - that crop NEVER enters the ContextPacket screenshot fields (they stay
 *   `omitted_sensitive` under the Phase 29 default policy);
 * - `get_handoff_context` from a FRESH MCP process still reports the
 *   screenshot as omitted_sensitive and exposes no review artifact ids/paths;
 * - MCP has no tool that can retrieve review images;
 * - Studio serves them only through the protected opaque artifact endpoint;
 * - no absolute artifact path appears in Studio state or handoff context.
 */

const PRIVACY_URL = 'http://127.0.0.1:3222';

let privacyProc: ChildProcess | null = null;
let studioProc: ChildProcess | null = null;
let mcpProc: ChildProcess | null = null;

let mcpStdout = '';
let mcpStderr = '';
let parsedIndex = 0;
let rpcId = 100;

function rpcSend(msg: Record<string, unknown>): void {
  mcpProc?.stdin?.write(`${JSON.stringify(msg)}\n`);
}

function rpcWait(timeoutMs: number): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const loop = (): void => {
      const tail = mcpStdout.slice(parsedIndex);
      for (const line of tail.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('{')) {
          try {
            const obj = JSON.parse(trimmed) as Record<string, unknown>;
            parsedIndex = mcpStdout.length;
            resolve(obj);
            return;
          } catch {
            /* partial line */
          }
        }
      }
      if (Date.now() - start > timeoutMs) {
        resolve(null);
        return;
      }
      setTimeout(loop, 500);
    };
    loop();
  });
}

async function rpcCall(
  name: string,
  args: Record<string, unknown>,
  timeoutMs = 120000,
): Promise<Record<string, unknown> | null> {
  rpcId += 1;
  rpcSend({ jsonrpc: '2.0', id: rpcId, method: 'tools/call', params: { name, arguments: args } });
  return rpcWait(timeoutMs);
}

function parseToolText(response: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!response) return null;
  if (response.error) return null;
  const content = (response.result as { content?: Array<{ text?: string }> } | undefined)?.content;
  const text = content?.[0]?.text;
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function post(url: string, body: unknown): Promise<{ status: number; data: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

async function getWorkflowState(): Promise<Record<string, unknown>> {
  return (await (await fetch(`${STUDIO_URL}/workflow/state`)).json()) as Record<string, unknown>;
}

async function waitForSelection(timeoutMs: number): Promise<Record<string, unknown>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await getWorkflowState();
    if (state.stage === 'selecting' && state.selection) return state;
    await sleep(500);
  }
  throw new Error('timeout waiting for overlay selection');
}

async function enablePolicy(): Promise<void> {
  const res = await post(`${STUDIO_URL}/settings/visual-review-policy`, {
    policy: 'local-sensitive-target-crop',
  });
  expect(res.status).toBe(200);
}

function findAbsolutePaths(obj: unknown, path = ''): string[] {
  if (!obj || typeof obj !== 'object') return [];
  const found: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (
      typeof v === 'string' &&
      (v.includes('C:\\') || v.includes('C:/') || v.startsWith('/Users/') || v.startsWith('/home/'))
    ) {
      found.push(`${path}${k}`);
    }
    if (v && typeof v === 'object') found.push(...findAbsolutePaths(v, `${path}${k}.`));
  }
  return found;
}

beforeAll(async () => {
  privacyProc = spawnProc('node', ['examples/privacy-app/server.cjs']);
  await waitForHttp(`${PRIVACY_URL}/`, 20000, 'privacy fixture');

  studioProc = spawnProc(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
    'tsx',
    'apps/studio/src/index.ts',
  ]);
  await waitForHttp(`${STUDIO_URL}/health`, 120000, 'Studio server');
}, 180000);

afterAll(() => {
  killTree(mcpProc);
  killTree(studioProc);
  killTree(privacyProc);
  // Hermetic settings: never leave an enabled review-artifact policy behind
  // for other E2E files (they boot Studio from the same CWD).
  try {
    fs.rmSync(join(ROOT, '.viskod', 'settings.json'), { force: true });
  } catch {
    /* best effort */
  }
});

describe('Phase 31 — visual review privacy boundary', () => {
  it('persists a local sensitive crop that never enters the agent-safe packet or handoff context', async () => {
    await enablePolicy();

    // Open the privacy fixture (synthetic secrets on the target surface).
    const nav = await post(`${STUDIO_URL}/navigate`, {
      url: `${PRIVACY_URL}/?viskodSimulate=click`,
    });
    expect(nav.status).toBe(200);

    const report = await post(`${STUDIO_URL}/workflow/report/start`, {});
    expect(report.status).toBe(200);

    const selected = await waitForSelection(20000);
    expect(selected.selection).toBeTruthy();

    const accept = await post(`${STUDIO_URL}/workflow/selection/accept`, {});
    expect(accept.status).toBe(200);

    // Prepare the handoff → the BEFORE baseline is captured now, before any
    // agent modification, and persists as a LOCAL SENSITIVE artifact.
    const handoff = await post(`${STUDIO_URL}/workflow/prepare`, {
      problem: 'Credentials section looks misaligned',
      expected: 'Credentials should align with the account settings card',
      severity: 'medium',
    });
    expect(handoff.status).toBe(200);
    const handoffState = (handoff.data as { state: Record<string, unknown> }).state;
    const issueId = handoffState.issueId as string;
    const handoffId = handoffState.handoffId as string;
    expect(issueId).toBeTruthy();
    expect(handoffId).toBeTruthy();

    // Baseline artifact exists and is explicitly sensitive/local-only.
    const baselineDir = join(ROOT, '.viskod', 'reviews', 'baselines', issueId);
    const baselineManifest = join(baselineDir, 'manifest.json');
    expect(fs.existsSync(baselineManifest)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(baselineManifest, 'utf-8'));
    expect(manifest.sensitive).toBe(true);
    expect(manifest.localOnly).toBe(true);
    expect(fs.existsSync(join(baselineDir, 'before.png'))).toBe(true);

    // Verify → recapture → real pixel comparison with local artifacts.
    const verifyStart = await post(`${STUDIO_URL}/workflow/verify/start`, {
      issueId,
      handoffId,
    });
    expect(verifyStart.status).toBe(200);
    const reviewId = (verifyStart.data as { state: Record<string, unknown> }).state
      .reviewId as string;
    expect(reviewId).toBeTruthy();

    const recapture = await post(`${STUDIO_URL}/workflow/verify/recapture`, { reviewId });
    expect(recapture.status).toBe(200);
    const reviewState = (recapture.data as { state: Record<string, unknown> }).state;
    expect(reviewState.stage).toBe('review_ready');

    // The persisted agent-safe ContextPacket: screenshots remain
    // omitted_sensitive — the raw target crop NEVER enters it.
    const review = await (await fetch(`${STUDIO_URL}/review/${reviewId}`)).json();
    expect(review.ok).toBe(true);
    const artifacts = (review as { review: { artifacts?: { before?: { artifactId?: string } } } })
      .review.artifacts;
    const beforeArtifactId = artifacts?.before?.artifactId;
    expect(beforeArtifactId).toMatch(/^art_[a-f0-9]{32}$/);

    // Locate the issue's persisted capture packet (durable capture store).
    const capturesDir = join(ROOT, '.viskod', 'captures');
    let packetJson = '';
    let foundPacket = false;
    const walk = (dir: string): void => {
      if (foundPacket || !fs.existsSync(dir)) return;
      for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
        if (name.isDirectory()) walk(join(dir, name.name));
        else if (name.name === 'packet.json' && !foundPacket) {
          foundPacket = true;
          packetJson = fs.readFileSync(join(dir, name.name), 'utf-8');
        }
      }
    };
    walk(capturesDir);
    expect(foundPacket).toBe(true);
    const packet = JSON.parse(packetJson) as {
      screenshots: Array<{ status?: string; path: string | null }>;
    };
    expect(packet.screenshots.length).toBeGreaterThan(0);
    expect(packet.screenshots[0]?.status).toBe('omitted_sensitive');
    expect(packet.screenshots[0]?.path).toBeNull();
    // The review artifact is never referenced by the agent-safe packet.
    expect(packetJson).not.toContain(beforeArtifactId as string);
    expect(packetJson).not.toContain('reviews/');

    // Studio state carries no absolute artifact paths.
    const studioState = (await (await fetch(`${STUDIO_URL}/state`)).json()) as unknown;
    expect(findAbsolutePaths(studioState)).toEqual([]);

    // Studio serves the image only through the protected opaque endpoint.
    const imgRes = await fetch(`${STUDIO_URL}/review/artifact/${beforeArtifactId}`);
    expect(imgRes.status).toBe(200);
    expect(imgRes.headers.get('content-type')).toContain('image/png');
    const traversal = await fetch(`${STUDIO_URL}/review/artifact/..%2F..%2Fsettings.json`);
    expect(traversal.status).toBe(404);
    const malformed = await fetch(`${STUDIO_URL}/review/artifact/art_bad`);
    expect(malformed.status).toBe(404);

    // Store ids for the fresh-MCP assertions.
    (globalThis as { __p31HandoffId?: string }).__p31HandoffId = handoffId;
  }, 180000);

  it('fresh MCP process reports screenshot omitted_sensitive with no review artifacts', async () => {
    const handoffId = (globalThis as { __p31HandoffId?: string }).__p31HandoffId;
    expect(handoffId).toBeTruthy();

    // A FRESH MCP process — no in-memory Studio state, only durable storage.
    mcpProc = spawnProc(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
      'tsx',
      'packages/cli/src/index.ts',
      'serve',
      '--url',
      PRIVACY_URL,
    ]);
    mcpProc.stdout?.on('data', (d: Buffer) => {
      mcpStdout += d.toString();
    });
    mcpProc.stderr?.on('data', (d: Buffer) => {
      mcpStderr += d.toString();
    });
    rpcSend({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const initResp = await rpcWait(120000);
    expect(initResp, `MCP initialize failed; stderr: ${mcpStderr.slice(-1000)}`).toBeTruthy();
    rpcSend({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const toolsResp = await rpcWait(30000);
    const tools =
      (toolsResp?.result as { tools?: Array<{ name: string }> } | undefined)?.tools ?? [];
    const names = tools.map((t) => t.name);
    expect(names).toContain('get_handoff_context');
    // MCP exposes NO mechanism to retrieve review images.
    expect(names.some((n) => n.includes('artifact') || n.includes('review_image'))).toBe(false);

    const context = parseToolText(await rpcCall('get_handoff_context', { handoffId }));
    expect(context).toBeTruthy();
    const json = JSON.stringify(context);
    expect(json).toContain('omitted_sensitive');
    expect(json).not.toContain('art_');
    expect(json).not.toContain('reviews/');
    expect(json).not.toContain('before.png');
    expect(json).not.toContain('C:');
    expect(json).not.toContain('/Users/');
    const captures = context?.captures as Array<{
      context?: { screenshot?: { status?: string } };
    }>;
    expect(captures[0]?.context?.screenshot?.status).toBe('omitted_sensitive');
  }, 180000);
});
