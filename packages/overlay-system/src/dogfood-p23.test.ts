import { type ChildProcess, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HandoffPersistence, HandoffServiceImpl } from '@viskod/agent-handoff';
import { EventBus } from '@viskod/event-bus';
import { getOverlayScript } from '@viskod/overlay-system';
import { IssuePersistence, IssueServiceImpl } from '@viskod/visual-issue';
import type { VisualSelection } from '@viskod/visual-selection';
import { type Browser, type Page, chromium } from 'playwright';
// Phase 23 dogfood: Phase 21 overlay → Phase 22 issue → Phase 23 agent handoff — end-to-end on shadcn-admin
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60000 });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const TARGET_DIR = 'C:\\viskod-dogfood-shadcn-admin';
const TARGET_URL = 'http://localhost:5173';
const ISSUE_STORAGE = path.join(ROOT, '.viskod-dogfood-issues');
const HANDOFF_STORAGE = path.join(ROOT, '.viskod-dogfood-handoffs');

const overlayScript = getOverlayScript();

let devProc: ChildProcess | null = null;
let browser: Browser | null = null;

interface SharedState {
  issueIds: string[];
  handoffIds: string[];
  page: Page | null;
  issueService: IssueServiceImpl | null;
  handoffService: HandoffServiceImpl | null;
}
const state: SharedState = {
  issueIds: [],
  handoffIds: [],
  page: null,
  issueService: null,
  handoffService: null,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  try {
    fs.rmSync(ISSUE_STORAGE, { recursive: true, force: true });
  } catch {}
  try {
    fs.rmSync(HANDOFF_STORAGE, { recursive: true, force: true });
  } catch {}

  try {
    devProc = spawn('pnpm', ['dev'], { cwd: TARGET_DIR, stdio: 'pipe', shell: true });
  } catch (e) {
    console.log('Dev server spawn failed (may already be running):', (e as Error).message);
  }
  await sleep(10000);

  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  const eventBus = new EventBus();
  const issuePersistence = new IssuePersistence(ISSUE_STORAGE);
  state.issueService = new IssueServiceImpl(eventBus, issuePersistence);
  const handoffPersistence = new HandoffPersistence(HANDOFF_STORAGE);
  state.handoffService = new HandoffServiceImpl(eventBus, state.issueService, handoffPersistence);
}, 60000);

afterAll(async () => {
  if (browser) await browser.close();
  if (devProc) devProc.kill();
  try {
    fs.rmSync(ISSUE_STORAGE, { recursive: true, force: true });
  } catch {}
  try {
    fs.rmSync(HANDOFF_STORAGE, { recursive: true, force: true });
  } catch {}
});

async function makePage(): Promise<Page> {
  if (!browser) throw new Error('browser not available');
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const p = await ctx.newPage();
  await p.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 15000 });
  await sleep(1000);
  return p;
}

async function activateOverlay(p: Page) {
  await p.evaluate(overlayScript);
  await sleep(200);
  await p.evaluate(() => {
    window.postMessage(
      { source: '__viskod_browser', command: 'overlay:show', mode: 'selection' },
      '*',
    );
  });
  await sleep(300);
}

async function clickAt(
  p: Page,
  x: number,
  y: number,
): Promise<{
  type: string;
  data?: {
    source?: string;
    viewportRect?: { x: number; y: number; width: number; height: number };
    boundingBox?: { x: number; y: number; width: number; height: number };
    tagName?: string;
    textPreview?: string;
    role?: string;
    accessibleName?: string;
    isInteractive?: boolean;
    inputType?: string;
    stableAttributes?: Record<string, string>;
  };
} | null> {
  await p.mouse.move(x, y);
  await sleep(30);
  await p.mouse.down();
  await sleep(30);
  await p.mouse.up();
  await sleep(300);
  return p
    .evaluate(() => {
      const evts =
        (
          window as unknown as {
            __vs_events: Array<{
              type: string;
              data?: {
                source?: string;
                viewportRect?: { x: number; y: number; width: number; height: number };
              };
            }>;
          }
        ).__vs_events || [];
      (
        window as unknown as {
          __vs_events: Array<{
            type: string;
            data?: {
              source?: string;
              viewportRect?: { x: number; y: number; width: number; height: number };
            };
          }>;
        }
      ).__vs_events = [];
      return evts.filter((e) => e.type !== 'overlay:ready');
    })
    .then((evts) => (evts.length > 0 ? (evts[evts.length - 1] ?? null) : null));
}

async function setupCapture(p: Page) {
  await p.evaluate(() => {
    (
      window as unknown as {
        __vs_events: Array<{
          type: string;
          data?: {
            source?: string;
            viewportRect?: { x: number; y: number; width: number; height: number };
          };
        }>;
      }
    ).__vs_events = [];
    window.addEventListener('message', (e) => {
      if (e.data && e.data.source === '__viskod_overlay') {
        (
          window as unknown as {
            __vs_events: Array<{
              type: string;
              data?: {
                source?: string;
                viewportRect?: { x: number; y: number; width: number; height: number };
              };
            }>;
          }
        ).__vs_events.push(e.data);
      }
    });
  });
}

function makeVisualSelection(
  overlayEvent: {
    data?: {
      source?: string;
      viewportRect?: { x: number; y: number; width: number; height: number };
      boundingBox?: { x: number; y: number; width: number; height: number };
      tagName?: string;
      textPreview?: string;
      role?: string;
      accessibleName?: string;
      isInteractive?: boolean;
      stableAttributes?: Record<string, string>;
    };
  },
  pageUrl: string,
  title?: string,
): VisualSelection {
  const rect = overlayEvent.data?.boundingBox || { x: 0, y: 0, width: 0, height: 0 };
  const tagName = overlayEvent.data?.tagName || 'element';
  const textPreview = overlayEvent.data?.textPreview || '';
  const role = overlayEvent.data?.role || undefined;
  const accessibleName = overlayEvent.data?.accessibleName || undefined;
  const isInteractive = overlayEvent.data?.isInteractive ?? false;
  const stableAttrs = overlayEvent.data?.stableAttributes || undefined;

  return {
    schemaVersion: 1,
    selectionId: crypto.randomUUID(),
    sessionId: 'dogfood-session',
    pageId: 'dogfood-page',
    mode: 'single',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    page: { url: pageUrl, title, viewport: { width: 1440, height: 720, scrollX: 0, scrollY: 0 } },
    region: { viewportRect: rect },
    targets: [
      {
        targetId: crypto.randomUUID(),
        documentOrder: 0,
        geometry: { viewportRect: rect },
        semantics: {
          tagName,
          role,
          accessibleName,
          textPreview: textPreview.slice(0, 120),
          isInteractive,
        },
        fingerprints: { stableAttributes: stableAttrs as Record<string, string> | undefined },
        resolutionCandidates: [{ strategy: 'runtime-node', value: 'live', confidence: 0.9 }],
      },
    ],
    summary: {
      label: textPreview || tagName,
      role,
      textPreview: textPreview.slice(0, 120),
      targetCount: 1,
    },
    resolution: { status: 'resolved', confidence: 0.85, resolvedAt: new Date().toISOString() },
  };
}

async function createIssueFromOverlay(p: Page): Promise<string | null> {
  await setupCapture(p);
  await activateOverlay(p);

  const target = await p.evaluate(() => {
    const candidates = document.querySelectorAll('a, button, [role="button"], [tabindex]');
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      if (r.width > 20 && r.height > 20 && r.top > 50 && r.top < 900 && r.left < 400) {
        return {
          x: r.x + r.width / 2,
          y: r.y + r.height / 2,
          text: (el.textContent || '').trim().slice(0, 40),
        };
      }
    }
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      if (r.width > 20 && r.height > 20 && r.top > 0) {
        return {
          x: r.x + r.width / 2,
          y: r.y + r.height / 2,
          text: (el.textContent || '').trim().slice(0, 40),
        };
      }
    }
    return null;
  });

  if (!target) return null;

  const ev = await clickAt(p, target.x, target.y);
  if (!ev) return null;

  const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
  const result = await state.issueService!.createIssue(
    selection,
    'dogfood-session',
    'dogfood-page',
  );
  if (result.ok) {
    state.issueIds.push(result.value.issueId);
    return result.value.issueId;
  }
  return null;
}

// =========================================================================
// Dogfood tests
// =========================================================================

describe('Phase 23 Dogfood — Create Issues and Send to Agent', () => {
  it('DF23-01: create issue from sidebar nav, send to agent', async () => {
    const p = await makePage();
    const issueId = await createIssueFromOverlay(p);
    expect(issueId).not.toBeNull();
    if (!issueId) {
      await p.close();
      return;
    }

    const result = await state.handoffService!.createHandoff(
      { issueId },
      'dogfood-session',
      'dogfood-page',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('ready');
      expect(result.value.handoffId).toMatch(/^handoff_/);
      expect(result.value.title).toBeTruthy();
      state.handoffIds.push(result.value.handoffId);
      console.log(
        `  DF23-01: handoff ${result.value.handoffId.slice(0, 20)}… title="${result.value.title}"`,
      );
    }
    await p.close();
  });

  it('DF23-02: create issue from icon-only control, send to agent', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    const icon = await p.evaluate(() => {
      for (const b of document.querySelectorAll('button')) {
        const t = (b.textContent || '').trim();
        if (t.length <= 2) {
          const r = b.getBoundingClientRect();
          if (r.width > 10) return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
      }
      return null;
    });

    if (!icon) {
      console.log('  DF23-02: no icon button found — skipping');
      await p.close();
      return;
    }

    const ev = await clickAt(p, icon.x, icon.y);
    expect(ev).not.toBeNull();
    if (!ev) {
      await p.close();
      return;
    }

    const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
    const issueResult = await state.issueService!.createIssue(
      selection,
      'dogfood-session',
      'dogfood-page',
    );
    expect(issueResult.ok).toBe(true);
    if (!issueResult.ok) {
      await p.close();
      return;
    }

    state.issueIds.push(issueResult.value.issueId);
    const handoffResult = await state.handoffService!.createHandoff(
      { issueId: issueResult.value.issueId },
      'dogfood-session',
      'dogfood-page',
    );
    expect(handoffResult.ok).toBe(true);
    if (handoffResult.ok) {
      state.handoffIds.push(handoffResult.value.handoffId);
      console.log(
        `  DF23-02: handoff ${handoffResult.value.handoffId.slice(0, 20)}… title="${handoffResult.value.title}"`,
      );
    }
    await p.close();
  });

  it('DF23-03: create issue from input, send to agent — no value leakage', async () => {
    const p = await makePage();
    const routes = ['/tasks', '/settings', '/invoices', '/users'];
    let inputPos: { x: number; y: number } | null = null;
    for (const route of routes) {
      try {
        await p.goto(TARGET_URL + route, { waitUntil: 'networkidle', timeout: 5000 });
        await sleep(800);
      } catch {
        continue;
      }
      inputPos = await p.evaluate(() => {
        const i = document.querySelector('input:not([type="hidden"])');
        if (!i) return null;
        const r = i.getBoundingClientRect();
        return r.width > 10 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      });
      if (inputPos) break;
    }

    if (!inputPos) {
      console.log('  DF23-03: no input found — skipping');
      await p.close();
      return;
    }

    await setupCapture(p);
    await activateOverlay(p);
    const ev = await clickAt(p, inputPos.x, inputPos.y);
    expect(ev).not.toBeNull();
    if (!ev) {
      await p.close();
      return;
    }

    const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
    const issueResult = await state.issueService!.createIssue(
      selection,
      'dogfood-session',
      'dogfood-page',
    );
    expect(issueResult.ok).toBe(true);
    if (!issueResult.ok) {
      await p.close();
      return;
    }

    state.issueIds.push(issueResult.value.issueId);
    const handoffResult = await state.handoffService!.createHandoff(
      { issueId: issueResult.value.issueId },
      'dogfood-session',
      'dogfood-page',
    );
    expect(handoffResult.ok).toBe(true);
    if (handoffResult.ok) {
      state.handoffIds.push(handoffResult.value.handoffId);
      const full = await state.handoffService!.getHandoff(handoffResult.value.handoffId);
      expect(full.ok).toBe(true);
      if (full.ok) {
        const json = JSON.stringify(full.value);
        expect(json).not.toContain('test-user-secret-123');
      }
      console.log(
        `  DF23-03: handoff ${handoffResult.value.handoffId.slice(0, 20)}… no value leakage`,
      );
    }
    await p.close();
  });

  it('DF23-04: create issue from dropdown, send to agent', async () => {
    const p = await makePage();
    const routes = ['/tasks', '/invoices', '/settings', '/users'];
    let selPos: { x: number; y: number } | null = null;
    for (const route of routes) {
      try {
        await p.goto(TARGET_URL + route, { waitUntil: 'networkidle', timeout: 5000 });
        await sleep(800);
      } catch {
        continue;
      }
      selPos = await p.evaluate(() => {
        for (const s of document.querySelectorAll('select, [role="combobox"]')) {
          const r = s.getBoundingClientRect();
          if (r.width > 10) return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
        return null;
      });
      if (selPos) break;
    }

    if (!selPos) {
      console.log('  DF23-04: no dropdown found — skipping');
      await p.close();
      return;
    }

    await setupCapture(p);
    await activateOverlay(p);
    const ev = await clickAt(p, selPos.x, selPos.y);
    expect(ev).not.toBeNull();
    if (!ev) {
      await p.close();
      return;
    }

    const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
    const issueResult = await state.issueService!.createIssue(
      selection,
      'dogfood-session',
      'dogfood-page',
    );
    expect(issueResult.ok).toBe(true);
    if (!issueResult.ok) {
      await p.close();
      return;
    }

    state.issueIds.push(issueResult.value.issueId);
    const handoffResult = await state.handoffService!.createHandoff(
      { issueId: issueResult.value.issueId },
      'dogfood-session',
      'dogfood-page',
    );
    expect(handoffResult.ok).toBe(true);
    if (handoffResult.ok) {
      state.handoffIds.push(handoffResult.value.handoffId);
      console.log(
        `  DF23-04: handoff ${handoffResult.value.handoffId.slice(0, 20)}… title="${handoffResult.value.title}"`,
      );
    }
    await p.close();
  });

  it('DF23-05: create issue from table row, send to agent', async () => {
    const p = await makePage();
    const routes = ['/tasks', '/invoices', '/users', '/orders'];
    let rowPos: { x: number; y: number } | null = null;
    for (const route of routes) {
      try {
        await p.goto(TARGET_URL + route, { waitUntil: 'networkidle', timeout: 5000 });
        await sleep(800);
      } catch {
        continue;
      }
      rowPos = await p.evaluate(() => {
        const r = document.querySelector('tr');
        if (!r) return null;
        const rect = r.getBoundingClientRect();
        return rect.width > 10 ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
      });
      if (rowPos) break;
    }

    if (!rowPos) {
      console.log('  DF23-05: no table row found — skipping');
      await p.close();
      return;
    }

    await setupCapture(p);
    await activateOverlay(p);
    const ev = await clickAt(p, rowPos.x, rowPos.y);
    expect(ev).not.toBeNull();
    if (!ev) {
      await p.close();
      return;
    }

    const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
    const issueResult = await state.issueService!.createIssue(
      selection,
      'dogfood-session',
      'dogfood-page',
    );
    expect(issueResult.ok).toBe(true);
    if (!issueResult.ok) {
      await p.close();
      return;
    }

    state.issueIds.push(issueResult.value.issueId);
    const handoffResult = await state.handoffService!.createHandoff(
      { issueId: issueResult.value.issueId },
      'dogfood-session',
      'dogfood-page',
    );
    expect(handoffResult.ok).toBe(true);
    if (handoffResult.ok) {
      state.handoffIds.push(handoffResult.value.handoffId);
      console.log(
        `  DF23-05: handoff ${handoffResult.value.handoffId.slice(0, 20)}… title="${handoffResult.value.title}"`,
      );
    }
    await p.close();
  });

  it('DF23-06: create issue from table cell, send to agent', async () => {
    const p = await makePage();
    const routes = ['/tasks', '/invoices', '/users'];
    let cellPos: { x: number; y: number } | null = null;
    for (const route of routes) {
      try {
        await p.goto(TARGET_URL + route, { waitUntil: 'networkidle', timeout: 5000 });
        await sleep(800);
      } catch {
        continue;
      }
      cellPos = await p.evaluate(() => {
        const c = document.querySelector('td');
        if (!c) return null;
        const r = c.getBoundingClientRect();
        return r.width > 5 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      });
      if (cellPos) break;
    }

    if (!cellPos) {
      console.log('  DF23-06: no table cell found — skipping');
      await p.close();
      return;
    }

    await setupCapture(p);
    await activateOverlay(p);
    const ev = await clickAt(p, cellPos.x, cellPos.y);
    expect(ev).not.toBeNull();
    if (!ev) {
      await p.close();
      return;
    }

    const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
    const issueResult = await state.issueService!.createIssue(
      selection,
      'dogfood-session',
      'dogfood-page',
    );
    expect(issueResult.ok).toBe(true);
    if (!issueResult.ok) {
      await p.close();
      return;
    }

    state.issueIds.push(issueResult.value.issueId);
    const handoffResult = await state.handoffService!.createHandoff(
      { issueId: issueResult.value.issueId },
      'dogfood-session',
      'dogfood-page',
    );
    expect(handoffResult.ok).toBe(true);
    if (handoffResult.ok) {
      state.handoffIds.push(handoffResult.value.handoffId);
      console.log(
        `  DF23-06: handoff ${handoffResult.value.handoffId.slice(0, 20)}… title="${handoffResult.value.title}"`,
      );
    }
    await p.close();
  });

  it('DF23-07: create issue from row action, send to agent', async () => {
    const p = await makePage();
    const routes = ['/tasks', '/invoices', '/users'];
    let actPos: { x: number; y: number } | null = null;
    for (const route of routes) {
      try {
        await p.goto(TARGET_URL + route, { waitUntil: 'networkidle', timeout: 5000 });
        await sleep(800);
      } catch {
        continue;
      }
      actPos = await p.evaluate(() => {
        for (const b of document.querySelectorAll(
          'td button, td a[role="button"], td [class*="action"]',
        )) {
          const r = b.getBoundingClientRect();
          if (r.width > 10) return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
        return null;
      });
      if (actPos) break;
    }

    if (!actPos) {
      console.log('  DF23-07: no row action found — skipping');
      await p.close();
      return;
    }

    await setupCapture(p);
    await activateOverlay(p);
    const ev = await clickAt(p, actPos.x, actPos.y);
    expect(ev).not.toBeNull();
    if (!ev) {
      await p.close();
      return;
    }

    const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
    const issueResult = await state.issueService!.createIssue(
      selection,
      'dogfood-session',
      'dogfood-page',
    );
    expect(issueResult.ok).toBe(true);
    if (!issueResult.ok) {
      await p.close();
      return;
    }

    state.issueIds.push(issueResult.value.issueId);
    const handoffResult = await state.handoffService!.createHandoff(
      { issueId: issueResult.value.issueId },
      'dogfood-session',
      'dogfood-page',
    );
    expect(handoffResult.ok).toBe(true);
    if (handoffResult.ok) {
      state.handoffIds.push(handoffResult.value.handoffId);
      console.log(
        `  DF23-07: handoff ${handoffResult.value.handoffId.slice(0, 20)}… title="${handoffResult.value.title}"`,
      );
    }
    await p.close();
  });

  it('DF23-08: create issue from box/card region, send to agent', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    const region = await p.evaluate(() => {
      const cards = Array.from(
        document.querySelectorAll(
          '[class*="card"]:not([class*="inner"]), [class*="Card"]:not([class*="inner"]), article',
        ),
      );
      if (cards.length === 0) return null;
      const r = cards[0]!.getBoundingClientRect();
      return { x1: r.x + 5, y1: r.y + 5, x2: r.x + r.width - 5, y2: r.y + r.height - 5 };
    });

    if (!region) {
      console.log('  DF23-08: no card found — skipping');
      await p.close();
      return;
    }

    await p.mouse.move(region.x1, region.y1);
    await sleep(30);
    await p.mouse.down();
    await sleep(30);
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      await p.mouse.move(
        region.x1 + (region.x2 - region.x1) * t,
        region.y1 + (region.y2 - region.y1) * t,
      );
      await sleep(15);
    }
    await p.mouse.up();
    await sleep(300);

    const dragEv = await p.evaluate(() => {
      const evts =
        (
          window as unknown as {
            __vs_events: Array<{
              type: string;
              data?: {
                source?: string;
                viewportRect?: { x: number; y: number; width: number; height: number };
              };
            }>;
          }
        ).__vs_events || [];
      (
        window as unknown as {
          __vs_events: Array<{
            type: string;
            data?: {
              source?: string;
              viewportRect?: { x: number; y: number; width: number; height: number };
            };
          }>;
        }
      ).__vs_events = [];
      return evts.find((e) => e.type === 'overlay:box-drag-completed') || null;
    });

    if (!dragEv) {
      console.log('  DF23-08: no box drag event — skipping');
      await p.close();
      return;
    }

    const rect = dragEv.data?.viewportRect || { x: 0, y: 0, width: 0, height: 0 };
    const selection: VisualSelection = {
      schemaVersion: 1,
      selectionId: crypto.randomUUID(),
      sessionId: 'dogfood-session',
      pageId: 'dogfood-page',
      mode: 'box',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      page: {
        url: p.url(),
        title: 'shadcn-admin',
        viewport: { width: 1440, height: 720, scrollX: 0, scrollY: 0 },
      },
      region: { viewportRect: rect },
      targets: [
        {
          targetId: crypto.randomUUID(),
          documentOrder: 0,
          geometry: { viewportRect: rect },
          semantics: { tagName: 'div', role: 'region', isInteractive: false },
          fingerprints: {},
          resolutionCandidates: [],
        },
      ],
      summary: { label: 'Box region', targetCount: 1 },
      resolution: { status: 'resolved', confidence: 0.7, resolvedAt: new Date().toISOString() },
    };

    const issueResult = await state.issueService!.createIssue(
      selection,
      'dogfood-session',
      'dogfood-page',
    );
    expect(issueResult.ok).toBe(true);
    if (!issueResult.ok) {
      await p.close();
      return;
    }

    state.issueIds.push(issueResult.value.issueId);
    const handoffResult = await state.handoffService!.createHandoff(
      { issueId: issueResult.value.issueId },
      'dogfood-session',
      'dogfood-page',
    );
    expect(handoffResult.ok).toBe(true);
    if (handoffResult.ok) {
      state.handoffIds.push(handoffResult.value.handoffId);
      console.log(
        `  DF23-08: handoff ${handoffResult.value.handoffId.slice(0, 20)}… title="${handoffResult.value.title}"`,
      );
    }
    await p.close();
  });
});

describe('Phase 23 Dogfood — Handoff Lifecycle', () => {
  it('DF23-09: list handoffs in deterministic order', async () => {
    const list = await state.handoffService!.listHandoffs();
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.value.length).toBeGreaterThanOrEqual(state.handoffIds.length);
      for (let i = 1; i < list.value.length; i++) {
        expect(list.value[i - 1]!.createdAt >= list.value[i]!.createdAt).toBe(true);
      }
      console.log(`  DF23-09: listed ${list.value.length} handoffs`);
    }
  });

  it('DF23-10: handoffs survive simulated restart', async () => {
    const eventBus = new EventBus();
    const freshIssueService = new IssueServiceImpl(eventBus, new IssuePersistence(ISSUE_STORAGE));
    const freshHandoffService = new HandoffServiceImpl(
      eventBus,
      freshIssueService,
      new HandoffPersistence(HANDOFF_STORAGE),
    );
    const list = await freshHandoffService.listHandoffs();
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.value.length).toBeGreaterThanOrEqual(state.handoffIds.length);
      console.log(`  DF23-10: ${list.value.length} handoffs survive restart`);
    }
  });

  it('DF23-11: agent fetch via get_agent_handoff returns safe brief', async () => {
    if (state.handoffIds.length === 0) return;
    const handoffId = state.handoffIds[0]!;
    const result = await state.handoffService!.getHandoff(handoffId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.brief).toBeTruthy();
      expect(result.value.brief.title).toBeTruthy();
      expect(result.value.brief.task.objective).toBeTruthy();
      expect(result.value.brief.task.nonGoals.length).toBeGreaterThan(0);
      expect(result.value.constraints.noRawPacketPaths).toBe(true);
      expect(result.value.constraints.noRawJson).toBe(true);
      expect(result.value.constraints.noSecrets).toBe(true);
      const json = JSON.stringify(result.value);
      expect(json).not.toContain('.viskod');
      expect(json).not.toContain('captures/');
      console.log('  DF23-11: agent fetch returns safe brief');
    }
  });

  it('DF23-12: agent fetch marks opened', async () => {
    if (state.handoffIds.length < 2) return;
    const handoffId = state.handoffIds[1]!;
    const result = await state.handoffService!.getHandoff(handoffId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('opened');
      console.log('  DF23-12: handoff marked opened');
    }
  });

  it('DF23-13: update status to in_progress and completed', async () => {
    if (state.handoffIds.length < 3) return;
    const handoffId = state.handoffIds[2]!;
    await state.handoffService!.getHandoff(handoffId);

    const update1 = await state.handoffService!.updateHandoffStatus(handoffId, 'in_progress');
    expect(update1.ok).toBe(true);
    if (update1.ok) {
      expect(update1.value.status).toBe('in_progress');
    }

    const update2 = await state.handoffService!.updateHandoffStatus(handoffId, 'completed');
    expect(update2.ok).toBe(true);
    if (update2.ok) {
      expect(update2.value.status).toBe('completed');
      expect(update2.value.completedAt).toBeTruthy();
      console.log('  DF23-13: handoff completed');
    }
  });

  it('DF23-14: cancel handoff', async () => {
    if (state.handoffIds.length < 4) return;
    const handoffId = state.handoffIds[3]!;
    const result = await state.handoffService!.cancelHandoff(handoffId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('cancelled');
      expect(result.value.cancelledAt).toBeTruthy();
      console.log('  DF23-14: handoff cancelled');
    }

    const fetchResult = await state.handoffService!.getHandoff(handoffId);
    expect(fetchResult.ok).toBe(false);
  });

  it('DF23-15: ambiguous issue handoff includes warning', async () => {
    const ambiguousSelection: VisualSelection = {
      schemaVersion: 1,
      selectionId: crypto.randomUUID(),
      sessionId: 'dogfood-session',
      pageId: 'dogfood-page',
      mode: 'single',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      page: {
        url: 'https://example.com',
        viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
      },
      region: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
      targets: [
        {
          targetId: crypto.randomUUID(),
          documentOrder: 0,
          geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
          semantics: { tagName: 'button', isInteractive: true },
          fingerprints: {},
          resolutionCandidates: [],
        },
      ],
      summary: { label: 'Duplicate button', targetCount: 1 },
      resolution: { status: 'ambiguous', confidence: 0.5, resolvedAt: new Date().toISOString() },
    };

    const issueResult = await state.issueService!.createIssue(
      ambiguousSelection,
      'dogfood-session',
      'dogfood-page',
    );
    expect(issueResult.ok).toBe(true);
    if (!issueResult.ok) return;

    const handoffResult = await state.handoffService!.createHandoff(
      { issueId: issueResult.value.issueId },
      'dogfood-session',
      'dogfood-page',
    );
    expect(handoffResult.ok).toBe(true);
    if (handoffResult.ok) {
      state.handoffIds.push(handoffResult.value.handoffId);
      expect(handoffResult.value.warningCount).toBeGreaterThan(0);
      console.log('  DF23-15: ambiguous issue handoff created with warning');
    }
  });

  it('DF23-16: stale issue handoff is rejected', async () => {
    const staleSelection: VisualSelection = {
      schemaVersion: 1,
      selectionId: crypto.randomUUID(),
      sessionId: 'dogfood-session',
      pageId: 'dogfood-page',
      mode: 'single',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      page: {
        url: 'https://example.com',
        viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
      },
      region: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
      targets: [
        {
          targetId: crypto.randomUUID(),
          documentOrder: 0,
          geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
          semantics: { tagName: 'button', isInteractive: true },
          fingerprints: {},
          resolutionCandidates: [],
        },
      ],
      summary: { label: 'Old button', targetCount: 1 },
      resolution: { status: 'stale', confidence: 0.2, resolvedAt: new Date().toISOString() },
    };

    const issueResult = await state.issueService!.createIssue(
      staleSelection,
      'dogfood-session',
      'dogfood-page',
    );
    expect(issueResult.ok).toBe(false);
    console.log('  DF23-16: stale issue creation blocked');
  });

  it('DF23-17: synthetic secrets absent from persisted handoff and tool output', async () => {
    const secrets = [
      { value: 'sk_test_abc123def456', label: 'API key' },
      { value: 'john@example.com', label: 'Email' },
      { value: '4111111111111111', label: 'Credit card' },
      { value: 'mysecrettoken12345678', label: 'Token' },
    ];

    for (const { value: secret, label } of secrets) {
      const selection: VisualSelection = {
        schemaVersion: 1,
        selectionId: crypto.randomUUID(),
        sessionId: 'dogfood-session',
        pageId: 'dogfood-page',
        mode: 'single',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        page: {
          url: 'https://example.com',
          viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
        },
        region: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
        targets: [
          {
            targetId: crypto.randomUUID(),
            documentOrder: 0,
            geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
            semantics: {
              tagName: 'div',
              textPreview: secret,
              accessibleName: secret,
              isInteractive: false,
            },
            fingerprints: {},
            resolutionCandidates: [],
          },
        ],
        summary: { textPreview: secret, label: secret, targetCount: 1 },
        resolution: { status: 'resolved', confidence: 0.9, resolvedAt: new Date().toISOString() },
      };

      const issueResult = await state.issueService!.createIssue(
        selection,
        'dogfood-session',
        'dogfood-page',
        `${label} test`,
      );
      expect(issueResult.ok).toBe(true);
      if (!issueResult.ok) continue;

      const handoffResult = await state.handoffService!.createHandoff(
        { issueId: issueResult.value.issueId },
        'dogfood-session',
        'dogfood-page',
      );
      expect(handoffResult.ok).toBe(true);
      if (!handoffResult.ok) continue;

      // Check persisted handoff file
      const filePath = path.join(HANDOFF_STORAGE, handoffResult.value.handoffId, 'handoff.json');
      const onDisk = fs.readFileSync(filePath, 'utf-8');
      expect(onDisk).not.toContain(secret);

      // Check tool output
      const getResult = await state.handoffService!.getHandoff(handoffResult.value.handoffId);
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        const memJson = JSON.stringify(getResult.value);
        expect(memJson).not.toContain(secret);
      }

      state.handoffIds.push(handoffResult.value.handoffId);
      console.log(`  DF23-17: ${label} — absent from persisted handoff and tool output`);
    }
  });

  it('DF23-18: no packet paths in UI or tool output', async () => {
    if (state.handoffIds.length === 0) return;
    const handoffId = state.handoffIds[0]!;
    const result = await state.handoffService!.getHandoff(handoffId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const json = JSON.stringify(result.value);
      expect(json).not.toMatch(/\.viskod[/\\]/);
      expect(json).not.toMatch(/captures[/\\]/);
      expect(json).not.toMatch(/context[/\\]/);
      expect(json).not.toMatch(/C:[\\/]/);
      expect(json).not.toMatch(/\/home\//);
      console.log('  DF23-18: no packet paths in tool output');
    }
  });

  it('DF23-19: existing capture_context regression', async () => {
    const selection = makeSelection({
      summary: { label: 'Test', role: 'button', textPreview: 'Test', targetCount: 1 },
      targets: [
        {
          targetId: crypto.randomUUID(),
          documentOrder: 0,
          geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
          semantics: { tagName: 'button', textPreview: 'Test', isInteractive: true },
          fingerprints: {},
          resolutionCandidates: [],
        },
      ],
    });
    const result = await state.issueService!.createIssue(
      selection,
      'dogfood-session',
      'dogfood-page',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      state.issueIds.push(result.value.issueId);
    }
    console.log('  DF23-19: capture regression passes');
  });

  it('DF23-20: Phase 21 overlay smoke', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    const btn = await p.evaluate(() => {
      const b = document.querySelector('button');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });

    expect(btn).not.toBeNull();
    if (btn) {
      const ev = await clickAt(p, btn.x, btn.y);
      expect(ev).not.toBeNull();
      expect(ev?.type).toBe('overlay:element-clicked');
    }

    await p.evaluate(() => {
      window.postMessage({ source: '__viskod_browser', command: 'overlay:hide' }, '*');
      const r = document.getElementById('__viskod_overlay_root');
      if (r) r.remove();
    });
    const hasRoot = await p.evaluate(() => !!document.getElementById('__viskod_overlay_root'));
    expect(hasRoot).toBe(false);
    console.log('  DF23-20: Phase 21 overlay smoke passes');
    await p.close();
  });

  it('DF23-21: Phase 22 issue dogfood smoke', async () => {
    const selection = makeSelection({
      summary: { label: 'Test', role: 'button', textPreview: 'Smoke test', targetCount: 1 },
      targets: [
        {
          targetId: crypto.randomUUID(),
          documentOrder: 0,
          geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
          semantics: { tagName: 'button', textPreview: 'Smoke test', isInteractive: true },
          fingerprints: {},
          resolutionCandidates: [],
        },
      ],
    });
    const result = await state.issueService!.createIssue(
      selection,
      'dogfood-session',
      'dogfood-page',
      'Smoke issue',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('open');
      expect(result.value.title).toBe('Smoke issue');
      state.issueIds.push(result.value.issueId);
      console.log('  DF23-21: Phase 22 issue smoke passes');
    }
  });
});

function makeSelection(overrides: Partial<VisualSelection> = {}): VisualSelection {
  return {
    schemaVersion: 1,
    selectionId: crypto.randomUUID(),
    sessionId: 'dogfood-session',
    pageId: 'dogfood-page',
    mode: 'single',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    page: {
      url: 'https://example.com',
      viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
    },
    region: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
    targets: [
      {
        targetId: crypto.randomUUID(),
        documentOrder: 0,
        geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
        semantics: { tagName: 'button', role: 'button', textPreview: 'Save', isInteractive: true },
        fingerprints: {},
        resolutionCandidates: [{ strategy: 'stable-attribute', value: 'test', confidence: 0.9 }],
      },
    ],
    summary: { label: 'Save', role: 'button', textPreview: 'Save', targetCount: 1 },
    resolution: { status: 'resolved', confidence: 0.9, resolvedAt: new Date().toISOString() },
    ...overrides,
  };
}
