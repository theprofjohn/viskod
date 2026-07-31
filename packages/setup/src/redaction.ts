import type { SetupCheckResult, FirstRunSetupState } from './types';

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

export function containsSecrets(text: string): boolean {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  if (EMAIL_PATTERN.test(text)) return true;
  if (CARD_PATTERN.test(text)) return true;
  if (TOKEN_PARAM_PATTERN.test(text)) return true;
  return false;
}

export function containsAbsolutePath(text: string): boolean {
  return ABSOLUTE_PATH_PATTERNS.some((p) => p.test(text));
}

export function containsPacketPath(text: string): boolean {
  return PACKET_PATH_PATTERNS.some((p) => p.test(text));
}

export function sanitizePath(filePath: string): string {
  let cleaned = filePath;
  for (const pattern of [...ABSOLUTE_PATH_PATTERNS, ...PACKET_PATH_PATTERNS]) {
    cleaned = cleaned.replace(pattern, '');
  }
  return cleaned;
}

export function redactCheckResult(check: SetupCheckResult): SetupCheckResult {
  const redacted = { ...check };
  if (redacted.summary) {
    redacted.summary = sanitizePath(redacted.summary);
  }
  if (redacted.details) {
    redacted.details = sanitizePath(redacted.details);
  }
  return redacted;
}

export function redactSetupState(state: FirstRunSetupState): FirstRunSetupState {
  const redacted = { ...state };
  redacted.project = { ...redacted.project };
  if (redacted.project.rootDisplayName) {
    redacted.project.rootDisplayName = sanitizePath(redacted.project.rootDisplayName);
  }
  redacted.checks = redacted.checks.map(redactCheckResult);
  return redacted;
}

export function validateOutputSafety(output: string): { safe: boolean; violations: string[] } {
  const violations: string[] = [];

  if (containsAbsolutePath(output)) violations.push('absolute-path');
  if (containsPacketPath(output)) violations.push('packet-path');
  if (containsSecrets(output)) violations.push('secret');

  return { safe: violations.length === 0, violations };
}
