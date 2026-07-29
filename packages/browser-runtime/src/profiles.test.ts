import { describe, expect, it } from 'vitest';
import { PROFILES, resolveProfile } from './profiles';

describe('capture profiles', () => {
  it('default profile has balanced settings', () => {
    const p = PROFILES.default;
    expect(p.collectConsole).toBe(true);
    expect(p.collectNetwork).toBe(false);
    expect(p.collectScreenshot).toBe(true);
    expect(p.enableRedaction).toBe(true);
    expect(p.maxConsoleEntries).toBe(50);
  });

  it('debug profile has higher limits', () => {
    const p = PROFILES.debug;
    expect(p.collectNetwork).toBe(true);
    expect(p.maxConsoleEntries).toBe(200);
    expect(p.maxNetworkEntries).toBe(100);
    expect(p.maxMessageLength).toBe(5000);
  });

  it('audit profile disables screenshots and redaction', () => {
    const p = PROFILES.audit;
    expect(p.collectScreenshot).toBe(false);
    expect(p.enableRedaction).toBe(false);
    expect(p.collectNetwork).toBe(true);
    expect(p.maxConsoleEntries).toBe(500);
  });

  it('resolveProfile returns default for unknown names', () => {
    const p = resolveProfile('nonexistent');
    expect(p).toBe(PROFILES.default);
  });

  it('resolveProfile returns matching profile for valid names', () => {
    expect(resolveProfile('debug')).toBe(PROFILES.debug);
    expect(resolveProfile('audit')).toBe(PROFILES.audit);
    expect(resolveProfile('default')).toBe(PROFILES.default);
  });

  it('all profiles define all required fields', () => {
    const keys: (keyof typeof PROFILES.default)[] = [
      'collectConsole',
      'collectNetwork',
      'collectScreenshot',
      'collectSelectedElement',
      'collectDOM',
      'collectStyles',
      'collectHierarchy',
      'collectSourceHints',
      'enableRedaction',
      'maxConsoleEntries',
      'maxNetworkEntries',
      'maxMessageLength',
    ];
    for (const profile of Object.values(PROFILES)) {
      for (const key of keys) {
        expect(profile[key]).toBeDefined();
      }
    }
  });
});
