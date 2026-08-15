import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventBus } from '@viskod/event-bus';
import { IssuePersistence, IssueServiceImpl } from '@viskod/visual-issue';
import type { VisualIssue } from '@viskod/visual-issue';
import type { VisualSelection } from '@viskod/visual-selection';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateAgentBrief, getDefaultConstraints, truncateBriefText } from './brief';
import { HandoffPersistence, HandoffServiceImpl } from './index';
import {
  isValidHandoffTransition,
  makeHandoffCreatedEvent,
  makeHandoffStatusChangeEvent,
} from './lifecycle';
import { deepRedactValue, redactAgentHandoff } from './redaction';
import { AgentHandoffSchema } from './schemas';
import type { AgentHandoff } from './types';

const TEST_DIR = path.join(process.cwd(), '.viskod-test-handoffs');
const TEST_SESSION_ID = 'test-session-1';
const TEST_PAGE_ID = 'test-page-1';

function makeIssuePersistence(): IssuePersistence {
  return new IssuePersistence(path.join(TEST_DIR, 'issues'));
}

function makeHandoffPersistence(): HandoffPersistence {
  return new HandoffPersistence(path.join(TEST_DIR, 'handoffs'));
}

function makeEventBus(): EventBus {
  return new EventBus();
}

function makeServices() {
  const eventBus = makeEventBus();
  const issuePersistence = makeIssuePersistence();
  const issueService = new IssueServiceImpl(eventBus, issuePersistence);
  const handoffPersistence = makeHandoffPersistence();
  const handoffService = new HandoffServiceImpl(eventBus, issueService, handoffPersistence);
  return { eventBus, issueService, handoffService, issuePersistence, handoffPersistence };
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
describe('AgentHandoff Schema Validation', () => {
  it('validates a valid handoff', () => {
    const handoff: AgentHandoff = {
      schemaVersion: 1,
      handoffId: 'handoff_test123',
      issueId: crypto.randomUUID(),
      sessionId: TEST_SESSION_ID,
      pageId: TEST_PAGE_ID,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'ready',
      brief: {
        title: 'Button · Save',
        summary: 'A visual issue on Settings',
        issue: { status: 'open', severity: 'medium', tags: [] },
        page: { title: 'Settings', url: 'https://example.com' },
        selectedTarget: {
          mode: 'single',
          label: 'Save',
          targetCount: 1,
          confidence: 0.9,
          resolutionStatus: 'resolved',
        },
        task: { objective: 'Investigate', expectedOutput: 'Propose fix', nonGoals: ['No PR'] },
      },
      context: {
        contextId: crypto.randomUUID(),
        issueRef: { issueId: crypto.randomUUID() },
        packetRefs: [],
        selectionRef: { selectionId: crypto.randomUUID(), snapshotIncluded: false },
        evidenceSummary: { hasSelection: true, hasSourceHints: false, hasContextPacket: false },
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
    const result = AgentHandoffSchema.safeParse(handoff);
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const handoff = {
      schemaVersion: 1,
      handoffId: 'handoff_test123',
      issueId: crypto.randomUUID(),
      sessionId: TEST_SESSION_ID,
      pageId: TEST_PAGE_ID,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'invalid_status',
      brief: {
        title: 'Test',
        summary: 'Test',
        issue: { status: 'open', severity: 'medium', tags: [] },
        page: {},
        selectedTarget: {
          mode: 'single',
          targetCount: 1,
          confidence: 0.5,
          resolutionStatus: 'resolved',
        },
        task: { objective: 'Test', expectedOutput: 'Test', nonGoals: [] },
      },
      context: {
        contextId: 'c1',
        issueRef: { issueId: 'i1' },
        packetRefs: [],
        selectionRef: { selectionId: 's1', snapshotIncluded: false },
        evidenceSummary: { hasSelection: true, hasSourceHints: false, hasContextPacket: false },
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
    const result = AgentHandoffSchema.safeParse(handoff);
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// Handoff ID Opacity
// =============================================================================
describe('Handoff ID', () => {
  it('handoff IDs are opaque and prefixed', async () => {
    const { handoffService, issueService } = makeServices();
    const issueResult = await issueService.createIssue(
      makeSelection(),
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(issueResult.ok).toBe(true);
    if (!issueResult.ok) return;

    const result = await handoffService.createHandoff(
      { issueId: issueResult.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.handoffId).toMatch(/^handoff_[a-f0-9]{16}$/);
      expect(result.value.handoffId).not.toBe(result.value.issueId);
    }
  });
});

// =============================================================================
// Create Handoff
// =============================================================================
describe('Create Handoff', () => {
  it('creates handoff from single issue', async () => {
    const { handoffService, issueService } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const result = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('ready');
      expect(result.value.title).toBeTruthy();
      expect(result.value.summary).toBeTruthy();
      expect(result.value.warningCount).toBe(0);
    }
  });

  it('creates handoff from box issue', async () => {
    const { handoffService, issueService } = makeServices();
    const issue = await issueService.createIssue(makeBoxSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const result = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('ready');
    }
  });

  it('rejects missing issue', async () => {
    const { handoffService } = makeServices();
    const result = await handoffService.createHandoff(
      { issueId: 'nonexistent-id' },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects deleted issue', async () => {
    const { handoffService, issueService } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    await issueService.deleteIssue(issue.value.issueId);
    const result = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(result.ok).toBe(false);
  });

  it('warns on archived issue', async () => {
    const { handoffService, issueService } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    await issueService.archiveIssue(issue.value.issueId);
    const result = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.warningCount).toBeGreaterThan(0);
    }
  });

  it('includes user instruction in brief', async () => {
    const { handoffService, issueService } = makeServices();
    const issue = await issueService.createIssue(
      makeSelection(),
      TEST_SESSION_ID,
      TEST_PAGE_ID,
      'Button issue',
      'Fix the button',
    );
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const result = await handoffService.createHandoff(
      { issueId: issue.value.issueId, userInstruction: 'Please fix the contrast' },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toContain('Button issue');
    }
  });

  it('rejects stale issue', async () => {
    const { issueService } = makeServices();
    const sel = makeSelection({
      resolution: { status: 'stale', confidence: 0.3, resolvedAt: new Date().toISOString() },
    });
    const issue = await issueService.createIssue(sel, TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(false);
  });
});

// =============================================================================
// Brief Generation
// =============================================================================
describe('Brief Generation', () => {
  it('generates brief with required fields', () => {
    const issue: VisualIssue = {
      schemaVersion: 1,
      issueId: crypto.randomUUID(),
      sessionId: TEST_SESSION_ID,
      pageId: TEST_PAGE_ID,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'open',
      severity: 'high',
      title: 'Button · Save',
      description: 'Fix the button',
      source: { createdFrom: 'visual-selection', selectionId: 's1', selectionSnapshot: {} },
      page: {
        url: 'https://example.com',
        title: 'Settings',
        viewport: { width: 1280, height: 720 },
      },
      targetSummary: {
        mode: 'single',
        label: 'Save',
        role: 'button',
        targetCount: 1,
        confidence: 0.9,
        resolutionStatus: 'resolved',
      },
      tags: ['ui-bug'],
      lifecycle: [],
      redaction: { applied: false, rules: [], strippedFields: [], warnings: [] },
    };

    const brief = generateAgentBrief(issue);
    expect(brief.title).toBe('Button · Save');
    expect(brief.userNote).toBe('Fix the button');
    expect(brief.issue.status).toBe('open');
    expect(brief.issue.severity).toBe('high');
    expect(brief.issue.tags).toContain('ui-bug');
    expect(brief.page.title).toBe('Settings');
    expect(brief.selectedTarget.label).toBe('Save');
    expect(brief.task.objective).toBeTruthy();
    expect(brief.task.nonGoals.length).toBeGreaterThan(0);
  });

  it('brief is deterministic for same input', () => {
    const issue: VisualIssue = {
      schemaVersion: 1,
      issueId: 'id1',
      sessionId: TEST_SESSION_ID,
      pageId: TEST_PAGE_ID,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      status: 'open',
      severity: 'medium',
      title: 'Test',
      source: { createdFrom: 'visual-selection', selectionId: 's1', selectionSnapshot: {} },
      page: { url: 'https://example.com', viewport: { width: 1280, height: 720 } },
      targetSummary: {
        mode: 'single',
        targetCount: 1,
        confidence: 0.9,
        resolutionStatus: 'resolved',
      },
      tags: [],
      lifecycle: [],
      redaction: { applied: false, rules: [], strippedFields: [], warnings: [] },
    };

    const brief1 = generateAgentBrief(issue);
    const brief2 = generateAgentBrief(issue);
    expect(JSON.stringify(brief1)).toBe(JSON.stringify(brief2));
  });

  it('includes ambiguity warning when target is ambiguous', () => {
    const issue: VisualIssue = {
      schemaVersion: 1,
      issueId: 'id1',
      sessionId: TEST_SESSION_ID,
      pageId: TEST_PAGE_ID,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      status: 'open',
      severity: 'medium',
      title: 'Test',
      source: { createdFrom: 'visual-selection', selectionId: 's1', selectionSnapshot: {} },
      page: { url: 'https://example.com', viewport: { width: 1280, height: 720 } },
      targetSummary: {
        mode: 'single',
        targetCount: 1,
        confidence: 0.4,
        resolutionStatus: 'ambiguous',
      },
      tags: [],
      lifecycle: [],
      redaction: { applied: false, rules: [], strippedFields: [], warnings: [] },
    };

    const brief = generateAgentBrief(issue);
    expect(brief.task.nonGoals.some((g) => g.includes('ambiguous'))).toBe(true);
  });

  it('includes source hints when provided', () => {
    const issue: VisualIssue = {
      schemaVersion: 1,
      issueId: 'id1',
      sessionId: TEST_SESSION_ID,
      pageId: TEST_PAGE_ID,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      status: 'open',
      severity: 'medium',
      title: 'Test',
      source: { createdFrom: 'visual-selection', selectionId: 's1', selectionSnapshot: {} },
      page: { url: 'https://example.com', viewport: { width: 1280, height: 720 } },
      targetSummary: {
        mode: 'single',
        targetCount: 1,
        confidence: 0.9,
        resolutionStatus: 'resolved',
      },
      tags: [],
      lifecycle: [],
      redaction: { applied: false, rules: [], strippedFields: [], warnings: [] },
    };

    const hints = [
      {
        displayName: 'src/components/Button.tsx',
        confidence: 0.85,
        qualification: 'probable' as const,
        reasons: ['unique visible text', 'imported by current route'],
      },
    ];
    const brief = generateAgentBrief(issue, undefined, hints, 'ranked', 'resolved');
    expect(brief.sourceHints).toBeDefined();
    expect(brief.sourceHints?.count).toBe(1);
    expect(brief.sourceHints?.topHints[0]?.displayName).toBe('src/components/Button.tsx');
    // Phase 30: qualification + resolution survive brief generation.
    expect(brief.sourceHints?.topHints[0]?.qualification).toBe('probable');
    expect(brief.sourceHints?.resolution).toBe('resolved');
  });

  it('brief does not contain packet paths', () => {
    const issue: VisualIssue = {
      schemaVersion: 1,
      issueId: 'id1',
      sessionId: TEST_SESSION_ID,
      pageId: TEST_PAGE_ID,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      status: 'open',
      severity: 'medium',
      title: 'Test',
      source: { createdFrom: 'visual-selection', selectionId: 's1', selectionSnapshot: {} },
      page: { url: 'https://example.com', viewport: { width: 1280, height: 720 } },
      targetSummary: {
        mode: 'single',
        targetCount: 1,
        confidence: 0.9,
        resolutionStatus: 'resolved',
      },
      tags: [],
      lifecycle: [],
      redaction: { applied: false, rules: [], strippedFields: [], warnings: [] },
    };

    const brief = generateAgentBrief(issue);
    const json = JSON.stringify(brief);
    expect(json).not.toContain('.viskod');
    expect(json).not.toContain('captures');
    expect(json).not.toContain('context/');
  });

  it('truncates text correctly', () => {
    expect(truncateBriefText('hello', 10)).toBe('hello');
    expect(truncateBriefText('hello world', 5)).toBe('hell…');
    expect(truncateBriefText('abc', 3)).toBe('abc');
  });
});

// =============================================================================
// Default Constraints
// =============================================================================
describe('Default Constraints', () => {
  it('has correct safety defaults', () => {
    const c = getDefaultConstraints();
    expect(c.localFirst).toBe(true);
    expect(c.noRawPacketPaths).toBe(true);
    expect(c.noRawJson).toBe(true);
    expect(c.noSecrets).toBe(true);
    expect(c.noAutonomousBrowserActions).toBe(true);
    expect(c.requiresHumanReview).toBe(true);
    expect(c.phaseBoundary).toBe('handoff-only');
  });
});

// =============================================================================
// Lifecycle
// =============================================================================
describe('Handoff Lifecycle', () => {
  it('validates transitions correctly', () => {
    expect(isValidHandoffTransition('draft', 'ready')).toBe(true);
    expect(isValidHandoffTransition('draft', 'cancelled')).toBe(true);
    expect(isValidHandoffTransition('ready', 'opened')).toBe(true);
    expect(isValidHandoffTransition('ready', 'cancelled')).toBe(true);
    expect(isValidHandoffTransition('opened', 'in_progress')).toBe(true);
    expect(isValidHandoffTransition('opened', 'cancelled')).toBe(true);
    expect(isValidHandoffTransition('in_progress', 'completed')).toBe(true);
    expect(isValidHandoffTransition('in_progress', 'failed')).toBe(true);
    expect(isValidHandoffTransition('in_progress', 'cancelled')).toBe(true);
    expect(isValidHandoffTransition('completed', 'ready')).toBe(false);
    expect(isValidHandoffTransition('cancelled', 'ready')).toBe(false);
    expect(isValidHandoffTransition('failed', 'ready')).toBe(false);
  });

  it('creates lifecycle event with correct shape', () => {
    const evt = makeHandoffCreatedEvent();
    expect(evt.eventId).toBeTruthy();
    expect(evt.type).toBe('created');
    expect(evt.actor).toBe('system');
    expect(evt.createdAt).toBeTruthy();
  });

  it('creates status change event with before/after', () => {
    const evt = makeHandoffStatusChangeEvent('ready', 'opened');
    expect(evt.type).toBe('status_changed');
    expect(evt.changes?.status?.before).toBe('ready');
    expect(evt.changes?.status?.after).toBe('opened');
  });
});

// =============================================================================
// Redaction
// =============================================================================
describe('Redaction', () => {
  it('redacts API key from brief title', () => {
    const input = 'API key sk_test_abc123def456 is here';
    const result = deepRedactValue(input);
    expect(result).not.toContain('sk_test_abc123def456');
    expect(result).toContain('[API_KEY_REDACTED]');
  });

  it('redacts email from brief', () => {
    const input = 'Contact user@example.com';
    const result = deepRedactValue(input);
    expect(result).not.toContain('user@example.com');
    expect(result).toContain('[EMAIL_REDACTED]');
  });

  it('redacts credit card', () => {
    const input = 'Card: 4111 1111 1111 1111';
    const result = deepRedactValue(input);
    expect(result).toContain('[CARD_REDACTED]');
  });

  it('redacts nested object values', () => {
    const input = { key: 'sk_test_abc123def456', nested: { val: 'user@test.com' } };
    const result = deepRedactValue(input) as Record<string, unknown>;
    expect(result.key).not.toContain('sk_test_abc123def456');
    expect((result.nested as Record<string, unknown>).val).not.toContain('user@test.com');
  });

  it('redacts array elements', () => {
    const input = ['sk_test_abc123def456', 'clean text'];
    const result = deepRedactValue(input) as string[];
    expect(result[0]).not.toContain('sk_test_abc123def456');
    expect(result[1]).toBe('clean text');
  });

  it('redactAgentHandoff redacts all brief fields', () => {
    const handoff = makeTestHandoff({
      brief: {
        ...makeTestHandoff().brief,
        title: 'Key: sk_test_abc123def456',
        summary: 'Email: user@example.com',
        userNote: 'Card: 4111 1111 1111 1111',
      },
    });

    const { handoff: redacted, rules } = redactAgentHandoff(handoff);
    expect(redacted.brief.title).not.toContain('sk_test_abc123def456');
    expect(redacted.brief.summary).not.toContain('user@example.com');
    expect(redacted.brief.userNote).not.toContain('4111 1111 1111 1111');
    expect(rules.length).toBeGreaterThan(0);
  });

  it('full persisted handoff JSON contains no raw secrets', () => {
    const handoff = makeTestHandoff({
      brief: {
        ...makeTestHandoff().brief,
        title: 'sk_test_abc123def456 button',
        summary: 'Email: user@example.com',
        userNote: 'Token: Bearer abc.def.ghi',
        selectedTarget: {
          ...makeTestHandoff().brief.selectedTarget,
          textPreview: 'sk_test_abc123def456',
          label: 'user@example.com',
        },
      },
    });

    const { handoff: redacted } = redactAgentHandoff(handoff);
    const json = JSON.stringify(redacted);
    expect(json).not.toContain('sk_test_abc123def456');
    expect(json).not.toContain('user@example.com');
    expect(json).not.toContain('abc.def.ghi');
  });
});

// =============================================================================
// Persistence
// =============================================================================
describe('Persistence', () => {
  it('handoff file is written to disk', async () => {
    const { handoffService, issueService, handoffPersistence } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const result = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const handoffDir = path.join(handoffPersistence.getBaseDir(), result.value.handoffId);
      expect(fs.existsSync(handoffDir)).toBe(true);
      expect(fs.existsSync(path.join(handoffDir, 'handoff.json'))).toBe(true);
    }
  });

  it('handoff survives process restart', async () => {
    const { handoffService, issueService, handoffPersistence, eventBus } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const createResult = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(createResult.ok).toBe(true);
    const handoffId = createResult.ok ? createResult.value.handoffId : '';

    // New service instance = simulated restart
    const newIssueService = new IssueServiceImpl(eventBus, makeIssuePersistence());
    const newHandoffService = new HandoffServiceImpl(eventBus, newIssueService, handoffPersistence);
    const listResult = await newHandoffService.listHandoffs();
    expect(listResult.ok).toBe(true);
    if (listResult.ok) {
      expect(listResult.value.length).toBe(1);
      expect(listResult.value[0]?.handoffId).toBe(handoffId);
    }
  });

  it('handles corrupt handoff file gracefully', async () => {
    const { handoffService, issueService, handoffPersistence } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const createResult = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(createResult.ok).toBe(true);
    if (createResult.ok) {
      const filePath = path.join(
        handoffPersistence.getBaseDir(),
        createResult.value.handoffId,
        'handoff.json',
      );
      fs.writeFileSync(filePath, '{invalid json', 'utf-8');
      const loadResult = await handoffService.getHandoff(createResult.value.handoffId);
      expect(loadResult.ok).toBe(false);
    }
  });

  it('list returns deterministic order (updatedAt desc)', async () => {
    const { handoffService, issueService } = makeServices();
    const issue1 = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    const issue2 = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue1.ok && issue2.ok).toBe(true);
    if (!issue1.ok || !issue2.ok) return;

    await handoffService.createHandoff(
      { issueId: issue1.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    await new Promise((r) => setTimeout(r, 10));
    await handoffService.createHandoff(
      { issueId: issue2.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );

    const list = await handoffService.listHandoffs();
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.value.length).toBe(2);
      expect(list.value[0]!.createdAt >= list.value[1]!.createdAt).toBe(true);
    }
  });
});

// =============================================================================
// Get Handoff (MCP/Tool)
// =============================================================================
describe('Get Handoff (Agent Fetch)', () => {
  it('returns safe brief and context', async () => {
    const { handoffService, issueService } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const createResult = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const getResult = await handoffService.getHandoff(createResult.value.handoffId);
    expect(getResult.ok).toBe(true);
    if (getResult.ok) {
      expect(getResult.value.handoffId).toBeTruthy();
      expect(getResult.value.brief).toBeTruthy();
      expect(getResult.value.context).toBeTruthy();
      expect(getResult.value.constraints).toBeTruthy();
      expect(getResult.value.constraints.noRawPacketPaths).toBe(true);
      expect(getResult.value.constraints.noRawJson).toBe(true);
      expect(getResult.value.constraints.noSecrets).toBe(true);
    }
  });

  it('marks handoff as opened on first fetch', async () => {
    const { handoffService, issueService } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const createResult = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const getResult = await handoffService.getHandoff(createResult.value.handoffId);
    expect(getResult.ok).toBe(true);
    if (getResult.ok) {
      expect(getResult.value.status).toBe('opened');
    }
  });

  it('no packet paths in output', async () => {
    const { handoffService, issueService } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const createResult = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const getResult = await handoffService.getHandoff(createResult.value.handoffId);
    expect(getResult.ok).toBe(true);
    if (getResult.ok) {
      const json = JSON.stringify(getResult.value);
      expect(json).not.toContain('.viskod');
      expect(json).not.toContain('captures/');
      expect(json).not.toContain('context/');
    }
  });

  it('no raw JSON in output', async () => {
    const { handoffService, issueService } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const createResult = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const getResult = await handoffService.getHandoff(createResult.value.handoffId);
    expect(getResult.ok).toBe(true);
    if (getResult.ok) {
      expect(typeof getResult.value.brief).not.toBe('string');
      expect(getResult.value.brief.title).toBeTruthy();
    }
  });

  it('rejects cancelled handoff', async () => {
    const { handoffService, issueService } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const createResult = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    await handoffService.cancelHandoff(createResult.value.handoffId);
    const getResult = await handoffService.getHandoff(createResult.value.handoffId);
    expect(getResult.ok).toBe(false);
  });
});

// =============================================================================
// Update Status (MCP/Tool)
// =============================================================================
describe('Update Handoff Status', () => {
  it('transitions ready → opened → in_progress → completed', async () => {
    const { handoffService, issueService } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const createResult = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    // Mark opened via get
    await handoffService.getHandoff(createResult.value.handoffId);

    const update1 = await handoffService.updateHandoffStatus(
      createResult.value.handoffId,
      'in_progress',
    );
    expect(update1.ok).toBe(true);
    if (update1.ok) {
      expect(update1.value.status).toBe('in_progress');
      expect(update1.value.lifecycle.length).toBeGreaterThanOrEqual(2);
    }

    const update2 = await handoffService.updateHandoffStatus(
      createResult.value.handoffId,
      'completed',
    );
    expect(update2.ok).toBe(true);
    if (update2.ok) {
      expect(update2.value.status).toBe('completed');
      expect(update2.value.completedAt).toBeTruthy();
    }
  });

  it('rejects invalid transition', async () => {
    const { handoffService, issueService } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const createResult = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const result = await handoffService.updateHandoffStatus(
      createResult.value.handoffId,
      'completed',
    );
    expect(result.ok).toBe(false);
  });
});

// =============================================================================
// Cancel Handoff (MCP/Tool)
// =============================================================================
describe('Cancel Handoff', () => {
  it('cancels a ready handoff', async () => {
    const { handoffService, issueService } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const createResult = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const cancelResult = await handoffService.cancelHandoff(createResult.value.handoffId);
    expect(cancelResult.ok).toBe(true);
    if (cancelResult.ok) {
      expect(cancelResult.value.status).toBe('cancelled');
      expect(cancelResult.value.cancelledAt).toBeTruthy();
    }
  });

  it('cancelled handoff cannot be listed as active', async () => {
    const { handoffService, issueService } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const createResult = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    await handoffService.cancelHandoff(createResult.value.handoffId);
    const getResult = await handoffService.getHandoff(createResult.value.handoffId);
    expect(getResult.ok).toBe(false);
  });
});

// =============================================================================
// Handoff from Archived Issue
// =============================================================================
describe('Archived Issue Handoff', () => {
  it('creates handoff from archived issue with warning', async () => {
    const { handoffService, issueService } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    await issueService.archiveIssue(issue.value.issueId);
    const result = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.warningCount).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// MCP/Tool Schema Tests
// =============================================================================
describe('MCP/Tool Schema', () => {
  it('create output has required fields', async () => {
    const { handoffService, issueService } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const result = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.handoffId).toBeTruthy();
      expect(result.value.issueId).toBeTruthy();
      expect(result.value.status).toBe('ready');
      expect(result.value.title).toBeTruthy();
      expect(result.value.summary).toBeTruthy();
      expect(typeof result.value.warningCount).toBe('number');
    }
  });

  it('get output has required fields', async () => {
    const { handoffService, issueService } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const createResult = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const getResult = await handoffService.getHandoff(createResult.value.handoffId);
    expect(getResult.ok).toBe(true);
    if (getResult.ok) {
      expect(getResult.value.handoffId).toBeTruthy();
      expect(getResult.value.issueId).toBeTruthy();
      expect(getResult.value.status).toBeTruthy();
      expect(getResult.value.brief).toBeTruthy();
      expect(getResult.value.context).toBeTruthy();
      expect(getResult.value.constraints).toBeTruthy();
    }
  });

  it('list output has required fields', async () => {
    const { handoffService, issueService } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    const listResult = await handoffService.listHandoffs();
    expect(listResult.ok).toBe(true);
    if (listResult.ok) {
      expect(listResult.value.length).toBeGreaterThan(0);
      const item = listResult.value[0]!;
      expect(item.handoffId).toBeTruthy();
      expect(item.issueId).toBeTruthy();
      expect(item.title).toBeTruthy();
      expect(item.status).toBeTruthy();
      expect(item.createdAt).toBeTruthy();
      expect(item.updatedAt).toBeTruthy();
    }
  });
});

// =============================================================================
// Helper to create test handoff for redaction tests
// =============================================================================
function makeTestHandoff(overrides: Partial<AgentHandoff> = {}): AgentHandoff {
  return {
    schemaVersion: 1,
    handoffId: 'handoff_test123',
    issueId: crypto.randomUUID(),
    sessionId: TEST_SESSION_ID,
    pageId: TEST_PAGE_ID,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'ready',
    brief: {
      title: 'Button · Save',
      summary: 'A visual issue on Settings',
      issue: { status: 'open', severity: 'medium', tags: [] },
      page: { title: 'Settings', url: 'https://example.com' },
      selectedTarget: {
        mode: 'single',
        label: 'Save',
        targetCount: 1,
        confidence: 0.9,
        resolutionStatus: 'resolved',
      },
      task: { objective: 'Investigate', expectedOutput: 'Propose fix', nonGoals: ['No PR'] },
    },
    context: {
      contextId: crypto.randomUUID(),
      issueRef: { issueId: crypto.randomUUID() },
      packetRefs: [],
      selectionRef: { selectionId: crypto.randomUUID(), snapshotIncluded: false },
      evidenceSummary: { hasSelection: true, hasSourceHints: false, hasContextPacket: false },
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
    ...overrides,
  };
}
