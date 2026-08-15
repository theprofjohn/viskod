import type { ChildProcess } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BrowserHandle } from '../../packages/browser-runtime/src/index';
import { BrowserRuntime } from '../../packages/browser-runtime/src/index';
import { EventBus } from '../../packages/event-bus/src/index';
import { IssueServiceImpl } from '../../packages/visual-issue/src/index';
import type { RecaptureResult } from '../../packages/visual-review/src/index';
import {
  ReviewArtifactStore,
  ReviewPersistence,
  ReviewServiceImpl,
} from '../../packages/visual-review/src/index';
import { ROOT, STUDIO_URL, killTree, sleep, spawnProc, waitForHttp } from './harness';

/**
 * Phase 31A — visual review durability & consent closure.
 *
 * Real-process proof of the pre-verification restart invariant:
 *
 *   capture BEFORE → handoff ready → Studio exits → Studio restarts →
 *   verification happens later → exact original BEFORE artifact is used.
 *
 * Also proves the local-sensitive opt-in policy contract:
 *   - fresh state defaults to DISABLED (no PNGs without explicit consent);
 *   - enable/decline persist across Studio restart;
 *   - malformed settings fail closed;
 *   - a missing/corrupt baseline after restart fails with a typed artifact
 *     error and is never replaced or silently recaptured;
 *   - persisted consent never changes the Phase 29 agent-safe boundary.
 *
 * Studio does not yet restore an in-flight workflow after restart, so the
 * post-restart verification is exercised at the service/persistence level
 * with FRESH ReviewArtifactStore/ReviewServiceImpl instances on the same
 * durable `.viskod` store and a REAL Chromium recapture adapter (the same
 * adapter contract Studio/MCP use) — the strongest currently supported
 * product path. Active-workflow UI resume is documented as deferred to the
 * issue-history phase.
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
const REVIEWS_DIR = join(ROOT, '.viskod', 'reviews');

let fixtureProc: ChildProcess | null = null;
let studioProc: ChildProcess | null = null;
let runtime: BrowserRuntime;
let runtimeHandle: BrowserHandle;
let browser: Browser;
let page: Page;
let settingsBackup: string | null = null;

function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
}

/** All committed PNG files under a directory (recursive). */
function listPngs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const found: string[] = [];
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    if (name.isDirectory()) {
      found.push(...listPngs(join(dir, name.name)));
    } else if (name.name.endsWith('.png')) {
      found.push(join(dir, name.name));
    }
  }
  return found;
}

/** The newest persisted capture packet.json (the last capture in the flow). */
function latestPacketJson(): string {
  const capturesDir = join(ROOT, '.viskod', 'captures');
  let newestFile: string | null = null;
  let newestMtime = 0;
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
      if (name.isDirectory()) walk(join(dir, name.name));
      else if (name.name === 'packet.json') {
        const file = join(dir, name.name);
        const mtime = fs.statSync(file).mtimeMs;
        if (!newestFile || mtime > newestMtime) {
          newestFile = file;
          newestMtime = mtime;
        }
      }
    }
  };
  walk(capturesDir);
  if (!newestFile) throw new Error('no persisted capture packet found');
  return fs.readFileSync(newestFile, 'utf-8');
}

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

async function enablePolicy(): Promise<void> {
  const res = await fetch(`${STUDIO_URL}/settings/visual-review-policy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ policy: 'local-sensitive-target-crop' }),
  });
  if (!res.ok) throw new Error(`policy enable failed: ${res.status}`);
}

async function getStudioState(): Promise<Record<string, unknown>> {
  return (await (await fetch(`${STUDIO_URL}/state`)).json()) as Record<string, unknown>;
}

async function workflowState(): Promise<Record<string, unknown>> {
  return (await (await fetch(`${STUDIO_URL}/workflow/state`)).json()) as Record<string, unknown>;
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

async function clickAction(action: string): Promise<void> {
  const button = page.locator(`[data-action="${action}"]`).first();
  await button.click();
}

async function openFixtureInStudio(): Promise<void> {
  await page.goto(STUDIO_URL, { waitUntil: 'domcontentloaded' });
  await page.fill('#app-url', `${FIXTURE_URL}/?viskodReset=1&viskodSimulate=target-card`);
  await page.click('form[data-action="open-app"] button[type="submit"]');
}

/**
 * Shared journey: open → report → select → accept → describe → handoff.
 * `onSelecting` runs at the selecting stage (after report-start) so tests
 * can assert the consent banner without re-opening the app (a reload would
 * re-render the server-side workflow stage, which has no app-url input).
 */
async function runReportToHandoff(
  problem: string,
  expected: string,
  onSelecting?: () => Promise<void>,
  stopAtSelecting = false,
): Promise<{ issueId: string; handoffId: string }> {
  await openFixtureInStudio();
  await page.waitForSelector('[data-action="report-start"]', { timeout: 30000 });
  await clickAction('report-start');
  await waitForStage('selecting');
  if (onSelecting) await onSelecting();
  if (stopAtSelecting) return { issueId: '', handoffId: '' };

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
  const handoffId = handoffState.handoffId as string;
  expect(issueId).toBeTruthy();
  expect(handoffId).toBeTruthy();
  return { issueId, handoffId };
}

async function bootStudio(): Promise<ChildProcess> {
  if (studioProc) {
    killTree(studioProc);
    studioProc = null;
    await sleep(1000);
  }
  const proc = spawnProc(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
    'tsx',
    'apps/studio/src/index.ts',
  ]);
  await waitForHttp(`${STUDIO_URL}/health`, 120000, 'Studio server');
  return proc;
}

function freshSettings(): void {
  try {
    fs.rmSync(SETTINGS_FILE, { force: true });
  } catch {
    /* best effort */
  }
  // Hermetic review storage per test: no artifacts from earlier tests can
  // influence "no PNGs" assertions or lineage checks.
  try {
    fs.rmSync(REVIEWS_DIR, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

/**
 * Real Chromium recapture adapter — the same contract Studio's
 * `recaptureViaVce` and the MCP adapter implement. Navigates the current
 * fixture state and captures the target through the Phase 28B pipeline.
 */
function realRecaptureAdapter(): (options: {
  selector?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
  reload?: boolean;
  cacheBust?: boolean;
  url?: string;
}) => Promise<RecaptureResult | null> {
  return async (options) => {
    const selector = options.selector;
    if (!selector) return null;
    const baseUrl = options.url ?? `${FIXTURE_URL}/?viskodReset=1&viskodSimulate=target-card`;
    let targetUrl = baseUrl;
    if (options.reload && options.cacheBust) {
      const urlObj = new URL(baseUrl);
      urlObj.searchParams.set('__viskod_cb', String(Date.now()));
      targetUrl = urlObj.toString();
    }
    const nav = await runtime.navigate(runtimeHandle, targetUrl);
    if (!nav.ok) return null;
    await sleep(300);
    const shot = await runtime.captureElementScreenshot(
      runtimeHandle,
      selector,
      options.boundingBox,
    );
    if (!shot.ok) return null;
    const value = shot.value;
    const resolved = value.resolutionStatus === 'resolved';
    return {
      packetId: crypto.randomUUID(),
      selector,
      tagName: value.tagName ?? 'div',
      boundingBox: value.targetRect,
      text: value.text,
      url: value.url,
      viewport: value.viewport,
      ...(resolved && value.buffer
        ? { elementScreenshot: { ...value, buffer: value.buffer } }
        : {}),
      identity: value.identity,
    };
  };
}

// ---------------------------------------------------------------------------
// Fresh-MCP handoff-context probe (Phase 31A §9 privacy regression)
// ---------------------------------------------------------------------------

let mcpProc: ChildProcess | null = null;
let mcpStdout = '';
let mcpStderr = '';
let parsedIndex = 0;
let rpcId = 100;

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
  timeoutMs = 120000,
): Promise<Record<string, unknown> | null> {
  rpcId += 1;
  rpcSend({ jsonrpc: '2.0', id: rpcId, method: 'tools/call', params: { name, arguments: args } });
  return rpcWait(timeoutMs);
}

function parseToolText(response: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!response || response.error) return null;
  const content = (response.result as { content?: Array<{ text?: string }> } | undefined)?.content;
  const text = content?.[0]?.text;
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Spawn a FRESH MCP process and assert get_handoff_context stays clean. */
async function probeHandoffContext(handoffId: string): Promise<void> {
  mcpProc = spawnProc(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
    'tsx',
    'packages/cli/src/index.ts',
    'serve',
    '--url',
    FIXTURE_URL,
  ]);
  mcpStdout = '';
  mcpStderr = '';
  parsedIndex = 0;
  mcpProc.stdout?.on('data', (d: Buffer) => {
    mcpStdout += d.toString();
  });
  mcpProc.stderr?.on('data', (d: Buffer) => {
    mcpStderr += d.toString();
  });
  rpcSend({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  const initResp = await rpcWait(120000);
  expect(initResp, `MCP initialize failed; stderr: ${mcpStderr.slice(-1000)}`).toBeTruthy();
  rpcSend({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const toolsResp = await rpcWait(30000);
  const tools = (toolsResp?.result as { tools?: Array<{ name: string }> } | undefined)?.tools ?? [];
  const names = tools.map((t) => t.name);
  expect(names).toContain('get_handoff_context');
  expect(names.some((n) => n.includes('artifact') || n.includes('review_image'))).toBe(false);

  const context = parseToolText(await rpcCall('get_handoff_context', { handoffId }));
  expect(context).toBeTruthy();
  const json = JSON.stringify(context);
  expect(json).toContain('omitted_sensitive');
  expect(json).not.toContain('art_');
  expect(json).not.toContain('reviews/');
  expect(json).not.toContain('before.png');
  expect(json).not.toContain('C:');
  expect(json).not.toContain('/Users/');
  killTree(mcpProc);
  mcpProc = null;
}

beforeAll(async () => {
  if (fs.existsSync(SETTINGS_FILE)) {
    settingsBackup = fs.readFileSync(SETTINGS_FILE, 'utf-8');
  }
  // Hermetic: no review artifacts from prior E2E files influence this suite's
  // "no PNGs without opt-in" assertions.
  try {
    fs.rmSync(REVIEWS_DIR, { recursive: true, force: true });
  } catch {
    /* best effort */
  }

  fixtureProc = spawnProc('node', ['examples/visual-review-app/server.cjs']);
  await waitForHttp(`${FIXTURE_URL}/`, 20000, 'visual-review fixture');
  await resetFixture();

  runtime = new BrowserRuntime(new EventBus());
  const launched = await runtime.launch();
  if (!launched.ok) throw new Error(`browser launch failed: ${launched.error.message}`);
  runtimeHandle = launched.value;

  browser = await chromium.launch();
  page = await browser.newPage();
}, 240000);

afterAll(async () => {
  try {
    await runtime?.shutdown(runtimeHandle);
  } catch {
    /* browser already gone */
  }
  try {
    await browser?.close();
  } catch {
    /* already closed */
  }
  killTree(mcpProc);
  killTree(studioProc);
  killTree(fixtureProc);
  // Leave the workspace tidy: review artifacts from this suite are test data.
  try {
    fs.rmSync(REVIEWS_DIR, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
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

describe('Phase 31A — pre-verification restart durability (§1/§3)', () => {
  it('restart before verification uses the exact original baseline (hash identity, no recapture)', async () => {
    freshSettings();
    await resetFixture();
    studioProc = await bootStudio();
    await enablePolicy();

    const { issueId, handoffId } = await runReportToHandoff(
      'The card is white; it should be highlighted',
      'The card should use the accent background',
    );

    // Proof the baseline is committed BEFORE any modification.
    const baselineDir = join(REVIEWS_DIR, 'baselines', issueId);
    const baselineManifestPath = join(baselineDir, 'manifest.json');
    expect(fs.existsSync(baselineManifestPath)).toBe(true);
    const baselineManifest = readJson(baselineManifestPath) as {
      sensitive: boolean;
      localOnly: boolean;
      pairing: { beforeArtifactId: string };
      artifacts: Array<{ role: string; capturedAt?: string }>;
    };
    expect(baselineManifest.sensitive).toBe(true);
    expect(baselineManifest.localOnly).toBe(true);
    const baselineArtifactId = baselineManifest.pairing.beforeArtifactId;
    const baselineCapturedAt = baselineManifest.artifacts.find(
      (a) => a.role === 'before',
    )?.capturedAt;
    expect(baselineArtifactId).toMatch(/^art_[a-f0-9]{32}$/);
    expect(baselineCapturedAt).toBeTruthy();
    const beforeHashBeforeRestart = sha256(fs.readFileSync(join(baselineDir, 'before.png')));

    // Stop Studio BEFORE any modification/verification.
    killTree(studioProc);
    studioProc = null;
    await sleep(1500);

    // Modify the fixture deterministically AFTER the baseline exists.
    await setState({ background: '#ff0000' });

    // A fresh Studio process: policy survives, baseline untouched. The
    // workflow snapshot exists only after a navigation, so the persisted
    // policy is asserted through /state here and through the banner
    // behavior in the §6 journey.
    studioProc = await bootStudio();
    const restartedState = await getStudioState();
    expect(
      (restartedState.settings as { visualReviewArtifacts?: string }).visualReviewArtifacts,
    ).toBe('local-sensitive-target-crop');
    expect(sha256(fs.readFileSync(join(baselineDir, 'before.png')))).toBe(beforeHashBeforeRestart);
    const manifestAfterRestart = readJson(baselineManifestPath) as {
      pairing: { beforeArtifactId: string };
      artifacts: Array<{ role: string; capturedAt?: string }>;
    };
    expect(manifestAfterRestart.pairing.beforeArtifactId).toBe(baselineArtifactId);
    expect(manifestAfterRestart.artifacts.find((a) => a.role === 'before')?.capturedAt).toBe(
      baselineCapturedAt,
    );
    expect(fs.readdirSync(baselineDir).sort()).toEqual(['before.png', 'manifest.json']);

    // ---------------------------------------------------------------------
    // Post-restart verification: FRESH store + service instances on the same
    // durable `.viskod` store, with a REAL Chromium recapture adapter. This
    // is the strongest currently supported product path (Studio does not yet
    // restore an in-flight workflow — see §2 in the report).
    // ---------------------------------------------------------------------
    const freshStore = new ReviewArtifactStore(undefined, 'local-sensitive-target-crop');
    const freshBus = new EventBus();
    const freshService = new ReviewServiceImpl(
      freshBus,
      new IssueServiceImpl(freshBus),
      undefined,
      new ReviewPersistence(),
      realRecaptureAdapter(),
      freshStore,
    );
    const create = await freshService.createReview({ issueId, handoffId }, 'phase31a', 'phase31a');
    expect(create.ok).toBe(true);
    if (!create.ok) return;
    const reviewId = create.value.reviewId;

    // The review's BEFORE is the exact original baseline artifact.
    const reviewManifest = await freshStore.loadManifest(reviewId);
    expect(reviewManifest.ok && reviewManifest.value).toBeTruthy();
    if (!reviewManifest.ok || !reviewManifest.value) return;
    const reviewBeforeId = reviewManifest.value.pairing.beforeArtifactId as string;
    const reviewBeforeBuffer = await freshStore.readArtifact(reviewId, reviewBeforeId);
    expect(reviewBeforeBuffer.ok).toBe(true);
    if (!reviewBeforeBuffer.ok) return;
    const beforeHashUsedByReview = sha256(reviewBeforeBuffer.value);
    expect(beforeHashUsedByReview).toBe(beforeHashBeforeRestart); // === proof
    const reviewBeforeEntry = reviewManifest.value.artifacts.find((a) => a.role === 'before');
    expect(reviewBeforeEntry?.capturedAt).toBe(baselineCapturedAt); // original timestamp

    // Verification recaptures the POST-CHANGE page and pairs AFTER/DIFF to
    // that original BEFORE.
    const recapture = await freshService.recaptureReview({
      reviewId,
      reload: true,
      cacheBust: true,
    });
    expect(recapture.ok).toBe(true);
    if (!recapture.ok) return;
    expect(recapture.value.comparison?.status).toBe('changed');
    const finalManifest = await freshStore.loadManifest(reviewId);
    expect(finalManifest.ok && finalManifest.value).toBeTruthy();
    if (!finalManifest.ok || !finalManifest.value) return;
    expect(finalManifest.value.pairing.beforeArtifactId).toBe(reviewBeforeId);
    expect(finalManifest.value.pairing.afterArtifactId).toBeTruthy();
    expect(finalManifest.value.pairing.diffArtifactId).toBeTruthy();
    expect(finalManifest.value.comparison?.status).toBe('changed');
    const diffId = finalManifest.value.pairing.diffArtifactId as string;
    const diff = await freshStore.readArtifact(reviewId, diffId);
    expect(diff.ok).toBe(true);

    // No second baseline was generated anywhere: the baseline dir still has
    // exactly one before.png and no after/diff, and the manifest's pairing
    // never grew an after artifact.
    expect(fs.readdirSync(baselineDir).sort()).toEqual(['before.png', 'manifest.json']);
    const baselineFinal = readJson(baselineManifestPath) as {
      artifacts: Array<{ role: string }>;
      pairing: Record<string, string>;
    };
    expect(baselineFinal.artifacts.filter((a) => a.role === 'before')).toHaveLength(1);
    expect(baselineFinal.pairing.afterArtifactId).toBeUndefined();
    expect(baselineFinal.pairing.diffArtifactId).toBeUndefined();

    // Cross-check through the RESTARTED Studio process: the review (created
    // by fresh service instances) is readable from durable storage and pairs
    // to the exact same before artifact id.
    const viaStudio = (await (await fetch(`${STUDIO_URL}/review/${reviewId}`)).json()) as {
      ok: boolean;
      review: {
        artifacts?: {
          before?: { artifactId?: string };
          comparison?: { status?: string };
        };
      };
    };
    expect(viaStudio.ok).toBe(true);
    expect(viaStudio.review.artifacts?.before?.artifactId).toBe(reviewBeforeId);
    expect(viaStudio.review.artifacts?.comparison?.status).toBe('changed');

    await resetFixture();
  }, 300000);
});

describe('Phase 31A — missing/corrupt baseline after restart (§4)', () => {
  it('fails closed with typed artifact errors — never substitutes or regenerates a baseline', async () => {
    freshSettings();
    await resetFixture();
    studioProc = await bootStudio();
    await enablePolicy();

    const { issueId } = await runReportToHandoff(
      'The card is white; it should be highlighted',
      'The card should use the accent background',
    );
    const baselineDir = join(REVIEWS_DIR, 'baselines', issueId);
    expect(fs.existsSync(join(baselineDir, 'before.png'))).toBe(true);

    // Stop Studio, then remove the committed baseline file (manifest stays).
    killTree(studioProc);
    studioProc = null;
    await sleep(1000);
    fs.rmSync(join(baselineDir, 'before.png'), { force: true });

    // Fresh service instances on the same durable store.
    const freshStore = new ReviewArtifactStore(undefined, 'local-sensitive-target-crop');
    const freshBus = new EventBus();
    const freshService = new ReviewServiceImpl(
      freshBus,
      new IssueServiceImpl(freshBus),
      undefined,
      new ReviewPersistence(),
      undefined,
      freshStore,
    );

    // Review creation fails with the typed artifact error — no post-change
    // image is substituted as BEFORE and no new baseline is generated.
    const missing = await freshService.createReview({ issueId }, 'phase31a', 'phase31a');
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('ARTIFACT_NOT_FOUND');
    expect(fs.readdirSync(baselineDir).sort()).toEqual(['manifest.json']);
    expect(fs.existsSync(join(baselineDir, 'before.png'))).toBe(false);

    // Metadata evidence remains available: the issue is still retrievable.
    const issue = await new IssueServiceImpl(new EventBus()).getIssue(issueId);
    expect(issue.ok).toBe(true);

    // Corrupt variant: manifest + a garbage before.png → typed invalid image.
    fs.writeFileSync(join(baselineDir, 'before.png'), 'corrupt bytes');
    const reviewDirsBefore = fs
      .readdirSync(REVIEWS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== 'baselines')
      .map((d) => d.name)
      .sort();
    const corrupt = await freshService.createReview({ issueId }, 'phase31a', 'phase31a');
    expect(corrupt.ok).toBe(false);
    if (!corrupt.ok) expect(corrupt.error.code).toBe('ARTIFACT_INVALID_IMAGE');
    // No NEW review dir and no replacement baseline.
    const reviewDirsAfter = fs
      .readdirSync(REVIEWS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== 'baselines')
      .map((d) => d.name)
      .sort();
    expect(reviewDirsAfter).toEqual(reviewDirsBefore);
    expect(fs.readdirSync(baselineDir).sort()).toEqual(['before.png', 'manifest.json']);

    await resetFixture();
  }, 300000);
});

describe('Phase 31A — visual review policy default (§5)', () => {
  it('fresh Viskod state defaults to disabled and persists no PNGs without opt-in', async () => {
    freshSettings();
    await resetFixture();
    studioProc = await bootStudio();

    // Fresh state: policy disabled, not yet asked.
    const state = await getStudioState();
    expect((state.settings as { visualReviewArtifacts?: string }).visualReviewArtifacts).toBe(
      'disabled',
    );

    // Studio communicates that visual comparison requires local-sensitive
    // artifact enablement (product-level consent surface) — asserted at the
    // selecting stage of the single report journey.
    const { issueId } = await runReportToHandoff(
      'The card looks off',
      'The card should keep its layout',
      async () => {
        const wf = await workflowState();
        expect(wf.visualReviewPolicy).toBe('disabled');
        expect(wf.visualReviewPolicyAsked).toBe(false);
        await page.waitForSelector('.policy-banner', { timeout: 10000 });
        const bannerText = await page.locator('.policy-banner').innerText();
        expect(bannerText).toContain('Local visual review');
        expect(await page.locator('[data-action="policy-enable"]').count()).toBe(1);
        expect(await page.locator('[data-action="policy-disable"]').count()).toBe(1);
      },
    );
    const baselineDir = join(REVIEWS_DIR, 'baselines', issueId);
    expect(fs.existsSync(baselineDir)).toBe(false);

    // Verify reports visual comparison unavailable — never fabricated.
    await clickAction('verify-start');
    await waitForStage('verifying');
    await clickAction('verify-recapture');
    await waitForStage('review_ready');
    await page.waitForSelector('.review-visual[data-visual-status="unavailable"]', {
      timeout: 10000,
    });
    const panelText = await page.locator('.review-visual').innerText();
    expect(panelText).toContain('local visual review is disabled');

    // No BEFORE/AFTER/DIFF artifacts persisted anywhere.
    expect(listPngs(REVIEWS_DIR)).toEqual([]);
    // Agent-safe state stays clean: no opaque artifact ids in workflow state.
    expect(JSON.stringify(await workflowState())).not.toContain('art_');
  }, 300000);
});

describe('Phase 31A — enable consent persistence (§6/§9)', () => {
  it('enabling via the consent UI persists across restart and keeps the Phase 29 agent boundary', async () => {
    freshSettings();
    await resetFixture();
    studioProc = await bootStudio();

    // Fresh Studio: consent banner is shown; the REAL consent path is
    // clicked at the selecting stage.
    await runReportToHandoff(
      'The card is white; it should be highlighted',
      'The card should use the accent background',
      async () => {
        await page.waitForSelector('.policy-banner', { timeout: 10000 });
        await clickAction('policy-enable');
        await page.waitForSelector('.policy-banner', { state: 'detached', timeout: 10000 });

        // Settings persistence contains the chosen policy.
        const settings = readJson(SETTINGS_FILE) as { visualReviewArtifacts?: string };
        expect(settings.visualReviewArtifacts).toBe('local-sensitive-target-crop');
        const state = await getStudioState();
        expect((state.settings as { visualReviewArtifacts?: string }).visualReviewArtifacts).toBe(
          'local-sensitive-target-crop',
        );
        expect((await workflowState()).visualReviewPolicyAsked).toBe(true);
      },
      true,
    );

    // Stop + restart Studio: policy remains enabled, prompt not re-shown.
    killTree(studioProc);
    studioProc = null;
    await sleep(1500);
    studioProc = await bootStudio();
    const restartedSettings = await getStudioState();
    expect(
      (restartedSettings.settings as { visualReviewArtifacts?: string }).visualReviewArtifacts,
    ).toBe('local-sensitive-target-crop');

    // Post-restart report captures the baseline normally; the banner is not
    // shown again and the policy is enabled in the live workflow.
    const { issueId, handoffId } = await runReportToHandoff(
      'The card is white; it should be highlighted',
      'The card should use the accent background',
      async () => {
        const wf = await workflowState();
        expect(wf.visualReviewPolicy).toBe('local-sensitive-target-crop');
        expect(wf.visualReviewPolicyAsked).toBe(true);
        expect(await page.locator('.policy-banner').count()).toBe(0);
      },
    );
    const baselineDir = join(REVIEWS_DIR, 'baselines', issueId);
    const baselineManifest = readJson(join(baselineDir, 'manifest.json')) as {
      sensitive: boolean;
      localOnly: boolean;
      pairing: { beforeArtifactId: string };
    };
    expect(fs.existsSync(join(baselineDir, 'before.png'))).toBe(true);
    expect(baselineManifest.sensitive).toBe(true);
    expect(baselineManifest.localOnly).toBe(true);
    expect(baselineManifest.pairing.beforeArtifactId).toMatch(/^art_[a-f0-9]{32}$/);

    // Verify → recapture through the restarted Studio: real before/after.
    await clickAction('verify-start');
    await waitForStage('verifying');
    await clickAction('verify-recapture');
    await waitForStage('review_ready');
    const reviewState = await workflowState();
    const reviewId = reviewState.reviewId as string;
    expect(reviewId).toBeTruthy();

    // Review manifest: sensitive + localOnly, paired to the baseline copy.
    const reviewManifest = readJson(join(REVIEWS_DIR, reviewId, 'manifest.json')) as {
      sensitive: boolean;
      localOnly: boolean;
      pairing: { beforeArtifactId: string; afterArtifactId?: string; diffArtifactId?: string };
    };
    expect(reviewManifest.sensitive).toBe(true);
    expect(reviewManifest.localOnly).toBe(true);
    expect(reviewManifest.pairing.beforeArtifactId).toMatch(/^art_[a-f0-9]{32}$/);
    expect(reviewManifest.pairing.afterArtifactId).toBeTruthy();
    expect(reviewManifest.pairing.diffArtifactId).toBeTruthy();

    // Phase 29 boundary: the persisted agent-safe packet screenshots remain
    // omitted_sensitive and never reference the review artifact.
    const packetJson = latestPacketJson();
    const packet = JSON.parse(packetJson) as {
      screenshots: Array<{ status?: string; path: string | null }>;
    };
    expect(packet.screenshots.length).toBeGreaterThan(0);
    expect(packet.screenshots[0]?.status).toBe('omitted_sensitive');
    expect(packet.screenshots[0]?.path).toBeNull();
    expect(packetJson).not.toContain(reviewManifest.pairing.beforeArtifactId as string);
    expect(packetJson).not.toContain('reviews/');

    // Fresh MCP process: get_handoff_context still exposes no review artifacts.
    await probeHandoffContext(handoffId);

    await resetFixture();
  }, 300000);
});

describe('Phase 31A — decline/disable persistence (§7)', () => {
  it('declining keeps visual review disabled across restart with no PNGs and no re-prompt', async () => {
    freshSettings();
    await resetFixture();
    studioProc = await bootStudio();

    // Consent banner shown on fresh state; the REAL decline path is clicked
    // at the selecting stage.
    await runReportToHandoff(
      'The card looks off',
      'The card should keep its layout',
      async () => {
        await page.waitForSelector('.policy-banner', { timeout: 10000 });
        await clickAction('policy-disable');
        await page.waitForSelector('.policy-banner', { state: 'detached', timeout: 10000 });

        // The chosen decision is persisted.
        const settings = readJson(SETTINGS_FILE) as { visualReviewArtifacts?: string };
        expect(settings.visualReviewArtifacts).toBe('disabled');
      },
      true,
    );

    // Restart: policy remains disabled and the one-time answered contract
    // holds — the banner is not shown again.
    killTree(studioProc);
    studioProc = null;
    await sleep(1500);
    studioProc = await bootStudio();

    // Report/handoff still works, writes NO visual-review PNGs, and never
    // re-prompts.
    const { issueId } = await runReportToHandoff(
      'The card looks off',
      'The card should keep its layout',
      async () => {
        const wf = await workflowState();
        expect(wf.visualReviewPolicy).toBe('disabled');
        expect(wf.visualReviewPolicyAsked).toBe(true);
        expect(await page.locator('.policy-banner').count()).toBe(0);
      },
    );
    expect(fs.existsSync(join(REVIEWS_DIR, 'baselines', issueId))).toBe(false);

    // Verify reports visual comparison unavailable rather than pixels.
    await clickAction('verify-start');
    await waitForStage('verifying');
    await clickAction('verify-recapture');
    await waitForStage('review_ready');
    await page.waitForSelector('.review-visual[data-visual-status="unavailable"]', {
      timeout: 10000,
    });
    expect(await page.locator('.review-visual').innerText()).toContain(
      'local visual review is disabled',
    );
    expect(listPngs(REVIEWS_DIR)).toEqual([]);

    await resetFixture();
  }, 300000);
});

describe('Phase 31A — malformed settings fail closed (§8)', () => {
  it('an unexpected visualReviewArtifacts value (and corrupt JSON) resolves to disabled — never fail open', async () => {
    // Malformed but parseable: unexpected enum value.
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ visualReviewArtifacts: 'unexpected-value' }));
    await resetFixture();
    studioProc = await bootStudio();

    const state = await getStudioState();
    expect((state.settings as { visualReviewArtifacts?: string }).visualReviewArtifacts).toBe(
      'disabled',
    );

    // The workflow still works with the effective disabled policy: no PNGs.
    // Because the settings file exists (even malformed), the one-time
    // consent is not re-shown and no opt-in is offered.
    const { issueId } = await runReportToHandoff(
      'The card looks off',
      'The card should keep its layout',
      async () => {
        expect((await workflowState()).visualReviewPolicy).toBe('disabled');
        expect(await page.locator('.policy-banner').count()).toBe(0);
      },
    );
    expect(fs.existsSync(join(REVIEWS_DIR, 'baselines', issueId))).toBe(false);
    expect(listPngs(REVIEWS_DIR)).toEqual([]);

    // Corrupt (non-JSON) settings: restart → still disabled.
    killTree(studioProc);
    studioProc = null;
    await sleep(1000);
    fs.writeFileSync(SETTINGS_FILE, '{not valid json');
    studioProc = await bootStudio();
    const state2 = await getStudioState();
    expect((state2.settings as { visualReviewArtifacts?: string }).visualReviewArtifacts).toBe(
      'disabled',
    );
    expect(JSON.stringify(state2.settings)).not.toContain('local-sensitive-target-crop');
  }, 300000);
});
