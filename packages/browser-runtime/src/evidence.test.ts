import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRUNCATION,
  applyRedaction,
  collectConsoleEntries,
  redactEvidence,
  truncateConsoleEntries,
  truncateNetworkEntries,
  truncateSelectedElement,
} from './evidence';
import type { ConsoleEntry, NetworkEntry, RuntimeEvidence, SelectedElementInfo } from './evidence';

function first<T>(arr: T[]): T {
  return arr[0] as T;
}

describe('console capture', () => {
  it('converts raw console errors to ConsoleEntry format', () => {
    const raw = [
      { message: 'test error', source: 'console.error', timestamp: '2026-01-01T00:00:00Z' },
    ];
    const entries = collectConsoleEntries(raw);
    expect(entries).toHaveLength(1);
    expect(first(entries).level).toBe('error');
    expect(first(entries).message).toBe('test error');
    expect(first(entries).source).toBe('console.error');
  });

  it('handles empty console error array', () => {
    const entries = collectConsoleEntries([]);
    expect(entries).toHaveLength(0);
  });
});

describe('network capture', () => {
  it('truncates network entries beyond max count', () => {
    const entries: NetworkEntry[] = Array.from({ length: 100 }, (_, i) => ({
      request: { method: 'GET', url: `https://example.com/api/${i}` },
      timestamp: new Date().toISOString(),
    }));
    const truncated = truncateNetworkEntries(entries, DEFAULT_TRUNCATION);
    expect(truncated).toHaveLength(DEFAULT_TRUNCATION.maxNetworkEntries);
  });

  it('truncates long URLs', () => {
    const longUrl = `https://example.com/${'a'.repeat(2000)}`;
    const entries: NetworkEntry[] = [
      { request: { method: 'GET', url: longUrl }, timestamp: new Date().toISOString() },
    ];
    const truncated = truncateNetworkEntries(entries, DEFAULT_TRUNCATION);
    expect(first(truncated).request.url.length).toBeLessThan(longUrl.length);
    expect(first(truncated).request.url).toContain('[TRUNCATED]');
  });

  it('preserves short URLs', () => {
    const shortUrl = 'https://example.com/api';
    const entries: NetworkEntry[] = [
      { request: { method: 'GET', url: shortUrl }, timestamp: new Date().toISOString() },
    ];
    const truncated = truncateNetworkEntries(entries, DEFAULT_TRUNCATION);
    expect(first(truncated).request.url).toBe(shortUrl);
  });
});

describe('selected element', () => {
  it('truncates long element text', () => {
    const el: SelectedElementInfo = {
      selector: '#test',
      tagName: 'div',
      text: 'x'.repeat(5000),
    };
    const truncated = truncateSelectedElement(el, DEFAULT_TRUNCATION);
    expect(truncated.text?.length).toBeLessThan(5000);
    expect(truncated.text).toContain('[TRUNCATED]');
  });

  it('truncates long attribute values', () => {
    const el: SelectedElementInfo = {
      selector: '#test',
      tagName: 'div',
      attributes: { class: 'a'.repeat(2000) },
    };
    const truncated = truncateSelectedElement(el, DEFAULT_TRUNCATION);
    const cls = truncated.attributes?.class;
    expect(cls?.length).toBeLessThan(2000);
    expect(cls).toContain('[TRUNCATED]');
  });

  it('handles element without text or attributes', () => {
    const el: SelectedElementInfo = { selector: '#test', tagName: 'div' };
    const truncated = truncateSelectedElement(el, DEFAULT_TRUNCATION);
    expect(truncated.selector).toBe('#test');
    expect(truncated.text).toBeUndefined();
    expect(truncated.attributes).toBeUndefined();
  });
});

describe('redaction', () => {
  it('redacts email addresses from text', () => {
    const { text, redactions } = applyRedaction('Contact: user@example.com');
    expect(text).toContain('[EMAIL_REDACTED]');
    expect(text).not.toContain('user@example.com');
    expect(redactions).toContain('email');
  });

  it('redacts API keys from text', () => {
    const { text, redactions } = applyRedaction('api_key = sk-proj-abc123def456ghi789jkl');
    expect(text).toContain('[API_KEY_REDACTED]');
    expect(redactions).toContain('api-key-assignment');
  });

  it('redacts secret patterns like password=value', () => {
    const { text, redactions } = applyRedaction('password = mySecretPassword123');
    expect(text).toContain('[SECRET_REDACTED]');
    expect(redactions).toContain('assign-secret');
  });

  it('redacts full evidence object', () => {
    const evidence: RuntimeEvidence = {
      console: [
        { level: 'error', message: 'Error: user@example.com', timestamp: '2026-01-01T00:00:00Z' },
      ],
      network: [
        {
          request: { method: 'GET', url: 'https://example.com/api?api_key=aBcDeFgHiJkLmNoPqRsT' },
          timestamp: '2026-01-01T00:00:00Z',
        },
      ],
      selectedElement: { selector: '#test', tagName: 'div', text: 'Contact: user@example.com' },
    };
    const { evidence: redacted, redactions } = redactEvidence(evidence);
    expect(first(redacted.console ?? []).message).toContain('[EMAIL_REDACTED]');
    expect(first(redacted.console ?? []).message).not.toContain('user@example.com');
    expect(first(redacted.network ?? []).request.url).toContain('[REDACTED]');
    expect(redacted.selectedElement?.text).toContain('[EMAIL_REDACTED]');
    expect(redactions).toContain('email');
    expect(redactions).toContain('query-param-sensitive');
  });

  it('redacts card numbers', () => {
    const { text, redactions } = applyRedaction('Card: 4111 1111 1111 1111');
    expect(text).toContain('[CARD_REDACTED]');
    expect(redactions).toContain('card-number');
  });

  it('handles text with no sensitive data', () => {
    const { text, redactions } = applyRedaction('Hello, this is safe text.');
    expect(text).toBe('Hello, this is safe text.');
    expect(redactions).toHaveLength(0);
  });

  it('applies extra custom redaction rules', () => {
    const customRule = { pattern: /CUSTOM_SENSITIVE/g, replacement: '[CUSTOM]', label: 'custom' };
    const { text, redactions } = applyRedaction('Data: CUSTOM_SENSITIVE', [customRule]);
    expect(text).toContain('[CUSTOM]');
    expect(redactions).toContain('custom');
  });
});

describe('truncation config', () => {
  it('truncates console entries beyond max count', () => {
    const entries: ConsoleEntry[] = Array.from({ length: 100 }, (_, i) => ({
      level: 'log',
      message: `entry ${i}`,
      timestamp: new Date().toISOString(),
    }));
    const truncated = truncateConsoleEntries(entries, DEFAULT_TRUNCATION);
    expect(truncated).toHaveLength(DEFAULT_TRUNCATION.maxConsoleEntries);
  });

  it('truncates long messages', () => {
    const entries: ConsoleEntry[] = [
      { level: 'error', message: 'x'.repeat(5000), timestamp: new Date().toISOString() },
    ];
    const truncated = truncateConsoleEntries(entries, DEFAULT_TRUNCATION);
    expect(first(truncated).message.length).toBeLessThan(5000);
    expect(first(truncated).message).toContain('[TRUNCATED]');
  });

  it('preserves short messages', () => {
    const entries: ConsoleEntry[] = [
      { level: 'warn', message: 'short', timestamp: new Date().toISOString() },
    ];
    const truncated = truncateConsoleEntries(entries, DEFAULT_TRUNCATION);
    expect(first(truncated).message).toBe('short');
  });
});

describe('runtimeEvidence schema', () => {
  it('accepts valid runtime evidence structure', () => {
    const evidence: RuntimeEvidence = {
      console: [{ level: 'log', message: 'test', timestamp: '2026-01-01T00:00:00Z' }],
      network: [
        {
          request: { method: 'GET', url: 'https://example.com' },
          response: { status: 200, statusText: 'OK' },
          durationMs: 100,
          timestamp: '2026-01-01T00:00:00Z',
        },
      ],
      selectedElement: { selector: '#btn', tagName: 'button', text: 'Click' },
    };
    expect(evidence.console).toHaveLength(1);
    expect(evidence.network).toHaveLength(1);
    expect(evidence.selectedElement?.tagName).toBe('button');
  });

  it('accepts empty evidence', () => {
    const evidence: RuntimeEvidence = {};
    const { evidence: result } = redactEvidence(evidence);
    expect(result.console).toBeUndefined();
    expect(result.network).toBeUndefined();
    expect(result.selectedElement).toBeUndefined();
  });

  it('redacts sk_test_123456 in console messages', () => {
    const { text, redactions } = applyRedaction(
      'VISKOD_SMOKE_ERROR: fake api key sk_test_123456 should be redacted',
    );
    expect(text).toContain('[API_KEY_REDACTED]');
    expect(text).not.toContain('sk_test_123456');
    expect(redactions).toContain('api-key');
  });

  it('redacts sk_live_ prefixed keys in console messages', () => {
    const { text } = applyRedaction('leaked key: sk_live_ABCDEF1234567890');
    expect(text).toContain('[API_KEY_REDACTED]');
    expect(text).not.toContain('sk_live_');
  });

  it('redacts api key assignment pattern', () => {
    const { text } = applyRedaction("api key 'sk_test_abc123def456' should be secret");
    expect(text).toContain('[API_KEY_REDACTED]');
    expect(text).not.toContain('sk_test_abc123def456');
  });

  it('redacts token= in URL query parameters', () => {
    const { text } = applyRedaction(
      'http://localhost:3000/api/missing?email=user@test.com&token=secret-token-123',
    );
    expect(text).toContain('[EMAIL_REDACTED]');
    expect(text).toContain('[REDACTED]');
    expect(text).not.toContain('secret-token-123');
  });

  it('redacts sensitive query parameters by name', () => {
    const urls = [
      'http://example.com?access_token=abc123',
      'http://example.com?api_key=abc123',
      'http://example.com?session=abc123',
      'http://example.com?csrf=abc123',
      'http://example.com?password=s3cret',
    ];
    for (const url of urls) {
      const { text } = applyRedaction(url);
      expect(text).toContain('[REDACTED]');
      expect(text).not.toMatch(/=(?:abc123|s3cret)(?:&|$)/);
    }
  });

  it('redacts console.stack recursively', () => {
    const evidence: RuntimeEvidence = {
      console: [
        {
          level: 'error',
          message: 'error with sk_test_abcdef key',
          timestamp: 'now',
          stack: 'Error: key sk_test_xyzabc leaked in stack',
        },
      ],
    };
    const { evidence: result, redactions } = redactEvidence(evidence);
    expect(result.console?.[0]?.message).toContain('[API_KEY_REDACTED]');
    expect(result.console?.[0]?.stack).toContain('[API_KEY_REDACTED]');
    expect(result.console?.[0]?.stack).not.toContain('sk_test_xyzabc');
    expect(redactions).toContain('api-key');
  });

  it('redacts network statusText recursively', () => {
    const evidence: RuntimeEvidence = {
      network: [
        {
          request: { method: 'GET', url: 'http://example.com' },
          response: { status: 401, statusText: 'Unauthorized: token=abc123' },
          timestamp: 'now',
        },
      ],
    };
    const { evidence: result } = redactEvidence(evidence);
    expect(result.network?.[0]?.response?.statusText).toContain('[SECRET_REDACTED]');
    expect(result.network?.[0]?.response?.statusText).not.toContain('abc123');
  });

  it('full redaction of mixed evidence', () => {
    const evidence: RuntimeEvidence = {
      console: [
        {
          level: 'error',
          message: 'VISKOD_SMOKE_ERROR: fake api key sk_test_123456 should be redacted',
          timestamp: 'now',
        },
      ],
      network: [
        {
          request: {
            method: 'GET',
            url: 'http://localhost:3000/api/missing?email=test@example.com&token=secret-token-123',
          },
          timestamp: 'now',
        },
      ],
    };
    const { evidence: result, redactions } = redactEvidence(evidence);
    // Console
    expect(result.console?.[0]?.message).toContain('[API_KEY_REDACTED]');
    expect(result.console?.[0]?.message).not.toContain('sk_test_123456');
    // Network URL
    expect(result.network?.[0]?.request.url).toContain('[EMAIL_REDACTED]');
    expect(result.network?.[0]?.request.url).not.toContain('test@example.com');
    expect(result.network?.[0]?.request.url).toContain('[REDACTED]');
    expect(result.network?.[0]?.request.url).not.toContain('secret-token-123');
    // Evidence across multiple fields
    expect(redactions).toContain('email');
    expect(redactions).toContain('api-key');
    expect(redactions).toContain('query-param-sensitive');
  });
});
