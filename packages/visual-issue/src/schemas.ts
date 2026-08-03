import { z } from 'zod';

export const VisualIssueStatusSchema = z.enum([
  'draft',
  'open',
  'in_progress',
  'blocked',
  'resolved',
  'archived',
]);

export const VisualIssueSeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);

export const VisualIssueEventSchema = z.object({
  eventId: z.string().min(1),
  type: z.enum([
    'created',
    'updated',
    'status_changed',
    'severity_changed',
    'selection_refreshed',
    'archived',
    'reopened',
    'deleted',
  ]),
  createdAt: z.string(),
  actor: z.enum(['local-user', 'system']),
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

export const RedactedTargetSummarySchema = z.object({
  mode: z.enum(['single', 'box']),
  label: z.string().optional(),
  role: z.string().optional(),
  textPreview: z.string().optional(),
  targetCount: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  resolutionStatus: z.enum(['resolved', 'ambiguous', 'stale', 'missing']),
});

export const IssueEvidenceSummarySchema = z.object({
  contextPacketId: z.string().optional(),
  sourceHintCount: z.number().int().nonnegative().optional(),
  hasConsoleEvidence: z.boolean().optional(),
  hasNetworkEvidence: z.boolean().optional(),
  redactionApplied: z.boolean(),
});

export const IssueRedactionInfoSchema = z.object({
  applied: z.boolean(),
  rules: z.array(z.string()),
  strippedFields: z.array(z.string()),
  warnings: z.array(z.string()),
});

export const VisualIssueSchema = z.object({
  schemaVersion: z.literal(1),
  issueId: z.string().min(1),
  projectId: z.string().optional(),
  sessionId: z.string().min(1),
  pageId: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().optional(),
  deletedAt: z.string().optional(),
  status: VisualIssueStatusSchema,
  severity: VisualIssueSeveritySchema,
  title: z.string().min(1).max(80),
  description: z.string().optional(),
  source: z.object({
    createdFrom: z.literal('visual-selection'),
    selectionId: z.string().min(1),
    selectionSnapshot: z.record(z.unknown()),
  }),
  page: z.object({
    url: z.string(),
    title: z.string().optional(),
    route: z.string().optional(),
    viewport: z.object({
      width: z.number().positive(),
      height: z.number().positive(),
      deviceScaleFactor: z.number().optional(),
    }),
  }),
  targetSummary: RedactedTargetSummarySchema,
  evidence: IssueEvidenceSummarySchema.optional(),
  tags: z.array(z.string()).default([]),
  lifecycle: z.array(VisualIssueEventSchema).default([]),
  redaction: IssueRedactionInfoSchema,
});
