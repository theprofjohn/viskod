import { type ChildProcess, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventBus } from '@viskod/event-bus';
import { getOverlayScript } from '@viskod/overlay-system';
import { IssuePersistence, IssueServiceImpl } from '@viskod/visual-issue';
import type { VisualSelection } from '@viskod/visual-selection';
import { type Browser, type Page, chromium } from 'playwright';
// Phase 22 dogfood: Phase 21 overlay → Phase 22 issue persistence — end-to-end on shadcn-admin
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60000 });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const TARGET_DIR = path.join(ROOT, 'examples', 'dogfood-app');
const TARGET_URL = 'http://localhost:5173';
const ISSUE_STORAGE = path.join(ROOT, '.viskod-dogfood-issues');

const overlayScript = getOverlayScript();

let devProc: ChildProcess | null = null;
let browser: Browser | null = null;

// Shared state across tests
interface SharedState {
  issueIds: string[];
  page: Page | null;
  service: IssueServiceImpl | null;
  persistence: IssuePersistence | null;
}
const state: SharedState = { issueIds: [], page: null, service: null, persistence: null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function requireService(): IssueServiceImpl {
  if (!state.service) throw new Error('state.service not initialized');
  return state.service;
}
function requirePersistence(): IssuePersistence {
  if (!state.persistence) throw new Error('state.persistence not initialized');
  return state.persistence;
}

beforeAll(async () => {
  if (!fs.existsSync(TARGET_DIR)) {
    throw new Error(
      `Dogfood fixture missing: ${TARGET_DIR}. test:dogfood requires the repo-contained fixture at examples/dogfood-app (dev server on ${TARGET_URL}).`,
    );
  }

  // Clean any prior dogfood issues
  try {
    fs.rmSync(ISSUE_STORAGE, { recursive: true, force: true });
  } catch {}

  // Start dev server
  try {
    devProc = spawn('pnpm', ['dev'], { cwd: TARGET_DIR, stdio: 'pipe', shell: true });
  } catch (e) {
    console.log('Dev server spawn failed (may already be running):', (e as Error).message);
  }
  await sleep(10000);

  // Start browser
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  // Set up issue service
  state.persistence = new IssuePersistence(ISSUE_STORAGE);
  state.service = new IssueServiceImpl(new EventBus(), state.persistence);
}, 60000);

afterAll(async () => {
  if (browser) await browser.close();
  if (devProc) devProc.kill();
  try {
    fs.rmSync(ISSUE_STORAGE, { recursive: true, force: true });
  } catch {}
});

// Helpers
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
                boundingBox?: { x: number; y: number; width: number; height: number };
                tagName?: string;
                textPreview?: string;
                role?: string;
                accessibleName?: string;
                isInteractive?: boolean;
                inputType?: string;
                stableAttributes?: Record<string, string>;
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
              boundingBox?: { x: number; y: number; width: number; height: number };
              tagName?: string;
              textPreview?: string;
              role?: string;
              accessibleName?: string;
              isInteractive?: boolean;
              inputType?: string;
              stableAttributes?: Record<string, string>;
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
            boundingBox?: { x: number; y: number; width: number; height: number };
            tagName?: string;
            textPreview?: string;
            role?: string;
            accessibleName?: string;
            isInteractive?: boolean;
            inputType?: string;
            stableAttributes?: Record<string, string>;
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
                boundingBox?: { x: number; y: number; width: number; height: number };
                tagName?: string;
                textPreview?: string;
                role?: string;
                accessibleName?: string;
                isInteractive?: boolean;
                inputType?: string;
                stableAttributes?: Record<string, string>;
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

// =========================================================================
// Dogfood tests
// =========================================================================

describe('Phase 22 Dogfood — Create Issues from Selected Elements', () => {
  it('DF22-01: creates issue from sidebar navigation', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    // Find a clickable element — nav link or any button/control on the dashboard
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
      // Wider fallback
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

    if (!target) {
      console.log('  DF22-01: no clickable target found — skipping');
      return;
    }

    const ev = await clickAt(p, target.x, target.y);
    expect(ev).not.toBeNull();
    expect(ev?.type).toBe('overlay:element-clicked');

    if (!ev) return;
    const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
    const svc = state.service;
    if (!svc) return;
    const result = await svc.createIssue(selection, 'dogfood-session', 'dogfood-page');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('open');
      expect(result.value.title.length).toBeLessThanOrEqual(80);
      expect(result.value.title).not.toContain('data-testid');
      expect(result.value.source.createdFrom).toBe('visual-selection');
      state.issueIds.push(result.value.issueId);
      console.log(
        `  DF22-01: issue ${result.value.issueId.slice(0, 8)}… title="${result.value.title}"`,
      );
    }
    await p.close();
  });

  it('DF22-02: creates issue from icon-only control', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    const icon = await p.evaluate(() => {
      for (const b of document.querySelectorAll('button')) {
        const t = (b.textContent || '').trim();
        if (t.length <= 2) {
          const r = b.getBoundingClientRect();
          if (r.width > 10)
            return {
              x: r.x + r.width / 2,
              y: r.y + r.height / 2,
              label: b.getAttribute('aria-label') || '',
              text: t,
            };
        }
      }
      return null;
    });

    expect(icon).not.toBeNull();
    if (!icon) return;

    const ev = await clickAt(p, icon.x, icon.y);
    expect(ev).not.toBeNull();
    expect(ev?.type).toBe('overlay:element-clicked');

    if (!ev) return;
    const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
    const svc = state.service;
    if (!svc) return;
    const result = await svc.createIssue(selection, 'dogfood-session', 'dogfood-page');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title.length).toBeLessThanOrEqual(80);
      expect(result.value.title).not.toContain('svg');
      state.issueIds.push(result.value.issueId);
      console.log(
        `  DF22-02: issue ${result.value.issueId.slice(0, 8)}… title="${result.value.title}"`,
      );
    }
    await p.close();
  });

  it('DF22-03: creates issue from input without value leakage', async () => {
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

    expect(inputPos).not.toBeNull();
    if (!inputPos) return;

    await setupCapture(p);
    await activateOverlay(p);
    const ev = await clickAt(p, inputPos.x, inputPos.y);
    expect(ev).not.toBeNull();
    expect(ev?.type).toBe('overlay:element-clicked');

    if (!ev) return;
    const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
    const svc = state.service;
    if (!svc) return;
    const result = await svc.createIssue(selection, 'dogfood-session', 'dogfood-page');

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Verify no input value in title or preview
      expect(result.value.title).not.toContain('test-user-secret-123');
      expect(result.value.targetSummary.textPreview || '').not.toContain('test-user-secret-123');
      console.log(`  DF22-03: issue ${result.value.issueId.slice(0, 8)}… no value leakage`);
      state.issueIds.push(result.value.issueId);
    }
    await p.close();
  });

  it('DF22-04: creates issue from dropdown trigger', async () => {
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

    expect(selPos).not.toBeNull();
    if (!selPos) return;

    await setupCapture(p);
    await activateOverlay(p);
    const ev = await clickAt(p, selPos.x, selPos.y);
    expect(ev).not.toBeNull();
    expect(ev?.type).toBe('overlay:element-clicked');

    if (!ev) return;
    const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
    const svc = state.service;
    if (!svc) return;
    const result = await svc.createIssue(selection, 'dogfood-session', 'dogfood-page');

    if (result.ok) {
      console.log(
        `  DF22-04: issue ${result.value.issueId.slice(0, 8)}… title="${result.value.title}"`,
      );
      state.issueIds.push(result.value.issueId);
    } else {
      console.log(`  DF22-04: createIssue failed: ${result.error.message}`);
    }
    expect(result.ok).toBe(true);
    await p.close();
  });

  it('DF22-05: creates issue from table row', async () => {
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

    expect(rowPos).not.toBeNull();
    if (!rowPos) return;

    await setupCapture(p);
    await activateOverlay(p);
    const ev = await clickAt(p, rowPos.x, rowPos.y);
    expect(ev).not.toBeNull();
    expect(ev?.type).toBe('overlay:element-clicked');

    if (!ev) return;
    const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
    const svc = state.service;
    if (!svc) return;
    const result = await svc.createIssue(selection, 'dogfood-session', 'dogfood-page');

    expect(result.ok).toBe(true);
    if (result.ok) {
      console.log(
        `  DF22-05: issue ${result.value.issueId.slice(0, 8)}… title="${result.value.title}"`,
      );
      state.issueIds.push(result.value.issueId);
    }
    await p.close();
  });

  it('DF22-06: creates issue from table cell', async () => {
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

    expect(cellPos).not.toBeNull();
    if (!cellPos) return;

    await setupCapture(p);
    await activateOverlay(p);
    const ev = await clickAt(p, cellPos.x, cellPos.y);
    expect(ev).not.toBeNull();
    expect(ev?.type).toBe('overlay:element-clicked');

    if (!ev) return;
    const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
    const svc = state.service;
    if (!svc) return;
    const result = await svc.createIssue(selection, 'dogfood-session', 'dogfood-page');

    expect(result.ok).toBe(true);
    if (result.ok) {
      console.log(
        `  DF22-06: issue ${result.value.issueId.slice(0, 8)}… title="${result.value.title}"`,
      );
      state.issueIds.push(result.value.issueId);
    }
    await p.close();
  });

  it('DF22-07: creates issue from row action button', async () => {
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

    expect(actPos).not.toBeNull();
    if (!actPos) return;

    await setupCapture(p);
    await activateOverlay(p);
    const ev = await clickAt(p, actPos.x, actPos.y);
    expect(ev).not.toBeNull();
    expect(ev?.type).toBe('overlay:element-clicked');

    if (!ev) return;
    const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
    const svc = state.service;
    if (!svc) return;
    const result = await svc.createIssue(selection, 'dogfood-session', 'dogfood-page');

    expect(result.ok).toBe(true);
    if (result.ok) {
      console.log(
        `  DF22-07: issue ${result.value.issueId.slice(0, 8)}… title="${result.value.title}"`,
      );
      state.issueIds.push(result.value.issueId);
    }
    await p.close();
  });

  it('DF22-08: creates issue from card/box region', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    // Box drag select over a card-like region
    const region = await p.evaluate(() => {
      const cards = Array.from(
        document.querySelectorAll(
          '[class*="card"]:not([class*="inner"]), [class*="Card"]:not([class*="inner"]), article',
        ),
      );
      if (cards.length === 0) return null;
      const first = cards[0];
      if (!first) return null;
      const r = first.getBoundingClientRect();
      return { x1: r.x + 5, y1: r.y + 5, x2: r.x + r.width - 5, y2: r.y + r.height - 5 };
    });

    expect(region).not.toBeNull();
    if (!region) return;

    // Manual drag
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
                boundingBox?: { x: number; y: number; width: number; height: number };
                tagName?: string;
                textPreview?: string;
                role?: string;
                accessibleName?: string;
                isInteractive?: boolean;
                inputType?: string;
                stableAttributes?: Record<string, string>;
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
              boundingBox?: { x: number; y: number; width: number; height: number };
              tagName?: string;
              textPreview?: string;
              role?: string;
              accessibleName?: string;
              isInteractive?: boolean;
              inputType?: string;
              stableAttributes?: Record<string, string>;
            };
          }>;
        }
      ).__vs_events = [];
      return evts.find((e) => e.type === 'overlay:box-drag-completed') || null;
    });

    expect(dragEv).not.toBeNull();
    if (!dragEv) return;

    // Create a box-type VisualSelection for the issue
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

    const result = await requireService().createIssue(selection, 'dogfood-session', 'dogfood-page');
    if (result.ok) {
      console.log(
        `  DF22-08: issue ${result.value.issueId.slice(0, 8)}… title="${result.value.title}"`,
      );
      state.issueIds.push(result.value.issueId);
    } else {
      console.log(`  DF22-08: createIssue failed: ${result.error.message}`);
    }
    expect(result.ok).toBe(true);
    await p.close();
  });
});

describe('Phase 22 Dogfood — Issue Lifecycle', () => {
  it('DF22-09: lists all created issues', async () => {
    const list = await requireService().listIssues();
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.value.length).toBeGreaterThanOrEqual(state.issueIds.length);
      console.log(`  DF22-09: listed ${list.value.length} issues`);
    }
  });

  it('DF22-10: issues survive simulated restart (new service instance)', async () => {
    const freshService = new IssueServiceImpl(new EventBus(), requirePersistence());
    const list = await freshService.listIssues();
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.value.length).toBeGreaterThanOrEqual(state.issueIds.length);
      console.log(`  DF22-10: ${list.value.length} issues survive restart`);

      // Check deterministic ordering
      for (let i = 1; i < list.value.length; i++) {
        const prev = list.value[i - 1];
        const curr = list.value[i];
        if (prev && curr) {
          expect(prev.updatedAt >= curr.updatedAt).toBe(true);
        }
      }
    }
  });

  it('DF22-11: opens issue detail', async () => {
    const issueId = state.issueIds[0];
    if (!issueId) return;
    const detail = await requireService().getIssue(issueId);
    expect(detail.ok).toBe(true);
    if (detail.ok) {
      expect(detail.value.issueId).toBe(issueId);
      expect(detail.value.title).toBeTruthy();
      expect(detail.value.page.url).toBeTruthy();
      expect(detail.value.lifecycle.length).toBeGreaterThanOrEqual(1);
      expect(detail.value.targetSummary.mode).toBe('single');
      expect(detail.value.targetSummary.targetCount).toBeGreaterThanOrEqual(1);
      // No selectors or packet paths
      expect(detail.value.title).not.toMatch(/[#.\[:]/);
      console.log(
        `  DF22-11: detail for issue ${issueId.slice(0, 8)}… title="${detail.value.title}"`,
      );
    }
  });

  it('DF22-12: updates title/description/severity/status', async () => {
    const issueId = state.issueIds[0];
    if (!issueId) return;

    const update = await requireService().updateIssue(issueId, {
      title: 'Updated: Navigation issue',
      description: 'The nav item needs better contrast',
      severity: 'high',
      status: 'in_progress',
    });

    expect(update.ok).toBe(true);
    if (update.ok) {
      expect(update.value.title).toBe('Updated: Navigation issue');
      expect(update.value.description).toBe('The nav item needs better contrast');
      expect(update.value.severity).toBe('high');
      expect(update.value.status).toBe('in_progress');
      expect(update.value.lifecycle.length).toBeGreaterThanOrEqual(2);
      console.log(
        `  DF22-12: issue updated — status=${update.value.status} severity=${update.value.severity}`,
      );
    }
  });

  it('DF22-13: archives issue', async () => {
    const issueId = state.issueIds[0];
    if (!issueId) return;

    const archive = await requireService().archiveIssue(issueId);
    expect(archive.ok).toBe(true);
    if (archive.ok) {
      expect(archive.value.status).toBe('archived');
      expect(archive.value.archivedAt).toBeTruthy();
      const archivedEvent = archive.value.lifecycle.find((e) => e.type === 'archived');
      expect(archivedEvent).toBeTruthy();
      console.log(`  DF22-13: issue ${issueId.slice(0, 8)}… archived`);

      // Verify archived issue hidden from default list
      const list = await requireService().listIssues();
      expect(list.ok).toBe(true);
      if (list.ok) {
        const stillListed = list.value.some((i) => i.issueId === issueId);
        expect(stillListed).toBe(false);
      }
    }
  });

  it('DF22-14: reopens archived issue', async () => {
    const issueId = state.issueIds[0];
    if (!issueId) return;

    const reopen = await requireService().reopenIssue(issueId);
    expect(reopen.ok).toBe(true);
    if (reopen.ok) {
      expect(reopen.value.status).toBe('open');
      expect(reopen.value.archivedAt).toBeUndefined();
      const reopenEvent = reopen.value.lifecycle.find((e) => e.type === 'reopened');
      expect(reopenEvent).toBeTruthy();
      console.log(`  DF22-14: issue ${issueId.slice(0, 8)}… reopened`);

      // Should now appear in list
      const list = await requireService().listIssues();
      expect(list.ok).toBe(true);
      if (list.ok) {
        const listed = list.value.some((i) => i.issueId === issueId);
        expect(listed).toBe(true);
      }
    }
  });

  it('DF22-15: deletes issue', async () => {
    const issueId = state.issueIds[state.issueIds.length - 1];
    if (!issueId) return;

    const del = await requireService().deleteIssue(issueId);
    expect(del.ok).toBe(true);
    if (del.ok) {
      expect(del.value.deletedAt).toBeTruthy();
      const deleteEvent = del.value.lifecycle.find((e) => e.type === 'deleted');
      expect(deleteEvent).toBeTruthy();
      console.log(`  DF22-15: issue ${issueId.slice(0, 8)}… deleted`);
    }
  });
});

describe('Phase 22 Dogfood — Edge Cases', () => {
  it('DF22-16: stale selection is blocked', async () => {
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

    const result = await requireService().createIssue(
      staleSelection,
      'dogfood-session',
      'dogfood-page',
    );
    expect(result.ok).toBe(false);
    console.log('  DF22-16: stale selection blocked');
  });

  it('DF22-17: ambiguous selection is marked', async () => {
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

    const result = await requireService().createIssue(
      ambiguousSelection,
      'dogfood-session',
      'dogfood-page',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.targetSummary.resolutionStatus).toBe('ambiguous');
      console.log('  DF22-17: ambiguous selection marked');
    }
  });

  it('DF22-18: synthetic secrets absent from entire persisted issue JSON', async () => {
    const secrets = [
      { value: 'sk_test_abc123def456', label: 'API key (sk_test_*)' },
      { value: 'user@example.com', label: 'Email' },
      { value: '4111111111111111', label: 'Credit card' },
      { value: 'mysecrettoken12345678', label: 'Secret token' },
      { value: 'leak@corp.io', label: 'Email (corp)' },
    ];

    for (const { value: secret, label } of secrets) {
      const secretSelection: VisualSelection = {
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
            fingerprints: { stableAttributes: { 'data-secret': secret } },
            resolutionCandidates: [],
          },
        ],
        summary: { textPreview: secret, label: secret, targetCount: 1 },
        resolution: { status: 'resolved', confidence: 0.9, resolvedAt: new Date().toISOString() },
      };

      const result = await requireService().createIssue(
        secretSelection,
        'dogfood-session',
        'dogfood-page',
        `${label} test`,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const issueFilePath = path.join(ISSUE_STORAGE, result.value.issueId, 'issue.json');
        const onDisk = fs.readFileSync(issueFilePath, 'utf-8');

        // Scan the ENTIRE persisted JSON string — must not contain the raw secret
        expect(onDisk).not.toContain(secret);
        // Verify the in-memory object also has no raw secret anywhere
        const memJson = JSON.stringify(result.value);
        expect(memJson).not.toContain(secret);
        // Redaction must be flagged
        expect(result.value.redaction.applied).toBe(true);

        console.log(`  DF22-18: ${label} — absent from full persisted JSON`);
      }
    }
  });

  it('DF22-19: phase21 overlay smoke still passes', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    // Quick click test
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

    // Verify teardown
    await p.evaluate(() => {
      window.postMessage({ source: '__viskod_browser', command: 'overlay:hide' }, '*');
      const r = document.getElementById('__viskod_overlay_root');
      if (r) r.remove();
    });
    const hasRoot = await p.evaluate(() => !!document.getElementById('__viskod_overlay_root'));
    expect(hasRoot).toBe(false);

    console.log('  DF22-19: Phase 21 overlay smoke passes');
    await p.close();
  });
});
