import type { HandoffService } from '@viskod/agent-handoff';
import type { EventBus } from '@viskod/event-bus';
import {
  ErrorCategory,
  ErrorSeverity,
  type Result,
  type ViskodError,
  err,
  ok,
} from '@viskod/shared';
import type { IssueService, VisualIssue } from '@viskod/visual-issue';
import { computeComparison } from './comparison';
import {
  isValidReviewTransition,
  makeAfterCaptureCompletedEvent,
  makeAfterCaptureStartedEvent,
  makeBeforeLoadedEvent,
  makeCancelledEvent,
  makeComparisonCompletedEvent,
  makeDecisionRecordedEvent,
  makeFailedEvent,
  makeReviewCreatedEvent,
} from './lifecycle';
import { ReviewPersistence } from './persistence';
import { redactReview } from './redaction';
import { resolveRecaptureTarget } from './targetResolver';
import type {
  RecaptureAdapter,
  ReviewErrorCode,
  ReviewSnapshotRef,
  VisualReview,
  VisualReviewCreateInput,
  VisualReviewCreateOutput,
  VisualReviewDecisionInput,
  VisualReviewGetOutput,
  VisualReviewListItem,
  VisualReviewRecaptureInput,
  VisualReviewStatus,
} from './types';

export interface ReviewService {
  createReview(
    input: VisualReviewCreateInput,
    sessionId: string,
    pageId: string,
  ): Promise<Result<VisualReviewCreateOutput>>;
  getReview(reviewId: string): Promise<Result<VisualReviewGetOutput>>;
  listReviews(): Promise<Result<VisualReviewListItem[]>>;
  recordDecision(reviewId: string, input: VisualReviewDecisionInput): Promise<Result<VisualReview>>;
  cancelReview(reviewId: string): Promise<Result<VisualReview>>;
  setAfterSnapshot(reviewId: string, after: ReviewSnapshotRef): Promise<Result<VisualReview>>;
  recaptureReview(input: VisualReviewRecaptureInput): Promise<Result<VisualReview>>;
  reviewExists(reviewId: string): boolean;
}

export class ReviewServiceImpl implements ReviewService {
  private persistence: ReviewPersistence;
  private issueService: IssueService;
  private eventBus: EventBus;
  private recaptureAdapter?: RecaptureAdapter;

  constructor(
    eventBus: EventBus,
    issueService: IssueService,
    handoffService?: HandoffService,
    persistence?: ReviewPersistence,
    recaptureAdapter?: RecaptureAdapter,
  ) {
    this.eventBus = eventBus;
    this.issueService = issueService;
    void handoffService;
    this.persistence = persistence ?? new ReviewPersistence();
    this.recaptureAdapter = recaptureAdapter;
  }

  async createReview(
    input: VisualReviewCreateInput,
    sessionId: string,
    pageId: string,
  ): Promise<Result<VisualReviewCreateOutput>> {
    if (!input.issueId || typeof input.issueId !== 'string') {
      return err(this.reError('ISSUE_NOT_FOUND', 'Invalid issue ID'));
    }

    const issueResult = await this.issueService.getIssue(input.issueId);
    if (!issueResult.ok) {
      return err(this.reError('ISSUE_NOT_FOUND', 'Issue not found'));
    }
    const issue = issueResult.value;

    if (issue.deletedAt) {
      return err(this.reError('ISSUE_DELETED', 'This issue has been deleted.'));
    }

    const before = buildBeforeSnapshot(issue, input.issueId, input.handoffId);

    const now = new Date().toISOString();
    const reviewId = `review_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    const warnings: string[] = [];
    if (issue.targetSummary.resolutionStatus === 'stale') {
      warnings.push(
        'The before snapshot may be stale — the page has changed since the issue was created.',
      );
    }
    if (issue.targetSummary.resolutionStatus === 'ambiguous') {
      warnings.push('The selected target is ambiguous — comparison may be unreliable.');
    }
    if (before.evidenceSummary.hasSelection === false) {
      warnings.push('The before snapshot has limited selection evidence.');
    }

    const review: VisualReview = {
      schemaVersion: 1,
      reviewId,
      issueId: input.issueId,
      handoffId: input.handoffId,
      sessionId,
      pageId,
      createdAt: now,
      updatedAt: now,
      status: 'ready',
      before,
      lifecycle: [makeReviewCreatedEvent(), makeBeforeLoadedEvent(warnings)],
      redaction: { applied: false, rules: [], strippedFields: [], warnings },
    };

    const redacted = redactReview(review);
    const saveResult = await this.persistence.saveReview(redacted.review);
    if (!saveResult.ok) return err(saveResult.error);

    this.eventBus.publish({
      eventId: crypto.randomUUID(),
      eventType: 'VR_EVENT:REVIEW_CREATED',
      timestamp: now,
      version: '1.0.0',
      source: 'visual-review',
      correlationId: reviewId,
      payload: { reviewId, issueId: input.issueId, warningCount: warnings.length },
    });

    return ok({
      reviewId,
      issueId: input.issueId,
      handoffId: input.handoffId,
      status: 'ready',
      warningCount: warnings.length,
    });
  }

  async getReview(reviewId: string): Promise<Result<VisualReviewGetOutput>> {
    if (!reviewId || typeof reviewId !== 'string') {
      return err(this.reError('REVIEW_NOT_FOUND', 'Invalid review ID'));
    }

    const result = await this.persistence.loadReview(reviewId);
    if (!result.ok) return err(result.error);

    const review = projectReview(result.value);

    return ok({
      reviewId: review.reviewId,
      issueId: review.issueId,
      handoffId: review.handoffId,
      status: review.status,
      before: review.before,
      after: review.after,
      comparison: review.comparison,
      decision: review.decision,
    });
  }

  async listReviews(): Promise<Result<VisualReviewListItem[]>> {
    const result = await this.persistence.listReviews();
    if (!result.ok) return err(result.error);

    const items: VisualReviewListItem[] = result.value.map((r) => ({
      reviewId: r.reviewId,
      issueId: r.issueId,
      handoffId: r.handoffId,
      status: r.status,
      comparisonStatus: r.comparison?.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

    return ok(items);
  }

  async recordDecision(
    reviewId: string,
    input: VisualReviewDecisionInput,
  ): Promise<Result<VisualReview>> {
    if (!reviewId || typeof reviewId !== 'string') {
      return err(this.reError('REVIEW_NOT_FOUND', 'Invalid review ID'));
    }

    const result = await this.persistence.loadReview(reviewId);
    if (!result.ok) return err(result.error);

    let review = result.value;

    if (
      review.status === 'accepted' ||
      review.status === 'rejected' ||
      review.status === 'needs_follow_up'
    ) {
      return err(this.reError('ALREADY_DECIDED', 'This review has already been decided.'));
    }

    const targetStatus: VisualReviewStatus =
      input.decision === 'accepted'
        ? 'accepted'
        : input.decision === 'rejected'
          ? 'rejected'
          : 'needs_follow_up';

    if (!isValidReviewTransition(review.status, targetStatus)) {
      return err(
        this.reError(
          'INVALID_REVIEW_TRANSITION',
          `Cannot record decision from status '${review.status}'`,
        ),
      );
    }

    const now = new Date().toISOString();
    const decisionEvent = makeDecisionRecordedEvent(input.decision, input.note);

    review = {
      ...review,
      status: targetStatus,
      decision: {
        decision: input.decision,
        decidedAt: now,
        note: input.note,
        actor: 'local-user',
      },
      completedAt: now,
      updatedAt: now,
      lifecycle: [...review.lifecycle, decisionEvent],
    };

    const redacted = redactReview(review);
    const saveResult = await this.persistence.saveReview(redacted.review);
    if (!saveResult.ok) return err(saveResult.error);

    this.eventBus.publish({
      eventId: crypto.randomUUID(),
      eventType: 'VR_EVENT:DECISION_RECORDED',
      timestamp: now,
      version: '1.0.0',
      source: 'visual-review',
      correlationId: reviewId,
      payload: { reviewId, decision: input.decision },
    });

    return ok(projectReview(redacted.review));
  }

  async cancelReview(reviewId: string): Promise<Result<VisualReview>> {
    if (!reviewId || typeof reviewId !== 'string') {
      return err(this.reError('REVIEW_NOT_FOUND', 'Invalid review ID'));
    }

    const result = await this.persistence.loadReview(reviewId);
    if (!result.ok) return err(result.error);

    let review = result.value;

    if (!isValidReviewTransition(review.status, 'cancelled')) {
      return err(
        this.reError(
          'INVALID_REVIEW_TRANSITION',
          `Cannot cancel review from status '${review.status}'`,
        ),
      );
    }

    const now = new Date().toISOString();
    review = {
      ...review,
      status: 'cancelled',
      updatedAt: now,
      lifecycle: [...review.lifecycle, makeCancelledEvent()],
    };

    const redacted = redactReview(review);
    const saveResult = await this.persistence.saveReview(redacted.review);
    if (!saveResult.ok) return err(saveResult.error);

    return ok(projectReview(redacted.review));
  }

  async setAfterSnapshot(
    reviewId: string,
    after: ReviewSnapshotRef,
  ): Promise<Result<VisualReview>> {
    if (!reviewId || typeof reviewId !== 'string') {
      return err(this.reError('REVIEW_NOT_FOUND', 'Invalid review ID'));
    }

    const result = await this.persistence.loadReview(reviewId);
    if (!result.ok) return err(result.error);

    let review = result.value;

    const now = new Date().toISOString();
    const comparison = computeComparison(review.before, after);
    const compEvent = makeComparisonCompletedEvent(comparison.status);

    review = {
      ...review,
      after,
      comparison,
      status: 'ready',
      updatedAt: now,
      lifecycle: [
        ...review.lifecycle,
        makeAfterCaptureCompletedEvent(
          after.targetSummary.resolutionStatus === 'missing' ? ['Target not found'] : [],
        ),
        compEvent,
      ],
    };

    const redacted = redactReview(review);
    const saveResult = await this.persistence.saveReview(redacted.review);
    if (!saveResult.ok) return err(saveResult.error);

    this.eventBus.publish({
      eventId: crypto.randomUUID(),
      eventType: 'VR_EVENT:AFTER_CAPTURED',
      timestamp: now,
      version: '1.0.0',
      source: 'visual-review',
      correlationId: reviewId,
      payload: { reviewId, comparisonStatus: comparison.status },
    });

    return ok(projectReview(redacted.review));
  }

  async recaptureReview(input: VisualReviewRecaptureInput): Promise<Result<VisualReview>> {
    if (!input.reviewId || typeof input.reviewId !== 'string') {
      return err(this.reError('REVIEW_NOT_FOUND', 'Invalid review ID'));
    }

    if (!this.recaptureAdapter) {
      return err(
        this.reError(
          'RECAPTURE_ADAPTER_MISSING',
          'No recapture adapter configured. Cannot perform live browser recapture.',
        ),
      );
    }

    const result = await this.persistence.loadReview(input.reviewId);
    if (!result.ok) return err(result.error);

    let review = result.value;

    if (
      review.status === 'accepted' ||
      review.status === 'rejected' ||
      review.status === 'needs_follow_up'
    ) {
      return err(this.reError('ALREADY_DECIDED', 'This review has already been decided.'));
    }

    const now = new Date().toISOString();

    review = {
      ...review,
      status: 'capturing_after',
      updatedAt: now,
      lifecycle: [...review.lifecycle, makeAfterCaptureStartedEvent()],
    };

    const redacted = redactReview(review);
    const saveResult = await this.persistence.saveReview(redacted.review);
    if (!saveResult.ok) return err(saveResult.error);

    const resolvedTarget = resolveRecaptureTarget(review.before);

    const recaptureResult = await this.recaptureAdapter({
      selector: resolvedTarget?.selector,
      boundingBox: resolvedTarget?.boundingBox,
      reload: input.reload,
      cacheBust: input.cacheBust,
      url: input.url ?? review.before.page.url,
    });

    if (!recaptureResult) {
      const failTime = new Date().toISOString();
      review = {
        ...review,
        status: 'failed',
        updatedAt: failTime,
        lifecycle: [
          ...review.lifecycle,
          makeFailedEvent(
            'Recapture returned null — element may not exist or browser session is unavailable',
          ),
        ],
      };

      const failRedacted = redactReview(review);
      const failSave = await this.persistence.saveReview(failRedacted.review);
      if (!failSave.ok) return err(failSave.error);

      return err(
        this.reError(
          'RECAPTURE_FAILED',
          'Recapture returned null — element may not exist or browser session is unavailable',
        ),
      );
    }

    const after = buildAfterSnapshot(recaptureResult, review, resolvedTarget);

    const comparison = computeComparison(review.before, after);
    const compEvent = makeComparisonCompletedEvent(comparison.status);

    const completionTime = new Date().toISOString();
    review = {
      ...review,
      after,
      comparison,
      status: 'ready',
      updatedAt: completionTime,
      lifecycle: [
        ...review.lifecycle,
        makeAfterCaptureCompletedEvent(
          after.targetSummary.resolutionStatus === 'missing' ? ['Target not found'] : [],
        ),
        compEvent,
      ],
    };

    const finalRedacted = redactReview(review);
    const finalSave = await this.persistence.saveReview(finalRedacted.review);
    if (!finalSave.ok) return err(finalSave.error);

    this.eventBus.publish({
      eventId: crypto.randomUUID(),
      eventType: 'VR_EVENT:RECAPTURED',
      timestamp: completionTime,
      version: '1.0.0',
      source: 'visual-review',
      correlationId: input.reviewId,
      payload: {
        reviewId: input.reviewId,
        comparisonStatus: comparison.status,
        resolvedFrom: resolvedTarget?.resolvedFrom,
        reload: input.reload,
        cacheBust: input.cacheBust,
      },
    });

    return ok(projectReview(finalRedacted.review));
  }

  reviewExists(reviewId: string): boolean {
    return this.persistence.reviewExists(reviewId);
  }

  private reError(code: ReviewErrorCode | string, message: string): ViskodError {
    return {
      code,
      category: ErrorCategory.RUNTIME,
      severity: ErrorSeverity.RECOVERABLE,
      message,
      correlationId: crypto.randomUUID(),
      subsystem: 'visual-review',
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Consumer projection: the raw selection snapshot is an internal recapture
 * locator (it can contain stable-attribute selectors) and is persisted for
 * recapture only — it is never returned to consumers.
 */
function projectSnapshot(snapshot: ReviewSnapshotRef): ReviewSnapshotRef {
  const { selectionSnapshot: _selectionSnapshot, ...source } = snapshot.source;
  return { ...snapshot, source };
}

function projectReview(review: VisualReview): VisualReview {
  return {
    ...review,
    before: projectSnapshot(review.before),
    after: review.after ? projectSnapshot(review.after) : undefined,
  };
}

function buildBeforeSnapshot(
  issue: VisualIssue,
  issueId: string,
  handoffId?: string,
): ReviewSnapshotRef {
  const snapshot = issue.source.selectionSnapshot as Record<string, unknown>;
  const targets = (snapshot.targets as Array<Record<string, unknown>>) ?? [];
  const firstTarget = targets[0] as Record<string, unknown> | undefined;
  const geometry = (firstTarget?.geometry as Record<string, unknown>) ?? {};
  const viewportRect = (geometry.viewportRect as Record<string, number>) ?? {};

  return {
    snapshotId: crypto.randomUUID(),
    kind: 'before',
    capturedAt: issue.createdAt,
    source: {
      issueId,
      handoffId,
      selectionId: issue.source.selectionId,
      selectionSnapshot: issue.source.selectionSnapshot,
    },
    page: {
      url: issue.page.url,
      title: issue.page.title,
      route: issue.page.route,
      viewport: issue.page.viewport,
    },
    targetSummary: {
      mode: issue.targetSummary.mode,
      label: issue.targetSummary.label,
      role: issue.targetSummary.role,
      textPreview: issue.targetSummary.textPreview,
      targetCount: issue.targetSummary.targetCount,
      confidence: issue.targetSummary.confidence,
      resolutionStatus: issue.targetSummary.resolutionStatus,
    },
    visualEvidence: {
      overlayExcluded: false,
      cropRect: viewportRect.width
        ? {
            x: viewportRect.x ?? 0,
            y: viewportRect.y ?? 0,
            width: viewportRect.width ?? 0,
            height: viewportRect.height ?? 0,
          }
        : undefined,
    },
    evidenceSummary: {
      hasSelection: true,
      hasContextPacket: !!issue.evidence?.contextPacketId,
      hasScreenshot: false,
      hasSourceHints: (issue.evidence?.sourceHintCount ?? 0) > 0,
      hasConsoleEvidence: issue.evidence?.hasConsoleEvidence,
      hasNetworkEvidence: issue.evidence?.hasNetworkEvidence,
    },
  };
}

function buildAfterSnapshot(
  recaptureResult: import('./types').RecaptureResult,
  review: VisualReview,
  resolvedTarget: import('./types').ResolvedRecaptureTarget | null,
): ReviewSnapshotRef {
  let resolutionStatus: 'resolved' | 'ambiguous' | 'stale' | 'missing' = 'resolved';
  if (!recaptureResult.selector) {
    resolutionStatus = 'missing';
  } else if (recaptureResult.boundingBox.width === 0 || recaptureResult.boundingBox.height === 0) {
    resolutionStatus = 'missing';
  }

  const hasConsole = (recaptureResult.consoleEvidence?.length ?? 0) > 0;
  const hasNetwork = (recaptureResult.networkEvidence?.length ?? 0) > 0;

  return {
    snapshotId: crypto.randomUUID(),
    kind: 'after',
    capturedAt: new Date().toISOString(),
    source: {
      recapturePacketId: recaptureResult.packetId,
    },
    page: {
      url: recaptureResult.url,
      viewport: {
        width: recaptureResult.viewport.width,
        height: recaptureResult.viewport.height,
        deviceScaleFactor: recaptureResult.viewport.deviceScaleFactor,
      },
    },
    targetSummary: {
      mode: review.before.targetSummary.mode,
      label: recaptureResult.tagName,
      role: review.before.targetSummary.role,
      textPreview: recaptureResult.text?.slice(0, 200),
      targetCount: resolutionStatus === 'missing' ? 0 : 1,
      confidence: resolutionStatus === 'missing' ? 0 : (resolvedTarget?.confidence ?? 0.9),
      resolutionStatus,
    },
    visualEvidence: {
      overlayExcluded: false,
      cropRect:
        recaptureResult.boundingBox.width > 0
          ? recaptureResult.boundingBox
          : resolvedTarget?.boundingBox,
    },
    evidenceSummary: {
      hasSelection: !!recaptureResult.selector || !!resolvedTarget,
      hasContextPacket: true,
      hasScreenshot: !!recaptureResult.screenshotPath,
      hasSourceHints: (recaptureResult.sourceHints?.length ?? 0) > 0,
      hasConsoleEvidence: hasConsole,
      hasNetworkEvidence: hasNetwork,
    },
  };
}
