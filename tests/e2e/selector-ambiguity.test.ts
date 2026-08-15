import type { ChildProcess } from 'node:child_process';
import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STUDIO_URL, killTree, spawnProc, waitForHttp } from './harness';

/**
 * Phase 28A — bare selector ambiguity closure (real browser DOM).
 *
 * Proves the geometry trust contract end to end:
 * - a bare selector (no geometry) that matches multiple DOM elements is
 *   ALWAYS SELECTOR_AMBIGUOUS — even when the historical synthetic default
 *   box {0,0,100,100} has its center (50,50) inside exactly one match;
 * - explicit caller-provided geometry (trusted target evidence) MAY
 *   disambiguate to the single candidate containing the box center, but
 *   stays ambiguous when it covers multiple candidates;
 * - the real overlay path (Studio workflow) still resolves an
 *   overlay-generated selector that became non-unique when the persisted
 *   observed geometry uniquely identifies the intended element.
 *
 * The MCP assertions drive the actual stdio MCP server (viskod serve) over
 * JSON-RPC against a real Playwright Chromium page — the same path that
 * historically inserted the {0,0,100,100} default.
 */

const FIXTURE_URL = 'http://127.0.0.1:3221';

let fixtureProc: ChildProcess | null = null;
let mcpProc: ChildProcess | null = null;
let studioProc: ChildProcess | null = null;
let browser: Browser;
let page: Page;

// ---------------------------------------------------------------------------
// Minimal stdio JSON-RPC client for the MCP server
// ---------------------------------------------------------------------------

let mcpStdout = '';
let mcpStderr = '';
let parsedIndex = 0;

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
  id: number,
  timeoutMs = 120000,
): Promise<Record<string, unknown> | null> {
  rpcSend({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
  return rpcWait(timeoutMs);
}

interface ToolResult {
  ok: boolean;
  error?: string;
  tagName?: string;
}

function parseToolText(response: Record<string, unknown> | null): ToolResult | null {
  if (!response) return null;
  if (response.error) {
    const errObj = response.error as { message?: unknown };
    return { ok: false, error: String(errObj.message ?? 'rpc error') };
  }
  const content = (response.result as { content?: Array<{ text?: string }> } | undefined)?.content;
  const text = content?.[0]?.text;
  if (!text) return null;
  try {
    return JSON.parse(text) as ToolResult;
  } catch {
    return { ok: false, error: text };
  }
}

// ---------------------------------------------------------------------------
// Studio UI driver helpers (real rendered controls only)
// ---------------------------------------------------------------------------

async function openApp(url: string): Promise<void> {
  const sep = url.includes('?') ? '&' : '?';
  await page.fill('#app-url', `${url}${sep}viskodReset=1`);
  await page.click('#open-app-form button[type="submit"]');
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

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  fixtureProc = spawnProc('node', ['examples/selector-ambiguity-app/server.cjs']);
  await waitForHttp(`${FIXTURE_URL}/`, 20000, 'ambiguity fixture');

  mcpProc = spawnProc(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
    'tsx',
    'packages/cli/src/index.ts',
    'serve',
    '--url',
    FIXTURE_URL,
  ]);
  mcpProc.stdout?.on('data', (d: Buffer) => {
    mcpStdout += d.toString();
  });
  mcpProc.stderr?.on('data', (d: Buffer) => {
    mcpStderr += d.toString();
  });

  studioProc = spawnProc(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
    'tsx',
    'apps/studio/src/index.ts',
  ]);
  await waitForHttp(`${STUDIO_URL}/health`, 120000, 'Studio server');

  // Handshake. The MCP server processes stdin only after its startup
  // (browser launch + navigation) completes, so the initialize response
  // implicitly waits for real readiness.
  rpcSend({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  const initResp = await rpcWait(120000);
  expect(initResp, `MCP initialize failed; stderr: ${mcpStderr.slice(-1000)}`).toBeTruthy();
  rpcSend({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const toolsResp = await rpcWait(10000);
  const tools = (toolsResp?.result as { tools?: Array<{ name: string }> } | undefined)?.tools ?? [];
  expect(tools.map((t) => t.name)).toEqual(
    expect.arrayContaining(['viskod_select_element', 'viskod_capture_context']),
  );

  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${STUDIO_URL}/`, { waitUntil: 'domcontentloaded' });
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
});

// ---------------------------------------------------------------------------
// Phase 28A — bare selector contract against a real DOM
// ---------------------------------------------------------------------------

describe('Phase 28A — bare selector ambiguity closure (real browser DOM)', () => {
  it('bare selectors fail closed or resolve against the live DOM (MCP)', async () => {
    const missing = parseToolText(
      await rpcCall('viskod_select_element', { selector: '.no-such-element-xyz' }, 10),
    );
    expect(missing?.ok).toBe(false);
    expect(missing?.error).toContain('No element matches');

    const malformed = parseToolText(
      await rpcCall('viskod_select_element', { selector: 'div[' }, 11),
    );
    expect(malformed?.ok).toBe(false);
    expect(malformed?.error).toContain('not valid CSS');

    // THE Phase 28A regression: `.multi-card` matches two divs and the
    // historical synthetic default box {0,0,100,100} has center (50,50)
    // inside exactly one of them. Without trusted geometry the result MUST
    // still be SELECTOR_AMBIGUOUS, never a silent pick.
    const ambiguous = parseToolText(
      await rpcCall('viskod_select_element', { selector: '.multi-card' }, 12),
    );
    expect(ambiguous?.ok).toBe(false);
    expect(ambiguous?.error).toContain('multiple elements');

    const single = parseToolText(
      await rpcCall('viskod_select_element', { selector: '#unique-target' }, 13),
    );
    expect(single?.ok).toBe(true);
    expect(single?.tagName).toBe('button');
  });

  it('trusted caller-provided geometry uniquely identifies one candidate (MCP)', async () => {
    // Explicit geometry is trusted target evidence: center (50,50) is inside
    // exactly one `.multi-card`, so it MAY disambiguate.
    const resolved = parseToolText(
      await rpcCall(
        'viskod_select_element',
        { selector: '.multi-card', x: 0, y: 0, width: 100, height: 100 },
        14,
      ),
    );
    expect(resolved?.ok).toBe(true);
    expect(resolved?.tagName).toBe('div');
  });

  it('trusted geometry covering multiple candidates stays ambiguous (MCP)', async () => {
    // Both `.overlap-card` divs contain (50,50): the same trusted box cannot
    // pick a single candidate → SELECTOR_AMBIGUOUS.
    const ambiguous = parseToolText(
      await rpcCall(
        'viskod_select_element',
        { selector: '.overlap-card', x: 0, y: 0, width: 100, height: 100 },
        15,
      ),
    );
    expect(ambiguous?.ok).toBe(false);
    expect(ambiguous?.error).toContain('multiple elements');
  });

  it('viskod_capture_context applies the same contract (MCP)', async () => {
    const bareAmbiguous = parseToolText(
      await rpcCall('viskod_capture_context', { selector: '.multi-card' }, 16),
    );
    expect(bareAmbiguous?.ok).toBe(false);
    expect(bareAmbiguous?.error).toContain('multiple elements');

    const bareSingle = parseToolText(
      await rpcCall('viskod_capture_context', { selector: '#unique-target' }, 17),
    );
    expect(bareSingle?.ok).toBe(true);
  });

  it('overlay-originated non-unique selector still resolves via persisted geometry (Studio)', async () => {
    // The fixture dispatches overlay:element-clicked with the NON-unique
    // selector `.legacy-twin` plus the real observed rect {0,0,100,100}.
    // The accepted selection must still resolve to the intended element —
    // genuine overlay geometry remains legitimate evidence (Phase 21/28).
    await openApp(`${FIXTURE_URL}/?viskodSimulate=legacy`);
    await beginReport();
    await waitForSelectionEnabled();
    await acceptSelection();

    const res = await fetch(`${STUDIO_URL}/workflow/state`);
    const state = (await res.json()) as { stage?: string; selection?: unknown };
    expect(state.stage).toBe('describe');
    expect(state.selection).toBeTruthy();
  });
});
