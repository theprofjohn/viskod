import type { ReviewService } from './service';
import type {
  VisualReviewStatus,
  VisualReviewListItem,
  VisualReviewGetOutput,
  VisualReview,
} from './types';

export interface ReviewPreview {
  reviewId: string;
  issueId: string;
  handoffId?: string;
  status: VisualReviewStatus;
  before: {
    targetSummary: {
      mode: 'single' | 'box';
      label?: string;
      role?: string;
      textPreview?: string;
      targetCount: number;
      confidence: number;
      resolutionStatus: string;
    };
    page: { url?: string; title?: string; route?: string };
    capturedAt: string;
  };
  after?: {
    targetSummary: {
      mode: 'single' | 'box';
      label?: string;
      role?: string;
      textPreview?: string;
      targetCount: number;
      confidence: number;
      resolutionStatus: string;
    };
    page: { url?: string; title?: string; route?: string };
    capturedAt: string;
  };
  comparison?: {
    status: string;
    confidence: number;
    summary: string;
    warnings: string[];
  };
  decision?: {
    decision: string;
    decidedAt: string;
    note?: string;
  };
  warnings: string[];
}

export interface ReviewConfirmation {
  reviewId: string;
  message: string;
  nextSteps: string[];
}

export class UserFacingReview {
  private reviewService: ReviewService;

  constructor(reviewService: ReviewService) {
    this.reviewService = reviewService;
  }

  async startReview(
    issueId: string,
    sessionId: string,
    pageId: string,
    handoffId?: string,
  ): Promise<{ ok: boolean; reviewId?: string; status?: string; warningCount?: number; error?: string }> {
    const result = await this.reviewService.createReview(
      { issueId, handoffId },
      sessionId,
      pageId,
    );

    if (!result.ok) {
      return {
        ok: false,
        error: this.userFacingError(result.error.code),
      };
    }

    return {
      ok: true,
      reviewId: result.value.reviewId,
      status: result.value.status,
      warningCount: result.value.warningCount,
    };
  }

  async getPreview(reviewId: string): Promise<ReviewPreview | null> {
    const result = await this.reviewService.getReview(reviewId);
    if (!result.ok) return null;

    const review = result.value;
    const warnings: string[] = [];

    if (review.before?.targetSummary.resolutionStatus === 'stale') {
      warnings.push('The before snapshot may be stale.');
    }
    if (review.before?.targetSummary.resolutionStatus === 'ambiguous') {
      warnings.push('The before target is ambiguous.');
    }
    if (review.comparison?.warnings) {
      warnings.push(...review.comparison.warnings);
    }

    return {
      reviewId: review.reviewId,
      issueId: review.issueId,
      handoffId: review.handoffId,
      status: review.status,
      before: {
        targetSummary: review.before.targetSummary,
        page: review.before.page,
        capturedAt: review.before.capturedAt,
      },
      after: review.after ? {
        targetSummary: review.after.targetSummary,
        page: review.after.page,
        capturedAt: review.after.capturedAt,
      } : undefined,
      comparison: review.comparison ? {
        status: review.comparison.status,
        confidence: review.comparison.confidence,
        summary: review.comparison.summary,
        warnings: review.comparison.warnings,
      } : undefined,
      decision: review.decision ? {
        decision: review.decision.decision,
        decidedAt: review.decision.decidedAt,
        note: review.decision.note,
      } : undefined,
      warnings,
    };
  }

  async acceptReview(reviewId: string, note?: string): Promise<boolean> {
    const result = await this.reviewService.recordDecision(reviewId, {
      decision: 'accepted',
      note,
    });
    return result.ok;
  }

  async rejectReview(reviewId: string, note?: string): Promise<boolean> {
    const result = await this.reviewService.recordDecision(reviewId, {
      decision: 'rejected',
      note,
    });
    return result.ok;
  }

  async needsFollowUp(reviewId: string, note?: string): Promise<boolean> {
    const result = await this.reviewService.recordDecision(reviewId, {
      decision: 'needs_follow_up',
      note,
    });
    return result.ok;
  }

  async recaptureAgain(reviewId: string): Promise<boolean> {
    const result = await this.reviewService.cancelReview(reviewId);
    return result.ok;
  }

  formatConfirmation(reviewId: string, decision: string): ReviewConfirmation {
    const messages: Record<string, string> = {
      accepted: 'Review accepted — the issue appears to be addressed.',
      rejected: 'Review rejected — the issue persists.',
      needs_follow_up: 'Review marked as needing follow-up.',
    };

    return {
      reviewId,
      message: messages[decision] ?? `Review ${decision}.`,
      nextSteps: this.getNextStepsForDecision(decision),
    };
  }

  async listReviews(): Promise<VisualReviewListItem[]> {
    const result = await this.reviewService.listReviews();
    return result.ok ? result.value : [];
  }

  private getNextStepsForDecision(decision: string): string[] {
    switch (decision) {
      case 'accepted':
        return [
          'The issue can be closed.',
          'Consider archiving the linked VisualIssue.',
        ];
      case 'rejected':
        return [
          'The issue persists. Consider sending to an agent again.',
          'Check if the target element changed.',
        ];
      case 'needs_follow_up':
        return [
          'Investigate further before deciding.',
          'Consider recapturing after additional changes.',
        ];
      default:
        return ['Review the evidence to determine next steps.'];
    }
  }

  private userFacingError(code: string): string {
    const errors: Record<string, string> = {
      'ISSUE_NOT_FOUND': 'This issue was not found.',
      'ISSUE_DELETED': 'This issue has been deleted.',
      'ISSUE_STALE': 'The issue context is stale. Create a fresh capture first.',
      'REVIEW_NOT_FOUND': 'Review not found.',
      'INVALID_REVIEW_TRANSITION': 'Cannot perform that action on this review.',
      'ALREADY_DECIDED': 'This review has already been decided.',
      'BEFORE_SNAPSHOT_UNAVAILABLE': 'The before snapshot is not available.',
    };
    return errors[code] ?? 'An unexpected error occurred.';
  }
}
