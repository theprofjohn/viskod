import type { AgentHandoffGetOutput } from '@viskod/agent-handoff';
import type { CapturePipeline } from '@viskod/capture-pipeline';
import { buildAgentContextProjection } from '@viskod/context-engine';
import type { AgentContextProjection } from '@viskod/context-engine';
import {
  ErrorCategory,
  ErrorSeverity,
  type Result,
  type ViskodError,
  err,
  ok,
} from '@viskod/shared';

export interface HandoffCaptureContext {
  label: string;
  type: string;
  captureId: string;
  packetId: string;
  context: AgentContextProjection;
}

export type HandoffContextErrorCode =
  | 'HANDOFF_NO_PERSISTED_CAPTURE'
  | 'HANDOFF_CAPTURE_MISSING'
  | 'HANDOFF_CAPTURE_CORRUPT'
  | 'HANDOFF_CAPTURE_MISMATCH';

/**
 * Resolve a handoff's durable capture references into compact agent-safe
 * context projections (Phase 29).
 *
 * - loads the persisted handoff (caller) → resolves each `captureId` through
 *   the CapturePipeline (durable storage, schema-validated on load);
 * - missing captures and corrupt/mismatched packets return typed errors —
 *   never unrelated or malformed context;
 * - no absolute paths are ever exposed.
 */
export async function resolveHandoffCaptureContexts(
  handoff: AgentHandoffGetOutput,
  capturePipeline: CapturePipeline,
): Promise<Result<HandoffCaptureContext[]>> {
  const refs = handoff.context.packetRefs.filter((r) => r.captureId);
  if (refs.length === 0) {
    return err(
      hcError(
        'HANDOFF_NO_PERSISTED_CAPTURE',
        `Handoff '${handoff.handoffId}' references no durable persisted capture. Recapture the issue before requesting agent context.`,
      ),
    );
  }

  const captures: HandoffCaptureContext[] = [];
  for (const ref of refs) {
    const captureId = ref.captureId as string;
    const captureResult = await capturePipeline.getCapture(captureId);
    if (!captureResult.ok) {
      return err(
        hcError(
          'HANDOFF_CAPTURE_MISSING',
          `The capture referenced by handoff '${handoff.handoffId}' is missing. Create a fresh capture for this issue.`,
        ),
      );
    }
    const packetResult = await capturePipeline.loadPersistedPacket(captureId);
    if (!packetResult.ok) {
      if (packetResult.error.code === 'CP_PACKET_MISMATCH') {
        return err(
          hcError(
            'HANDOFF_CAPTURE_MISMATCH',
            `The capture referenced by handoff '${handoff.handoffId}' is inconsistent. Create a fresh capture for this issue.`,
          ),
        );
      }
      return err(
        hcError(
          'HANDOFF_CAPTURE_CORRUPT',
          `The capture referenced by handoff '${handoff.handoffId}' is corrupt. Create a fresh capture for this issue.`,
        ),
      );
    }
    captures.push({
      label: ref.label,
      type: ref.type,
      captureId,
      packetId: packetResult.value.packetId,
      context: buildAgentContextProjection(packetResult.value, {
        handoffId: handoff.handoffId,
        issueId: handoff.issueId,
        problem: {
          title: handoff.brief.title,
          summary: handoff.brief.summary,
          userNote: handoff.brief.userNote,
        },
        pageTitle: handoff.brief.page.title,
        targetFingerprint: handoff.brief.selectedTarget
          ? {
              targetCount: handoff.brief.selectedTarget.targetCount,
              confidence: handoff.brief.selectedTarget.confidence,
              resolutionStatus: handoff.brief.selectedTarget.resolutionStatus,
            }
          : undefined,
      }),
    });
  }
  return ok(captures);
}

function hcError(code: HandoffContextErrorCode, message: string): ViskodError {
  return {
    code,
    category: ErrorCategory.STORAGE,
    severity: ErrorSeverity.RECOVERABLE,
    message,
    correlationId: crypto.randomUUID(),
    subsystem: 'mcp-handoff-context',
    timestamp: new Date().toISOString(),
  };
}
