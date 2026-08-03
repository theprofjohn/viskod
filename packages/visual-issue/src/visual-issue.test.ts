import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventBus } from '@viskod/event-bus';
import type { VisualSelection } from '@viskod/visual-selection';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLifecycleEvent, isValidTransition } from './lifecycle';
import { IssuePersistence } from './persistence';
import { generateDefaultTitle, redactIssueText } from './redaction';
import { VisualIssueSchema } from './schemas';
import { IssueServiceImpl } from './service';
import type { IssueService } from './service';
import type { VisualIssue, VisualIssueStatus } from './types';

const TEST_DIR = path.join(process.cwd(), '.viskod-test-issues');
const TEST_SESSION_ID = 'test-session-1';
const TEST_PAGE_ID = 'test-page-1';

function makePersistence(): IssuePersistence {
  return new IssuePersistence(path.join(TEST_DIR, 'issues'));
}

function makeService(persistence?: IssuePersistence): IssueService {
  return new IssueServiceImpl(new EventBus(), persistence ?? makePersistence());
}

function makeSelection(
  overrides: Partial<VisualIssue['source']['selectionSnapshot']> = {},
): VisualSelection {
  return {
    schemaVersion: 1,
    selectionId: crypto.randomUUID(),
    sessionId: TEST_SESSION_ID,
    pageId: TEST_PAGE_ID,
    mode: 'single',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    page: {
      url: 'https://example.com/settings',
      title: 'Settings',
      viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
    },
    region: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
    targets: [
      {
        targetId: crypto.randomUUID(),
        documentOrder: 0,
        geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
        semantics: {
          tagName: 'button',
          role: 'button',
          accessibleName: 'Save',
          textPreview: 'Save changes',
          isInteractive: true,
        },
        fingerprints: { stableAttributes: { 'data-testid': 'save-btn' } },
        resolutionCandidates: [
          { strategy: 'stable-attribute' as const, value: 'save-btn', confidence: 0.9 },
        ],
      },
    ],
    summary: { label: 'Save changes', role: 'button', textPreview: 'Save changes', targetCount: 1 },
    resolution: {
      status: 'resolved' as const,
      confidence: 0.9,
      resolvedAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

function makeBoxSelection(): VisualSelection {
  return makeSelection({ mode: 'box', summary: { label: '5 elements selected', targetCount: 5 } });
}

beforeEach(() => {
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// =============================================================================
// Schema Validation
// =============================================================================
describe('Schema Validation', () => {
  it('validates a valid issue', () => {
    const issue: VisualIssue = {
      schemaVersion: 1,
      issueId: crypto.randomUUID(),
      sessionId: TEST_SESSION_ID,
      pageId: TEST_PAGE_ID,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'open',
      severity: 'medium',
      title: 'Button · Save changes',
      source: {
        createdFrom: 'visual-selection',
        selectionId: crypto.randomUUID(),
        selectionSnapshot: { test: true },
      },
      page: {
        url: 'https://example.com',
        viewport: { width: 1280, height: 720 },
      },
      targetSummary: {
        mode: 'single',
        label: 'Save',
        targetCount: 1,
        confidence: 0.9,
        resolutionStatus: 'resolved',
      },
      tags: [],
      lifecycle: [],
      redaction: { applied: false, rules: [], strippedFields: [], warnings: [] },
    };
    const result = VisualIssueSchema.safeParse(issue);
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const issue = {
      schemaVersion: 1,
      issueId: crypto.randomUUID(),
      sessionId: TEST_SESSION_ID,
      pageId: TEST_PAGE_ID,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'invalid_status',
      severity: 'medium',
      title: 'Test',
      source: { createdFrom: 'visual-selection', selectionId: 's1', selectionSnapshot: {} },
      page: { url: 'https://example.com', viewport: { width: 1280, height: 720 } },
      targetSummary: {
        mode: 'single',
        targetCount: 1,
        confidence: 0.5,
        resolutionStatus: 'resolved',
      },
      tags: [],
      lifecycle: [],
      redaction: { applied: false, rules: [], strippedFields: [], warnings: [] },
    };
    const result = VisualIssueSchema.safeParse(issue);
    expect(result.success).toBe(false);
  });

  it('rejects title over 80 chars', () => {
    const issue: VisualIssue = {
      schemaVersion: 1,
      issueId: crypto.randomUUID(),
      sessionId: TEST_SESSION_ID,
      pageId: TEST_PAGE_ID,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'open',
      severity: 'medium',
      title: 'x'.repeat(81),
      source: { createdFrom: 'visual-selection', selectionId: 's1', selectionSnapshot: {} },
      page: { url: 'https://example.com', viewport: { width: 1280, height: 720 } },
      targetSummary: {
        mode: 'single',
        targetCount: 1,
        confidence: 0.5,
        resolutionStatus: 'resolved',
      },
      tags: [],
      lifecycle: [],
      redaction: { applied: false, rules: [], strippedFields: [], warnings: [] },
    };
    const result = VisualIssueSchema.safeParse(issue);
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// Issue ID Opacity
// =============================================================================
describe('Issue ID', () => {
  it('issue IDs are opaque UUIDs', async () => {
    const svc = makeService();
    const result = await svc.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.issueId).toMatch(/^[0-9a-f-]+$/);
      expect(result.value.issueId.length).toBeGreaterThan(0);
      expect(result.value.source.selectionId).not.toBe(result.value.issueId);
    }
  });
});

// =============================================================================
// Creation
// =============================================================================
describe('Create Issue', () => {
  it('creates from single selection', async () => {
    const svc = makeService();
    const result = await svc.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('open');
      expect(result.value.severity).toBe('medium');
      expect(result.value.title).toContain('Save');
      expect(result.value.lifecycle.length).toBe(1);
      expect(result.value.lifecycle[0]?.type).toBe('created');
    }
  });

  it('creates from box selection', async () => {
    const svc = makeService();
    const result = await svc.createIssue(makeBoxSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.targetSummary.mode).toBe('box');
      expect(result.value.targetSummary.targetCount).toBe(5);
    }
  });

  it('blocks creation when selection has no targets', async () => {
    const svc = makeService();
    const sel = makeSelection({ targets: [] });
    const result = await svc.createIssue(sel, TEST_SESSION_ID, TEST_PAGE_ID);
    expect(result.ok).toBe(false);
  });

  it('blocks creation with stale selection', async () => {
    const svc = makeService();
    const sel = makeSelection({
      resolution: { status: 'stale', confidence: 0.3, resolvedAt: new Date().toISOString() },
    });
    const result = await svc.createIssue(sel, TEST_SESSION_ID, TEST_PAGE_ID);
    expect(result.ok).toBe(false);
  });

  it('blocks creation with missing selection', async () => {
    const svc = makeService();
    const sel = makeSelection({
      resolution: { status: 'missing', confidence: 0, resolvedAt: new Date().toISOString() },
    });
    const result = await svc.createIssue(sel, TEST_SESSION_ID, TEST_PAGE_ID);
    expect(result.ok).toBe(false);
  });

  it('allows creation with ambiguous selection', async () => {
    const svc = makeService();
    const sel = makeSelection({
      resolution: { status: 'ambiguous', confidence: 0.5, resolvedAt: new Date().toISOString() },
    });
    const result = await svc.createIssue(sel, TEST_SESSION_ID, TEST_PAGE_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.targetSummary.resolutionStatus).toBe('ambiguous');
    }
  });

  it('accepts custom title', async () => {
    const svc = makeService();
    const result = await svc.createIssue(
      makeSelection(),
      TEST_SESSION_ID,
      TEST_PAGE_ID,
      'My custom title',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe('My custom title');
    }
  });

  it('accepts custom severity', async () => {
    const svc = makeService();
    const result = await svc.createIssue(
      makeSelection(),
      TEST_SESSION_ID,
      TEST_PAGE_ID,
      undefined,
      undefined,
      'high',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.severity).toBe('high');
    }
  });
});

// =============================================================================
// Persistence
// =============================================================================
describe('Persistence', () => {
  it('issue file is written to disk', async () => {
    const p = makePersistence();
    const svc = makeService(p);
    const result = await svc.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const issueDir = path.join(p.getBaseDir(), result.value.issueId);
      expect(fs.existsSync(issueDir)).toBe(true);
      expect(fs.existsSync(path.join(issueDir, 'issue.json'))).toBe(true);
    }
  });

  it('issue survives process restart (simulated by new service instance)', async () => {
    const p = makePersistence();
    let svc = makeService(p);
    const createResult = await svc.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(createResult.ok).toBe(true);
    const issueId = createResult.ok ? createResult.value.issueId : '';

    // New service instance = simulated restart
    svc = makeService(p);
    const listResult = await svc.listIssues();
    expect(listResult.ok).toBe(true);
    if (listResult.ok) {
      expect(listResult.value.length).toBe(1);
      expect(listResult.value[0]?.issueId).toBe(issueId);
    }
  });

  it('handles corrupt issue file gracefully', async () => {
    const p = makePersistence();
    const svc = makeService(p);
    const createResult = await svc.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(createResult.ok).toBe(true);
    if (createResult.ok) {
      const issuePath = path.join(p.getBaseDir(), createResult.value.issueId, 'issue.json');
      fs.writeFileSync(issuePath, '{invalid json', 'utf-8');
      const loadResult = await svc.getIssue(createResult.value.issueId);
      expect(loadResult.ok).toBe(false);
    }
  });

  it('missing issue returns not found', async () => {
    const svc = makeService();
    const result = await svc.getIssue('nonexistent-id');
    expect(result.ok).toBe(false);
  });

  it('list returns deterministic order (updatedAt desc)', async () => {
    const p = makePersistence();
    const svc = makeService(p);
    await svc.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    await new Promise((r) => setTimeout(r, 10));
    await svc.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);

    const listResult = await svc.listIssues();
    expect(listResult.ok).toBe(true);
    if (listResult.ok) {
      expect(listResult.value.length).toBe(2);
      expect(listResult.value[0]!.createdAt >= listResult.value[1]!.createdAt).toBe(true);
    }
  });
});

// =============================================================================
// Lifecycle
// =============================================================================
describe('Issue Lifecycle', () => {
  it('validates transitions correctly', () => {
    expect(isValidTransition('open', 'in_progress')).toBe(true);
    expect(isValidTransition('open', 'archived')).toBe(true);
    expect(isValidTransition('open', 'resolved')).toBe(true);
    expect(isValidTransition('archived', 'open')).toBe(true);
    expect(isValidTransition('resolved', 'archived')).toBe(true);
    expect(isValidTransition('draft', 'open')).toBe(true);
    expect(isValidTransition('open', 'draft')).toBe(false);
    expect(isValidTransition('archived', 'resolved')).toBe(false);
    expect(isValidTransition('deleted' as unknown as VisualIssueStatus, 'open')).toBe(false);
  });

  it('updates status', async () => {
    const svc = makeService();
    const create = await svc.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(create.ok).toBe(true);
    if (create.ok) {
      const update = await svc.updateIssue(create.value.issueId, { status: 'in_progress' });
      expect(update.ok).toBe(true);
      if (update.ok) {
        expect(update.value.status).toBe('in_progress');
        expect(update.value.lifecycle.length).toBe(2);
      }
    }
  });

  it('rejects invalid transition', async () => {
    const svc = makeService();
    const create = await svc.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(create.ok).toBe(true);
    if (create.ok) {
      const update = await svc.updateIssue(create.value.issueId, {
        status: 'draft' as unknown as VisualIssueStatus,
      });
      expect(update.ok).toBe(false);
    }
  });

  it('archives issue', async () => {
    const svc = makeService();
    const create = await svc.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(create.ok).toBe(true);
    if (create.ok) {
      const archive = await svc.archiveIssue(create.value.issueId);
      expect(archive.ok).toBe(true);
      if (archive.ok) {
        expect(archive.value.status).toBe('archived');
        expect(archive.value.archivedAt).toBeTruthy();
        const evt = archive.value.lifecycle.find((e) => e.type === 'archived');
        expect(evt).toBeTruthy();
      }
    }
  });

  it('reopening archived issue returns to open', async () => {
    const svc = makeService();
    const create = await svc.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(create.ok).toBe(true);
    if (create.ok) {
      await svc.archiveIssue(create.value.issueId);
      const reopen = await svc.reopenIssue(create.value.issueId);
      expect(reopen.ok).toBe(true);
      if (reopen.ok) {
        expect(reopen.value.status).toBe('open');
        expect(reopen.value.archivedAt).toBeUndefined();
        const evt = reopen.value.lifecycle.find((e) => e.type === 'reopened');
        expect(evt).toBeTruthy();
      }
    }
  });

  it('rejects reopen of non-archived', async () => {
    const svc = makeService();
    const create = await svc.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(create.ok).toBe(true);
    if (create.ok) {
      const reopen = await svc.reopenIssue(create.value.issueId);
      expect(reopen.ok).toBe(false);
    }
  });

  it('archives are hidden from default list', async () => {
    const p = makePersistence();
    const svc = makeService(p);
    const create = await svc.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(create.ok).toBe(true);
    if (create.ok) {
      await svc.archiveIssue(create.value.issueId);
      const list = await svc.listIssues();
      expect(list.ok).toBe(true);
      if (list.ok) {
        expect(list.value.length).toBe(0);
      }
    }
  });

  it('deletes issue', async () => {
    const svc = makeService();
    const create = await svc.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(create.ok).toBe(true);
    if (create.ok) {
      const del = await svc.deleteIssue(create.value.issueId);
      expect(del.ok).toBe(true);
      if (del.ok) {
        expect(del.value.deletedAt).toBeTruthy();
        const evt = del.value.lifecycle.find((e) => e.type === 'deleted');
        expect(evt).toBeTruthy();
      }
    }
  });

  it('rejects re-delete', async () => {
    const svc = makeService();
    const create = await svc.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(create.ok).toBe(true);
    if (create.ok) {
      await svc.deleteIssue(create.value.issueId);
      const del = await svc.deleteIssue(create.value.issueId);
      expect(del.ok).toBe(false);
    }
  });
});

// =============================================================================
// Update
// =============================================================================
describe('Update Issue', () => {
  it('updates all metadata fields', async () => {
    const svc = makeService();
    const create = await svc.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(create.ok).toBe(true);
    if (create.ok) {
      const update = await svc.updateIssue(create.value.issueId, {
        title: 'New title',
        description: 'New description',
        severity: 'critical',
        status: 'in_progress',
      });
      expect(update.ok).toBe(true);
      if (update.ok) {
        expect(update.value.title).toBe('New title');
        expect(update.value.description).toBe('New description');
        expect(update.value.severity).toBe('critical');
        expect(update.value.status).toBe('in_progress');
        expect(update.value.updatedAt).not.toBe(create.value.updatedAt);
      }
    }
  });
});

// =============================================================================
// Default Title Generation
// =============================================================================
describe('Default Title Generation', () => {
  it('generates title from single selection with role and label', () => {
    const title = generateDefaultTitle('single', 'Save changes', 'button', 'Save');
    expect(title).toContain('button');
    expect(title).toContain('Save');
    expect(title.length).toBeLessThanOrEqual(80);
  });

  it('generates title from box selection', () => {
    const title = generateDefaultTitle('box', '5 elements selected');
    expect(title).toContain('5 elements selected');
  });

  it('falls back to page title', () => {
    const title = generateDefaultTitle('single', undefined, undefined, undefined, 'Dashboard');
    expect(title).toContain('Dashboard');
  });

  it('truncates long titles to 80 chars', () => {
    const long = 'x'.repeat(100);
    const title = generateDefaultTitle('single', long, 'button');
    expect(title.length).toBeLessThanOrEqual(80);
  });
});

// =============================================================================
// Redaction
// =============================================================================
describe('Redaction', () => {
  it('redacts email from title', () => {
    const title = redactIssueText('Contact user@example.com');
    expect(title).not.toContain('user@example.com');
    expect(title).toContain('[EMAIL_REDACTED]');
  });

  it('redacts credit card from description', () => {
    const text = redactIssueText('Card: 4111 1111 1111 1111');
    expect(text).toContain('[CARD_REDACTED]');
  });

  it('redacts API key from title', () => {
    const text = redactIssueText('API key: sk_test_abc123def456');
    expect(text).toContain('[API_KEY_REDACTED]');
  });

  it('does not mutate clean text', () => {
    const text = redactIssueText('Button · Save changes');
    expect(text).toBe('Button · Save changes');
  });

  it('truncates long text', () => {
    const text = redactIssueText('a'.repeat(5000), 100);
    expect(text.length).toBeLessThanOrEqual(101);
    expect(text).toContain('…');
  });

  it('redacts issue in full', async () => {
    const svc = makeService();
    const result = await svc.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Fields should not contain raw selectors
      expect(result.value.title).not.toContain('data-testid');
      expect(result.value.targetSummary.textPreview).toBeDefined();
      expect(result.value.source.selectionSnapshot).toBeDefined();
    }
  });

  it('synthetic secret does not appear in output', async () => {
    const sel = makeSelection({
      summary: {
        label: 'test-user-secret-123',
        role: 'button',
        textPreview: 'test-user-secret-123',
        targetCount: 1,
      },
      targets: [
        {
          targetId: crypto.randomUUID(),
          documentOrder: 0,
          geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
          semantics: { tagName: 'div', textPreview: 'test-user-secret-123', isInteractive: false },
          fingerprints: {},
          resolutionCandidates: [],
        },
      ],
    });
    const svc = makeService();
    const result = await svc.createIssue(sel, TEST_SESSION_ID, TEST_PAGE_ID, 'Test issue');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).not.toContain('test-user-secret-123');
    }
  });

  it('deep-redacts selectionSnapshot — API key sk_test_* absent from persisted JSON', async () => {
    const secret = 'sk_test_abc123def456ghi';
    const sel = makeSelection({
      summary: {
        label: 'Auth settings',
        role: 'button',
        textPreview: `API key: ${secret}`,
        targetCount: 1,
      },
      targets: [
        {
          targetId: crypto.randomUUID(),
          documentOrder: 0,
          geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
          semantics: {
            tagName: 'div',
            textPreview: `Key: ${secret}`,
            accessibleName: 'save',
            isInteractive: false,
          },
          fingerprints: { stableAttributes: { 'data-api-key': secret } },
          resolutionCandidates: [],
        },
      ],
    });
    const p = makePersistence();
    const svc = makeService(p);
    const result = await svc.createIssue(sel, TEST_SESSION_ID, TEST_PAGE_ID, 'API issue');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const filePath = path.join(p.getBaseDir(), result.value.issueId, 'issue.json');
      const raw = fs.readFileSync(filePath, 'utf-8');
      expect(raw).not.toContain(secret);
      expect(raw).toContain('[API_KEY_REDACTED]');
      expect(result.value.source.selectionSnapshot).toBeDefined();
      const snapStr = JSON.stringify(result.value.source.selectionSnapshot);
      expect(snapStr).not.toContain(secret);
    }
  });

  it('deep-redacts selectionSnapshot — email absent from persisted JSON', async () => {
    const secret = 'admin@example.com';
    const sel = makeSelection({
      summary: {
        label: 'User profile',
        role: 'button',
        textPreview: `Contact: ${secret}`,
        targetCount: 1,
      },
      targets: [
        {
          targetId: crypto.randomUUID(),
          documentOrder: 0,
          geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
          semantics: { tagName: 'span', textPreview: `Email: ${secret}`, isInteractive: false },
          fingerprints: {},
          resolutionCandidates: [],
        },
      ],
    });
    const p = makePersistence();
    const svc = makeService(p);
    const result = await svc.createIssue(sel, TEST_SESSION_ID, TEST_PAGE_ID, 'Email issue');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const raw = fs.readFileSync(
        path.join(p.getBaseDir(), result.value.issueId, 'issue.json'),
        'utf-8',
      );
      expect(raw).not.toContain(secret);
      expect(raw).toContain('[EMAIL_REDACTED]');
    }
  });

  it('deep-redacts selectionSnapshot — credit card absent from persisted JSON', async () => {
    const secret = '4111111111111111';
    const sel = makeSelection({
      summary: {
        label: 'Payment form',
        role: 'button',
        textPreview: `Card: ${secret}`,
        targetCount: 1,
      },
      targets: [
        {
          targetId: crypto.randomUUID(),
          documentOrder: 0,
          geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
          semantics: {
            tagName: 'input',
            textPreview: secret,
            inputType: 'text',
            isInteractive: true,
          },
          fingerprints: {},
          resolutionCandidates: [],
        },
      ],
    });
    const p = makePersistence();
    const svc = makeService(p);
    const result = await svc.createIssue(sel, TEST_SESSION_ID, TEST_PAGE_ID, 'Card issue');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const raw = fs.readFileSync(
        path.join(p.getBaseDir(), result.value.issueId, 'issue.json'),
        'utf-8',
      );
      expect(raw).not.toContain(secret);
      expect(raw).toContain('[CARD_REDACTED]');
    }
  });

  it('deep-redacts selectionSnapshot — bearer token absent from persisted JSON', async () => {
    const secret = 'mysecrettoken12345678';
    const sel = makeSelection({
      summary: {
        label: 'Auth header',
        role: 'button',
        textPreview: `Bearer: ${secret}`,
        targetCount: 1,
      },
      targets: [
        {
          targetId: crypto.randomUUID(),
          documentOrder: 0,
          geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
          semantics: { tagName: 'div', textPreview: `token=${secret}`, isInteractive: false },
          fingerprints: {},
          resolutionCandidates: [],
        },
      ],
    });
    const p = makePersistence();
    const svc = makeService(p);
    const result = await svc.createIssue(sel, TEST_SESSION_ID, TEST_PAGE_ID, 'Token issue');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const raw = fs.readFileSync(
        path.join(p.getBaseDir(), result.value.issueId, 'issue.json'),
        'utf-8',
      );
      expect(raw).not.toContain(secret);
    }
  });

  it('deep-redacts selectionSnapshot — URL query token absent from persisted JSON', async () => {
    const secret = 'abcdef1234567890abcdef';
    const sel = makeSelection({
      summary: {
        label: 'Link',
        role: 'link',
        textPreview: `URL: ?token=${secret}`,
        targetCount: 1,
      },
      targets: [
        {
          targetId: crypto.randomUUID(),
          documentOrder: 0,
          geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
          semantics: { tagName: 'a', textPreview: `?api_key=${secret}`, isInteractive: true },
          fingerprints: {},
          resolutionCandidates: [],
        },
      ],
    });
    const p = makePersistence();
    const svc = makeService(p);
    const result = await svc.createIssue(sel, TEST_SESSION_ID, TEST_PAGE_ID, 'URL issue');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const raw = fs.readFileSync(
        path.join(p.getBaseDir(), result.value.issueId, 'issue.json'),
        'utf-8',
      );
      expect(raw).not.toContain(secret);
    }
  });

  it('deep-redacts selectionSnapshot — password/input value absent from persisted JSON', async () => {
    const secret = 'supersecretpassword123';
    const sel = makeSelection({
      summary: {
        label: 'Login form',
        role: 'button',
        textPreview: 'Password input',
        targetCount: 1,
      },
      targets: [
        {
          targetId: crypto.randomUUID(),
          documentOrder: 0,
          geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
          semantics: {
            tagName: 'input',
            textPreview: `password=${secret}`,
            inputType: 'password',
            isInteractive: true,
          },
          fingerprints: {},
          resolutionCandidates: [],
        },
      ],
    });
    const p = makePersistence();
    const svc = makeService(p);
    const result = await svc.createIssue(sel, TEST_SESSION_ID, TEST_PAGE_ID, 'Password issue');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const raw = fs.readFileSync(
        path.join(p.getBaseDir(), result.value.issueId, 'issue.json'),
        'utf-8',
      );
      expect(raw).not.toContain(secret);
    }
  });

  it('deep-redacts nested strings at multiple levels in selectionSnapshot', async () => {
    const apiSecret = 'sk_live_xyz789abc123';
    const emailSecret = 'leak@secret.com';
    const sel = makeSelection({
      summary: {
        label: `Key: ${apiSecret}`,
        textPreview: `Contact: ${emailSecret}`,
        targetCount: 1,
      },
      targets: [
        {
          targetId: crypto.randomUUID(),
          documentOrder: 0,
          geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
          semantics: {
            tagName: 'div',
            textPreview: `api=${apiSecret}`,
            accessibleName: emailSecret,
            isInteractive: false,
          },
          fingerprints: {
            stableAttributes: { 'data-val': apiSecret },
            ancestorFingerprint: [emailSecret],
          },
          resolutionCandidates: [
            { strategy: 'stable-attribute' as const, value: apiSecret, confidence: 0.8 },
          ],
        },
      ],
    });
    const p = makePersistence();
    const svc = makeService(p);
    const result = await svc.createIssue(sel, TEST_SESSION_ID, TEST_PAGE_ID, 'Nested issue');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const raw = fs.readFileSync(
        path.join(p.getBaseDir(), result.value.issueId, 'issue.json'),
        'utf-8',
      );
      expect(raw).not.toContain(apiSecret);
      expect(raw).not.toContain(emailSecret);
    }
  });

  it('redaction.rules includes snapshot-level redaction labels', async () => {
    const secret = 'sk_test_abc123def456';
    const sel = makeSelection({
      summary: { label: 'Auth', textPreview: `key=${secret}`, targetCount: 1 },
      targets: [
        {
          targetId: crypto.randomUUID(),
          documentOrder: 0,
          geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
          semantics: { tagName: 'div', textPreview: secret, isInteractive: false },
          fingerprints: {},
          resolutionCandidates: [],
        },
      ],
    });
    const svc = makeService();
    const result = await svc.createIssue(sel, TEST_SESSION_ID, TEST_PAGE_ID, 'Rule check');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.redaction.applied).toBe(true);
      expect(result.value.redaction.rules).toContain('api-key');
    }
  });
});

// =============================================================================
// Health
// =============================================================================
describe('Health', () => {
  it('reports healthy with zero issues', async () => {
    const svc = makeService();
    const h = await svc.health();
    expect(h.status).toBe('healthy');
    expect(h.totalIssues).toBe(0);
  });

  it('counts issues by status', async () => {
    const svc = makeService();
    await svc.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    await svc.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    const h = await svc.health();
    expect(h.totalIssues).toBe(2);
    expect(h.issuesByStatus?.open).toBe(2);
  });
});

// =============================================================================
// Lifecycle Events
// =============================================================================
describe('Lifecycle Events', () => {
  it('creates lifecycle event with correct shape', () => {
    const evt = createLifecycleEvent('created', 'Issue created', 'system');
    expect(evt.eventId).toBeTruthy();
    expect(evt.type).toBe('created');
    expect(evt.actor).toBe('system');
    expect(evt.createdAt).toBeTruthy();
  });
});
