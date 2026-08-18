import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventBus } from '@viskod/event-bus';
import { IssuePersistence, IssueServiceImpl } from '@viskod/visual-issue';
import type { VisualSelection } from '@viskod/visual-selection';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReviewPersistence, ReviewServiceImpl, UserFacingReview } from './index';
import type { ReviewSnapshotRef } from './types';

const TEST_DIR = path.join(process.cwd(), '.viskod-test-visual-review-ux');
const ISSUE_STORAGE = path.join(TEST_DIR, 'issues');
const REVIEW_STORAGE = path.join(TEST_DIR, 'reviews');
const TEST_SESSION_ID = 'ux-test-session';
const TEST_PAGE_ID = 'ux-test-page';

function makeSelection(): VisualSelection {
  return {
    schemaVersion: 1,
    selectionId: 'sel_ux_001',
    sessionId: TEST_SESSION_ID,
    pageId: TEST_PAGE_ID,
    mode: 'single',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    page: {
      url: 'http://localhost:5173/settings',
      title: 'Settings',
      viewport: { width: 1440, height: 900, scrollX: 0, scrollY: 0 },
    },
    region: { viewportRect: { x: 100, y: 200, width: 120, height: 40 } },
    targets: [
      {
        targetId: 'tgt_ux',
        documentOrder: 0,
        geometry: { viewportRect: { x: 100, y: 200, width: 120, height: 40 } },
        semantics: {
          tagName: 'button',
          role: 'button',
          accessibleName: 'Save',
          textPreview: 'Save changes',
          isInteractive: true,
        },
        fingerprints: {},
        resolutionCandidates: [{ strategy: 'runtime-node', value: 'live', confidence: 0.9 }],
      },
    ],
    summary: { label: 'Save changes', role: 'button', textPreview: 'Save changes', targetCount: 1 },
    resolution: { status: 'resolved', confidence: 0.9, resolvedAt: new Date().toISOString() },
  };
}

function makeAfterSnapshot(): ReviewSnapshotRef {
  return {
    snapshotId: 'snap_ux_after',
    kind: 'after',
    capturedAt: new Date().toISOString(),
    source: { issueId: 'ux-issue' },
    page: {
      url: 'http://localhost:5173/settings',
      title: 'Settings',
      viewport: { width: 1440, height: 900 },
    },
    targetSummary: {
      mode: 'single',
      label: 'Save changes',
      role: 'button',
      textPreview: 'Save changes',
      targetCount: 1,
      confidence: 0.9,
      resolutionStatus: 'resolved',
    },
    evidenceSummary: {
      hasSelection: true,
      hasContextPacket: false,
      hasScreenshot: false,
      hasSourceHints: false,
    },
  };
}

let eventBus: EventBus;
let issueService: IssueServiceImpl;
let reviewService: ReviewServiceImpl;
let ux: UserFacingReview;
let testIssueId: string;

beforeAll(async () => {
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {}
  fs.mkdirSync(ISSUE_STORAGE, { recursive: true });
  fs.mkdirSync(REVIEW_STORAGE, { recursive: true });

  eventBus = new EventBus();
  const issuePersistence = new IssuePersistence(ISSUE_STORAGE);
  issueService = new IssueServiceImpl(eventBus, issuePersistence);
  const reviewPersistence = new ReviewPersistence(REVIEW_STORAGE);
  reviewService = new ReviewServiceImpl(eventBus, issueService, undefined, reviewPersistence);
  ux = new UserFacingReview(reviewService);

  const result = await issueService.createIssue(
    makeSelection(),
    TEST_SESSION_ID,
    TEST_PAGE_ID,
    'UX test issue',
  );
  if (result.ok) testIssueId = result.value.issueId;
});

afterAll(() => {
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {}
});

describe('User Flow: Issue → Review fix → Decision', () => {
  it('full flow: start review → preview → accept', async () => {
    const start = await ux.startReview(testIssueId, TEST_SESSION_ID, TEST_PAGE_ID);
    expect(start.ok).toBe(true);
    expect(start.reviewId).toMatch(/^review_/);
    expect(start.status).toBe('ready');

    const reviewId = start.reviewId;
    expect(reviewId).toBeTruthy();
    if (!reviewId) return;

    const preview = await ux.getPreview(reviewId);
    expect(preview).not.toBeNull();
    expect(preview?.reviewId).toBe(reviewId);
    expect(preview?.before.targetSummary.label).toBe('Save changes');
    expect(preview?.status).toBe('ready');

    const accepted = await ux.acceptReview(reviewId);
    expect(accepted).toBe(true);

    const afterDecision = await ux.getPreview(reviewId);
    expect(afterDecision?.status).toBe('accepted');
    expect(afterDecision?.decision).toBeDefined();
    expect(afterDecision?.decision?.decision).toBe('accepted');
  });

  it('full flow: start review → set after → reject', async () => {
    const start = await ux.startReview(testIssueId, TEST_SESSION_ID, TEST_PAGE_ID);
    if (!start.ok || !start.reviewId) return;

    await reviewService.setAfterSnapshot(start.reviewId, makeAfterSnapshot());

    const rejected = await ux.rejectReview(start.reviewId, 'Still broken');
    expect(rejected).toBe(true);

    const afterDecision = await ux.getPreview(start.reviewId);
    expect(afterDecision?.status).toBe('rejected');
    expect(afterDecision?.decision?.note).toBe('Still broken');
  });

  it('full flow: start review → needs follow-up with note', async () => {
    const start = await ux.startReview(testIssueId, TEST_SESSION_ID, TEST_PAGE_ID);
    if (!start.ok || !start.reviewId) return;

    const followedUp = await ux.needsFollowUp(start.reviewId, 'Partial fix, needs more work');
    expect(followedUp).toBe(true);

    const afterDecision = await ux.getPreview(start.reviewId);
    expect(afterDecision?.status).toBe('needs_follow_up');
    expect(afterDecision?.decision?.note).toBe('Partial fix, needs more work');
  });
});

describe('Preview safety', () => {
  it('no packet paths in preview', async () => {
    const start = await ux.startReview(testIssueId, TEST_SESSION_ID, TEST_PAGE_ID);
    if (!start.ok || !start.reviewId) return;

    const preview = await ux.getPreview(start.reviewId);
    expect(preview).not.toBeNull();

    const json = JSON.stringify(preview);
    expect(json).not.toContain('.viskod');
    expect(json).not.toContain('captures/');
    expect(json).not.toContain('C:\\');
    expect(json).not.toContain('/home/');
  });

  it('no raw JSON in preview', async () => {
    const start = await ux.startReview(testIssueId, TEST_SESSION_ID, TEST_PAGE_ID);
    if (!start.ok || !start.reviewId) return;

    const preview = await ux.getPreview(start.reviewId);
    const json = JSON.stringify(preview);
    expect(json).not.toContain('selectionSnapshot');
    expect(json).not.toContain('packet.json');
  });

  it('no selectors in preview', async () => {
    const start = await ux.startReview(testIssueId, TEST_SESSION_ID, TEST_PAGE_ID);
    if (!start.ok || !start.reviewId) return;

    const preview = await ux.getPreview(start.reviewId);
    const json = JSON.stringify(preview);
    expect(json).not.toContain('data-testid');
    expect(json).not.toMatch(/querySelector/);
  });
});

describe('Confirmation format', () => {
  it('accept confirmation shows correct message', () => {
    const confirmation = ux.formatConfirmation('review_test123', 'accepted');
    expect(confirmation.reviewId).toBe('review_test123');
    expect(confirmation.message).toContain('accepted');
    expect(confirmation.nextSteps.length).toBeGreaterThan(0);
  });

  it('reject confirmation shows correct message', () => {
    const confirmation = ux.formatConfirmation('review_test123', 'rejected');
    expect(confirmation.message).toContain('rejected');
  });
});

describe('List via UX', () => {
  it('lists reviews', async () => {
    const list = await ux.listReviews();
    expect(list.length).toBeGreaterThan(0);
  });
});

describe('Error handling', () => {
  it('returns user-friendly error for missing issue', async () => {
    const start = await ux.startReview('nonexistent', TEST_SESSION_ID, TEST_PAGE_ID);
    expect(start.ok).toBe(false);
    expect(start.error).toBeTruthy();
    expect(start.error).not.toContain('stack');
    expect(start.error).not.toContain('.viskod');
  });
});

describe('No manual packet path inspection', () => {
  it('full flow uses only opaque IDs', async () => {
    const start = await ux.startReview(testIssueId, TEST_SESSION_ID, TEST_PAGE_ID);
    if (!start.ok || !start.reviewId) return;

    expect(start.reviewId).not.toContain('\\');
    expect(start.reviewId).not.toContain('/');
    expect(start.reviewId).not.toContain('.viskod');

    const preview = await ux.getPreview(start.reviewId);
    expect(preview).not.toBeNull();
    const json = JSON.stringify(preview);
    expect(json).not.toContain('.viskod');
    expect(json).not.toContain('captures');
  });
});
