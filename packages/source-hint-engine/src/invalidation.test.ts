import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { EventBus } from '@viskod/event-bus';
import { afterEach, describe, expect, it } from 'vitest';
import { SourceHintEngine } from './index';
import { createWorkspaceFixture, hintInputFor } from './workspace-fixture';
import type { WorkspaceFixture } from './workspace-fixture';

/**
 * Phase 33A — invalidation completeness.
 *
 * Every trigger updates results WITHOUT any process/Studio restart, on ONE
 * engine instance:
 * - source edit
 * - source addition
 * - source deletion (deleted/escaped paths never survive as valid hints)
 * - package.json change
 * - pnpm-workspace.yaml change
 */
describe('invalidation completeness (no restart)', () => {
  let fixture: WorkspaceFixture | null = null;
  afterEach(() => {
    fixture?.cleanup();
    fixture = null;
  });

  it('source addition appears in the next resolution', async () => {
    const fix = createWorkspaceFixture({ fileCount: 60, seed: 41 });
    fixture = fix;
    const engine = new SourceHintEngine(new EventBus());
    const input = hintInputFor(fixture, {
      id: 'brand-new-widget',
      text: 'Order summary checkout widget status',
    });

    const before = await engine.resolveUsageSiteHints(input, 10, { useImportGraph: false });
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(
      before.value.topHints.some((h) => h.file.displayPath === 'apps/web/src/BrandNewWidget.tsx'),
    ).toBe(false);

    // Add a file that defines the target id.
    writeFileSync(
      path.join(fix.root, 'apps/web/src/BrandNewWidget.tsx'),
      '// added after first resolution\nexport function BrandNewWidget() {\n  return <div id="brand-new-widget" className="BrandNewWidget-surface">Order summary checkout widget status</div>;\n}\n',
      'utf-8',
    );

    const after = await engine.resolveUsageSiteHints(input, 10, { useImportGraph: false });
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    const added = after.value.topHints.find(
      (h) => h.file.displayPath === 'apps/web/src/BrandNewWidget.tsx',
    );
    expect(added).toBeTruthy();
    expect(added?.qualification).not.toBe('weak');
  });

  it('source edit changes the resolution without restart', async () => {
    const fix = createWorkspaceFixture({ fileCount: 60, seed: 42 });
    fixture = fix;
    const engine = new SourceHintEngine(new EventBus());
    const input = hintInputFor(fixture, {
      id: 'checkout-widget',
      text: 'Order summary checkout widget status',
    });

    const before = await engine.resolveUsageSiteHints(input, 10, { useImportGraph: false });
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const beforeWidget = before.value.topHints.find((h) => h.file.displayPath === fix.targetFile);
    // Before the edit the widget is only a duplicate-text candidate: weak and
    // NOT the resolved primary (three files share the phrase).
    expect(before.value.resolution).toBe('ambiguous');
    expect(beforeWidget?.qualification).toBe('weak');

    // Edit the shared widget to define the target id — it must become the
    // strong resolved primary.
    writeFileSync(
      fix.targetAbsolute,
      '// edited\nexport function CheckoutWidget() {\n  return <div id="checkout-widget" className="CheckoutWidget-surface">Order summary checkout widget status</div>;\n}\n',
      'utf-8',
    );

    const after = await engine.resolveUsageSiteHints(input, 10, { useImportGraph: false });
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    const primary = after.value.topHints[0];
    expect(primary?.file.displayPath).toBe(fix.targetFile);
    expect(primary?.qualification).not.toBe('weak');
    expect(after.value.resolution).toBe('resolved');
  });

  it('source deletion removes the file and deleted paths never survive as hints', async () => {
    const fix = createWorkspaceFixture({ fileCount: 60, seed: 43 });
    fixture = fix;
    const engine = new SourceHintEngine(new EventBus());
    // Give the widget the strong id first so it is the primary candidate.
    writeFileSync(
      fix.targetAbsolute,
      '// prepped\nexport function CheckoutWidget() {\n  return <div id="checkout-widget" className="CheckoutWidget-surface">Order summary checkout widget status</div>;\n}\n',
      'utf-8',
    );
    const input = hintInputFor(fixture, {
      id: 'checkout-widget',
      text: 'Order summary checkout widget status',
    });

    const before = await engine.resolveUsageSiteHints(input, 10, { useImportGraph: false });
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.value.topHints[0]?.file.displayPath).toBe(fix.targetFile);

    // Delete the primary hint's file.
    unlinkSync(fix.targetAbsolute);

    const after = await engine.resolveUsageSiteHints(input, 10, { useImportGraph: false });
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    const paths = after.value.topHints.map((h) => h.file.displayPath);
    expect(paths).not.toContain(fix.targetFile);
    // Every surviving hint points at a file that still exists on disk and is
    // repository-relative — deleted/escaped paths never survive.
    for (const h of after.value.topHints) {
      expect(h.file.displayPath.startsWith('..')).toBe(false);
      expect(h.file.displayPath.startsWith('/')).toBe(false);
      expect(existsSync(path.join(fix.root, h.file.displayPath))).toBe(true);
    }
  });

  it('package.json change forces a refresh without restart', async () => {
    const fix = createWorkspaceFixture({ fileCount: 60, seed: 44 });
    fixture = fix;
    const engine = new SourceHintEngine(new EventBus());
    const input = hintInputFor(fixture, { id: 'pkg-target' });

    engine.resetFsActivity();
    const q1 = await engine.resolveUsageSiteHints(input, 10, { useImportGraph: false });
    expect(q1.ok).toBe(true);
    if (!q1.ok) return;

    engine.resetFsActivity();
    const q2 = await engine.resolveUsageSiteHints(input, 10, { useImportGraph: false });
    expect(q2.ok).toBe(true);
    if (!q2.ok) return;
    expect(engine.fsActivity().contentReads).toBe(0); // warm

    // package.json content change → config stat mismatch → fingerprint rotates.
    writeFileSync(
      path.join(fix.root, 'package.json'),
      JSON.stringify({ name: 'phase33a-root', private: true, version: '2.0.0' }, null, 2),
      'utf-8',
    );

    engine.resetFsActivity();
    const q3 = await engine.resolveUsageSiteHints(input, 10, { useImportGraph: false });
    expect(q3.ok).toBe(true);
    if (!q3.ok) return;
    expect(engine.fsActivity().contentReads).toBeGreaterThan(0); // refreshed
    expect(JSON.stringify(q3.value.topHints)).toBe(JSON.stringify(q2.value.topHints));

    engine.resetFsActivity();
    const q4 = await engine.resolveUsageSiteHints(input, 10, { useImportGraph: false });
    expect(q4.ok).toBe(true);
    if (!q4.ok) return;
    expect(engine.fsActivity().contentReads).toBe(0); // warm again
  });

  it('pnpm-workspace.yaml change plus a new package updates results without restart', async () => {
    const fix = createWorkspaceFixture({ fileCount: 60, seed: 45 });
    fixture = fix;
    const engine = new SourceHintEngine(new EventBus());
    const input = hintInputFor(fixture, {
      id: 'extra-widget',
      text: 'Order summary checkout widget status',
    });

    const before = await engine.resolveUsageSiteHints(input, 10, { useImportGraph: false });
    expect(before.ok).toBe(true);
    if (!before.ok) return;

    // Workspace change: add a new package with a phrase file, update the
    // workspace manifest AND the input's workspace metadata (as a re-run of
    // discoverWorkspace would produce).
    mkdirSync(path.join(fix.root, 'packages/extra/src'), { recursive: true });
    writeFileSync(
      path.join(fix.root, 'packages/extra/package.json'),
      JSON.stringify({ name: '@acme/extra', version: '1.0.0' }, null, 2),
      'utf-8',
    );
    writeFileSync(
      path.join(fix.root, 'packages/extra/src/ExtraWidget.tsx'),
      '// workspace addition\nexport function ExtraWidget() {\n  return <div id="extra-widget" className="ExtraWidget-surface">Order summary checkout widget status</div>;\n}\n',
      'utf-8',
    );
    writeFileSync(
      path.join(fix.root, 'pnpm-workspace.yaml'),
      'packages:\n  - "apps/*"\n  - "packages/*"\n  - "packages/extra"\n',
      'utf-8',
    );
    input.project.workspace = {
      ...fix.workspace,
      packages: [
        ...fix.workspace.packages,
        {
          name: '@acme/extra',
          relativeRoot: 'packages/extra',
          packageJsonPath: 'packages/extra/package.json',
          sourceRoots: ['packages/extra/src'],
          workspaceDependencies: [],
        },
      ],
    };

    const after = await engine.resolveUsageSiteHints(input, 10, { useImportGraph: false });
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    const extra = after.value.topHints.find(
      (h) => h.file.displayPath === 'packages/extra/src/ExtraWidget.tsx',
    );
    expect(extra).toBeTruthy();
    expect(extra?.qualification).not.toBe('weak');
  });
});
