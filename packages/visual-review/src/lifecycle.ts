import type { VisualReviewEvent, VisualReviewStatus } from './types';

const VALID_TRANSITIONS: Record<VisualReviewStatus, VisualReviewStatus[]> = {
  draft: ['capturing_after', 'cancelled', 'failed'],
  capturing_after: ['ready', 'failed', 'cancelled'],
  ready: ['accepted', 'rejected', 'needs_follow_up', 'cancelled'],
  accepted: ['cancelled'],
  rejected: ['cancelled'],
  needs_follow_up: ['cancelled'],
  failed: ['cancelled'],
  cancelled: [],
};

export function isValidReviewTransition(from: VisualReviewStatus, to: VisualReviewStatus): boolean {
  if (from === to) return true;
  const allowed = VALID_TRANSITIONS[from];
  return allowed?.includes(to) ?? false;
}

export function createReviewEvent(
  type: VisualReviewEvent['type'],
  summary: string,
  actor: VisualReviewEvent['actor'] = 'local-user',
  changes?: VisualReviewEvent['changes'],
): VisualReviewEvent {
  return {
    eventId: crypto.randomUUID(),
    type,
    createdAt: new Date().toISOString(),
    actor,
    summary,
    changes,
  };
}

export function makeReviewCreatedEvent(): VisualReviewEvent {
  return createReviewEvent('created', 'Review created from issue', 'system');
}

export function makeBeforeLoadedEvent(warnings: string[]): VisualReviewEvent {
  const summary =
    warnings.length > 0
      ? `Before snapshot loaded with warnings: ${warnings.join(', ')}`
      : 'Before snapshot loaded from issue';
  return createReviewEvent('before_loaded', summary, 'system');
}

export function makeAfterCaptureStartedEvent(): VisualReviewEvent {
  return createReviewEvent('after_capture_started', 'After capture started', 'system');
}

export function makeAfterCaptureCompletedEvent(warnings: string[]): VisualReviewEvent {
  const summary =
    warnings.length > 0
      ? `After capture completed with warnings: ${warnings.join(', ')}`
      : 'After capture completed successfully';
  return createReviewEvent('after_capture_completed', summary, 'system');
}

export function makeComparisonCompletedEvent(status: string): VisualReviewEvent {
  return createReviewEvent('comparison_completed', `Comparison completed: ${status}`, 'system');
}

export function makeDecisionRecordedEvent(decision: string, note?: string): VisualReviewEvent {
  const summary = note
    ? `Decision recorded: ${decision} — "${note}"`
    : `Decision recorded: ${decision}`;
  return createReviewEvent('decision_recorded', summary, 'local-user');
}

export function makeRecapturedEvent(): VisualReviewEvent {
  return createReviewEvent('recaptured', 'After snapshot recaptured', 'local-user');
}

export function makeFailedEvent(reason: string): VisualReviewEvent {
  return createReviewEvent('failed', `Failed: ${reason}`, 'system');
}

export function makeCancelledEvent(): VisualReviewEvent {
  return createReviewEvent('cancelled', 'Review cancelled', 'local-user');
}
