import type { VisualSelection, VisualSelectionTarget } from './types';

export interface SelectionRedactionResult {
  selection: VisualSelection;
  redactions: string[];
}

const PASSWORD_PATTERN = /^password$/i;
const SENSITIVE_INPUT_TYPES = ['password', 'hidden'];

const REDACTION_RULES: Array<{ pattern: RegExp; replacement: string; label: string }> = [
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: '[EMAIL_REDACTED]', label: 'email' },
  { pattern: /\b(?:\d{4}[- ]?){3}\d{4}\b/g, replacement: '[CARD_REDACTED]', label: 'card-number' },
  {
    pattern: /(?:[?&])(token|access_token|refresh_token|id_token|api_key|apikey|key|secret|password|session|csrf|auth|authorization)=[^&\s]{4,}/gi,
    replacement: (match: string) => {
      const eqIdx = match.indexOf('=');
      return `${match.slice(0, eqIdx + 1)}[REDACTED]`;
    },
    label: 'query-param-sensitive',
  },
  {
    pattern: /\b(?:sk[-_]?(?:test|live)_[A-Za-z0-9]{3,}|pk[-_]?(?:test|live)_[A-Za-z0-9]{3,}|sk-[A-Za-z0-9]{6,}|pk-[A-Za-z0-9]{6,})/gi,
    replacement: '[API_KEY_REDACTED]',
    label: 'api-key',
  },
  {
    pattern: /(?<![?&_\w])\b(?:secret|password|passwd|pwd|token|access_token|refresh_token|id_token|api_key|apikey)\s*[:=]\s*['"]?(?:[A-Za-z0-9_\-./]{4,})/gi,
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

export function redactSelectionData(
  selection: VisualSelection,
): SelectionRedactionResult {
  const allRedactions = new Set<string>();

  const redactedTargets: VisualSelectionTarget[] = selection.targets.map((target) => {
    if (target.semantics.inputType && SENSITIVE_INPUT_TYPES.includes(target.semantics.inputType)) {
      return {
        ...target,
        semantics: {
          ...target.semantics,
          textPreview: undefined,
          accessibleName: undefined,
        },
      };
    }

    const redacted = { ...target };

    if (target.semantics.textPreview) {
      const { text, redactions } = applyTextRedaction(target.semantics.textPreview);
      for (const r of redactions) allRedactions.add(r);
      redacted.semantics = { ...redacted.semantics, textPreview: text };
    }

    if (target.semantics.accessibleName) {
      const { text, redactions } = applyTextRedaction(target.semantics.accessibleName);
      for (const r of redactions) allRedactions.add(r);
      redacted.semantics = { ...redacted.semantics, accessibleName: text };
    }

    if (target.fingerprints.stableAttributes) {
      const redactedAttrs: Record<string, string> = {};
      for (const [key, value] of Object.entries(target.fingerprints.stableAttributes)) {
        if (PASSWORD_PATTERN.test(key)) continue;
        const { text, redactions } = applyTextRedaction(value);
        for (const r of redactions) allRedactions.add(r);
        redactedAttrs[key] = text;
      }
      redacted.fingerprints = { ...redacted.fingerprints, stableAttributes: redactedAttrs };
    }

    return redacted;
  });

  const redactedSummary = { ...selection.summary };
  if (selection.summary.textPreview) {
    const { text, redactions } = applyTextRedaction(selection.summary.textPreview);
    for (const r of redactions) allRedactions.add(r);
    redactedSummary.textPreview = text;
  }

  return {
    selection: {
      ...selection,
      targets: redactedTargets,
      summary: redactedSummary,
    },
    redactions: [...allRedactions],
  };
}

export function normalizeText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}…`;
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}
