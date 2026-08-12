import { z } from 'zod';

export const AgentHandoffStatusSchema = z.enum([
  'draft',
  'ready',
  'opened',
  'in_progress',
  'completed',
  'failed',
  'cancelled',
]);

export const AgentHandoffEventSchema = z.object({
  eventId: z.string().min(1),
  type: z.enum([
    'created',
    'previewed',
    'opened',
    'status_changed',
    'cancelled',
    'completed',
    'failed',
  ]),
  createdAt: z.string(),
  actor: z.enum(['local-user', 'agent', 'system']),
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

export const AgentIssueBriefSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  userNote: z.string().optional(),
  issue: z.object({
    status: z.string(),
    severity: z.string(),
    tags: z.array(z.string()),
  }),
  page: z.object({
    title: z.string().optional(),
    route: z.string().optional(),
    url: z.string().optional(),
  }),
  selectedTarget: z.object({
    mode: z.enum(['single', 'box']),
    label: z.string().optional(),
    role: z.string().optional(),
    textPreview: z.string().optional(),
    targetCount: z.number().int().nonnegative(),
    confidence: z.number().min(0).max(1),
    resolutionStatus: z.enum(['resolved', 'ambiguous', 'stale', 'missing']),
  }),
  sourceHints: z
    .object({
      count: z.number().int().nonnegative(),
      status: z.enum(['ranked', 'ambiguous', 'low_confidence', 'missing']).optional(),
      topHints: z.array(
        z.object({
          displayName: z.string(),
          confidence: z.number().optional(),
        }),
      ),
    })
    .optional(),
  task: z.object({
    objective: z.string().min(1),
    expectedOutput: z.string().min(1),
    nonGoals: z.array(z.string()),
  }),
});

export const AgentHandoffContextSchema = z.object({
  contextId: z.string().min(1),
  issueRef: z.object({ issueId: z.string().min(1) }),
  packetRefs: z.array(
    z.object({
      packetId: z.string(),
      type: z.enum(['capture', 'recapture', 'export']),
      label: z.string(),
    }),
  ),
  selectionRef: z.object({
    selectionId: z.string().min(1),
    snapshotIncluded: z.boolean(),
  }),
  evidenceSummary: z.object({
    hasSelection: z.boolean(),
    hasSourceHints: z.boolean(),
    hasContextPacket: z.boolean(),
    hasConsoleEvidence: z.boolean().optional(),
    hasNetworkEvidence: z.boolean().optional(),
    hasScreenshot: z.boolean().optional(),
  }),
});

export const AgentHandoffConstraintsSchema = z.object({
  localFirst: z.literal(true),
  noRawPacketPaths: z.literal(true),
  noRawJson: z.literal(true),
  noSecrets: z.literal(true),
  noAutonomousBrowserActions: z.boolean(),
  requiresHumanReview: z.boolean(),
  phaseBoundary: z.literal('handoff-only'),
});

export const AgentHandoffSchema = z.object({
  schemaVersion: z.literal(1),
  handoffId: z.string().min(1),
  issueId: z.string().min(1),
  sessionId: z.string().min(1),
  pageId: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  openedAt: z.string().optional(),
  completedAt: z.string().optional(),
  cancelledAt: z.string().optional(),
  status: AgentHandoffStatusSchema,
  brief: AgentIssueBriefSchema,
  context: AgentHandoffContextSchema,
  constraints: AgentHandoffConstraintsSchema,
  lifecycle: z.array(AgentHandoffEventSchema).default([]),
  redaction: z.object({
    applied: z.boolean(),
    rules: z.array(z.string()),
    strippedFields: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
});
