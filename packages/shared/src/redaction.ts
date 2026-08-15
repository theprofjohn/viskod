/**
 * Shared redaction primitives — the single reusable privacy boundary for
 * Viskod persisted/agent-visible data.
 *
 * Phase 29: one mandatory packet-level redaction boundary. Browser-runtime
 * evidence redaction, agent-handoff redaction, and the context-packet
 * persistence boundary all build on the rules and helpers here instead of
 * maintaining independent regex engines.
 *
 * Default-deny policy: values stored under sensitive attribute names
 * (password, token, key, secret, authorization, …) are replaced wholesale —
 * a secret is never persisted merely because its format escaped the regex
 * rules.
 */

export interface RedactionRule {
  pattern: RegExp;
  replacement: string | ((match: string) => string);
  label: string;
}

/** Conservative default rules shared by every redaction surface. */
export const DEFAULT_REDACTION_RULES: RedactionRule[] = [
  {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: '[EMAIL_REDACTED]',
    label: 'email',
  },
  { pattern: /\b(?:\d{4}[- ]?){3}\d{4}\b/g, replacement: '[CARD_REDACTED]', label: 'card-number' },
  {
    pattern: /\bBearer\s+[A-Za-z0-9_\-\.]{4,}/gi,
    replacement: '[SECRET_REDACTED]',
    label: 'bearer-token',
  },
  // URL query parameters with sensitive names — must come before assign-secret
  {
    pattern:
      /(?:[?&])(token|access_token|refresh_token|id_token|api_key|apikey|key|secret|password|session|csrf|auth|authorization)=[^&\s]{4,}/gi,
    replacement: (match: string) => {
      const eqIdx = match.indexOf('=');
      return `${match.slice(0, eqIdx + 1)}[REDACTED]`;
    },
    label: 'query-param-sensitive',
  },
  // API keys: sk_test/sk_live/pk_test/pk_live with 3+ alphanumeric suffix
  {
    pattern:
      /\b(?:sk[-_]?(?:test|live)_[A-Za-z0-9]{3,}|pk[-_]?(?:test|live)_[A-Za-z0-9]{3,}|sk-[A-Za-z0-9]{6,}|pk-[A-Za-z0-9]{6,})/gi,
    replacement: '[API_KEY_REDACTED]',
    label: 'api-key',
  },
  // api_key = value, apikey: value, "api key": value
  {
    pattern: /\b(?:api[_-]?key|apikey)['"]?\s*[:=]\s*['"]?(?:[A-Za-z0-9_\-]{8,})/gi,
    replacement: '[API_KEY_REDACTED]',
    label: 'api-key-assignment',
  },
  // key=value / secret=value / password=value / token=value in text (not ?query)
  {
    pattern:
      /(?<![?&_\w])\b(?:secret|password|passwd|pwd|token|access_token|refresh_token|id_token|api_key|apikey)\s*[:=]\s*['"]?(?:[A-Za-z0-9_\-./]{4,})/gi,
    replacement: '[SECRET_REDACTED]',
    label: 'assign-secret',
  },
  // "token <value>", "secret <value>", "key <value>" in prose
  {
    pattern:
      /\b(?:token|secret|password|passwd|pwd|bearer|auth)\s+['"]?(?:[A-Za-z0-9_\-./@#$%^&*+=-]{6,})/gi,
    replacement: '[SECRET_REDACTED]',
    label: 'inline-secret',
  },
  // Base64-like tokens (16+ base64 chars with padding). A negative
  // lookahead excludes path/extension contexts ("src/components/LoginForm"
  // must stay useful) while keeping standalone token-like values redacted.
  {
    pattern:
      /\b(?:[A-Za-z0-9+/]{16,})(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})\b(?![./])/g,
    replacement: '[TOKEN_REDACTED]',
    label: 'base64-token',
  },
];

/**
 * Attribute/field names treated as credential-bearing. Values under these
 * keys are replaced wholesale (default-deny) regardless of their format.
 * Matching is conservative: the final `-`/`_`-separated segment decides, so
 * `value`, `password`, `data-secret`, `access_token`, `--p29-token` are all
 * denied while `data-testid`, `aria-label`, `id`, `class` are preserved.
 */
const SENSITIVE_WORD = new Set([
  'value',
  'password',
  'passwd',
  'pwd',
  'token',
  'secret',
  'key',
  'apikey',
  'api_key',
  'authorization',
  'auth',
  'cookie',
  'session',
  'csrf',
  'bearer',
  'credential',
  'client_secret',
  'private',
  'access_token',
  'refresh_token',
  'id_token',
]);

export function isSensitiveAttributeName(name: string): boolean {
  const lower = name.toLowerCase();
  if (SENSITIVE_WORD.has(lower)) return true;
  const last = lower.split(/[-_]/).pop();
  return last ? SENSITIVE_WORD.has(last) : false;
}

export function applyRedaction(
  text: string,
  extraRules?: RedactionRule[],
): { text: string; redactions: string[] } {
  const rules = [...DEFAULT_REDACTION_RULES, ...(extraRules ?? [])];
  const applied: string[] = [];
  let result = text;
  for (const rule of rules) {
    const candidate =
      typeof rule.replacement === 'function'
        ? result.replace(rule.pattern, rule.replacement as (match: string) => string)
        : result.replace(rule.pattern, rule.replacement);
    if (candidate !== result) {
      if (!applied.includes(rule.label)) applied.push(rule.label);
      result = candidate;
    }
  }
  return { text: result, redactions: applied };
}

export interface DeepRedactOptions {
  /** Collect applied rule labels into this set. */
  redactions?: string[];
  /** Recurse depth cap (default 20) — protects against cyclic/runaway input. */
  depth?: number;
}

/**
 * Deep-redact any JSON-serializable value:
 * - strings pass through `applyRedaction`;
 * - values under sensitive attribute names are replaced wholesale
 *   (`[REDACTED]`, label `sensitive-attribute`);
 * - arrays/objects recurse; primitives pass through.
 */
export function deepRedactValue(value: unknown, options: DeepRedactOptions = {}): unknown {
  const maxDepth = options.depth ?? 20;
  return redactNode(value, '', maxDepth, options.redactions);
}

function redactNode(value: unknown, key: string, depth: number, redactions?: string[]): unknown {
  if (depth <= 0) return value;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (isSensitiveAttributeName(key)) {
      redactions?.push('sensitive-attribute');
      return '[REDACTED]';
    }
    const { text, redactions: labels } = applyRedaction(value);
    for (const label of labels) redactions?.push(label);
    return text;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactNode(item, key, depth - 1, redactions));
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = redactNode(v, k, depth - 1, redactions);
    }
    return result;
  }
  return value;
}

/**
 * Strip local absolute paths and control characters from an error detail
 * string so diagnostics stay machine-readable and path-free.
 */
export function sanitizeErrorDetail(detail: string, maxLength = 200): string {
  let result =
    detail
      // Windows drive paths (C:\Users\...)
      .replace(/[A-Za-z]:[\\/][^\s"']+/g, '[path]')
      // Unix absolute paths
      .replace(/\/[^\s"']{4,}/g, '[path]')
      // Multi-line stacks: keep only the first line
      .split('\n')[0]
      ?.replace(/[^\x20-\x7E]/g, ' ')
      .trim() ?? '';
  if (result.length > maxLength) result = `${result.slice(0, maxLength)}…`;
  return result;
}

/** Value used for default-deny sensitive attribute replacement. */
export const SENSITIVE_VALUE_PLACEHOLDER = '[REDACTED]';
