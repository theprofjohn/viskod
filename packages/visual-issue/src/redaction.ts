import type { RedactedTargetSummary, VisualIssue } from './types';

const REDACTION_RULES: Array<{
  pattern: RegExp;
  replacement: string | ((match: string) => string);
  label: string;
}> = [
  {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: '[EMAIL_REDACTED]',
    label: 'email',
  },
  { pattern: /\b(?:\d{4}[- ]?){3}\d{4}\b/g, replacement: '[CARD_REDACTED]', label: 'card-number' },
  {
    pattern:
      /(?:[?&])(token|access_token|refresh_token|id_token|api_key|apikey|key|secret|password|session|csrf|auth|authorization)=[^&\s]{4,}/gi,
    replacement: (match: string) => {
      const eq = match.indexOf('=');
      return `${match.slice(0, eq + 1)}[REDACTED]`;
    },
    label: 'query-param-sensitive',
  },
  {
    pattern:
      /\b(?:sk[-_]?(?:test|live)_[A-Za-z0-9]{3,}|pk[-_]?(?:test|live)_[A-Za-z0-9]{3,}|sk-[A-Za-z0-9]{6,}|pk-[A-Za-z0-9]{6,})/gi,
    replacement: '[API_KEY_REDACTED]',
    label: 'api-key',
  },
  {
    pattern:
      /(?<![?&_\w])\b(?:secret|password|passwd|pwd|token|access_token|refresh_token|id_token|api_key|apikey)\s*[:=]\s*['"]?(?:[A-Za-z0-9_\-./]{4,})/gi,
    replacement: '[SECRET_REDACTED]',
    label: 'assign-secret',
  },
  {
    pattern: /\b(?:[A-Za-z0-9+/]{16,})(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})\b/g,
    replacement: '[TOKEN_REDACTED]',
    label: 'base64-token',
  },
];

function applyTextRedaction(text: string): { text: string; redactions: string[] } {
  const applied: string[] = [];
  let result = text;
  for (const rule of REDACTION_RULES) {
    const replacement =
      typeof rule.replacement === 'function'
        ? result.replace(rule.pattern, rule.replacement as (match: string) => string)
        : result.replace(rule.pattern, rule.replacement);
    if (replacement !== result) {
      if (!applied.includes(rule.label)) applied.push(rule.label);
      result = replacement;
    }
  }
  return { text: result, redactions: applied };
}

export function redactIssueText(text: string, maxLength = 2000): string {
  const truncated = text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
  return applyTextRedaction(truncated).text;
}

export function redactIssue(issue: VisualIssue): {
  issue: VisualIssue;
  rules: string[];
  strippedFields: string[];
} {
  const allRules = new Set<string>();
  const strippedFields: string[] = [];

  const redactedTitle = applyTextRedaction(issue.title);
  for (const r of redactedTitle.redactions) allRules.add(r);

  const redactedDescription = issue.description ? applyTextRedaction(issue.description) : null;
  if (redactedDescription) for (const r of redactedDescription.redactions) allRules.add(r);

  const redactedPreview = issue.targetSummary.textPreview
    ? applyTextRedaction(issue.targetSummary.textPreview)
    : null;
  if (redactedPreview) for (const r of redactedPreview.redactions) allRules.add(r);

  const redactedLabel = issue.targetSummary.label
    ? applyTextRedaction(issue.targetSummary.label)
    : null;
  if (redactedLabel) for (const r of redactedLabel.redactions) allRules.add(r);

  const redactedLifecycle = issue.lifecycle.map((evt) => {
    const redactedSummary = applyTextRedaction(evt.summary);
    for (const r of redactedSummary.redactions) allRules.add(r);
    return { ...evt, summary: redactedSummary.text };
  });

  const redactedSnapshot = deepRedactSelectionSnapshot(issue.source.selectionSnapshot);
  const snapshotJson = JSON.stringify(redactedSnapshot);
  for (const rule of REDACTION_RULES) {
    const freshPattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    if (freshPattern.test(snapshotJson)) allRules.add(rule.label);
  }

  const redacted: VisualIssue = {
    ...issue,
    title: redactedTitle.text,
    description: redactedDescription?.text ?? issue.description,
    source: {
      ...issue.source,
      selectionSnapshot: redactedSnapshot,
    },
    targetSummary: {
      ...issue.targetSummary,
      textPreview: redactedPreview?.text ?? issue.targetSummary.textPreview,
      label: redactedLabel?.text ?? issue.targetSummary.label,
    },
    lifecycle: redactedLifecycle,
    redaction: {
      applied: allRules.size > 0,
      rules: [...allRules],
      strippedFields,
      warnings: [],
    },
  };

  return { issue: redacted, rules: [...allRules], strippedFields };
}

export function redactTargetSummary(summary: RedactedTargetSummary): RedactedTargetSummary {
  const redactedPreview = summary.textPreview ? applyTextRedaction(summary.textPreview) : null;
  const redactedLabel = summary.label ? applyTextRedaction(summary.label) : null;
  return {
    ...summary,
    textPreview: redactedPreview?.text ?? summary.textPreview,
    label: redactedLabel?.text ?? summary.label,
  };
}

export function deepRedactValue(value: unknown, depth = 0): unknown {
  if (depth > 20) return value;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    const { text } = applyTextRedaction(value);
    return text;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepRedactValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = deepRedactValue(val, depth + 1);
    }
    return result;
  }
  return value;
}

export function deepRedactSelectionSnapshot(
  snapshot: Record<string, unknown>,
): Record<string, unknown> {
  return deepRedactValue(snapshot) as Record<string, unknown>;
}

export function generateDefaultTitle(
  mode: 'single' | 'box',
  label?: string,
  role?: string,
  textPreview?: string,
  pageTitle?: string,
): string {
  const safe = (s: string | undefined, max: number) => (s ? redactIssueText(s, max) : undefined);

  if (mode === 'single') {
    const parts = [role, label || textPreview].filter(Boolean) as string[];
    if (parts.length > 0) {
      const title = parts.join(' · ');
      return title.length > 80 ? `${title.slice(0, 77)}…` : title;
    }
    if (textPreview) {
      const t = safe(textPreview, 80) as string;
      return t.length > 80 ? `${t.slice(0, 77)}…` : t;
    }
  } else {
    if (label) {
      const t = safe(label, 80) as string;
      return t.length > 80 ? `${t.slice(0, 77)}…` : t;
    }
    return 'Box selection';
  }

  const page = safe(pageTitle, 40) || 'page';
  return `Visual issue on ${page}`;
}
