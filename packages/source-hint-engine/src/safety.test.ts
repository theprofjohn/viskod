import { describe, expect, it } from 'vitest';
import { containsSecrets, redactSecrets, sanitizeHintPaths } from './safety';
import type { UsageSiteSourceHint } from './types';

function makeHint(displayPath: string): UsageSiteSourceHint {
  return {
    schemaVersion: 1,
    hintId: 'test-hint',
    kind: 'usage-site',
    status: 'ranked',
    file: { displayPath },
    evidence: [],
    ranking: { score: 0.8, confidence: 0.8, rank: 1, reasons: [], penalties: [] },
    safety: { redactionApplied: false, userVisible: true, containsAbsolutePath: false },
  };
}

describe('sanitizeHintPaths', () => {
  it('removes absolute Windows paths', () => {
    const hints = [makeHint('C:\\Users\\test\\src\\page.tsx')];
    const result = sanitizeHintPaths(hints);
    expect(result[0]?.file.displayPath).not.toContain('C:\\');
    expect(result[0]?.file.displayPath).toContain('src\\page.tsx');
  });

  it('removes absolute Unix paths', () => {
    const hints = [makeHint('/home/user/src/page.tsx')];
    const result = sanitizeHintPaths(hints);
    expect(result[0]?.file.displayPath).not.toContain('/home/');
  });

  it('marks packet paths as not user-visible', () => {
    const hints = [makeHint('.viskod/captures/snap.png')];
    const result = sanitizeHintPaths(hints);
    expect(result[0]?.safety.userVisible).toBe(false);
  });

  it('marks absolute paths as containing absolute path', () => {
    const hints = [makeHint('C:\\Users\\test\\file.tsx')];
    const result = sanitizeHintPaths(hints);
    expect(result[0]?.safety.containsAbsolutePath).toBe(true);
  });

  it('keeps repo-relative paths clean', () => {
    const hints = [makeHint('src/components/Button.tsx')];
    const result = sanitizeHintPaths(hints);
    expect(result[0]?.file.displayPath).toBe('src/components/Button.tsx');
  });
});

describe('containsSecrets', () => {
  it('detects Stripe test keys', () => {
    expect(containsSecrets('sk_test_abc123def456')).toBe(true);
  });

  it('detects Stripe live keys', () => {
    expect(containsSecrets('sk_live_abc123def456')).toBe(true);
  });

  it('detects GitHub tokens', () => {
    expect(containsSecrets('ghp_1234567890abcdefghijklmnopqrstuvwxyz123456')).toBe(true);
  });

  it('detects Bearer tokens', () => {
    expect(containsSecrets('Bearer abcdefghijklmnopqrstuvwxyz123456')).toBe(true);
  });

  it('detects JWT tokens', () => {
    expect(containsSecrets('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')).toBe(true);
  });

  it('detects email addresses', () => {
    expect(containsSecrets('user@example.com')).toBe(true);
  });

  it('detects credit card numbers', () => {
    expect(containsSecrets('4111 1111 1111 1111')).toBe(true);
  });

  it('detects token query params', () => {
    expect(containsSecrets('?token=secret123')).toBe(true);
  });

  it('does not flag normal text', () => {
    expect(containsSecrets('Save changes to your profile')).toBe(false);
  });

  it('does not flag file paths', () => {
    expect(containsSecrets('src/components/Button.tsx')).toBe(false);
  });
});

describe('redactSecrets', () => {
  it('redacts Stripe test keys', () => {
    const result = redactSecrets('key is sk_test_abc123def456');
    expect(result).not.toContain('sk_test_abc123def456');
    expect(result).toContain('[REDACTED]');
  });

  it('redacts email addresses', () => {
    const result = redactSecrets('Contact user@example.com');
    expect(result).not.toContain('user@example.com');
    expect(result).toContain('[EMAIL_REDACTED]');
  });

  it('redacts credit card numbers', () => {
    const result = redactSecrets('Card: 4111 1111 1111 1111');
    expect(result).not.toContain('4111 1111 1111 1111');
    expect(result).toContain('[CARD_REDACTED]');
  });

  it('does not alter normal text', () => {
    const input = 'Save changes to your profile';
    expect(redactSecrets(input)).toBe(input);
  });
});
