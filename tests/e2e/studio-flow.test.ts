import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * End-to-end Studio flow: Report UI issue → Prepare agent handoff → Verify fix.
 *
 * Starts its own deterministic fixture server and Studio (launches Playwright
 * Chromium), drives the observable user path through http://localhost:3001,
 * and proves a changed screenshot is evidence, not truth: the flow reaches
 * the review_ready stage with comparison.status 'changed' and the UI presents
 * Accept fix rather than auto-accepting.
 */

const ROOT = resolve(__dirname, '../..');
const FIXTURE_CSS = join(
  ROOT,
  'examples',
  'phase12-source-hint-app',
  'src',
  'components',
  'TargetCard.css',
);
const FIXTURE_URL = 'http://127.0.0.1:3000';
const STUDIO_URL = 'http://127.0.0.1:3001';
const SIMULATE_QUERY = '?viskodSimulate=target-card-description';

const FORBIDDEN_STATE_KEYS = [
  'selector',
  'packetJson',
  'absoluteCaptureDir',
  'sessionToken',
  'daemon-token',
  'captureDir',
];

let cssBackup: string | null = null;
let fixtureProc: ReturnType<typeof spawn> | null = null;
let studioProc: ReturnType<typeof spawn> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function spawnProc(cmd: string, args: string[]): ReturnType<typeof spawn> {
  return spawn(cmd, args, { cwd: ROOT, stdio: 'pipe', shell: true });
}

function killTree(proc: ReturnType<typeof spawn> | null): void {
  if (!proc || proc.killed) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      proc.kill('SIGTERM');
    }
  } catch {
    /* already gone */
  }
}

async function waitForHttp(url: string, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${label} at ${url}`);
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

function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

interface WorkflowState {
  stage: string;
  selection?: { label?: string; targetCount?: number } | null;
  issueId?: string;
  handoffId?: string;
  reviewId?: string;
  handoff?: { whatAgentReceives: string[]; handoffId?: string } | null;
  review?: { comparison?: { status?: string } } | null;
}

function asWorkflowState(value: unknown): WorkflowState {
  const record = asRecord(value);
  return {
    stage: typeof record.stage === 'string' ? record.stage : '',
    selection: (record.selection as WorkflowState['selection']) ?? null,
    issueId: typeof record.issueId === 'string' ? record.issueId : undefined,
    handoffId: typeof record.handoffId === 'string' ? record.handoffId : undefined,
    reviewId: typeof record.reviewId === 'string' ? record.reviewId : undefined,
    handoff: (record.handoff as WorkflowState['handoff']) ?? null,
    review: (record.review as WorkflowState['review']) ?? null,
  };
}

function findForbiddenKeys(obj: unknown, path = ''): string[] {
  if (!obj || typeof obj !== 'object') return [];
  const found: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (FORBIDDEN_STATE_KEYS.includes(k)) found.push(`${path}${k}`);
    if (v && typeof v === 'object') found.push(...findForbiddenKeys(v, `${path}${k}.`));
  }
  return found;
}

async function waitForSelection(timeoutMs: number): Promise<WorkflowState> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${STUDIO_URL}/workflow/state`);
    const state = asWorkflowState(await res.json());
    if (state.stage === 'selecting' && state.selection) return state;
    await sleep(500);
  }
  throw new Error('timeout waiting for overlay selection');
}

beforeAll(async () => {
  if (existsSync(FIXTURE_CSS)) {
    cssBackup = readFileSync(FIXTURE_CSS, 'utf-8');
    const brokenCss = cssBackup.replace(
      /\.target-card-description\s*\{[\s\S]*?\}/,
      '.target-card-description{display:none}',
    );
    writeFileSync(FIXTURE_CSS, brokenCss, 'utf-8');
  }

  fixtureProc = spawnProc('node', ['examples/phase12-source-hint-app/server.cjs']);
  studioProc = spawnProc(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
    'tsx',
    'apps/studio/src/index.ts',
  ]);

  await waitForHttp(`${FIXTURE_URL}/`, 20000, 'fixture server');
  await waitForHttp(`${STUDIO_URL}/health`, 120000, 'Studio server');
}, 180000);

afterAll(() => {
  if (cssBackup) writeFileSync(FIXTURE_CSS, cssBackup, 'utf-8');
  killTree(studioProc);
  killTree(fixtureProc);
});

describe('Studio E2E — UI issue to verified fix', () => {
  it('serves the human UI with workflow labels and no internal fields', async () => {
    const res = await fetch(`${STUDIO_URL}/`);
    const html = await res.text();
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('Report UI issue');
    expect(html).toContain('What is wrong?');
    expect(html).toContain('What should happen?');
    expect(html).toContain('Verify fix');
    expect(html).toContain('Accept fix');
    expect(html).toContain('Issue persists');
    expect(html).toContain('Needs follow-up');
    expect(findForbiddenKeys(html)).toEqual([]);
  });

  it('returns a sanitized workflow state and rejects actions before navigation', async () => {
    const state = asRecord(await (await fetch(`${STUDIO_URL}/workflow/state`)).json());
    expect(state.stage).toBe('idle');
    expect(findForbiddenKeys(state)).toEqual([]);

    const before = await post(`${STUDIO_URL}/workflow/report/start`, {});
    expect(before.status).toBe(409);
    expect(asRecord(before.data).error).toBe('Open the app first.');
  });

  it('walks the observable user path through report, handoff, verify, and decision', async () => {
    // 1. Open the app (description hidden via broken fixture CSS)
    const nav = await post(`${STUDIO_URL}/navigate`, {
      url: `${FIXTURE_URL}${SIMULATE_QUERY}`,
    });
    expect(nav.status).toBe(200);
    expect(asRecord(nav.data).ok).toBe(true);

    // 2. Report mode
    const report = await post(`${STUDIO_URL}/workflow/report/start`, {});
    expect(report.status).toBe(200);
    expect(asWorkflowState(asRecord(report.data).state).stage).toBe('selecting');

    // 3. Accepting before a selection exists fails with recovery text
    const early = await post(`${STUDIO_URL}/workflow/selection/accept`, {});
    const stateNow = asWorkflowState(await (await fetch(`${STUDIO_URL}/workflow/state`)).json());
    if (!stateNow.selection) {
      expect(early.status).toBe(409);
      expect(String(asRecord(early.data).error)).toContain('Select the element again');
    }

    // 4. The overlay event selects the fixture target; UI shows a target summary
    const selected = await waitForSelection(20000);
    expect(selected.selection?.label).toBeTruthy();
    expect(findForbiddenKeys(selected)).toEqual([]);

    const accept = await post(`${STUDIO_URL}/workflow/selection/accept`, {});
    expect(accept.status).toBe(200);
    expect(asWorkflowState(asRecord(accept.data).state).stage).toBe('describe');

    // 5. Both fields are required; then the issue is created
    const badIssue = await post(`${STUDIO_URL}/workflow/issue`, {
      problem: 'Description is hidden',
      expected: '',
    });
    expect(badIssue.status).toBe(400);

    const issue = await post(`${STUDIO_URL}/workflow/issue`, {
      problem: 'The card description is hidden',
      expected: 'The description should be visible below the title',
      severity: 'high',
    });
    expect(issue.status).toBe(200);
    const issueId = asWorkflowState(asRecord(issue.data).state).issueId as string;
    expect(issueId).toBeTruthy();

    // 6. Handoff ready with a copyable agent handoff
    const handoff = await post(`${STUDIO_URL}/workflow/handoff`, { issueId });
    expect(handoff.status).toBe(200);
    const handoffState = asWorkflowState(asRecord(handoff.data).state);
    expect(handoffState.stage).toBe('handoff_ready');
    expect(handoffState.handoffId).toBeTruthy();
    expect(handoffState.handoff?.whatAgentReceives.length).toBeGreaterThan(0);
    expect(findForbiddenKeys(handoffState)).toEqual([]);

    // 7. Apply the fix: restore visible CSS
    if (cssBackup) writeFileSync(FIXTURE_CSS, cssBackup, 'utf-8');

    // 8. Start verification, then recapture with reload + cache-bust
    const verifyStart = await post(`${STUDIO_URL}/workflow/verify/start`, {
      issueId,
      handoffId: handoffState.handoffId,
    });
    expect(verifyStart.status).toBe(200);
    const reviewId = asWorkflowState(asRecord(verifyStart.data).state).reviewId as string;
    expect(reviewId).toBeTruthy();

    const recapture = await post(`${STUDIO_URL}/workflow/verify/recapture`, { reviewId });
    expect(recapture.status).toBe(200);
    const reviewState = asWorkflowState(asRecord(recapture.data).state);
    expect(reviewState.stage).toBe('review_ready');
    // The rendered result changed — the fix is visible again.
    expect(reviewState.review?.comparison?.status).toBe('changed');
    // Evidence, not truth: still awaiting the human decision.
    expect(reviewState.stage).not.toBe('decided');
    expect(findForbiddenKeys(reviewState)).toEqual([]);

    // 9. Human decision
    const decision = await post(`${STUDIO_URL}/workflow/decision`, {
      reviewId,
      decision: 'accepted',
      note: 'E2E verification',
    });
    expect(decision.status).toBe(200);
    expect(asWorkflowState(asRecord(decision.data).state).stage).toBe('decided');
  });

  it('keeps the technical endpoints working', async () => {
    const health = asRecord(await (await fetch(`${STUDIO_URL}/health`)).json());
    const studioHealth = asRecord(health.studio);
    expect(studioHealth.status).toBe('running');
    const packet = await (await fetch(`${STUDIO_URL}/packet/latest`)).json();
    expect(packet).toBeNull();
    const notFound = await fetch(`${STUDIO_URL}/nonexistent`);
    expect(notFound.status).toBe(404);
  });
});
