import type { ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROOT, killTree, spawnProc, waitForHttp } from './harness';

/**
 * Phase 33A — real product workspace E2E (task 10).
 *
 * A REAL workspace is generated at test runtime:
 *
 *   <tmp>/repo/
 *     package.json
 *     pnpm-workspace.yaml
 *     apps/web/            (served app + page source importing the ui package)
 *     packages/ui/         (shared package — the target source)
 *
 * Flow:
 *   1. Studio (with --project-root <repo>) runs the rendered workflow:
 *      select → capture → source resolution → handoff.
 *      Assert the repository-relative `packages/ui/...` candidate and the
 *      Phase 33A workspace status (isWorkspace + packageCount).
 *   2. Studio is STOPPED.
 *   3. A FRESH MCP process starts with NO project scan (cwd = <repo>, no
 *      --project-root).
 *   4. get_handoff_context(handoffId) returns the PERSISTED candidate,
 *      qualification, reasons, order and resolution — identical and never
 *      recomputed (resolutionSource = 'persisted').
 *
 * All storage lives in <repo>/.viskod (process-cwd based), so the fresh MCP
 * resolves the same durable artifacts without any in-memory state.
 */

const WS_URL = 'http://127.0.0.1:3333';
const TARGET_TEXT = 'Order summary checkout widget status';
const UI_PACKAGE_CANDIDATE = 'packages/ui/src/CheckoutCard.jsx';

let wsRoot = '';
let fixtureProc: ChildProcess | null = null;
let studioProc: ChildProcess | null = null;
let mcpProc: ChildProcess | null = null;
let browser: Browser;
let page: Page;
let handoffId = '';
let persistedCandidatePath = '';
let persistedQualification = '';
let persistedResolution = '';
let persistedReasons: string[] = [];
let persistedOrder: string[] = [];

let mcpStdout = '';
let mcpStderr = '';
let parsedIndex = 0;

// ---------------------------------------------------------------------------
// Real workspace fixture (deterministic, generated at test runtime)
// ---------------------------------------------------------------------------

function createWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viskod-phase33a-e2e-'));
  const repo = path.join(root, 'repo');
  const web = path.join(repo, 'apps/web');
  const ui = path.join(repo, 'packages/ui');
  fs.mkdirSync(path.join(web, 'src/pages'), { recursive: true });
  fs.mkdirSync(path.join(ui, 'src'), { recursive: true });

  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'phase33a-e2e-root', private: true, version: '1.0.0' }, null, 2),
  );
  fs.writeFileSync(
    path.join(repo, 'pnpm-workspace.yaml'),
    'packages:\n  - "apps/*"\n  - "packages/*"\n',
  );
  fs.writeFileSync(
    path.join(web, 'package.json'),
    JSON.stringify(
      {
        name: '@acme/web',
        version: '1.0.0',
        dependencies: { '@acme/ui': 'workspace:*' },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(ui, 'package.json'),
    JSON.stringify({ name: '@acme/ui', version: '1.0.0' }, null, 2),
  );

  // The target source lives ONLY in the shared package.
  fs.writeFileSync(
    path.join(ui, 'src/CheckoutCard.jsx'),
    [
      '// Phase 33A e2e — the target source lives in the shared ui package.',
      'export function CheckoutCard() {',
      `  return <div className="checkout-card" data-component="CheckoutCard">${TARGET_TEXT}</div>;`,
      '}',
      '',
    ].join('\n'),
  );
  // The web page source imports the shared package but does NOT contain the
  // target text literal (the rendered DOM carries it, the web source does not).
  fs.writeFileSync(
    path.join(web, 'src/pages/CheckoutPage.jsx'),
    [
      "import { CheckoutCard } from '@acme/ui/CheckoutCard';",
      '// Phase 33A e2e — the page renders the shared card component.',
      'export function CheckoutPage() {',
      '  return <main><CheckoutCard /></main>;',
      '}',
      '',
    ].join('\n'),
  );

  // Served HTML + overlay auto-selection (same deterministic mechanism as the
  // phase12 fixture: dispatch overlay:element-clicked once the overlay is
  // ready).
  fs.writeFileSync(
    path.join(web, 'index.html'),
    `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Phase 33A workspace e2e</title></head>
<body>
  <main id="app">
    <div class="checkout-card" data-component="CheckoutCard" data-testid="checkout-card">
      <h2>Checkout</h2>
      <p class="checkout-description">${TARGET_TEXT}</p>
    </div>
  </main>
  <script src="/main.js"></script>
</body>
</html>
`,
  );
  fs.writeFileSync(
    path.join(web, 'main.js'),
    `(() => {
  if (new URLSearchParams(location.search).get('viskodReset')) sessionStorage.clear();
  const simulate = new URLSearchParams(location.search).get('viskodSimulate');
  let dispatched = false;
  window.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.source !== '__viskod_overlay' || data.type !== 'overlay:ready') return;
    if (dispatched) return;
    dispatched = true;
    setTimeout(() => {
      if (sessionStorage.getItem('viskodSimulatedDone')) return;
      sessionStorage.setItem('viskodSimulatedDone', '1');
      const el = document.querySelector('[data-testid="' + simulate + '"]');
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const textPreview = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120);
      window.postMessage({
        source: '__viskod_overlay',
        type: 'overlay:element-clicked',
        data: {
          tagName: 'div',
          boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          role: undefined,
          accessibleName: undefined,
          textPreview,
          isInteractive: false,
          selector: '[data-testid="' + simulate + '"]',
          documentOrder: 1,
          selectionNumber: 1,
        },
      }, '*');
    }, 1500);
  });
})();
`,
  );
  fs.writeFileSync(
    path.join(web, 'server.cjs'),
    `#!/usr/bin/env node
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const WEB = __dirname;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  const file = url === '/' ? '/index.html' : url;
  const full = path.join(WEB, file);
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(3333, '127.0.0.1', () => {
  console.log('Phase 33A workspace e2e fixture on http://127.0.0.1:3333');
});
`,
  );
  return repo;
}

// ---------------------------------------------------------------------------
// RPC helpers (fresh MCP over stdio JSON-RPC)
// ---------------------------------------------------------------------------

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

let rpcId = 100;
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

// ---------------------------------------------------------------------------
// Studio UI drivers (real rendered controls only)
// ---------------------------------------------------------------------------

async function openApp(url: string): Promise<void> {
  const sep = url.includes('?') ? '&' : '?';
  const res = await fetch('http://127.0.0.1:3001/navigate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `${url}${sep}viskodReset=1` }),
  });
  expect(res.ok).toBe(true);
  await page.goto('http://127.0.0.1:3001/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#report-start', { timeout: 30000 });
}

async function beginReport(): Promise<void> {
  await page.click('#report-start');
  await page.waitForSelector('[data-stage="selecting"]');
}

async function waitForSelectionEnabled(timeoutMs = 30000): Promise<void> {
  await page.waitForSelector('#selection-accept:not([disabled])', { timeout: timeoutMs });
}

async function acceptSelection(): Promise<void> {
  await page.click('#selection-accept');
  await page.waitForSelector('[data-stage="describe"]', { timeout: 30000 });
}

async function prepareHandoff(problem: string, expected: string): Promise<void> {
  await page.fill('#problem', problem);
  await page.fill('#expected', expected);
  await page.click('#issue-form button[type="submit"]');
  await page.waitForSelector('[data-stage="handoff_ready"]', { timeout: 30000 });
}

async function getWorkflowState(): Promise<Record<string, unknown>> {
  const res = await fetch('http://127.0.0.1:3001/workflow/state');
  return (await res.json()) as Record<string, unknown>;
}

async function waitForStudioReady(timeoutMs = 120000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const health = (await (await fetch('http://127.0.0.1:3001/health')).json()) as {
        browserConnected?: boolean;
      };
      if (health.browserConnected === true) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('timeout waiting for Studio browser-ready');
}

async function stopStudioAndWaitForPort(): Promise<void> {
  killTree(studioProc);
  const start = Date.now();
  while (Date.now() - start < 30000) {
    try {
      await fetch('http://127.0.0.1:3001/health');
    } catch {
      return; // connection refused → port released
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('timeout waiting for Studio port release');
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  wsRoot = createWorkspace();
  fixtureProc = spawnProc('node', [path.join(wsRoot, 'apps/web/server.cjs')]);
  await waitForHttp(`${WS_URL}/`, 20000, 'workspace fixture');

  studioProc = spawnProc(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['tsx', path.join(ROOT, 'apps/studio/src/index.ts'), '--project-root', wsRoot],
    { cwd: wsRoot },
  );
  await waitForHttp('http://127.0.0.1:3001/health', 120000, 'Studio server');
  await waitForStudioReady(120000);

  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
}, 240000);

afterAll(async () => {
  if (browser) await browser.close().catch(() => undefined);
  if (mcpProc) {
    try {
      mcpProc.stdin?.end();
    } catch {
      /* already closed */
    }
  }
  killTree(studioProc);
  killTree(mcpProc);
  killTree(fixtureProc);
  if (wsRoot) fs.rmSync(path.dirname(wsRoot), { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Phase 33A: Studio workflow on a real workspace
// ---------------------------------------------------------------------------

describe('Phase 33A — real workspace Studio workflow', () => {
  it('Studio reports the workspace status (isWorkspace + package count)', async () => {
    const state = (await (await fetch('http://127.0.0.1:3001/state')).json()) as {
      project?: {
        status: string;
        scan?: string;
        workspace?: { isWorkspace: boolean; packageCount: number } | null;
      };
    };
    expect(state.project?.status).toBe('ready');
    expect(state.project?.scan).toBe('ready');
    expect(state.project?.workspace).toEqual({ isWorkspace: true, packageCount: 2 });
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain('C:\\');
    expect(serialized).not.toContain('/home/');
  });

  it('select → capture → source resolution → handoff yields a packages/ui candidate', async () => {
    await openApp(`${WS_URL}/?viskodSimulate=checkout-card`);
    await beginReport();
    await waitForSelectionEnabled();
    await acceptSelection();
    await prepareHandoff(
      'Phase 33A workspace source resolution',
      'The agent must receive the shared ui package candidate',
    );

    const state = await getWorkflowState();
    handoffId = state.handoffId as string;
    expect(handoffId).toMatch(/^handoff_/);

    // Source resolution: repository-relative packages/ui/... candidate.
    const source = state.source as {
      resolution: string;
      candidates: Array<{ path: string; qualification: string }>;
    };
    expect(source.candidates.length).toBeGreaterThan(0);
    const candidate = source.candidates[0];
    expect(candidate?.path).toBe(UI_PACKAGE_CANDIDATE);
    expect(['possible', 'probable', 'exact']).toContain(candidate?.qualification);
    const stateJson = JSON.stringify(state);
    expect(stateJson).not.toContain('C:\\');
    expect(stateJson).not.toContain('/home/');
  });

  it('the persisted capture carries the packages/ui candidate and resolution', () => {
    const handoffsDir = path.join(wsRoot, '.viskod', 'handoffs', handoffId);
    expect(fs.existsSync(handoffsDir)).toBe(true);
    const handoff = JSON.parse(
      fs.readFileSync(path.join(handoffsDir, 'handoff.json'), 'utf-8'),
    ) as {
      context?: { packetRefs?: Array<{ captureId?: string }> };
      brief?: {
        sourceHints?: {
          resolution?: string;
          topHints?: Array<{ displayName?: string; qualification?: string; reasons?: string[] }>;
        };
      };
    };
    const captureId = handoff.context?.packetRefs?.[0]?.captureId;
    expect(captureId).toBeTruthy();
    const captureDir = path.join(wsRoot, '.viskod', 'captures', captureId ?? '__none__');
    expect(fs.existsSync(captureDir)).toBe(true);

    const packet = JSON.parse(fs.readFileSync(path.join(captureDir, 'packet.json'), 'utf-8')) as {
      sourceHints?: Array<{
        filePath?: string;
        qualification?: string;
        reasons?: string[];
        confidence?: number;
      }>;
      sourceHintsResolution?: { status?: string; topCandidate?: string };
    };
    const hint = packet.sourceHints?.[0];
    expect(hint?.filePath).toBe(UI_PACKAGE_CANDIDATE);
    expect(hint?.qualification).toBeTruthy();
    expect(packet.sourceHintsResolution?.topCandidate).toBe(UI_PACKAGE_CANDIDATE);
    persistedCandidatePath = hint?.filePath ?? '';
    persistedQualification = hint?.qualification ?? '';
    persistedResolution = packet.sourceHintsResolution?.status ?? '';
    persistedReasons = hint?.reasons ?? [];
    persistedOrder = (packet.sourceHints ?? []).map((h) => h.filePath ?? '');
  });
});

// ---------------------------------------------------------------------------
// Phase 33A: fresh MCP (no project scan) retrieves the persisted result
// ---------------------------------------------------------------------------

describe('Phase 33A — fresh MCP persistence (no recomputation)', () => {
  it('Studio is stopped before the fresh MCP starts', async () => {
    await stopStudioAndWaitForPort();
    studioProc = null;
    expect(true).toBe(true);
  });

  it('starts a fresh MCP server with NO project scan (cwd = workspace, no --project-root)', async () => {
    mcpProc = spawnProc(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['tsx', path.join(ROOT, 'packages/cli/src/index.ts'), 'serve', '--url', WS_URL],
      { cwd: wsRoot },
    );
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
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['get_handoff_context', 'get_agent_handoff']),
    );
  });

  it('get_handoff_context returns the identical persisted candidate, never recomputed', async () => {
    const ctxResp = parseToolText(await rpcCall('get_handoff_context', { handoffId }));
    expect(ctxResp?.ok).toBe(true);
    const captures = ctxResp?.captures as Array<{
      context: {
        sourceHints: {
          status: string;
          resolution: string;
          resolutionSource: string;
          count: number;
          candidates: Array<{
            path: string;
            qualification: string;
            confidence: number;
            reasons: string[];
          }>;
        };
      };
    }>;
    expect(captures).toHaveLength(1);
    const sh = captures?.[0]?.context.sourceHints;
    expect(sh).toBeTruthy();
    if (!sh) return;

    // Persisted, not recomputed: the fresh process has NO project scan.
    expect(sh.resolutionSource).toBe('persisted');
    // Identical resolution, qualification, path and reasons.
    expect(sh.resolution).toBe(persistedResolution);
    const candidate = sh.candidates[0];
    expect(candidate?.path).toBe(persistedCandidatePath);
    expect(candidate?.path).toBe(UI_PACKAGE_CANDIDATE);
    expect(candidate?.qualification).toBe(persistedQualification);
    expect(candidate?.reasons).toEqual(persistedReasons);
    // Identical order.
    expect(sh.candidates.map((c) => c.path)).toEqual(persistedOrder);

    const respJson = JSON.stringify(ctxResp);
    expect(respJson).not.toContain('C:\\');
    expect(respJson).not.toContain('/home/');
    expect(respJson).not.toContain('viskod/captures');
  });
});
