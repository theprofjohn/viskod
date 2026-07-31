import type { AgentHandoff, AgentIssueBrief } from './types';

const REDACTION_RULES: Array<{ pattern: RegExp; replacement: string; label: string }> = [
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: '[EMAIL_REDACTED]', label: 'email' },
  { pattern: /\b(?:\d{4}[- ]?){3}\d{4}\b/g, replacement: '[CARD_REDACTED]', label: 'card-number' },
  {
    pattern: /\bBearer\s+[A-Za-z0-9_\-\.]{4,}/gi,
    replacement: '[SECRET_REDACTED]',
    label: 'bearer-token',
  },
  {
    pattern: /(?:[?&])(token|access_token|refresh_token|id_token|api_key|apikey|key|secret|password|session|csrf|auth|authorization)=[^&\s]{4,}/gi,
    replacement: (match: string) => { const eq = match.indexOf('='); return `${match.slice(0, eq + 1)}[REDACTED]`; },
    label: 'query-param-sensitive',
  },
  {
    pattern: /\b(?:sk[-_]?(?:test|live)_[A-Za-z0-9]{3,}|pk[-_]?(?:test|live)_[A-Za-z0-9]{3,}|sk-[A-Za-z0-9]{6,}|pk-[A-Za-z0-9]{6,})/gi,
    replacement: '[API_KEY_REDACTED]', label: 'api-key',
  },
  {
    pattern: /(?<![?&_\w])\b(?:secret|password|passwd|pwd|token|access_token|refresh_token|id_token|api_key|apikey)\s*[:=]\s*['"]?(?:[A-Za-z0-9_\-./]{4,})/gi,
    replacement: '[SECRET_REDACTED]', label: 'assign-secret',
  },
  {
    pattern: /\b(?:[A-Za-z0-9+/]{16,})(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})\b/g,
    replacement: '[TOKEN_REDACTED]', label: 'base64-token',
  },
];

function applyTextRedaction(text: string): { text: string; redactions: string[] } {
  const applied: string[] = [];
  let result = text;
  for (const rule of REDACTION_RULES) {
    const replacement = typeof rule.replacement === 'function'
      ? result.replace(rule.pattern, rule.replacement as (match: string) => string)
      : result.replace(rule.pattern, rule.replacement);
    if (replacement !== result) {
      if (!applied.includes(rule.label)) applied.push(rule.label);
      result = replacement;
    }
  }
  return { text: result, redactions: applied };
}

export function deepRedactValue(value: unknown, depth: number = 0): unknown {
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

export function redactAgentHandoff(handoff: AgentHandoff): { handoff: AgentHandoff; rules: string[]; strippedFields: string[] } {
  const allRules = new Set<string>();
  const strippedFields: string[] = [];

  const redactedTitle = applyTextRedaction(handoff.brief.title);
  for (const r of redactedTitle.redactions) allRules.add(r);

  const redactedSummary = applyTextRedaction(handoff.brief.summary);
  for (const r of redactedSummary.redactions) allRules.add(r);

  const redactedUserNote = handoff.brief.userNote
    ? applyTextRedaction(handoff.brief.userNote)
    : null;
  if (redactedUserNote) for (const r of redactedUserNote.redactions) allRules.add(r);

  const redactedTargetLabel = handoff.brief.selectedTarget.label
    ? applyTextRedaction(handoff.brief.selectedTarget.label)
    : null;
  if (redactedTargetLabel) for (const r of redactedTargetLabel.redactions) allRules.add(r);

  const redactedTargetPreview = handoff.brief.selectedTarget.textPreview
    ? applyTextRedaction(handoff.brief.selectedTarget.textPreview)
    : null;
  if (redactedTargetPreview) for (const r of redactedTargetPreview.redactions) allRules.add(r);

  const redactedPageTitle = handoff.brief.page.title
    ? applyTextRedaction(handoff.brief.page.title)
    : null;
  if (redactedPageTitle) for (const r of redactedPageTitle.redactions) allRules.add(r);

  const redactedPageUrl = handoff.brief.page.url
    ? applyTextRedaction(handoff.brief.page.url)
    : null;
  if (redactedPageUrl) for (const r of redactedPageUrl.redactions) allRules.add(r);

  const redactedSourceHints = handoff.brief.sourceHints?.topHints.map(h => {
    const r = applyTextRedaction(h.displayName);
    for (const label of r.redactions) allRules.add(label);
    return { ...h, displayName: r.text };
  });

  const redactedLifecycle = handoff.lifecycle.map((evt) => {
    const r = applyTextRedaction(evt.summary);
    for (const label of r.redactions) allRules.add(label);
    return { ...evt, summary: r.text };
  });

  const redacted: AgentHandoff = {
    ...handoff,
    brief: {
      ...handoff.brief,
      title: redactedTitle.text,
      summary: redactedSummary.text,
      userNote: redactedUserNote?.text ?? handoff.brief.userNote,
      page: {
        ...handoff.brief.page,
        title: redactedPageTitle?.text ?? handoff.brief.page.title,
        url: redactedPageUrl?.text ?? handoff.brief.page.url,
      },
      selectedTarget: {
        ...handoff.brief.selectedTarget,
        label: redactedTargetLabel?.text ?? handoff.brief.selectedTarget.label,
        textPreview: redactedTargetPreview?.text ?? handoff.brief.selectedTarget.textPreview,
      },
      sourceHints: handoff.brief.sourceHints
        ? { ...handoff.brief.sourceHints, topHints: redactedSourceHints ?? [] }
        : undefined,
    },
    lifecycle: redactedLifecycle,
    redaction: {
      applied: allRules.size > 0,
      rules: [...allRules],
      strippedFields,
      warnings: [],
    },
  };

  return { handoff: redacted, rules: [...allRules], strippedFields };
}

export function redactBriefText(text: string): string {
  return applyTextRedaction(text).text;
}
