export { ReviewServiceImpl } from './service';
export type { ReviewService } from './service';
export { ReviewPersistence } from './persistence';
export type { ReviewIndex } from './persistence';
export { UserFacingReview } from './ux';
export type { ReviewPreview, ReviewConfirmation } from './ux';
export { computeComparison, finalizeArtifactComparison } from './comparison';
export type { ComparisonOptions } from './comparison';
export {
  GEOMETRY_TOLERANCE_PX,
  VIEWPORT_TOLERANCE_PX,
  UNCHANGED_PIXEL_RATIO_THRESHOLD,
} from './comparison';
export { ReviewArtifactStore } from './artifact-store';
export {
  ARTIFACT_BASELINES_DIR,
  ARTIFACT_ID_PATTERN,
  REVIEW_ARTIFACTS_MANIFEST_FILE,
} from './artifact-types';
export type {
  VisualArtifactPolicy,
  ReviewArtifactRole,
  ReviewArtifactStatus,
  ReviewArtifactEntry,
  ReviewArtifactComparison,
  ReviewArtifactsManifest,
  ReviewArtifactsPreview,
  TargetCropCapture,
} from './artifact-types';
export { compareElementImages, assertValidPng, ImageDecodeError } from './pixel-diff';
export type {
  PixelDiffMetrics,
  PixelDiffResult,
  PixelDiffOptions,
} from './pixel-diff';
export {
  isValidReviewTransition,
  createReviewEvent,
  makeReviewCreatedEvent,
  makeBeforeLoadedEvent,
  makeAfterCaptureStartedEvent,
  makeAfterCaptureCompletedEvent,
  makeComparisonCompletedEvent,
  makeDecisionRecordedEvent,
  makeRecapturedEvent,
  makeFailedEvent,
  makeCancelledEvent,
} from './lifecycle';
export { redactReview, redactReviewText, deepRedactValue } from './redaction';
export type {
  VisualReview,
  VisualReviewStatus,
  VisualComparisonStatus,
  VisualReviewEvent,
  ReviewSnapshotRef,
  VisualComparison,
  VisualReviewDecision,
  Rect,
  RectDelta,
  ReviewErrorCode,
  VisualReviewCreateInput,
  VisualReviewCreateOutput,
  VisualReviewGetOutput,
  VisualReviewDecisionInput,
  VisualReviewListItem,
  VisualReviewRecaptureInput,
  RecaptureAdapter,
  RecaptureOptions,
  RecaptureResult,
  ResolvedRecaptureTarget,
} from './types';
export {
  VisualReviewSchema,
  VisualReviewStatusSchema,
  VisualComparisonStatusSchema,
} from './schemas';
export { resolveRecaptureTarget } from './targetResolver';
