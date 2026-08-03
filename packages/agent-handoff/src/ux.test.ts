import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventBus } from '@viskod/event-bus';
import { IssuePersistence, IssueServiceImpl } from '@viskod/visual-issue';
import type { VisualSelection } from '@viskod/visual-selection';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HandoffPersistence, HandoffServiceImpl } from './index';
import { type SendToAgentResult, UserFacingHandoff } from './ux';

const TEST_DIR = path.join(process.cwd(), '.viskod-test-ux-handoff');
const TEST_SESSION_ID = 'ux-test-session';
const TEST_PAGE_ID = 'ux-test-page';

function makeIssuePersistence(): IssuePersistence {
  return new IssuePersistence(path.join(TEST_DIR, 'issues'));
}

function makeHandoffPersistence(): HandoffPersistence {
  return new HandoffPersistence(path.join(TEST_DIR, 'handoffs'));
}

function makeServices() {
  const eventBus = new EventBus();
  const issuePersistence = makeIssuePersistence();
  const issueService = new IssueServiceImpl(eventBus, issuePersistence);
  const handoffPersistence = makeHandoffPersistence();
  const handoffService = new HandoffServiceImpl(eventBus, issueService, handoffPersistence);
  const ux = new UserFacingHandoff(handoffService);
  return { eventBus, issueService, handoffService, ux };
}

function makeSelection(overrides: Partial<VisualSelection> = {}): VisualSelection {
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
// User Flow: VisualIssue → Send to agent → AgentHandoff
// =============================================================================
describe('User Flow: Issue → Send to Agent', () => {
  it('creates handoff from persisted issue via UX', async () => {
    const { issueService, ux } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const result = await ux.sendToAgent(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );

    expect(result.ok).toBe(true);
    expect(result.handoffId).toMatch(/^handoff_/);
    expect(result.title).toBeTruthy();
  });

  it('returns user-friendly error for missing issue', async () => {
    const { ux } = makeServices();
    const result = await ux.sendToAgent({ issueId: 'nonexistent' }, TEST_SESSION_ID, TEST_PAGE_ID);

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error).not.toContain('stack');
    expect(result.error).not.toContain('.viskod');
  });

  it('returns user-friendly error for deleted issue', async () => {
    const { issueService, ux } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    await issueService.deleteIssue(issue.value.issueId);
    const result = await ux.sendToAgent(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain('deleted');
  });
});

// =============================================================================
// Handoff Preview
// =============================================================================
describe('Handoff Preview', () => {
  it('preview does not expose packet paths', async () => {
    const { issueService, ux } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const sendResult = await ux.sendToAgent(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(sendResult.ok).toBe(true);
    if (!sendResult.ok || !sendResult.handoffId) return;

    const preview = await ux.getPreview(sendResult.handoffId);
    expect(preview).not.toBeNull();
    if (!preview) return;

    const json = JSON.stringify(preview);
    expect(json).not.toMatch(/\.viskod[/\\]/);
    expect(json).not.toMatch(/captures[/\\]/);
    expect(json).not.toMatch(/context[/\\]/);
    expect(json).not.toMatch(/C:[\\/]/);
  });

  it('preview does not expose raw JSON', async () => {
    const { issueService, ux } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const sendResult = await ux.sendToAgent(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(sendResult.ok).toBe(true);
    if (!sendResult.ok || !sendResult.handoffId) return;

    const preview = await ux.getPreview(sendResult.handoffId);
    expect(preview).not.toBeNull();
    if (!preview) return;

    expect(typeof preview.title).toBe('string');
    expect(typeof preview.summary).toBe('string');
    expect(preview.whatAgentReceives.length).toBeGreaterThan(0);
    expect(preview.whatAgentDoesNotReceive.length).toBeGreaterThan(0);
  });

  it('preview does not expose selectors', async () => {
    const { issueService, ux } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const sendResult = await ux.sendToAgent(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(sendResult.ok).toBe(true);
    if (!sendResult.ok || !sendResult.handoffId) return;

    const preview = await ux.getPreview(sendResult.handoffId);
    expect(preview).not.toBeNull();
    if (!preview) return;

    const json = JSON.stringify(preview);
    expect(json).not.toContain('data-testid');
    expect(json).not.toMatch(/\bclass="[^"]*"/);
    expect(json).not.toMatch(/querySelector/);
  });

  it('preview shows what agent receives and does not receive', async () => {
    const { issueService, ux } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const sendResult = await ux.sendToAgent(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(sendResult.ok).toBe(true);
    if (!sendResult.ok || !sendResult.handoffId) return;

    const preview = await ux.getPreview(sendResult.handoffId);
    expect(preview).not.toBeNull();
    if (!preview) return;

    expect(preview.whatAgentReceives).toContain('Issue title and summary');
    expect(preview.whatAgentReceives).toContain('Selected target summary');
    expect(preview.whatAgentReceives).toContain('Task objective and non-goals');
    expect(preview.whatAgentDoesNotReceive).toContain('Packet file paths');
    expect(preview.whatAgentDoesNotReceive).toContain('Raw issue JSON');
    expect(preview.whatAgentDoesNotReceive).toContain('CSS selectors as identity');
  });
});

// =============================================================================
// Confirmation
// =============================================================================
describe('Handoff Confirmation', () => {
  it('formatConfirmation shows opaque ID and safe next steps', async () => {
    const { issueService, ux } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const sendResult = await ux.sendToAgent(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(sendResult.ok).toBe(true);

    const confirmation = ux.formatConfirmation(sendResult);
    expect(confirmation).not.toBeNull();
    if (!confirmation) return;

    expect(confirmation.handoffId).toMatch(/^handoff_/);
    expect(confirmation.message).toBe('Handoff ready');
    expect(confirmation.nextSteps.length).toBeGreaterThan(0);
    expect(confirmation.nextSteps.some((s) => s.includes('MCP'))).toBe(true);
  });

  it('formatCreatedConfirmation produces safe copy', async () => {
    const { issueService, ux } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const sendResult = await ux.sendToAgent(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(sendResult.ok).toBe(true);

    const text = ux.formatCreatedConfirmation(sendResult);
    expect(text).toContain('Handoff ready');
    expect(text).toContain('handoff_');
    expect(text).toContain('MCP');
    expect(text).not.toContain('.viskod');
    expect(text).not.toContain('captures/');
  });

  it('formatCreatedConfirmation handles failure', async () => {
    const { ux } = makeServices();
    const result: SendToAgentResult = { ok: false, error: 'Issue not found' };
    const text = ux.formatCreatedConfirmation(result);
    expect(text).toContain('Failed');
    expect(text).toContain('Issue not found');
  });
});

// =============================================================================
// List and Cancel via UX
// =============================================================================
describe('UX List and Cancel', () => {
  it('lists handoffs via UX', async () => {
    const { issueService, ux } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    await ux.sendToAgent({ issueId: issue.value.issueId }, TEST_SESSION_ID, TEST_PAGE_ID);
    const list = await ux.listHandoffs();
    expect(list.length).toBe(1);
    expect(list[0]?.handoffId).toMatch(/^handoff_/);
  });

  it('cancels handoff via UX', async () => {
    const { issueService, ux } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const sendResult = await ux.sendToAgent(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(sendResult.ok).toBe(true);
    if (!sendResult.ok || !sendResult.handoffId) return;

    const cancelled = await ux.cancelHandoff(sendResult.handoffId);
    expect(cancelled).toBe(true);
  });
});

// =============================================================================
// User does not need to inspect packet paths
// =============================================================================
describe('No manual packet path inspection', () => {
  it('full flow uses only opaque IDs', async () => {
    const { issueService, ux } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    // Step 1: Send to agent — returns opaque handoff ID
    const sendResult = await ux.sendToAgent(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(sendResult.ok).toBe(true);
    if (!sendResult.ok || !sendResult.handoffId) return;

    // Verify handoff ID is opaque (no paths)
    expect(sendResult.handoffId).not.toContain('/');
    expect(sendResult.handoffId).not.toContain('\\');
    expect(sendResult.handoffId).not.toContain('.json');
    expect(sendResult.handoffId).not.toContain('.viskod');

    // Step 2: Get preview — uses only handoff ID
    const preview = await ux.getPreview(sendResult.handoffId);
    expect(preview).not.toBeNull();
    if (!preview) return;

    // Verify preview has no paths
    const previewJson = JSON.stringify(preview);
    expect(previewJson).not.toMatch(/\.viskod[/\\]/);
    expect(previewJson).not.toMatch(/C:[\\/]/);

    // Step 3: Confirmation — uses only handoff ID
    const confirmation = ux.formatConfirmation(sendResult);
    expect(confirmation).not.toBeNull();
    if (!confirmation) return;

    expect(confirmation.handoffId).toBe(sendResult.handoffId);
    expect(confirmation.nextSteps.some((s) => s.includes('.viskod'))).toBe(false);
    expect(confirmation.nextSteps.some((s) => s.includes('captures'))).toBe(false);
  });
});
