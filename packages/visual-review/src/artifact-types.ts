import type { BoundingBox, Viewport } from '@viskod/shared';

/**
 * Local-sensitive visual review artifact contract (Phase 31).
 *
 * Phase 29 established that the agent-safe persisted context packet NEVER
 * carries raw screenshot pixels. Phase 31 introduces a SEPARATE artifact
 * class — LOCAL SENSITIVE VISUAL REVIEW ARTIFACTS — that exists only so the
 * developer can visually review a change in Studio:
 *
 * - they are NEVER part of `get_handoff_context`, `AgentContextProjection`,
 *   or the normal safe `ContextPacket`;
 * - they are NOT claimed to be redacted;
 * - they are NOT sent to coding agents;
 * - they are marked `sensitive: true` and `localOnly: true` and served only
 *   through protected opaque Studio endpoints.
 */

export type VisualArtifactPolicy = 'disabled' | 'local-sensitive-target-crop';

export type ReviewArtifactRole = 'before' | 'after' | 'diff';

export type ReviewArtifactStatus = 'collected' | 'not_collected' | 'failed' | 'unavailable';

/** Opaque artifact id pattern — never user-controlled filesystem paths. */
export const ARTIFACT_ID_PATTERN = /^art_[a-f0-9]{32}$/;

/** Baseline store subdirectory under the reviews root. */
export const ARTIFACT_BASELINES_DIR = 'baselines';

export const REVIEW_ARTIFACTS_MANIFEST_FILE = 'manifest.json';

/** Target crop captured for review (before or after). */
export interface TargetCropCapture {
  /** Raw PNG bytes of the target crop. */
  buffer: Buffer;
  format: 'png';
  width: number;
  height: number;
  /** The exact resolved target box (trusted Phase 28B geometry), CSS px. */
  targetRect: BoundingBox;
  /** Actual cropped region (target + padding, clamped to viewport), CSS px. */
  cropRect: BoundingBox;
  /** Context padding applied around the target, CSS px. */
  padding: number;
  viewport: { width: number; height: number; deviceScaleFactor: number };
  /** Page URL in the existing redacted/safe form. */
  url: string;
  capturedAt: string;
  resolutionStatus: 'resolved' | 'missing' | 'malformed' | 'ambiguous' | 'detached';
  matchCount: number;
  /** Phase 28B stable identity of the resolved element. */
  identity?: {
    targetId?: string;
    stableAttributes?: Record<string, string>;
  };
  tagName?: string;
  text?: string;
}

export interface ReviewArtifactEntry {
  artifactId: string;
  role: ReviewArtifactRole;
  status: ReviewArtifactStatus;
  capturedAt?: string;
  dimensions?: { width: number; height: number };
  crop?: { rect: BoundingBox; padding: number };
  target?: {
    boundingBox: BoundingBox;
    selector: string;
    targetId?: string;
    stableAttributes?: Record<string, string>;
  };
  viewport?: Viewport;
  pageUrl?: string;
  failureReason?: string;
}

/** Durable comparison result tied to the diff artifact (persisted). */
export interface ReviewArtifactComparison {
  status: 'changed' | 'unchanged' | 'incomparable' | 'unavailable';
  reason?: string;
  changedPixelRatio?: number;
  changedPixels?: number;
  totalPixels?: number;
  comparisonDimensions?: { width: number; height: number };
  beforeDimensions?: { width: number; height: number };
  afterDimensions?: { width: number; height: number };
  geometry?: {
    xDelta?: number;
    yDelta?: number;
    widthDelta?: number;
    heightDelta?: number;
  };
  geometryChanged?: boolean;
  viewportCompatible?: boolean;
  pixelDiffConfigVersion?: number;
}

/**
 * Persisted manifest for one review's local visual artifacts.
 *
 * The manifest is the durable pairing contract (§8/§10): every artifact
 * references the review/issue lineage, and the diff references the exact
 * before/after artifacts it was computed from. No process-global "latest
 * screenshot" — pairing survives Studio restart.
 */
export interface ReviewArtifactsManifest {
  schemaVersion: 1;
  reviewId: string;
  issueId: string;
  sensitive: true;
  localOnly: true;
  policy: VisualArtifactPolicy;
  artifacts: ReviewArtifactEntry[];
  pairing: {
    beforeArtifactId?: string;
    afterArtifactId?: string;
    diffArtifactId?: string;
  };
  comparison?: ReviewArtifactComparison;
  updatedAt: string;
}

/** Sanitized projection of review artifacts for user-facing state (Studio UI). */
export interface ReviewArtifactsPreview {
  policy: VisualArtifactPolicy;
  before?: {
    artifactId: string;
    status: ReviewArtifactStatus;
    capturedAt?: string;
    dimensions?: { width: number; height: number };
  };
  after?: {
    artifactId: string;
    status: ReviewArtifactStatus;
    capturedAt?: string;
    dimensions?: { width: number; height: number };
  };
  diff?: {
    artifactId: string;
    status: ReviewArtifactStatus;
    capturedAt?: string;
  };
  comparison?: ReviewArtifactComparison;
  /** True when the user-facing comparison cannot claim a real visual review. */
  visualUnavailableReason?: string;
}
