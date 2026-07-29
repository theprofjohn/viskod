import { describe, expect, it } from 'vitest';
import { PROFILES, resolveProfile } from './profiles';

describe('resolveProfile', () => {
  it('returns default profile for "default"', () => {
    const p = resolveProfile('default');
    expect(p.collectConsole).toBe(true);
    expect(p.collectNetwork).toBe(false);
    expect(p.collectScreenshot).toBe(true);
    expect(p.enableRedaction).toBe(true);
  });

  it('returns debug profile for "debug"', () => {
    const p = resolveProfile('debug');
    expect(p.collectConsole).toBe(true);
    expect(p.collectNetwork).toBe(true);
    expect(p.maxConsoleEntries).toBe(200);
    expect(p.enableRedaction).toBe(true);
  });

  it('returns audit profile for "audit"', () => {
    const p = resolveProfile('audit');
    expect(p.collectConsole).toBe(true);
    expect(p.collectNetwork).toBe(true);
    expect(p.collectScreenshot).toBe(false);
    expect(p.enableRedaction).toBe(true); // Redaction must be on by default
    expect(p.collectSourceHints).toBe(false);
  });

  it('falls back to default for unknown profile', () => {
    const p = resolveProfile('nonexistent');
    expect(p.collectScreenshot).toBe(true);
    expect(p.collectNetwork).toBe(false);
  });

  it('all profiles have enableRedaction true', () => {
    for (const key of Object.keys(PROFILES) as Array<keyof typeof PROFILES>) {
      expect(PROFILES[key].enableRedaction).toBe(true);
    }
  });
});
