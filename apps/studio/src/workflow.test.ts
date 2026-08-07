import { UserFacingHandoff } from '@viskod/agent-handoff';
import type { HandoffService } from '@viskod/agent-handoff';
import type {
  AgentHandoff,
  AgentHandoffCreateInput,
  AgentHandoffCreateOutput,
  AgentHandoffGetOutput,
  AgentHandoffListItem,
  AgentHandoffStatus,
} from '@viskod/agent-handoff';
import type { ContextPacket, SelectionTarget } from '@viskod/context-engine';
import type { EventBus } from '@viskod/event-bus';
import { EventBus as RealEventBus } from '@viskod/event-bus';
import { type Result, type ViskodError, err, ok } from '@viskod/shared';
import type { IssueService, IssueUpdate, VisualIssue } from '@viskod/visual-issue';
import { UserFacingReview } from '@viskod/visual-review';
import type { ReviewService } from '@viskod/visual-review';
import type {
  ReviewSnapshotRef,
  VisualReview,
  VisualReviewCreateInput,
  VisualReviewCreateOutput,
  VisualReviewDecisionInput,
  VisualReviewGetOutput,
  VisualReviewListItem,
  VisualReviewRecaptureInput,
} from '@viskod/visual-review';
import type { VisualSelection, VisualSelectionTarget } from '@viskod/visual-selection';
import { describe, expect, it } from 'vitest';
import { type SelectionController, StudioWorkflow, type WorkflowCaptureEngine } from './workflow';

// ---------------------------------------------------------------------------
// Fakes — in-memory persistence + fake service adapters
// ---------------------------------------------------------------------------

function makeError(code: string, message: string): ViskodError {
  return {
    code,
    category: 'runtime' as const,
    severity: 'recoverable' as const,
    message,
    correlationId: 'corr-test',
    subsystem: 'test',
    timestamp: new Date().toISOString(),
  };
}

function makeTarget(overrides: Partial<VisualSelectionTarget> = {}): VisualSelectionTarget {
  return {
    targetId: 'target_1',
    documentOrder: 0,
    geometry: {
      viewportRect: { x: 10, y: 20, width: 100, height: 50 },
    },
    semantics: {
      tagName: 'button',
      role: 'button',
      accessibleName: 'Submit',
      textPreview: 'Submit',
      isInteractive: true,
    },
    fingerprints: {},
    resolutionCandidates: [{ strategy: 'runtime-node', value: 'live', confidence: 0.9 }],
    selector: '[id="submit-button"]',
    ...overrides,
  };
}

function makeSelection(
  resolutionStatus: 'resolved' | 'ambiguous' | 'stale' | 'missing' = 'resolved',
  targetOverrides: Partial<VisualSelectionTarget> = {},
): VisualSelection {
  return {
    schemaVersion: 1,
    selectionId: 'selection_1',
    sessionId: 'session_1',
    pageId: 'page_1',
    mode: 'single',
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z',
    page: {
      url: 'http://localhost:3000/',
      title: 'Fixture App',
      viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
    },
    region: { viewportRect: { x: 10, y: 20, width: 100, height: 50 } },
    targets: [makeTarget(targetOverrides)],
    summary: { label: 'Submit', role: 'button', textPreview: 'Submit', targetCount: 1 },
    resolution: {
      status: resolutionStatus,
      confidence: resolutionStatus === 'resolved' ? 0.9 : 0.3,
      resolvedAt: '2026-08-05T00:00:00.000Z',
    },
  };
}

function makePacket(packetId = 'packet_1'): ContextPacket {
  return {
    packetId,
    sourceHints: [],
    runtimeEvidence: {},
    metadata: { redactions: [] },
  } as unknown as ContextPacket;
}

class FakeSelectionController implements SelectionController {
  selection: VisualSelection | null = null;
  modeActive = false;
  enterError: ViskodError | null = null;

  async enterSelectionMode(): Promise<Result<void>> {
    if (this.enterError) return err(this.enterError);
    this.modeActive = true;
    return ok(undefined);
  }

  async getActiveSelection(): Promise<Result<VisualSelection | null>> {
    return ok(this.selection);
  }

  async clearSelection(): Promise<Result<void>> {
    this.selection = null;
    return ok(undefined);
  }

  isActive(): boolean {
    return this.modeActive;
  }
}

class FakeCaptureEngine implements WorkflowCaptureEngine {
  fail = false;
  lastSelection: SelectionTarget | null = null;

  async generatePacket(selection?: SelectionTarget): Promise<Result<ContextPacket>> {
    this.lastSelection = selection ?? null;
    if (this.fail) return err(makeError('VCE_TEST_FAIL', 'capture failed'));
    return ok(makePacket());
  }
}

class FakeIssueService implements IssueService {
  issues: VisualIssue[] = [];
  failCreate = false;

  async createIssue(
    selection: VisualSelection,
    _sessionId: string,
    _pageId: string,
    title?: string,
    description?: string,
    severity?: 'low' | 'medium' | 'high' | 'critical',
  ): Promise<Result<VisualIssue>> {
    if (this.failCreate) return err(makeError('PERSISTENCE_WRITE_FAILED', 'write failed'));
    const issue = {
      schemaVersion: 1,
      issueId: 'issue_1',
      sessionId: _sessionId,
      pageId: _pageId,
      createdAt: '2026-08-05T00:00:00.000Z',
      updatedAt: '2026-08-05T00:00:00.000Z',
      status: 'open',
      severity: severity ?? 'medium',
      title: title ?? 'Untitled',
      description,
      source: {
        createdFrom: 'visual-selection',
        selectionId: selection.selectionId,
        selectionSnapshot: JSON.parse(JSON.stringify(selection)),
      },
      page: {
        url: selection.page.url,
        title: selection.page.title,
        viewport: {
          width: selection.page.viewport.width,
          height: selection.page.viewport.height,
        },
      },
      targetSummary: {
        mode: selection.mode,
        label: selection.summary.label,
        role: selection.summary.role,
        textPreview: selection.summary.textPreview,
        targetCount: selection.summary.targetCount,
        confidence: selection.resolution.confidence,
        resolutionStatus: selection.resolution.status,
      },
      tags: [],
      lifecycle: [],
      redaction: { applied: false, rules: [], strippedFields: [], warnings: [] },
    } as VisualIssue;
    this.issues.push(issue);
    return ok(issue);
  }

  async getIssue(issueId: string): Promise<Result<VisualIssue>> {
    const issue = this.issues.find((i) => i.issueId === issueId);
    if (!issue) return err(makeError('ISSUE_NOT_FOUND', 'not found'));
    return ok(issue);
  }

  async updateIssue(issueId: string, updates: IssueUpdate): Promise<Result<VisualIssue>> {
    const issue = this.issues.find((i) => i.issueId === issueId);
    if (!issue) return err(makeError('ISSUE_NOT_FOUND', 'not found'));
    const updated = { ...issue, ...updates };
    this.issues = this.issues.map((i) => (i.issueId === issueId ? updated : i));
    return ok(updated);
  }

  async listIssues(): Promise<Result<VisualIssue[]>> {
    return ok([...this.issues]);
  }

  async archiveIssue(issueId: string): Promise<Result<VisualIssue>> {
    return this.updateIssue(issueId, { status: 'archived' });
  }

  async reopenIssue(issueId: string): Promise<Result<VisualIssue>> {
    return this.updateIssue(issueId, { status: 'open' });
  }

  async deleteIssue(issueId: string): Promise<Result<VisualIssue>> {
    return this.updateIssue(issueId, { status: 'archived' });
  }

  async health() {
    return { status: 'healthy' as const, totalIssues: this.issues.length, issuesByStatus: {} };
  }
}

class FakeHandoffService implements HandoffService {
  warningCount = 0;
  fail = false;
  created: AgentHandoffCreateOutput | null = null;
  stored: AgentHandoff | null = null;

  async createHandoff(
    input: AgentHandoffCreateInput,
    _sessionId: string,
    _pageId: string,
  ): Promise<Result<AgentHandoffCreateOutput>> {
    if (this.fail) return err(makeError('PERSISTENCE_WRITE_FAILED', 'handoff write failed'));
    this.created = {
      handoffId: 'handoff_1',
      issueId: input.issueId,
      status: 'ready',
      title: 'Broken layout',
      summary: 'Summary',
      warningCount: this.warningCount,
    };
    this.stored = this.buildHandoff(input.issueId);
    return ok(this.created);
  }

  private buildHandoff(issueId: string): AgentHandoff {
    return {
      schemaVersion: 1,
      handoffId: 'handoff_1',
      issueId,
      sessionId: 'session_1',
      pageId: 'page_1',
      createdAt: '2026-08-05T00:00:00.000Z',
      updatedAt: '2026-08-05T00:00:00.000Z',
      status: 'ready',
      brief: {
        title: 'Broken layout',
        summary: 'Summary',
        issue: { status: 'open', severity: 'medium', tags: [] },
        page: { title: 'Fixture App', route: '/', url: 'http://localhost:3000/' },
        selectedTarget: {
          mode: 'single',
          label: 'Submit',
          targetCount: 1,
          confidence: 0.9,
          resolutionStatus: 'resolved',
        },
        task: { objective: 'o', expectedOutput: 'e', nonGoals: [] },
      },
      context: {
        contextId: 'ctx_1',
        issueRef: { issueId },
        packetRefs: [],
        selectionRef: { selectionId: 'selection_1', snapshotIncluded: false },
        evidenceSummary: {
          hasSelection: true,
          hasSourceHints: false,
          hasContextPacket: false,
        },
      },
      constraints: {
        localFirst: true,
        noRawPacketPaths: true,
        noRawJson: true,
        noSecrets: true,
        noAutonomousBrowserActions: true,
        requiresHumanReview: true,
        phaseBoundary: 'handoff-only',
      },
      lifecycle: [],
      redaction: { applied: false, rules: [], strippedFields: [], warnings: [] },
    };
  }

  async getHandoff(_handoffId: string): Promise<Result<AgentHandoffGetOutput>> {
    if (!this.stored) return err(makeError('HANDOFF_NOT_FOUND', 'not found'));
    return ok({
      handoffId: this.stored.handoffId,
      issueId: this.stored.issueId,
      status: this.stored.status,
      brief: this.stored.brief,
      context: this.stored.context,
      constraints: this.stored.constraints,
    });
  }

  async listHandoffs(): Promise<Result<AgentHandoffListItem[]>> {
    return ok([]);
  }

  async updateHandoffStatus(
    _handoffId: string,
    status: AgentHandoffStatus,
  ): Promise<Result<AgentHandoff>> {
    if (!this.stored) return err(makeError('HANDOFF_NOT_FOUND', 'not found'));
    this.stored = { ...this.stored, status };
    return ok(this.stored);
  }

  async cancelHandoff(handoffId: string): Promise<Result<AgentHandoff>> {
    return this.updateHandoffStatus(handoffId, 'cancelled');
  }
}

function makeBeforeSnapshot(): ReviewSnapshotRef {
  return {
    snapshotId: 'before_1',
    kind: 'before',
    capturedAt: '2026-08-05T00:00:00.000Z',
    source: { issueId: 'issue_1' },
    page: { url: 'http://localhost:3000/', viewport: { width: 1280, height: 720 } },
    targetSummary: {
      mode: 'single',
      label: 'Submit',
      targetCount: 1,
      confidence: 0.9,
      resolutionStatus: 'resolved',
    },
    visualEvidence: { overlayExcluded: false },
    evidenceSummary: {
      hasSelection: true,
      hasContextPacket: true,
      hasScreenshot: false,
      hasSourceHints: false,
    },
  };
}

class FakeReviewService implements ReviewService {
  failRecapture = false;
  failDecision = false;
  comparisonStatus: 'changed' | 'unchanged' = 'changed';
  lastDecision: VisualReviewDecisionInput | null = null;
  reviews: Array<VisualReview | null> = [];

  async createReview(
    input: VisualReviewCreateInput,
    _sessionId: string,
    _pageId: string,
  ): Promise<Result<VisualReviewCreateOutput>> {
    const review = this.buildReview(input.issueId, input.handoffId);
    this.reviews.push(review);
    return ok({
      reviewId: 'review_1',
      issueId: input.issueId,
      handoffId: input.handoffId,
      status: 'ready',
      warningCount: 0,
    });
  }

  private buildReview(issueId: string, handoffId?: string): VisualReview {
    return {
      schemaVersion: 1,
      reviewId: 'review_1',
      issueId,
      handoffId,
      sessionId: 'session_1',
      pageId: 'page_1',
      createdAt: '2026-08-05T00:00:00.000Z',
      updatedAt: '2026-08-05T00:00:00.000Z',
      status: 'ready',
      before: makeBeforeSnapshot(),
      lifecycle: [],
      redaction: { applied: false, rules: [], strippedFields: [], warnings: [] },
    };
  }

  async getReview(reviewId: string): Promise<Result<VisualReviewGetOutput>> {
    const review = this.reviews.find((r) => r?.reviewId === reviewId);
    if (!review) return err(makeError('REVIEW_NOT_FOUND', 'not found'));
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
    return ok([]);
  }

  async recordDecision(
    reviewId: string,
    input: VisualReviewDecisionInput,
  ): Promise<Result<VisualReview>> {
    if (this.failDecision) return err(makeError('PERSISTENCE_WRITE_FAILED', 'write failed'));
    this.lastDecision = input;
    const review = this.reviews.find((r) => r?.reviewId === reviewId);
    if (!review) return err(makeError('REVIEW_NOT_FOUND', 'not found'));
    const updated: VisualReview = {
      ...review,
      status:
        input.decision === 'accepted'
          ? 'accepted'
          : input.decision === 'rejected'
            ? 'rejected'
            : 'needs_follow_up',
      decision: {
        decision: input.decision,
        decidedAt: '2026-08-05T00:00:01.000Z',
        note: input.note,
        actor: 'local-user',
      },
    };
    this.reviews = this.reviews.map((r) => (r?.reviewId === reviewId ? updated : r));
    return ok(updated);
  }

  async cancelReview(reviewId: string): Promise<Result<VisualReview>> {
    const review = this.reviews.find((r) => r?.reviewId === reviewId);
    if (!review) return err(makeError('REVIEW_NOT_FOUND', 'not found'));
    return ok({ ...review, status: 'cancelled' });
  }

  async setAfterSnapshot(reviewId: string): Promise<Result<VisualReview>> {
    const review = this.reviews.find((r) => r?.reviewId === reviewId);
    if (!review) return err(makeError('REVIEW_NOT_FOUND', 'not found'));
    return ok(review);
  }

  async recaptureReview(input: VisualReviewRecaptureInput): Promise<Result<VisualReview>> {
    if (this.failRecapture) return err(makeError('RECAPTURE_FAILED', 'recapture null'));
    const review = this.reviews.find((r) => r?.reviewId === input.reviewId);
    if (!review) return err(makeError('REVIEW_NOT_FOUND', 'not found'));
    const updated: VisualReview = {
      ...review,
      status: 'ready',
      after: {
        ...makeBeforeSnapshot(),
        snapshotId: 'after_1',
        kind: 'after',
        capturedAt: '2026-08-05T00:00:02.000Z',
        source: { recapturePacketId: 'packet_2' },
      },
      comparison: {
        status: this.comparisonStatus,
        confidence: 0.95,
        summary: 'The rendered result changed; review whether it matches the expected result.',
        target: {
          beforeStatus: 'resolved',
          afterStatus: 'resolved',
          sameTargetLikely: true,
          warnings: [],
        },
        warnings: [],
      },
    };
    this.reviews = this.reviews.map((r) => (r?.reviewId === input.reviewId ? updated : r));
    return ok(updated);
  }

  reviewExists(reviewId: string): boolean {
    return this.reviews.some((r) => r?.reviewId === reviewId);
  }
}

interface WorkflowHarness {
  workflow: StudioWorkflow;
  controller: FakeSelectionController;
  capture: FakeCaptureEngine;
  issues: FakeIssueService;
  handoffs: FakeHandoffService;
  reviews: FakeReviewService;
  eventBus: EventBus;
}

function makeHarness(): WorkflowHarness {
  const eventBus = new RealEventBus();
  const controller = new FakeSelectionController();
  const capture = new FakeCaptureEngine();
  const issues = new FakeIssueService();
  const handoffs = new FakeHandoffService();
  const reviews = new FakeReviewService();

  const userFacingHandoff = new UserFacingHandoff(handoffs);
  const userFacingReview = new UserFacingReview(reviews);

  const workflow = new StudioWorkflow({
    pageId: 'page_1',
    sessionId: 'session_1',
    controller,
    vce: capture,
    issueService: issues,
    userFacingHandoff,
    userFacingReview,
    reviewService: reviews,
  });

  return { workflow, controller, capture, issues, handoffs, reviews, eventBus };
}

async function reachDescribe(harness: WorkflowHarness): Promise<void> {
  await harness.workflow.beginReport();
  harness.controller.selection = makeSelection();
  await harness.workflow.acceptSelection();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StudioWorkflow', () => {
  it('beginReport enters selection mode and moves to selecting', async () => {
    const h = makeHarness();
    const result = await h.workflow.beginReport();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stage).toBe('selecting');
      expect(result.value.error).toBeUndefined();
    }
    expect(h.controller.isActive()).toBe(true);
  });

  it('beginReport surfaces a recovery message when selection mode cannot start', async () => {
    const h = makeHarness();
    h.controller.enterError = makeError('OVERLAY_INJECTION_FAILED', 'injection failed');
    const result = await h.workflow.beginReport();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Selection mode could not be started');
    }
  });

  it('acceptSelection rejects when there is no active selection', async () => {
    const h = makeHarness();
    await h.workflow.beginReport();
    h.controller.selection = null;
    const result = await h.workflow.acceptSelection();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Select the element again.');
    }
  });

  it('acceptSelection rejects stale and ambiguous selections with recovery text', async () => {
    const cases: Array<{ status: 'stale' | 'ambiguous'; message: string }> = [
      { status: 'stale', message: 'Refresh the page and select it again.' },
      { status: 'ambiguous', message: 'Select the element again.' },
    ];
    for (const { status, message } of cases) {
      const h = makeHarness();
      await h.workflow.beginReport();
      h.controller.selection = makeSelection(status);
      const result = await h.workflow.acceptSelection();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe(message);
      }
      expect(h.capture.lastSelection).toBeNull();
    }
  });

  it('acceptSelection rejects a target without a safe selector', async () => {
    const h = makeHarness();
    await h.workflow.beginReport();
    h.controller.selection = makeSelection('resolved', { selector: undefined });
    const result = await h.workflow.acceptSelection();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('cannot be safely re-captured');
    }
  });

  it('acceptSelection keeps the stage and reports recovery when capture fails', async () => {
    const h = makeHarness();
    await h.workflow.beginReport();
    h.controller.selection = makeSelection();
    h.capture.fail = true;
    const result = await h.workflow.acceptSelection();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Refresh the page and select it again.');
    }
  });

  it('acceptSelection captures through VCE and moves to describe', async () => {
    const h = makeHarness();
    await h.workflow.beginReport();
    h.controller.selection = makeSelection();
    const result = await h.workflow.acceptSelection();
    expect(result.ok).toBe(true);
    expect(h.capture.lastSelection?.selector).toBe('[id="submit-button"]');
    if (result.ok) {
      expect(result.value.stage).toBe('describe');
      expect(result.value.selection?.label).toBe('Submit');
      expect(result.value.pageUrl).toBe('http://localhost:3000/');
      expect(JSON.stringify(result.value)).not.toContain('selector');
    }
  });

  it('createIssue rejects when problem or expected is missing', async () => {
    const h = makeHarness();
    await reachDescribe(h);
    const result = await h.workflow.createIssue({ problem: '', expected: 'It should work' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('required');
    }
    expect(h.issues.issues).toHaveLength(0);
  });

  it('createIssue persists the exact Problem/Expected result description', async () => {
    const h = makeHarness();
    await reachDescribe(h);
    const result = await h.workflow.createIssue({
      problem: 'The submit button is misaligned',
      expected: 'It should align with the card edge',
      severity: 'high',
    });
    expect(result.ok).toBe(true);
    expect(h.issues.issues).toHaveLength(1);
    expect(h.issues.issues[0]?.description).toBe(
      'Problem:\nThe submit button is misaligned\n\nExpected result:\nIt should align with the card edge',
    );
    if (result.ok) {
      expect(result.value.stage).toBe('describe');
      expect(result.value.issueId).toBe('issue_1');
      expect(h.issues.issues[0]?.severity).toBe('high');
    }
  });

  it('createIssue without an active selection stays at the current stage', async () => {
    const h = makeHarness();
    const result = await h.workflow.createIssue({
      problem: 'Broken',
      expected: 'Fixed',
    });
    expect(result.ok).toBe(false);
    expect(h.issues.issues).toHaveLength(0);
  });

  it('prepareAgent creates a handoff and moves to handoff_ready', async () => {
    const h = makeHarness();
    await reachDescribe(h);
    await h.workflow.createIssue({ problem: 'Broken layout', expected: 'Fixed layout' });
    const result = await h.workflow.prepareAgent();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stage).toBe('handoff_ready');
      expect(result.value.handoffId).toBe('handoff_1');
      expect(result.value.handoff?.whatAgentReceives.length).toBeGreaterThan(0);
    }
  });

  it('prepareAgent propagates handoff warnings to the user-facing state', async () => {
    const h = makeHarness();
    await reachDescribe(h);
    await h.workflow.createIssue({ problem: 'Broken layout', expected: 'Fixed layout' });
    h.handoffs.warningCount = 1;
    const result = await h.workflow.prepareAgent();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stage).toBe('handoff_ready');
      expect(result.value.error).toContain('warnings');
    }
  });

  it('prepareAgent without an issue stays at the current stage', async () => {
    const h = makeHarness();
    await reachDescribe(h);
    const result = await h.workflow.prepareAgent();
    expect(result.ok).toBe(false);
  });

  it('startVerification creates the review and moves to verifying', async () => {
    const h = makeHarness();
    await reachDescribe(h);
    await h.workflow.createIssue({ problem: 'Broken', expected: 'Fixed' });
    await h.workflow.prepareAgent();
    const result = await h.workflow.startVerification();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stage).toBe('verifying');
      expect(result.value.reviewId).toBe('review_1');
    }
  });

  it('recaptureVerification recovers on recapture failure', async () => {
    const h = makeHarness();
    await reachDescribe(h);
    await h.workflow.createIssue({ problem: 'Broken', expected: 'Fixed' });
    await h.workflow.prepareAgent();
    await h.workflow.startVerification();
    h.reviews.failRecapture = true;
    const result = await h.workflow.recaptureVerification();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('could not be re-captured');
    }
  });

  it('recaptureVerification exposes changed comparison status without auto-accepting', async () => {
    const h = makeHarness();
    await reachDescribe(h);
    await h.workflow.createIssue({ problem: 'Broken', expected: 'Fixed' });
    await h.workflow.prepareAgent();
    await h.workflow.startVerification();
    const result = await h.workflow.recaptureVerification();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stage).toBe('review_ready');
      expect(result.value.review?.comparison?.status).toBe('changed');
      expect(result.value.stage).not.toBe('decided');
    }
  });

  it('recaptureVerification exposes unchanged comparison status', async () => {
    const h = makeHarness();
    await reachDescribe(h);
    await h.workflow.createIssue({ problem: 'Broken', expected: 'Fixed' });
    await h.workflow.prepareAgent();
    await h.workflow.startVerification();
    h.reviews.comparisonStatus = 'unchanged';
    const result = await h.workflow.recaptureVerification();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.review?.comparison?.status).toBe('unchanged');
    }
  });

  it('decide records all three human decisions and moves to decided', async () => {
    for (const decision of ['accepted', 'rejected', 'needs_follow_up'] as const) {
      const h = makeHarness();
      await reachDescribe(h);
      await h.workflow.createIssue({ problem: 'Broken', expected: 'Fixed' });
      await h.workflow.prepareAgent();
      await h.workflow.startVerification();
      await h.workflow.recaptureVerification();
      const result = await h.workflow.decide(decision, 'note text');
      expect(result.ok).toBe(true);
      expect(h.reviews.lastDecision?.decision).toBe(decision);
      expect(h.reviews.lastDecision?.note).toBe('note text');
      if (result.ok) {
        expect(result.value.stage).toBe('decided');
      }
    }
  });

  it('decide surfaces an error when recording fails', async () => {
    const h = makeHarness();
    await reachDescribe(h);
    await h.workflow.createIssue({ problem: 'Broken', expected: 'Fixed' });
    await h.workflow.prepareAgent();
    await h.workflow.startVerification();
    h.reviews.failDecision = true;
    const result = await h.workflow.decide('accepted');
    expect(result.ok).toBe(false);
  });

  it('state never exposes selectors, packet JSON, or paths', async () => {
    const h = makeHarness();
    await reachDescribe(h);
    await h.workflow.createIssue({ problem: 'Broken layout', expected: 'Fixed layout' });
    await h.workflow.prepareAgent();
    await h.workflow.startVerification();
    await h.workflow.recaptureVerification();
    const serialized = JSON.stringify(h.workflow.getState());
    expect(serialized).not.toContain('selector');
    expect(serialized).not.toContain('packetId');
    expect(serialized).not.toContain('captureDir');
    expect(serialized).not.toContain('sessionToken');
  });
});
