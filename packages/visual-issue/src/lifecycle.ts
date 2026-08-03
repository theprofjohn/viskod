import type { VisualIssueEvent, VisualIssueStatus } from './types';

const VALID_TRANSITIONS: Record<VisualIssueStatus, VisualIssueStatus[]> = {
  draft: ['open'],
  open: ['in_progress', 'blocked', 'resolved', 'archived'],
  in_progress: ['blocked', 'resolved', 'open', 'archived'],
  blocked: ['open', 'in_progress', 'resolved', 'archived'],
  resolved: ['open', 'archived'],
  archived: ['open'],
};

export function isValidTransition(from: VisualIssueStatus, to: VisualIssueStatus): boolean {
  if (from === to) return true;
  const allowed = VALID_TRANSITIONS[from];
  return allowed?.includes(to) ?? false;
}

export function createLifecycleEvent(
  type: VisualIssueEvent['type'],
  summary: string,
  actor: VisualIssueEvent['actor'] = 'local-user',
  changes?: VisualIssueEvent['changes'],
): VisualIssueEvent {
  return {
    eventId: crypto.randomUUID(),
    type,
    createdAt: new Date().toISOString(),
    actor,
    summary,
    changes,
  };
}

export function makeStatusChangeEvent(
  fromStatus: VisualIssueStatus,
  toStatus: VisualIssueStatus,
): VisualIssueEvent {
  return createLifecycleEvent(
    'status_changed',
    `Status changed from ${fromStatus} to ${toStatus}`,
    'local-user',
    { status: { before: fromStatus, after: toStatus } },
  );
}

export function makeSeverityChangeEvent(
  fromSeverity: string,
  toSeverity: string,
): VisualIssueEvent {
  return createLifecycleEvent(
    'severity_changed',
    `Severity changed from ${fromSeverity} to ${toSeverity}`,
    'local-user',
    { severity: { before: fromSeverity, after: toSeverity } },
  );
}

export function makeArchiveEvent(): VisualIssueEvent {
  return createLifecycleEvent('archived', 'Issue archived', 'local-user');
}

export function makeReopenEvent(): VisualIssueEvent {
  return createLifecycleEvent('reopened', 'Issue reopened from archive', 'local-user');
}

export function makeDeleteEvent(): VisualIssueEvent {
  return createLifecycleEvent('deleted', 'Issue deleted', 'local-user');
}

export function makeCreatedEvent(): VisualIssueEvent {
  return createLifecycleEvent('created', 'Issue created from visual selection', 'system');
}
