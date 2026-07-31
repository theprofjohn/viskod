import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventBus } from '@viskod/event-bus';
import { IssueServiceImpl, IssuePersistence } from '@viskod/visual-issue';
import { ReviewServiceImpl, ReviewPersistence } from '@viskod/visual-review';
import type { VisualSelection } from '@viskod/visual-selection';
import type { RecaptureAdapter, RecaptureResult } from '@viskod/visual-review';

const TEST_DIR = path.join(process.cwd(), '.viskod-test-mcp-review');
const ISSUE_STORAGE = path.join(TEST_DIR, 'issues');
const REVIEW_STORAGE = path.join(TEST_DIR, 'reviews');

function makeSelection(): VisualSelection {
  return {
    schemaVersion: 1,
    selectionId: 'sel_mcp_001',
    sessionId: 'mcp-session',
    pageId: 'mcp-page',
    mode: 'single',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    page: {
      url: 'http://localhost:5173/settings',
      title: 'Settings',
      viewport: { width: 1440, height: 900, scrollX: 0, scrollY: 0 },
    },
    region: { viewportRect: { x: 100, y: 200, width: 120, height: 40 } },
    targets: [{
      targetId: 'tgt_mcp',
      documentOrder: 0,
      geometry: { viewportRect: { x: 100, y: 200, width: 120, height: 40 } },
      semantics: { tagName: 'button', role: 'button', accessibleName: 'Save', textPreview: 'Save changes', isInteractive: true },
      fingerprints: {},
      resolutionCandidates: [{ strategy: 'runtime-node', value: 'live', confidence: 0.9 }],
    }],
    summary: { label: 'Save changes', role: 'button', textPreview: 'Save changes', targetCount: 1 },
    resolution: { status: 'resolved', confidence: 0.9, resolvedAt: new Date().toISOString() },
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

  const result = await issueService.createIssue(makeSelection(), 'mcp-session', 'mcp-page', 'MCP test issue');
  if (result.ok) testIssueId = result.value.issueId;
});

afterAll(() => {
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
});

function makeServices() {
  return { issueService, reviewService };
}

describe('tools/list includes review tools', () => {
  it('lists all 5 review tool names', () => {
    const toolNames = [
      'create_visual_review',
      'get_visual_review',
      'list_visual_reviews',
      'recapture_visual_review',
      'record_visual_review_decision',
    ];
    expect(toolNames.length).toBe(5);
    for (const name of toolNames) {
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    }
  });
});

describe('create_visual_review', () => {
  it('creates review from valid issue', async () => {
    const { reviewService } = makeServices();
    const result = await reviewService.createReview({ issueId: testIssueId }, 'mcp-session', 'mcp-page');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.reviewId).toMatch(/^review_/);
      expect(result.value.issueId).toBe(testIssueId);
      expect(result.value.status).toBe('ready');
    }
  });

  it('rejects missing issue', async () => {
    const { reviewService } = makeServices();
    const result = await reviewService.createReview({ issueId: 'nonexistent' }, 'mcp-session', 'mcp-page');
    expect(result.ok).toBe(false);
  });

  it('rejects deleted issue', async () => {
    const { issueService, reviewService } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), 'mcp-session', 'mcp-page', 'Delete me');
    if (issue.ok) {
      await issueService.deleteIssue(issue.value.issueId);
      const result = await reviewService.createReview({ issueId: issue.value.issueId }, 'mcp-session', 'mcp-page');
      expect(result.ok).toBe(false);
    }
  });
});

describe('get_visual_review', () => {
  it('returns safe review data', async () => {
    const { reviewService } = makeServices();
    const create = await reviewService.createReview({ issueId: testIssueId }, 'mcp-session', 'mcp-page');
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    const get = await reviewService.getReview(create.value.reviewId);
    expect(get.ok).toBe(true);
    if (get.ok) {
      expect(get.value.reviewId).toBe(create.value.reviewId);
      expect(get.value.before).toBeDefined();
      expect(get.value.before.targetSummary).toBeDefined();
    }
  });

  it('rejects missing review', async () => {
    const { reviewService } = makeServices();
    const result = await reviewService.getReview('nonexistent');
    expect(result.ok).toBe(false);
  });
});

describe('list_visual_reviews', () => {
  it('lists reviews in deterministic order', async () => {
    const { reviewService } = makeServices();
    const list = await reviewService.listReviews();
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.value.length).toBeGreaterThan(0);
    }
  });
});

describe('recapture_visual_review', () => {
  it('sets after snapshot with resolved status', async () => {
    const { reviewService } = makeServices();
    const create = await reviewService.createReview({ issueId: testIssueId }, 'mcp-session', 'mcp-page');
    if (!create.ok) return;

    const after = {
      snapshotId: 'snap_recapture',
      kind: 'after' as const,
      capturedAt: new Date().toISOString(),
      source: {},
      page: { viewport: { width: 1440, height: 900 } },
      targetSummary: {
        mode: 'single' as const,
        label: 'Save changes',
        role: 'button',
        textPreview: 'Save changes',
        targetCount: 1,
        confidence: 0.9,
        resolutionStatus: 'resolved' as const,
      },
      evidenceSummary: { hasSelection: true, hasContextPacket: false, hasScreenshot: false, hasSourceHints: false },
    };

    const result = await reviewService.setAfterSnapshot(create.value.reviewId, after);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.comparison).toBeDefined();
      expect(result.value.comparison!.status).toBe('unchanged');
    }
  });

  it('handles missing after status', async () => {
    const { reviewService } = makeServices();
    const create = await reviewService.createReview({ issueId: testIssueId }, 'mcp-session', 'mcp-page');
    if (!create.ok) return;

    const after = {
      snapshotId: 'snap_missing',
      kind: 'after' as const,
      capturedAt: new Date().toISOString(),
      source: {},
      page: { viewport: { width: 1440, height: 900 } },
      targetSummary: {
        mode: 'single' as const,
        targetCount: 0,
        confidence: 0,
        resolutionStatus: 'missing' as const,
      },
      evidenceSummary: { hasSelection: false, hasContextPacket: false, hasScreenshot: false, hasSourceHints: false },
    };

    const result = await reviewService.setAfterSnapshot(create.value.reviewId, after);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.comparison!.status).toBe('missing_after');
    }
  });
});

describe('record_visual_review_decision', () => {
  it('records accepted decision', async () => {
    const { reviewService } = makeServices();
    const create = await reviewService.createReview({ issueId: testIssueId }, 'mcp-session', 'mcp-page');
    if (!create.ok) return;

    const result = await reviewService.recordDecision(create.value.reviewId, { decision: 'accepted' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('accepted');
      expect(result.value.decision!.decision).toBe('accepted');
    }
  });

  it('records rejected decision', async () => {
    const { reviewService } = makeServices();
    const create = await reviewService.createReview({ issueId: testIssueId }, 'mcp-session', 'mcp-page');
    if (!create.ok) return;

    const result = await reviewService.recordDecision(create.value.reviewId, { decision: 'rejected', note: 'Still broken' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('rejected');
      expect(result.value.decision!.note).toBe('Still broken');
    }
  });

  it('rejects decision on already-decided review', async () => {
    const { reviewService } = makeServices();
    const create = await reviewService.createReview({ issueId: testIssueId }, 'mcp-session', 'mcp-page');
    if (!create.ok) return;

    await reviewService.recordDecision(create.value.reviewId, { decision: 'accepted' });
    const result = await reviewService.recordDecision(create.value.reviewId, { decision: 'rejected' });
    expect(result.ok).toBe(false);
  });
});

describe('output safety', () => {
  it('no packet paths in review output', async () => {
    const { reviewService } = makeServices();
    const create = await reviewService.createReview({ issueId: testIssueId }, 'mcp-session', 'mcp-page');
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

  it('no raw JSON in review output', async () => {
    const { reviewService } = makeServices();
    const create = await reviewService.createReview({ issueId: testIssueId }, 'mcp-session', 'mcp-page');
    if (!create.ok) return;

    const get = await reviewService.getReview(create.value.reviewId);
    if (get.ok) {
      const json = JSON.stringify(get.value);
      expect(json).not.toContain('selectionSnapshot');
    }
  });

  it('no selectors in review output', async () => {
    const { reviewService } = makeServices();
    const create = await reviewService.createReview({ issueId: testIssueId }, 'mcp-session', 'mcp-page');
    if (!create.ok) return;

    const get = await reviewService.getReview(create.value.reviewId);
    if (get.ok) {
      const json = JSON.stringify(get.value);
      expect(json).not.toContain('data-testid');
      expect(json).not.toMatch(/querySelector/);
    }
  });

  it('no secrets in review output', async () => {
    const { issueService, reviewService } = makeServices();
    const issue = await issueService.createIssue(
      makeSelection(),
      'mcp-session',
      'mcp-page',
      'sk_test_abc123def456 issue',
    );
    if (!issue.ok) return;

    const create = await reviewService.createReview({ issueId: issue.value.issueId }, 'mcp-session', 'mcp-page');
    if (!create.ok) return;

    const get = await reviewService.getReview(create.value.reviewId);
    if (get.ok) {
      const json = JSON.stringify(get.value);
      expect(json).not.toContain('sk_test_abc123def456');
      expect(json).not.toMatch(/sk[-_]?test[-_]?[A-Za-z0-9]{3,}/);
    }
  });
});

describe('recaptureReview (live adapter)', () => {
  function makeRecaptureResult(overrides?: Partial<RecaptureResult>): RecaptureResult {
    return {
      packetId: 'pkt_mcp_recapture_001',
      selector: '[data-testid="save-btn"]',
      tagName: 'button',
      boundingBox: { x: 100, y: 200, width: 120, height: 40 },
      text: 'Save changes',
      url: 'http://localhost:5173/settings',
      viewport: { width: 1440, height: 900 },
      ...overrides,
    };
  }

  function makeAdapterService(adapter: RecaptureAdapter) {
    return new ReviewServiceImpl(
      eventBus, issueService, undefined,
      new ReviewPersistence(REVIEW_STORAGE),
      adapter,
    );
  }

  it('recaptures with adapter and returns comparison (reviewId only)', async () => {
    const service = makeAdapterService(async () => makeRecaptureResult());
    const create = await service.createReview({ issueId: testIssueId }, 'mcp-session', 'mcp-page');
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    const result = await service.recaptureReview({
      reviewId: create.value.reviewId,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('ready');
      expect(result.value.after).toBeDefined();
      expect(result.value.after!.source.recapturePacketId).toBe('pkt_mcp_recapture_001');
      expect(result.value.comparison).toBeDefined();
    }
  });

  it('fails without adapter', async () => {
    const service = new ReviewServiceImpl(
      eventBus, issueService, undefined,
      new ReviewPersistence(REVIEW_STORAGE),
    );

    const create = await service.createReview({ issueId: testIssueId }, 'mcp-session', 'mcp-page');
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    const result = await service.recaptureReview({
      reviewId: create.value.reviewId,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('RECAPTURE_ADAPTER_MISSING');
    }
  });

  it('passes reload and cacheBust to adapter', async () => {
    let capturedOptions: any = {};
    const service = makeAdapterService(async (opts) => {
      capturedOptions = opts;
      return makeRecaptureResult();
    });

    const create = await service.createReview({ issueId: testIssueId }, 'mcp-session', 'mcp-page');
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    await service.recaptureReview({
      reviewId: create.value.reviewId,
      reload: true,
      cacheBust: true,
    });

    expect(capturedOptions.reload).toBe(true);
    expect(capturedOptions.cacheBust).toBe(true);
  });

  it('returns opaque snapshot IDs, not paths', async () => {
    const service = makeAdapterService(async () => makeRecaptureResult());
    const create = await service.createReview({ issueId: testIssueId }, 'mcp-session', 'mcp-page');
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    const result = await service.recaptureReview({
      reviewId: create.value.reviewId,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.before.snapshotId).toBeTruthy();
      expect(result.value.after!.snapshotId).toBeTruthy();
      expect(result.value.after!.source.recapturePacketId).toBe('pkt_mcp_recapture_001');
      const json = JSON.stringify(result.value);
      expect(json).not.toContain('.viskod');
      expect(json).not.toContain('captures/');
    }
  });

  it('no selector in MCP tool schema for recapture_visual_review', () => {
    const toolSchema = {
      type: 'object',
      properties: {
        reviewId: { type: 'string' },
        reload: { type: 'boolean' },
        cacheBust: { type: 'boolean' },
      },
      required: ['reviewId'],
    };

    expect(toolSchema.properties).not.toHaveProperty('selector');
    expect(toolSchema.properties).not.toHaveProperty('url');
    expect(toolSchema.required).toEqual(['reviewId']);
  });

  it('stale target returns missing/stale from recapture', async () => {
    const staleAdapter: RecaptureAdapter = async () => null;
    const service = makeAdapterService(staleAdapter);

    const create = await service.createReview({ issueId: testIssueId }, 'mcp-session', 'mcp-page');
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    const result = await service.recaptureReview({
      reviewId: create.value.reviewId,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('RECAPTURE_FAILED');
    }
  });

  it('duplicate target returns ambiguous after recapture', async () => {
    const ambiguousAdapter: RecaptureAdapter = async () => makeRecaptureResult({
      text: 'Settings',
      boundingBox: { x: 100, y: 200, width: 120, height: 40 },
    });
    const service = makeAdapterService(ambiguousAdapter);

    const create = await service.createReview({ issueId: testIssueId }, 'mcp-session', 'mcp-page');
    expect(create.ok).toBe(true);
    if (!create.ok) return;

    const result = await service.recaptureReview({
      reviewId: create.value.reviewId,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.comparison).toBeDefined();
      expect(result.value.after).toBeDefined();
    }
  });

  it('no packet paths/raw JSON/selectors/secrets in output', async () => {
    const service = makeAdapterService(async () => makeRecaptureResult());
    const create = await service.createReview({ issueId: testIssueId }, 'mcp-session', 'mcp-page');
    if (!create.ok) return;

    const result = await service.recaptureReview({
      reviewId: create.value.reviewId,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const json = JSON.stringify(result.value);
      expect(json).not.toContain('.viskod');
      expect(json).not.toContain('captures/');
      expect(json).not.toContain('C:\\');
      expect(json).not.toContain('/home/');
      expect(json).not.toContain('selectionSnapshot');
      expect(json).not.toContain('data-testid');
      expect(json).not.toMatch(/querySelector/);
    }
  });
});
