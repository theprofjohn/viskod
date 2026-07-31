import type { VisualReview, VisualReviewEvent } from './types';

const REDACTION_RULES: Array<{ pattern: RegExp; replacement: string; label: string }> = [
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: '[EMAIL_REDACTED]', label: 'email' },
  { pattern: /\b(?:\d{4}[- ]?){3}\d{4}\b/g, replacement: '[CARD_REDACTED]', label: 'card-number' },
  { pattern: /\bBearer\s+[A-Za-z0-9_\-\.]{4,}/gi, replacement: '[SECRET_REDACTED]', label: 'bearer-token' },
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

function redactSnapshotTargetSummary(target: {
  mode: 'single' | 'box';
  label?: string;
  role?: string;
  textPreview?: string;
  targetCount: number;
  confidence: number;
  resolutionStatus: string;
}): { target: typeof target; redactions: string[] } {
  const allRedactions: string[] = [];
  let label = target.label;
  let textPreview = target.textPreview;

  if (label) {
    const r = applyTextRedaction(label);
    label = r.text;
    allRedactions.push(...r.redactions);
  }
  if (textPreview) {
    const r = applyTextRedaction(textPreview);
    textPreview = r.text;
    allRedactions.push(...r.redactions);
  }

  return {
    target: { ...target, label, textPreview },
    redactions: allRedactions,
  };
}

export function redactReview(review: VisualReview): { review: VisualReview; rules: string[]; strippedFields: string[] } {
  const allRules = new Set<string>();
  const strippedFields: string[] = [];

  function redactSnapshotSnap(snap: typeof review.before) {
    const tr = redactSnapshotTargetSummary(snap.targetSummary);
    for (const r of tr.redactions) allRules.add(r);

    const pageUrl = snap.page.url ? applyTextRedaction(snap.page.url) : null;
    if (pageUrl) for (const r of pageUrl.redactions) allRules.add(r);

    const pageTitle = snap.page.title ? applyTextRedaction(snap.page.title) : null;
    if (pageTitle) for (const r of pageTitle.redactions) allRules.add(r);

    return {
      ...snap,
      targetSummary: tr.target,
      page: {
        ...snap.page,
        url: pageUrl?.text ?? snap.page.url,
        title: pageTitle?.text ?? snap.page.title,
      },
    };
  }

  const redactedBefore = redactSnapshotSnap(review.before);
  const redactedAfter = review.after ? redactSnapshotSnap(review.after) : undefined;

  const redactedComparison = review.comparison ? {
    ...review.comparison,
    summary: applyTextRedaction(review.comparison.summary).text,
    target: {
      ...review.comparison.target,
      warnings: review.comparison.target.warnings.map(w => applyTextRedaction(w).text),
    },
    warnings: review.comparison.warnings.map(w => applyTextRedaction(w).text),
  } : undefined;

  const redactedDecision = review.decision ? {
    ...review.decision,
    note: review.decision.note ? applyTextRedaction(review.decision.note).text : undefined,
  } : undefined;

  const redactedLifecycle = review.lifecycle.map((evt) => {
    const r = applyTextRedaction(evt.summary);
    for (const label of r.redactions) allRules.add(label);
    return { ...evt, summary: r.text };
  });

  const redacted: VisualReview = {
    ...review,
    before: redactedBefore,
    after: redactedAfter,
    comparison: redactedComparison,
    decision: redactedDecision,
    lifecycle: redactedLifecycle,
    redaction: {
      applied: allRules.size > 0,
      rules: [...allRules],
      strippedFields,
      warnings: [],
    },
  };

  return { review: redacted, rules: [...allRules], strippedFields };
}

export function redactReviewText(text: string): string {
  return applyTextRedaction(text).text;
}
