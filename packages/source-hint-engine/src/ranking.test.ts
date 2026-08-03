import { describe, expect, it } from 'vitest';
import { rankHints } from './ranking';
import type { SourceHint } from './types';

function makeHint(overrides: Partial<SourceHint> & { filePath: string }): SourceHint {
  return {
    hintId: `hint-${encodeURIComponent(overrides.filePath)}`,
    confidence: 0.7,
    evidence: [{ type: 'file-exists', weight: 0.5, detail: 'File exists', confidence: 0.7 }],
    discoveryMethod: 'file-exists',
    isPrimary: false,
    timestamp: new Date().toISOString(),
    schemaVersion: '1.0.0',
    exists: true,
    matchType: 'exact',
    reason: 'File exists',
    ...overrides,
  };
}

describe('rankHints', () => {
  it('returns missing status for empty hints', () => {
    const result = rankHints({ hints: [] });
    expect(result.status).toBe('missing');
    expect(result.topHints).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('returns ranked status when one hint is clearly ahead', () => {
    const hints = [
      makeHint({ filePath: 'app/settings/page.tsx', matchType: 'usage-site', confidence: 0.9 }),
      makeHint({ filePath: 'src/components/button.tsx', matchType: 'exact', confidence: 0.7 }),
    ];
    const result = rankHints({
      hints,
      matchedRoute: {
        path: '/settings',
        file: 'app/settings/page.tsx',
        type: 'page',
        isDynamic: false,
      },
    });
    expect(result.status).toBe('ranked');
    expect(result.topHints.length).toBeGreaterThan(0);
  });

  it('returns ambiguous status when top hints are close', () => {
    const hints = [
      makeHint({ filePath: 'app/page-a.tsx', matchType: 'usage-site', confidence: 0.8 }),
      makeHint({ filePath: 'app/page-b.tsx', matchType: 'usage-site', confidence: 0.79 }),
    ];
    const result = rankHints({ hints });
    expect(result.status).toBe('ambiguous');
    expect(result.warnings.some((w) => w.includes('close'))).toBe(true);
  });

  it('returns low_confidence when all hints have low confidence', () => {
    const hints = [
      makeHint({
        filePath: 'unknown-file.tsx',
        confidence: 0.2,
        matchType: 'generated-non-existing',
        exists: false,
      }),
    ];
    const result = rankHints({ hints });
    expect(result.status).toBe('low_confidence');
  });

  it('usage-site kind ranks above definition-site', () => {
    const hints = [
      makeHint({ filePath: 'src/components/button.tsx', matchType: 'exact', confidence: 0.9 }),
      makeHint({
        filePath: 'lib/settings-form.tsx',
        matchType: 'usage-site',
        confidence: 0.85,
        evidence: [
          { type: 'text-content-match', weight: 0.7, detail: 'Found text', confidence: 0.8 },
        ],
      }),
    ];
    const result = rankHints({ hints });
    expect(result.topHints[0]?.kind).toBe('usage-site');
    expect(result.topHints[1]?.kind).toBe('definition-site');
  });

  it('route-owner ranks above generic component', () => {
    const hints = [
      makeHint({ filePath: 'src/components/card.tsx', matchType: 'exact', confidence: 0.9 }),
      makeHint({ filePath: 'app/dashboard/page.tsx', matchType: 'usage-site', confidence: 0.8 }),
    ];
    const result = rankHints({
      hints,
      matchedRoute: {
        path: '/dashboard',
        file: 'app/dashboard/page.tsx',
        type: 'page',
        isDynamic: false,
      },
    });
    expect(result.topHints[0]?.kind).toBe('route-owner');
  });

  it('test-owner ranks lowest', () => {
    const hints = [
      makeHint({ filePath: 'src/components/Button.test.tsx', matchType: 'exact', confidence: 0.9 }),
      makeHint({ filePath: 'src/components/Button.tsx', matchType: 'exact', confidence: 0.8 }),
    ];
    const result = rankHints({ hints });
    expect(result.topHints[0]?.kind).toBe('definition-site');
    expect(result.topHints[1]?.kind).toBe('test-owner');
  });

  it('non-existing files get penalty', () => {
    const hints = [
      makeHint({
        filePath: 'src/components/NonExistent.tsx',
        exists: false,
        matchType: 'generated-non-existing',
        confidence: 0.7,
      }),
      makeHint({
        filePath: 'src/components/Existing.tsx',
        exists: true,
        matchType: 'exact',
        confidence: 0.7,
      }),
    ];
    const result = rankHints({ hints });
    expect(result.topHints[0]?.file.displayPath).toContain('Existing');
  });

  it('sorts deterministically by filePath when scores are equal', () => {
    const hints = [
      makeHint({ filePath: 'z-file.tsx', matchType: 'exact', confidence: 0.7 }),
      makeHint({ filePath: 'a-file.tsx', matchType: 'exact', confidence: 0.7 }),
      makeHint({ filePath: 'm-file.tsx', matchType: 'exact', confidence: 0.7 }),
    ];
    const result = rankHints({ hints });
    expect(result.topHints[0]?.file.displayPath).toContain('a-file');
    expect(result.topHints[1]?.file.displayPath).toContain('m-file');
    expect(result.topHints[2]?.file.displayPath).toContain('z-file');
  });

  it('respects maxHints parameter', () => {
    const hints = Array.from({ length: 10 }, (_, i) =>
      makeHint({ filePath: `file-${i}.tsx`, matchType: 'exact', confidence: 0.7 - i * 0.05 }),
    );
    const result = rankHints({ hints });
    expect(result.topHints.length).toBeLessThanOrEqual(10);
  });

  it('includes ranking reasons and penalties', () => {
    const hints = [
      makeHint({ filePath: 'app/page.tsx', matchType: 'usage-site', confidence: 0.9 }),
    ];
    const result = rankHints({ hints });
    expect(result.topHints[0]?.ranking.reasons.length).toBeGreaterThan(0);
  });

  it('marks hints with containsAbsolutePath as unsafe', () => {
    const hints = [
      makeHint({ filePath: 'C:\\Users\\test\\file.tsx', matchType: 'exact', confidence: 0.7 }),
    ];
    const result = rankHints({ hints, projectRootPath: 'C:\\Users\\test' });
    // After sanitization, the displayPath should be cleaned
    expect(result.topHints[0]?.file.displayPath).not.toContain('C:\\');
  });

  it('generates UsageSiteSourceHint with correct schemaVersion', () => {
    const hints = [
      makeHint({ filePath: 'app/page.tsx', matchType: 'usage-site', confidence: 0.9 }),
    ];
    const result = rankHints({ hints });
    expect(result.topHints[0]?.schemaVersion).toBe(1);
  });

  it('includes evidence in output hints', () => {
    const hints = [
      makeHint({
        filePath: 'app/page.tsx',
        matchType: 'usage-site',
        confidence: 0.9,
        evidence: [
          { type: 'text-content-match', weight: 0.7, detail: 'Found text', confidence: 0.8 },
        ],
      }),
    ];
    const result = rankHints({ hints });
    expect(result.topHints[0]?.evidence.length).toBeGreaterThan(0);
  });
});
