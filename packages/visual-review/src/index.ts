export { ReviewServiceImpl } from './service';
export type { ReviewService } from './service';
export { ReviewPersistence } from './persistence';
export type { ReviewIndex } from './persistence';
export { UserFacingReview } from './ux';
export type { ReviewPreview, ReviewConfirmation } from './ux';
export { computeComparison } from './comparison';
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
