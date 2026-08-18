import type { HandoffPreview, UserFacingHandoff } from '@viskod/agent-handoff';
import type { ContextPacket, SelectionTarget } from '@viskod/context-engine';
import {
  ErrorCategory,
  ErrorSeverity,
  type Result,
  type ViskodError,
  err,
  ok,
} from '@viskod/shared';
import type { IssueService, VisualIssueSeverity } from '@viskod/visual-issue';
import type { ReviewPreview, ReviewService, UserFacingReview } from '@viskod/visual-review';
import type { VisualSelection } from '@viskod/visual-selection';

export type StudioWorkflowStage =
  | 'idle'
  | 'selecting'
  | 'describe'
  | 'handoff_ready'
  | 'verifying'
  | 'review_ready'
  | 'decided';

export interface WorkflowSelectionSummary {
  label?: string;
  role?: string;
  textPreview?: string;
  targetCount: number;
  confidence: number;
  resolutionStatus: 'resolved' | 'ambiguous' | 'stale' | 'missing';
}

/**
 * User-facing workflow state. Never contains raw packet JSON, local paths,
 * cookies, tokens, or CSS selectors — those are backend/agent details.
 */
export interface StudioWorkflowState {
  stage: StudioWorkflowStage;
  pageUrl?: string;
  pageTitle?: string;
  selection: WorkflowSelectionSummary | null;
  issueId?: string;
  handoffId?: string;
  reviewId?: string;
  handoff?: HandoffPreview | null;
  review?: ReviewPreview | null;
  /**
   * Phase 30: compact source-resolution status for the captured target.
   * Repository-relative candidate paths only; ambiguity is shown as
   * ambiguity, never a confirmed first candidate.
   */
  source?: {
    resolution: 'resolved' | 'ambiguous' | 'unavailable';
    status: string;
    count: number;
    candidates: Array<{
      path: string;
      qualification: 'exact' | 'probable' | 'possible' | 'weak';
      confidence: number;
      reasons: string[];
    }>;
  };
  /**
   * Phase 31: local-sensitive visual review artifact policy. `asked` is true
   * once the user has answered the one-time consent prompt — the normal
   * report flow never re-asks.
   */
  visualReviewPolicy?: 'disabled' | 'local-sensitive-target-crop';
  visualReviewPolicyAsked?: boolean;
  /** Single user-facing recovery message; cleared on the next successful step. */
  error?: string;
}

export interface CreateIssueInput {
  problem: string;
  expected: string;
  severity?: VisualIssueSeverity;
}

/** Narrow structural view of SelectionOverlayController used by the workflow. */
export interface SelectionController {
  enterSelectionMode(): Promise<Result<void>>;
  exitSelectionMode(): Promise<Result<void>>;
  getActiveSelection(): Promise<Result<VisualSelection | null>>;
  clearSelection(): Promise<Result<void>>;
  isActive(): boolean;
}

/** Narrow structural view of VisualContextEngine.generatePacket used by the workflow. */
export interface WorkflowCaptureEngine {
  generatePacket(selection?: SelectionTarget): Promise<Result<ContextPacket>>;
}

export interface StudioWorkflowOptions {
  pageId: string;
  sessionId: string;
  controller: SelectionController;
  vce: WorkflowCaptureEngine;
  issueService: IssueService;
  userFacingHandoff: UserFacingHandoff;
  userFacingReview: UserFacingReview;
  reviewService: ReviewService;
  /**
   * Phase 31: capture and persist the pre-change visual-review baseline for
   * the issue. Invoked when the agent handoff is prepared — before the
   * coding agent modifies the UI. Best-effort: failure degrades to a
   * warning, never blocks the handoff.
   */
  captureBaselineArtifact?: (input: {
    issueId: string;
    selector: string;
    boundingBox?: { x: number; y: number; width: number; height: number };
  }) => Promise<Result<{ baselineStored: boolean }>>;
  /** Phase 31: current visual-review artifact policy (for the consent banner). */
  visualReviewPolicy?: 'disabled' | 'local-sensitive-target-crop';
  visualReviewPolicyAsked?: boolean;
}

const RECOVERY_RESEARCH = 'Select the element again.';
const RECOVERY_REFRESH = 'Refresh the page and select it again.';

export class StudioWorkflow {
  private pageId: string;
  private sessionId: string;
  private controller: SelectionController;
  private vce: WorkflowCaptureEngine;
  private issueService: IssueService;
  private userFacingHandoff: UserFacingHandoff;
  private userFacingReview: UserFacingReview;
  private reviewService: ReviewService;
  private captureBaselineArtifact?: StudioWorkflowOptions['captureBaselineArtifact'];
  private visualReviewPolicy?: 'disabled' | 'local-sensitive-target-crop';
  private visualReviewPolicyAsked?: boolean;

  private stage: StudioWorkflowStage = 'idle';
  private activeSelection: VisualSelection | null = null;
  private capturedPacket: ContextPacket | null = null;
  private issueId?: string;
  private handoffId?: string;
  private reviewId?: string;
  private reviewPreview?: ReviewPreview;
  private error?: string;
  /**
   * Workflow generation. Bumped on every transient reset (begin/cancel/
   * reselect/reset) so late async completions from a previous generation can
   * never mutate the active workflow (VISKOD-AUDIT-013/014).
   */
  private epoch = 0;
  /**
   * In-flight create-issue → prepare-handoff operation. Concurrent or
   * repeated submissions share the same promise, so rapid double-clicks or
   * repeated HTTP requests produce exactly one issue and one handoff.
   */
  private preparing: Promise<Result<StudioWorkflowState>> | null = null;

  constructor(options: StudioWorkflowOptions) {
    this.pageId = options.pageId;
    this.sessionId = options.sessionId;
    this.controller = options.controller;
    this.vce = options.vce;
    this.issueService = options.issueService;
    this.userFacingHandoff = options.userFacingHandoff;
    this.userFacingReview = options.userFacingReview;
    this.reviewService = options.reviewService;
    this.captureBaselineArtifact = options.captureBaselineArtifact;
    this.visualReviewPolicy = options.visualReviewPolicy;
    this.visualReviewPolicyAsked = options.visualReviewPolicyAsked;
  }

  /**
   * Phase 31A: reflect an answered consent choice in the LIVE workflow so
   * the one-time banner disappears immediately (the workflow snapshot would
   * otherwise stay stale until the next navigation).
   */
  setVisualReviewPolicy(policy: 'disabled' | 'local-sensitive-target-crop', asked: boolean): void {
    this.visualReviewPolicy = policy;
    this.visualReviewPolicyAsked = asked;
  }
  /**
   * Reconstruct the durable portion of a workflow after Studio restart.
   * Capture evidence and review artifacts remain owned by their persistence
   * services; this method only restores opaque relation ids and stage.
   */
  async resumeIssue(
    issueId: string,
    handoffId?: string,
    reviewId?: string,
  ): Promise<Result<StudioWorkflowState>> {
    const issue = await this.issueService.getIssue(issueId);
    if (!issue.ok || issue.value.deletedAt) {
      return this.fail('idle', 'This issue is no longer available.');
    }
    this.clearTransientState();
    this.issueId = issueId;
    this.handoffId = handoffId;
    this.reviewId = reviewId;
    if (reviewId) {
      const preview = await this.userFacingReview.getPreview(reviewId);
      if (!preview) return this.fail('handoff_ready', 'Review history is unavailable.');
      this.reviewPreview = preview;
      this.stage = preview.decision
        ? 'decided'
        : preview.after || preview.comparison
          ? 'review_ready'
          : 'verifying';
    } else {
      this.stage = handoffId ? 'handoff_ready' : 'describe';
    }
    return ok(this.buildState());
  }

  /** Enter overlay selection mode and move to `selecting`. */
  async beginReport(): Promise<Result<StudioWorkflowState>> {
    // A new report is a clean transient boundary: the previous report's
    // selection, capture, and issue/handoff identifiers must not leak into
    // the new workflow (VISKOD-AUDIT-014). Persisted domain entities are
    // never touched here.
    this.clearTransientState();
    const modeResult = await this.controller.enterSelectionMode();
    if (!modeResult.ok) {
      return this.fail(
        this.stage,
        'Selection mode could not be started. Refresh the page and try again.',
      );
    }
    this.stage = 'selecting';
    this.error = undefined;
    return ok(this.buildState());
  }

  /**
   * Read the active visual selection, capture evidence through VCE, and move
   * to `describe`. A missing/stale/ambiguous target or a failed capture keeps
   * the workflow at the current stage with a recovery message — no partial
   * issue is ever created.
   */
  async acceptSelection(): Promise<Result<StudioWorkflowState>> {
    const selectionResult = await this.controller.getActiveSelection();
    if (!selectionResult.ok || !selectionResult.value) {
      return this.fail(this.stage, RECOVERY_RESEARCH);
    }

    const selection = selectionResult.value;
    if (
      selection.resolution.status === 'missing' ||
      selection.resolution.status === 'stale' ||
      selection.resolution.status === 'ambiguous'
    ) {
      return this.fail(
        this.stage,
        selection.resolution.status === 'ambiguous' ? RECOVERY_RESEARCH : RECOVERY_REFRESH,
      );
    }

    const target = selection.targets[0];
    const selector = target?.selector;
    if (!target || !selector) {
      return this.fail(
        this.stage,
        'This element cannot be safely re-captured. Select a stable element or reselect.',
      );
    }

    const epoch = this.epoch;
    const captureResult = await this.vce.generatePacket({
      selector,
      boundingBox: target.geometry.viewportRect,
      source: 'studio',
    });
    if (!captureResult.ok) {
      return this.fail(this.stage, RECOVERY_REFRESH);
    }
    if (epoch !== this.epoch) {
      // The workflow was reset/replaced mid-capture; never commit stale state.
      return ok(this.buildState());
    }

    // Close selection mode atomically with acceptance: stop overlay polling
    // and page interception so later overlay events cannot replace the
    // frozen selection while the user describes the issue (VISKOD-AUDIT-013).
    // Polling is stopped synchronously inside the controller before any
    // awaited work, so acceptance proceeds even if overlay teardown fails.
    if (this.controller.isActive()) {
      await this.controller.exitSelectionMode();
    }

    this.activeSelection = selection;
    this.capturedPacket = captureResult.value;
    this.issueId = undefined;
    this.handoffId = undefined;
    this.reviewId = undefined;
    this.stage = 'describe';
    this.error = undefined;
    return ok(this.buildState());
  }

  /** Require non-empty problem/expected; create the issue and stay at `describe`. */
  async createIssue(input: CreateIssueInput): Promise<Result<StudioWorkflowState>> {
    const problem = input.problem?.trim();
    const expected = input.expected?.trim();
    if (!problem || !expected) {
      return this.fail(this.stage, 'Both "What is wrong?" and "What should happen?" are required.');
    }

    if (this.stage !== 'describe' || !this.activeSelection) {
      return this.fail(this.stage, RECOVERY_RESEARCH);
    }

    const description = `Problem:\n${problem}\n\nExpected result:\n${expected}`;
    const title = problem.length > 80 ? `${problem.slice(0, 79)}…` : problem;

    const evidence = this.buildEvidenceSummary(this.capturedPacket);
    const createResult = await this.issueService.createIssue(
      this.activeSelection,
      this.sessionId,
      this.pageId,
      title,
      description,
      input.severity ?? 'medium',
      evidence,
      expected,
    );
    if (!createResult.ok) {
      return this.fail(this.stage, RECOVERY_RESEARCH);
    }

    this.issueId = createResult.value.issueId;
    this.error = undefined;
    return ok(this.buildState());
  }

  /**
   * Prepare the agent handoff through the existing user-facing adapter and
   * move to `handoff_ready`. Studio only prepares the handoff; it never
   * claims to invoke an external coding agent.
   */
  async prepareAgent(): Promise<Result<StudioWorkflowState>> {
    if (!this.issueId) {
      return this.fail(this.stage, 'Create the issue first.');
    }

    const sourceHints = this.buildSourceHintInput();
    const result = await this.userFacingHandoff.sendToAgent(
      {
        issueId: this.issueId,
        sourceHints,
        sourceHintStatus: this.sourceHintStatus(),
        sourceHintResolution: this.sourceResolution(),
      },
      this.sessionId,
      this.pageId,
    );
    if (!result.ok || !result.handoffId) {
      return this.fail(this.stage, result.error ?? 'Handoff could not be prepared.');
    }
    this.handoffId = result.handoffId;
    const preview = await this.userFacingHandoff.getPreview(result.handoffId);
    const warnings: string[] =
      result.warnings && result.warnings.length > 0 ? [...result.warnings] : [];
    const baseline = await this.captureBaselineForIssue(this.issueId);
    if (baseline && !baseline.ok) {
      warnings.push(baseline.error.message);
    }
    if (warnings.length > 0) {
      // Warnings propagate to the user-facing state; they do not block.
      this.error = warnings.join(' ');
    } else {
      this.error = undefined;
    }
    this.stage = 'handoff_ready';
    return ok(this.buildState(preview));
  }

  /**
   * The single user-facing "Prepare agent handoff" action
   * (VISKOD-AUDIT-001): create the issue if not already created for this
   * submission, prepare the agent handoff for that issue, and move to
   * `handoff_ready`.
   *
   * Idempotency (VISKOD-AUDIT duplicate submission):
   * - repeated submit after success returns the existing handoff-ready state;
   * - concurrent/repeated submits share one in-flight operation;
   * - retry after a handoff failure reuses the persisted issue ID and never
   *   creates a second issue.
   *
   * Partial failure: issue created but handoff failed keeps the issue ID in
   * workflow state, stays at `describe` with an actionable error, and never
   * falsely transitions to `handoff_ready`. If issue creation itself fails,
   * no handoff is attempted.
   */
  async prepareAgentHandoffFromDescription(
    input: CreateIssueInput,
  ): Promise<Result<StudioWorkflowState>> {
    const problem = input.problem?.trim();
    const expected = input.expected?.trim();
    if (!problem || !expected) {
      return this.fail(this.stage, 'Both "What is wrong?" and "What should happen?" are required.');
    }
    if (this.handoffId) {
      // Already prepared: repeated submission is a no-op returning the state.
      return ok(this.buildState());
    }
    if (this.stage !== 'describe' || !this.activeSelection) {
      return this.fail(this.stage, RECOVERY_RESEARCH);
    }
    if (this.preparing) {
      return this.preparing;
    }
    const operation = this.doPrepareAgentHandoff(input, problem, expected).finally(() => {
      this.preparing = null;
    });
    this.preparing = operation;
    return operation;
  }

  private async doPrepareAgentHandoff(
    input: CreateIssueInput,
    problem: string,
    expected: string,
  ): Promise<Result<StudioWorkflowState>> {
    const epoch = this.epoch;
    if (this.stage !== 'describe' || !this.activeSelection) {
      return this.fail(this.stage, RECOVERY_RESEARCH);
    }

    if (!this.issueId) {
      const description = `Problem:\n${problem}\n\nExpected result:\n${expected}`;
      const title = problem.length > 80 ? `${problem.slice(0, 79)}…` : problem;
      const createResult = await this.issueService.createIssue(
        this.activeSelection,
        this.sessionId,
        this.pageId,
        title,
        description,
        input.severity ?? 'medium',
        this.buildEvidenceSummary(this.capturedPacket),
        expected,
      );
      if (!createResult.ok) {
        // Issue creation failed: no handoff attempt, remain recoverable at
        // describe with the entered description preserved in the UI.
        return this.fail(
          this.stage,
          `The issue could not be created. ${createResult.error.message}`,
        );
      }
      if (epoch !== this.epoch) {
        return ok(this.buildState());
      }
      this.issueId = createResult.value.issueId;
    }

    const sourceHints = this.buildSourceHintInput();
    const result = await this.userFacingHandoff.sendToAgent(
      {
        issueId: this.issueId,
        sourceHints,
        sourceHintStatus: this.sourceHintStatus(),
        sourceHintResolution: this.sourceResolution(),
      },
      this.sessionId,
      this.pageId,
    );
    if (!result.ok || !result.handoffId) {
      // Handoff failed after the issue was persisted: preserve the issue ID,
      // stay at describe, and let a retry reuse the same issue.
      return this.fail(
        this.stage,
        `The handoff could not be prepared. ${result.error ?? 'Try again.'}`,
      );
    }
    if (epoch !== this.epoch) {
      return ok(this.buildState());
    }

    this.handoffId = result.handoffId;
    const preview = await this.userFacingHandoff.getPreview(result.handoffId);
    const warnings: string[] =
      result.warnings && result.warnings.length > 0 ? [...result.warnings] : [];

    // Phase 31: capture the pre-change visual baseline NOW — before the
    // coding agent modifies the UI. Best-effort: a failure degrades to a
    // warning; the review later reports visual comparison unavailable.
    const baseline = await this.captureBaselineForIssue(this.issueId);
    if (baseline && !baseline.ok) {
      warnings.push(baseline.error.message);
    }

    this.error = warnings.length > 0 ? warnings.join(' ') : undefined;
    this.stage = 'handoff_ready';
    return ok(this.buildState(preview));
  }

  /** Create the review from the issue and move to `verifying`. */
  async startVerification(): Promise<Result<StudioWorkflowState>> {
    if (!this.issueId) {
      return this.fail(this.stage, 'Create the issue first.');
    }

    const result = await this.userFacingReview.startReview(
      this.issueId,
      this.sessionId,
      this.pageId,
      this.handoffId,
    );
    if (!result.ok || !result.reviewId) {
      return this.fail(this.stage, result.error ?? 'Verification could not be started.');
    }

    this.reviewId = result.reviewId;
    this.stage = 'verifying';
    this.error = undefined;
    return ok(this.buildState());
  }

  /** Reload + cache-bust recapture, then expose the review preview. */
  async recaptureVerification(): Promise<Result<StudioWorkflowState>> {
    if (!this.reviewId) {
      return this.fail(this.stage, 'Start verification first.');
    }

    const recaptureResult = await this.reviewService.recaptureReview({
      reviewId: this.reviewId,
      reload: true,
      cacheBust: true,
    });
    if (!recaptureResult.ok) {
      return this.fail(
        'verifying',
        'The target could not be re-captured. Refresh the page and try again.',
      );
    }
    const preview = await this.userFacingReview.getPreview(this.reviewId);
    if (!preview) {
      return this.fail('verifying', 'Verification results are unavailable. Try again.');
    }

    this.reviewPreview = preview;
    this.stage = 'review_ready';
    this.error = preview.warnings.length > 0 ? preview.warnings.join(' ') : undefined;
    return ok(this.buildState());
  }

  /** Record the human decision and move to `decided`. */
  async decide(
    decision: 'accepted' | 'rejected' | 'needs_follow_up',
    note?: string,
  ): Promise<Result<StudioWorkflowState>> {
    if (!this.reviewId) {
      return this.fail(this.stage, 'Start verification first.');
    }

    let decided = false;
    if (decision === 'accepted') {
      decided = await this.userFacingReview.acceptReview(this.reviewId, note);
    } else if (decision === 'rejected') {
      decided = await this.userFacingReview.rejectReview(this.reviewId, note);
    } else {
      decided = await this.userFacingReview.needsFollowUp(this.reviewId, note);
    }
    if (!decided) {
      return this.fail(this.stage, 'The decision could not be recorded. Try again.');
    }
    this.stage = 'decided';
    this.reviewPreview = (await this.userFacingReview.getPreview(this.reviewId)) ?? undefined;
    return ok(this.buildState());
  }

  /**
   * Re-enter selection mode from a pre-handoff stage (VISKOD-AUDIT-014).
   * Obsolete transient state — active selection, capture, and any pending
   * issue/handoff identifiers — is cleared so a new selection replaces the
   * old one deterministically. The description text lives in the UI and is
   * preserved by the client across the reselect round trip.
   */
  async reselect(): Promise<Result<StudioWorkflowState>> {
    if (this.controller.isActive()) {
      await this.controller.exitSelectionMode();
    }
    await this.controller.clearSelection();
    this.clearTransientState();

    const modeResult = await this.controller.enterSelectionMode();
    if (!modeResult.ok) {
      return this.fail(
        this.stage,
        'Selection mode could not be restarted. Select again after refreshing the page.',
      );
    }
    this.stage = 'selecting';
    this.error = undefined;
    return ok(this.buildState());
  }

  /**
   * Abandon the active report and return to `idle` (VISKOD-AUDIT-014).
   * If handoff preparation partially succeeded, the persisted issue is
   * intentionally NOT deleted — it remains in the local store and the
   * active workflow is simply reset.
   */
  async cancel(): Promise<Result<StudioWorkflowState>> {
    if (this.controller.isActive()) {
      await this.controller.exitSelectionMode();
    }
    this.clearTransientState();
    this.stage = 'idle';
    this.error = undefined;
    return ok(this.buildState());
  }

  /** Invalidate the workflow (navigation, reselect). */
  reset(): void {
    this.clearTransientState();
    this.stage = 'idle';
  }

  /** Transient reset boundary: clears everything that must not leak across reports. */
  private clearTransientState(): void {
    this.epoch++;
    this.activeSelection = null;
    this.capturedPacket = null;
    this.issueId = undefined;
    this.handoffId = undefined;
    this.reviewId = undefined;
    this.reviewPreview = undefined;
    this.error = undefined;
  }

  /**
   * Surface the live active selection during `selecting` so the UI can show
   * the target summary immediately after the overlay click (before accept).
   */
  async refreshSelection(): Promise<void> {
    if (this.activeSelection || this.stage !== 'selecting') return;
    const current = await this.controller.getActiveSelection();
    if (current.ok && current.value) {
      this.activeSelection = current.value;
    }
  }

  getState(): StudioWorkflowState {
    return this.buildState();
  }

  private buildState(
    handoff?: HandoffPreview | null,
    review?: ReviewPreview | null,
  ): StudioWorkflowState {
    const state: StudioWorkflowState = {
      stage: this.stage,
      pageUrl: this.activeSelection?.page.url,
      pageTitle: this.activeSelection?.page.title,
      selection: this.activeSelection
        ? {
            label: this.activeSelection.summary.label,
            role: this.activeSelection.summary.role,
            textPreview: this.activeSelection.summary.textPreview,
            targetCount: this.activeSelection.summary.targetCount,
            confidence: this.activeSelection.resolution.confidence,
            resolutionStatus: this.activeSelection.resolution.status,
          }
        : null,
      issueId: this.issueId,
      handoffId: this.handoffId,
      reviewId: this.reviewId,
      handoff: handoff ?? null,
      review: review ?? this.reviewPreview ?? null,
      source: this.buildSourceStatus(),
      visualReviewPolicy: this.visualReviewPolicy,
      visualReviewPolicyAsked: this.visualReviewPolicyAsked,
    };
    if (this.error) state.error = this.error;
    return state;
  }

  /**
   * Phase 30: compact user-facing source status derived from the capture.
   * Repository-relative paths only; resolution is truthful — ambiguous
   * captures are never presented as a confirmed top candidate.
   */
  private buildSourceStatus(): StudioWorkflowState['source'] {
    const packet = this.capturedPacket;
    if (!packet) return undefined;
    const hints = packet.sourceHints ?? [];
    const resolution = packet.sourceHintsResolution?.status ?? 'unavailable';
    return {
      resolution,
      status: packet.evidence?.sourceHints?.state ?? 'unavailable',
      count: hints.length,
      candidates: hints.slice(0, 5).map((h) => ({
        path: h.displayPath ?? h.filePath,
        qualification: h.qualification ?? 'weak',
        confidence: h.confidence,
        reasons: (h.reasons ?? []).slice(0, 3),
      })),
    };
  }

  private buildEvidenceSummary(packet: ContextPacket | null) {
    if (!packet) return undefined;
    return {
      contextPacketId: packet.packetId,
      // Durable persisted capture reference (Phase 29): the handoff points at
      // the capture on disk, not an in-memory packet.
      captureId: packet.captureId,
      sourceHintCount: (packet.sourceHints ?? []).length,
      hasConsoleEvidence: (packet.runtimeEvidence?.console?.length ?? 0) > 0,
      hasNetworkEvidence: (packet.runtimeEvidence?.network?.length ?? 0) > 0,
      redactionApplied: (packet.metadata?.redactions?.length ?? 0) > 0,
    };
  }

  private buildSourceHintInput(): Array<{
    displayName: string;
    confidence?: number;
    kind?: string;
    score?: number;
    reasons?: string[];
    warnings?: string[];
    qualification?: 'exact' | 'probable' | 'possible' | 'weak';
  }> {
    const hints = this.capturedPacket?.sourceHints ?? [];
    return hints.map((hint) => ({
      displayName: hint.displayPath ?? hint.filePath,
      confidence: hint.confidence,
      kind: hint.kind,
      score: hint.ranking?.score,
      reasons: hint.ranking?.reasons ?? hint.reasons,
      warnings: hint.ranking?.penalties,
      qualification: hint.qualification,
    }));
  }

  private sourceHintStatus(): 'ranked' | 'ambiguous' | 'low_confidence' | 'missing' {
    const packet = this.capturedPacket;
    if (!packet) return 'missing';
    const hints = packet.sourceHints ?? [];
    if (hints.length === 0) return 'missing';
    const resolution = packet.sourceHintsResolution?.status ?? 'unavailable';
    if (resolution === 'ambiguous') return 'ambiguous';
    const top = hints[0];
    if (!top) return 'missing';
    if (top.qualification === 'possible' || top.qualification === 'weak') {
      return 'low_confidence';
    }
    return 'ranked';
  }

  private sourceResolution(): 'resolved' | 'ambiguous' | 'unavailable' {
    return this.capturedPacket?.sourceHintsResolution?.status ?? 'unavailable';
  }

  /**
   * Phase 31: capture the pre-change visual-review baseline for an issue
   * using the exact resolved target of the accepted selection. No-op when
   * the workflow has no captured target or no baseline capturer is wired.
   */
  private async captureBaselineForIssue(
    issueId: string,
  ): Promise<Result<{ baselineStored: boolean }> | null> {
    if (!this.captureBaselineArtifact) return null;
    const selector = this.capturedPacket?.selection.selector;
    if (!selector) return null;
    return this.captureBaselineArtifact({
      issueId,
      selector,
      boundingBox: this.capturedPacket?.selection.boundingBox,
    });
  }

  private fail(stage: StudioWorkflowStage, message: string): Result<StudioWorkflowState> {
    this.stage = stage;
    this.error = message;
    return err(this.workflowError(message));
  }

  private workflowError(message: string): ViskodError {
    return {
      code: 'WORKFLOW_RECOVERY_REQUIRED',
      category: ErrorCategory.RUNTIME,
      severity: ErrorSeverity.RECOVERABLE,
      message,
      correlationId: crypto.randomUUID(),
      subsystem: 'studio-workflow',
      timestamp: new Date().toISOString(),
      recovery: message,
    };
  }
}
