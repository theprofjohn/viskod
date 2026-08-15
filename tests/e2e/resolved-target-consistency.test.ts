import type { ChildProcess } from 'node:child_process';
import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserRuntime } from '../../packages/browser-runtime/src/index';
import { VisualContextEngine } from '../../packages/context-engine/src/index';
import { EventBus } from '../../packages/event-bus/src/index';
import { STUDIO_URL, killTree, spawnProc, waitForHttp } from './harness';

/**
 * Phase 28B — RESOLVED TARGET = CAPTURED TARGET (real browser).
 *
 * The fixture serves two same-selector candidates:
 *
 *   #card-a  .duplicate-card  "FIRST CARD"  data-target="a"  in <section data-marker="parent-a"> at (0,0)
 *   #card-b  .duplicate-card  "SECOND CARD" data-target="b"  in <main data-marker="parent-b">  at (700,300)
 *
 * `querySelector('.duplicate-card')` returns A; trusted geometry
 * {700,300,220,120} uniquely identifies B. Every target-scoped evidence
 * field must describe B after resolution selects B — never the first
 * selector match.
 *
 * Test matrix:
 *  1. MCP select + capture (stored target) — packet evidence all from B.
 *  2. Direct VisualContextEngine over real Chromium — full packet: DOM text,
 *     attributes, hierarchy, styles, geometry, selected-element runtime
 *     evidence, and BrowserRuntime-level hierarchy parent markers.
 *  3. MCP select B → B detached before capture → typed detached failure;
 *     the capture must NOT silently re-resolve to A.
 *  4. Studio review recapture — persisted non-unique selector + persisted
 *     trusted geometry → after snapshot evidence from B.
 */

const FIXTURE_URL = 'http://127.0.0.1:3221';
const B_BOX = { x: 700, y: 300, width: 220, height: 120 };

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

interface ToolResult {
  ok: boolean;
  isError?: boolean;
  error?: string;
  [key: string]: unknown;
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

async function prepareHandoff(): Promise<void> {
  await page.fill('#problem', 'Phase 28B recapture consistency');
  await page.fill('#expected', 'The captured target must be candidate B');
  await page.click('#issue-form button[type="submit"]');
  await page.waitForSelector('[data-stage="handoff_ready"]', { timeout: 30000 });
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
): Promise<{
  status: number;
  data: Record<string, unknown>;
}> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
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
// Phase 28B — resolved target evidence consistency
// ---------------------------------------------------------------------------

describe('Phase 28B — resolved target evidence consistency (real browser)', () => {
  it('MCP select + capture: every target-scoped field describes B after geometry disambiguation', async () => {
    const selected = parseToolText(
      await rpcCall('viskod_select_element', {
        selector: '.duplicate-card',
        x: B_BOX.x,
        y: B_BOX.y,
        width: B_BOX.width,
        height: B_BOX.height,
      }),
    );
    expect(selected?.ok).toBe(true);
    expect(selected?.tagName).toBe('div');
    // Selection snapshot geometry must describe B, not A.
    const selBox = selected?.boundingBox as { x?: number; y?: number } | undefined;
    expect(selBox?.x).toBe(700);
    expect(selBox?.y).toBe(300);

    const capture = parseToolText(await rpcCall('viskod_capture_context', {}));
    expect(capture?.ok).toBe(true);
    const respJson = JSON.stringify(capture);

    // DOM text from B.
    expect(capture?.selection && (capture.selection as { text?: string }).text).toContain(
      'SECOND CARD',
    );
    // Attributes contain data-target=b.
    const domAttrs = (capture?.dom as { attributes?: Record<string, string> } | undefined)
      ?.attributes;
    expect(domAttrs?.['data-target']).toBe('b');
    expect(domAttrs?.id).toBe('card-b');
    // Hierarchy from B: parent is <main> (B's parent), not <section> (A's).
    const parents = (capture?.hierarchy as { parents?: string[] } | undefined)?.parents;
    expect(parents?.[0]).toBe('main');
    expect(parents).not.toContain('section');
    // Computed styles match B (amber card), not A (blue card).
    const computed = (capture?.styles as Record<string, string> | undefined) ?? {};
    expect(computed.backgroundColor).toContain('255, 233, 168');
    expect(computed.color).toContain('122, 74, 0');
    // Geometry matches B.
    const pktBox = (capture?.selection as { boundingBox?: { x?: number; y?: number } } | undefined)
      ?.boundingBox;
    expect(pktBox?.x).toBe(700);
    expect(pktBox?.y).toBe(300);
    // No A markers anywhere in the captured evidence.
    expect(respJson).not.toContain('FIRST CARD');
    expect(respJson).not.toContain('card-a');
    expect(respJson).not.toContain('parent-a');
    expect(respJson).not.toContain('data-target":"a');
  });

  it('direct VCE over real Chromium: full packet evidence all from B', async () => {
    const runtime = new BrowserRuntime(new EventBus());
    const vce = new VisualContextEngine({ browserRuntime: runtime, eventBus: new EventBus() });
    const handle = await vce.startBrowser();
    expect(handle.ok).toBe(true);
    try {
      await vce.navigate(`${FIXTURE_URL}/`);
      const result = await vce.generatePacket({
        selector: '.duplicate-card',
        boundingBox: B_BOX,
        source: 'automation',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const packet = result.value;

      // DOM snapshot from B.
      expect(packet.selection.text).toContain('SECOND CARD');
      expect(packet.dom.attributes['data-target']).toBe('b');
      expect(packet.dom.attributes.id).toBe('card-b');
      expect(packet.dom.tagName).toBe('div');

      // Geometry from B.
      expect(packet.selection.boundingBox.x).toBe(700);
      expect(packet.selection.boundingBox.y).toBe(300);

      // Hierarchy from B's parent (tagName main; A's parent is section).
      expect(packet.hierarchy.parents[0]?.tagName).toBe('main');
      expect(packet.hierarchy.parents.some((p) => p.tagName === 'section')).toBe(false);

      // Computed styles from B.
      expect(packet.styles.computed.backgroundColor).toContain('255, 233, 168');
      expect(packet.styles.computed.color).toContain('122, 74, 0');

      // Selected-element runtime evidence from B.
      const selectedElement = packet.runtimeEvidence?.selectedElement;
      expect(selectedElement).toBeTruthy();
      expect(selectedElement?.text).toContain('SECOND CARD');
      expect(selectedElement?.attributes?.['data-target']).toBe('b');
      expect(selectedElement?.boundingBox?.x).toBe(700);
      expect(selectedElement?.boundingBox?.y).toBe(300);

      // No A markers anywhere in the packet.
      const packetJson = JSON.stringify(packet);
      expect(packetJson).not.toContain('FIRST CARD');
      expect(packetJson).not.toContain('card-a');
      expect(packetJson).not.toContain('parent-a');

      // BrowserRuntime-level hierarchy exposes B's parent marker text.
      if (!handle.ok) return;
      const ref = await runtime.resolveElement(handle.value, '.duplicate-card', B_BOX);
      expect(ref.ok).toBe(true);
      if (ref.ok && ref.value.status === 'resolved') {
        const hierarchy = await runtime.getElementHierarchy(handle.value, ref.value);
        expect(hierarchy.ok).toBe(true);
        if (hierarchy.ok) {
          const parentText = hierarchy.value.parents[0]?.text ?? '';
          expect(parentText).toContain('SECOND CARD');
          expect(parentText).not.toContain('FIRST CARD');
        }
        await runtime.releaseElement(ref.value);
      }
    } finally {
      await vce.stopBrowser();
    }
  });

  it('detached resolved element: every collector returns a typed failure, never A', async () => {
    const runtime = new BrowserRuntime(new EventBus());
    const launch = await runtime.launch();
    expect(launch.ok).toBe(true);
    if (!launch.ok) return;
    const handle = launch.value;
    try {
      await runtime.navigate(handle, `${FIXTURE_URL}/`);
      const resolution = await runtime.resolveElement(handle, '.duplicate-card', B_BOX);
      expect(resolution.ok).toBe(true);
      if (!resolution.ok || resolution.value.status !== 'resolved') return;
      const ref = resolution.value;
      // Sanity: the resolved element is B, not the first selector match.
      const id = await ref.element.getAttribute('id');
      expect(id).toBe('card-b');

      // Detach B deterministically between resolution and collection.
      await runtime.evaluate(
        handle,
        () => {
          document.querySelector('#card-b')?.remove();
        },
        null,
      );

      // Every element-scoped collector fails typed — the capture must never
      // fall back to candidate A (the only remaining .duplicate-card match).
      const dom = await runtime.getDOMSnapshot(handle, ref);
      expect(dom.ok).toBe(false);
      if (!dom.ok) expect(dom.error.code).toBe('BR_ELEMENT_DETACHED');
      const hierarchy = await runtime.getElementHierarchy(handle, ref);
      expect(hierarchy.ok).toBe(false);
      if (!hierarchy.ok) expect(hierarchy.error.code).toBe('BR_ELEMENT_DETACHED');
      const styles = await runtime.getComputedStyles(handle, ref);
      expect(styles.ok).toBe(false);
      if (!styles.ok) expect(styles.error.code).toBe('BR_ELEMENT_DETACHED');
      const info = await runtime.getSelectedElementInfo(handle, ref);
      expect(info.ok).toBe(false);
      if (!info.ok) expect(info.error.code).toBe('BR_ELEMENT_DETACHED');

      await runtime.releaseElement(ref);
    } finally {
      await runtime.shutdown(handle);
    }
  });

  it('MCP: B detached after resolution → capture fails typed, never falls back to A', async () => {
    // Navigate the MCP browser to the detach page: #card-b is removed after
    // 4s. Select must resolve B first (trusted geometry), then capture must
    // fail because the RESOLVED element is gone — querySelector would now
    // match only A.
    const nav = parseToolText(
      await rpcCall('viskod_navigate', {
        url: `${FIXTURE_URL}/?viskodDetachDuplicateB=1&detachDelay=4000`,
      }),
    );
    expect(nav).toBeTruthy();

    const selected = parseToolText(
      await rpcCall('viskod_select_element', {
        selector: '.duplicate-card',
        x: B_BOX.x,
        y: B_BOX.y,
        width: B_BOX.width,
        height: B_BOX.height,
      }),
    );
    expect(selected?.ok).toBe(true);

    // Wait for the detachment to fire.
    await new Promise((r) => setTimeout(r, 6000));

    const capture = parseToolText(await rpcCall('viskod_capture_context', {}));
    // Pre-fix this succeeds with A evidence; post-fix it must be a typed
    // detached failure.
    expect(capture?.ok).toBe(false);
    expect(String(capture?.error)).toMatch(/attached|removed|detached|stale/i);
  });

  it('Studio review recapture: persisted non-unique selector + trusted geometry recaptures B', async () => {
    await openApp(`${FIXTURE_URL}/?viskodSimulate=dup`);
    await beginReport();
    await waitForSelectionEnabled();
    await acceptSelection();
    await prepareHandoff();

    // Start verification, then recapture with reload (like the UI action).
    const stateRes = await fetch(`${STUDIO_URL}/workflow/state`);
    const state = (await stateRes.json()) as Record<string, unknown>;
    const handoffId = state.handoffId as string;
    const issueId = state.issueId as string;
    expect(handoffId).toBeTruthy();
    expect(issueId).toBeTruthy();

    const verify = await postJson(`${STUDIO_URL}/workflow/verify/start`, {
      issueId,
      handoffId,
    });
    expect(verify.status).toBe(200);
    const verifyState = verify.data.state as Record<string, unknown>;
    const reviewId = verifyState.reviewId as string;
    expect(reviewId).toBeTruthy();

    const recapture = await postJson(`${STUDIO_URL}/workflow/verify/recapture`, {
      reviewId,
    });
    expect(recapture.status).toBe(200);
    const afterState = recapture.data.state as {
      stage?: string;
      review?: {
        after?: {
          targetSummary?: { textPreview?: string; resolutionStatus?: string };
        };
      };
    };
    expect(afterState.stage).toBe('review_ready');
    const afterSummary = afterState.review?.after?.targetSummary;
    expect(afterSummary?.resolutionStatus).toBe('resolved');
    // Recaptured evidence must describe B (SECOND CARD), never A.
    expect(afterSummary?.textPreview).toContain('SECOND CARD');
    expect(afterSummary?.textPreview).not.toContain('FIRST CARD');
  });
});
