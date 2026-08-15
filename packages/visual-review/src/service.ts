import type { HandoffService } from '@viskod/agent-handoff';
import type { EventBus } from '@viskod/event-bus';
import { type Result, type ViskodError, createViskodError, err, ok } from '@viskod/shared';
import type { IssueService, VisualIssue } from '@viskod/visual-issue';
import { ReviewArtifactStore } from './artifact-store';
import type {
  ReviewArtifactsManifest,
  ReviewArtifactsPreview,
  TargetCropCapture,
  VisualArtifactPolicy,
} from './artifact-types';
import { computeComparison, finalizeArtifactComparison } from './comparison';
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
  RecaptureResult,
  ResolvedRecaptureTarget,
  ReviewErrorCode,
  ReviewSnapshotRef,
  VisualComparison,
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
  private artifactStore: ReviewArtifactStore;

  constructor(
    eventBus: EventBus,
    issueService: IssueService,
    handoffService?: HandoffService,
    persistence?: ReviewPersistence,
    recaptureAdapter?: RecaptureAdapter,
    artifactStore?: ReviewArtifactStore,
  ) {
    this.eventBus = eventBus;
    this.issueService = issueService;
    void handoffService;
    this.persistence = persistence ?? new ReviewPersistence();
    this.recaptureAdapter = recaptureAdapter;
    this.artifactStore = artifactStore ?? new ReviewArtifactStore();
  }

  /**
   * Phase 31: set the local-sensitive visual-review artifact policy. Default
   * is disabled (Phase 29 privacy stance) — artifacts only exist after
   * explicit Studio-level opt-in.
   */
  setArtifactPolicy(policy: VisualArtifactPolicy): void {
    this.artifactStore.setPolicy(policy);
  }

  private async attachBeforeArtifacts(review: VisualReview): Promise<Result<VisualReview>> {
    if (!this.artifactStore.isEnabled()) return ok(review);
    const result = await this.artifactStore.ensureBeforeForReview(review.reviewId, review.issueId);
    if (!result.ok) return err(result.error);
    if (result.value) {
      return ok({ ...review, artifacts: buildArtifactsPreview(result.value) });
    }
    return ok(review);
  }

  private async attachAfterArtifacts(
    review: VisualReview,
    after: ReviewSnapshotRef,
    recaptureShot: TargetCropCapture | undefined,
  ): Promise<Result<VisualReview>> {
    if (!this.artifactStore.isEnabled()) return ok(review);
    if (!recaptureShot) {
      // Policy enabled but the adapter produced no crop: leave the review's
      // artifacts as-is (before may exist) and mark visual comparison
      // unavailable through the comparison layer.
      return ok(review);
    }
    const result = await this.artifactStore.saveAfterForReview(
      review.reviewId,
      review.issueId,
      recaptureShot,
    );
    if (!result.ok) return err(result.error);
    const manifest = result.value;
    if (!manifest) return ok(review);

    let updated = review;
    if (manifest.comparison) {
      const finalized = finalizeArtifactComparison(review.before, after, manifest.comparison);
      manifest.comparison = finalized;
      await this.persistManifestComparison(manifest);
      const baseComparison = review.comparison ?? {
        status: 'visual_unavailable',
        confidence: 0.5,
        summary: '',
        target: {
          beforeStatus: review.before.targetSummary.resolutionStatus,
          afterStatus: after.targetSummary.resolutionStatus,
          sameTargetLikely: true,
          warnings: [],
        },
        warnings: [],
      };
      // Target/identity problems dominate the pixel result: an identity
      // mismatch is incomparable, never "unchanged pixels, different element".
      const metadataStatus = baseComparison.status;
      const finalStatus: VisualComparison['status'] =
        metadataStatus === 'missing_after' ||
        metadataStatus === 'ambiguous_after' ||
        metadataStatus === 'incomparable'
          ? metadataStatus
          : finalized.status === 'unavailable'
            ? 'visual_unavailable'
            : finalized.status;
      const merged: VisualComparison = {
        ...baseComparison,
        status: finalStatus,
        visual: {
          ...baseComparison.visual,
          artifactComparison: finalized,
          viewportCompatible: finalized.viewportCompatible,
          changedPixelRatio: finalized.changedPixelRatio,
          ...(manifest.pairing.diffArtifactId
            ? { diffArtifactId: manifest.pairing.diffArtifactId, screenshotDiffId: 'available' }
            : {}),
        },
        warnings: [
          ...baseComparison.warnings,
          ...(finalized.status === 'incomparable' && finalized.reason ? [finalized.reason] : []),
          ...(finalized.status === 'unavailable' && finalized.reason ? [finalized.reason] : []),
        ],
      };
      updated = { ...review, comparison: merged };
    }

    return ok({ ...updated, artifacts: buildArtifactsPreview(manifest) });
  }

  private async persistManifestComparison(manifest: ReviewArtifactsManifest): Promise<void> {
    // Best-effort: the manifest's comparison is derived from the review
    // comparison; failures are surfaced through the next artifact op.
    await this.artifactStore
      .updateComparison(manifest.reviewId, manifest.comparison ?? null)
      .catch(() => undefined);
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

    // Phase 31: when local visual review is enabled, the review inherits the
    // pre-change baseline captured before the coding agent modified the page.
    const withArtifacts = await this.attachBeforeArtifacts(review);
    if (!withArtifacts.ok) return err(withArtifacts.error);
    const reviewWithArtifacts = withArtifacts.value;

    const redacted = redactReview(reviewWithArtifacts);
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
      artifacts: review.artifacts,
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

    let comparison = computeComparison(review.before, after);
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

    // Phase 31: persist the after crop, run the real pixel comparison, and
    // merge the artifact evidence into the review comparison.
    const withArtifacts = await this.attachAfterArtifacts(
      review,
      after,
      recaptureResult.elementScreenshot,
    );
    if (withArtifacts.ok) {
      review = withArtifacts.value;
      if (review.comparison && review.comparison !== comparison) {
        comparison = review.comparison;
      }
    }
    // Artifact persistence failure is recoverable: the metadata review is
    // still valid and the UI reports visual comparison unavailable.

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
    return createViskodError({
      code,
      category: 'runtime',
      severity: 'recoverable',
      message,
      subsystem: 'visual-review',
    });
  }
}

/**
 * Consumer projection: the raw selection snapshot is an internal recapture
 * locator (it can contain stable-attribute selectors) and is persisted for
 * recapture only — it is never returned to consumers. Phase 28B stable
 * attribute identity is also internal (it can double as a locator); the
 * projection keeps only the opaque target id.
 */
function projectSnapshot(snapshot: ReviewSnapshotRef): ReviewSnapshotRef {
  const { selectionSnapshot: _selectionSnapshot, ...source } = snapshot.source;
  const identity = snapshot.identity ? { targetId: snapshot.identity.targetId } : undefined;
  return { ...snapshot, source, identity };
}

/**
 * Phase 31: sanitized artifact preview for user-facing state. Opaque ids
 * only — no filesystem paths, no raw image data. The preview explicitly
 * marks local-sensitive artifacts as unavailable when the policy is on but
 * no collected evidence exists.
 */
function buildArtifactsPreview(manifest: ReviewArtifactsManifest): ReviewArtifactsPreview {
  const entry = (role: 'before' | 'after' | 'diff') =>
    manifest.artifacts.find((a) => a.role === role);

  const before = entry('before');
  const after = entry('after');
  const diff = entry('diff');

  const hasCollectedBefore = before?.status === 'collected';
  const hasCollectedAfter = after?.status === 'collected';
  let visualUnavailableReason: string | undefined;
  if (!hasCollectedBefore && !hasCollectedAfter) {
    visualUnavailableReason = 'Local visual review artifacts were not captured.';
  } else if (!hasCollectedBefore) {
    visualUnavailableReason = 'The pre-change visual baseline is unavailable.';
  } else if (!hasCollectedAfter) {
    visualUnavailableReason = 'The post-change capture is unavailable.';
  } else if (
    manifest.comparison?.status === 'unavailable' ||
    manifest.comparison?.status === 'incomparable'
  ) {
    visualUnavailableReason = manifest.comparison.reason ?? 'The captures cannot be compared.';
  }

  return {
    policy: manifest.policy,
    before: before
      ? {
          artifactId: before.artifactId,
          status: before.status,
          capturedAt: before.capturedAt,
          dimensions: before.dimensions,
        }
      : undefined,
    after: after
      ? {
          artifactId: after.artifactId,
          status: after.status,
          capturedAt: after.capturedAt,
          dimensions: after.dimensions,
        }
      : undefined,
    diff: diff
      ? {
          artifactId: diff.artifactId,
          status: diff.status,
          capturedAt: diff.capturedAt,
        }
      : undefined,
    comparison: manifest.comparison,
    visualUnavailableReason,
  };
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
  const targetId = firstTarget?.targetId as string | undefined;
  const stableAttributes = (
    firstTarget?.fingerprints as { stableAttributes?: Record<string, string> } | undefined
  )?.stableAttributes;
  const hasIdentity =
    !!targetId || (stableAttributes !== undefined && Object.keys(stableAttributes).length > 0);

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
    // Phase 28B stable identity — display labels are never target identity
    // (Phase 31 / VISKOD-AUDIT-005).
    identity: hasIdentity ? { targetId, stableAttributes } : undefined,
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
  recaptureResult: RecaptureResult,
  review: VisualReview,
  resolvedTarget: ResolvedRecaptureTarget | null,
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
      // VISKOD-AUDIT-005 (Phase 31): never present tagName as the target
      // label. The before label is presentation-only identity context; real
      // identity lives in `identity` (Phase 28B stable attributes).
      label: review.before.targetSummary.label,
      role: review.before.targetSummary.role,
      textPreview: recaptureResult.text?.slice(0, 200),
      targetCount: resolutionStatus === 'missing' ? 0 : 1,
      confidence: resolutionStatus === 'missing' ? 0 : (resolvedTarget?.confidence ?? 0.9),
      resolutionStatus,
    },
    // Phase 28B stable identity of the resolved after element — display
    // labels are never used as target identity (VISKOD-AUDIT-005).
    identity: recaptureResult.identity,
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
