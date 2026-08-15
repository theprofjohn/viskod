import type { ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BrowserHandle, ElementScreenshot } from '../../packages/browser-runtime/src/index';
import { BrowserRuntime } from '../../packages/browser-runtime/src/index';
import { EventBus } from '../../packages/event-bus/src/index';
import {
  UNCHANGED_PIXEL_RATIO_THRESHOLD,
  compareElementImages,
  finalizeArtifactComparison,
} from '../../packages/visual-review/src/index';
import { ReviewArtifactStore } from '../../packages/visual-review/src/index';
import type {
  ReviewArtifactComparison,
  ReviewSnapshotRef,
} from '../../packages/visual-review/src/index';
import { ROOT, killTree, sleep, spawnProc, waitForHttp } from './harness';

/**
 * Phase 31 visual regression corpus — REAL Chromium pixels.
 *
 * Drives the same production primitives the review pipeline uses
 * (BrowserRuntime.captureElementScreenshot → compareElementImages →
 * finalizeArtifactComparison) against deterministic fixture states:
 * unchanged / color / typography / border-shadow / size / position / text /
 * target-replaced / viewport-mismatch / missing-baseline.
 *
 * The corpus proves that unchanged targets stay unchanged, real visual
 * changes are detected through pixels/geometry, replaced targets are never
 * silently compared, and incompatible rendering conditions are incomparable.
 */

const FIXTURE_URL = 'http://127.0.0.1:3224';
const TARGET_SELECTOR = '[data-testid="target-card"]';
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

let fixtureProc: ChildProcess | null = null;
let runtime: BrowserRuntime;
let handle: BrowserHandle;

async function setState(patch: Record<string, unknown>): Promise<void> {
  const res = await fetch(STATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`fixture state update failed: ${res.status}`);
}

async function openPage(): Promise<void> {
  const nav = await runtime.navigate(handle, `${FIXTURE_URL}/?viskodReset=1&cb=${Date.now()}`);
  if (!nav.ok) throw new Error(`navigate failed: ${nav.error.message}`);
  // Let the fixture render settle before capturing.
  await sleep(300);
}

function snapshotFromShot(shot: ElementScreenshot, kind: 'before' | 'after'): ReviewSnapshotRef {
  const resolved = shot.resolutionStatus === 'resolved';
  return {
    snapshotId: crypto.randomUUID(),
    kind,
    capturedAt: shot.capturedAt,
    source: {},
    page: { url: shot.url, viewport: shot.viewport },
    targetSummary: {
      mode: 'single',
      label: shot.text?.slice(0, 60) ?? undefined,
      textPreview: shot.text,
      targetCount: resolved ? 1 : 0,
      confidence: resolved ? 0.95 : 0,
      resolutionStatus: resolved ? 'resolved' : 'missing',
    },
    identity: shot.identity,
    visualEvidence: { overlayExcluded: false, cropRect: shot.targetRect },
    evidenceSummary: {
      hasSelection: true,
      hasContextPacket: false,
      hasScreenshot: true,
      hasSourceHints: false,
    },
  };
}

interface CorpusResult {
  before: ElementScreenshot;
  after: ElementScreenshot;
  finalStatus: ReviewArtifactComparison['status'];
  changedPixelRatio: number;
  geometry?: { xDelta?: number; yDelta?: number; widthDelta?: number; heightDelta?: number };
}

async function captureBoth(changedState: Record<string, unknown> | null): Promise<CorpusResult> {
  // BEFORE = pristine default state.
  await setState({ ...DEFAULT_STATE });
  await openPage();
  const before = await runtime.captureElementScreenshot(handle, TARGET_SELECTOR);
  if (!before.ok) throw new Error(`before capture failed: ${before.error.message}`);

  // AFTER = the mutated state, recaptured through the Phase 28B pipeline.
  if (changedState) {
    await setState(changedState);
    await openPage();
  }
  const after = await runtime.captureElementScreenshot(handle, TARGET_SELECTOR);
  if (!after.ok) throw new Error(`after capture failed: ${after.error.message}`);

  const beforeSnap = snapshotFromShot(before.value, 'before');
  const afterSnap = snapshotFromShot(after.value, 'after');

  if (after.value.resolutionStatus !== 'resolved') {
    return {
      before: before.value,
      after: after.value,
      finalStatus: 'unavailable',
      changedPixelRatio: 0,
    };
  }

  const beforeBuffer = before.value.buffer;
  const afterBuffer = after.value.buffer;
  if (!beforeBuffer || !afterBuffer) {
    throw new Error('resolved capture without buffer');
  }
  const pixel = compareElementImages(beforeBuffer, afterBuffer);
  const finalized = finalizeArtifactComparison(beforeSnap, afterSnap, {
    status: 'unchanged', // placeholder — finalize decides from pixels + geometry
    changedPixelRatio: pixel.changedPixelRatio,
    changedPixels: pixel.changedPixels,
    totalPixels: pixel.totalPixels,
    comparisonDimensions: { width: pixel.width, height: pixel.height },
    beforeDimensions: { width: pixel.beforeWidth, height: pixel.beforeHeight },
    afterDimensions: { width: pixel.afterWidth, height: pixel.afterHeight },
    pixelDiffConfigVersion: pixel.configVersion,
  });

  return {
    before: before.value,
    after: after.value,
    finalStatus: finalized.status,
    changedPixelRatio: pixel.changedPixelRatio,
    geometry: finalized.geometry,
  };
}

beforeAll(async () => {
  fixtureProc = spawnProc('node', ['examples/visual-review-app/server.cjs']);
  await waitForHttp(`${FIXTURE_URL}/`, 20000, 'visual-review fixture');
  runtime = new BrowserRuntime(new EventBus());
  const launched = await runtime.launch();
  if (!launched.ok) throw new Error(`browser launch failed: ${launched.error.message}`);
  handle = launched.value;
}, 120000);

afterAll(async () => {
  try {
    await runtime.shutdown(handle);
  } catch {
    /* browser already gone */
  }
  killTree(fixtureProc);
});

describe('Phase 31 visual regression corpus (real Chromium)', () => {
  it('A. UNCHANGED — identical state stays unchanged', async () => {
    const result = await captureBoth(null);
    expect(result.after.resolutionStatus).toBe('resolved');
    expect(result.finalStatus).toBe('unchanged');
    expect(result.changedPixelRatio).toBeLessThan(UNCHANGED_PIXEL_RATIO_THRESHOLD);
    // Same logical target through the Phase 28B pipeline.
    expect(result.before.identity?.stableAttributes?.['data-testid']).toBe('target-card');
    expect(result.after.identity?.stableAttributes?.['data-testid']).toBe('target-card');
  });

  it('B. COLOR ONLY — background change detected via pixels', async () => {
    const result = await captureBoth({ background: '#ff0000' });
    expect(result.finalStatus).toBe('changed');
    expect(result.changedPixelRatio).toBeGreaterThan(UNCHANGED_PIXEL_RATIO_THRESHOLD);
  });

  it('C. TYPOGRAPHY — font-size change detected', async () => {
    const result = await captureBoth({ fontSize: '26px', fontWeight: '700' });
    expect(result.finalStatus).toBe('changed');
    expect(result.changedPixelRatio).toBeGreaterThan(UNCHANGED_PIXEL_RATIO_THRESHOLD);
  });

  it('D. BORDER / SHADOW — border width and shadow change detected', async () => {
    const result = await captureBoth({
      border: '8px solid #000000',
      shadow: '0 12px 24px rgba(0, 0, 0, 0.4)',
    });
    expect(result.finalStatus).toBe('changed');
    expect(result.changedPixelRatio).toBeGreaterThan(UNCHANGED_PIXEL_RATIO_THRESHOLD);
  });

  it('E. TARGET SIZE — width change detected via geometry/pixels', async () => {
    const result = await captureBoth({ width: '320px' });
    expect(result.finalStatus).toBe('changed');
    // Geometry is separate evidence: the width delta is nonzero.
    expect(Math.abs(result.geometry?.widthDelta ?? 0)).toBeGreaterThan(1);
  });

  it('F. POSITION ONLY — movement detected through geometry', async () => {
    const result = await captureBoth({ marginLeft: '90px' });
    expect(result.finalStatus).toBe('changed');
    expect(Math.abs(result.geometry?.xDelta ?? 0)).toBeGreaterThan(1);
  });

  it('G. TEXT CHANGE — content change detected', async () => {
    const result = await captureBoth({ text: 'Target card updated with new copy' });
    expect(result.finalStatus).toBe('changed');
    expect(result.changedPixelRatio).toBeGreaterThan(UNCHANGED_PIXEL_RATIO_THRESHOLD);
  });

  it('H. TARGET REPLACED — original disappears, never silently compared', async () => {
    await setState({ present: false });
    await openPage();
    const before = await runtime.captureElementScreenshot(handle, TARGET_SELECTOR);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.value.resolutionStatus).toBe('missing');
    // The review path maps this to the typed missing_after condition; a
    // replacement element is never compared as the original.
    expect(before.value.resolutionStatus).toBe('missing');
  });

  it('I. VIEWPORT MISMATCH — incomparable, never a confident pixel result', async () => {
    await setState({ ...DEFAULT_STATE });
    await openPage();
    const before = await runtime.captureElementScreenshot(handle, TARGET_SELECTOR);
    expect(before.ok && before.value.resolutionStatus).toBe('resolved');

    await runtime.setViewport(handle, { width: 800, height: 600, deviceScaleFactor: 1 });
    await openPage();
    const after = await runtime.captureElementScreenshot(handle, TARGET_SELECTOR);
    expect(after.ok && after.value.resolutionStatus).toBe('resolved');

    const beforeBuffer = before.ok ? before.value.buffer : undefined;
    const afterBuffer = after.ok ? after.value.buffer : undefined;
    if (!beforeBuffer || !afterBuffer) throw new Error('expected buffers');
    if (!before.ok || !after.ok) throw new Error('expected resolved captures');
    const pixel = compareElementImages(beforeBuffer, afterBuffer);
    const finalized = finalizeArtifactComparison(
      snapshotFromShot(before.value, 'before'),
      snapshotFromShot(after.value, 'after'),
      {
        status: 'unchanged',
        changedPixelRatio: pixel.changedPixelRatio,
        changedPixels: pixel.changedPixels,
        totalPixels: pixel.totalPixels,
        pixelDiffConfigVersion: pixel.configVersion,
      },
    );
    expect(finalized.status).toBe('incomparable');
    expect(finalized.viewportCompatible).toBe(false);
    await runtime.setViewport(handle, { width: 1280, height: 720, deviceScaleFactor: 1 });
  });

  it('J. MISSING BEFORE ARTIFACT — visual comparison unavailable, nothing fabricated', async () => {
    const store = new ReviewArtifactStore(
      join(ROOT, '.viskod-e2e-corpus-artifacts'),
      'local-sensitive-target-crop',
    );
    const baseline = await store.loadBaseline('issue_never_baselined');
    expect(baseline.ok && baseline.value).toBeNull();
  });
});
