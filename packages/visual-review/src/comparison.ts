import type { ReviewArtifactComparison } from './artifact-types';
import type {
  RectDelta,
  ReviewSnapshotRef,
  VisualComparison,
  VisualComparisonStatus,
} from './types';

export interface ComparisonOptions {
  /** Legacy file-path pixel comparison — superseded by artifact buffers (Phase 31). */
  beforeScreenshotPath?: string;
  afterScreenshotPath?: string;
  /**
   * Phase 31: real pixel-comparison evidence computed from persisted review
   * artifacts. When present it is the authoritative visual result.
   */
  artifactComparison?: ReviewArtifactComparison;
  /** Opaque diff artifact id produced by the artifact store. */
  diffArtifactId?: string;
  /** True when the local visual-review artifact policy is enabled. */
  artifactsEnabled?: boolean;
}

/** Sub-pixel rounding tolerance for geometry deltas (CSS px). */
export const GEOMETRY_TOLERANCE_PX = 1;
/** Viewport/DPR mismatch tolerance (CSS px) before declaring incomparable. */
export const VIEWPORT_TOLERANCE_PX = 2;
/**
 * Unchanged threshold: below this fraction of changed pixels (over the
 * common canvas) the visual result is unchanged — absorbs antialiasing and
 * subpixel rendering noise.
 */
export const UNCHANGED_PIXEL_RATIO_THRESHOLD = 0.005;

export function computeComparison(
  before: ReviewSnapshotRef,
  after: ReviewSnapshotRef,
  options?: ComparisonOptions,
): VisualComparison {
  const warnings: string[] = [];
  const targetWarnings: string[] = [];

  const beforeStatus = before.targetSummary.resolutionStatus;
  const afterStatus = after.targetSummary.resolutionStatus;

  if (beforeStatus === 'stale') {
    warnings.push(
      'The before snapshot may be stale — the page has changed since the issue was created.',
    );
  }
  if (beforeStatus === 'missing') {
    warnings.push('The before target cannot be resolved in the original page context.');
  }
  if (afterStatus === 'missing') {
    warnings.push('The after target cannot be resolved in the current page.');
    targetWarnings.push('Target disappeared after recapture.');
  }
  if (afterStatus === 'ambiguous') {
    warnings.push(
      'Multiple targets match after recapture — the fix may have introduced duplicates.',
    );
    targetWarnings.push('Target is ambiguous after recapture.');
  }

  const sameTargetLikely = determineSameTargetLikely(before, after, targetWarnings);

  const confidence = computeConfidence(before, after, sameTargetLikely, warnings);

  const metadataStatus = determineComparisonStatus(before, after, sameTargetLikely);

  const boundingBoxDelta = computeBoundingBoxDelta(before, after);

  const visual: VisualComparison['visual'] = {
    ...(boundingBoxDelta ? { boundingBoxDelta } : {}),
  };

  // Phase 31: artifact-level visual evidence has precedence over metadata
  // when it exists. Target-level problems (missing/ambiguous after) still
  // dominate — there is no comparable target to diff.
  let status: VisualComparisonStatus = metadataStatus;
  const artifactComparison = options?.artifactComparison;
  if (artifactComparison) {
    if (
      afterStatus === 'missing' ||
      afterStatus === 'ambiguous' ||
      metadataStatus === 'incomparable'
    ) {
      // Target/identity problems dominate: never diff a different element.
      status = metadataStatus;
    } else if (artifactComparison.status === 'unavailable') {
      status = 'visual_unavailable';
      warnings.push('Visual comparison unavailable — before/after images could not be compared.');
    } else {
      status = artifactComparison.status;
    }
    visual.artifactComparison = artifactComparison;
    visual.viewportCompatible = artifactComparison.viewportCompatible;
    if (options?.diffArtifactId) {
      visual.diffArtifactId = options.diffArtifactId;
      visual.screenshotDiffId = 'available';
    }
    visual.changedPixelRatio = artifactComparison.changedPixelRatio;
  } else if (options?.artifactsEnabled) {
    // Policy enabled but no artifact comparison was produced (missing/failed
    // capture): never claim a pixel review happened.
    if (afterStatus !== 'missing' && afterStatus !== 'ambiguous') {
      status = 'visual_unavailable';
    }
    warnings.push('Visual comparison unavailable — local review artifacts were not captured.');
  }

  const summary = buildComparisonSummary(status, sameTargetLikely);

  return {
    status,
    confidence,
    summary,
    target: {
      beforeStatus,
      afterStatus,
      sameTargetLikely,
      warnings: targetWarnings,
    },
    visual,
    warnings,
  };
}

/**
 * Phase 31: finalize the artifact-level pixel comparison into a truthful
 * visual status.
 *
 * - target geometry is separate evidence (x/y/width/height deltas);
 * - viewport/DPR mismatch → incomparable (never a confident pixel result
 *   across incompatible rendering conditions);
 * - changed = meaningful pixel difference AND/OR meaningful geometry delta;
 * - otherwise unchanged.
 */
export function finalizeArtifactComparison(
  before: ReviewSnapshotRef,
  after: ReviewSnapshotRef,
  metrics: ReviewArtifactComparison,
): ReviewArtifactComparison {
  const geometry = computeBoundingBoxDelta(before, after);
  const geometryChanged =
    geometry !== undefined &&
    (Math.abs(geometry.xDelta ?? 0) > GEOMETRY_TOLERANCE_PX ||
      Math.abs(geometry.yDelta ?? 0) > GEOMETRY_TOLERANCE_PX ||
      Math.abs(geometry.widthDelta ?? 0) > GEOMETRY_TOLERANCE_PX ||
      Math.abs(geometry.heightDelta ?? 0) > GEOMETRY_TOLERANCE_PX);

  const viewportCompatible = viewportsCompatible(before, after);
  const pixelChanged = (metrics.changedPixelRatio ?? 0) >= UNCHANGED_PIXEL_RATIO_THRESHOLD;

  let status: ReviewArtifactComparison['status'] = metrics.status;
  let reason = metrics.reason;
  if (metrics.status === 'unavailable') {
    // Preserve the unavailable result — no real comparison happened.
  } else if (!viewportCompatible) {
    status = 'incomparable';
    reason =
      'Viewport or device pixel ratio changed between captures — a pixel comparison across incompatible rendering conditions would be misleading.';
  } else if (geometryChanged || pixelChanged) {
    status = 'changed';
  } else {
    status = 'unchanged';
  }

  return {
    ...metrics,
    status,
    ...(reason ? { reason } : {}),
    geometry,
    geometryChanged,
    viewportCompatible,
  };
}

function viewportsCompatible(before: ReviewSnapshotRef, after: ReviewSnapshotRef): boolean {
  const b = before.page.viewport;
  const a = after.page.viewport;
  if (Math.abs(b.width - a.width) > VIEWPORT_TOLERANCE_PX) return false;
  if (Math.abs(b.height - a.height) > VIEWPORT_TOLERANCE_PX) return false;
  const bDpr = b.deviceScaleFactor ?? 1;
  const aDpr = a.deviceScaleFactor ?? 1;
  if (Math.abs(bDpr - aDpr) > 0.001) return false;
  return true;
}

function identityEvidencePresent(snapshot: ReviewSnapshotRef): boolean {
  const id = snapshot.identity;
  if (!id) return false;
  return (
    !!id.targetId ||
    (id.stableAttributes !== undefined && Object.keys(id.stableAttributes).length > 0)
  );
}

/**
 * Same-target determination (Phase 31 / VISKOD-AUDIT-005): target identity
 * uses the Phase 28B stable-identity model, never display labels or tag
 * names. When identity evidence exists on both sides it is authoritative;
 * otherwise the legacy mode/targetCount heuristic applies.
 */
function determineSameTargetLikely(
  before: ReviewSnapshotRef,
  after: ReviewSnapshotRef,
  targetWarnings: string[],
): boolean {
  if (targetWarnings.length > 0) return false;

  if (before.targetSummary.mode !== after.targetSummary.mode) return false;
  if (before.targetSummary.targetCount !== after.targetSummary.targetCount) return false;

  const beforeIdentity = before.identity;
  const afterIdentity = after.identity;
  if (beforeIdentity || afterIdentity) {
    if (beforeIdentity?.targetId && afterIdentity?.targetId) {
      return beforeIdentity.targetId === afterIdentity.targetId;
    }
    const bAttrs = beforeIdentity?.stableAttributes ?? {};
    const aAttrs = afterIdentity?.stableAttributes ?? {};
    if (Object.keys(bAttrs).length > 0 && Object.keys(aAttrs).length > 0) {
      for (const [key, value] of Object.entries(bAttrs)) {
        if (aAttrs[key] !== value) return false;
      }
      return true;
    }
    // Identity evidence is partial (one side lacks it) — fall back to the
    // legacy heuristic instead of declaring a mismatch on missing data.
  }

  return true;
}

function normalizeText(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

function computeConfidence(
  before: ReviewSnapshotRef,
  after: ReviewSnapshotRef,
  sameTargetLikely: boolean,
  warnings: string[],
): number {
  let confidence = 0.9;
  if (!sameTargetLikely) confidence -= 0.3;
  if (warnings.length > 0) confidence -= 0.1 * warnings.length;
  if (before.targetSummary.confidence < 0.7) confidence -= 0.1;
  if (after.targetSummary.confidence < 0.7) confidence -= 0.1;
  return Math.max(0, Math.min(1, confidence));
}

function determineComparisonStatus(
  before: ReviewSnapshotRef,
  after: ReviewSnapshotRef,
  sameTargetLikely: boolean,
): VisualComparisonStatus {
  if (after.targetSummary.resolutionStatus === 'missing') return 'missing_after';
  if (after.targetSummary.resolutionStatus === 'ambiguous') return 'ambiguous_after';
  if (before.targetSummary.resolutionStatus === 'stale') return 'stale_before';

  if (!sameTargetLikely) {
    // Phase 31: when identity evidence disagrees, the recaptured element is
    // NOT the original target — never compare a replacement as the original.
    if (identityEvidencePresent(before) && identityEvidencePresent(after)) {
      return 'incomparable';
    }
    return 'changed';
  }

  const beforeText = before.targetSummary.textPreview ?? '';
  const afterText = after.targetSummary.textPreview ?? '';
  if (normalizeText(beforeText) !== normalizeText(afterText)) return 'changed';

  const beforeLabel = before.targetSummary.label ?? '';
  const afterLabel = after.targetSummary.label ?? '';
  if (normalizeText(beforeLabel) !== normalizeText(afterLabel)) return 'changed';

  const bv = before.visualEvidence;
  const av = after.visualEvidence;
  if (bv?.cropRect && av?.cropRect) {
    const bd = computeRectDelta(bv.cropRect, av.cropRect);
    if (bd && (bd.widthDelta !== 0 || bd.heightDelta !== 0)) return 'changed';
  }

  return 'unchanged';
}

function computeRectDelta(
  before: { x: number; y: number; width: number; height: number },
  after: { x: number; y: number; width: number; height: number },
): RectDelta {
  return {
    xDelta: Math.round((after.x - before.x) * 100) / 100,
    yDelta: Math.round((after.y - before.y) * 100) / 100,
    widthDelta: Math.round((after.width - before.width) * 100) / 100,
    heightDelta: Math.round((after.height - before.height) * 100) / 100,
  };
}

function computeBoundingBoxDelta(
  before: ReviewSnapshotRef,
  after: ReviewSnapshotRef,
): RectDelta | undefined {
  const bv = before.visualEvidence?.cropRect;
  const av = after.visualEvidence?.cropRect;
  if (!bv || !av) return undefined;
  return computeRectDelta(bv, av);
}

function buildComparisonSummary(status: VisualComparisonStatus, sameTargetLikely: boolean): string {
  switch (status) {
    case 'unchanged':
      return 'The selected target appears unchanged after recapture. Review the visual evidence to confirm.';
    case 'changed':
      return `The selected target changed after recapture. ${sameTargetLikely ? 'The same element appears to be targeted but its properties differ.' : 'The target may have shifted or been replaced.'}`;
    case 'incomparable':
      return 'The before and after captures cannot be safely compared — the target identity or rendering environment changed beyond safe normalization.';
    case 'visual_unavailable':
      return 'Visual comparison unavailable — local review artifacts were not captured or could not be compared.';
    case 'missing_after':
      return 'The selected target is no longer visible in the current page. This may indicate the element was removed or the page changed.';
    case 'ambiguous_after':
      return 'Multiple targets match after recapture. The fix may have introduced duplicate elements or the page structure changed.';
    case 'stale_before':
      return 'The before snapshot is stale — the page has changed since the issue was created. Comparison may be unreliable.';
    case 'capture_failed':
      return 'Failed to capture the after state. Check that the page is accessible and the browser session is active.';
    case 'comparison_failed':
      return 'Comparison could not be completed. The before and after snapshots may be incompatible.';
    default:
      return 'Comparison completed. Review the evidence to determine if the issue was addressed.';
  }
}
