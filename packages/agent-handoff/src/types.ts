export type AgentHandoffStatus =
  | 'draft'
  | 'ready'
  | 'opened'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AgentHandoffEvent {
  eventId: string;
  type:
    | 'created'
    | 'previewed'
    | 'opened'
    | 'status_changed'
    | 'cancelled'
    | 'completed'
    | 'failed';
  createdAt: string;
  actor: 'local-user' | 'agent' | 'system';
  summary: string;
  changes?: Record<string, { before?: unknown; after?: unknown }>;
}

export interface AgentIssueBrief {
  title: string;
  summary: string;
  userNote?: string;
  issue: {
    status: string;
    severity: string;
    tags: string[];
  };
  page: {
    title?: string;
    route?: string;
    url?: string;
  };
  selectedTarget: {
    mode: 'single' | 'box';
    label?: string;
    role?: string;
    textPreview?: string;
    targetCount: number;
    confidence: number;
    resolutionStatus: 'resolved' | 'ambiguous' | 'stale' | 'missing';
  };
  sourceHints?: {
    count: number;
    status?: 'ranked' | 'ambiguous' | 'low_confidence' | 'missing';
    /** Phase 30: semantic resolution state (resolved/ambiguous/unavailable). */
    resolution?: 'resolved' | 'ambiguous' | 'unavailable';
    topHints: Array<{
      displayName: string;
      confidence?: number;
      kind?: string;
      score?: number;
      reasons?: string[];
      warnings?: string[];
      /** Phase 30: evidence-derived qualification. */
      qualification?: 'exact' | 'probable' | 'possible' | 'weak';
    }>;
  };
  task: {
    objective: string;
    expectedOutput: string;
    nonGoals: string[];
  };
}

export interface AgentHandoffContext {
  contextId: string;
  issueRef: {
    issueId: string;
  };
  packetRefs: Array<{
    packetId: string;
    /** Durable persisted capture id; resolves through CapturePipeline after restart. */
    captureId?: string;
    type: 'capture' | 'recapture' | 'export';
    label: string;
  }>;
  selectionRef: {
    selectionId: string;
    snapshotIncluded: boolean;
  };
  evidenceSummary: {
    hasSelection: boolean;
    hasSourceHints: boolean;
    hasContextPacket: boolean;
    hasConsoleEvidence?: boolean;
    hasNetworkEvidence?: boolean;
    hasScreenshot?: boolean;
  };
}

export interface AgentHandoffConstraints {
  localFirst: true;
  noRawPacketPaths: true;
  noRawJson: true;
  noSecrets: true;
  noAutonomousBrowserActions: boolean;
  requiresHumanReview: boolean;
  phaseBoundary: 'handoff-only';
}

export interface AgentHandoff {
  schemaVersion: 1;
  handoffId: string;
  issueId: string;
  sessionId: string;
  pageId: string;
  createdAt: string;
  updatedAt: string;
  openedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  status: AgentHandoffStatus;
  brief: AgentIssueBrief;
  context: AgentHandoffContext;
  constraints: AgentHandoffConstraints;
  lifecycle: AgentHandoffEvent[];
  redaction: {
    applied: boolean;
    rules: string[];
    strippedFields: string[];
    warnings: string[];
  };
}

export type AgentHandoffErrorCode =
  | 'ISSUE_NOT_FOUND'
  | 'ISSUE_DELETED'
  | 'ISSUE_ARCHIVED_WARNING'
  | 'ISSUE_STALE'
  | 'ISSUE_AMBIGUOUS_WARNING'
  | 'HANDOFF_NOT_FOUND'
  | 'HANDOFF_ALREADY_CANCELLED'
  | 'INVALID_HANDOFF_TRANSITION'
  | 'PERSISTENCE_WRITE_FAILED'
  | 'PERSISTENCE_READ_FAILED'
  | 'SCHEMA_VALIDATION_FAILED'
  | 'CORRUPT_HANDOFF_FILE'
  | 'CONTEXT_PACKET_MISSING'
  | 'SOURCE_HINTS_UNAVAILABLE'
  | 'REDACTION_FAILED'
  | 'SESSION_MISMATCH'
  | 'INVALID_HANDOFF_ID';

export interface AgentHandoffCreateInput {
  issueId: string;
  includeContextPacket?: boolean;
  includeSourceHints?: boolean;
  userInstruction?: string;
  sourceHints?: Array<{
    displayName: string;
    confidence?: number;
    kind?: string;
    score?: number;
    reasons?: string[];
    warnings?: string[];
    qualification?: 'exact' | 'probable' | 'possible' | 'weak';
  }>;
  sourceHintStatus?: 'ranked' | 'ambiguous' | 'low_confidence' | 'missing';
  /** Phase 30: semantic resolution state captured at issue time. */
  sourceHintResolution?: 'resolved' | 'ambiguous' | 'unavailable';
}

export interface AgentHandoffCreateOutput {
  handoffId: string;
  issueId: string;
  status: 'ready';
  title: string;
  summary: string;
  warningCount: number;
}

export interface AgentHandoffGetOutput {
  handoffId: string;
  issueId: string;
  status: string;
  brief: AgentIssueBrief;
  context: AgentHandoffContext;
  constraints: AgentHandoffConstraints;
}

export interface AgentHandoffListItem {
  handoffId: string;
  issueId: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentHandoffUpdateInput {
  status: AgentHandoffStatus;
}
