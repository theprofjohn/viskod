import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeProjectWorkspace, runSmoke } from '../../packages/setup/src/index';
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
let mcpProc: ChildProcess | null = null;
let mcpOutput = '';
let mcpRpcId = 0;
let mcpInitialized = false;
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

async function freshMcpCall(
  method: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  if (!mcpProc) {
    mcpProc = spawnProc(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
      'tsx',
      'packages/mcp-server/src/entry.ts',
    ]);
    mcpProc.stdout?.on('data', (chunk: Buffer) => {
      mcpOutput += chunk.toString();
    });
  }
  const id = ++mcpRpcId;
  mcpProc.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  const started = Date.now();
  while (Date.now() - started < 30000) {
    for (const line of mcpOutput.split('\n')) {
      try {
        const response = JSON.parse(line) as Record<string, unknown>;
        if (response.id === id) return response;
      } catch {
        // Wait for a complete JSON-RPC line.
      }
    }
    await sleep(50);
  }
  throw new Error(`MCP response timeout for ${method}`);
}

async function freshMcpToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!mcpInitialized) {
    await freshMcpCall('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'phase35-final-journey', version: '1.0.0' },
    });
    mcpProc?.stdin?.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`,
    );
    mcpInitialized = true;
  }
  const response = await freshMcpCall('tools/call', { name, arguments: args });
  const content = (response.result as { content?: Array<{ text?: string }> } | undefined)?.content;
  const text = content?.[0]?.text;
  if (!text) throw new Error(`MCP tool ${name} returned no content`);
  return JSON.parse(text) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// UI driver helpers — real rendered controls only
// ---------------------------------------------------------------------------

async function openApp(url: string): Promise<void> {
  // viskodReset clears the fixture's simulated-target sessionStorage so every
  const sep = url.includes('?') ? '&' : '?';
  const targetUrl = `${url}${sep}viskodReset=1`;
  await page.fill('#app-url', targetUrl);
  await page.click('#open-app-form button[type="submit"]');
  const expectedUrl = targetUrl;
  await page.waitForFunction(
    async (target) => {
      const response = await fetch('/state');
      const state = (await response.json()) as {
        pageUrl?: string;
        workflow?: { stage?: string };
      };
      return state.pageUrl === target && state.workflow?.stage === 'idle';
    },
    expectedUrl,
    { timeout: 30000 },
  );
  await page.waitForFunction(() => document.querySelector('#report-start') !== null, undefined, {
    timeout: 30000,
  });
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
  killTree(mcpProc);
  killTree(studioProc);
  killTree(fixtureProc);
  forceKillOwnedProcess(mcpProc);
  forceKillOwnedProcess(studioProc);
  forceKillOwnedProcess(fixtureProc);
  clearPersistence();
});
function forceKillOwnedProcess(proc: ChildProcess | null): void {
  const pid = proc?.pid;
  if (pid === undefined) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // The owned process group already exited.
  }
}

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

  it('completes the rendered Studio report flow with keyboard controls and preserves typing focus on benign renders', async () => {
    await resetToIdle();
    await openApp(`${FIXTURE_URL}/${SIMULATE_QUERY}`);

    // Every Studio action here uses focus + keyboard activation. Selection
    // arrives through the product's real overlay bridge; this test never
    // dispatches overlay events or clicks a target.
    await beginReport();
    await waitForSelectionEnabled();
    await page.locator('#selection-accept').press('Enter');
    await page.waitForSelector('[data-stage="describe"]');

    await page.locator('#problem').focus();
    await page.keyboard.type('Keyboard focus must survive a routine render');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('problem');

    await page.evaluate(async () => {
      await fetch('/settings/visual-review-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy: 'disabled' }),
      });
    });
    await page.waitForFunction(() => document.activeElement?.id === 'problem');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('problem');

    await page.locator('#expected').focus();
    await page.keyboard.type('The focused field remains focused');
    await page.locator('#issue-form button[type="submit"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-stage="handoff_ready"]', { timeout: 30000 });
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-action'))).toBe(
      'verify-start',
    );
  });
  it('proves keyboard B identity through rendered handoff and persisted evidence', async () => {
    await resetToIdle();
    await openApp(`${FIXTURE_URL}/?viskodSimulate=${TARGET_B}`);
    await beginReport();
    await waitForSelectionEnabled();
    await page.locator('#selection-accept').press('Space');
    await page.waitForSelector('[data-stage="describe"]');
    expect(await page.locator('.target-summary').textContent()).toContain('Submit');
    await fillDescription('Keyboard candidate B is broken', 'Candidate B is usable');
    await page.locator('#issue-form button[type="submit"]').press('Enter');
    await page.waitForSelector('[data-stage="handoff_ready"]', { timeout: 30000 });

    const issue = loadLatestIssue();
    const handoff = loadLatestHandoff();
    const issueText = JSON.stringify(issue);
    const handoffText = JSON.stringify(handoff);
    expect(issue.source?.selectionSnapshot?.targets?.[0]?.selector).toBe(`#${TARGET_B}`);
    expect(issueText).toContain(TARGET_B);
    expect(handoffText).toContain(TARGET_B);
    expect(issueText).not.toContain(TARGET_A);
    expect(handoffText).not.toContain(TARGET_A);
  });

  it('cancels selection with Escape, restores focus, and reselects B without stale A', async () => {
    await resetToIdle();
    await openApp(`${FIXTURE_URL}/?viskodSimulate=${TARGET_A}&viskodSimulate=${TARGET_B}`);
    await beginReport();
    await waitForSelectionEnabled();
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-stage="idle"]');
    await page.waitForFunction(() => document.activeElement?.id === 'report-start');
    expect(
      await page.locator('#report-start').evaluate((element) => element === document.activeElement),
    ).toBe(true);
    expect(await page.locator('[data-viskod-overlay]').count()).toBe(0);
    expect(await workflowState()).toMatchObject({ stage: 'idle', selection: null });

    await page.locator('#report-start').press('Enter');
    await page.waitForSelector('[data-stage="selecting"]');
    await waitForSelectionEnabled();
    await page.locator('#selection-accept').press('Enter');
    await page.waitForSelector('[data-stage="describe"]');
    expect(await page.locator('.target-summary').textContent()).toContain('Submit');
    await fillDescription('Reselect B', 'Only B remains selected');
    await page.locator('#issue-form button[type="submit"]').press('Enter');
    await page.waitForSelector('[data-stage="handoff_ready"]', { timeout: 30000 });
    const issue = loadLatestIssue();
    const targetEvidence = JSON.stringify(issue.source?.selectionSnapshot?.targets ?? []);
    expect(targetEvidence).not.toContain(TARGET_A);
  });

  it('announces rendered transitions and typed errors without hover spam', async () => {
    await resetToIdle();
    await openApp(`${FIXTURE_URL}/?viskodSimulate=${TARGET_B}`);
    await beginReport();
    await waitForSelectionEnabled();
    const selectingAnnouncement = await page.locator('#status-live').textContent();
    expect(selectingAnnouncement).toContain('Select the target');
    await page.locator('#selection-accept').press('Enter');
    await page.waitForSelector('[data-stage="describe"]');
    expect(await page.locator('#status-live').textContent()).toContain('Target selected');

    const beforeHover = await page.locator('#status-live').textContent();
    await page.mouse.move(10, 10);
    await sleep(250);
    expect(await page.locator('#status-live').textContent()).toBe(beforeHover);

    await fillDescription('Live announcement issue', 'Handoff announcement is bounded');
    await page.locator('#issue-form button[type="submit"]').press('Enter');
    await page.waitForSelector('[data-stage="handoff_ready"]', { timeout: 30000 });
    expect(await page.locator('#status-live').textContent()).toContain('Handoff ready');

    await resetToIdle();
    await openApp(`${FIXTURE_URL}/?viskodReset=1`);
    await beginReport();
    await page.evaluate(async () => {
      await fetch('/workflow/selection/accept', { method: 'POST' });
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[role="alert"]');
    const alert = await page.locator('[role="alert"]').textContent();
    expect(alert).toBeTruthy();
    expect(alert).not.toMatch(/stack|\/home\/|packet|selector/i);
    expect(await page.locator('[data-action="cancel"]').count()).toBe(1);
    expect(await page.locator('#status-live').textContent()).toContain(alert ?? '');
    expect(
      await page
        .locator('[role="alert"]')
        .evaluate((element) => element === document.activeElement),
    ).toBe(true);
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

  it('Phase 34 issue history supports edit archive reopen and fork through rendered controls', async () => {
    await resetToIdle();
    await openApp(`${FIXTURE_URL}/${SIMULATE_QUERY}`);
    await beginReport();
    await waitForSelectionEnabled();
    await acceptSelection();
    await fillDescription('History lifecycle issue', 'Expected result survives editing');
    await submitPrepare();
    const issueId = (await workflowState()).issueId;
    expect(issueId).toBeTruthy();

    await page.locator('#show-archived').press('Enter');
    await page.waitForSelector(`[data-issue-id="${issueId}"]`, { timeout: 10000 });
    const entry = page.locator(`[data-issue-id="${issueId}"]`).first();
    await entry.press('Enter');
    await page.waitForSelector('#issue-detail:not([hidden])');
    await page.fill('#issue-edit-description', 'Edited durable intent');
    await page.locator('[data-detail-action="save"]').press('Enter');
    const edited = await fetch(`${STUDIO_URL}/issues/${issueId}`);
    const editedData = (await edited.json()) as { issue?: { description?: string } };
    expect(editedData.issue?.description).toBe('Edited durable intent');

    await page.locator('[data-detail-action="archive"]').press('Enter');
    await page.waitForFunction(async (id) => {
      const response = await fetch(`/issues/${id}`);
      const data = (await response.json()) as { issue?: { status?: string } };
      return data.issue?.status === 'archived';
    }, issueId);
    await page.locator('#show-archived').press('Enter');
    await page.waitForSelector(`[data-issue-id="${issueId}"][data-issue-action="reopen"]`);
    await page.locator(`[data-issue-id="${issueId}"][data-issue-action="reopen"]`).press('Enter');

    const beforeFork = countIssues();
    const forkButton = page.locator(`[data-issue-id="${issueId}"][data-issue-action="fork"]`);
    await forkButton.press('Enter');

    await page.waitForFunction(async (expected) => {
      const response = await fetch('/issues?limit=50&archived=true');
      const data = (await response.json()) as { issues?: unknown[] };
      return (data.issues?.length ?? 0) >= expected;
    }, beforeFork + 1);
    expect(countIssues()).toBe(beforeFork + 1);

    const lineageResponse = await fetch(`${STUDIO_URL}/issues?limit=50&archived=true`);
    const lineageData = (await lineageResponse.json()) as {
      issues?: Array<{ issueId: string; parentIssueId?: string }>;
    };
    const child = lineageData.issues?.find((candidate) => candidate.parentIssueId === issueId);
    expect(child?.issueId).toBeTruthy();
    await page
      .locator(`[data-issue-id="${child?.issueId}"][data-issue-action="open"]`)
      .press('Enter');
    await page.waitForSelector('#issue-detail:not([hidden])');
    await page.waitForFunction(
      () =>
        document
          .querySelector('#issue-detail')
          ?.textContent?.includes('Forked from parent issue') === true,
      undefined,
      { timeout: 10000 },
    );
    expect(await page.locator('#issue-detail').textContent()).toContain('Forked from parent issue');
  });
  it('final integrated journey spans setup, fresh-agent retrieval, mutation, review, and resume', async () => {
    const isolatedProject = mkdtempSync(join(tmpdir(), 'viskod-phase35-final-'));
    const initialized = initializeProjectWorkspace({ projectRoot: isolatedProject });
    expect(initialized.ok).toBe(true);
    const setupSmoke = await runSmoke({ projectRoot: isolatedProject, limitedMode: true });
    expect(setupSmoke.ok).toBe(true);
    if (setupSmoke.ok) expect(setupSmoke.value.status).toBe('pass');

    await resetToIdle();
    await openApp(`${FIXTURE_URL}/${SIMULATE_QUERY}&viskodAfterAccept=${TARGET_B}`);
    await beginReport();
    await waitForSelectionEnabled();
    await acceptSelection();
    await fillDescription(
      'The selected card is missing its description',
      'The description is visible',
    );
    await submitPrepare();

    const state = await workflowState();
    expect(state.issueId).toBeTruthy();
    expect(state.handoffId).toBeTruthy();
    const freshContext = await freshMcpToolCall('get_handoff_context', {
      handoffId: state.handoffId,
    });
    expect(freshContext.ok).toBe(true);
    expect(JSON.stringify(freshContext)).toContain(TARGET_A);

    await page.locator('[data-action="verify-start"]').click();
    await page.waitForSelector('[data-stage="verifying"]');
    await page.locator('[data-action="verify-recapture"]').click();
    await page.waitForSelector('[data-stage="review_ready"]', { timeout: 30000 });
    await page.fill('#decision-note', 'Verified after the fixture mutation.');
    await page.locator('[data-action="decision-accepted"]').click();
    await page.waitForSelector('[data-stage="decided"]');
    expect(await page.locator('[data-stage="decided"]').textContent()).toContain('accepted');

    killTree(studioProc);
    forceKillOwnedProcess(studioProc);
    studioProc = spawnProc(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
      'tsx',
      'apps/studio/src/index.ts',
    ]);
    await waitForHttp(`${STUDIO_URL}/health`, 120000, 'restarted Studio for final journey');
    await page.reload({ waitUntil: 'domcontentloaded' });
    const reopened = await page.evaluate(async (issueId) => {
      const response = await fetch(`/issues/${issueId}/open`, { method: 'POST' });
      return (await response.json()) as { ok?: boolean };
    }, state.issueId);
    expect(reopened.ok).toBe(true);
    await page.evaluate(async (url) => {
      await fetch('/navigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
    }, FIXTURE_URL);
    await page.waitForFunction(
      async (issueId) => {
        const response = await fetch('/workflow/state');
        const next = (await response.json()) as { stage?: string; issueId?: string };
        return next.stage === 'decided' && next.issueId === issueId;
      },
      state.issueId,
      { timeout: 30000 },
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      async (issueId) => {
        const response = await fetch('/workflow/state');
        const next = (await response.json()) as { stage?: string; issueId?: string };
        return next.stage === 'decided' && next.issueId === issueId;
      },
      state.issueId,
      { timeout: 30000 },
    );
    rmSync(isolatedProject, { recursive: true, force: true });
  });

  it('Phase 34 history survives a fresh Studio process and restores resumable handoff state', async () => {
    await resetToIdle();
    await openApp(`${FIXTURE_URL}/${SIMULATE_QUERY}`);
    await beginReport();
    await waitForSelectionEnabled();
    await acceptSelection();
    await fillDescription('Restart history issue', 'Resume from durable handoff');
    await submitPrepare();
    const issueId = (await workflowState()).issueId;
    expect(issueId).toBeTruthy();

    killTree(studioProc);
    studioProc = spawnProc(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
      'tsx',
      'apps/studio/src/index.ts',
    ]);
    await waitForHttp(`${STUDIO_URL}/health`, 120000, 'restarted Studio');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.click('#show-archived');
    await page.waitForSelector(`[data-issue-id="${issueId}"]`, { timeout: 10000 });
    await page.locator(`[data-issue-id="${issueId}"][data-issue-action="open"]`).click();
    await page.waitForSelector('#issue-detail:not([hidden])');

    await page.fill('#app-url', `${FIXTURE_URL}/?viskodReset=1`);
    await page.click('#open-app-form button[type="submit"]');
    await page.waitForSelector('[data-stage="handoff_ready"]', { timeout: 30000 });
    expect(await workflowState()).toMatchObject({ issueId });
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
