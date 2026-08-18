import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROOT, STUDIO_URL, killTree, sleep, spawnProc, waitForHttp } from './harness';

/**
 * Phase 31 — REAL Studio UI journeys.
 *
 * Drives the rendered Studio HTML with an actual browser (Playwright
 * Chromium): report → select → describe → prepare handoff (BEFORE baseline
 * captured) → mutate the fixture → verify → BEFORE/AFTER/DIFF images render
 * → decision note → reload → note persists → Studio restart → review and
 * artifacts survive from durable storage (no in-memory buffers).
 *
 * The unchanged journey closes VISKOD-AUDIT-005: no code change → recapture
 * → UI reports unchanged, no false "changed" result.
 */

const FIXTURE_URL = 'http://127.0.0.1:3224';
const STATE_URL = `${FIXTURE_URL}/__state`;
const DEFAULT_STATE = {
  background: '#ffffff',
  color: '#111111',
  fontSize: '16px',
  fontWeight: '400',
  lineHeight: '1.4',
  border: '1px solid #cccccc',
  shadow: 'none',
  width: '240px',
  height: '80px',
  marginLeft: '0px',
  marginTop: '0px',
  text: 'Target card',
  present: true,
};
const SETTINGS_FILE = join(ROOT, '.viskod', 'settings.json');

let fixtureProc: ChildProcess | null = null;
let studioProc: ChildProcess | null = null;
let browser: Browser;
let page: Page;
let settingsBackup: string | null = null;

async function setState(patch: Record<string, unknown>): Promise<void> {
  const res = await fetch(STATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`fixture state update failed: ${res.status}`);
}

async function resetFixture(): Promise<void> {
  await setState({ ...DEFAULT_STATE });
}

async function enableVisualReviewPolicy(): Promise<void> {
  const res = await fetch(`${STUDIO_URL}/settings/visual-review-policy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ policy: 'local-sensitive-target-crop' }),
  });
  if (!res.ok) throw new Error(`policy enable failed: ${res.status}`);
}

async function workflowState(): Promise<Record<string, unknown>> {
  const res = await fetch(`${STUDIO_URL}/workflow/state`);
  return (await res.json()) as Record<string, unknown>;
}

async function waitForStage(stage: string, timeoutMs = 60000): Promise<Record<string, unknown>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await workflowState();
    if (state.stage === stage) return state;
    await sleep(500);
  }
  throw new Error(`timeout waiting for stage '${stage}'`);
}

async function waitForDomText(selector: string, text: string, timeoutMs = 10000): Promise<string> {
  const start = Date.now();
  let html = '';
  while (Date.now() - start < timeoutMs) {
    html = await page.locator(selector).innerHTML();
    if (html.includes(text)) return html;
    await sleep(250);
  }
  return html;
}

async function clickAction(action: string): Promise<void> {
  const button = page.locator(`[data-action="${action}"]`).first();
  await button.click();
}

async function openFixtureInStudio(): Promise<void> {
  await page.goto(STUDIO_URL, { waitUntil: 'domcontentloaded' });
  await page.fill('#app-url', `${FIXTURE_URL}/?viskodReset=1&viskodSimulate=target-card`);
  await page.click('form[data-action="open-app"] button[type="submit"]');
}

/** Walk the shared report journey: open → select → accept → describe → handoff. */
async function runReportToHandoff(
  problem: string,
  expected: string,
): Promise<{ issueId: string; reviewId: string }> {
  await openFixtureInStudio();
  // Studio navigates its browser to the fixture; the report button appears.
  await page.waitForSelector('[data-action="report-start"]', { timeout: 30000 });
  await clickAction('report-start');
  await waitForStage('selecting');

  // Selection arrives via the fixture's deterministic overlay event.
  const start = Date.now();
  while (Date.now() - start < 30000) {
    const state = await workflowState();
    if (state.selection) break;
    await sleep(300);
  }
  const selecting = await workflowState();
  const selection = selecting.selection as { label?: string } | null;
  expect(selection?.label).toBeTruthy();

  await clickAction('selection-accept');
  await waitForStage('describe');

  await page.fill('#problem', problem);
  await page.fill('#expected', expected);
  await page.click('form[data-action="prepare-handoff"] button[type="submit"]');

  const handoffState = await waitForStage('handoff_ready');
  const issueId = handoffState.issueId as string;
  expect(issueId).toBeTruthy();
  return { issueId, reviewId: '' };
}

beforeAll(async () => {
  // Preserve any existing settings; the test wants a clean policy state.
  if (fs.existsSync(SETTINGS_FILE)) {
    settingsBackup = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    fs.rmSync(SETTINGS_FILE, { force: true });
  }

  fixtureProc = spawnProc('node', ['examples/visual-review-app/server.cjs']);
  await waitForHttp(`${FIXTURE_URL}/`, 20000, 'visual-review fixture');
  await resetFixture();

  studioProc = spawnProc(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
    'tsx',
    'apps/studio/src/index.ts',
  ]);
  await waitForHttp(`${STUDIO_URL}/health`, 120000, 'Studio server');

  browser = await chromium.launch();
  page = await browser.newPage();
}, 240000);

afterAll(async () => {
  try {
    await browser?.close();
  } catch {
    /* already closed */
  }
  killTree(studioProc);
  killTree(fixtureProc);
  if (settingsBackup !== null) {
    fs.writeFileSync(SETTINGS_FILE, settingsBackup, 'utf-8');
  } else {
    try {
      fs.rmSync(SETTINGS_FILE, { force: true });
    } catch {
      /* best effort */
    }
  }
});

describe('Phase 31 Studio UI — changed review journey', () => {
  it('renders real BEFORE/AFTER/DIFF images, detects the change, persists the note, survives restart', async () => {
    await enableVisualReviewPolicy();

    // Report → handoff; the BEFORE baseline is captured at handoff-prepare,
    // BEFORE the simulated code change.
    const { issueId } = await runReportToHandoff(
      'The card is white; it should be highlighted',
      'The card should use the accent background',
    );

    // Proof: the baseline artifact already exists on disk before any change.
    const baselineDir = join(ROOT, '.viskod', 'reviews', 'baselines', issueId);
    const baselineManifest = join(baselineDir, 'manifest.json');
    expect(fs.existsSync(baselineManifest)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(baselineManifest, 'utf-8'));
    expect(manifest.sensitive).toBe(true);
    expect(manifest.localOnly).toBe(true);
    expect(fs.existsSync(join(baselineDir, 'before.png'))).toBe(true);

    // Deterministic visible change: background turns red.
    await setState({ background: '#ff0000' });

    await clickAction('verify-start');
    await waitForStage('verifying');
    await clickAction('verify-recapture');
    const reviewState = await waitForStage('review_ready');
    const reviewId = reviewState.reviewId as string;
    expect(reviewId).toBeTruthy();

    // Status is a real visual change.
    const statusHtml = await page.locator('.comparison-status').innerText();
    expect(statusHtml).toContain('changed');

    // BEFORE / AFTER / DIFF images render from opaque artifact endpoints.
    await page.waitForSelector('.review-image-card img', { timeout: 10000 });
    const images = page.locator('.review-image-card img');
    const count = await images.count();
    expect(count).toBe(3);
    for (let i = 0; i < count; i++) {
      const src = await images.nth(i).getAttribute('src');
      expect(src).toMatch(/^\/review\/artifact\/art_[a-f0-9]{32}$/);
      const naturalWidth = await images
        .nth(i)
        .evaluate((el) => (el as HTMLImageElement).naturalWidth);
      expect(naturalWidth).toBeGreaterThan(0);
    }
    const figcaptions = await page.locator('.review-image-card figcaption').allInnerTexts();
    expect(figcaptions).toEqual(['BEFORE', 'AFTER', 'DIFF']);

    // Human decision stays independent of the automatic comparison result.
    await page.fill('#decision-note', 'Red background verified in the rendered card');
    await clickAction('decision-accepted');
    await waitForStage('decided');
    // The HTTP state poll can win the race against the WebSocket render
    // broadcast; await the DOM condition instead of reading it immediately
    // (condition-based, never a fixed sleep).
    const decidedHtml = await waitForDomText(
      '.screen',
      'Red background verified in the rendered card',
      10000,
    );
    expect(decidedHtml).toContain('Red background verified in the rendered card');

    // Reload the Studio page: the decision note survives (persisted).
    await page.reload({ waitUntil: 'domcontentloaded' });
    const persisted = await (await fetch(`${STUDIO_URL}/review/${reviewId}`)).json();
    expect(persisted.ok).toBe(true);
    expect(persisted.review.decision?.note).toBe('Red background verified in the rendered card');

    // Phase 31 §28: restart durability — the review + artifacts are loaded
    // from durable storage, not an in-memory buffer.
    killTree(studioProc);
    studioProc = null;
    await sleep(1000);
    studioProc = spawnProc(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
      'tsx',
      'apps/studio/src/index.ts',
    ]);
    await waitForHttp(`${STUDIO_URL}/health`, 120000, 'Studio restarted');

    const afterRestart = await (await fetch(`${STUDIO_URL}/review/${reviewId}`)).json();
    expect(afterRestart.ok).toBe(true);
    const artifacts = afterRestart.review.artifacts;
    expect(artifacts?.before?.artifactId).toMatch(/^art_[a-f0-9]{32}$/);
    expect(artifacts?.after?.artifactId).toMatch(/^art_[a-f0-9]{32}$/);
    expect(artifacts?.diff?.artifactId).toMatch(/^art_[a-f0-9]{32}$/);
    expect(artifacts?.comparison?.status).toBe('changed');

    // The protected artifact endpoint still serves the persisted images.
    const beforeId = artifacts.before.artifactId as string;
    const imgRes = await fetch(`${STUDIO_URL}/review/artifact/${beforeId}`);
    expect(imgRes.status).toBe(200);
    expect(imgRes.headers.get('content-type')).toContain('image/png');

    // Traversal/malformed ids fail safely.
    const traversal = await fetch(`${STUDIO_URL}/review/artifact/../../etc/passwd`);
    expect(traversal.status).toBe(404);
    const malformed = await fetch(`${STUDIO_URL}/review/artifact/art_zz`);
    expect(malformed.status).toBe(404);
  }, 240000);
});

describe('Phase 34A Studio UI — restart resume through decision', () => {
  it('reuses the original BEFORE baseline through rendered restart, verification, and decision', async () => {
    await resetFixture();
    await enableVisualReviewPolicy();
    const { issueId } = await runReportToHandoff(
      'The card needs a durable restart workflow',
      'The card remains visible after the agent change',
    );
    const baselineDir = join(ROOT, '.viskod', 'reviews', 'baselines', issueId);
    const beforePath = join(baselineDir, 'before.png');
    const beforeHash = createHash('sha256').update(fs.readFileSync(beforePath)).digest('hex');

    killTree(studioProc);
    studioProc = null;
    await waitForHttp(`${FIXTURE_URL}/`, 20000, 'fixture after Studio stop');
    studioProc = spawnProc(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
      'tsx',
      'apps/studio/src/index.ts',
    ]);
    await waitForHttp(`${STUDIO_URL}/health`, 120000, 'fresh Studio');

    await openFixtureInStudio();
    await page.waitForSelector(`[data-issue-id="${issueId}"][data-issue-action="open"]`, {
      timeout: 30000,
    });
    await page.locator(`[data-issue-id="${issueId}"][data-issue-action="open"]`).press('Enter');
    await waitForStage('handoff_ready');
    expect(createHash('sha256').update(fs.readFileSync(beforePath)).digest('hex')).toBe(beforeHash);

    await setState({ background: '#ff0000' });
    await clickAction('verify-start');
    await waitForStage('verifying');
    await clickAction('verify-recapture');
    const reviewState = await waitForStage('review_ready');
    const reviewId = reviewState.reviewId as string;
    expect(reviewId).toBeTruthy();
    expect(createHash('sha256').update(fs.readFileSync(beforePath)).digest('hex')).toBe(beforeHash);

    await page.locator('#decision-note').pressSequentially('Restart resume verified');
    await page.locator('[data-action="decision-accepted"]').press('Enter');
    await waitForStage('decided');
    await page.reload({ waitUntil: 'domcontentloaded' });
    const persisted = await (await fetch(`${STUDIO_URL}/review/${reviewId}`)).json();
    expect(persisted.review.decision?.note).toBe('Restart resume verified');
  }, 240000);
});

describe('Phase 31 Studio UI — unchanged review journey (VISKOD-AUDIT-005)', () => {
  it('reports unchanged when the target did not change', async () => {
    await resetFixture();
    await enableVisualReviewPolicy();

    // Reset the fixture page (fresh sessionStorage) for the second journey.
    const nav = await fetch(`${STUDIO_URL}/navigate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: `${FIXTURE_URL}/?viskodReset=1&viskodSimulate=target-card`,
      }),
    });
    expect(nav.status).toBe(200);
    await page.goto(STUDIO_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-action="report-start"]', { timeout: 30000 });

    const { issueId } = await runReportToHandoff(
      'The card layout looks off',
      'The card should keep its current layout',
    );

    // NO fixture change: the developer verified without modifying anything.
    await clickAction('verify-start');
    await waitForStage('verifying');
    await clickAction('verify-recapture');
    const reviewState = await waitForStage('review_ready');
    const reviewId = reviewState.reviewId as string;
    expect(reviewId).toBeTruthy();

    // Target identity is preserved and the pixels did not meaningfully change.
    const statusHtml = await page.locator('.comparison-status').innerText();
    expect(statusHtml).toContain('No measurable change detected');

    const review = await (await fetch(`${STUDIO_URL}/review/${reviewId}`)).json();
    expect(review.ok).toBe(true);
    expect(review.review.comparison?.status).toBe('unchanged');
    expect(review.review.comparison?.visual?.artifactComparison?.changedPixelRatio).toBeLessThan(
      0.005,
    );
    expect(review.review.artifacts?.before?.artifactId).toBeTruthy();
    expect(review.review.artifacts?.after?.artifactId).toBeTruthy();
    expect(review.review.artifacts?.diff?.artifactId).toBeTruthy();
    expect(review.review.artifacts?.comparison?.status).toBe('unchanged');

    // No false "changed" label anywhere in the review UI.
    const screenHtml = await page.locator('.screen').innerHTML();
    expect(screenHtml).toContain('Visually unchanged');
    expect(screenHtml).not.toContain('Visual change detected');

    // Baseline for the untouched issue: before/after exist; geometry equal.
    expect(review.review.comparison?.visual?.boundingBoxDelta).toBeUndefined();
    void issueId;
  }, 180000);
});
