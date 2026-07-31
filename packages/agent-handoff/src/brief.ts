import type { VisualIssue } from '@viskod/visual-issue';
import type { AgentIssueBrief, AgentHandoffConstraints } from './types';

const DEFAULT_OBJECTIVE = 'Investigate the selected UI issue, identify the likely source area, and propose or implement the smallest safe code change. Use the provided Viskod context as evidence, but verify in the repository before changing code.';

const DEFAULT_EXPECTED_OUTPUT = 'A description of the issue root cause and the minimal code change needed to fix it. Include file paths and line numbers where the change should be made.';

const REQUIRED_NON_GOALS = [
  'Do not rely on packet paths shown by the user.',
  'Do not expose raw packet JSON.',
  'Do not use unredacted secrets.',
  'Do not assume the selected node is still valid after navigation.',
  'Do not perform before/after visual review in this phase.',
  'Do not create a pull request unless a separate workflow requests it.',
];

export function generateAgentBrief(
  issue: VisualIssue,
  userInstruction?: string,
  sourceHints?: Array<{
    displayName: string;
    confidence?: number;
    kind?: string;
    score?: number;
    reasons?: string[];
    warnings?: string[];
  }>,
  sourceHintStatus?: 'ranked' | 'ambiguous' | 'low_confidence' | 'missing',
): AgentIssueBrief {
  const title = issue.title;
  const summary = buildSummary(issue);
  const userNote = userInstruction || issue.description;

  const task = {
    objective: DEFAULT_OBJECTIVE,
    expectedOutput: DEFAULT_EXPECTED_OUTPUT,
    nonGoals: [...REQUIRED_NON_GOALS],
  };

  const brief: AgentIssueBrief = {
    title,
    summary,
    userNote,
    issue: {
      status: issue.status,
      severity: issue.severity,
      tags: issue.tags,
    },
    page: {
      title: issue.page.title,
      route: issue.page.route,
      url: issue.page.url,
    },
    selectedTarget: {
      mode: issue.targetSummary.mode,
      label: issue.targetSummary.label,
      role: issue.targetSummary.role,
      textPreview: issue.targetSummary.textPreview,
      targetCount: issue.targetSummary.targetCount,
      confidence: issue.targetSummary.confidence,
      resolutionStatus: issue.targetSummary.resolutionStatus,
    },
    task,
  };

  if (sourceHints && sourceHints.length > 0) {
    brief.sourceHints = {
      count: sourceHints.length,
      status: sourceHintStatus ?? 'ranked',
      topHints: sourceHints.slice(0, 5),
    };
  }

  if (issue.targetSummary.resolutionStatus === 'ambiguous') {
    task.nonGoals.push('The selected target is ambiguous. Investigate all candidates before changing code.');
  }

  if (issue.targetSummary.resolutionStatus === 'stale') {
    task.nonGoals.push('The page context may be stale. Verify the current state before investigating.');
  }

  return brief;
}

function buildSummary(issue: VisualIssue): string {
  const parts: string[] = [];

  parts.push(`A visual issue on "${issue.page.title ?? issue.page.url}"`);
  parts.push(`involving a ${issue.targetSummary.mode === 'box' ? 'region' : 'UI element'}`);

  if (issue.targetSummary.label) {
    parts.push(`labeled "${issue.targetSummary.label}"`);
  }
  if (issue.targetSummary.role) {
    parts.push(`(role: ${issue.targetSummary.role})`);
  }

  parts.push(`with severity ${issue.severity}`);

  if (issue.targetSummary.resolutionStatus === 'ambiguous') {
    parts.push('⚠ The selected target is ambiguous — multiple candidates match.');
  }

  return parts.join(' ');
}

export function getDefaultConstraints(): AgentHandoffConstraints {
  return {
    localFirst: true,
    noRawPacketPaths: true,
    noRawJson: true,
    noSecrets: true,
    noAutonomousBrowserActions: true,
    requiresHumanReview: true,
    phaseBoundary: 'handoff-only',
  };
}

export function truncateBriefText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}
