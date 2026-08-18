import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from '@viskod/event-bus';
import { SourceHintEngine } from '@viskod/source-hint-engine';
import { describe, expect, it } from 'vitest';

function makeHintInput(tmpDir: string, overrides: Record<string, unknown> = {}) {
  return {
    domContext: {
      tagName: 'button',
      className: 'btn-primary',
      id: 'save-btn',
      role: 'button',
      text: 'Save changes',
      ...((overrides.domContext as Record<string, unknown>) ?? {}),
    },
    route: {
      url: 'http://localhost:3000/settings',
      pathname: '/settings',
      ...((overrides.route as Record<string, unknown>) ?? {}),
    },
    project: {
      metadata: {
        projectId: 'test-proj',
        name: 'test',
        rootPath: tmpDir,
        packageManager: 'pnpm',
        language: 'typescript',
      },
      componentIndex: { directories: ['src/components'] },
      ...((overrides.project as Record<string, unknown>) ?? {}),
    },
    captureId: 'test-capture',
  };
}

describe('resolveUsageSiteHints', () => {
  it('returns low_confidence or missing status when no hints available', async () => {
    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput('/nonexistent');
    const result = await engine.resolveUsageSiteHints(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // With nonexistent root, hints may be generated but with low confidence
      expect(['missing', 'low_confidence', 'ambiguous']).toContain(result.value.status);
    }
  });

  it('returns ranked hints with usage-site classification', async () => {
    const tmpDir = join(tmpdir(), `viskod-ush-test-${Date.now()}`);

    // Create project structure
    const compDir = join(tmpDir, 'src', 'components');
    const appDir = join(tmpDir, 'app', 'settings');
    mkdirSync(compDir, { recursive: true });
    mkdirSync(appDir, { recursive: true });

    writeFileSync(join(compDir, 'button.tsx'), 'export function Button() {}');
    writeFileSync(
      join(appDir, 'page.tsx'),
      'import { Button } from "@/components/button";\nexport default function Settings() { return <Button>Save changes</Button>; }',
    );

    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput(tmpDir);
    const result = await engine.resolveUsageSiteHints(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.topHints.length).toBeGreaterThan(0);
      const topHint = result.value.topHints[0];
      expect(topHint).toBeDefined();
      if (topHint) {
        expect(topHint.schemaVersion).toBe(1);
        expect(topHint.kind).toBeTruthy();
        expect(topHint.ranking).toBeDefined();
        expect(topHint.ranking.score).toBeGreaterThanOrEqual(0);
        expect(topHint.ranking.rank).toBe(1);
      }
    }

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('usage-site hint ranks above definition-site for text matches', async () => {
    const tmpDir = join(tmpdir(), `viskod-ush-usage-${Date.now()}`);

    const compDir = join(tmpDir, 'src', 'components');
    const featuresDir = join(tmpDir, 'src', 'features', 'settings');
    mkdirSync(compDir, { recursive: true });
    mkdirSync(featuresDir, { recursive: true });

    writeFileSync(join(compDir, 'button.tsx'), 'export function Button() {}');
    writeFileSync(
      join(featuresDir, 'page.tsx'),
      'import { Button } from "@/components/button";\nexport default function Settings() { return <Button>Save changes</Button>; }',
    );

    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput(tmpDir, {
      domContext: { tagName: 'button', text: 'Save changes', className: '' },
    });
    const result = await engine.resolveUsageSiteHints(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.topHints.length).toBeGreaterThan(0);
      // Top hint should be the usage site or route owner
      const topKind = result.value.topHints[0]?.kind;
      expect(['usage-site', 'route-owner', 'component-owner']).toContain(topKind);
    }

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('respects maxHints parameter', async () => {
    const tmpDir = join(tmpdir(), `viskod-ush-max-${Date.now()}`);
    const compDir = join(tmpDir, 'src', 'components');
    mkdirSync(compDir, { recursive: true });
    writeFileSync(join(compDir, 'button.tsx'), '');

    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput(tmpDir);
    const result = await engine.resolveUsageSiteHints(input, 2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.topHints.length).toBeLessThanOrEqual(2);
    }

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('includes route context in hints', async () => {
    const tmpDir = join(tmpdir(), `viskod-ush-route-${Date.now()}`);
    const appDir = join(tmpDir, 'app', 'settings');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, 'page.tsx'), '');

    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput(tmpDir, {
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
    if (result.ok && result.value.topHints.length > 0) {
      const routeHint = result.value.topHints.find((h) => h.route?.isCurrentRoute);
      expect(routeHint).toBeDefined();
    }

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('no absolute paths in output', async () => {
    const tmpDir = join(tmpdir(), `viskod-ush-paths-${Date.now()}`);
    const compDir = join(tmpDir, 'src', 'components');
    mkdirSync(compDir, { recursive: true });
    writeFileSync(join(compDir, 'button.tsx'), '');

    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput(tmpDir);
    const result = await engine.resolveUsageSiteHints(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const hint of result.value.topHints) {
        expect(hint.file.displayPath).not.toContain(tmpDir);
        expect(hint.file.displayPath).not.toContain('C:\\');
        expect(hint.file.displayPath).not.toContain('/home/');
      }
    }

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('no secrets in output', async () => {
    const tmpDir = join(tmpdir(), `viskod-ush-secrets-${Date.now()}`);
    const compDir = join(tmpDir, 'src', 'components');
    mkdirSync(compDir, { recursive: true });
    writeFileSync(join(compDir, 'button.tsx'), '');

    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput(tmpDir);
    const result = await engine.resolveUsageSiteHints(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = JSON.stringify(result.value);
      expect(output).not.toContain('sk_test_');
      expect(output).not.toContain('sk_live_');
      expect(output).not.toMatch(/ghp_[A-Za-z0-9]{36}/);
    }

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('deterministic ranking across calls', async () => {
    const tmpDir = join(tmpdir(), `viskod-ush-deterministic-${Date.now()}`);
    const compDir = join(tmpDir, 'src', 'components');
    mkdirSync(compDir, { recursive: true });
    writeFileSync(join(compDir, 'button.tsx'), '');

    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput(tmpDir);
    const result1 = await engine.resolveUsageSiteHints(input);
    const result2 = await engine.resolveUsageSiteHints(input);
    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    if (result1.ok && result2.ok) {
      expect(result1.value.topHints.map((h) => h.file.displayPath)).toEqual(
        result2.value.topHints.map((h) => h.file.displayPath),
      );
    }

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
