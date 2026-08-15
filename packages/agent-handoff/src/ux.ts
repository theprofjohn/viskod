import type { HandoffService } from './service';
import type { AgentHandoffListItem } from './types';

export interface SendToAgentInput {
  issueId: string;
  userInstruction?: string;
  /** Include the persisted context packet reference in the handoff context. */
  includeContextPacket?: boolean;
  /** Include the persisted source hints in the agent brief. */
  includeSourceHints?: boolean;
  /** Source hints from the capture packet, passed through to the handoff brief. */
  sourceHints?: Array<{
    displayName: string;
    confidence?: number;
    kind?: string;
    score?: number;
    reasons?: string[];
    warnings?: string[];
    qualification?: 'exact' | 'probable' | 'possible' | 'weak';
  }>;
  sourceHintStatus?: 'ranked' | 'ambiguous' | 'low_confidence' | 'missing';
  /** Phase 30: semantic resolution state captured at issue time. */
  sourceHintResolution?: 'resolved' | 'ambiguous' | 'unavailable';
}

export interface SendToAgentResult {
  ok: boolean;
  handoffId?: string;
  title?: string;
  summary?: string;
  warningCount?: number;
  error?: string;
  warnings?: string[];
}

export interface HandoffPreview {
  handoffId: string;
  title: string;
  summary: string;
  userNote?: string;
  page: { title?: string; url?: string };
  selectedTarget: {
    mode: 'single' | 'box';
    label?: string;
    role?: string;
    textPreview?: string;
    targetCount: number;
  };
  warnings: string[];
  whatAgentReceives: string[];
  whatAgentDoesNotReceive: string[];
}

export interface HandoffConfirmation {
  handoffId: string;
  title: string;
  message: string;
  nextSteps: string[];
}

export class UserFacingHandoff {
  private handoffService: HandoffService;

  constructor(handoffService: HandoffService) {
    this.handoffService = handoffService;
  }

  async sendToAgent(
    input: SendToAgentInput,
    sessionId: string,
    pageId: string,
  ): Promise<SendToAgentResult> {
    const result = await this.handoffService.createHandoff(
      {
        issueId: input.issueId,
        userInstruction: input.userInstruction,
        includeContextPacket: input.includeContextPacket,
        includeSourceHints: input.includeSourceHints,
        sourceHints: input.sourceHints,
        sourceHintStatus: input.sourceHintStatus,
        sourceHintResolution: input.sourceHintResolution,
      },
      sessionId,
      pageId,
    );

    if (!result.ok) {
      return {
        ok: false,
        error: this.userFacingError(result.error.code),
      };
    }

    const warnings: string[] = [];
    if (result.value.warningCount > 0) {
      warnings.push('This issue has warnings. The agent brief will include them.');
    }

    return {
      ok: true,
      handoffId: result.value.handoffId,
      title: result.value.title,
      summary: result.value.summary,
      warningCount: result.value.warningCount,
      warnings,
    };
  }

  async getPreview(handoffId: string): Promise<HandoffPreview | null> {
    const result = await this.handoffService.getHandoff(handoffId);
    if (!result.ok) return null;

    const handoff = result.value;
    const warnings: string[] = [];

    if (handoff.brief.selectedTarget.resolutionStatus === 'ambiguous') {
      warnings.push('The selected target is ambiguous.');
    }
    if (handoff.brief.selectedTarget.resolutionStatus === 'stale') {
      warnings.push('The page context may be stale.');
    }

    return {
      handoffId: handoff.handoffId,
      title: handoff.brief.title,
      summary: handoff.brief.summary,
      userNote: handoff.brief.userNote,
      page: handoff.brief.page,
      selectedTarget: handoff.brief.selectedTarget,
      warnings,
      whatAgentReceives: [
        'Issue title and summary',
        'Selected target summary',
        'Page context (title, route)',
        'Task objective and non-goals',
        'Source hints (if available)',
      ],
      whatAgentDoesNotReceive: [
        'Packet file paths',
        'Raw issue JSON',
        'Raw packet JSON',
        'CSS selectors as identity',
        'Cookies, tokens, credentials',
        'Full DOM text',
        'Local filesystem paths',
      ],
    };
  }

  formatConfirmation(result: SendToAgentResult): HandoffConfirmation | null {
    if (!result.ok || !result.handoffId) return null;

    return {
      handoffId: result.handoffId,
      title: result.title ?? '',
      message: 'Handoff ready',
      nextSteps: [
        `Give this handoff ID to your coding agent: ${result.handoffId}`,
        'The agent can fetch the issue context through Viskod MCP.',
        'The agent will receive a safe brief with the issue context.',
      ],
    };
  }

  formatCreatedConfirmation(result: SendToAgentResult): string {
    if (!result.ok || !result.handoffId) {
      return `Failed to create handoff: ${result.error ?? 'Unknown error'}`;
    }

    const lines = [
      'Handoff ready',
      '',
      `Issue: ${result.title}`,
      `Agent context ID: ${result.handoffId}`,
      '',
      'Use this in your coding agent session.',
      'The agent can fetch the issue context through Viskod MCP.',
    ];

    if (result.warnings && result.warnings.length > 0) {
      lines.push('');
      lines.push('Warnings:');
      for (const w of result.warnings) {
        lines.push(`  - ${w}`);
      }
    }

    return lines.join('\n');
  }

  async listHandoffs(): Promise<AgentHandoffListItem[]> {
    const result = await this.handoffService.listHandoffs();
    return result.ok ? result.value : [];
  }

  async cancelHandoff(handoffId: string): Promise<boolean> {
    const result = await this.handoffService.cancelHandoff(handoffId);
    return result.ok;
  }

  private userFacingError(code: string): string {
    const errors: Record<string, string> = {
      ISSUE_NOT_FOUND: 'This issue was deleted and cannot be sent.',
      ISSUE_DELETED: 'This issue was deleted and cannot be sent.',
      ISSUE_STALE: 'The page context is missing. Create a fresh capture before sending this issue.',
      INVALID_ISSUE_ID: 'Invalid issue ID.',
      HANDOFF_NOT_FOUND: 'Handoff not found.',
      HANDOFF_ALREADY_CANCELLED: 'This handoff has been cancelled.',
      INVALID_HANDOFF_TRANSITION: 'Cannot update handoff to that status.',
    };
    return errors[code] ?? 'An unexpected error occurred.';
  }
}
