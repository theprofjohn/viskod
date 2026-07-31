import type { UsageSiteSourceHint, HintSafety } from './types';

const ABSOLUTE_PATH_PATTERNS = [
  /^[A-Z]:\\/,
  /^\/home\//,
  /^\/tmp\//,
  /^\/var\//,
  /^\/usr\//,
  /^\/opt\//,
  /^\/root\//,
];

const PACKET_PATH_PATTERNS = [
  /\.viskod/,
  /packets\//,
  /captures\//,
  /\.viskod\//,
];

const SECRET_PATTERNS = [
  /sk[_-]test[_-][A-Za-z0-9]{3,}/,
  /sk[_-]live[_-][A-Za-z0-9]{3,}/,
  /pk[_-]test[_-][A-Za-z0-9]{3,}/,
  /pk[_-]live[_-][A-Za-z0-9]{3,}/,
  /ghp_[A-Za-z0-9]{36}/,
  /gho_[A-Za-z0-9]{36}/,
  /Bearer\s+[A-Za-z0-9._-]{20,}/,
  /eyJ[A-Za-z0-9]{20,}/,
];

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const CARD_PATTERN = /\b(?:\d[ -]*?){13,16}\b/;
const TOKEN_PARAM_PATTERN = /[?&]token=[^&]+/;

export function sanitizeHintPaths(hints: UsageSiteSourceHint[]): UsageSiteSourceHint[] {
  return hints.map((h) => {
    const safety = checkHintSafety(h);
    return {
      ...h,
      file: {
        ...h.file,
        displayPath: toDisplayPath(h.file.displayPath),
      },
      safety: {
        ...h.safety,
        ...safety,
      },
    };
  });
}

function checkHintSafety(hint: UsageSiteSourceHint): Partial<HintSafety> {
  const displayPath = hint.file.displayPath;
  const containsAbsolutePath = ABSOLUTE_PATH_PATTERNS.some((p) => p.test(displayPath));
  const containsPacketPath = PACKET_PATH_PATTERNS.some((p) => p.test(displayPath));

  return {
    containsAbsolutePath: containsAbsolutePath || containsPacketPath,
    redactionApplied: false,
    userVisible: !containsPacketPath,
  };
}

function toDisplayPath(filePath: string): string {
  // Remove any absolute path prefix
  let cleaned = filePath;
  for (const pattern of ABSOLUTE_PATH_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  // Remove packet/capture paths
  for (const pattern of PACKET_PATH_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  return cleaned;
}

export function containsSecrets(text: string): boolean {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  if (EMAIL_PATTERN.test(text)) return true;
  if (CARD_PATTERN.test(text)) return true;
  if (TOKEN_PARAM_PATTERN.test(text)) return true;
  return false;
}

export function redactSecrets(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED]');
  }
  redacted = redacted.replace(EMAIL_PATTERN, '[EMAIL_REDACTED]');
  redacted = redacted.replace(CARD_PATTERN, '[CARD_REDACTED]');
  redacted = redacted.replace(TOKEN_PARAM_PATTERN, '&token=[REDACTED]');
  return redacted;
}
