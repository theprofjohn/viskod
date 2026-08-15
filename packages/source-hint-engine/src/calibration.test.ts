import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from '@viskod/event-bus';
import { describe, expect, it } from 'vitest';
import { SourceHintEngine, computeSourceResolution } from './index';

/**
 * Phase 30 calibration corpus (VISKOD-AUDIT-008).
 *
 * Deterministic fixtures representing realistic source-resolution
 * ambiguity. Tests assert PRODUCT MEANING — semantic qualification,
 * ambiguity, availability — never arbitrary decimal scores.
 */

function makeInput(tmpDir: string, overrides: Record<string, unknown> = {}) {
  return {
    domContext: {
      tagName: 'div',
      className: '',
      id: '',
      text: '',
      ...((overrides.domContext as Record<string, unknown>) ?? {}),
    },
    route: {
      url: 'http://localhost:3000/settings',
      pathname: '/settings',
      ...((overrides.route as Record<string, unknown>) ?? {}),
    },
    project: {
      metadata: {
        projectId: 'calib',
        name: 'calib-app',
        rootPath: tmpDir,
        packageManager: 'pnpm',
        language: 'typescript',
      },
      componentIndex: { directories: ['src/components'] },
      ...((overrides.project as Record<string, unknown>) ?? {}),
    },
    captureId: 'calib-capture',
  };
}

function write(dir: string, rel: string, content: string): void {
  const full = join(dir, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

function makeTmp(): string {
  return join(tmpdir(), `viskod-calib-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
}

const HIGH_CONFIDENCE = 0.9;
const PROBABLE_MIN = 0.65;

// ---------------------------------------------------------------------------
// A. Unique component — one strong likely source
// ---------------------------------------------------------------------------

describe('calibration corpus A — unique component', () => {
  it('route + import closure + unique visible text → probable top candidate', async () => {
    const dir = makeTmp();
    write(
      dir,
      'src/features/settings/SaveButton.tsx',
      'export function SaveButton() { return <button>Save changes</button>; }',
    );
    write(
      dir,
      'app/settings/page.tsx',
      'import { SaveButton } from "../../src/features/settings/SaveButton";\nexport default function Page() { return <SaveButton />; }',
    );
    write(dir, 'src/components/button.tsx', 'export function Button() { return <button />; }');

    const engine = new SourceHintEngine(new EventBus());
    const input = makeInput(dir, {
      domContext: { tagName: 'button', className: '', id: '', text: 'Save changes' },
      route: {
        url: 'http://localhost:3000/settings',
        pathname: '/settings',
        matchedRoute: {
          path: '/settings',
          file: 'app/settings/page.tsx',
          type: 'page',
          isDynamic: false,
        },
      },
    });
    const result = await engine.resolveUsageSiteHints(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.resolution).toBe('resolved');
    const top = result.value.topHints[0];
    expect(top).toBeDefined();
    // The component file renders the unique text and is imported by the route.
    expect(top?.file.displayPath).toBe('src/features/settings/SaveButton.tsx');
    expect(['probable', 'exact']).toContain(top?.qualification);
    expect(top?.ranking.confidence).toBeGreaterThanOrEqual(PROBABLE_MIN);
    expect(top?.reasons.length).toBeGreaterThan(0);
    // Deterministic: same input twice → identical output.
    const again = await engine.resolveUsageSiteHints(input);
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.value.topHints.map((h) => h.file.displayPath)).toEqual(
        result.value.topHints.map((h) => h.file.displayPath),
      );
    }

    rmSync(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// B. Duplicate visible text — same text in unrelated files
// ---------------------------------------------------------------------------

describe('calibration corpus B — duplicate visible text', () => {
  it('identical text in two files → ambiguous, never a high-confidence winner', async () => {
    const dir = makeTmp();
    write(
      dir,
      'src/features/a/Widget.jsx',
      'export function Widget() { return <p>Duplicate status text: processing</p>; }',
    );
    write(
      dir,
      'src/features/b/Widget.jsx',
      'export function Widget() { return <p>Duplicate status text: processing</p>; }',
    );

    const engine = new SourceHintEngine(new EventBus());
    const input = makeInput(dir, {
      domContext: {
        tagName: 'p',
        className: '',
        id: '',
        text: 'Duplicate status text: processing',
      },
    });
    const result = await engine.resolveUsageSiteHints(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.resolution).toBe('ambiguous');
    expect(result.value.topHints.length).toBeGreaterThanOrEqual(2);
    for (const h of result.value.topHints) {
      // Duplicate-text candidates can never be high/exact confidence.
      expect(h.qualification).toBe('weak');
      expect(h.ranking.confidence).toBeLessThan(HIGH_CONFIDENCE);
      expect(h.reasons.some((r) => r.toLowerCase().includes('other files'))).toBe(true);
    }
    // Neither presented as the confirmed source.
    expect(result.value.topHints[0]?.status).toBe('ambiguous');

    rmSync(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// C. Shared design-system component vs feature usage site
// ---------------------------------------------------------------------------

describe('calibration corpus C — shared design-system component', () => {
  it('generic Card vs feature page: no unjustified high certainty, ambiguity or clear evidence', async () => {
    const dir = makeTmp();
    write(
      dir,
      'src/components/Card.tsx',
      'export function Card() { return <div className="card" />; }',
    );
    write(
      dir,
      'src/features/dashboard/page.tsx',
      'import { Card } from "../../components/Card";\nexport default function Page() { return <Card>Dashboard summary</Card>; }',
    );

    const engine = new SourceHintEngine(new EventBus());
    const input = makeInput(dir, {
      domContext: {
        tagName: 'div',
        className: 'card',
        id: '',
        text: 'Dashboard summary',
      },
      // No route information: both candidates are weakly supported.
    });
    const result = await engine.resolveUsageSiteHints(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Without route/import corroboration neither file is a confident answer.
    expect(result.value.topHints[0]?.ranking.confidence).toBeLessThan(HIGH_CONFIDENCE);
    for (const h of result.value.topHints) {
      expect(['possible', 'weak']).toContain(h.qualification);
    }
    // Either ambiguous or a possible-level leader — never probable/exact.
    expect(['ambiguous', 'resolved']).toContain(result.value.resolution);
    if (result.value.resolution === 'resolved') {
      expect(result.value.topHints[0]?.qualification).not.toBe('probable');
    }

    rmSync(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// D. Wrapper component imports a shared primitive
// ---------------------------------------------------------------------------

describe('calibration corpus D — wrapper component', () => {
  it('wrapper with the visible text outranks the shared primitive', async () => {
    const dir = makeTmp();
    write(
      dir,
      'src/components/Button.tsx',
      'export function Button() { return <button>Button</button>; }',
    );
    write(
      dir,
      'src/features/payments/Wrapper.tsx',
      'import { Button } from "../../components/Button";\nexport function Wrapper() { return <Button>Pay outstanding invoice</Button>; }',
    );

    const engine = new SourceHintEngine(new EventBus());
    const input = makeInput(dir, {
      domContext: {
        tagName: 'button',
        className: '',
        id: '',
        text: 'Pay outstanding invoice',
      },
    });
    const result = await engine.resolveUsageSiteHints(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const top = result.value.topHints[0];
    expect(top?.file.displayPath).toBe('src/features/payments/Wrapper.tsx');
    expect(top?.qualification).toBe('possible');
    // The shared primitive is NOT presented as the confirmed source.
    const button = result.value.topHints.find((h) => h.file.displayPath.includes('Button.tsx'));
    if (button) {
      expect(button.qualification).not.toBe('probable');
      expect(button.qualification).not.toBe('exact');
    }

    rmSync(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// E. Current-route corroboration
// ---------------------------------------------------------------------------

describe('calibration corpus E — current-route corroboration', () => {
  it('on-route candidate with route ownership beats off-route duplicate text', async () => {
    const dir = makeTmp();
    write(
      dir,
      'app/orders/page.tsx',
      'export default function Page() { return <p>Order status: shipped</p>; }',
    );
    write(
      dir,
      'src/components/OrderNote.tsx',
      'export function OrderNote() { return <p>Order status: shipped</p>; }',
    );

    const engine = new SourceHintEngine(new EventBus());
    const input = makeInput(dir, {
      domContext: { tagName: 'p', className: '', id: '', text: 'Order status: shipped' },
      route: {
        url: 'http://localhost:3000/orders',
        pathname: '/orders',
        matchedRoute: {
          path: '/orders',
          file: 'app/orders/page.tsx',
          type: 'page',
          isDynamic: false,
        },
      },
    });
    const result = await engine.resolveUsageSiteHints(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The route-owned candidate is stronger than the off-route text match.
    expect(result.value.resolution).toBe('resolved');
    const top = result.value.topHints[0];
    expect(top?.file.displayPath).toBe('app/orders/page.tsx');
    expect(['probable', 'exact']).toContain(top?.qualification);
    const offRoute = result.value.topHints.find((h) =>
      h.file.displayPath.includes('OrderNote.tsx'),
    );
    expect(offRoute?.qualification).toBe('weak');

    rmSync(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// F. Repeated labels — several "Save"/"Submit"/"Settings" strings
// ---------------------------------------------------------------------------

describe('calibration corpus F — repeated labels', () => {
  it('a common label in several files never produces a high-confidence source', async () => {
    const dir = makeTmp();
    for (const name of ['A', 'B', 'C']) {
      write(
        dir,
        `src/features/${name}/Form.jsx`,
        `export function Form${name}() { return <button>Save</button>; }`,
      );
    }

    const engine = new SourceHintEngine(new EventBus());
    const input = makeInput(dir, {
      domContext: { tagName: 'button', className: '', id: '', text: 'Save' },
    });
    const result = await engine.resolveUsageSiteHints(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const h of result.value.topHints) {
      expect(h.qualification).toBe('weak');
      expect(h.ranking.confidence).toBeLessThan(HIGH_CONFIDENCE);
    }
    // Ambiguous (tied) or at most low-confidence — never a confident claim.
    expect(['ambiguous', 'low_confidence', 'missing']).toContain(result.value.status);

    rmSync(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// G. No evidence — unavailable, never fabricated
// ---------------------------------------------------------------------------

describe('calibration corpus G — no evidence', () => {
  it('no matching file → unavailable, no fabricated source path', async () => {
    const dir = makeTmp();
    write(dir, 'src/components/Unrelated.tsx', 'export function Unrelated() { return null; }');

    const engine = new SourceHintEngine(new EventBus());
    const input = makeInput(dir, {
      domContext: {
        tagName: 'div',
        className: 'zzz-nonexistent-klass',
        id: '',
        // Words deliberately absent from every scanned file.
        text: 'Quantum flux capacitor malfunction detected',
      },
    });
    const result = await engine.resolveUsageSiteHints(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.resolution).toBe('unavailable');
    expect(result.value.status).toBe('missing');
    expect(result.value.topHints).toHaveLength(0);
    // No plausible-looking path is fabricated to fill the field.
    expect(result.value.topHints.some((h) => h.file.displayPath.includes('zzz-nonexistent'))).toBe(
      false,
    );

    rmSync(dir, { recursive: true, force: true });
  });

  it('unknown project root → unavailable', async () => {
    const engine = new SourceHintEngine(new EventBus());
    const input = makeInput('/nonexistent-root', {
      project: {
        metadata: {
          projectId: 'calib',
          name: 'calib-app',
          rootPath: '',
          packageManager: 'pnpm',
          language: 'typescript',
        },
        componentIndex: { directories: ['src/components'] },
      },
    });
    const result = await engine.generateHints(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SH_NO_ROOT_PATH');
  });
});

// ---------------------------------------------------------------------------
// Deterministic ordering — repeated runs, stable tie-breaks
// ---------------------------------------------------------------------------

describe('deterministic candidate ordering', () => {
  it('equal-evidence candidates order stably by relative path, not fs order', async () => {
    const dir = makeTmp();
    // Same duplicate text in several files; creation order is deliberately
    // NOT alphabetical (z before a) to prove fs enumeration order is ignored.
    write(
      dir,
      'src/features/zzz/Z.jsx',
      'export function Z() { return <p>Repeated banner text: welcome</p>; }',
    );
    write(
      dir,
      'src/features/aaa/A.jsx',
      'export function A() { return <p>Repeated banner text: welcome</p>; }',
    );
    write(
      dir,
      'src/features/mmm/M.jsx',
      'export function M() { return <p>Repeated banner text: welcome</p>; }',
    );

    const engine = new SourceHintEngine(new EventBus());
    const input = makeInput(dir, {
      domContext: { tagName: 'p', className: '', id: '', text: 'Repeated banner text: welcome' },
    });
    const first = await engine.resolveUsageSiteHints(input);
    const second = await engine.resolveUsageSiteHints(input);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const order1 = first.value.topHints.map((h) => h.file.displayPath);
    const order2 = second.value.topHints.map((h) => h.file.displayPath);
    expect(order1).toEqual(order2);
    // Fully tied candidates sort by path: aaa, mmm, zzz.
    expect(order1[0]).toContain('aaa');
    expect(order1[1]).toContain('mmm');
    expect(order1[2]).toContain('zzz');
  });

  it('computeSourceResolution is deterministic and path-stable', () => {
    const a = { confidence: 0.34, qualification: 'weak' as const, path: 'src/b.tsx' };
    const b = { confidence: 0.34, qualification: 'weak' as const, path: 'src/a.tsx' };
    const r1 = computeSourceResolution([b, a]);
    const r2 = computeSourceResolution([a, b]);
    expect(r1).toEqual(r2);
    expect(r1.resolution).toBe('ambiguous');
  });
});
