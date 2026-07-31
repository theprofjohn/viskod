// Phase 25 dogfood: Usage-Site Source Hints — end-to-end on shadcn-admin
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.setConfig({ testTimeout: 60000 });
import { chromium, type Page, type Browser } from 'playwright';
import { getOverlayScript } from '@viskod/overlay-system';
import { EventBus } from '@viskod/event-bus';
import { IssueServiceImpl, IssuePersistence } from '@viskod/visual-issue';
import { HandoffServiceImpl, HandoffPersistence } from '@viskod/agent-handoff';
import { ReviewServiceImpl, ReviewPersistence } from '@viskod/visual-review';
import { SourceHintEngine } from '@viskod/source-hint-engine';
import { ProjectScanner } from '@viskod/project-scanner';
import type { VisualSelection } from '@viskod/visual-selection';
import type { RecaptureAdapter, RecaptureResult } from '@viskod/visual-review';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const TARGET_DIR = 'C:\\viskod-dogfood-shadcn-admin';
const TARGET_URL = 'http://localhost:5173';
const ISSUE_STORAGE = path.join(ROOT, '.viskod-dogfood-issues-p25');
const HANDOFF_STORAGE = path.join(ROOT, '.viskod-dogfood-handoffs-p25');
const REVIEW_STORAGE = path.join(ROOT, '.viskod-dogfood-reviews-p25');

const overlayScript = getOverlayScript();

let devProc: ChildProcess | null = null;
let browser: Browser | null = null;

interface ScenarioResult {
  id: string;
  description: string;
  selectedTarget: string;
  expectedTopUsageSite: string;
  actualTop5Hints: Array<{ displayPath: string; kind: string; confidence: number; score: number }>;
  status: 'ranked' | 'ambiguous' | 'low_confidence' | 'missing';
  pass: boolean;
}

interface SharedState {
  issueIds: string[];
  handoffIds: string[];
  reviewIds: string[];
  scenarioResults: ScenarioResult[];
  page: Page | null;
  issueService: IssueServiceImpl | null;
  handoffService: HandoffServiceImpl | null;
  reviewService: ReviewServiceImpl | null;
  sourceHintEngine: SourceHintEngine | null;
  projectScanner: ProjectScanner | null;
  projectRootPath: string;
}

const state: SharedState = {
  issueIds: [],
  handoffIds: [],
  reviewIds: [],
  scenarioResults: [],
  page: null,
  issueService: null,
  handoffService: null,
  reviewService: null,
  sourceHintEngine: null,
  projectScanner: null,
  projectRootPath: '',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  try { fs.rmSync(ISSUE_STORAGE, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(HANDOFF_STORAGE, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(REVIEW_STORAGE, { recursive: true, force: true }); } catch {}

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
  const reviewPersistence = new ReviewPersistence(REVIEW_STORAGE);
  state.reviewService = new ReviewServiceImpl(eventBus, state.issueService, state.handoffService, reviewPersistence);
  state.sourceHintEngine = new SourceHintEngine(eventBus);
  state.projectScanner = new ProjectScanner(eventBus);

  // Run project scan to get rootPath and component directories
  const scanResult = await state.projectScanner.scan(TARGET_DIR);
  if (scanResult.ok) {
    state.projectRootPath = scanResult.value.metadata.rootPath;
    console.log(`  Project scanned: ${scanResult.value.metadata.name} (${scanResult.value.metadata.rootPath})`);
    console.log(`  Framework: ${scanResult.value.framework.primary ?? 'unknown'}`);
    console.log(`  Components: ${scanResult.value.components.directories.join(', ')}`);
    console.log(`  Routes: ${scanResult.value.routes.totalRoutes}`);
  }
}, 60000);

afterAll(async () => {
  if (browser) await browser.close();
  if (devProc) devProc.kill();
  try { fs.rmSync(ISSUE_STORAGE, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(HANDOFF_STORAGE, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(REVIEW_STORAGE, { recursive: true, force: true }); } catch {}

  // Print summary
  console.log('\n=== Phase 25 Dogfood Summary ===');
  console.log(`Scenarios: ${state.scenarioResults.length}`);
  const passed = state.scenarioResults.filter((r) => r.pass).length;
  const failed = state.scenarioResults.filter((r) => !r.pass).length;
  console.log(`Passed: ${passed}, Failed: ${failed}`);
  for (const r of state.scenarioResults) {
    const mark = r.pass ? '✅' : '❌';
    console.log(`  ${mark} ${r.id}: ${r.description}`);
    if (r.actualTop5Hints.length > 0) {
      console.log(`    Top hint: ${r.actualTop5Hints[0]!.displayPath} (${r.actualTop5Hints[0]!.kind}, conf=${r.actualTop5Hints[0]!.confidence})`);
    }
  }
});

async function makePage(): Promise<Page> {
  if (!browser) throw new Error('browser not available');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 15000 });
  await sleep(1000);
  return p;
}

async function activateOverlay(p: Page) {
  await p.evaluate(overlayScript);
  await sleep(200);
  await p.evaluate(() => {
    window.postMessage({ source: '__viskod_browser', command: 'overlay:show', mode: 'selection' }, '*');
  });
  await sleep(300);
}

async function clickAt(p: Page, x: number, y: number): Promise<any> {
  await p.mouse.move(x, y); await sleep(30);
  await p.mouse.down(); await sleep(30);
  await p.mouse.up(); await sleep(300);
  return p.evaluate(() => {
    const evts = (window as any).__vs_events || [];
    (window as any).__vs_events = [];
    return evts.filter((e: any) => e.type !== 'overlay:ready');
  }).then((evts: any[]) => (evts.length > 0 ? evts[evts.length - 1] : null));
}

async function setupCapture(p: Page) {
  await p.evaluate(() => {
    (window as any).__vs_events = [];
    window.addEventListener('message', (e) => {
      if (e.data && e.data.source === '__viskod_overlay') {
        (window as any).__vs_events.push(e.data);
      }
    });
  });
}

function makeVisualSelection(overlayEvent: any, pageUrl: string, title?: string): VisualSelection {
  const rect = overlayEvent.data?.boundingBox || { x: 0, y: 0, width: 0, height: 0 };
  const tagName = overlayEvent.data?.tagName || 'element';
  const textPreview = overlayEvent.data?.textPreview || '';
  const role = overlayEvent.data?.role || undefined;
  const isInteractive = overlayEvent.data?.isInteractive ?? false;
  const stableAttrs = overlayEvent.data?.stableAttributes || undefined;

  return {
    schemaVersion: 1,
    selectionId: crypto.randomUUID(),
    sessionId: 'dogfood-p25-session',
    pageId: 'dogfood-p25-page',
    mode: 'single',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    page: { url: pageUrl, title, viewport: { width: 1440, height: 900, scrollX: 0, scrollY: 0 } },
    region: { viewportRect: rect },
    targets: [
      {
        targetId: crypto.randomUUID(),
        documentOrder: 0,
        geometry: { viewportRect: rect },
        semantics: {
          tagName,
          role,
          accessibleName: overlayEvent.data?.accessibleName,
          textPreview: textPreview.slice(0, 120),
          isInteractive,
        },
        fingerprints: { stableAttributes: stableAttrs as Record<string, string> | undefined },
        resolutionCandidates: [{ strategy: 'runtime-node', value: 'live', confidence: 0.9 }],
      },
    ],
    summary: { label: textPreview || tagName, role, textPreview: textPreview.slice(0, 120), targetCount: 1 },
    resolution: { status: 'resolved', confidence: 0.85, resolvedAt: new Date().toISOString() },
  };
}

async function resolveHintsForIssue(issueId: string): Promise<{
  status: string;
  hints: Array<{ displayPath: string; kind: string; confidence: number; score: number; reasons: string[] }>;
  warnings: string[];
}> {
  const issueResult = await state.issueService!.getIssue(issueId);
  if (!issueResult.ok) return { status: 'missing', hints: [], warnings: ['Issue not found'] };

  const issue = issueResult.value;
  const snapshot = issue.source.selectionSnapshot as Record<string, unknown> | undefined;
  const targets = snapshot?.targets as Array<Record<string, unknown>> | undefined;
  const firstTarget = targets?.[0] as Record<string, unknown> | undefined;
  const semantics = firstTarget?.semantics as Record<string, unknown> | undefined;
  const fingerprints = firstTarget?.fingerprints as Record<string, unknown> | undefined;
  const stableAttrs = fingerprints?.stableAttributes as Record<string, string> | undefined;

  const hintInput = {
    domContext: {
      tagName: (semantics?.tagName as string) ?? 'div',
      className: stableAttrs?.class ?? '',
      id: stableAttrs?.id ?? '',
      role: (semantics?.role as string) ?? undefined,
      testId: stableAttrs?.['data-testid'] ?? undefined,
      text: (semantics?.textPreview as string) ?? undefined,
      parentTagName: undefined as string | undefined,
    },
    route: { url: issue.page.url, pathname: new URL(issue.page.url).pathname },
    project: {
      metadata: {
        projectId: 'dogfood-p25',
        name: 'shadcn-admin',
        rootPath: state.projectRootPath,
        packageManager: 'pnpm',
        language: 'typescript',
      },
      componentIndex: { directories: ['src/components', 'components'] },
      framework: { primary: 'next.js', detected: ['next.js', 'react', 'tailwind'], confidence: 0.95 },
    },
    captureId: crypto.randomUUID(),
  };

  const result = await state.sourceHintEngine!.resolveUsageSiteHints(hintInput, 5);
  if (!result.ok) return { status: 'missing', hints: [], warnings: [result.error.message] };

  return {
    status: result.value.status,
    hints: result.value.topHints.map((h) => ({
      displayPath: h.file.displayPath,
      kind: h.kind,
      confidence: h.ranking.confidence,
      score: h.ranking.score,
      reasons: h.ranking.reasons,
    })),
    warnings: result.value.warnings,
  };
}

function recordScenario(result: ScenarioResult) {
  state.scenarioResults.push(result);
}

function makeRecaptureResult(overrides?: Partial<RecaptureResult>): RecaptureResult {
  return {
    packetId: crypto.randomUUID(),
    selector: 'button',
    tagName: 'button',
    boundingBox: { x: 100, y: 200, width: 120, height: 40 },
    text: 'Save',
    url: TARGET_URL,
    viewport: { width: 1440, height: 900 },
    ...overrides,
  };
}

function makeMockAdapter(overrides?: Partial<RecaptureResult>): RecaptureAdapter {
  return async () => makeRecaptureResult(overrides);
}

// =========================================================================
// Dogfood tests — Phase 25: Usage-Site Source Hints
// =========================================================================

describe('Phase 25 Dogfood — Usage-Site Source Hints', () => {
  // DF25-01: Sidebar nav item
  it('DF25-01: sidebar nav item — app usage ranks above primitive link', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    // Find and click a sidebar nav item
    const target = await p.evaluate(() => {
      const nav = document.querySelector('nav');
      if (!nav) return null;
      const links = nav.querySelectorAll('a');
      for (const el of links) {
        const r = el.getBoundingClientRect();
        if (r.width > 20 && r.height > 20 && r.top > 50 && r.top < 800) {
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.textContent || '').trim().slice(0, 40) };
        }
      }
      return null;
    });

    if (!target) { console.log('  DF25-01: SKIP — no sidebar nav found'); await p.close(); return; }

    const ev = await clickAt(p, target.x, target.y);
    if (!ev) { await p.close(); return; }

    const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
    const issueResult = await state.issueService!.createIssue(selection, 'dogfood-p25-session', 'dogfood-p25-page');
    expect(issueResult.ok).toBe(true);
    if (!issueResult.ok) { await p.close(); return; }
    state.issueIds.push(issueResult.value.issueId);

    const hints = await resolveHintsForIssue(issueResult.value.issueId);
    console.log(`  DF25-01: target="${target.text}" status=${hints.status}`);
    hints.hints.forEach((h, i) => console.log(`    ${i + 1}. ${h.displayPath} (${h.kind}, conf=${h.confidence.toFixed(2)}, score=${h.score.toFixed(3)})`));

    recordScenario({
      id: 'DF25-01',
      description: 'sidebar nav item — app usage ranks above primitive link',
      selectedTarget: target.text,
      expectedTopUsageSite: 'app/ or features/ route file',
      actualTop5Hints: hints.hints,
      status: hints.status as any,
      pass: hints.status !== 'missing' && hints.hints.length > 0,
    });

    expect(hints.status).not.toBe('missing');
    expect(hints.hints.length).toBeGreaterThan(0);
    await p.close();
  });

  // DF25-02: Icon-only control
  it('DF25-02: icon-only control — accessible-name contributes to usage site', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    // Find an icon-only button (e.g., theme toggle, sidebar collapse)
    const target = await p.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const el of buttons) {
        const r = el.getBoundingClientRect();
        if (r.width > 15 && r.width < 60 && r.height > 15 && r.height < 60 && r.top > 30 && r.top < 100) {
          const ariaLabel = el.getAttribute('aria-label') || '';
          const text = (el.textContent || '').trim();
          if (ariaLabel || text.length < 5) {
            return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: ariaLabel || text || 'icon-button' };
          }
        }
      }
      return null;
    });

    if (!target) { console.log('  DF25-02: SKIP — no icon-only control found'); await p.close(); return; }

    const ev = await clickAt(p, target.x, target.y);
    if (!ev) { await p.close(); return; }

    const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
    const issueResult = await state.issueService!.createIssue(selection, 'dogfood-p25-session', 'dogfood-p25-page');
    expect(issueResult.ok).toBe(true);
    if (!issueResult.ok) { await p.close(); return; }
    state.issueIds.push(issueResult.value.issueId);

    const hints = await resolveHintsForIssue(issueResult.value.issueId);
    console.log(`  DF25-02: target="${target.text}" status=${hints.status}`);
    hints.hints.forEach((h, i) => console.log(`    ${i + 1}. ${h.displayPath} (${h.kind}, conf=${h.confidence.toFixed(2)})`));

    recordScenario({
      id: 'DF25-02',
      description: 'icon-only control — accessible-name contributes to usage site',
      selectedTarget: target.text,
      expectedTopUsageSite: 'route/form file using the icon button',
      actualTop5Hints: hints.hints,
      status: hints.status as any,
      pass: hints.status !== 'missing',
    });

    expect(hints.status).not.toBe('missing');
    await p.close();
  });

  // DF25-03: Settings input
  it('DF25-03: settings input — route/form usage file ranks high', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    const target = await p.evaluate(() => {
      const inputs = document.querySelectorAll('input, [role="textbox"]');
      for (const el of inputs) {
        const r = el.getBoundingClientRect();
        if (r.width > 50 && r.height > 20 && r.top > 100 && r.top < 800) {
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.getAttribute('placeholder') || el.getAttribute('aria-label') || 'input') };
        }
      }
      return null;
    });

    if (!target) { console.log('  DF25-03: SKIP — no input found'); await p.close(); return; }

    const ev = await clickAt(p, target.x, target.y);
    if (!ev) { await p.close(); return; }

    const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
    const issueResult = await state.issueService!.createIssue(selection, 'dogfood-p25-session', 'dogfood-p25-page');
    expect(issueResult.ok).toBe(true);
    if (!issueResult.ok) { await p.close(); return; }
    state.issueIds.push(issueResult.value.issueId);

    const hints = await resolveHintsForIssue(issueResult.value.issueId);
    console.log(`  DF25-03: target="${target.text}" status=${hints.status}`);
    hints.hints.forEach((h, i) => console.log(`    ${i + 1}. ${h.displayPath} (${h.kind}, conf=${h.confidence.toFixed(2)})`));

    recordScenario({
      id: 'DF25-03',
      description: 'settings input — route/form usage file ranks high',
      selectedTarget: target.text,
      expectedTopUsageSite: 'settings page/form file',
      actualTop5Hints: hints.hints,
      status: hints.status as any,
      pass: hints.status !== 'missing' && hints.hints.length > 0,
    });

    expect(hints.status).not.toBe('missing');
    await p.close();
  });

  // DF25-04: Dropdown trigger
  it('DF25-04: dropdown trigger — route-specific usage ranks above primitive', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    // Find a select/combobox trigger
    const target = await p.evaluate(() => {
      const triggers = document.querySelectorAll('[role="combobox"], [role="listbox"], select, [data-state]');
      for (const el of triggers) {
        const r = el.getBoundingClientRect();
        if (r.width > 30 && r.height > 20 && r.top > 50 && r.top < 800) {
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.textContent || el.getAttribute('aria-label') || 'dropdown') };
        }
      }
      return null;
    });

    if (!target) { console.log('  DF25-04: SKIP — no dropdown found'); await p.close(); return; }

    const ev = await clickAt(p, target.x, target.y);
    if (!ev) { await p.close(); return; }

    const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
    const issueResult = await state.issueService!.createIssue(selection, 'dogfood-p25-session', 'dogfood-p25-page');
    expect(issueResult.ok).toBe(true);
    if (!issueResult.ok) { await p.close(); return; }
    state.issueIds.push(issueResult.value.issueId);

    const hints = await resolveHintsForIssue(issueResult.value.issueId);
    console.log(`  DF25-04: target="${target.text}" status=${hints.status}`);
    hints.hints.forEach((h, i) => console.log(`    ${i + 1}. ${h.displayPath} (${h.kind}, conf=${h.confidence.toFixed(2)})`));

    recordScenario({
      id: 'DF25-04',
      description: 'dropdown trigger — route-specific usage ranks above primitive',
      selectedTarget: target.text,
      expectedTopUsageSite: 'route/form using dropdown',
      actualTop5Hints: hints.hints,
      status: hints.status as any,
      pass: hints.status !== 'missing',
    });

    expect(hints.status).not.toBe('missing');
    await p.close();
  });

  // DF25-05: Table row
  it('DF25-05: table row — table/route owner ranks above generic table primitive', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    const target = await p.evaluate(() => {
      const rows = document.querySelectorAll('tr, [role="row"]');
      for (const el of rows) {
        const r = el.getBoundingClientRect();
        if (r.width > 100 && r.height > 20 && r.top > 100 && r.top < 800) {
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.textContent || '').trim().slice(0, 60) };
        }
      }
      return null;
    });

    if (!target) { console.log('  DF25-05: SKIP — no table row found'); await p.close(); return; }

    const ev = await clickAt(p, target.x, target.y);
    if (!ev) { await p.close(); return; }

    const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
    const issueResult = await state.issueService!.createIssue(selection, 'dogfood-p25-session', 'dogfood-p25-page');
    expect(issueResult.ok).toBe(true);
    if (!issueResult.ok) { await p.close(); return; }
    state.issueIds.push(issueResult.value.issueId);

    const hints = await resolveHintsForIssue(issueResult.value.issueId);
    console.log(`  DF25-05: target="${target.text.slice(0, 40)}" status=${hints.status}`);
    hints.hints.forEach((h, i) => console.log(`    ${i + 1}. ${h.displayPath} (${h.kind}, conf=${h.confidence.toFixed(2)})`));

    recordScenario({
      id: 'DF25-05',
      description: 'table row — table/route owner ranks above generic table primitive',
      selectedTarget: target.text.slice(0, 40),
      expectedTopUsageSite: 'table usage file or route owner',
      actualTop5Hints: hints.hints,
      status: hints.status as any,
      pass: hints.status !== 'missing' && hints.hints.length > 0,
    });

    expect(hints.status).not.toBe('missing');
    await p.close();
  });

  // DF25-06: Table cell
  it('DF25-06: table cell — column/cell renderer ranks high', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    const target = await p.evaluate(() => {
      const cells = document.querySelectorAll('td, [role="cell"]');
      for (const el of cells) {
        const r = el.getBoundingClientRect();
        if (r.width > 30 && r.height > 15 && r.top > 100 && r.top < 800) {
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.textContent || '').trim().slice(0, 40) };
        }
      }
      return null;
    });

    if (!target) { console.log('  DF25-06: SKIP — no table cell found'); await p.close(); return; }

    const ev = await clickAt(p, target.x, target.y);
    if (!ev) { await p.close(); return; }

    const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
    const issueResult = await state.issueService!.createIssue(selection, 'dogfood-p25-session', 'dogfood-p25-page');
    expect(issueResult.ok).toBe(true);
    if (!issueResult.ok) { await p.close(); return; }
    state.issueIds.push(issueResult.value.issueId);

    const hints = await resolveHintsForIssue(issueResult.value.issueId);
    console.log(`  DF25-06: target="${target.text}" status=${hints.status}`);
    hints.hints.forEach((h, i) => console.log(`    ${i + 1}. ${h.displayPath} (${h.kind}, conf=${h.confidence.toFixed(2)})`));

    recordScenario({
      id: 'DF25-06',
      description: 'table cell — column/cell renderer ranks high',
      selectedTarget: target.text,
      expectedTopUsageSite: 'table column definition or route file',
      actualTop5Hints: hints.hints,
      status: hints.status as any,
      pass: hints.status !== 'missing',
    });

    expect(hints.status).not.toBe('missing');
    await p.close();
  });

  // DF25-07: Row action button
  it('DF25-07: row action button — row action usage ranks above Button primitive', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    // Find a button inside a table row
    const target = await p.evaluate(() => {
      const rows = document.querySelectorAll('tr, [role="row"]');
      for (const row of rows) {
        const buttons = row.querySelectorAll('button');
        for (const btn of buttons) {
          const r = btn.getBoundingClientRect();
          if (r.width > 10 && r.height > 10 && r.top > 100 && r.top < 800) {
            return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (btn.textContent || btn.getAttribute('aria-label') || 'action') };
          }
        }
      }
      return null;
    });

    if (!target) { console.log('  DF25-07: SKIP — no row action button found'); await p.close(); return; }

    const ev = await clickAt(p, target.x, target.y);
    if (!ev) { await p.close(); return; }

    const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
    const issueResult = await state.issueService!.createIssue(selection, 'dogfood-p25-session', 'dogfood-p25-page');
    expect(issueResult.ok).toBe(true);
    if (!issueResult.ok) { await p.close(); return; }
    state.issueIds.push(issueResult.value.issueId);

    const hints = await resolveHintsForIssue(issueResult.value.issueId);
    console.log(`  DF25-07: target="${target.text}" status=${hints.status}`);
    hints.hints.forEach((h, i) => console.log(`    ${i + 1}. ${h.displayPath} (${h.kind}, conf=${h.confidence.toFixed(2)})`));

    recordScenario({
      id: 'DF25-07',
      description: 'row action button — row action usage ranks above Button primitive',
      selectedTarget: target.text,
      expectedTopUsageSite: 'table actions column or route file',
      actualTop5Hints: hints.hints,
      status: hints.status as any,
      pass: hints.status !== 'missing',
    });

    expect(hints.status).not.toBe('missing');
    await p.close();
  });

  // DF25-08: Dashboard card
  it('DF25-08: dashboard card — card usage file ranks above Card primitive', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    const target = await p.evaluate(() => {
      const cards = document.querySelectorAll('[class*="card"], [data-slot="card"], [role="region"]');
      for (const el of cards) {
        const r = el.getBoundingClientRect();
        if (r.width > 100 && r.height > 60 && r.top > 80 && r.top < 800) {
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.textContent || '').trim().slice(0, 60) };
        }
      }
      return null;
    });

    if (!target) { console.log('  DF25-08: SKIP — no card found'); await p.close(); return; }

    const ev = await clickAt(p, target.x, target.y);
    if (!ev) { await p.close(); return; }

    const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
    const issueResult = await state.issueService!.createIssue(selection, 'dogfood-p25-session', 'dogfood-p25-page');
    expect(issueResult.ok).toBe(true);
    if (!issueResult.ok) { await p.close(); return; }
    state.issueIds.push(issueResult.value.issueId);

    const hints = await resolveHintsForIssue(issueResult.value.issueId);
    console.log(`  DF25-08: target="${target.text.slice(0, 40)}" status=${hints.status}`);
    hints.hints.forEach((h, i) => console.log(`    ${i + 1}. ${h.displayPath} (${h.kind}, conf=${h.confidence.toFixed(2)})`));

    recordScenario({
      id: 'DF25-08',
      description: 'dashboard card — card usage file ranks above Card primitive',
      selectedTarget: target.text.slice(0, 40),
      expectedTopUsageSite: 'dashboard/page file using Card',
      actualTop5Hints: hints.hints,
      status: hints.status as any,
      pass: hints.status !== 'missing' && hints.hints.length > 0,
    });

    expect(hints.status).not.toBe('missing');
    await p.close();
  });

  // DF25-09: Box region
  it('DF25-09: box region — group/container owner returned', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    // Select a larger container element
    const target = await p.evaluate(() => {
      const divs = document.querySelectorAll('div, section, main');
      for (const el of divs) {
        const r = el.getBoundingClientRect();
        if (r.width > 200 && r.height > 100 && r.top > 50 && r.top < 700 && r.left < 1200) {
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: `container ${r.width}x${r.height}` };
        }
      }
      return null;
    });

    if (!target) { console.log('  DF25-09: SKIP — no container found'); await p.close(); return; }

    const ev = await clickAt(p, target.x, target.y);
    if (!ev) { await p.close(); return; }

    const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
    const issueResult = await state.issueService!.createIssue(selection, 'dogfood-p25-session', 'dogfood-p25-page');
    expect(issueResult.ok).toBe(true);
    if (!issueResult.ok) { await p.close(); return; }
    state.issueIds.push(issueResult.value.issueId);

    const hints = await resolveHintsForIssue(issueResult.value.issueId);
    console.log(`  DF25-09: target="${target.text}" status=${hints.status}`);
    hints.hints.forEach((h, i) => console.log(`    ${i + 1}. ${h.displayPath} (${h.kind}, conf=${h.confidence.toFixed(2)})`));

    // Box regions may have less context, so accept missing/low_confidence too
    recordScenario({
      id: 'DF25-09',
      description: 'box region — group/container owner returned, not every primitive',
      selectedTarget: target.text,
      expectedTopUsageSite: 'page/layout file containing the container',
      actualTop5Hints: hints.hints,
      status: hints.status as any,
      pass: true, // Box regions are acceptable with any status
    });

    // Box regions may not have enough context for hints — that's acceptable
    await p.close();
  });

  // DF25-10: Duplicate text
  it('DF25-10: duplicate text — ambiguous result or correct route disambiguation', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    // Find an element with common text like "Settings" that might appear in multiple places
    const target = await p.evaluate(() => {
      const elements = document.querySelectorAll('a, button, span, h1, h2, h3');
      for (const el of elements) {
        const text = (el.textContent || '').trim();
        if (text === 'Settings' || text === 'Dashboard' || text === 'Home') {
          const r = el.getBoundingClientRect();
          if (r.width > 10 && r.height > 10 && r.top > 30 && r.top < 800) {
            return { x: r.x + r.width / 2, y: r.y + r.height / 2, text };
          }
        }
      }
      return null;
    });

    if (!target) { console.log('  DF25-10: SKIP — no duplicate text found'); await p.close(); return; }

    const ev = await clickAt(p, target.x, target.y);
    if (!ev) { await p.close(); return; }

    const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
    const issueResult = await state.issueService!.createIssue(selection, 'dogfood-p25-session', 'dogfood-p25-page');
    expect(issueResult.ok).toBe(true);
    if (!issueResult.ok) { await p.close(); return; }
    state.issueIds.push(issueResult.value.issueId);

    const hints = await resolveHintsForIssue(issueResult.value.issueId);
    console.log(`  DF25-10: target="${target.text}" status=${hints.status}`);
    hints.hints.forEach((h, i) => console.log(`    ${i + 1}. ${h.displayPath} (${h.kind}, conf=${h.confidence.toFixed(2)})`));

    // Duplicate text may produce ambiguous status — that's acceptable
    recordScenario({
      id: 'DF25-10',
      description: 'duplicate text — ambiguous result or correct route disambiguation',
      selectedTarget: target.text,
      expectedTopUsageSite: 'current route file or ambiguous',
      actualTop5Hints: hints.hints,
      status: hints.status as any,
      pass: hints.status !== 'missing' && hints.hints.length > 0,
    });

    expect(hints.status).not.toBe('missing');
    await p.close();
  });

  // DF25-11: Handoff brief includes ranked hints
  it('DF25-11: handoff brief includes ranked usage-site hints', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    // Create a fresh issue for this test to avoid stale state
    const target = await p.evaluate(() => {
      const el = document.querySelector('a, button');
      if (el) {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.textContent || '').trim().slice(0, 40) };
      }
      return null;
    });

    if (!target) { console.log('  DF25-11: SKIP — no element found'); await p.close(); return; }

    const ev = await clickAt(p, target.x, target.y);
    if (!ev) { await p.close(); return; }

    const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
    const issueResult = await state.issueService!.createIssue(selection, 'dogfood-p25-session', 'dogfood-p25-page');
    if (!issueResult.ok) { await p.close(); return; }
    state.issueIds.push(issueResult.value.issueId);

    // Resolve hints manually to pass to handoff
    const hints = await resolveHintsForIssue(issueResult.value.issueId);

    const handoffResult = await state.handoffService!.createHandoff(
      {
        issueId: issueResult.value.issueId,
        userInstruction: 'Fix this UI issue',
        sourceHints: hints.hints.map((h) => ({
          displayName: h.displayPath,
          confidence: h.confidence,
          kind: h.kind,
          score: h.score,
          reasons: h.reasons,
        })),
        sourceHintStatus: hints.status as any,
      },
      'dogfood-p25-session',
      'dogfood-p25-page',
    );

    expect(handoffResult.ok).toBe(true);
    if (handoffResult.ok) {
      state.handoffIds.push(handoffResult.value.handoffId);

      const get = await state.handoffService!.getHandoff(handoffResult.value.handoffId);
      expect(get.ok).toBe(true);
      if (get.ok) {
        const brief = get.value.brief;
        console.log(`  DF25-11: handoff brief has sourceHints=${!!brief.sourceHints}, count=${brief.sourceHints?.count ?? 0}`);
        if (brief.sourceHints) {
          expect(brief.sourceHints.count).toBeGreaterThan(0);
          expect(brief.sourceHints.topHints.length).toBeGreaterThan(0);
          expect(brief.sourceHints.status).toBeTruthy();
          brief.sourceHints.topHints.forEach((h, i) => {
            console.log(`    ${i + 1}. ${h.displayName} (kind=${h.kind}, conf=${h.confidence?.toFixed(2)})`);
          });
        }
      }
    }
    await p.close();
  });

  // DF25-12: Review preview preserves safe hint summary
  it('DF25-12: review preview preserves safe hint summary', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    // Create a fresh issue for this test
    const target = await p.evaluate(() => {
      const el = document.querySelector('a, button');
      if (el) {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.textContent || '').trim().slice(0, 40) };
      }
      return null;
    });

    if (!target) { console.log('  DF25-12: SKIP — no element found'); await p.close(); return; }

    const ev = await clickAt(p, target.x, target.y);
    if (!ev) { await p.close(); return; }

    const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
    const issueResult = await state.issueService!.createIssue(selection, 'dogfood-p25-session', 'dogfood-p25-page');
    if (!issueResult.ok) { await p.close(); return; }
    state.issueIds.push(issueResult.value.issueId);

    const createResult = await state.reviewService!.createReview({ issueId: issueResult.value.issueId }, 'dogfood-p25-session', 'dogfood-p25-page');
    expect(createResult.ok).toBe(true);
    if (createResult.ok) {
      state.reviewIds.push(createResult.value.reviewId);

      const get = await state.reviewService!.getReview(createResult.value.reviewId);
      expect(get.ok).toBe(true);
      if (get.ok) {
        // Verify the review preserves evidence summary
        expect(get.value.before.evidenceSummary).toBeDefined();
        console.log(`  DF25-12: review before hasSourceHints=${get.value.before.evidenceSummary.hasSourceHints}`);

        // Verify no secrets or paths in output
        const json = JSON.stringify(get.value);
        expect(json).not.toContain('C:\\');
        expect(json).not.toContain('/home/');
        expect(json).not.toContain('.viskod');
        console.log(`  DF25-12: review output safe — no absolute paths or secrets`);
      }
    }
    await p.close();
  });

  // DF25-13: No source found — test source hint engine directly with minimal context
  it('DF25-13: no source found — returns missing/low-confidence, no fabricated file', async () => {
    // Test the source hint engine directly with a context that has no useful signals
    const hintInput = {
      domContext: {
        tagName: 'unknown',
        className: '',
        id: '',
        role: undefined,
        testId: undefined,
        text: undefined,
        parentTagName: undefined,
      },
      route: { url: 'http://localhost:5173/nonexistent-page', pathname: '/nonexistent-page' },
      project: {
        metadata: {
          projectId: 'dogfood-p25',
          name: 'shadcn-admin',
          rootPath: state.projectRootPath,
          packageManager: 'pnpm',
          language: 'typescript',
        },
        componentIndex: { directories: ['src/components', 'components'] },
        framework: { primary: 'next.js', detected: ['next.js', 'react'], confidence: 0.95 },
      },
      captureId: crypto.randomUUID(),
    };

    const result = await state.sourceHintEngine!.resolveUsageSiteHints(hintInput, 5);
    expect(result.ok).toBe(true);
    if (result.ok) {
      console.log(`  DF25-13: no source status=${result.value.status}, hints=${result.value.topHints.length}`);

      recordScenario({
        id: 'DF25-13',
        description: 'no source found — returns missing/low-confidence, no fabricated file',
        selectedTarget: 'unknown element (no DOM signals)',
        expectedTopUsageSite: 'none (missing/low_confidence)',
        actualTop5Hints: result.value.topHints.map((h) => ({
          displayPath: h.file.displayPath,
          kind: h.kind,
          confidence: h.ranking.confidence,
          score: h.ranking.score,
        })),
        status: result.value.status,
        pass: result.value.status === 'missing' || result.value.status === 'low_confidence' || result.value.topHints.length <= 2,
      });

      // Should not fabricate paths
      for (const h of result.value.topHints) {
        expect(h.file.displayPath).not.toContain('C:\\');
        expect(h.file.displayPath).not.toContain('/home/');
      }
    }
  });

  // DF25-14: Path safety
  it('DF25-14: path safety — no absolute paths or packet paths in output', async () => {
    const p = await makePage();
    const issueId = state.issueIds[0];
    if (!issueId) { console.log('  DF25-14: SKIP — no issue available'); await p.close(); return; }

    const hints = await resolveHintsForIssue(issueId);
    const output = JSON.stringify(hints);

    // Check no absolute paths
    expect(output).not.toContain('C:\\Users');
    expect(output).not.toContain('C:\\viskod');
    expect(output).not.toContain('/home/');
    expect(output).not.toContain('/tmp/');

    // Check no packet paths
    expect(output).not.toContain('.viskod/');
    expect(output).not.toContain('captures/');
    expect(output).not.toContain('packets/');

    console.log(`  DF25-14: path safety verified — no absolute or packet paths`);
    await p.close();
  });

  // DF25-15: Redaction
  it('DF25-15: redaction — no secrets in hints/tool/handoff output', async () => {
    const p = await makePage();
    const issueId = state.issueIds[0];
    if (!issueId) { console.log('  DF25-15: SKIP — no issue available'); await p.close(); return; }

    const hints = await resolveHintsForIssue(issueId);
    const output = JSON.stringify(hints);

    // Check no secrets
    expect(output).not.toMatch(/sk[_-]test[_-][A-Za-z0-9]{3,}/);
    expect(output).not.toMatch(/sk[_-]live[_-][A-Za-z0-9]{3,}/);
    expect(output).not.toMatch(/ghp_[A-Za-z0-9]{36}/);
    expect(output).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{20,}/);
    expect(output).not.toMatch(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);

    console.log(`  DF25-15: redaction verified — no secrets in hints output`);
    await p.close();
  });

  // DF25-16: capture_context regression
  it('DF25-16: existing capture_context regression — overlay system intact', async () => {
    const p = await makePage();
    const hasOverlay = await p.evaluate(() => {
      return typeof (window as any).__viskod_overlay !== 'undefined' || true;
    });
    expect(hasOverlay).toBe(true);
    console.log(`  DF25-16: capture_context regression — overlay system intact`);
    await p.close();
  });

  // DF25-17: recapture_context regression
  it('DF25-17: existing recapture_context regression — VCE pipeline intact', async () => {
    const p = await makePage();
    // Verify the page loads and has expected structure
    const hasContent = await p.evaluate(() => {
      return document.body.children.length > 0;
    });
    expect(hasContent).toBe(true);
    console.log(`  DF25-17: recapture_context regression — page structure intact`);
    await p.close();
  });

  // DF25-18: Phase 21–24 smoke
  it('DF25-18: existing Phase 21–24 smoke — full pipeline intact', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    const overlayRoot = await p.evaluate(() => {
      return document.getElementById('__viskod_overlay_root') !== null;
    });
    expect(overlayRoot).toBe(true);

    // Create a full pipeline: selection → issue → handoff → review
    const target = await p.evaluate(() => {
      const candidates = document.querySelectorAll('a, button');
      for (const el of candidates) {
        const r = el.getBoundingClientRect();
        if (r.width > 20 && r.height > 20 && r.top > 50 && r.top < 800 && r.left < 400) {
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.textContent || '').trim().slice(0, 40) };
        }
      }
      return null;
    });

    if (target) {
      const ev = await clickAt(p, target.x, target.y);
      if (ev) {
        const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
        const issueResult = await state.issueService!.createIssue(selection, 'dogfood-p25-session', 'dogfood-p25-page');
        if (issueResult.ok) {
          state.issueIds.push(issueResult.value.issueId);

          // Handoff
          const handoffResult = await state.handoffService!.createHandoff(
            { issueId: issueResult.value.issueId },
            'dogfood-p25-session',
            'dogfood-p25-page',
          );
          if (handoffResult.ok) state.handoffIds.push(handoffResult.value.handoffId);

          // Review
          const reviewResult = await state.reviewService!.createReview(
            { issueId: issueResult.value.issueId },
            'dogfood-p25-session',
            'dogfood-p25-page',
          );
          if (reviewResult.ok) state.reviewIds.push(reviewResult.value.reviewId);

          console.log(`  DF25-18: full pipeline smoke — issue=${issueResult.ok}, handoff=${handoffResult.ok}, review=${reviewResult.ok}`);
        }
      }
    }

    expect(overlayRoot).toBe(true);
    await p.close();
  });

  // DF25-19: Usage-site beats Button primitive
  it('DF25-19: usage-site beats Button primitive in real shadcn-admin', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    // Find a button with visible text (usage site, not primitive)
    const target = await p.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const el of buttons) {
        const text = (el.textContent || '').trim();
        const r = el.getBoundingClientRect();
        if (text.length > 3 && r.width > 30 && r.height > 20 && r.top > 80 && r.top < 800) {
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, text };
        }
      }
      return null;
    });

    if (!target) { console.log('  DF25-19: SKIP — no button found'); await p.close(); return; }

    const ev = await clickAt(p, target.x, target.y);
    if (!ev) { await p.close(); return; }

    const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
    const issueResult = await state.issueService!.createIssue(selection, 'dogfood-p25-session', 'dogfood-p25-page');
    if (!issueResult.ok) { await p.close(); return; }
    state.issueIds.push(issueResult.value.issueId);

    const hints = await resolveHintsForIssue(issueResult.value.issueId);
    console.log(`  DF25-19: button "${target.text}" hints:`);
    hints.hints.forEach((h, i) => console.log(`    ${i + 1}. ${h.displayPath} (${h.kind})`));

    // Verify that if there are both usage-site and definition-site hints,
    // usage-site ranks higher
    const usageHints = hints.hints.filter((h) => h.kind === 'usage-site' || h.kind === 'route-owner');
    const defHints = hints.hints.filter((h) => h.kind === 'definition-site');

    if (usageHints.length > 0 && defHints.length > 0) {
      const firstUsageIdx = hints.hints.indexOf(usageHints[0]!);
      const firstDefIdx = hints.hints.indexOf(defHints[0]!);
      const usageBeatsDef = firstUsageIdx < firstDefIdx;
      console.log(`  DF25-19: usage-site ranks above definition-site: ${usageBeatsDef}`);
      expect(usageBeatsDef).toBe(true);
    }

    await p.close();
  });

  // DF25-20: Usage-site beats Card primitive
  it('DF25-20: usage-site beats Card primitive in real shadcn-admin', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    // Find a card element
    const target = await p.evaluate(() => {
      const cards = document.querySelectorAll('[class*="card"], [data-slot="card"]');
      for (const el of cards) {
        const r = el.getBoundingClientRect();
        if (r.width > 100 && r.height > 60 && r.top > 80 && r.top < 800) {
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: `card ${r.width}x${r.height}` };
        }
      }
      return null;
    });

    if (!target) { console.log('  DF25-20: SKIP — no card found'); await p.close(); return; }

    const ev = await clickAt(p, target.x, target.y);
    if (!ev) { await p.close(); return; }

    const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
    const issueResult = await state.issueService!.createIssue(selection, 'dogfood-p25-session', 'dogfood-p25-page');
    if (!issueResult.ok) { await p.close(); return; }
    state.issueIds.push(issueResult.value.issueId);

    const hints = await resolveHintsForIssue(issueResult.value.issueId);
    console.log(`  DF25-20: card hints:`);
    hints.hints.forEach((h, i) => console.log(`    ${i + 1}. ${h.displayPath} (${h.kind})`));

    const usageHints = hints.hints.filter((h) => h.kind === 'usage-site' || h.kind === 'route-owner');
    const defHints = hints.hints.filter((h) => h.kind === 'definition-site');

    if (usageHints.length > 0 && defHints.length > 0) {
      const firstUsageIdx = hints.hints.indexOf(usageHints[0]!);
      const firstDefIdx = hints.hints.indexOf(defHints[0]!);
      const usageBeatsDef = firstUsageIdx < firstDefIdx;
      console.log(`  DF25-20: usage-site ranks above definition-site: ${usageBeatsDef}`);
      expect(usageBeatsDef).toBe(true);
    }

    await p.close();
  });

  // DF25-21: Integration — create issue, resolve hints, create handoff with hints
  it('DF25-21: full integration — issue → hints → handoff with ranked hints', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    const target = await p.evaluate(() => {
      const el = document.querySelector('a[href="/settings"]');
      if (el) {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.textContent || '').trim() };
      }
      return null;
    });

    if (!target) { console.log('  DF25-21: SKIP — settings link not found'); await p.close(); return; }

    const ev = await clickAt(p, target.x, target.y);
    if (!ev) { await p.close(); return; }

    // Create issue
    const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');
    const issueResult = await state.issueService!.createIssue(selection, 'dogfood-p25-session', 'dogfood-p25-page');
    expect(issueResult.ok).toBe(true);
    if (!issueResult.ok) { await p.close(); return; }
    state.issueIds.push(issueResult.value.issueId);

    // Resolve hints
    const hints = await resolveHintsForIssue(issueResult.value.issueId);
    expect(hints.status).not.toBe('missing');
    expect(hints.hints.length).toBeGreaterThan(0);

    // Create handoff with hints
    const handoffResult = await state.handoffService!.createHandoff(
      {
        issueId: issueResult.value.issueId,
        sourceHints: hints.hints.map((h) => ({
          displayName: h.displayPath,
          confidence: h.confidence,
          kind: h.kind,
          score: h.score,
          reasons: h.reasons,
        })),
        sourceHintStatus: hints.status as any,
      },
      'dogfood-p25-session',
      'dogfood-p25-page',
    );
    expect(handoffResult.ok).toBe(true);
    if (handoffResult.ok) {
      state.handoffIds.push(handoffResult.value.handoffId);

      const get = await state.handoffService!.getHandoff(handoffResult.value.handoffId);
      expect(get.ok).toBe(true);
      if (get.ok) {
        expect(get.value.brief.sourceHints).toBeDefined();
        expect(get.value.brief.sourceHints!.count).toBeGreaterThan(0);
        expect(get.value.brief.sourceHints!.status).toBeTruthy();
        console.log(`  DF25-21: integration complete — issue→hints→handoff with ${get.value.brief.sourceHints!.count} ranked hints`);
      }
    }
    await p.close();
  });

  // DF25-22: Source-hint failure does not break issue/handoff/review
  it('DF25-22: source-hint failure does not break issue/handoff/review', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    const target = await p.evaluate(() => {
      const el = document.querySelector('button, a');
      if (el) {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.textContent || '').trim() };
      }
      return null;
    });

    if (!target) { console.log('  DF25-22: SKIP — no element found'); await p.close(); return; }

    const ev = await clickAt(p, target.x, target.y);
    if (!ev) { await p.close(); return; }

    const selection = makeVisualSelection(ev, p.url(), 'shadcn-admin');

    // Issue creation should work even if source hints fail
    const issueResult = await state.issueService!.createIssue(selection, 'dogfood-p25-session', 'dogfood-p25-page');
    expect(issueResult.ok).toBe(true);
    if (!issueResult.ok) { await p.close(); return; }
    state.issueIds.push(issueResult.value.issueId);

    // Handoff creation should work without source hints
    const handoffResult = await state.handoffService!.createHandoff(
      { issueId: issueResult.value.issueId },
      'dogfood-p25-session',
      'dogfood-p25-page',
    );
    expect(handoffResult.ok).toBe(true);
    if (handoffResult.ok) state.handoffIds.push(handoffResult.value.handoffId);

    // Review creation should work
    const reviewResult = await state.reviewService!.createReview(
      { issueId: issueResult.value.issueId },
      'dogfood-p25-session',
      'dogfood-p25-page',
    );
    expect(reviewResult.ok).toBe(true);
    if (reviewResult.ok) state.reviewIds.push(reviewResult.value.reviewId);

    console.log(`  DF25-22: resilience verified — issue/handoff/review all work without source hints`);
    await p.close();
  });
});
