import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FeedbackArtifactSchema,
  FeedbackPersistence,
  collectFeedback,
  generateFeedbackJsonReport,
  generateFeedbackMarkdownReport,
} from './feedback';

const requestId = '550e8400-e29b-41d4-a716-446655440000';
const input = {
  requestId,
  category: 'agent-handoff' as const,
  usefulness: 'partly' as const,
  reasons: ['missing-context'] as const,
  note: 'Helpful but incomplete.',
};
const diagnostics = {
  diagnosticSchemaVersion: 1 as const,
  viskodVersion: '0.2.0',
  platform: 'linux',
  architecture: 'x64',
  nodeVersion: '22.0.0',
  setupState: 'complete' as const,
  mcpRuntime: 'verified' as const,
  browserRuntime: 'verified' as const,
  projectMode: 'workspace' as const,
  workspacePackageCount: 3,
  workflowStage: 'decided',
  sourceResolutionStatus: 'ambiguous' as const,
  topSourceQualification: 'possible' as const,
  visualReviewStatus: 'resolved' as const,
  errorCodes: ['E_TEST'],
  studioHealth: 'running' as const,
};

describe('feedback core', () => {
  it('bounds schema and rejects arbitrary nested values', () => {
    expect(
      FeedbackArtifactSchema.safeParse({ ...collectFeedback(input), note: 'x'.repeat(4001) })
        .success,
    ).toBe(false);
    expect(() => collectFeedback({ ...input, packet: { secret: 'x' } })).toThrow();
  });
  it('defaults diagnostics off and excludes diagnostic data', () => {
    const artifact = collectFeedback({ requestId, category: 'other', note: '' });
    expect(artifact.diagnosticsIncluded).toBe(false);
    expect(generateFeedbackJsonReport(artifact)).not.toContain('"diagnostics":');
  });
  it('persists atomically, skips malformed records, and dedupes request ids', async () => {
    const root = await mkdtemp(join(tmpdir(), 'viskod-feedback-'));
    const persistence = new FeedbackPersistence(root);
    const concurrent = collectFeedback({
      ...input,
      requestId: '550e8400-e29b-41d4-a716-446655440002',
    });
    const [concurrentA, concurrentB] = await Promise.all([
      persistence.save(concurrent),
      persistence.save(concurrent),
    ]);
    expect(concurrentA.feedbackId).toBe(concurrentB.feedbackId);
    await writeFile(join(root, '.viskod', 'feedback', 'bad.json'), '{bad', 'utf8');
    const listed = await persistence.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.feedbackId).toBe(concurrentA.feedbackId);
  });
  it('reports only safe allowlisted values and supports opt-in diagnostics', () => {
    const artifact = collectFeedback({
      ...input,
      requestId: '550e8400-e29b-41d4-a716-446655440001',
      note: 'token=abc /home/user/project',
      diagnosticsIncluded: true,
      diagnostics,
    });
    const json = generateFeedbackJsonReport(artifact);
    const markdown = generateFeedbackMarkdownReport(artifact);
    expect(json + markdown).not.toContain('/home/user/project');
    expect(json).toContain('"diagnostics":');
    expect(json).toContain('diagnostics');
    expect(markdown).toContain('MCP: verified');
  });
});
