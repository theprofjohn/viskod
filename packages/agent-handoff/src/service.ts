import type { EventBus } from '@viskod/event-bus';
import {
  ErrorCategory,
  ErrorSeverity,
  type Result,
  type ViskodError,
  err,
  ok,
} from '@viskod/shared';
import type { IssueService } from '@viskod/visual-issue';
import { generateAgentBrief, getDefaultConstraints } from './brief';
import {
  isValidHandoffTransition,
  makeHandoffCancelledEvent,
  makeHandoffCompletedEvent,
  makeHandoffCreatedEvent,
  makeHandoffFailedEvent,
  makeHandoffOpenedEvent,
  makeHandoffStatusChangeEvent,
} from './lifecycle';
import { HandoffPersistence } from './persistence';
import { redactAgentHandoff } from './redaction';
import type {
  AgentHandoff,
  AgentHandoffCreateInput,
  AgentHandoffCreateOutput,
  AgentHandoffErrorCode,
  AgentHandoffGetOutput,
  AgentHandoffListItem,
  AgentHandoffStatus,
} from './types';

export interface HandoffService {
  createHandoff(
    input: AgentHandoffCreateInput,
    sessionId: string,
    pageId: string,
  ): Promise<Result<AgentHandoffCreateOutput>>;
  getHandoff(handoffId: string): Promise<Result<AgentHandoffGetOutput>>;
  listHandoffs(): Promise<Result<AgentHandoffListItem[]>>;
  updateHandoffStatus(handoffId: string, status: AgentHandoffStatus): Promise<Result<AgentHandoff>>;
  cancelHandoff(handoffId: string): Promise<Result<AgentHandoff>>;
}

export class HandoffServiceImpl implements HandoffService {
  private persistence: HandoffPersistence;
  private issueService: IssueService;
  private eventBus: EventBus;

  constructor(eventBus: EventBus, issueService: IssueService, persistence?: HandoffPersistence) {
    this.eventBus = eventBus;
    this.issueService = issueService;
    this.persistence = persistence ?? new HandoffPersistence();
  }

  async createHandoff(
    input: AgentHandoffCreateInput,
    sessionId: string,
    pageId: string,
  ): Promise<Result<AgentHandoffCreateOutput>> {
    if (!input.issueId || typeof input.issueId !== 'string') {
      return err(this.heError('INVALID_ISSUE_ID', 'Invalid issue ID'));
    }

    const issueResult = await this.issueService.getIssue(input.issueId);
    if (!issueResult.ok) {
      return err(this.heError('ISSUE_NOT_FOUND', 'This issue was deleted and cannot be sent.'));
    }

    const issue = issueResult.value;

    if (issue.deletedAt) {
      return err(this.heError('ISSUE_DELETED', 'This issue was deleted and cannot be sent.'));
    }

    const warnings: string[] = [];
    if (issue.status === 'archived') {
      warnings.push('This issue is archived. The agent brief may reflect stale context.');
    }
    if (issue.targetSummary.resolutionStatus === 'ambiguous') {
      warnings.push('The selected target is ambiguous. The agent brief will include this warning.');
    }
    if (
      issue.targetSummary.resolutionStatus === 'stale' ||
      issue.targetSummary.resolutionStatus === 'missing'
    ) {
      return err(
        this.heError(
          'ISSUE_STALE',
          'The page context is missing. Create a fresh capture before sending this issue.',
        ),
      );
    }

    const now = new Date().toISOString();
    const handoffId = `handoff_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    const brief = generateAgentBrief(
      issue,
      input.userInstruction,
      input.includeSourceHints === false ? undefined : input.sourceHints,
      input.includeSourceHints === false ? undefined : input.sourceHintStatus,
    );
    const constraints = getDefaultConstraints();

    // Persisted issue evidence populates the handoff context; raw packet
    // paths are never exposed here.
    const packetRefs: AgentHandoff['context']['packetRefs'] = [];
    if (issue.evidence?.contextPacketId) {
      packetRefs.push({
        packetId: issue.evidence.contextPacketId,
        type: 'capture',
        label: 'issue capture',
      });
    }

    const handoff: AgentHandoff = {
      schemaVersion: 1,
      handoffId,
      issueId: input.issueId,
      sessionId,
      pageId,
      createdAt: now,
      updatedAt: now,
      status: 'ready',
      brief,
      context: {
        contextId: crypto.randomUUID(),
        issueRef: { issueId: input.issueId },
        packetRefs,
        selectionRef: {
          selectionId: issue.source.selectionId,
          snapshotIncluded: false,
        },
        evidenceSummary: {
          hasSelection: true,
          hasSourceHints:
            (issue.evidence?.sourceHintCount ?? 0) > 0 || (input.sourceHints?.length ?? 0) > 0,
          hasContextPacket:
            !!issue.evidence?.contextPacketId || input.includeContextPacket === true,
          hasConsoleEvidence: issue.evidence?.hasConsoleEvidence,
          hasNetworkEvidence: issue.evidence?.hasNetworkEvidence,
        },
      },
      constraints,
      lifecycle: [makeHandoffCreatedEvent()],
      redaction: { applied: false, rules: [], strippedFields: [], warnings },
    };

    const redacted = redactAgentHandoff(handoff);
    const saveResult = await this.persistence.saveHandoff(redacted.handoff);
    if (!saveResult.ok) return err(saveResult.error);

    this.eventBus.publish({
      eventId: crypto.randomUUID(),
      eventType: 'AH_EVENT:HANDOFF_CREATED',
      timestamp: now,
      version: '1.0.0',
      source: 'agent-handoff',
      correlationId: handoffId,
      payload: { handoffId, issueId: input.issueId, title: brief.title },
    });

    return ok({
      handoffId,
      issueId: input.issueId,
      status: 'ready',
      title: brief.title,
      summary: brief.summary,
      warningCount: warnings.length,
    });
  }

  async getHandoff(handoffId: string): Promise<Result<AgentHandoffGetOutput>> {
    if (!handoffId || typeof handoffId !== 'string') {
      return err(this.heError('INVALID_HANDOFF_ID', 'Invalid handoff ID'));
    }

    const result = await this.persistence.loadHandoff(handoffId);
    if (!result.ok) return err(result.error);

    let handoff = result.value;

    if (handoff.status === 'cancelled') {
      return err(this.heError('HANDOFF_ALREADY_CANCELLED', 'This handoff has been cancelled.'));
    }

    if (handoff.status === 'ready') {
      const now = new Date().toISOString();
      handoff = {
        ...handoff,
        status: 'opened',
        openedAt: now,
        updatedAt: now,
        lifecycle: [...handoff.lifecycle, makeHandoffOpenedEvent()],
      };

      const redacted = redactAgentHandoff(handoff);
      await this.persistence.saveHandoff(redacted.handoff);
      handoff = redacted.handoff;
    }

    return ok({
      handoffId: handoff.handoffId,
      issueId: handoff.issueId,
      status: handoff.status,
      brief: handoff.brief,
      context: handoff.context,
      constraints: handoff.constraints,
    });
  }

  async listHandoffs(): Promise<Result<AgentHandoffListItem[]>> {
    const result = await this.persistence.listHandoffs();
    if (!result.ok) return err(result.error);

    const items: AgentHandoffListItem[] = result.value.map((h) => ({
      handoffId: h.handoffId,
      issueId: h.issueId,
      title: h.brief.title,
      status: h.status,
      createdAt: h.createdAt,
      updatedAt: h.updatedAt,
    }));

    return ok(items);
  }

  async updateHandoffStatus(
    handoffId: string,
    status: AgentHandoffStatus,
  ): Promise<Result<AgentHandoff>> {
    if (!handoffId || typeof handoffId !== 'string') {
      return err(this.heError('INVALID_HANDOFF_ID', 'Invalid handoff ID'));
    }

    const result = await this.persistence.loadHandoff(handoffId);
    if (!result.ok) return err(result.error);

    const handoff = result.value;

    if (!isValidHandoffTransition(handoff.status, status)) {
      return err(
        this.heError(
          'INVALID_HANDOFF_TRANSITION',
          `Cannot transition from ${handoff.status} to ${status}`,
        ),
      );
    }

    const now = new Date().toISOString();
    const updated: AgentHandoff = {
      ...handoff,
      status,
      updatedAt: now,
      completedAt: status === 'completed' ? now : handoff.completedAt,
      cancelledAt: status === 'cancelled' ? now : handoff.cancelledAt,
      lifecycle: [...handoff.lifecycle, makeHandoffStatusChangeEvent(handoff.status, status)],
    };

    if (status === 'completed') {
      updated.lifecycle.push(makeHandoffCompletedEvent());
    } else if (status === 'failed') {
      updated.lifecycle.push(makeHandoffFailedEvent());
    } else if (status === 'cancelled') {
      updated.lifecycle.push(makeHandoffCancelledEvent());
    }

    const redacted = redactAgentHandoff(updated);
    const saveResult = await this.persistence.saveHandoff(redacted.handoff);
    if (!saveResult.ok) return err(saveResult.error);

    return ok(redacted.handoff);
  }

  async cancelHandoff(handoffId: string): Promise<Result<AgentHandoff>> {
    return this.updateHandoffStatus(handoffId, 'cancelled');
  }

  private heError(code: AgentHandoffErrorCode | string, message: string): ViskodError {
    return {
      code,
      category: ErrorCategory.RUNTIME,
      severity: ErrorSeverity.RECOVERABLE,
      message,
      correlationId: crypto.randomUUID(),
      subsystem: 'agent-handoff',
      timestamp: new Date().toISOString(),
    };
  }
}
