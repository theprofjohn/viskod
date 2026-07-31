export type VisualIssueStatus =
  | 'draft'
  | 'open'
  | 'in_progress'
  | 'blocked'
  | 'resolved'
  | 'archived';

export type VisualIssueSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface VisualIssueEvent {
  eventId: string;
  type:
    | 'created'
    | 'updated'
    | 'status_changed'
    | 'severity_changed'
    | 'selection_refreshed'
    | 'archived'
    | 'reopened'
    | 'deleted';
  createdAt: string;
  actor: 'local-user' | 'system';
  summary: string;
  changes?: Record<string, { before?: unknown; after?: unknown }>;
}

export interface RedactedTargetSummary {
  mode: 'single' | 'box';
  label?: string;
  role?: string;
  textPreview?: string;
  targetCount: number;
  confidence: number;
  resolutionStatus: 'resolved' | 'ambiguous' | 'stale' | 'missing';
}

export interface IssueEvidenceSummary {
  contextPacketId?: string;
  sourceHintCount?: number;
  hasConsoleEvidence?: boolean;
  hasNetworkEvidence?: boolean;
  redactionApplied: boolean;
}

export interface IssueRedactionInfo {
  applied: boolean;
  rules: string[];
  strippedFields: string[];
  warnings: string[];
}

export interface VisualIssue {
  schemaVersion: 1;
  issueId: string;
  projectId?: string;
  sessionId: string;
  pageId: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  deletedAt?: string;
  status: VisualIssueStatus;
  severity: VisualIssueSeverity;
  title: string;
  description?: string;
  source: {
    createdFrom: 'visual-selection';
    selectionId: string;
    selectionSnapshot: Record<string, unknown>;
  };
  page: {
    url: string;
    title?: string;
    route?: string;
    viewport: { width: number; height: number; deviceScaleFactor?: number };
  };
  targetSummary: RedactedTargetSummary;
  evidence?: IssueEvidenceSummary;
  tags: string[];
  lifecycle: VisualIssueEvent[];
  redaction: IssueRedactionInfo;
}

export type IssueErrorCode =
  | 'NO_ACTIVE_SELECTION'
  | 'STALE_SELECTION'
  | 'MISSING_SELECTION'
  | 'AMBIGUOUS_SELECTION'
  | 'INVALID_ISSUE_ID'
  | 'ISSUE_NOT_FOUND'
  | 'CORRUPT_ISSUE_FILE'
  | 'SCHEMA_VALIDATION_FAILED'
  | 'PERSISTENCE_WRITE_FAILED'
  | 'PERSISTENCE_READ_FAILED'
  | 'ALREADY_ARCHIVED'
  | 'REOPEN_NON_ARCHIVED'
  | 'ALREADY_DELETED'
  | 'INVALID_LIFECYCLE_TRANSITION'
  | 'REDACTION_FAILED'
  | 'SESSION_MISMATCH';
