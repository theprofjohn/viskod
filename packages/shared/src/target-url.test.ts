import { describe, expect, it } from 'vitest';
import { validateTargetUrl } from './target-url';

describe('validateTargetUrl', () => {
  it.each([
    'http://localhost:3000',
    'https://localhost/app',
    'http://127.0.0.1:5173',
    'http://[::1]:3000',
  ])('accepts loopback target %s', (url) => {
    expect(validateTargetUrl(url).valid).toBe(true);
  });

  it.each([
    'file:///tmp/app',
    'data:text/html,hello',
    'javascript:alert(1)',
    'about:blank',
    'chrome://settings',
    'ftp://localhost:3000',
  ])('rejects unsafe scheme %s', (url) => {
    expect(validateTargetUrl(url).valid).toBe(false);
  });

  it('rejects remote hosts unless explicitly allowlisted', () => {
    expect(validateTargetUrl('https://example.com').valid).toBe(false);
    expect(validateTargetUrl('https://example.com', { allowRemoteHosts: true }).valid).toBe(false);
    expect(
      validateTargetUrl('https://example.com', {
        allowRemoteHosts: true,
        allowedHosts: ['example.com'],
      }).valid,
    ).toBe(true);
  });

  it('rejects credentials and normalizes harmless query/fragment input', () => {
    expect(validateTargetUrl('http://user:secret@localhost:3000').valid).toBe(false);
    const result = validateTargetUrl('http://localhost:3000/path?x=1#section');
    expect(result.normalizedUrl).toBe('http://localhost:3000/path?x=1#section');
  });

  it('returns a safe error for malformed input', () => {
    const result = validateTargetUrl('not-a-url');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Invalid URL');
  });
});
