import type { ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_URL, ROOT, STUDIO_URL, killTree, sleep, spawnProc, waitForHttp } from './harness';

/**
 * Phase 28 (VISKOD-AUDIT-020): the critical Studio journey is driven through
 * the REAL rendered UI in a real browser. No central workflow action is
 * replaced by a direct POST: navigation, report start, selection acceptance,
 * description entry, and "Prepare agent handoff" are all real clicks and
 * form fills against http://127.0.0.1:3001.
 *
 * Selection itself flows through the product's overlay event path: the
 * fixture dispatches the same `overlay:element-clicked` message a real
 * overlay click produces (the Studio-driven app page is inside Studio's own
 * browser, which this test cannot click directly).
 */

const ISSUES_DIR = join(ROOT, '.viskod', 'issues');
const HANDOFFS_DIR = join(ROOT, '.viskod', 'handoffs');

const TARGET_A = 'target-card-description';
const TARGET_B = 'phase12-source-submit-button';
const SIMULATE_QUERY = `?viskodSimulate=${TARGET_A}`;

let fixtureProc: ChildProcess | null = null;
let studioProc: ChildProcess | null = null;
let browser: Browser;
let page: Page;

// ---------------------------------------------------------------------------
// Persistence helpers (exactly-one assertions against the local store)
// ---------------------------------------------------------------------------

function clearPersistence(): void {
  for (const dir of [ISSUES_DIR, HANDOFFS_DIR]) {
    rmSync(dir, { recursive: true, force: true });
  }
}

function listEntityDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function countIssues(): number {
  return listEntityDirs(ISSUES_DIR).length;
}

function countHandoffs(): number {
  return listEntityDirs(HANDOFFS_DIR).length;
}

function latestId(dir: string): string {
  const ids = listEntityDirs(dir);
  if (ids.length === 0) throw new Error(`no persisted entity under ${dir}`);
  const first = ids[0];
  if (!first) throw new Error(`no persisted entity under ${dir}`);
  return first;
}

interface PersistedIssue {
  issueId: string;
  source?: { selectionSnapshot?: { targets?: Array<{ selector?: string }> } };
}

function loadLatestIssue(): PersistedIssue {
  return JSON.parse(
    readFileSync(join(ISSUES_DIR, latestId(ISSUES_DIR), 'issue.json'), 'utf-8'),
  ) as PersistedIssue;
}

function loadLatestHandoff(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(HANDOFFS_DIR, latestId(HANDOFFS_DIR), 'handoff.json'), 'utf-8'),
  );
}

// ---------------------------------------------------------------------------
// UI driver helpers — real rendered controls only
// ---------------------------------------------------------------------------

async function openApp(url: string): Promise<void> {
  // viskodReset clears the fixture's simulated-target sessionStorage so every
  // test starts with a clean selection simulation state.
  const sep = url.includes('?') ? '&' : '?';
  await page.fill('#app-url', `${url}${sep}viskodReset=1`);
  await page.click('#open-app-form button[type="submit"]');
  await page.waitForSelector('#report-start', { timeout: 30000 });
}

/** Reset the server-side workflow and re-render the UI at idle between tests. */
async function resetToIdle(): Promise<void> {
  await fetch(`${STUDIO_URL}/workflow/cancel`, { method: 'POST' }).catch(() => undefined);
  clearPersistence();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app-url', { timeout: 10000 });
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
  await page.waitForSelector('[data-stage="describe"]');
}

async function fillDescription(problem: string, expected: string): Promise<void> {
  await page.fill('#problem', problem);
  await page.fill('#expected', expected);
}

async function submitPrepare(): Promise<void> {
  await page.click('#issue-form button[type="submit"]');
  await page.waitForSelector('[data-stage="handoff_ready"]', { timeout: 30000 });
}

async function workflowState(): Promise<{
  stage: string;
  selection?: { label?: string; targetCount?: number } | null;
  issueId?: string;
  handoffId?: string;
}> {
  const res = await fetch(`${STUDIO_URL}/workflow/state`);
  const state = (await res.json()) as {
    stage: string;
    selection?: { label?: string; targetCount?: number } | null;
    issueId?: string;
    handoffId?: string;
  };
  return state;
}

async function selectionLabelStableFor(ms: number, expectedStage: string): Promise<boolean> {
  const start = Date.now();
  let firstLabel: string | null = null;
  while (Date.now() - start < ms) {
    const state = await workflowState();
    if (state.stage !== expectedStage) return false;
    if (firstLabel === null) {
      firstLabel = state.selection?.label ?? null;
    } else if (state.selection?.label !== firstLabel) {
      return false;
    }
    await sleep(250);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  clearPersistence();
  fixtureProc = spawnProc('node', ['examples/phase12-source-hint-app/server.cjs']);
  studioProc = spawnProc(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
    'tsx',
    'apps/studio/src/index.ts',
  ]);
  await waitForHttp(`${FIXTURE_URL}/`, 20000, 'fixture server');
  await waitForHttp(`${STUDIO_URL}/health`, 120000, 'Studio server');

  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${STUDIO_URL}/`, { waitUntil: 'domcontentloaded' });
}, 180000);

afterAll(async () => {
  if (browser) await browser.close().catch(() => undefined);
  killTree(studioProc);
  killTree(fixtureProc);
  clearPersistence();
});

// ---------------------------------------------------------------------------
// Real rendered-UI journey (VISKOD-AUDIT-001 / VISKOD-AUDIT-020)
// ---------------------------------------------------------------------------

describe('Studio real-UI journey', () => {
  it('completes selection → describe → prepare handoff → handoff_ready through the rendered UI', async () => {
    await resetToIdle();
    await openApp(`${FIXTURE_URL}/${SIMULATE_QUERY}&viskodAfterAccept=${TARGET_B}`);
    await beginReport();
    await waitForSelectionEnabled();
    expect(await page.locator('.target-summary').textContent()).toContain(
      'target for source hint validation',
    );

    await acceptSelection();

    // Overlay lifecycle (VISKOD-AUDIT-013): after acceptance the fixture
    // posts one more overlay:element-clicked for a DIFFERENT element. If
    // polling/interception were still alive the frozen selection would be
    // replaced; a stable selection proves the overlay stopped.
    const stable = await selectionLabelStableFor(4000, 'describe');
    expect(stable).toBe(true);

    await fillDescription(
      'The card description is hidden',
      'The description should be visible below the title',
    );
    await submitPrepare();

    // The rendered handoff-ready state exposes the handoff ID.
    expect(await page.locator('[data-stage="handoff_ready"]').textContent()).toContain(
      'Handoff ID:',
    );

    // Exactly one persisted issue and one corresponding handoff.
    expect(countIssues()).toBe(1);
    expect(countHandoffs()).toBe(1);

    const issue = loadLatestIssue();
    const handoff = loadLatestHandoff();
    expect(handoff.issueId).toBe(issue.issueId);
    // The handoff references the intended selected target/issue.
    expect(issue.source?.selectionSnapshot?.targets?.[0]?.selector).toBe(
      `[data-testid="${TARGET_A}"]`,
    );
    expect(
      (handoff.brief as { selectedTarget?: { label?: string } }).selectedTarget?.label,
    ).toContain('target for source hint validation');
  });

  it('Reselect replaces target A with target B and the new issue references B only', async () => {
    await resetToIdle();
    await openApp(`${FIXTURE_URL}/?viskodSimulate=${TARGET_A}&viskodSimulate=${TARGET_B}`);
    await beginReport();
    await waitForSelectionEnabled();
    expect(await page.locator('.target-summary').textContent()).toContain(
      'target for source hint validation',
    );
    await acceptSelection();

    await page.click('[data-action="reselect"]');
    await page.waitForSelector('[data-stage="selecting"]');
    // The new selection session produces target B (the submit button).
    await waitForSelectionEnabled();
    expect(await page.locator('.target-summary').textContent()).toContain('Submit');

    await acceptSelection();
    await fillDescription('The button is misaligned', 'It should be centered');
    await submitPrepare();

    const issue = loadLatestIssue();
    expect(issue.source?.selectionSnapshot?.targets?.[0]?.selector).toBe(`#${TARGET_B}`);
    expect(JSON.stringify(issue.source?.selectionSnapshot?.targets ?? [])).not.toContain(TARGET_A);
  });

  it('rapid repeated submit creates exactly one issue and one handoff', async () => {
    await resetToIdle();
    await openApp(`${FIXTURE_URL}/${SIMULATE_QUERY}`);
    await beginReport();
    await waitForSelectionEnabled();
    await acceptSelection();
    await fillDescription('Duplicate submission guard', 'Exactly one issue should exist');

    // Two synchronous UI clicks plus one concurrent HTTP request.
    await page.evaluate(() => {
      const btn = document.querySelector(
        '#issue-form button[type="submit"]',
      ) as HTMLButtonElement | null;
      btn?.click();
      btn?.click();
    });
    await fetch(`${STUDIO_URL}/workflow/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        problem: 'Duplicate submission guard',
        expected: 'Exactly one issue should exist',
      }),
    }).catch(() => undefined);

    await page.waitForSelector('[data-stage="handoff_ready"]', { timeout: 30000 });
    expect(countIssues()).toBe(1);
    expect(countHandoffs()).toBe(1);
  });

  it('a new report never reuses the previous target', async () => {
    await resetToIdle();
    await openApp(`${FIXTURE_URL}/?viskodSimulate=${TARGET_A}&viskodSimulate=${TARGET_B}`);
    await beginReport();
    await waitForSelectionEnabled();
    await acceptSelection(); // describe with A
    await page.click('[data-action="cancel"]');
    await page.waitForSelector('[data-stage="idle"]');

    // Fresh report: no stale target summary is rendered.
    await page.click('#report-start');
    await page.waitForSelector('[data-stage="selecting"]');
    expect(await page.locator('.target-summary').count()).toBe(0);

    // The new selection session produces B; the old A selection is gone.
    await waitForSelectionEnabled();
    expect(await page.locator('.target-summary').textContent()).toContain('Submit');
    await acceptSelection();
    await fillDescription('Isolation check', 'This report must reference B only');
    await submitPrepare();

    const issue = loadLatestIssue();
    expect(issue.source?.selectionSnapshot?.targets?.[0]?.selector).toBe(`#${TARGET_B}`);
    expect(JSON.stringify(issue.source?.selectionSnapshot?.targets ?? [])).not.toContain(TARGET_A);
  });

  it('invalid and ambiguous selectors fail closed against the live DOM', async () => {
    const post = async (body: unknown): Promise<{ ok: boolean; error?: string }> => {
      const res = await fetch(`${STUDIO_URL}/select/element`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return (await res.json()) as { ok: boolean; error?: string };
    };

    const missing = await post({ selector: '.no-such-element-xyz' });
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain('selector');

    const malformed = await post({ selector: 'div[' });
    expect(malformed.ok).toBe(false);

    // Multiple matches with no geometry anchor: ambiguous, not first-match.
    const ambiguous = await post({ selector: 'div' });
    expect(ambiguous.ok).toBe(false);
  });
});
