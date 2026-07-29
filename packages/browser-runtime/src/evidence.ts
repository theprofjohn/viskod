export interface ConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp: string;
  source?: string;
  stack?: string;
}

export interface NetworkRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
}

export interface NetworkResponse {
  status: number;
  statusText: string;
  headers?: Record<string, string>;
}

export interface NetworkEntry {
  request: NetworkRequest;
  response?: NetworkResponse;
  durationMs?: number;
  sizeBytes?: number;
  timestamp: string;
}

export interface SelectedElementInfo {
  selector: string;
  tagName: string;
  text?: string;
  attributes?: Record<string, string>;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface RuntimeEvidence {
  console?: ConsoleEntry[];
  network?: NetworkEntry[];
  selectedElement?: SelectedElementInfo;
}

export interface TruncationConfig {
  maxConsoleEntries: number;
  maxNetworkEntries: number;
  maxMessageLength: number;
  maxUrlLength: number;
  maxAttributeLength: number;
}

export const DEFAULT_TRUNCATION: TruncationConfig = {
  maxConsoleEntries: 50,
  maxNetworkEntries: 30,
  maxMessageLength: 2000,
  maxUrlLength: 500,
  maxAttributeLength: 500,
};

export interface RedactionRule {
  pattern: RegExp;
  replacement: string | ((match: string) => string);
  label: string;
}

const DEFAULT_RULES: RedactionRule[] = [
  {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: '[EMAIL_REDACTED]',
    label: 'email',
  },
  { pattern: /\b(?:\d{4}[- ]?){3}\d{4}\b/g, replacement: '[CARD_REDACTED]', label: 'card-number' },
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
  // Base64-like tokens (16+ base64 chars with padding)
  {
    pattern: /\b(?:[A-Za-z0-9+/]{16,})(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})\b/g,
    replacement: '[TOKEN_REDACTED]',
    label: 'base64-token',
  },
];

export function applyRedaction(
  text: string,
  extraRules?: RedactionRule[],
): { text: string; redactions: string[] } {
  const rules = [...DEFAULT_RULES, ...(extraRules ?? [])];
  const applied: string[] = [];
  let result = text;
  for (const rule of rules) {
    const candidate =
      typeof rule.replacement === 'function'
        ? result.replace(rule.pattern, rule.replacement as (match: string) => string)
        : result.replace(rule.pattern, rule.replacement);
    if (candidate !== result) {
      if (!applied.includes(rule.label)) {
        applied.push(rule.label);
      }
      result = candidate;
    }
  }
  return { text: result, redactions: applied };
}

export function truncateConsoleEntries(
  entries: ConsoleEntry[],
  config: TruncationConfig,
): ConsoleEntry[] {
  const sliced = entries.slice(-config.maxConsoleEntries);
  return sliced.map((e) => ({
    ...e,
    message:
      e.message.length > config.maxMessageLength
        ? `${e.message.slice(0, config.maxMessageLength)}...[TRUNCATED]`
        : e.message,
  }));
}

export function truncateNetworkEntries(
  entries: NetworkEntry[],
  config: TruncationConfig,
): NetworkEntry[] {
  const sliced = entries.slice(-config.maxNetworkEntries);
  return sliced.map((e) => {
    const request = {
      ...e.request,
      url:
        e.request.url.length > config.maxUrlLength
          ? `${e.request.url.slice(0, config.maxUrlLength)}...[TRUNCATED]`
          : e.request.url,
    };
    const response = e.response ? { ...e.response } : undefined;
    return { ...e, request, response };
  });
}

export function truncateSelectedElement(
  el: SelectedElementInfo,
  config: TruncationConfig,
): SelectedElementInfo {
  return {
    ...el,
    text:
      el.text && el.text.length > config.maxMessageLength
        ? `${el.text.slice(0, config.maxMessageLength)}...[TRUNCATED]`
        : el.text,
    attributes: el.attributes
      ? Object.fromEntries(
          Object.entries(el.attributes).map(([k, v]) => [
            k,
            v.length > config.maxAttributeLength
              ? `${v.slice(0, config.maxAttributeLength)}...[TRUNCATED]`
              : v,
          ]),
        )
      : undefined,
  };
}

export function redactEvidence(
  evidence: RuntimeEvidence,
  extraRules?: RedactionRule[],
): { evidence: RuntimeEvidence; redactions: string[] } {
  const allRedactions = new Set<string>();

  const consoleEntries = evidence.console?.map((e) => {
    const { text, redactions } = applyRedaction(e.message, extraRules);
    for (const r of redactions) allRedactions.add(r);
    const stack = e.stack
      ? (() => {
          const { text: st, redactions: stRedactions } = applyRedaction(
            e.stack as string,
            extraRules,
          );
          for (const r of stRedactions) allRedactions.add(r);
          return st;
        })()
      : undefined;
    return { ...e, message: text, stack };
  });

  const networkEntries = evidence.network?.map((e) => {
    const { text: urlText, redactions: urlRedactions } = applyRedaction(e.request.url, extraRules);
    for (const r of urlRedactions) allRedactions.add(r);
    const responseStatusText = e.response?.statusText
      ? (() => {
          const { text: st, redactions: stRedactions } = applyRedaction(
            e.response?.statusText,
            extraRules,
          );
          for (const r of stRedactions) allRedactions.add(r);
          return st;
        })()
      : undefined;
    return {
      ...e,
      request: {
        ...e.request,
        url: urlText,
        headers: e.request.headers
          ? redactRecord(e.request.headers, extraRules, allRedactions)
          : undefined,
      },
      response: e.response
        ? {
            ...e.response,
            statusText: responseStatusText ?? e.response.statusText,
            headers: e.response.headers
              ? redactRecord(e.response.headers, extraRules, allRedactions)
              : undefined,
          }
        : undefined,
    };
  });

  const selectedElement = evidence.selectedElement
    ? {
        ...evidence.selectedElement,
        text: evidence.selectedElement.text
          ? (() => {
              const txt = evidence.selectedElement.text as string;
              const { text, redactions } = applyRedaction(txt, extraRules);
              for (const r of redactions) allRedactions.add(r);
              return text;
            })()
          : undefined,
        attributes: evidence.selectedElement.attributes
          ? redactRecord(evidence.selectedElement.attributes, extraRules, allRedactions)
          : undefined,
      }
    : undefined;

  return {
    evidence: {
      console: consoleEntries,
      network: networkEntries,
      selectedElement,
    },
    redactions: [...allRedactions],
  };
}

function redactRecord(
  record: Record<string, string>,
  extraRules?: RedactionRule[],
  redactionSet?: Set<string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    const { text, redactions } = applyRedaction(v, extraRules);
    for (const r of redactions) redactionSet?.add(r);
    result[k] = text;
  }
  return result;
}

export function collectConsoleEntries(
  raw: Array<{ message: string; source: string; timestamp: string }>,
): ConsoleEntry[] {
  return raw.map((e) => ({
    level: 'error' as const,
    message: e.message,
    timestamp: e.timestamp,
    source: e.source,
  }));
}
