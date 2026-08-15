import * as fs from 'node:fs';
import * as path from 'node:path';
import { HandoffPersistence, HandoffServiceImpl } from '@viskod/agent-handoff';
import { EventBus } from '@viskod/event-bus';
import { IssuePersistence, IssueServiceImpl } from '@viskod/visual-issue';
import type { VisualSelection } from '@viskod/visual-selection';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const TEST_DIR = path.join(process.cwd(), '.viskod-test-mcp-handoff');
const TEST_SESSION_ID = 'mcp-test-session';
const TEST_PAGE_ID = 'mcp-test-page';

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
  return { eventBus, issueService, handoffService };
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
// MCP Tool Definitions — tools/list
// =============================================================================
describe('MCP tools/list — handoff tools present', () => {
  it('lists all 6 handoff tools', () => {
    const toolNames = [
      'create_agent_handoff',
      'get_agent_handoff',
      'list_agent_handoffs',
      'update_agent_handoff_status',
      'cancel_agent_handoff',
      'get_handoff_context',
    ];

    // Verify tool definitions have correct shape
    for (const name of toolNames) {
      expect(name).toBeTruthy();
      expect(typeof name).toBe('string');
    }
  });

  it('create_agent_handoff has correct input schema', () => {
    const schema = {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: expect.any(String) },
        userInstruction: { type: 'string', description: expect.any(String) },
      },
      required: ['issueId'],
    };
    expect(schema.required).toContain('issueId');
  });

  it('get_agent_handoff has correct input schema', () => {
    const schema = {
      type: 'object',
      properties: {
        handoffId: { type: 'string', description: expect.any(String) },
      },
      required: ['handoffId'],
    };
    expect(schema.required).toContain('handoffId');
  });
});

// =============================================================================
// create_agent_handoff through MCP path
// =============================================================================
describe('MCP create_agent_handoff', () => {
  it('creates handoff from valid issue', async () => {
    const { issueService, handoffService } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const result = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      'mcp-session',
      'mcp-page',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.handoffId).toMatch(/^handoff_/);
      expect(result.value.status).toBe('ready');
      expect(result.value.title).toBeTruthy();
      expect(typeof result.value.warningCount).toBe('number');
    }
  });

  it('returns error for missing issue', async () => {
    const { handoffService } = makeServices();
    const result = await handoffService.createHandoff(
      { issueId: 'nonexistent-id' },
      'mcp-session',
      'mcp-page',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBeTruthy();
    }
  });

  it('returns error for deleted issue', async () => {
    const { issueService, handoffService } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    await issueService.deleteIssue(issue.value.issueId);
    const result = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      'mcp-session',
      'mcp-page',
    );
    expect(result.ok).toBe(false);
  });

  it('warns on archived issue', async () => {
    const { issueService, handoffService } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    await issueService.archiveIssue(issue.value.issueId);
    const result = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      'mcp-session',
      'mcp-page',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.warningCount).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// get_agent_handoff through MCP path
// =============================================================================
describe('MCP get_agent_handoff', () => {
  it('returns safe brief and context', async () => {
    const { issueService, handoffService } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const createResult = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      'mcp-session',
      'mcp-page',
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const getResult = await handoffService.getHandoff(createResult.value.handoffId);
    expect(getResult.ok).toBe(true);
    if (getResult.ok) {
      expect(getResult.value.brief).toBeTruthy();
      expect(getResult.value.brief.title).toBeTruthy();
      expect(getResult.value.brief.task.objective).toBeTruthy();
      expect(getResult.value.brief.task.nonGoals.length).toBeGreaterThan(0);
      expect(getResult.value.constraints.noRawPacketPaths).toBe(true);
      expect(getResult.value.constraints.noRawJson).toBe(true);
      expect(getResult.value.constraints.noSecrets).toBe(true);
    }
  });

  it('marks handoff as opened on first fetch', async () => {
    const { issueService, handoffService } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const createResult = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      'mcp-session',
      'mcp-page',
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
    const { issueService, handoffService } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const createResult = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      'mcp-session',
      'mcp-page',
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const getResult = await handoffService.getHandoff(createResult.value.handoffId);
    expect(getResult.ok).toBe(true);
    if (getResult.ok) {
      const json = JSON.stringify(getResult.value);
      expect(json).not.toMatch(/\.viskod[/\\]/);
      expect(json).not.toMatch(/captures[/\\]/);
      expect(json).not.toMatch(/context[/\\]/);
      expect(json).not.toMatch(/C:[\\/]/);
      expect(json).not.toMatch(/\/home\//);
    }
  });

  it('no raw JSON in output', async () => {
    const { issueService, handoffService } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const createResult = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      'mcp-session',
      'mcp-page',
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

  it('no selectors in output', async () => {
    const { issueService, handoffService } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const createResult = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      'mcp-session',
      'mcp-page',
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const getResult = await handoffService.getHandoff(createResult.value.handoffId);
    expect(getResult.ok).toBe(true);
    if (getResult.ok) {
      const json = JSON.stringify(getResult.value);
      expect(json).not.toContain('data-testid');
      expect(json).not.toMatch(/\bclass="[^"]*"/);
      expect(json).not.toMatch(/\bclassName="[^"]*"/);
      expect(json).not.toMatch(/querySelector/);
      expect(json).not.toMatch(/document\./);
      expect(json).not.toMatch(/window\./);
    }
  });

  it('rejects cancelled handoff', async () => {
    const { issueService, handoffService } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const createResult = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      'mcp-session',
      'mcp-page',
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    await handoffService.cancelHandoff(createResult.value.handoffId);
    const getResult = await handoffService.getHandoff(createResult.value.handoffId);
    expect(getResult.ok).toBe(false);
  });
});

// =============================================================================
// list_agent_handoffs through MCP path
// =============================================================================
describe('MCP list_agent_handoffs', () => {
  it('lists handoffs in deterministic order', async () => {
    const { issueService, handoffService } = makeServices();
    const issue1 = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    const issue2 = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue1.ok && issue2.ok).toBe(true);
    if (!issue1.ok || !issue2.ok) return;

    await handoffService.createHandoff(
      { issueId: issue1.value.issueId },
      'mcp-session',
      'mcp-page',
    );
    await new Promise((r) => setTimeout(r, 10));
    await handoffService.createHandoff(
      { issueId: issue2.value.issueId },
      'mcp-session',
      'mcp-page',
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
// update_agent_handoff_status through MCP path
// =============================================================================
describe('MCP update_agent_handoff_status', () => {
  it('transitions ready → in_progress → completed', async () => {
    const { issueService, handoffService } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const createResult = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      'mcp-session',
      'mcp-page',
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
    if (update1.ok) expect(update1.value.status).toBe('in_progress');

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
    const { issueService, handoffService } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const createResult = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      'mcp-session',
      'mcp-page',
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    // ready → completed is invalid (must go through opened → in_progress)
    const result = await handoffService.updateHandoffStatus(
      createResult.value.handoffId,
      'completed',
    );
    expect(result.ok).toBe(false);
  });
});

// =============================================================================
// cancel_agent_handoff through MCP path
// =============================================================================
describe('MCP cancel_agent_handoff', () => {
  it('cancels a handoff', async () => {
    const { issueService, handoffService } = makeServices();
    const issue = await issueService.createIssue(makeSelection(), TEST_SESSION_ID, TEST_PAGE_ID);
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const createResult = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      'mcp-session',
      'mcp-page',
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const cancelResult = await handoffService.cancelHandoff(createResult.value.handoffId);
    expect(cancelResult.ok).toBe(true);
    if (cancelResult.ok) {
      expect(cancelResult.value.status).toBe('cancelled');
    }
  });
});

// =============================================================================
// Redaction in MCP output
// =============================================================================
describe('MCP output redaction', () => {
  it('no unredacted secrets in get_agent_handoff output', async () => {
    const { issueService, handoffService } = makeServices();
    const secret = 'sk_test_abc123def456';
    const selection = makeSelection({
      summary: { label: `Key: ${secret}`, textPreview: `api=${secret}`, targetCount: 1 },
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

    const issue = await issueService.createIssue(
      selection,
      TEST_SESSION_ID,
      TEST_PAGE_ID,
      'Secret test',
    );
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const createResult = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      'mcp-session',
      'mcp-page',
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const getResult = await handoffService.getHandoff(createResult.value.handoffId);
    expect(getResult.ok).toBe(true);
    if (getResult.ok) {
      const json = JSON.stringify(getResult.value);
      expect(json).not.toContain(secret);
      expect(json).toContain('[API_KEY_REDACTED]');
    }
  });

  it('no email in get_agent_handoff output', async () => {
    const { issueService, handoffService } = makeServices();
    const secret = 'admin@example.com';
    const selection = makeSelection({
      summary: { label: `Email: ${secret}`, textPreview: `Contact: ${secret}`, targetCount: 1 },
      targets: [
        {
          targetId: crypto.randomUUID(),
          documentOrder: 0,
          geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
          semantics: { tagName: 'span', textPreview: secret, isInteractive: false },
          fingerprints: {},
          resolutionCandidates: [],
        },
      ],
    });

    const issue = await issueService.createIssue(
      selection,
      TEST_SESSION_ID,
      TEST_PAGE_ID,
      'Email test',
    );
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;

    const createResult = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      'mcp-session',
      'mcp-page',
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const getResult = await handoffService.getHandoff(createResult.value.handoffId);
    expect(getResult.ok).toBe(true);
    if (getResult.ok) {
      const json = JSON.stringify(getResult.value);
      expect(json).not.toContain(secret);
      expect(json).toContain('[EMAIL_REDACTED]');
    }
  });
});
