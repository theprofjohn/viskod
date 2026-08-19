import type { ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROOT, STUDIO_URL, killTree, spawnProc, waitForHttp } from './harness';

const FIXTURE_URL = 'http://127.0.0.1:3010';
const FEEDBACK_DIR = join(ROOT, '.viskod', 'feedback');
const ISSUES_DIR = join(ROOT, '.viskod', 'issues');
const SECRET_VALUES = [
  'SECRET_TOKEN_PHASE36A',
  'PASSWORD_PHASE36A',
  'support@example.invalid',
  'https://user:pass@example.invalid/private',
  '/private/project/root',
  'DOM_SECRET_PHASE36A',
  'FAKE_ENV_SECRET_PHASE36A',
];

let fixtureProc: ChildProcess | null = null;
let workflowFixtureProc: ChildProcess | null = null;
let studioProc: ChildProcess | null = null;
let browser: Browser;
let page: Page;

function countDirectories(directory: string): number {
  if (!existsSync(directory)) return 0;
  return readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    .length;
}
beforeAll(async () => {
  rmSync(FEEDBACK_DIR, { recursive: true, force: true });
  fixtureProc = spawnProc('node', ['examples/phase36-feedback-privacy/server.cjs']);
  workflowFixtureProc = spawnProc('node', ['examples/phase12-source-hint-app/server.cjs']);
  studioProc = spawnProc(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
    'tsx',
    'apps/studio/src/index.ts',
  ]);
  await waitForHttp(`${FIXTURE_URL}/`, 20000, 'feedback privacy fixture');
  await waitForHttp('http://127.0.0.1:3000/', 20000, 'workflow fixture');
  await waitForHttp(`${STUDIO_URL}/health`, 120000, 'Studio server');
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${STUDIO_URL}/`, { waitUntil: 'domcontentloaded' });
}, 180000);

afterAll(async () => {
  await browser?.close().catch(() => undefined);
  killTree(studioProc);
  killTree(fixtureProc);
  killTree(workflowFixtureProc);
  rmSync(FEEDBACK_DIR, { recursive: true, force: true });
});

describe('Phase 36A feedback privacy and semantic boundary', () => {
  it('saves general feedback from idle without creating an issue', async () => {
    const issueCountBefore = countDirectories(ISSUES_DIR);
    await page.click('[data-action="feedback-start"]');
    await page.waitForSelector('#feedback-category');
    await page.fill('#feedback-text', 'The idle feedback form was easy to find.');
    await page.check('#feedback-diagnostics');
    await page.click('[data-action="feedback-preview"]');
    await page.waitForFunction(
      () =>
        document.querySelector('#feedback-result')?.textContent?.includes('Viskod feedback') ===
        true,
    );
    await page.click('#feedback-form button[type="submit"]');
    await page.waitForFunction(
      () =>
        document.querySelector('#feedback-result')?.textContent?.includes('Feedback ID:') === true,
    );
    expect(countDirectories(ISSUES_DIR)).toBe(issueCountBefore);

    const files = readdirSync(FEEDBACK_DIR).filter((name) => name.endsWith('.json'));
    expect(files).toHaveLength(1);
    const persisted = readFileSync(join(FEEDBACK_DIR, files[0] as string), 'utf8');
    const responseText = await page.locator('#feedback-result').textContent();
    const combined = `${persisted}\n${responseText ?? ''}`;
    for (const secret of SECRET_VALUES) expect(combined).not.toContain(secret);
    expect(persisted).toContain('diagnosticsIncluded');
    expect(persisted).toContain('diagnosticSchemaVersion');
  });

  it('rejects oversized feedback and deduplicates repeated request IDs', async () => {
    const requestId = '550e8400-e29b-41d4-a716-446655440099';
    const oversized = await page.evaluate(async (id) => {
      const response = await fetch('/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: id, category: 'other', note: 'x'.repeat(4001) }),
      });
      return response.status;
    }, requestId);
    expect(oversized).toBe(400);
    const payload = { requestId, category: 'other', note: 'repeat-safe' };
    const first = await page.evaluate(
      async (value) =>
        (
          await fetch('/feedback', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(value),
          })
        ).json(),
      payload,
    );
    const second = await page.evaluate(
      async (value) =>
        (
          await fetch('/feedback', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(value),
          })
        ).json(),
      payload,
    );
    expect(first.artifact.feedbackId).toBe(second.artifact.feedbackId);
  });

  it('captures optional post-review usefulness without changing review semantics', async () => {
    await page.goto(`${STUDIO_URL}/`, { waitUntil: 'domcontentloaded' });
    await page.fill(
      '#app-url',
      'http://127.0.0.1:3000/?viskodSimulate=target-card-description&viskodAfterAccept=phase12-source-submit-button&viskodReset=1',
    );
    await page.click('#open-app-form button[type="submit"]');
    await page.waitForSelector('#report-start', { timeout: 30000 });
    await page.click('#report-start');
    await page.waitForSelector('[data-stage="selecting"]');
    await page.waitForSelector('#selection-accept:not([disabled])', { timeout: 30000 });
    await page.click('#selection-accept');
    await page.waitForSelector('[data-stage="describe"]', { timeout: 30000 });
    await page.fill('#problem', 'The target copy is stale.');
    await page.fill('#expected', 'The target copy is current.');
    await page.click('#issue-form button[type="submit"]');
    await page.waitForSelector('[data-stage="handoff_ready"]', { timeout: 30000 });
    const beforeDecision = await page.evaluate(async () => (await fetch('/workflow/state')).json());
    await page.click('[data-action="verify-start"]');
    await page.waitForSelector('[data-stage="verifying"]');
    await page.click('[data-action="verify-recapture"]');
    await page.waitForSelector('[data-stage="review_ready"]', { timeout: 30000 });
    await page.click('[data-action="decision-accepted"]');
    await page.waitForSelector('[data-stage="decided"]', { timeout: 30000 });
    const decided = await page.evaluate(async () => (await fetch('/workflow/state')).json());
    expect(decided.stage).toBe('decided');
    expect(decided.issueId).toBe(beforeDecision.issueId);
    await page.click('[data-action="feedback-start"]');
    await page.selectOption('#feedback-usefulness', 'partly');
    await page.selectOption('#feedback-reasons', 'missing-context');
    await page.fill('#feedback-text', 'The agent needed one more context clue.');
    await page.check('#feedback-diagnostics');
    await page.click('#feedback-form button[type="submit"]');
    await page.waitForFunction(
      () =>
        document.querySelector('#feedback-result')?.textContent?.includes('Feedback ID:') === true,
    );
    const records = readdirSync(FEEDBACK_DIR)
      .filter((name) => name.endsWith('.json'))
      .map(
        (name) =>
          JSON.parse(readFileSync(join(FEEDBACK_DIR, name), 'utf8')) as Record<string, unknown>,
      );
    const usefulness = records.find((record) => record.usefulness === 'partly');
    expect(usefulness?.reasons).toEqual(['missing-context']);
    expect(usefulness?.reviewId).toBeTruthy();
    const afterFeedback = await page.evaluate(async () => (await fetch('/workflow/state')).json());
    expect(afterFeedback.stage).toBe('decided');
    expect(afterFeedback.issueId).toBe(decided.issueId);
  });
});
