import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { VISKOD_STORAGE_DIR } from './constants';
import { applyRedaction, sanitizeErrorDetail } from './redaction';

export const FEEDBACK_SCHEMA_VERSION = 1;
export const FEEDBACK_NOTE_MAX = 4000;
export const FEEDBACK_TEXT_MAX = 4000;

export const FeedbackCategorySchema = z.enum([
  'workflow',
  'target-selection',
  'source-resolution',
  'agent-handoff',
  'verification',
  'setup-runtime',
  'accessibility',
  'documentation',
  'feature-request',
  'other',
]);
export const FeedbackUsefulnessSchema = z.enum(['yes', 'partly', 'no']);
export const FeedbackReasonSchema = z.enum([
  'wrong-target',
  'source-hint-not-useful',
  'missing-context',
  'agent-misunderstood-handoff',
  'verification-not-useful',
  'workflow-confusing',
  'other',
]);
const OpaqueId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const Uuid = z.string().uuid();
const Status = z.enum([
  'unknown',
  'unavailable',
  'starting',
  'running',
  'verified',
  'complete',
  'limited',
  'failed',
  'resolved',
  'ambiguous',
]);
const ProjectMode = z.enum(['single-package', 'workspace', 'unavailable']);

export const DiagnosticSummarySchema = z
  .object({
    diagnosticSchemaVersion: z.literal(FEEDBACK_SCHEMA_VERSION),
    viskodVersion: z.string().max(64),
    platform: z.string().max(32),
    architecture: z.string().max(32),
    nodeVersion: z.string().max(32),
    setupState: Status,
    mcpRuntime: Status,
    browserRuntime: Status,
    projectMode: ProjectMode,
    workspacePackageCount: z.number().int().min(0).max(10000),
    workflowStage: z.string().max(64),
    sourceResolutionStatus: Status,
    topSourceQualification: z.enum(['exact', 'probable', 'possible', 'weak', 'unavailable']),
    visualReviewStatus: Status,
    errorCodes: z.array(z.string().max(64)).max(20),
    studioHealth: Status,
  })
  .strict();
export type DiagnosticSummary = z.infer<typeof DiagnosticSummarySchema>;

export const FeedbackArtifactSchema = z
  .object({
    schemaVersion: z.literal(FEEDBACK_SCHEMA_VERSION),
    feedbackId: Uuid,
    createdAt: z.string().datetime(),
    requestId: Uuid,
    category: FeedbackCategorySchema,
    usefulness: FeedbackUsefulnessSchema.optional(),
    reasons: z.array(FeedbackReasonSchema).max(7).optional(),
    note: z.string().max(FEEDBACK_NOTE_MAX),
    issueId: OpaqueId.optional(),
    handoffId: OpaqueId.optional(),
    reviewId: OpaqueId.optional(),
    diagnosticsIncluded: z.boolean(),
    diagnostics: DiagnosticSummarySchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.diagnosticsIncluded && !v.diagnostics)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['diagnostics'],
        message: 'diagnostics required when enabled',
      });
    if (!v.diagnosticsIncluded && v.diagnostics)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['diagnostics'],
        message: 'diagnostics require explicit opt-in',
      });
  });
export type FeedbackArtifact = z.infer<typeof FeedbackArtifactSchema>;

export const FeedbackInputSchema = z
  .object({
    requestId: Uuid,
    category: FeedbackCategorySchema,
    usefulness: FeedbackUsefulnessSchema.optional(),
    reasons: z.array(FeedbackReasonSchema).max(7).optional(),
    note: z.string().max(FEEDBACK_NOTE_MAX).default(''),
    issueId: OpaqueId.optional(),
    handoffId: OpaqueId.optional(),
    reviewId: OpaqueId.optional(),
    diagnosticsIncluded: z.boolean().default(false),
    diagnostics: DiagnosticSummarySchema.optional(),
  })
  .strict();
export type FeedbackInput = z.input<typeof FeedbackInputSchema>;

export function collectFeedback(input: unknown, now = new Date()): FeedbackArtifact {
  const parsed = FeedbackInputSchema.parse(input);
  return FeedbackArtifactSchema.parse({
    ...parsed,
    schemaVersion: FEEDBACK_SCHEMA_VERSION,
    feedbackId: randomUUID(),
    createdAt: now.toISOString(),
    diagnostics: parsed.diagnosticsIncluded ? parsed.diagnostics : undefined,
  });
}

function cleanText(value: string, max = FEEDBACK_TEXT_MAX): string {
  return sanitizeErrorDetail(applyRedaction(value).text, max);
}
function safeArtifact(artifact: FeedbackArtifact): FeedbackArtifact {
  const parsed = FeedbackArtifactSchema.parse(artifact);
  return {
    ...parsed,
    note: cleanText(parsed.note, FEEDBACK_NOTE_MAX),
    diagnostics: parsed.diagnosticsIncluded ? parsed.diagnostics : undefined,
  };
}
export function generateFeedbackJsonReport(artifact: FeedbackArtifact): string {
  return JSON.stringify(safeArtifact(artifact), null, 2);
}
export type DiagnosticSummaryInput = Omit<DiagnosticSummary, 'diagnosticSchemaVersion'> & {
  diagnosticSchemaVersion?: number;
};

export function createDiagnosticSummary(input: DiagnosticSummaryInput): DiagnosticSummary {
  return DiagnosticSummarySchema.parse({
    ...input,
    diagnosticSchemaVersion: FEEDBACK_SCHEMA_VERSION,
  });
}
export function generateFeedbackMarkdownReport(artifact: FeedbackArtifact): string {
  const a = safeArtifact(artifact);
  const lines = ['# Viskod feedback', '', `Category: ${a.category}`];
  if (a.usefulness) lines.push(`Usefulness: ${a.usefulness}`);
  lines.push('', `What happened: ${cleanText(a.note)}`);
  if (a.reasons?.length) lines.push('', 'Reasons:', ...a.reasons.map((r) => `- ${r}`));
  if (a.diagnosticsIncluded && a.diagnostics) {
    const d = a.diagnostics;
    lines.push(
      '',
      'Diagnostics:',
      `- Viskod: ${cleanText(d.viskodVersion, 64)}`,
      `- Platform: ${cleanText(d.platform, 32)} / ${cleanText(d.architecture, 32)}`,
      `- Setup: ${d.setupState}`,
      `- MCP: ${d.mcpRuntime}`,
      `- Browser: ${d.browserRuntime}`,
      `- Project: ${d.projectMode} (${d.workspacePackageCount})`,
      `- Workflow: ${cleanText(d.workflowStage, 64)}`,
      `- Source resolution: ${d.sourceResolutionStatus}`,
      `- Review: ${d.visualReviewStatus}`,
    );
  }
  lines.push('', `Feedback ID: ${a.feedbackId}`);
  return `${lines.join('\n')}\n`;
}

export class FeedbackPersistence {
  readonly directory: string;
  private readonly inFlight = new Map<string, Promise<FeedbackArtifact>>();
  constructor(projectRoot = process.cwd()) {
    this.directory = join(projectRoot, VISKOD_STORAGE_DIR, 'feedback');
  }
  async save(artifact: FeedbackArtifact): Promise<FeedbackArtifact> {
    const checked = safeArtifact(artifact);
    const running = this.inFlight.get(checked.requestId);
    if (running) return running;
    const operation = this.saveOnce(checked).finally(() => {
      this.inFlight.delete(checked.requestId);
    });
    this.inFlight.set(checked.requestId, operation);
    return operation;
  }
  private async saveOnce(checked: FeedbackArtifact): Promise<FeedbackArtifact> {
    await fs.mkdir(this.directory, { recursive: true });
    const existing = await this.list();
    const duplicate = existing.find((x) => x.requestId === checked.requestId);
    if (duplicate) return duplicate;
    const file = join(this.directory, `${checked.feedbackId}.json`);
    const temp = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, generateFeedbackJsonReport(checked), 'utf8');
    await fs.rename(temp, file);
    return checked;
  }
  async list(): Promise<FeedbackArtifact[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.directory);
    } catch {
      return [];
    }
    const records: FeedbackArtifact[] = [];
    for (const name of entries.slice(0, 200)) {
      if (!name.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(join(this.directory, name), 'utf8');
        const parsed = FeedbackArtifactSchema.safeParse(JSON.parse(raw));
        if (parsed.success) records.push(parsed.data);
      } catch {
        /* malformed records are ignored */
      }
    }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export const DIAGNOSTIC_PREVIEW_INCLUDED = [
  'Viskod/runtime versions',
  'setup/browser/MCP status',
  'workspace type/count',
  'workflow/source/review status',
  'error codes',
] as const;
export const DIAGNOSTIC_PREVIEW_EXCLUDED = [
  'source code',
  'DOM text',
  'screenshots',
  'project paths',
  'credentials',
  'environment variables',
  'agent conversation',
] as const;
