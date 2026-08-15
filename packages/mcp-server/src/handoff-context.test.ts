import * as fs from 'node:fs';
import * as path from 'node:path';
import { HandoffPersistence, HandoffServiceImpl } from '@viskod/agent-handoff';
import { CapturePipeline } from '@viskod/capture-pipeline';
import { EventBus } from '@viskod/event-bus';
import { IssuePersistence, IssueServiceImpl } from '@viskod/visual-issue';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveHandoffCaptureContexts } from './handoff-context';

const TEST_DIR = path.join(process.cwd(), '.viskod-test-handoff-context');
const TEST_SESSION_ID = 'hc-test-session';
const TEST_PAGE_ID = 'hc-test-page';

function makeSelection() {
  return {
    schemaVersion: 1 as const,
    selectionId: crypto.randomUUID(),
    sessionId: TEST_SESSION_ID,
    pageId: TEST_PAGE_ID,
    mode: 'single' as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    page: {
      url: 'http://example.test/settings',
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
  };
}

function makePacketJson(captureId: string, text: string): string {
  return JSON.stringify({
    packetId: crypto.randomUUID(),
    schemaVersion: '1.1.0',
    timestamp: new Date().toISOString(),
    captureId,
    captureStatus: 'partial',
    evidence: {
      dom: { state: 'collected' },
      hierarchy: { state: 'collected' },
      styles: { state: 'collected' },
      screenshot: { state: 'omitted_sensitive' },
      runtime: { state: 'collected' },
      sourceHints: { state: 'unavailable' },
    },
    browser: {
      url: 'http://example.test/settings',
      viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
      userAgent: 'HC-Test',
    },
    selection: {
      selector: '[data-testid="save-btn"]',
      tagName: 'button',
      boundingBox: { x: 0, y: 0, width: 100, height: 40 },
      text,
    },
    dom: { tagName: 'button', attributes: { 'data-testid': 'save-btn' }, childCount: 0, depth: 1 },
    styles: { computed: { color: 'red' }, layout: null },
    hierarchy: {
      selectedNode: { tagName: 'button', depth: 1 },
      parents: [{ tagName: 'form', depth: 2, text: 'Settings form' }],
      siblings: [],
      children: [],
    },
    screenshots: [
      {
        captureId: 'shot-1',
        type: 'selection',
        path: null,
        width: 100,
        height: 40,
        format: 'png',
        sizeBytes: 0,
        status: 'omitted_sensitive',
        sensitive: true,
      },
    ],
    confidence: {
      sourceMapping: null,
      semanticLabeling: null,
      layoutAnalysis: null,
      frameworkDetection: null,
    },
    metadata: {
      engineVersion: '1.0.0',
      processingTimeMs: 1,
      evidenceSources: ['browser-runtime'],
      redactions: [],
      capturePolicy: { screenshot: 'omitted_sensitive' },
    },
    diagnostics: [],
    sourceHints: [],
    runtimeEvidence: {
      console: [{ level: 'error', message: 'save failed', timestamp: 'now' }],
    },
  });
}

async function createIssueWithCapture(
  issueService: IssueServiceImpl,
  pipeline: CapturePipeline,
): Promise<{ issueId: string; captureId: string }> {
  const captureId = crypto.randomUUID();
  await pipeline.persistCapture({
    captureId,
    packetJson: makePacketJson(captureId, 'Save changes button'),
  });
  const issue = await issueService.createIssue(
    makeSelection(),
    TEST_SESSION_ID,
    TEST_PAGE_ID,
    'Save button broken',
    'Problem:\nSave does nothing\n\nExpected result:\nIt saves',
    'medium',
    {
      contextPacketId: crypto.randomUUID(),
      captureId,
      sourceHintCount: 0,
      redactionApplied: true,
    },
  );
  if (!issue.ok) throw new Error('issue creation failed');
  return { issueId: issue.value.issueId, captureId };
}

describe('resolveHandoffCaptureContexts', () => {
  let pipeline: CapturePipeline;
  let handoffService: HandoffServiceImpl;
  let issueService: IssueServiceImpl;

  beforeEach(async () => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    const eventBus = new EventBus();
    pipeline = new CapturePipeline(path.join(TEST_DIR, 'captures'));
    issueService = new IssueServiceImpl(
      eventBus,
      new IssuePersistence(path.join(TEST_DIR, 'issues')),
    );
    handoffService = new HandoffServiceImpl(
      eventBus,
      issueService,
      new HandoffPersistence(path.join(TEST_DIR, 'handoffs')),
    );
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('resolves the durable capture into a compact agent-safe projection', async () => {
    const { issueId, captureId } = await createIssueWithCapture(issueService, pipeline);
    const created = await handoffService.createHandoff({ issueId }, TEST_SESSION_ID, TEST_PAGE_ID);
    expect(created.ok).toBe(true);

    const handoffResult = await handoffService.getHandoff(
      created.ok ? created.value.handoffId : '',
    );
    expect(handoffResult.ok).toBe(true);
    if (!handoffResult.ok) return;

    const resolved = await resolveHandoffCaptureContexts(handoffResult.value, pipeline);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value).toHaveLength(1);
    const ctx = resolved.value[0];
    expect(ctx).toBeTruthy();
    if (!ctx) return;
    expect(ctx.captureId).toBe(captureId);
    expect(ctx.context.target.text).toContain('Save changes');
    expect(ctx.context.page.url).toBe('http://example.test/settings');
    expect(ctx.context.problem?.title).toBe('Save button broken');
    expect(ctx.context.evidence.screenshot.state).toBe('omitted_sensitive');
    expect(ctx.context.screenshot.sensitive).toBe(true);
    // Compact: bounded console summary present.
    expect(ctx.context.runtime.console?.[0]?.sample).toContain('save failed');
    // No absolute paths anywhere.
    const json = JSON.stringify(ctx);
    expect(json).not.toContain('captureDir');
    expect(json).not.toContain('packet.json');
    expect(json).not.toContain(TEST_DIR);
  });

  it('handoff without a durable capture reference → typed error', async () => {
    const issue = await issueService.createIssue(
      makeSelection(),
      TEST_SESSION_ID,
      TEST_PAGE_ID,
      'No capture',
      'desc',
      'medium',
      { contextPacketId: crypto.randomUUID(), redactionApplied: true },
    );
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;
    const created = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(created.ok).toBe(true);
    const handoffResult = await handoffService.getHandoff(
      created.ok ? created.value.handoffId : '',
    );
    expect(handoffResult.ok).toBe(true);
    if (!handoffResult.ok) return;

    const resolved = await resolveHandoffCaptureContexts(handoffResult.value, pipeline);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.error.code).toBe('HANDOFF_NO_PERSISTED_CAPTURE');
  });

  it('referenced capture missing from disk → typed actionable failure', async () => {
    const { issueId } = await createIssueWithCapture(issueService, pipeline);
    // Delete the capture after the handoff was created.
    const created = await handoffService.createHandoff({ issueId }, TEST_SESSION_ID, TEST_PAGE_ID);
    expect(created.ok).toBe(true);
    const handoffResult = await handoffService.getHandoff(
      created.ok ? created.value.handoffId : '',
    );
    expect(handoffResult.ok).toBe(true);
    if (!handoffResult.ok) return;
    const captureId = handoffResult.value.context.packetRefs[0]?.captureId;
    expect(captureId).toBeTruthy();
    if (!captureId) return;
    await pipeline.deleteCapture(captureId);

    const resolved = await resolveHandoffCaptureContexts(handoffResult.value, pipeline);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.error.code).toBe('HANDOFF_CAPTURE_MISSING');
  });

  it('corrupt persisted packet → typed corruption failure, never partial context', async () => {
    const { issueId, captureId } = await createIssueWithCapture(issueService, pipeline);
    const created = await handoffService.createHandoff({ issueId }, TEST_SESSION_ID, TEST_PAGE_ID);
    expect(created.ok).toBe(true);
    fs.writeFileSync(
      path.join(TEST_DIR, 'captures', captureId, 'packet.json'),
      '{corrupt',
      'utf-8',
    );
    const handoffResult = await handoffService.getHandoff(
      created.ok ? created.value.handoffId : '',
    );
    expect(handoffResult.ok).toBe(true);
    if (!handoffResult.ok) return;

    const resolved = await resolveHandoffCaptureContexts(handoffResult.value, pipeline);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.error.code).toBe('HANDOFF_CAPTURE_CORRUPT');
  });

  it('corrupt persisted SOURCE data (invalid qualification) → typed corruption failure', async () => {
    const { issueId, captureId } = await createIssueWithCapture(issueService, pipeline);
    const created = await handoffService.createHandoff({ issueId }, TEST_SESSION_ID, TEST_PAGE_ID);
    expect(created.ok).toBe(true);
    const tampered = JSON.parse(makePacketJson(captureId, 'Save changes button'));
    tampered.sourceHints = [
      {
        filePath: 'src/components/TargetCard.jsx',
        confidence: 0.54,
        qualification: 'certain',
        reasons: ['not a recognized qualification'],
      },
    ];
    fs.writeFileSync(
      path.join(TEST_DIR, 'captures', captureId, 'packet.json'),
      JSON.stringify(tampered),
      'utf-8',
    );
    const handoffResult = await handoffService.getHandoff(
      created.ok ? created.value.handoffId : '',
    );
    expect(handoffResult.ok).toBe(true);
    if (!handoffResult.ok) return;

    const resolved = await resolveHandoffCaptureContexts(handoffResult.value, pipeline);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.error.code).toBe('HANDOFF_CAPTURE_CORRUPT');
  });

  it('a persisted packet with a resolution snapshot reports the CAPTURE-TIME conclusion', async () => {
    // Persist a packet whose candidates alone would derive 'ambiguous' (two
    // tied possible candidates) but whose capture-time snapshot concluded
    // 'resolved'. Fresh retrieval must report the persisted conclusion.
    const captureId = crypto.randomUUID();
    const packet = JSON.parse(makePacketJson(captureId, 'Save changes button'));
    packet.sourceHints = [
      {
        filePath: 'src/components/TargetCard.jsx',
        displayPath: 'src/components/TargetCard.jsx',
        confidence: 0.54,
        qualification: 'possible',
        reasons: ['visible text found only in this file'],
      },
      {
        filePath: 'src/components/OtherCard.jsx',
        displayPath: 'src/components/OtherCard.jsx',
        confidence: 0.54,
        qualification: 'possible',
        reasons: ['visible text also appears in other files'],
      },
    ];
    packet.sourceHintsResolution = {
      status: 'resolved',
      modelVersion: '2.0.0',
      topCandidate: 'src/components/TargetCard.jsx',
    };
    packet.evidence.sourceHints.state = 'collected';
    const persisted = await pipeline.persistCapture({
      captureId,
      packetJson: JSON.stringify(packet),
    });
    expect(persisted.ok).toBe(true);

    const issue = await issueService.createIssue(
      makeSelection(),
      TEST_SESSION_ID,
      TEST_PAGE_ID,
      'Resolved source',
      'desc',
      'medium',
      {
        contextPacketId: crypto.randomUUID(),
        captureId,
        sourceHintCount: 2,
        redactionApplied: true,
      },
    );
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;
    const created = await handoffService.createHandoff(
      { issueId: issue.value.issueId },
      TEST_SESSION_ID,
      TEST_PAGE_ID,
    );
    expect(created.ok).toBe(true);
    const handoffResult = await handoffService.getHandoff(
      created.ok ? created.value.handoffId : '',
    );
    expect(handoffResult.ok).toBe(true);
    if (!handoffResult.ok) return;

    const resolved = await resolveHandoffCaptureContexts(handoffResult.value, pipeline);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const sh = resolved.value[0]?.context.sourceHints;
    expect(sh?.resolution).toBe('resolved');
    expect(sh?.resolutionSource).toBe('persisted');
    expect(sh?.modelVersion).toBe('2.0.0');
    // Candidates preserved verbatim, in persisted order, qualifications
    // unchanged — no rerank, no re-derivation.
    expect(sh?.candidates.map((c) => c.path)).toEqual([
      'src/components/TargetCard.jsx',
      'src/components/OtherCard.jsx',
    ]);
    for (const c of sh?.candidates ?? []) {
      expect(c.qualification).toBe('possible');
      expect(c.confidence).toBe(0.54);
    }
  });

  it('persisted packet mismatching the capture id → typed mismatch failure', async () => {
    const { issueId, captureId } = await createIssueWithCapture(issueService, pipeline);
    const created = await handoffService.createHandoff({ issueId }, TEST_SESSION_ID, TEST_PAGE_ID);
    expect(created.ok).toBe(true);
    fs.writeFileSync(
      path.join(TEST_DIR, 'captures', captureId, 'packet.json'),
      makePacketJson(crypto.randomUUID(), 'other capture'),
      'utf-8',
    );
    const handoffResult = await handoffService.getHandoff(
      created.ok ? created.value.handoffId : '',
    );
    expect(handoffResult.ok).toBe(true);
    if (!handoffResult.ok) return;

    const resolved = await resolveHandoffCaptureContexts(handoffResult.value, pipeline);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.error.code).toBe('HANDOFF_CAPTURE_MISMATCH');
  });
});

describe('opaque id validation', () => {
  it('traversal/absolute-path identifiers are rejected before lookup', async () => {
    const eventBus = new EventBus();
    const issueService = new IssueServiceImpl(
      eventBus,
      new IssuePersistence(path.join(TEST_DIR, 'issues')),
    );
    const handoffService = new HandoffServiceImpl(
      eventBus,
      issueService,
      new HandoffPersistence(path.join(TEST_DIR, 'handoffs')),
    );
    const malicious = ['../', '..\\..\\secret', 'C:\\Users\\victim', '/etc/passwd', '..%2f..%2f'];
    for (const id of malicious) {
      const got = await handoffService.getHandoff(id);
      expect(got.ok, `id '${id}' must be rejected`).toBe(false);
      if (!got.ok) expect(got.error.code).toBe('INVALID_HANDOFF_ID');
    }
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });
});

describe('handoff persistence traversal hardening', () => {
  it('saveHandoff rejects malicious handoff ids', async () => {
    const persistence = new HandoffPersistence(path.join(TEST_DIR, 'handoffs'));
    const handoff = {
      handoffId: '../evil',
      issueId: 'i',
      sessionId: 's',
      pageId: 'p',
    } as unknown as Parameters<HandoffPersistence['saveHandoff']>[0];
    const result = await persistence.saveHandoff(handoff);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_HANDOFF_ID');
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });
});
