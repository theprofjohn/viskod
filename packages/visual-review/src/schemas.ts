import { z } from 'zod';

export const VisualReviewStatusSchema = z.enum([
  'draft',
  'capturing_after',
  'ready',
  'accepted',
  'rejected',
  'needs_follow_up',
  'failed',
  'cancelled',
]);

export const VisualComparisonStatusSchema = z.enum([
  'changed',
  'unchanged',
  'missing_after',
  'ambiguous_after',
  'stale_before',
  'capture_failed',
  'comparison_failed',
]);

export const VisualReviewEventSchema = z.object({
  eventId: z.string().min(1),
  type: z.enum([
    'created',
    'before_loaded',
    'after_capture_started',
    'after_capture_completed',
    'comparison_completed',
    'decision_recorded',
    'recaptured',
    'failed',
    'cancelled',
  ]),
  createdAt: z.string(),
  actor: z.enum(['local-user', 'system', 'agent']),
  summary: z.string().min(1),
  changes: z
    .record(
      z.object({
        before: z.unknown().optional(),
        after: z.unknown().optional(),
      }),
    )
    .optional(),
});

export const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export const RectDeltaSchema = z.object({
  xDelta: z.number().optional(),
  yDelta: z.number().optional(),
  widthDelta: z.number().optional(),
  heightDelta: z.number().optional(),
});

export const ReviewSnapshotRefSchema = z.object({
  snapshotId: z.string().min(1),
  kind: z.enum(['before', 'after']),
  capturedAt: z.string(),
  source: z.object({
    issueId: z.string().optional(),
    handoffId: z.string().optional(),
    contextPacketId: z.string().optional(),
    recapturePacketId: z.string().optional(),
    selectionId: z.string().optional(),
    selectionSnapshot: z.record(z.unknown()).optional(),
  }),
  page: z.object({
    url: z.string().optional(),
    title: z.string().optional(),
    route: z.string().optional(),
    viewport: z.object({
      width: z.number().positive(),
      height: z.number().positive(),
      deviceScaleFactor: z.number().optional(),
    }),
  }),
  targetSummary: z.object({
    mode: z.enum(['single', 'box']),
    label: z.string().optional(),
    role: z.string().optional(),
    textPreview: z.string().optional(),
    targetCount: z.number().int().nonnegative(),
    confidence: z.number().min(0).max(1),
    resolutionStatus: z.enum(['resolved', 'ambiguous', 'stale', 'missing']),
  }),
  visualEvidence: z
    .object({
      screenshotId: z.string().optional(),
      thumbnailId: z.string().optional(),
      cropRect: RectSchema.optional(),
      overlayExcluded: z.boolean(),
    })
    .optional(),
  evidenceSummary: z.object({
    hasSelection: z.boolean(),
    hasContextPacket: z.boolean(),
    hasScreenshot: z.boolean(),
    hasSourceHints: z.boolean(),
    hasConsoleEvidence: z.boolean().optional(),
    hasNetworkEvidence: z.boolean().optional(),
  }),
});

export const VisualComparisonSchema = z.object({
  status: VisualComparisonStatusSchema,
  confidence: z.number().min(0).max(1),
  summary: z.string(),
  target: z.object({
    beforeStatus: z.string(),
    afterStatus: z.string(),
    sameTargetLikely: z.boolean(),
    warnings: z.array(z.string()),
  }),
  visual: z
    .object({
      changedPixelRatio: z.number().min(0).max(1).optional(),
      boundingBoxDelta: RectDeltaSchema.optional(),
      screenshotDiffId: z.string().optional(),
      diffThumbnailId: z.string().optional(),
    })
    .optional(),
  evidence: z
    .object({
      sourceHintDelta: z.string().optional(),
      consoleDelta: z.string().optional(),
      networkDelta: z.string().optional(),
    })
    .optional(),
  warnings: z.array(z.string()),
});

export const VisualReviewDecisionSchema = z.object({
  decision: z.enum(['accepted', 'rejected', 'needs_follow_up']),
  decidedAt: z.string(),
  note: z.string().optional(),
  actor: z.enum(['local-user', 'system']),
});

export const VisualReviewSchema = z.object({
  schemaVersion: z.literal(1),
  reviewId: z.string().min(1),
  issueId: z.string().min(1),
  handoffId: z.string().optional(),
  sessionId: z.string().min(1),
  pageId: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
  status: VisualReviewStatusSchema,
  before: ReviewSnapshotRefSchema,
  after: ReviewSnapshotRefSchema.optional(),
  comparison: VisualComparisonSchema.optional(),
  decision: VisualReviewDecisionSchema.optional(),
  lifecycle: z.array(VisualReviewEventSchema).default([]),
  redaction: z.object({
    applied: z.boolean(),
    rules: z.array(z.string()),
    strippedFields: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
});
