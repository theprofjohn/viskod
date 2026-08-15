import type {
  ReviewArtifactComparison,
  ReviewArtifactsPreview,
  TargetCropCapture,
} from './artifact-types';
export type { ReviewArtifactComparison, ReviewArtifactsPreview, TargetCropCapture };

export type VisualReviewStatus =
  | 'draft'
  | 'capturing_after'
  | 'ready'
  | 'accepted'
  | 'rejected'
  | 'needs_follow_up'
  | 'failed'
  | 'cancelled';

export type VisualComparisonStatus =
  | 'changed'
  | 'unchanged'
  | 'incomparable'
  | 'visual_unavailable'
  | 'missing_after'
  | 'ambiguous_after'
  | 'stale_before'
  | 'capture_failed'
  | 'comparison_failed';

export interface VisualReviewEvent {
  eventId: string;
  type:
    | 'created'
    | 'before_loaded'
    | 'after_capture_started'
    | 'after_capture_completed'
    | 'comparison_completed'
    | 'decision_recorded'
    | 'recaptured'
    | 'failed'
    | 'cancelled';
  createdAt: string;
  actor: 'local-user' | 'system' | 'agent';
  summary: string;
  changes?: Record<string, { before?: unknown; after?: unknown }>;
}

export interface ReviewSnapshotRef {
  snapshotId: string;
  kind: 'before' | 'after';
  capturedAt: string;
  source: {
    issueId?: string;
    handoffId?: string;
    contextPacketId?: string;
    recapturePacketId?: string;
    selectionId?: string;
    selectionSnapshot?: Record<string, unknown>;
  };
  page: {
    url?: string;
    title?: string;
    route?: string;
    viewport: {
      width: number;
      height: number;
      deviceScaleFactor?: number;
    };
  };
  targetSummary: {
    mode: 'single' | 'box';
    label?: string;
    role?: string;
    textPreview?: string;
    targetCount: number;
    confidence: number;
    resolutionStatus: 'resolved' | 'ambiguous' | 'stale' | 'missing';
  };
  /**
   * Phase 28B stable identity of the target (Phase 31): presentation labels
   * are NOT identity. When present, same-target determination uses these
   * fields; display labels are change evidence only.
   */
  identity?: {
    targetId?: string;
    stableAttributes?: Record<string, string>;
  };
  visualEvidence?: {
    screenshotId?: string;
    thumbnailId?: string;
    cropRect?: Rect;
    overlayExcluded: boolean;
  };
  evidenceSummary: {
    hasSelection: boolean;
    hasContextPacket: boolean;
    hasScreenshot: boolean;
    hasSourceHints: boolean;
    hasConsoleEvidence?: boolean;
    hasNetworkEvidence?: boolean;
  };
}

export interface VisualComparison {
  status: VisualComparisonStatus;
  confidence: number;
  summary: string;
  target: {
    beforeStatus: string;
    afterStatus: string;
    sameTargetLikely: boolean;
    warnings: string[];
  };
  visual?: {
    changedPixelRatio?: number;
    boundingBoxDelta?: RectDelta;
    screenshotDiffId?: string;
    diffThumbnailId?: string;
    /** Phase 31: real pixel-comparison evidence (persisted artifacts). */
    artifactComparison?: ReviewArtifactComparison;
    /** Phase 31: opaque diff artifact id for the Studio UI. */
    diffArtifactId?: string;
    /** Phase 31: viewport/DPR compatibility between the two captures. */
    viewportCompatible?: boolean;
  };
  evidence?: {
    sourceHintDelta?: string;
    consoleDelta?: string;
    networkDelta?: string;
  };
  warnings: string[];
}

export interface VisualReviewDecision {
  decision: 'accepted' | 'rejected' | 'needs_follow_up';
  decidedAt: string;
  note?: string;
  actor: 'local-user' | 'system';
}

export interface VisualReview {
  schemaVersion: 1;
  reviewId: string;
  issueId: string;
  handoffId?: string;
  sessionId: string;
  pageId: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  status: VisualReviewStatus;
  before: ReviewSnapshotRef;
  after?: ReviewSnapshotRef;
  comparison?: VisualComparison;
  decision?: VisualReviewDecision;
  /**
   * Phase 31: sanitized local-sensitive review artifact state (opaque ids
   * only, no paths). Present when the artifact store is composed.
   */
  artifacts?: ReviewArtifactsPreview;
  lifecycle: VisualReviewEvent[];
  redaction: {
    applied: boolean;
    rules: string[];
    strippedFields: string[];
    warnings: string[];
  };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RectDelta {
  xDelta?: number;
  yDelta?: number;
  widthDelta?: number;
  heightDelta?: number;
}

export type ReviewErrorCode =
  | 'ISSUE_NOT_FOUND'
  | 'ISSUE_DELETED'
  | 'ISSUE_STALE'
  | 'REVIEW_NOT_FOUND'
  | 'INVALID_REVIEW_TRANSITION'
  | 'ALREADY_DECIDED'
  | 'PERSISTENCE_WRITE_FAILED'
  | 'PERSISTENCE_READ_FAILED'
  | 'SCHEMA_VALIDATION_FAILED'
  | 'CORRUPT_REVIEW_FILE'
  | 'BEFORE_SNAPSHOT_UNAVAILABLE'
  | 'AFTER_CAPTURE_FAILED'
  | 'COMPARISON_FAILED'
  | 'REDACTION_FAILED'
  | 'RECAPTURE_ADAPTER_MISSING'
  | 'RECAPTURE_FAILED';

export interface RecaptureOptions {
  reload?: boolean;
  cacheBust?: boolean;
  url?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
  /** CSS selector the adapter should use to locate the target in the page. */
  selector?: string;
}

export interface RecaptureResult {
  packetId: string;
  selector: string;
  tagName: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  text?: string;
  url: string;
  viewport: { width: number; height: number; deviceScaleFactor?: number };
  screenshotPath?: string;
  /**
   * Phase 31: local-sensitive target crop captured through the Phase 28B
   * exact-target pipeline. Persisted only when the visual-review artifact
   * policy is enabled; NEVER part of the agent-safe packet.
   */
  elementScreenshot?: TargetCropCapture;
  /** Phase 28B stable identity of the resolved element at capture time. */
  identity?: { targetId?: string; stableAttributes?: Record<string, string> };
  sourceHints?: Array<{ filePath: string; confidence: number; evidence: string }>;
  runtimeEvidence?: Record<string, unknown>;
  consoleEvidence?: Array<{ level: string; text: string; url?: string; line?: number }>;
  networkEvidence?: Array<{ url: string; method: string; status?: number; type?: string }>;
}

export type RecaptureAdapter = (options: RecaptureOptions) => Promise<RecaptureResult | null>;

export interface VisualReviewRecaptureInput {
  reviewId: string;
  reload?: boolean;
  cacheBust?: boolean;
  url?: string;
}

export interface ResolvedRecaptureTarget {
  selector: string;
  /** Observed target geometry (persisted overlay crop/rect); absent = no
   *  trusted disambiguation available for a multi-match selector. */
  boundingBox?: { x: number; y: number; width: number; height: number };
  source: 'review-recapture';
  resolvedFrom: 'stable-attribute' | 'ancestor-path' | 'geometry-fallback';
  confidence: number;
}

export interface VisualReviewCreateInput {
  issueId: string;
  handoffId?: string;
  cacheBust?: boolean;
  reload?: boolean;
}

export interface VisualReviewCreateOutput {
  reviewId: string;
  issueId: string;
  handoffId?: string;
  status: VisualReviewStatus;
  comparisonStatus?: VisualComparisonStatus;
  warningCount: number;
}

export interface VisualReviewGetOutput {
  reviewId: string;
  issueId: string;
  handoffId?: string;
  status: VisualReviewStatus;
  before: ReviewSnapshotRef;
  after?: ReviewSnapshotRef;
  comparison?: VisualComparison;
  decision?: VisualReviewDecision;
  artifacts?: ReviewArtifactsPreview;
}

export interface VisualReviewDecisionInput {
  decision: 'accepted' | 'rejected' | 'needs_follow_up';
  note?: string;
}

export interface VisualReviewListItem {
  reviewId: string;
  issueId: string;
  handoffId?: string;
  status: VisualReviewStatus;
  comparisonStatus?: VisualComparisonStatus;
  createdAt: string;
  updatedAt: string;
}
