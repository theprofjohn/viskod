import type { AgentHandoffEvent, AgentHandoffStatus } from './types';

const VALID_TRANSITIONS: Record<AgentHandoffStatus, AgentHandoffStatus[]> = {
  draft: ['ready', 'cancelled'],
  ready: ['opened', 'cancelled'],
  opened: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

export function isValidHandoffTransition(
  from: AgentHandoffStatus,
  to: AgentHandoffStatus,
): boolean {
  if (from === to) return true;
  const allowed = VALID_TRANSITIONS[from];
  return allowed?.includes(to) ?? false;
}

export function createHandoffEvent(
  type: AgentHandoffEvent['type'],
  summary: string,
  actor: AgentHandoffEvent['actor'] = 'system',
  changes?: AgentHandoffEvent['changes'],
): AgentHandoffEvent {
  return {
    eventId: crypto.randomUUID(),
    type,
    createdAt: new Date().toISOString(),
    actor,
    summary,
    changes,
  };
}

export function makeHandoffCreatedEvent(): AgentHandoffEvent {
  return createHandoffEvent('created', 'Agent handoff created from visual issue', 'system');
}

export function makeHandoffPreviewedEvent(): AgentHandoffEvent {
  return createHandoffEvent('previewed', 'Handoff preview generated', 'local-user');
}

export function makeHandoffOpenedEvent(): AgentHandoffEvent {
  return createHandoffEvent('opened', 'Handoff fetched by agent', 'agent');
}

export function makeHandoffStatusChangeEvent(
  fromStatus: AgentHandoffStatus,
  toStatus: AgentHandoffStatus,
): AgentHandoffEvent {
  return createHandoffEvent(
    'status_changed',
    `Status changed from ${fromStatus} to ${toStatus}`,
    'local-user',
    { status: { before: fromStatus, after: toStatus } },
  );
}

export function makeHandoffCompletedEvent(): AgentHandoffEvent {
  return createHandoffEvent('completed', 'Handoff completed', 'agent');
}

export function makeHandoffFailedEvent(reason?: string): AgentHandoffEvent {
  return createHandoffEvent('failed', reason ?? 'Handoff failed', 'agent');
}

export function makeHandoffCancelledEvent(): AgentHandoffEvent {
  return createHandoffEvent('cancelled', 'Handoff cancelled', 'local-user');
}
