import type { VisualComparison, VisualComparisonStatus, ReviewSnapshotRef, RectDelta } from './types';

export function computeComparison(
  before: ReviewSnapshotRef,
  after: ReviewSnapshotRef,
): VisualComparison {
  const warnings: string[] = [];
  const targetWarnings: string[] = [];

  const beforeStatus = before.targetSummary.resolutionStatus;
  const afterStatus = after.targetSummary.resolutionStatus;

  if (beforeStatus === 'stale') {
    warnings.push('The before snapshot may be stale — the page has changed since the issue was created.');
  }
  if (beforeStatus === 'missing') {
    warnings.push('The before target cannot be resolved in the original page context.');
  }
  if (afterStatus === 'missing') {
    warnings.push('The after target cannot be resolved in the current page.');
    targetWarnings.push('Target disappeared after recapture.');
  }
  if (afterStatus === 'ambiguous') {
    warnings.push('Multiple targets match after recapture — the fix may have introduced duplicates.');
    targetWarnings.push('Target is ambiguous after recapture.');
  }

  const sameTargetLikely = determineSameTargetLikely(before, after, targetWarnings);

  const confidence = computeConfidence(before, after, sameTargetLikely, warnings);

  const status = determineComparisonStatus(before, after, sameTargetLikely, warnings);

  const summary = buildComparisonSummary(status, before, after, sameTargetLikely, warnings);

  const boundingBoxDelta = computeBoundingBoxDelta(before, after);

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
    visual: boundingBoxDelta ? { boundingBoxDelta } : undefined,
    warnings,
  };
}

function determineSameTargetLikely(
  before: ReviewSnapshotRef,
  after: ReviewSnapshotRef,
  targetWarnings: string[],
): boolean {
  if (targetWarnings.length > 0) return false;

  if (before.targetSummary.mode !== after.targetSummary.mode) return false;
  if (before.targetSummary.targetCount !== after.targetSummary.targetCount) return false;

  if (before.targetSummary.label && after.targetSummary.label) {
    if (normalizeText(before.targetSummary.label) !== normalizeText(after.targetSummary.label)) {
      return false;
    }
  }

  if (before.targetSummary.role && after.targetSummary.role) {
    if (before.targetSummary.role !== after.targetSummary.role) return false;
  }

  if (before.targetSummary.textPreview && after.targetSummary.textPreview) {
    const beforePreview = normalizeText(before.targetSummary.textPreview);
    const afterPreview = normalizeText(after.targetSummary.textPreview);
    if (beforePreview !== afterPreview) return false;
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
  warnings: string[],
): VisualComparisonStatus {
  if (after.targetSummary.resolutionStatus === 'missing') return 'missing_after';
  if (after.targetSummary.resolutionStatus === 'ambiguous') return 'ambiguous_after';
  if (before.targetSummary.resolutionStatus === 'stale') return 'stale_before';

  if (!sameTargetLikely) return 'changed';

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

function buildComparisonSummary(
  status: VisualComparisonStatus,
  before: ReviewSnapshotRef,
  after: ReviewSnapshotRef,
  sameTargetLikely: boolean,
  warnings: string[],
): string {
  switch (status) {
    case 'unchanged':
      return 'The selected target appears unchanged after recapture. Review the visual evidence to confirm.';
    case 'changed':
      return `The selected target changed after recapture. ${sameTargetLikely ? 'The same element appears to be targeted but its properties differ.' : 'The target may have shifted or been replaced.'}`;
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
