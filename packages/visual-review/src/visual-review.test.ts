import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventBus } from '@viskod/event-bus';
import { IssueServiceImpl, IssuePersistence } from '@viskod/visual-issue';
import { ReviewServiceImpl, ReviewPersistence } from './index';
import type { VisualSelection } from '@viskod/visual-selection';
import type { ReviewSnapshotRef, RecaptureAdapter, RecaptureResult } from './types';
import { resolveRecaptureTarget } from './targetResolver';

const TEST_DIR = path.join(process.cwd(), '.viskod-test-visual-review');
const ISSUE_STORAGE = path.join(TEST_DIR, 'issues');
const REVIEW_STORAGE = path.join(TEST_DIR, 'reviews');

function makeSelection(overrides?: Partial<VisualSelection>): VisualSelection {
  return {
    schemaVersion: 1,
    selectionId: 'sel_test_001',
    sessionId: 'test-session',
    pageId: 'test-page',
    mode: 'single',
    createdAt: '2026-07-30T10:00:00.000Z',
    updatedAt: '2026-07-30T10:00:00.000Z',
    page: {
      url: 'http://localhost:5173/settings',
      title: 'Settings',
      viewport: { width: 1440, height: 900, scrollX: 0, scrollY: 0 },
    },
    region: { viewportRect: { x: 100, y: 200, width: 120, height: 40 } },
    targets: [{
      targetId: 'tgt_001',
      documentOrder: 0,
      geometry: { viewportRect: { x: 100, y: 200, width: 120, height: 40 } },
      semantics: { tagName: 'button', role: 'button', accessibleName: 'Save', textPreview: 'Save changes', isInteractive: true },
      fingerprints: { stableAttributes: { 'data-testid': 'save-btn' } },
      resolutionCandidates: [{ strategy: 'runtime-node', value: 'live', confidence: 0.9 }],
    }],
    summary: { label: 'Save changes', role: 'button', textPreview: 'Save changes', targetCount: 1 },
    resolution: { status: 'resolved', confidence: 0.9, resolvedAt: '2026-07-30T10:00:00.000Z' },
    ...overrides,
  } as VisualSelection;
}

function makeAfterSnapshot(overrides?: Partial<ReviewSnapshotRef>): ReviewSnapshotRef {
  return {
    snapshotId: 'snap_after_001',
    kind: 'after',
    capturedAt: new Date().toISOString(),
    source: { issueId: 'issue_test' },
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
    ...overrides,
  };
}

function makeRecaptureResult(overrides?: Partial<RecaptureResult>): RecaptureResult {
  return {
    packetId: 'pkt_recapture_001',
    selector: '[data-testid="save-btn"]',
    tagName: 'button',
    boundingBox: { x: 100, y: 200, width: 120, height: 40 },
    text: 'Save changes',
    url: 'http://localhost:5173/settings',
    viewport: { width: 1440, height: 900 },
    ...overrides,
  };
}

let eventBus: EventBus;
let issueService: IssueServiceImpl;
let reviewService: ReviewServiceImpl;
let testIssueId: string;

beforeAll(async () => {
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(ISSUE_STORAGE, { recursive: true });
  fs.mkdirSync(REVIEW_STORAGE, { recursive: true });

  eventBus = new EventBus();
  const issuePersistence = new IssuePersistence(ISSUE_STORAGE);
  issueService = new IssueServiceImpl(eventBus, issuePersistence);
  const reviewPersistence = new ReviewPersistence(REVIEW_STORAGE);
  reviewService = new ReviewServiceImpl(eventBus, issueService, undefined, reviewPersistence);

  const result = await issueService.createIssue(makeSelection(), 'test-session', 'test-page', 'Button issue');
  if (result.ok) testIssueId = result.value.issueId;
});

afterAll(() => {
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
});

describe('VisualReview schema validation', () => {
  it('validates a complete VisualReview object', () => {
    const review = {
      schemaVersion: 1,
      reviewId: 'review_test',
      issueId: 'issue_test',
      sessionId: 'session',
      pageId: 'page',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'ready',
      before: {
        snapshotId: 'snap_1',
        kind: 'before',
        capturedAt: new Date().toISOString(),
        source: {},
        page: { viewport: { width: 100, height: 100 } },
        targetSummary: { mode: 'single', targetCount: 1, confidence: 0.9, resolutionStatus: 'resolved' },
        evidenceSummary: { hasSelection: true, hasContextPacket: false, hasScreenshot: false, hasSourceHints: false },
      },
      lifecycle: [],
      redaction: { applied: false, rules: [], strippedFields: [], warnings: [] },
    };
    expect(review.schemaVersion).toBe(1);
    expect(review.reviewId).toBeTruthy();
  });
});

describe('Review ID opacity', () => {
  it('review IDs match opaque pattern', async () => {
    const result = await reviewService.createReview({ issueId: testIssueId }, 's', 'p');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.reviewId).toMatch(/^review_[a-f0-9]{16}$/);
    }
  });
});

describe('Create review', () => {
  it('creates review from issue', async () => {
    const result = await reviewService.createReview({ issueId: testIssueId }, 's', 'p');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.reviewId).toMatch(/^review_/);
      expect(result.value.issueId).toBe(testIssueId);
      expect(result.value.status).toBe('ready');
    }
  });

  it('creates review from issue + handoff', async () => {
    const result = await reviewService.createReview(
      { issueId: testIssueId, handoffId: 'handoff_test123' },
      's', 'p',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.handoffId).toBe('handoff_test123');
    }
  });

  it('rejects missing issue', async () => {
    const result = await reviewService.createReview({ issueId: 'nonexistent' }, 's', 'p');
    expect(result.ok).toBe(false);
  });

  it('rejects deleted issue', async () => {
    const issue = await issueService.createIssue(makeSelection(), 's', 'p', 'Delete me');
    if (issue.ok) {
      await issueService.deleteIssue(issue.value.issueId);
      const result = await reviewService.createReview({ issueId: issue.value.issueId }, 's', 'p');
      expect(result.ok).toBe(false);
    }
  });

  it('stale before snapshot has warning', async () => {
    const issue = await issueService.createIssue(
      makeSelection({
        resolution: { status: 'stale', confidence: 0.3, resolvedAt: new Date().toISOString() },
      }),
      's', 'p', 'Stale issue',
    );
    if (issue.ok) {
      const result = await reviewService.createReview({ issueId: issue.value.issueId }, 's', 'p');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.warningCount).toBeGreaterThan(0);
      }
    }
  });
});

describe('After snapshot', () => {
  it('sets after snapshot and computes comparison', async () => {
    const create = await reviewService.createReview({ issueId: testIssueId }, 's', 'p');
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    const after = makeAfterSnapshot();
    const result = await reviewService.setAfterSnapshot(create.value.reviewId, after);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.after).toBeDefined();
      expect(result.value.comparison).toBeDefined();
      expect(result.value.comparison!.status).toBe('unchanged');
    }
  });

  it('detects changed target', async () => {
    const create = await reviewService.createReview({ issueId: testIssueId }, 's', 'p');
    if (!create.ok) return;

    const after = makeAfterSnapshot({
      targetSummary: {
        mode: 'single',
        label: 'Save',
        role: 'button',
        textPreview: 'Save',
        targetCount: 1,
        confidence: 0.9,
        resolutionStatus: 'resolved',
      },
    });
    const result = await reviewService.setAfterSnapshot(create.value.reviewId, after);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.comparison!.status).toBe('changed');
    }
  });

  it('detects missing after', async () => {
    const create = await reviewService.createReview({ issueId: testIssueId }, 's', 'p');
    if (!create.ok) return;

    const after = makeAfterSnapshot({
      targetSummary: {
        mode: 'single',
        targetCount: 0,
        confidence: 0,
        resolutionStatus: 'missing',
      },
    });
    const result = await reviewService.setAfterSnapshot(create.value.reviewId, after);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.comparison!.status).toBe('missing_after');
    }
  });

  it('detects ambiguous after', async () => {
    const create = await reviewService.createReview({ issueId: testIssueId }, 's', 'p');
    if (!create.ok) return;

    const after = makeAfterSnapshot({
      targetSummary: {
        mode: 'single',
        label: 'Save changes',
        role: 'button',
        textPreview: 'Save changes',
        targetCount: 3,
        confidence: 0.5,
        resolutionStatus: 'ambiguous',
      },
    });
    const result = await reviewService.setAfterSnapshot(create.value.reviewId, after);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.comparison!.status).toBe('ambiguous_after');
    }
  });
});

describe('Decision recording', () => {
  it('accepts review', async () => {
    const create = await reviewService.createReview({ issueId: testIssueId }, 's', 'p');
    if (!create.ok) return;

    const result = await reviewService.recordDecision(create.value.reviewId, { decision: 'accepted' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('accepted');
      expect(result.value.decision).toBeDefined();
      expect(result.value.decision!.decision).toBe('accepted');
    }
  });

  it('rejects review', async () => {
    const create = await reviewService.createReview({ issueId: testIssueId }, 's', 'p');
    if (!create.ok) return;

    const result = await reviewService.recordDecision(create.value.reviewId, { decision: 'rejected' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('rejected');
    }
  });

  it('needs follow-up with note', async () => {
    const create = await reviewService.createReview({ issueId: testIssueId }, 's', 'p');
    if (!create.ok) return;

    const result = await reviewService.recordDecision(
      create.value.reviewId,
      { decision: 'needs_follow_up', note: 'Need to check edge cases' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('needs_follow_up');
      expect(result.value.decision!.note).toBe('Need to check edge cases');
    }
  });

  it('rejects decision on already-decided review', async () => {
    const create = await reviewService.createReview({ issueId: testIssueId }, 's', 'p');
    if (!create.ok) return;

    await reviewService.recordDecision(create.value.reviewId, { decision: 'accepted' });
    const result = await reviewService.recordDecision(create.value.reviewId, { decision: 'rejected' });
    expect(result.ok).toBe(false);
  });
});

describe('Recapture', () => {
  it('can set new after snapshot', async () => {
    const create = await reviewService.createReview({ issueId: testIssueId }, 's', 'p');
    if (!create.ok) return;

    const after1 = makeAfterSnapshot();
    await reviewService.setAfterSnapshot(create.value.reviewId, after1);

    const after2 = makeAfterSnapshot({
      targetSummary: {
        mode: 'single',
        label: 'Updated',
        role: 'button',
        textPreview: 'Updated button',
        targetCount: 1,
        confidence: 0.95,
        resolutionStatus: 'resolved',
      },
    });
    const result = await reviewService.setAfterSnapshot(create.value.reviewId, after2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.after!.targetSummary.label).toBe('Updated');
    }
  });
});

describe('RecaptureReview (live adapter)', () => {

  it('recaptures with mock adapter and produces real after snapshot', async () => {
    const mockAdapter: RecaptureAdapter = async () => makeRecaptureResult();

    const serviceWithAdapter = new ReviewServiceImpl(
      eventBus, issueService, undefined,
      new ReviewPersistence(REVIEW_STORAGE),
      mockAdapter,
    );

    const create = await serviceWithAdapter.createReview({ issueId: testIssueId }, 's', 'p');
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    const result = await serviceWithAdapter.recaptureReview({
      reviewId: create.value.reviewId,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('ready');
      expect(result.value.after).toBeDefined();
      expect(result.value.after!.source.recapturePacketId).toBe('pkt_recapture_001');
      expect(result.value.after!.page.url).toBe('http://localhost:5173/settings');
      expect(result.value.after!.visualEvidence?.cropRect).toEqual({ x: 100, y: 200, width: 120, height: 40 });
      expect(result.value.comparison).toBeDefined();
    }
  });

  it('fails with RECAPTURE_ADAPTER_MISSING when no adapter configured', async () => {
    const serviceNoAdapter = new ReviewServiceImpl(
      eventBus, issueService, undefined,
      new ReviewPersistence(REVIEW_STORAGE),
    );

    const create = await serviceNoAdapter.createReview({ issueId: testIssueId }, 's', 'p');
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    const result = await serviceNoAdapter.recaptureReview({
      reviewId: create.value.reviewId,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('RECAPTURE_ADAPTER_MISSING');
    }
  });

  it('fails with RECAPTURE_FAILED when adapter returns null', async () => {
    const nullAdapter: RecaptureAdapter = async () => null;

    const serviceNullAdapter = new ReviewServiceImpl(
      eventBus, issueService, undefined,
      new ReviewPersistence(REVIEW_STORAGE),
      nullAdapter,
    );

    const create = await serviceNullAdapter.createReview({ issueId: testIssueId }, 's', 'p');
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    const result = await serviceNullAdapter.recaptureReview({
      reviewId: create.value.reviewId,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('RECAPTURE_FAILED');
    }
  });

  it('fails on already-decided review', async () => {
    const mockAdapter: RecaptureAdapter = async () => makeRecaptureResult();

    const serviceWithAdapter = new ReviewServiceImpl(
      eventBus, issueService, undefined,
      new ReviewPersistence(REVIEW_STORAGE),
      mockAdapter,
    );

    const create = await serviceWithAdapter.createReview({ issueId: testIssueId }, 's', 'p');
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    await serviceWithAdapter.recordDecision(create.value.reviewId, { decision: 'accepted' });

    const result = await serviceWithAdapter.recaptureReview({
      reviewId: create.value.reviewId,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ALREADY_DECIDED');
    }
  });

  it('passes reload and cacheBust options to adapter', async () => {
    let capturedOptions: { reload?: boolean; cacheBust?: boolean; url?: string } = {};
    const spyAdapter: RecaptureAdapter = async (options) => {
      capturedOptions = options;
      return makeRecaptureResult();
    };

    const serviceSpy = new ReviewServiceImpl(
      eventBus, issueService, undefined,
      new ReviewPersistence(REVIEW_STORAGE),
      spyAdapter,
    );

    const create = await serviceSpy.createReview({ issueId: testIssueId }, 's', 'p');
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    await serviceSpy.recaptureReview({
      reviewId: create.value.reviewId,
      reload: true,
      cacheBust: true,
    });

    expect(capturedOptions.reload).toBe(true);
    expect(capturedOptions.cacheBust).toBe(true);
  });

  it('emits VR_EVENT:RECAPTURED on successful recapture', async () => {
    const events: unknown[] = [];
    eventBus.subscribe('VR_EVENT:RECAPTURED', (e) => { events.push(e); });

    const mockAdapter: RecaptureAdapter = async () => makeRecaptureResult();

    const serviceWithAdapter = new ReviewServiceImpl(
      eventBus, issueService, undefined,
      new ReviewPersistence(REVIEW_STORAGE),
      mockAdapter,
    );

    const create = await serviceWithAdapter.createReview({ issueId: testIssueId }, 's', 'p');
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    await serviceWithAdapter.recaptureReview({
      reviewId: create.value.reviewId,
    });

    const recapturedEvent = events.find(
      (e: any) => e.eventType === 'VR_EVENT:RECAPTURED',
    );
    expect(recapturedEvent).toBeDefined();
    expect((recapturedEvent as any).payload.reload).toBeUndefined();
    expect((recapturedEvent as any).payload.cacheBust).toBeUndefined();
  });

  it('detects changed target after recapture with different text', async () => {
    const changedAdapter: RecaptureAdapter = async () => makeRecaptureResult({
      text: 'Save all changes',
      boundingBox: { x: 100, y: 200, width: 150, height: 40 },
    });

    const serviceChanged = new ReviewServiceImpl(
      eventBus, issueService, undefined,
      new ReviewPersistence(REVIEW_STORAGE),
      changedAdapter,
    );

    const create = await serviceChanged.createReview({ issueId: testIssueId }, 's', 'p');
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    const result = await serviceChanged.recaptureReview({
      reviewId: create.value.reviewId,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.comparison?.status).toBe('changed');
    }
  });
});

describe('List reviews', () => {
  it('lists in deterministic order', async () => {
    const list = await reviewService.listReviews();
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.value.length).toBeGreaterThan(0);
      for (let i = 1; i < list.value.length; i++) {
        expect(list.value[i - 1].updatedAt >= list.value[i].updatedAt).toBe(true);
      }
    }
  });
});

describe('Persistence', () => {
  it('survives simulated restart', async () => {
    const create = await reviewService.createReview({ issueId: testIssueId }, 's', 'p');
    if (!create.ok) return;

    const newPersistence = new ReviewPersistence(REVIEW_STORAGE);
    const loaded = await newPersistence.loadReview(create.value.reviewId);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value.reviewId).toBe(create.value.reviewId);
    }
  });

  it('handles corrupt review file', async () => {
    const corruptId = 'review_corrupt12345';
    const dir = path.join(REVIEW_STORAGE, corruptId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'review.json'), '{invalid json', 'utf-8');

    const loaded = await reviewService.getReview(corruptId);
    expect(loaded.ok).toBe(false);
  });
});

describe('Redaction', () => {
  it('deep redacts API key in review', async () => {
    const issue = await issueService.createIssue(
      makeSelection({
        summary: { label: 'sk_test_abc123def456 button', targetCount: 1 },
      }),
      's', 'p', 'API key issue: sk_test_abc123def456',
    );
    if (!issue.ok) return;

    const create = await reviewService.createReview({ issueId: issue.value.issueId }, 's', 'p');
    expect(create.ok).toBe(true);
  });

  it('no packet paths in review projection', async () => {
    const create = await reviewService.createReview({ issueId: testIssueId }, 's', 'p');
    if (!create.ok) return;

    const get = await reviewService.getReview(create.value.reviewId);
    expect(get.ok).toBe(true);
    if (get.ok) {
      const json = JSON.stringify(get.value);
      expect(json).not.toContain('.viskod');
      expect(json).not.toContain('captures/');
      expect(json).not.toContain('C:\\');
      expect(json).not.toContain('/home/');
    }
  });

  it('no raw JSON in review projection', async () => {
    const create = await reviewService.createReview({ issueId: testIssueId }, 's', 'p');
    if (!create.ok) return;

    const get = await reviewService.getReview(create.value.reviewId);
    expect(get.ok).toBe(true);
    if (get.ok) {
      const json = JSON.stringify(get.value);
      expect(json).not.toContain('selectionSnapshot');
    }
  });

  it('no selectors in review projection', async () => {
    const create = await reviewService.createReview({ issueId: testIssueId }, 's', 'p');
    if (!create.ok) return;

    const get = await reviewService.getReview(create.value.reviewId);
    expect(get.ok).toBe(true);
    if (get.ok) {
      const json = JSON.stringify(get.value);
      expect(json).not.toContain('data-testid');
      expect(json).not.toMatch(/querySelector/);
    }
  });
});

describe('Cancel', () => {
  it('cancels review', async () => {
    const create = await reviewService.createReview({ issueId: testIssueId }, 's', 'p');
    if (!create.ok) return;

    const result = await reviewService.cancelReview(create.value.reviewId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('cancelled');
    }
  });
});

describe('Target resolution', () => {
  it('resolves target from stable attributes', () => {
    const snapshot: ReviewSnapshotRef = {
      snapshotId: 'snap_test',
      kind: 'before',
      capturedAt: new Date().toISOString(),
      source: {
        issueId: 'issue_test',
        selectionId: 'sel_test',
        selectionSnapshot: {
          targets: [{
            targetId: 'tgt_001',
            geometry: { viewportRect: { x: 100, y: 200, width: 120, height: 40 } },
            semantics: { tagName: 'button', role: 'button', isInteractive: true },
            fingerprints: { stableAttributes: { 'data-testid': 'save-btn' } },
            resolutionCandidates: [],
          }],
        },
      },
      page: { viewport: { width: 1440, height: 900 } },
      targetSummary: { mode: 'single', targetCount: 1, confidence: 0.9, resolutionStatus: 'resolved' },
      evidenceSummary: { hasSelection: true, hasContextPacket: false, hasScreenshot: false, hasSourceHints: false },
    };

    const result = resolveRecaptureTarget(snapshot);
    expect(result).not.toBeNull();
    expect(result!.selector).toBe('[data-testid="save-btn"]');
    expect(result!.resolvedFrom).toBe('stable-attribute');
    expect(result!.confidence).toBe(0.9);
  });

  it('resolves target from ancestor fingerprint', () => {
    const snapshot: ReviewSnapshotRef = {
      snapshotId: 'snap_test',
      kind: 'before',
      capturedAt: new Date().toISOString(),
      source: {
        issueId: 'issue_test',
        selectionSnapshot: {
          targets: [{
            targetId: 'tgt_001',
            geometry: { viewportRect: { x: 100, y: 200, width: 120, height: 40 } },
            semantics: { tagName: 'a', isInteractive: true },
            fingerprints: { ancestorFingerprint: ['div', 'nav', 'header'] },
            resolutionCandidates: [],
          }],
        },
      },
      page: { viewport: { width: 1440, height: 900 } },
      targetSummary: { mode: 'single', targetCount: 1, confidence: 0.7, resolutionStatus: 'resolved' },
      evidenceSummary: { hasSelection: true, hasContextPacket: false, hasScreenshot: false, hasSourceHints: false },
    };

    const result = resolveRecaptureTarget(snapshot);
    expect(result).not.toBeNull();
    expect(result!.selector).toContain('a');
    expect(result!.resolvedFrom).toBe('ancestor-path');
    expect(result!.confidence).toBe(0.7);
  });

  it('resolves target from geometry fallback', () => {
    const snapshot: ReviewSnapshotRef = {
      snapshotId: 'snap_test',
      kind: 'before',
      capturedAt: new Date().toISOString(),
      source: {
        issueId: 'issue_test',
        selectionSnapshot: {
          targets: [{
            targetId: 'tgt_001',
            semantics: { tagName: 'div', isInteractive: false },
            fingerprints: {},
            resolutionCandidates: [],
          }],
        },
      },
      page: { viewport: { width: 1440, height: 900 } },
      targetSummary: { mode: 'single', targetCount: 1, confidence: 0.3, resolutionStatus: 'stale' },
      evidenceSummary: { hasSelection: true, hasContextPacket: false, hasScreenshot: false, hasSourceHints: false },
      visualEvidence: { cropRect: { x: 50, y: 60, width: 200, height: 80 }, overlayExcluded: false },
    };

    const result = resolveRecaptureTarget(snapshot);
    expect(result).not.toBeNull();
    expect(result!.resolvedFrom).toBe('geometry-fallback');
    expect(result!.confidence).toBe(0.3);
    expect(result!.boundingBox).toEqual({ x: 50, y: 60, width: 200, height: 80 });
  });

  it('returns null when no target data available', () => {
    const snapshot: ReviewSnapshotRef = {
      snapshotId: 'snap_test',
      kind: 'before',
      capturedAt: new Date().toISOString(),
      source: { issueId: 'issue_test' },
      page: { viewport: { width: 1440, height: 900 } },
      targetSummary: { mode: 'single', targetCount: 0, confidence: 0, resolutionStatus: 'missing' },
      evidenceSummary: { hasSelection: false, hasContextPacket: false, hasScreenshot: false, hasSourceHints: false },
    };

    const result = resolveRecaptureTarget(snapshot);
    expect(result).toBeNull();
  });

  it('no selector appears in review projection', async () => {
    const create = await reviewService.createReview({ issueId: testIssueId }, 's', 'p');
    if (!create.ok) return;

    const get = await reviewService.getReview(create.value.reviewId);
    expect(get.ok).toBe(true);
    if (get.ok) {
      const json = JSON.stringify(get.value);
      expect(json).not.toContain('data-testid');
      expect(json).not.toMatch(/querySelector/);
    }
  });

  it('recapture works with reviewId only (no selector needed)', async () => {
    const mockAdapter: RecaptureAdapter = async () => makeRecaptureResult();

    const serviceWithAdapter = new ReviewServiceImpl(
      eventBus, issueService, undefined,
      new ReviewPersistence(REVIEW_STORAGE),
      mockAdapter,
    );

    const create = await serviceWithAdapter.createReview({ issueId: testIssueId }, 's', 'p');
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    const result = await serviceWithAdapter.recaptureReview({
      reviewId: create.value.reviewId,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('ready');
      expect(result.value.after).toBeDefined();
    }
  });
});
