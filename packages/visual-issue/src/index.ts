export { IssueServiceImpl } from './service';
export type { IssueService, IssueUpdate, IssueServiceHealth } from './service';
export { IssuePersistence } from './persistence';
export type { IssueIndex } from './persistence';
export type {
  VisualIssue,
  VisualIssueStatus,
  VisualIssueSeverity,
  VisualIssueEvent,
  RedactedTargetSummary,
  IssueEvidenceSummary,
  IssueRedactionInfo,
  IssueErrorCode,
} from './types';
export { VisualIssueSchema, VisualIssueStatusSchema, VisualIssueSeveritySchema } from './schemas';
export {
  redactIssue,
  redactIssueText,
  generateDefaultTitle,
  redactTargetSummary,
} from './redaction';
export {
  isValidTransition,
  createLifecycleEvent,
  makeStatusChangeEvent,
  makeSeverityChangeEvent,
  makeArchiveEvent,
  makeReopenEvent,
  makeDeleteEvent,
  makeCreatedEvent,
} from './lifecycle';

export { createIssueIntegration } from './integration';
export type { IssueIntegration } from './integration';
