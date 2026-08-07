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

  private stage: StudioWorkflowStage = 'idle';
  private activeSelection: VisualSelection | null = null;
  private capturedPacket: ContextPacket | null = null;
  private issueId?: string;
  private handoffId?: string;
  private reviewId?: string;
  private error?: string;

  constructor(options: StudioWorkflowOptions) {
    this.pageId = options.pageId;
    this.sessionId = options.sessionId;
    this.controller = options.controller;
    this.vce = options.vce;
    this.issueService = options.issueService;
    this.userFacingHandoff = options.userFacingHandoff;
    this.userFacingReview = options.userFacingReview;
    this.reviewService = options.reviewService;
  }

  /** Enter overlay selection mode and move to `selecting`. */
  async beginReport(): Promise<Result<StudioWorkflowState>> {
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

    const captureResult = await this.vce.generatePacket({
      selector,
      boundingBox: target.geometry.viewportRect,
      source: 'studio',
    });
    if (!captureResult.ok) {
      return this.fail(this.stage, RECOVERY_REFRESH);
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
      { issueId: this.issueId, sourceHints, sourceHintStatus: this.sourceHintStatus() },
      this.sessionId,
      this.pageId,
    );
    if (!result.ok || !result.handoffId) {
      return this.fail(this.stage, result.error ?? 'Handoff could not be prepared.');
    }

    this.handoffId = result.handoffId;
    const preview = await this.userFacingHandoff.getPreview(result.handoffId);
    if (result.warnings && result.warnings.length > 0) {
      // Warnings propagate to the user-facing state; they do not block.
      this.error = result.warnings.join(' ');
    } else {
      this.error = undefined;
    }
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

    this.stage = 'review_ready';
    this.error = preview.warnings.length > 0 ? preview.warnings.join(' ') : undefined;
    return ok(this.buildState(undefined, preview));
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
    this.error = undefined;
    const preview = await this.userFacingReview.getPreview(this.reviewId);
    return ok(this.buildState(undefined, preview));
  }

  /** Invalidate the workflow (navigation, reselect). */
  reset(): void {
    this.stage = 'idle';
    this.activeSelection = null;
    this.capturedPacket = null;
    this.issueId = undefined;
    this.handoffId = undefined;
    this.reviewId = undefined;
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
      review: review ?? null,
    };
    if (this.error) state.error = this.error;
    return state;
  }

  private buildEvidenceSummary(packet: ContextPacket | null) {
    if (!packet) return undefined;
    return {
      contextPacketId: packet.packetId,
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
  }> {
    const hints = this.capturedPacket?.sourceHints ?? [];
    return hints.map((hint) => ({
      displayName: hint.displayPath ?? hint.filePath,
      confidence: hint.confidence,
      kind: hint.kind,
      score: hint.ranking?.score,
      reasons: hint.ranking?.reasons,
      warnings: hint.ranking?.penalties,
    }));
  }

  private sourceHintStatus(): 'ranked' | 'ambiguous' | 'low_confidence' | 'missing' {
    const hints = this.capturedPacket?.sourceHints ?? [];
    if (hints.length === 0) return 'missing';
    const top = hints[0];
    if (top && top.confidence < 0.6) return 'low_confidence';
    return 'ranked';
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
