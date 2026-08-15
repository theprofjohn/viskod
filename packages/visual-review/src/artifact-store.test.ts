import * as fs from 'node:fs';
import * as path from 'node:path';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReviewArtifactStore } from './artifact-store';
import type { TargetCropCapture } from './artifact-types';
import { assertValidPng } from './pixel-diff';

const TEST_DIR = path.join(process.cwd(), '.viskod-test-artifacts');
const ARTIFACT_STORAGE = path.join(TEST_DIR, 'reviews');

function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    png.data[idx] = rgb[0];
    png.data[idx + 1] = rgb[1];
    png.data[idx + 2] = rgb[2];
    png.data[idx + 3] = 255;
  }
  return PNG.sync.write(png);
}

function makeShot(overrides?: Partial<TargetCropCapture>): TargetCropCapture {
  return {
    buffer: solidPng(40, 20, [10, 120, 200]),
    format: 'png',
    width: 40,
    height: 20,
    targetRect: { x: 100, y: 80, width: 40, height: 20 },
    cropRect: { x: 76, y: 56, width: 88, height: 68 },
    padding: 24,
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    url: 'http://localhost:3224/',
    capturedAt: '2026-08-15T10:00:00.000Z',
    resolutionStatus: 'resolved',
    matchCount: 1,
    identity: { targetId: 'tgt_001', stableAttributes: { 'data-testid': 'target-card' } },
    ...overrides,
  };
}

beforeAll(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(ARTIFACT_STORAGE, { recursive: true });
});

afterAll(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('ReviewArtifactStore — policy boundary', () => {
  it('does not persist a baseline while the policy is disabled', async () => {
    const store = new ReviewArtifactStore(ARTIFACT_STORAGE, 'disabled');
    const result = await store.saveBaseline('issue_disabled', makeShot());
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.status).toBe('not_collected');
    const baseline = await store.loadBaseline('issue_disabled');
    expect(baseline.ok && baseline.value).toBeNull();
  });

  it('persists a baseline when enabled and marks it sensitive/localOnly', async () => {
    const store = new ReviewArtifactStore(ARTIFACT_STORAGE, 'local-sensitive-target-crop');
    const result = await store.saveBaseline('issue_enabled', makeShot());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('collected');
    expect(result.value.artifactId).toMatch(/^art_[a-f0-9]{32}$/);

    const manifest = await store.loadBaseline('issue_enabled');
    expect(manifest.ok && manifest.value).toBeTruthy();
    if (!manifest.ok || !manifest.value) return;
    expect(manifest.value.sensitive).toBe(true);
    expect(manifest.value.localOnly).toBe(true);
    expect(manifest.value.artifacts[0]?.role).toBe('before');
    expect(manifest.value.artifacts[0]?.pageUrl).toBe('http://localhost:3224/');
    // The manifest never stores a filesystem path for the image.
    expect(JSON.stringify(manifest.value)).not.toContain('before.png');
  });

  it('does not persist an unresolvable target', async () => {
    const store = new ReviewArtifactStore(ARTIFACT_STORAGE, 'local-sensitive-target-crop');
    const result = await store.saveBaseline(
      'issue_missing_target',
      makeShot({ resolutionStatus: 'missing', buffer: undefined }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe('not_collected');
  });
});

describe('ReviewArtifactStore — review lifecycle', () => {
  it('copies the baseline into the review on ensureBeforeForReview', async () => {
    const store = new ReviewArtifactStore(ARTIFACT_STORAGE, 'local-sensitive-target-crop');
    await store.saveBaseline('issue_review_lifecycle', makeShot());
    const manifest = await store.ensureBeforeForReview(
      'review_lifecycle_001',
      'issue_review_lifecycle',
    );
    expect(manifest.ok && manifest.value).toBeTruthy();
    if (!manifest.ok || !manifest.value) return;
    expect(manifest.value.reviewId).toBe('review_lifecycle_001');
    expect(manifest.value.issueId).toBe('issue_review_lifecycle');
    expect(manifest.value.pairing.beforeArtifactId).toBeTruthy();
    const before = manifest.value.artifacts.find((a) => a.role === 'before');
    expect(before?.status).toBe('collected');
  });

  it('returns null when no baseline exists (visual unavailable, not fabricated)', async () => {
    const store = new ReviewArtifactStore(ARTIFACT_STORAGE, 'local-sensitive-target-crop');
    const manifest = await store.ensureBeforeForReview(
      'review_no_baseline_001',
      'issue_never_captured',
    );
    expect(manifest.ok && manifest.value).toBeNull();
  });

  it('stores after + diff and pairs them with the exact before artifact', async () => {
    const store = new ReviewArtifactStore(ARTIFACT_STORAGE, 'local-sensitive-target-crop');
    await store.saveBaseline('issue_pairing', makeShot());
    await store.ensureBeforeForReview('review_pairing_001', 'issue_pairing');

    const afterShot = makeShot({ buffer: solidPng(40, 20, [255, 0, 0]) });
    const result = await store.saveAfterForReview('review_pairing_001', 'issue_pairing', afterShot);
    expect(result.ok && result.value).toBeTruthy();
    if (!result.ok || !result.value) return;
    expect(result.value.pairing.beforeArtifactId).toBeTruthy();
    expect(result.value.pairing.afterArtifactId).toBeTruthy();
    expect(result.value.pairing.diffArtifactId).toBeTruthy();
    expect(result.value.comparison?.status).toBe('unchanged'); // refined later by finalizeArtifactComparison
    expect(result.value.comparison?.changedPixelRatio).toBeGreaterThan(0.99);
    expect(result.value.comparison?.pixelDiffConfigVersion).toBe(1);

    const diffId = result.value.pairing.diffArtifactId;
    expect(diffId).toBeTruthy();
    const diff = await store.readArtifact('review_pairing_001', diffId as string);
    expect(diff.ok).toBe(true);
    if (diff.ok) {
      const dims = assertValidPng(diff.value);
      expect(dims.width).toBe(40);
      expect(dims.height).toBe(20);
    }
  });

  it('records an unresolvable after target as not_collected with unavailable comparison', async () => {
    const store = new ReviewArtifactStore(ARTIFACT_STORAGE, 'local-sensitive-target-crop');
    await store.saveBaseline('issue_after_missing', makeShot());
    await store.ensureBeforeForReview('review_after_missing_001', 'issue_after_missing');
    const result = await store.saveAfterForReview(
      'review_after_missing_001',
      'issue_after_missing',
      makeShot({ resolutionStatus: 'missing', buffer: undefined }),
    );
    expect(result.ok && result.value).toBeTruthy();
    if (!result.ok || !result.value) return;
    expect(result.value.artifacts.find((a) => a.role === 'after')?.status).toBe('not_collected');
    expect(result.value.comparison?.status).toBe('unavailable');
  });

  it('updateComparison persists the finalized result', async () => {
    const store = new ReviewArtifactStore(ARTIFACT_STORAGE, 'local-sensitive-target-crop');
    await store.saveBaseline('issue_finalize', makeShot());
    await store.ensureBeforeForReview('review_finalize_001', 'issue_finalize');
    await store.updateComparison('review_finalize_001', {
      status: 'changed',
      changedPixelRatio: 0.5,
    });
    const manifest = await store.loadManifest('review_finalize_001');
    expect(manifest.ok && manifest.value?.comparison?.status).toBe('changed');
  });
});

describe('ReviewArtifactStore — safety and corruption', () => {
  it('rejects traversal/malformed artifact ids before any file access', async () => {
    const store = new ReviewArtifactStore(ARTIFACT_STORAGE, 'local-sensitive-target-crop');
    const traversal = await store.readArtifact('review_pairing_001', '../../../../etc/passwd');
    expect(traversal.ok).toBe(false);
    if (!traversal.ok) expect(traversal.error.code).toBe('ARTIFACT_INVALID_ID');
    const malformed = await store.readArtifact('review_pairing_001', 'art_zz');
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.error.code).toBe('ARTIFACT_INVALID_ID');
  });

  it('never serves an artifact from a different review lineage', async () => {
    const store = new ReviewArtifactStore(ARTIFACT_STORAGE, 'local-sensitive-target-crop');
    await store.saveBaseline('issue_lineage_a', makeShot());
    await store.ensureBeforeForReview('review_lineage_a_001', 'issue_lineage_a');
    const manifest = await store.loadManifest('review_lineage_a_001');
    expect(manifest.ok && manifest.value).toBeTruthy();
    const beforeId = manifest.ok ? manifest.value?.pairing.beforeArtifactId : undefined;
    expect(beforeId).toBeTruthy();
    // A foreign review must not resolve the artifact.
    const foreign = await store.readArtifact('review_lineage_b_001', beforeId as string);
    expect(foreign.ok).toBe(false);
  });

  it('rejects a corrupt PNG on write', async () => {
    const store = new ReviewArtifactStore(ARTIFACT_STORAGE, 'local-sensitive-target-crop');
    const result = await store.saveBaseline(
      'issue_corrupt_png',
      makeShot({ buffer: Buffer.from('not a png at all') }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ARTIFACT_INVALID_IMAGE');
    // No committed artifact or temp residue.
    const baseline = await store.loadBaseline('issue_corrupt_png');
    expect(baseline.ok && baseline.value).toBeNull();
    const entries = fs.readdirSync(path.join(ARTIFACT_STORAGE, 'baselines', 'issue_corrupt_png'));
    expect(entries.filter((e) => e.includes('.tmp'))).toEqual([]);
  });

  it('treats a corrupt manifest as a typed error, never silent evidence', async () => {
    const dir = path.join(ARTIFACT_STORAGE, 'review_corrupt_manifest_001');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), '{invalid json', 'utf-8');
    const store = new ReviewArtifactStore(ARTIFACT_STORAGE, 'local-sensitive-target-crop');
    const manifest = await store.loadManifest('review_corrupt_manifest_001');
    expect(manifest.ok).toBe(false);
    if (!manifest.ok) expect(manifest.error.code).toBe('ARTIFACT_MANIFEST_INVALID');
  });

  it('returns typed error when the manifest references a missing file', async () => {
    const dir = path.join(ARTIFACT_STORAGE, 'review_missing_file_001');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        reviewId: 'review_missing_file_001',
        issueId: 'issue_x',
        sensitive: true,
        localOnly: true,
        policy: 'local-sensitive-target-crop',
        artifacts: [{ artifactId: `art_${'a'.repeat(32)}`, role: 'before', status: 'collected' }],
        pairing: { beforeArtifactId: `art_${'a'.repeat(32)}` },
        updatedAt: new Date().toISOString(),
      }),
    );
    const store = new ReviewArtifactStore(ARTIFACT_STORAGE, 'local-sensitive-target-crop');
    const buffer = await store.readArtifact('review_missing_file_001', `art_${'a'.repeat(32)}`);
    expect(buffer.ok).toBe(false);
    if (!buffer.ok) expect(buffer.error.code).toBe('ARTIFACT_NOT_FOUND');
  });

  it('survives simulated restart (new store instance reads same artifacts)', async () => {
    const fresh = new ReviewArtifactStore(ARTIFACT_STORAGE, 'local-sensitive-target-crop');
    const manifest = await fresh.loadManifest('review_pairing_001');
    expect(manifest.ok && manifest.value).toBeTruthy();
    if (!manifest.ok || !manifest.value) return;
    expect(manifest.value.pairing.afterArtifactId).toBeTruthy();
    const beforeId = manifest.value.pairing.beforeArtifactId;
    expect(beforeId).toBeTruthy();
    const buffer = await fresh.readArtifact('review_pairing_001', beforeId as string);
    expect(buffer.ok).toBe(true);
  });
});

describe('ReviewArtifactStore — Phase 31A baseline durability / fail-closed identity', () => {
  it('preserves the exact baseline bytes and original capturedAt when copying into a review', async () => {
    const store = new ReviewArtifactStore(ARTIFACT_STORAGE, 'local-sensitive-target-crop');
    const capturedAt = '2026-08-15T08:00:00.000Z';
    const shot = makeShot({ capturedAt });
    await store.saveBaseline('issue_identity_copy', shot);

    const baselineManifest = await store.loadBaseline('issue_identity_copy');
    expect(baselineManifest.ok && baselineManifest.value).toBeTruthy();
    if (!baselineManifest.ok || !baselineManifest.value) return;
    const baselineBuffer = await store.readBaselineBuffer('issue_identity_copy');
    expect(baselineBuffer.ok).toBe(true);
    if (!baselineBuffer.ok) return;

    const reviewManifest = await store.ensureBeforeForReview(
      'review_identity_copy_001',
      'issue_identity_copy',
    );
    expect(reviewManifest.ok && reviewManifest.value).toBeTruthy();
    if (!reviewManifest.ok || !reviewManifest.value) return;
    const reviewEntry = reviewManifest.value.artifacts.find((a) => a.role === 'before');
    // The review's before entry keeps the ORIGINAL baseline timestamp — the
    // copy is not a recapture.
    expect(reviewEntry?.capturedAt).toBe(capturedAt);
    // The review manifest pairs to a fresh opaque id for THIS review.
    expect(reviewManifest.value.pairing.beforeArtifactId).toMatch(/^art_[a-f0-9]{32}$/);

    // Byte identity: the review's before.png is the exact original baseline.
    const reviewBuffer = await store.readArtifact(
      'review_identity_copy_001',
      reviewManifest.value.pairing.beforeArtifactId as string,
    );
    expect(reviewBuffer.ok).toBe(true);
    if (reviewBuffer.ok) {
      expect(reviewBuffer.value.equals(baselineBuffer.value)).toBe(true);
    }

    // The baseline itself is untouched: still one before artifact, no
    // after/diff, no second baseline generation.
    const after = await store.loadBaseline('issue_identity_copy');
    expect(after.ok && after.value).toBeTruthy();
    if (!after.ok || !after.value) return;
    expect(after.value.artifacts).toHaveLength(1);
    expect(after.value.artifacts[0]?.role).toBe('before');
    expect(after.value.pairing.afterArtifactId).toBeUndefined();
    const baselineDir = path.join(ARTIFACT_STORAGE, 'baselines', 'issue_identity_copy');
    const files = fs.readdirSync(baselineDir).sort();
    expect(files).toEqual(['before.png', 'manifest.json']);
  });

  it('returns a typed failure when the baseline manifest exists but before.png is missing — never substitutes a post-change image', async () => {
    const store = new ReviewArtifactStore(ARTIFACT_STORAGE, 'local-sensitive-target-crop');
    await store.saveBaseline('issue_baseline_missing_file', makeShot());
    const baselineDir = path.join(ARTIFACT_STORAGE, 'baselines', 'issue_baseline_missing_file');
    expect(fs.existsSync(path.join(baselineDir, 'before.png'))).toBe(true);
    fs.rmSync(path.join(baselineDir, 'before.png'));

    const baselineBuffer = await store.readBaselineBuffer('issue_baseline_missing_file');
    expect(baselineBuffer.ok).toBe(false);
    if (!baselineBuffer.ok) expect(baselineBuffer.error.code).toBe('ARTIFACT_NOT_FOUND');

    // Review creation must fail closed with the same typed error — no
    // post-change image can become the BEFORE artifact.
    const reviewManifest = await store.ensureBeforeForReview(
      'review_missing_baseline_001',
      'issue_baseline_missing_file',
    );
    expect(reviewManifest.ok).toBe(false);
    if (!reviewManifest.ok) expect(reviewManifest.error.code).toBe('ARTIFACT_NOT_FOUND');

    // No review artifact dir was created and NO replacement baseline exists.
    const reviewDir = path.join(ARTIFACT_STORAGE, 'review_missing_baseline_001');
    expect(fs.existsSync(reviewDir)).toBe(false);
    expect(fs.existsSync(path.join(baselineDir, 'before.png'))).toBe(false);
    expect(fs.readdirSync(baselineDir)).toEqual(['manifest.json']);
  });

  it('returns a typed failure for a corrupted baseline before.png — never silently regenerates', async () => {
    const store = new ReviewArtifactStore(ARTIFACT_STORAGE, 'local-sensitive-target-crop');
    await store.saveBaseline('issue_baseline_corrupt', makeShot());
    const baselineDir = path.join(ARTIFACT_STORAGE, 'baselines', 'issue_baseline_corrupt');
    fs.writeFileSync(path.join(baselineDir, 'before.png'), 'not a png at all');

    const baselineBuffer = await store.readBaselineBuffer('issue_baseline_corrupt');
    expect(baselineBuffer.ok).toBe(false);
    if (!baselineBuffer.ok) expect(baselineBuffer.error.code).toBe('ARTIFACT_INVALID_IMAGE');

    const reviewManifest = await store.ensureBeforeForReview(
      'review_corrupt_baseline_001',
      'issue_baseline_corrupt',
    );
    expect(reviewManifest.ok).toBe(false);
    if (!reviewManifest.ok) expect(reviewManifest.error.code).toBe('ARTIFACT_INVALID_IMAGE');
    expect(fs.existsSync(path.join(ARTIFACT_STORAGE, 'review_corrupt_baseline_001'))).toBe(false);
  });
});
