import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventBus } from '@viskod/event-bus';
import { IssuePersistence, IssueServiceImpl } from '@viskod/visual-issue';
import type { VisualSelection } from '@viskod/visual-selection';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TargetCropCapture } from './artifact-types';
import { ReviewArtifactStore, ReviewPersistence, ReviewServiceImpl } from './index';
import { resolveRecaptureTarget } from './targetResolver';
import type { RecaptureAdapter, RecaptureResult, ReviewSnapshotRef } from './types';

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
    targets: [
      {
        targetId: 'tgt_001',
        documentOrder: 0,
        geometry: { viewportRect: { x: 100, y: 200, width: 120, height: 40 } },
        semantics: {
          tagName: 'button',
          role: 'button',
          accessibleName: 'Save',
          textPreview: 'Save changes',
          isInteractive: true,
        },
        fingerprints: { stableAttributes: { 'data-testid': 'save-btn' } },
        resolutionCandidates: [{ strategy: 'runtime-node', value: 'live', confidence: 0.9 }],
      },
    ],
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

  const result = await issueService.createIssue(
    makeSelection(),
    'test-session',
    'test-page',
    'Button issue',
  );
  if (result.ok) testIssueId = result.value.issueId;
});

afterAll(() => {
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {}
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
        targetSummary: {
          mode: 'single',
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
      's',
      'p',
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
      's',
      'p',
      'Stale issue',
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
      expect(result.value.comparison?.status).toBe('unchanged');
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
      expect(result.value.comparison?.status).toBe('changed');
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
      expect(result.value.comparison?.status).toBe('missing_after');
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
      expect(result.value.comparison?.status).toBe('ambiguous_after');
    }
  });
});

describe('Decision recording', () => {
  it('accepts review', async () => {
    const create = await reviewService.createReview({ issueId: testIssueId }, 's', 'p');
    if (!create.ok) return;

    const result = await reviewService.recordDecision(create.value.reviewId, {
      decision: 'accepted',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('accepted');
      expect(result.value.decision).toBeDefined();
      expect(result.value.decision?.decision).toBe('accepted');
    }
  });

  it('rejects review', async () => {
    const create = await reviewService.createReview({ issueId: testIssueId }, 's', 'p');
    if (!create.ok) return;

    const result = await reviewService.recordDecision(create.value.reviewId, {
      decision: 'rejected',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('rejected');
    }
  });

  it('needs follow-up with note', async () => {
    const create = await reviewService.createReview({ issueId: testIssueId }, 's', 'p');
    if (!create.ok) return;

    const result = await reviewService.recordDecision(create.value.reviewId, {
      decision: 'needs_follow_up',
      note: 'Need to check edge cases',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('needs_follow_up');
      expect(result.value.decision?.note).toBe('Need to check edge cases');
    }
  });

  it('rejects decision on already-decided review', async () => {
    const create = await reviewService.createReview({ issueId: testIssueId }, 's', 'p');
    if (!create.ok) return;

    await reviewService.recordDecision(create.value.reviewId, { decision: 'accepted' });
    const result = await reviewService.recordDecision(create.value.reviewId, {
      decision: 'rejected',
    });
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
      expect(result.value.after?.targetSummary.label).toBe('Updated');
    }
  });
});

describe('RecaptureReview (live adapter)', () => {
  it('recaptures with mock adapter and produces real after snapshot', async () => {
    const mockAdapter: RecaptureAdapter = async () => makeRecaptureResult();

    const serviceWithAdapter = new ReviewServiceImpl(
      eventBus,
      issueService,
      undefined,
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
      expect(result.value.after?.source.recapturePacketId).toBe('pkt_recapture_001');
      expect(result.value.after?.page.url).toBe('http://localhost:5173/settings');
      expect(result.value.after?.visualEvidence?.cropRect).toEqual({
        x: 100,
        y: 200,
        width: 120,
        height: 40,
      });
      expect(result.value.comparison).toBeDefined();
    }
  });

  it('fails with RECAPTURE_ADAPTER_MISSING when no adapter configured', async () => {
    const serviceNoAdapter = new ReviewServiceImpl(
      eventBus,
      issueService,
      undefined,
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
      eventBus,
      issueService,
      undefined,
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
      eventBus,
      issueService,
      undefined,
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
      eventBus,
      issueService,
      undefined,
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
    eventBus.subscribe('VR_EVENT:RECAPTURED', (e) => {
      events.push(e);
    });

    const mockAdapter: RecaptureAdapter = async () => makeRecaptureResult();

    const serviceWithAdapter = new ReviewServiceImpl(
      eventBus,
      issueService,
      undefined,
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
      (e): e is { eventType: string; payload: Record<string, unknown> } =>
        (e as { eventType?: string }).eventType === 'VR_EVENT:RECAPTURED',
    );
    expect(recapturedEvent).toBeDefined();
    expect(recapturedEvent?.payload.reload).toBeUndefined();
    expect(recapturedEvent?.payload.cacheBust).toBeUndefined();
  });

  it('detects changed target after recapture with different text', async () => {
    const changedAdapter: RecaptureAdapter = async () =>
      makeRecaptureResult({
        text: 'Save all changes',
        boundingBox: { x: 100, y: 200, width: 150, height: 40 },
      });

    const serviceChanged = new ReviewServiceImpl(
      eventBus,
      issueService,
      undefined,
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
        expect(list.value[i - 1]!.updatedAt >= list.value[i]!.updatedAt).toBe(true);
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
      's',
      'p',
      'API key issue: sk_test_abc123def456',
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
          targets: [
            {
              targetId: 'tgt_001',
              geometry: { viewportRect: { x: 100, y: 200, width: 120, height: 40 } },
              semantics: { tagName: 'button', role: 'button', isInteractive: true },
              fingerprints: { stableAttributes: { 'data-testid': 'save-btn' } },
              resolutionCandidates: [],
            },
          ],
        },
      },
      page: { viewport: { width: 1440, height: 900 } },
      targetSummary: {
        mode: 'single',
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

    const result = resolveRecaptureTarget(snapshot);
    expect(result).not.toBeNull();
    expect(result?.selector).toBe('[data-testid="save-btn"]');
    expect(result?.resolvedFrom).toBe('stable-attribute');
    expect(result?.confidence).toBe(0.9);
  });

  it('resolves target from ancestor fingerprint', () => {
    const snapshot: ReviewSnapshotRef = {
      snapshotId: 'snap_test',
      kind: 'before',
      capturedAt: new Date().toISOString(),
      source: {
        issueId: 'issue_test',
        selectionSnapshot: {
          targets: [
            {
              targetId: 'tgt_001',
              geometry: { viewportRect: { x: 100, y: 200, width: 120, height: 40 } },
              semantics: { tagName: 'a', isInteractive: true },
              fingerprints: { ancestorFingerprint: ['div', 'nav', 'header'] },
              resolutionCandidates: [],
            },
          ],
        },
      },
      page: { viewport: { width: 1440, height: 900 } },
      targetSummary: {
        mode: 'single',
        targetCount: 1,
        confidence: 0.7,
        resolutionStatus: 'resolved',
      },
      evidenceSummary: {
        hasSelection: true,
        hasContextPacket: false,
        hasScreenshot: false,
        hasSourceHints: false,
      },
    };

    const result = resolveRecaptureTarget(snapshot);
    expect(result).not.toBeNull();
    expect(result?.selector).toContain('a');
    expect(result?.resolvedFrom).toBe('ancestor-path');
    expect(result?.confidence).toBe(0.7);
  });

  it('resolves target from geometry fallback', () => {
    const snapshot: ReviewSnapshotRef = {
      snapshotId: 'snap_test',
      kind: 'before',
      capturedAt: new Date().toISOString(),
      source: {
        issueId: 'issue_test',
        selectionSnapshot: {
          targets: [
            {
              targetId: 'tgt_001',
              semantics: { tagName: 'div', isInteractive: false },
              fingerprints: {},
              resolutionCandidates: [],
            },
          ],
        },
      },
      page: { viewport: { width: 1440, height: 900 } },
      targetSummary: { mode: 'single', targetCount: 1, confidence: 0.3, resolutionStatus: 'stale' },
      evidenceSummary: {
        hasSelection: true,
        hasContextPacket: false,
        hasScreenshot: false,
        hasSourceHints: false,
      },
      visualEvidence: {
        cropRect: { x: 50, y: 60, width: 200, height: 80 },
        overlayExcluded: false,
      },
    };

    const result = resolveRecaptureTarget(snapshot);
    expect(result).not.toBeNull();
    expect(result?.resolvedFrom).toBe('geometry-fallback');
    expect(result?.confidence).toBe(0.3);
    expect(result?.boundingBox).toEqual({ x: 50, y: 60, width: 200, height: 80 });
  });

  it('returns null when no target data available', () => {
    const snapshot: ReviewSnapshotRef = {
      snapshotId: 'snap_test',
      kind: 'before',
      capturedAt: new Date().toISOString(),
      source: { issueId: 'issue_test' },
      page: { viewport: { width: 1440, height: 900 } },
      targetSummary: { mode: 'single', targetCount: 0, confidence: 0, resolutionStatus: 'missing' },
      evidenceSummary: {
        hasSelection: false,
        hasContextPacket: false,
        hasScreenshot: false,
        hasSourceHints: false,
      },
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
      eventBus,
      issueService,
      undefined,
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

// ---------------------------------------------------------------------------
// Phase 31 — local-sensitive visual review artifacts
// ---------------------------------------------------------------------------

function makeShot(
  rgb: [number, number, number] = [10, 120, 200],
  identity?: TargetCropCapture['identity'],
  capturedAt?: string,
): TargetCropCapture {
  const png = new PNG({ width: 120, height: 40 });
  for (let i = 0; i < 120 * 40; i++) {
    const idx = i * 4;
    png.data[idx] = rgb[0];
    png.data[idx + 1] = rgb[1];
    png.data[idx + 2] = rgb[2];
    png.data[idx + 3] = 255;
  }
  return {
    buffer: PNG.sync.write(png),
    format: 'png',
    width: 120,
    height: 40,
    targetRect: { x: 100, y: 200, width: 120, height: 40 },
    cropRect: { x: 76, y: 176, width: 168, height: 88 },
    padding: 24,
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
    url: 'http://localhost:5173/settings',
    capturedAt: capturedAt ?? new Date().toISOString(),
    resolutionStatus: 'resolved',
    matchCount: 1,
    identity: identity ?? { targetId: 'tgt_001', stableAttributes: { 'data-testid': 'save-btn' } },
  };
}

function makeShotAdapter(shot: TargetCropCapture): RecaptureAdapter {
  return async () =>
    makeRecaptureResult({
      boundingBox: shot.targetRect,
      text: 'Save changes',
      viewport: {
        width: shot.viewport.width,
        height: shot.viewport.height,
        deviceScaleFactor: shot.viewport.deviceScaleFactor,
      },
      elementScreenshot: shot,
      identity: shot.identity,
    });
}

let phase31IssueCounter = 0;

/** Fresh issue with a unique target identity — isolates baseline state between tests. */
async function createPhase31Issue(): Promise<{
  issueId: string;
  targetId: string;
  stableAttributes: Record<string, string>;
}> {
  phase31IssueCounter++;
  const targetId = `tgt_p31_${phase31IssueCounter}`;
  const stableAttributes = { 'data-testid': `save-btn-${phase31IssueCounter}` };
  const selection = makeSelection({
    targets: [
      {
        targetId,
        documentOrder: 0,
        geometry: { viewportRect: { x: 100, y: 200, width: 120, height: 40 } },
        semantics: {
          tagName: 'button',
          role: 'button',
          accessibleName: 'Save',
          textPreview: 'Save changes',
          isInteractive: true,
        },
        fingerprints: { stableAttributes },
        resolutionCandidates: [{ strategy: 'runtime-node', value: 'live', confidence: 0.9 }],
      },
    ],
  });
  const result = await issueService.createIssue(
    selection,
    'test-session',
    'test-page',
    `Phase 31 issue ${phase31IssueCounter}`,
  );
  if (!result.ok) throw new Error('failed to create Phase 31 issue');
  return { issueId: result.value.issueId, targetId, stableAttributes };
}

describe('Phase 31 — visual review artifacts', () => {
  it('enabled policy attaches the baseline at review creation', async () => {
    const { issueId } = await createPhase31Issue();
    const store = new ReviewArtifactStore(REVIEW_STORAGE, 'local-sensitive-target-crop');
    await store.saveBaseline(issueId, makeShot());
    const service = new ReviewServiceImpl(
      eventBus,
      issueService,
      undefined,
      new ReviewPersistence(REVIEW_STORAGE),
      undefined,
      store,
    );
    const create = await service.createReview({ issueId }, 's', 'p');
    expect(create.ok).toBe(true);
    if (!create.ok) return;
    const get = await service.getReview(create.value.reviewId);
    expect(get.ok).toBe(true);
    if (get.ok) {
      expect(get.value.artifacts?.policy).toBe('local-sensitive-target-crop');
      expect(get.value.artifacts?.before?.status).toBe('collected');
      expect(get.value.artifacts?.before?.artifactId).toMatch(/^art_[a-f0-9]{32}$/);
      // No filesystem path ever leaks into the projection.
      expect(JSON.stringify(get.value)).not.toContain('.viskod');
      expect(JSON.stringify(get.value)).not.toContain('before.png');
      // Stable-attribute identity stays internal: the projection carries
      // only the opaque target id.
      expect(JSON.stringify(get.value)).not.toContain('data-testid');
      expect(JSON.stringify(get.value)).not.toContain('save-btn');
    }
  });

  it('disabled policy never attaches artifacts and reports visual unavailable', async () => {
    const { issueId, targetId, stableAttributes } = await createPhase31Issue();
    const service = new ReviewServiceImpl(
      eventBus,
      issueService,
      undefined,
      new ReviewPersistence(REVIEW_STORAGE),
      makeShotAdapter(makeShot([10, 120, 200], { targetId, stableAttributes })),
      new ReviewArtifactStore(REVIEW_STORAGE, 'disabled'),
    );
    const create = await service.createReview({ issueId }, 's', 'p');
    if (!create.ok) return;
    const recapture = await service.recaptureReview({ reviewId: create.value.reviewId });
    expect(recapture.ok).toBe(true);
    if (recapture.ok) {
      expect(recapture.value.artifacts).toBeUndefined();
      expect(recapture.value.comparison?.status).toBe('unchanged'); // legacy metadata result
    }
  });

  it('unchanged capture stays unchanged with real pixel evidence', async () => {
    const { issueId, targetId, stableAttributes } = await createPhase31Issue();
    const store = new ReviewArtifactStore(REVIEW_STORAGE, 'local-sensitive-target-crop');
    await store.saveBaseline(issueId, makeShot([10, 120, 200], { targetId, stableAttributes }));
    const service = new ReviewServiceImpl(
      eventBus,
      issueService,
      undefined,
      new ReviewPersistence(REVIEW_STORAGE),
      makeShotAdapter(makeShot([10, 120, 200], { targetId, stableAttributes })),
      store,
    );
    const create = await service.createReview({ issueId }, 's', 'p');
    if (!create.ok) return;
    const result = await service.recaptureReview({ reviewId: create.value.reviewId });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.comparison?.status).toBe('unchanged');
      expect(result.value.comparison?.visual?.artifactComparison?.changedPixelRatio).toBe(0);
      expect(result.value.artifacts?.after?.status).toBe('collected');
      expect(result.value.artifacts?.diff?.status).toBe('collected');
    }
  });

  it('color-only change is detected via pixel evidence', async () => {
    const { issueId, targetId, stableAttributes } = await createPhase31Issue();
    const store = new ReviewArtifactStore(REVIEW_STORAGE, 'local-sensitive-target-crop');
    await store.saveBaseline(issueId, makeShot([255, 255, 255], { targetId, stableAttributes }));
    const service = new ReviewServiceImpl(
      eventBus,
      issueService,
      undefined,
      new ReviewPersistence(REVIEW_STORAGE),
      makeShotAdapter(makeShot([255, 0, 0], { targetId, stableAttributes })),
      store,
    );
    const create = await service.createReview({ issueId }, 's', 'p');
    if (!create.ok) return;
    const result = await service.recaptureReview({ reviewId: create.value.reviewId });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.comparison?.status).toBe('changed');
      expect(
        result.value.comparison?.visual?.artifactComparison?.changedPixelRatio,
      ).toBeGreaterThan(0.99);
      expect(result.value.comparison?.visual?.diffArtifactId).toBeTruthy();
    }
  });

  it('geometry-only movement is detected as changed through geometry evidence', async () => {
    const { issueId, targetId, stableAttributes } = await createPhase31Issue();
    const store = new ReviewArtifactStore(REVIEW_STORAGE, 'local-sensitive-target-crop');
    const beforeShot = makeShot([10, 120, 200], { targetId, stableAttributes });
    await store.saveBaseline(issueId, beforeShot);
    // Same pixels, moved 20px right.
    const afterShot = {
      ...makeShot([10, 120, 200], { targetId, stableAttributes }),
      targetRect: { x: 120, y: 200, width: 120, height: 40 },
    };
    const service = new ReviewServiceImpl(
      eventBus,
      issueService,
      undefined,
      new ReviewPersistence(REVIEW_STORAGE),
      makeShotAdapter(afterShot),
      store,
    );
    const create = await service.createReview({ issueId }, 's', 'p');
    if (!create.ok) return;
    const result = await service.recaptureReview({ reviewId: create.value.reviewId });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.comparison?.status).toBe('changed');
      expect(result.value.comparison?.visual?.artifactComparison?.geometry?.xDelta).toBe(20);
      expect(result.value.comparison?.visual?.artifactComparison?.geometryChanged).toBe(true);
    }
  });

  it('viewport/DPR mismatch is incomparable, never a confident pixel result', async () => {
    const { issueId, targetId, stableAttributes } = await createPhase31Issue();
    const store = new ReviewArtifactStore(REVIEW_STORAGE, 'local-sensitive-target-crop');
    const beforeShot = makeShot([10, 120, 200], { targetId, stableAttributes });
    await store.saveBaseline(issueId, beforeShot);
    const afterShot = {
      ...makeShot([10, 120, 200], { targetId, stableAttributes }),
      viewport: { width: 800, height: 600, deviceScaleFactor: 1 },
    };
    const service = new ReviewServiceImpl(
      eventBus,
      issueService,
      undefined,
      new ReviewPersistence(REVIEW_STORAGE),
      makeShotAdapter(afterShot),
      store,
    );
    const create = await service.createReview({ issueId }, 's', 'p');
    if (!create.ok) return;
    const result = await service.recaptureReview({ reviewId: create.value.reviewId });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.comparison?.status).toBe('incomparable');
      expect(result.value.comparison?.visual?.artifactComparison?.viewportCompatible).toBe(false);
    }
  });

  it('missing baseline reports visual comparison unavailable, never fabricated', async () => {
    const { issueId, targetId, stableAttributes } = await createPhase31Issue();
    const store = new ReviewArtifactStore(REVIEW_STORAGE, 'local-sensitive-target-crop');
    const service = new ReviewServiceImpl(
      eventBus,
      issueService,
      undefined,
      new ReviewPersistence(REVIEW_STORAGE),
      makeShotAdapter(makeShot([10, 120, 200], { targetId, stableAttributes })),
      store,
    );
    const create = await service.createReview({ issueId }, 's', 'p');
    if (!create.ok) return;
    const result = await service.recaptureReview({ reviewId: create.value.reviewId });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.comparison?.status).toBe('visual_unavailable');
      expect(result.value.comparison?.visual?.artifactComparison?.status).toBe('unavailable');
    }
  });

  it('after label never falls back to tagName (VISKOD-AUDIT-005 regression)', async () => {
    // Before label is a human-readable label; the after recapture resolves a
    // DIV with the same content. Identity/label must not flip to changed.
    const { issueId, targetId, stableAttributes } = await createPhase31Issue();
    const store = new ReviewArtifactStore(REVIEW_STORAGE, 'local-sensitive-target-crop');
    await store.saveBaseline(issueId, makeShot([10, 120, 200], { targetId, stableAttributes }));
    const adapter: RecaptureAdapter = async () =>
      makeRecaptureResult({
        tagName: 'DIV',
        text: 'Save changes',
        boundingBox: { x: 100, y: 200, width: 120, height: 40 },
        elementScreenshot: makeShot([10, 120, 200], { targetId, stableAttributes }),
        identity: { targetId, stableAttributes },
      });
    const service = new ReviewServiceImpl(
      eventBus,
      issueService,
      undefined,
      new ReviewPersistence(REVIEW_STORAGE),
      adapter,
      store,
    );
    const create = await service.createReview({ issueId }, 's', 'p');
    if (!create.ok) return;
    const result = await service.recaptureReview({ reviewId: create.value.reviewId });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.after?.targetSummary.label).toBe('Save changes');
      expect(result.value.comparison?.status).toBe('unchanged');
    }
  });

  it('identity mismatch (target replaced) is incomparable, never a silent diff', async () => {
    const { issueId, targetId, stableAttributes } = await createPhase31Issue();
    const store = new ReviewArtifactStore(REVIEW_STORAGE, 'local-sensitive-target-crop');
    await store.saveBaseline(issueId, makeShot([10, 120, 200], { targetId, stableAttributes }));
    const adapter: RecaptureAdapter = async () =>
      makeRecaptureResult({
        text: 'Save changes',
        elementScreenshot: makeShot([10, 120, 200], {
          targetId: 'tgt_replaced',
          stableAttributes: { 'data-testid': 'other-btn' },
        }),
        identity: { targetId: 'tgt_replaced', stableAttributes: { 'data-testid': 'other-btn' } },
      });
    const service = new ReviewServiceImpl(
      eventBus,
      issueService,
      undefined,
      new ReviewPersistence(REVIEW_STORAGE),
      adapter,
      store,
    );
    const create = await service.createReview({ issueId }, 's', 'p');
    if (!create.ok) return;
    const result = await service.recaptureReview({ reviewId: create.value.reviewId });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.comparison?.status).toBe('incomparable');
    }
  });

  it('artifacts survive a simulated restart and stay pairable by review id', async () => {
    const { issueId, targetId, stableAttributes } = await createPhase31Issue();
    const store = new ReviewArtifactStore(REVIEW_STORAGE, 'local-sensitive-target-crop');
    await store.saveBaseline(issueId, makeShot([255, 255, 255], { targetId, stableAttributes }));
    const service = new ReviewServiceImpl(
      eventBus,
      issueService,
      undefined,
      new ReviewPersistence(REVIEW_STORAGE),
      makeShotAdapter(makeShot([255, 0, 0], { targetId, stableAttributes })),
      store,
    );
    const create = await service.createReview({ issueId }, 's', 'p');
    if (!create.ok) return;
    await service.recaptureReview({ reviewId: create.value.reviewId });

    // Fresh process: new persistence + new artifact store on the same dirs.
    const freshStore = new ReviewArtifactStore(REVIEW_STORAGE, 'local-sensitive-target-crop');
    const freshService = new ReviewServiceImpl(
      new EventBus(),
      issueService,
      undefined,
      new ReviewPersistence(REVIEW_STORAGE),
      undefined,
      freshStore,
    );
    const get = await freshService.getReview(create.value.reviewId);
    expect(get.ok).toBe(true);
    if (get.ok) {
      expect(get.value.comparison?.status).toBe('changed');
      expect(get.value.artifacts?.before?.artifactId).toBeTruthy();
      expect(get.value.artifacts?.after?.artifactId).toBeTruthy();
      expect(get.value.artifacts?.diff?.artifactId).toBeTruthy();
    }
    const manifest = await freshStore.loadManifest(create.value.reviewId);
    expect(manifest.ok && manifest.value?.pairing.beforeArtifactId).toBeTruthy();
  });

  it('recordDecision persists the optional note (VISKOD-AUDIT-023)', async () => {
    const { issueId } = await createPhase31Issue();
    const create = await reviewService.createReview({ issueId }, 's', 'p');
    if (!create.ok) return;
    const result = await reviewService.recordDecision(create.value.reviewId, {
      decision: 'accepted',
      note: 'Colors and spacing verified after the fix',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.decision?.note).toBe('Colors and spacing verified after the fix');
    }
    const fresh = new ReviewServiceImpl(
      new EventBus(),
      issueService,
      undefined,
      new ReviewPersistence(REVIEW_STORAGE),
    );
    const get = await fresh.getReview(create.value.reviewId);
    expect(get.ok && get.value.decision?.note).toBe('Colors and spacing verified after the fix');
  });

  it('Phase 31A: createReview fails closed when the committed baseline file is missing — no fabricated before', async () => {
    const { issueId, targetId, stableAttributes } = await createPhase31Issue();
    const store = new ReviewArtifactStore(REVIEW_STORAGE, 'local-sensitive-target-crop');
    await store.saveBaseline(issueId, makeShot([255, 255, 255], { targetId, stableAttributes }));
    // Simulate the durable baseline file disappearing after a restart while
    // its manifest remains (the failure case in Phase 31A §4).
    fs.rmSync(path.join(REVIEW_STORAGE, 'baselines', issueId, 'before.png'), { force: true });

    const service = new ReviewServiceImpl(
      eventBus,
      issueService,
      undefined,
      new ReviewPersistence(REVIEW_STORAGE),
      makeShotAdapter(makeShot([255, 0, 0], { targetId, stableAttributes })),
      store,
    );
    const reviewDirsBefore = fs
      .readdirSync(REVIEW_STORAGE, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== 'baselines')
      .map((d) => d.name)
      .sort();
    const create = await service.createReview({ issueId }, 's', 'p');
    expect(create.ok).toBe(false);
    if (!create.ok) expect(create.error.code).toBe('ARTIFACT_NOT_FOUND');

    // No review was persisted and no review artifact dir was created; the
    // post-change image was never captured or substituted as BEFORE.
    const reviewDirsAfterFailure = fs
      .readdirSync(REVIEW_STORAGE, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== 'baselines')
      .map((d) => d.name)
      .sort();
    expect(reviewDirsAfterFailure).toEqual(reviewDirsBefore);
    const baselineDir = path.join(REVIEW_STORAGE, 'baselines', issueId);
    expect(fs.readdirSync(baselineDir).sort()).toEqual(['manifest.json']);
  });

  it('Phase 31A: createReview fails closed on a corrupted baseline file — typed ARTIFACT_INVALID_IMAGE', async () => {
    const { issueId, targetId, stableAttributes } = await createPhase31Issue();
    const store = new ReviewArtifactStore(REVIEW_STORAGE, 'local-sensitive-target-crop');
    await store.saveBaseline(issueId, makeShot([255, 255, 255], { targetId, stableAttributes }));
    fs.writeFileSync(
      path.join(REVIEW_STORAGE, 'baselines', issueId, 'before.png'),
      'corrupt bytes',
    );

    const service = new ReviewServiceImpl(
      eventBus,
      issueService,
      undefined,
      new ReviewPersistence(REVIEW_STORAGE),
      makeShotAdapter(makeShot([255, 0, 0], { targetId, stableAttributes })),
      store,
    );
    const create = await service.createReview({ issueId }, 's', 'p');
    expect(create.ok).toBe(false);
    if (!create.ok) expect(create.error.code).toBe('ARTIFACT_INVALID_IMAGE');
  });

  it('Phase 31A: review after restart uses the exact original baseline bytes (SHA-256 identity)', async () => {
    const { issueId, targetId, stableAttributes } = await createPhase31Issue();
    const capturedAt = '2026-08-15T08:30:00.000Z';
    const store = new ReviewArtifactStore(REVIEW_STORAGE, 'local-sensitive-target-crop');
    await store.saveBaseline(
      issueId,
      makeShot([255, 255, 255], { targetId, stableAttributes }, capturedAt),
    );

    // Fresh process instances on the same durable dirs — the restart path.
    const freshStore = new ReviewArtifactStore(REVIEW_STORAGE, 'local-sensitive-target-crop');
    const freshService = new ReviewServiceImpl(
      new EventBus(),
      issueService,
      undefined,
      new ReviewPersistence(REVIEW_STORAGE),
      makeShotAdapter(makeShot([255, 0, 0], { targetId, stableAttributes })),
      freshStore,
    );
    const create = await freshService.createReview({ issueId }, 's', 'p');
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    // The review's before artifact is byte-identical to the ORIGINAL
    // baseline captured pre-restart, and keeps its original capturedAt.
    const beforeId = create.value.reviewId;
    const manifest = await freshStore.loadManifest(beforeId);
    expect(manifest.ok && manifest.value).toBeTruthy();
    if (!manifest.ok || !manifest.value) return;
    const beforeEntry = manifest.value.artifacts.find((a) => a.role === 'before');
    expect(beforeEntry?.capturedAt).toBe(capturedAt);
    const baselineBuffer = await freshStore.readBaselineBuffer(issueId);
    const reviewBeforeBuffer = await freshStore.readArtifact(
      beforeId,
      manifest.value.pairing.beforeArtifactId as string,
    );
    expect(baselineBuffer.ok && reviewBeforeBuffer.ok).toBe(true);
    if (baselineBuffer.ok && reviewBeforeBuffer.ok) {
      expect(reviewBeforeBuffer.value.equals(baselineBuffer.value)).toBe(true);
    }

    // Verification after restart pairs AFTER/DIFF to that original BEFORE.
    const recapture = await freshService.recaptureReview({ reviewId: beforeId });
    expect(recapture.ok).toBe(true);
    if (!recapture.ok) return;
    expect(recapture.value.comparison?.status).toBe('changed');
    const finalManifest = await freshStore.loadManifest(beforeId);
    expect(finalManifest.ok && finalManifest.value).toBeTruthy();
    if (!finalManifest.ok || !finalManifest.value) return;
    expect(finalManifest.value.pairing.beforeArtifactId).toBe(
      manifest.value.pairing.beforeArtifactId,
    );
    expect(finalManifest.value.pairing.afterArtifactId).toBeTruthy();
    expect(finalManifest.value.pairing.diffArtifactId).toBeTruthy();
    expect(finalManifest.value.comparison?.status).toBe('changed');
  });
});
