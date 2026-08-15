import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  REVIEWS_DIR,
  type Result,
  VISKOD_STORAGE_DIR,
  type ViskodError,
  createViskodError,
  err,
  ok,
} from '@viskod/shared';
import {
  ARTIFACT_BASELINES_DIR,
  ARTIFACT_ID_PATTERN,
  REVIEW_ARTIFACTS_MANIFEST_FILE,
  type ReviewArtifactComparison,
  type ReviewArtifactEntry,
  type ReviewArtifactStatus,
  type ReviewArtifactsManifest,
  type TargetCropCapture,
  type VisualArtifactPolicy,
} from './artifact-types';
import {
  ImageDecodeError,
  type PixelDiffResult,
  assertValidPng,
  compareElementImages,
} from './pixel-diff';

/**
 * Durable local review artifact storage (Phase 31).
 *
 * Layout:
 *   .viskod/reviews/
 *     baselines/<issueId>/before.png + manifest.json   — pre-change baseline
 *     <reviewId>/review.json                           — ReviewPersistence
 *     <reviewId>/before.png after.png diff.png         — committed artifacts
 *     <reviewId>/manifest.json                         — durable pairing contract
 *
 * Safety rules (Phase 29 patterns):
 * - every write is temp-write → validate/decode → atomic rename; a temp file
 *   never appears as a committed artifact and failed writes leave no
 *   committed evidence;
 * - opaque artifact ids only (`art_<32hex>`); user input never becomes a path;
 * - the manifest is written last as the commit marker: a review dir with
 *   images but no valid manifest is NOT treated as complete review evidence;
 * - artifacts are marked sensitive/localOnly and never referenced from the
 *   agent-safe packet or handoff context.
 */

const BASELINE_DIR_NAME = ARTIFACT_BASELINES_DIR;
const ARTIFACT_FILE_BY_ROLE: Record<string, string> = {
  before: 'before.png',
  after: 'after.png',
  diff: 'diff.png',
};

export type ArtifactErrorCode =
  | 'ARTIFACT_POLICY_DISABLED'
  | 'ARTIFACT_BASELINE_NOT_FOUND'
  | 'ARTIFACT_NOT_FOUND'
  | 'ARTIFACT_INVALID_ID'
  | 'ARTIFACT_WRITE_FAILED'
  | 'ARTIFACT_READ_FAILED'
  | 'ARTIFACT_CORRUPT'
  | 'ARTIFACT_INVALID_IMAGE'
  | 'ARTIFACT_MANIFEST_INVALID';

export class ReviewArtifactStore {
  private baseDir: string;
  private policy: VisualArtifactPolicy;

  constructor(baseDir?: string, policy: VisualArtifactPolicy = 'disabled') {
    this.baseDir = baseDir ?? path.join(process.cwd(), VISKOD_STORAGE_DIR, REVIEWS_DIR);
    this.policy = policy;
    try {
      fs.mkdirSync(this.baseDir, { recursive: true });
    } catch {
      /* best effort */
    }
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  setPolicy(policy: VisualArtifactPolicy): void {
    this.policy = policy;
  }

  isEnabled(): boolean {
    return this.policy === 'local-sensitive-target-crop';
  }

  // ---------------------------------------------------------------------
  // Baselines (pre-change target crops, tied to the ISSUE lineage)
  // ---------------------------------------------------------------------

  /** Persist the pre-change target crop for an issue (atomic, validated). */
  async saveBaseline(
    issueId: string,
    shot: TargetCropCapture,
  ): Promise<Result<ReviewArtifactEntry>> {
    if (!this.isEnabled()) {
      return ok({
        artifactId: newArtifactId(),
        role: 'before',
        status: 'not_collected',
        failureReason: 'visual-review artifact policy is disabled',
      });
    }
    if (shot.resolutionStatus !== 'resolved') {
      return ok({
        artifactId: newArtifactId(),
        role: 'before',
        status: 'not_collected',
        failureReason: `target resolution: ${shot.resolutionStatus}`,
      });
    }
    const entry = this.buildEntry('before', shot, 'collected');
    const dir = this.baselineDir(issueId);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
      return err(
        this.aeError('ARTIFACT_WRITE_FAILED', `Cannot create baseline dir: ${String(error)}`),
      );
    }

    const write = this.writeArtifactFile(dir, 'before.png', shot.buffer);
    if (!write.ok) return write;

    const manifest: ReviewArtifactsManifest = {
      schemaVersion: 1,
      reviewId: '', // baselines are issue-scoped, not review-scoped
      issueId,
      sensitive: true,
      localOnly: true,
      policy: this.policy,
      artifacts: [entry],
      pairing: { beforeArtifactId: entry.artifactId },
      updatedAt: new Date().toISOString(),
    };
    const manifestWrite = this.writeManifest(dir, manifest);
    if (!manifestWrite.ok) return manifestWrite;

    return ok(entry);
  }

  /** Load the persisted baseline manifest for an issue, if any. */
  async loadBaseline(issueId: string): Promise<Result<ReviewArtifactsManifest | null>> {
    const dir = this.baselineDir(issueId);
    const manifestPath = path.join(dir, REVIEW_ARTIFACTS_MANIFEST_FILE);
    if (!fs.existsSync(manifestPath)) return ok(null);
    return this.readManifest(manifestPath);
  }

  /** Read the baseline crop buffer for an issue. */
  async readBaselineBuffer(issueId: string): Promise<Result<Buffer>> {
    const manifest = await this.loadBaseline(issueId);
    if (!manifest.ok) return manifest;
    if (!manifest.value) {
      return err(this.aeError('ARTIFACT_BASELINE_NOT_FOUND', `No baseline for issue '${issueId}'`));
    }
    const before = manifest.value.artifacts.find((a) => a.role === 'before');
    if (!before || before.status !== 'collected') {
      return err(
        this.aeError('ARTIFACT_BASELINE_NOT_FOUND', `No collected baseline for issue '${issueId}'`),
      );
    }
    return this.readArtifactFile(this.baselineDir(issueId), 'before.png');
  }

  // ---------------------------------------------------------------------
  // Review-scoped artifacts (before/after/diff + pairing manifest)
  // ---------------------------------------------------------------------

  /**
   * Ensure the review's before artifact exists, copying the issue baseline
   * when present. Called at review creation — the baseline was captured
   * before the coding agent modified the page, never fabricated from the
   * post-change page.
   */
  async ensureBeforeForReview(
    reviewId: string,
    issueId: string,
  ): Promise<Result<ReviewArtifactsManifest | null>> {
    const baseline = await this.loadBaseline(issueId);
    if (!baseline.ok) return baseline;
    if (!baseline.value) return ok(null);

    const before = baseline.value.artifacts.find((a) => a.role === 'before');
    if (!before || before.status !== 'collected') return ok(null);

    const beforeBuffer = await this.readArtifactFile(this.baselineDir(issueId), 'before.png');
    if (!beforeBuffer.ok) return beforeBuffer;

    const dir = this.reviewDir(reviewId);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
      return err(
        this.aeError('ARTIFACT_WRITE_FAILED', `Cannot create review dir: ${String(error)}`),
      );
    }

    const reviewEntry: ReviewArtifactEntry = {
      ...before,
      artifactId: newArtifactId(),
      role: 'before',
    };
    const write = this.writeArtifactFile(dir, 'before.png', beforeBuffer.value);
    if (!write.ok) return write;

    const manifest: ReviewArtifactsManifest = {
      schemaVersion: 1,
      reviewId,
      issueId,
      sensitive: true,
      localOnly: true,
      policy: this.policy,
      artifacts: [reviewEntry],
      pairing: { beforeArtifactId: reviewEntry.artifactId },
      updatedAt: new Date().toISOString(),
    };
    const manifestWrite = this.writeManifest(dir, manifest);
    if (!manifestWrite.ok) return manifestWrite;
    return ok(manifest);
  }

  /**
   * Persist the after crop, run the real pixel comparison against the
   * persisted before artifact, persist the diff, and update the pairing
   * manifest. Returns the fresh manifest.
   */
  async saveAfterForReview(
    reviewId: string,
    issueId: string,
    shot: TargetCropCapture,
  ): Promise<Result<ReviewArtifactsManifest | null>> {
    if (!this.isEnabled()) return ok(null);
    const dir = this.reviewDir(reviewId);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
      return err(
        this.aeError('ARTIFACT_WRITE_FAILED', `Cannot create review dir: ${String(error)}`),
      );
    }
    const existing = await this.loadManifest(reviewId);
    if (!existing.ok) return existing; // corrupt manifest — never silently overwrite evidence

    let manifest: ReviewArtifactsManifest;
    if (existing.value) {
      manifest = existing.value;
    } else {
      // No before was registered (no baseline): still record a collected
      // after artifact, but the comparison stays unavailable.
      manifest = {
        schemaVersion: 1,
        reviewId,
        issueId,
        sensitive: true,
        localOnly: true,
        policy: this.policy,
        artifacts: [],
        pairing: {},
        updatedAt: new Date().toISOString(),
      };
    }

    if (shot.resolutionStatus !== 'resolved') {
      manifest.artifacts = manifest.artifacts.filter((a) => a.role !== 'after');
      manifest.artifacts.push({
        artifactId: newArtifactId(),
        role: 'after',
        status: 'not_collected',
        failureReason: `target resolution: ${shot.resolutionStatus}`,
      });
      manifest.comparison = {
        status: 'unavailable',
        reason: 'after target could not be resolved — no visual comparison possible',
      };
      const mw = this.writeManifest(dir, manifest);
      if (!mw.ok) return mw;
      return ok(manifest);
    }

    const afterEntry = this.buildEntry('after', shot, 'collected');
    const write = this.writeArtifactFile(dir, 'after.png', shot.buffer);
    if (!write.ok) return write;

    const beforeArtifact = manifest.artifacts.find(
      (a) => a.role === 'before' && a.status === 'collected',
    );
    let comparison: ReviewArtifactComparison = {
      status: 'unavailable',
      reason: 'before artifact unavailable — visual comparison not possible',
    };
    let diffEntry: ReviewArtifactEntry | null = null;

    if (beforeArtifact) {
      const beforeBuffer = await this.readArtifactFile(dir, 'before.png');
      if (beforeBuffer.ok) {
        try {
          const result = compareElementImages(beforeBuffer.value, shot.buffer);
          const diffWrite = this.writeArtifactFile(dir, 'diff.png', result.diffImage);
          if (diffWrite.ok) {
            diffEntry = {
              artifactId: newArtifactId(),
              role: 'diff',
              status: 'collected',
              capturedAt: new Date().toISOString(),
            };
          }
          comparison = {
            status: 'unchanged', // refined by the caller (comparison.ts) from metrics + geometry
            changedPixelRatio: round4(result.changedPixelRatio),
            changedPixels: result.changedPixels,
            totalPixels: result.totalPixels,
            comparisonDimensions: { width: result.width, height: result.height },
            beforeDimensions: { width: result.beforeWidth, height: result.beforeHeight },
            afterDimensions: { width: result.afterWidth, height: result.afterHeight },
            pixelDiffConfigVersion: result.configVersion,
          };
        } catch {
          comparison = {
            status: 'unavailable',
            reason: 'image comparison failed — artifact data invalid',
          };
        }
      }
    }

    manifest.artifacts = manifest.artifacts.filter((a) => a.role !== 'after' && a.role !== 'diff');
    manifest.artifacts.push(afterEntry);
    if (diffEntry) manifest.artifacts.push(diffEntry);
    manifest.pairing = {
      beforeArtifactId: beforeArtifact?.artifactId,
      afterArtifactId: afterEntry.artifactId,
      diffArtifactId: diffEntry?.artifactId,
    };
    manifest.comparison = comparison;
    manifest.updatedAt = new Date().toISOString();

    const mw = this.writeManifest(dir, manifest);
    if (!mw.ok) return mw;
    return ok(manifest);
  }

  /** Load the review's artifact manifest, or null when no artifacts exist. */
  async loadManifest(reviewId: string): Promise<Result<ReviewArtifactsManifest | null>> {
    const manifestPath = path.join(this.reviewDir(reviewId), REVIEW_ARTIFACTS_MANIFEST_FILE);
    if (!fs.existsSync(manifestPath)) return ok(null);
    return this.readManifest(manifestPath);
  }

  /** Persist the finalized comparison into the review manifest (atomic). */
  async updateComparison(
    reviewId: string,
    comparison: ReviewArtifactComparison | null,
  ): Promise<Result<void>> {
    const manifest = await this.loadManifest(reviewId);
    if (!manifest.ok) return manifest;
    if (!manifest.value) {
      return err(
        this.aeError('ARTIFACT_NOT_FOUND', `No artifact manifest for review '${reviewId}'`),
      );
    }
    manifest.value.comparison = comparison ?? undefined;
    manifest.value.updatedAt = new Date().toISOString();
    return this.writeManifest(this.reviewDir(reviewId), manifest.value);
  }

  /** Read a committed artifact buffer by its opaque id (traversal-safe). */
  async readArtifact(reviewId: string, artifactId: string): Promise<Result<Buffer>> {
    if (!ARTIFACT_ID_PATTERN.test(artifactId)) {
      return err(this.aeError('ARTIFACT_INVALID_ID', `Invalid artifact ID: ${artifactId}`));
    }
    const manifest = await this.loadManifest(reviewId);
    if (!manifest.ok) return manifest;
    if (!manifest.value) {
      return err(this.aeError('ARTIFACT_NOT_FOUND', `No artifacts for review '${reviewId}'`));
    }
    const entry = manifest.value.artifacts.find((a) => a.artifactId === artifactId);
    if (!entry || entry.status !== 'collected') {
      return err(this.aeError('ARTIFACT_NOT_FOUND', `Artifact '${artifactId}' not found`));
    }
    const fileName = ARTIFACT_FILE_BY_ROLE[entry.role];
    if (!fileName) {
      return err(this.aeError('ARTIFACT_NOT_FOUND', `Unknown artifact role: ${entry.role}`));
    }
    return this.readArtifactFile(this.reviewDir(reviewId), fileName);
  }

  /** Remove all review artifacts for a review (dir is shared with review.json). */
  deleteReviewArtifacts(reviewId: string): void {
    try {
      fs.rmSync(this.reviewDir(reviewId), { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private baselineDir(issueId: string): string {
    return path.join(this.baseDir, BASELINE_DIR_NAME, issueId);
  }

  private reviewDir(reviewId: string): string {
    return path.join(this.baseDir, reviewId);
  }

  private buildEntry(
    role: 'before' | 'after',
    shot: TargetCropCapture,
    status: ReviewArtifactStatus,
  ): ReviewArtifactEntry {
    return {
      artifactId: newArtifactId(),
      role,
      status,
      capturedAt: shot.capturedAt,
      dimensions: { width: shot.width, height: shot.height },
      crop: { rect: shot.cropRect, padding: shot.padding },
      target: {
        boundingBox: shot.targetRect,
        selector: shot.resolutionStatus === 'resolved' ? 'resolved-element' : '',
        targetId: shot.identity?.targetId,
        stableAttributes: shot.identity?.stableAttributes,
      },
      viewport: {
        width: shot.viewport.width,
        height: shot.viewport.height,
        deviceScaleFactor: shot.viewport.deviceScaleFactor,
      },
      pageUrl: shot.url,
    };
  }

  private writeArtifactFile(dir: string, fileName: string, buffer: Buffer): Result<void> {
    try {
      assertValidPng(buffer);
    } catch {
      return err(this.aeError('ARTIFACT_INVALID_IMAGE', `${fileName} is not a valid PNG`));
    }
    const target = path.join(dir, fileName);
    const temp = `${target}.tmp-${crypto.randomUUID().slice(0, 8)}`;
    try {
      fs.writeFileSync(temp, buffer);
      fs.renameSync(temp, target);
      return ok(undefined);
    } catch (error) {
      try {
        if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
      } catch {
        /* best effort */
      }
      return err(
        this.aeError('ARTIFACT_WRITE_FAILED', `Failed to write ${fileName}: ${String(error)}`),
      );
    }
  }

  private writeManifest(dir: string, manifest: ReviewArtifactsManifest): Result<void> {
    const target = path.join(dir, REVIEW_ARTIFACTS_MANIFEST_FILE);
    const temp = `${target}.tmp-${crypto.randomUUID().slice(0, 8)}`;
    try {
      fs.writeFileSync(temp, JSON.stringify(manifest, null, 2), 'utf-8');
      fs.renameSync(temp, target);
      return ok(undefined);
    } catch (error) {
      try {
        if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
      } catch {
        /* best effort */
      }
      return err(
        this.aeError('ARTIFACT_WRITE_FAILED', `Failed to write manifest: ${String(error)}`),
      );
    }
  }

  private readManifest(manifestPath: string): Result<ReviewArtifactsManifest> {
    try {
      const raw = fs.readFileSync(manifestPath, 'utf-8');
      const parsed = JSON.parse(raw) as ReviewArtifactsManifest;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.artifacts) || !parsed.pairing) {
        return err(
          this.aeError('ARTIFACT_MANIFEST_INVALID', `Invalid artifact manifest at ${manifestPath}`),
        );
      }
      return ok(parsed);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return err(
          this.aeError('ARTIFACT_MANIFEST_INVALID', `Corrupt artifact manifest: ${String(error)}`),
        );
      }
      return err(this.aeError('ARTIFACT_READ_FAILED', `Failed to read manifest: ${String(error)}`));
    }
  }

  private readArtifactFile(dir: string, fileName: string): Result<Buffer> {
    const filePath = path.join(dir, fileName);
    if (!fs.existsSync(filePath)) {
      return err(this.aeError('ARTIFACT_NOT_FOUND', `Artifact file ${fileName} not found`));
    }
    try {
      const buffer = fs.readFileSync(filePath);
      assertValidPng(buffer);
      return ok(buffer);
    } catch (error) {
      if (error instanceof ImageDecodeError) {
        return err(this.aeError('ARTIFACT_INVALID_IMAGE', `Artifact file ${fileName} is corrupt`));
      }
      return err(
        this.aeError(
          'ARTIFACT_READ_FAILED',
          `Failed to read artifact ${fileName}: ${String(error)}`,
        ),
      );
    }
  }

  private aeError(code: ArtifactErrorCode | string, message: string): ViskodError {
    return createViskodError({
      code,
      category: 'storage',
      severity: 'recoverable',
      message,
      subsystem: 'visual-review-artifacts',
    });
  }
}

function newArtifactId(): string {
  return `art_${crypto.randomUUID().replace(/-/g, '')}`;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export type { PixelDiffResult };
