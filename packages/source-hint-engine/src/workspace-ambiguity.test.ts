import { EventBus } from '@viskod/event-bus';
import { afterEach, describe, expect, it } from 'vitest';
import { SourceHintEngine, resolveWorkspaceDirs } from './index';
import { createWorkspaceFixture, hintInputFor } from './workspace-fixture';
import type { WorkspaceFixture } from './workspace-fixture';

/**
 * Phase 33A — multi-app ambiguity.
 *
 * A workspace with TWO apps (apps/web, apps/admin) that both use the SAME
 * shared package (packages/ui) and carry EQUIVALENT target evidence: the
 * visible phrase appears in the shared widget AND in both apps' pages. App
 * ownership cannot be distinguished, so resolution must stay `ambiguous` —
 * the engine must NOT pick a winner by path sorting, and Phase 30 confidence
 * thresholds are untouched (this test never changes evidence calibration).
 */
describe('multi-app workspace ambiguity', () => {
  let fixture: WorkspaceFixture | null = null;
  afterEach(() => {
    fixture?.cleanup();
    fixture = null;
  });

  it('equivalent evidence across two apps and the shared package stays ambiguous', async () => {
    const fix = createWorkspaceFixture({ fileCount: 120, seed: 51 });
    fixture = fix;
    const engine = new SourceHintEngine(new EventBus());
    const input = hintInputFor(fixture, { text: 'Order summary checkout widget status' });

    const result = await engine.resolveUsageSiteHints(input, 10, { useImportGraph: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The shared package and BOTH apps are candidates with identical evidence.
    const paths = result.value.topHints.map((h) => h.file.displayPath);
    expect(paths).toContain(fix.targetFile); // packages/ui/src/CheckoutWidget.tsx
    expect(paths).toContain(fix.webFile); // apps/web/src/CheckoutPage.tsx
    expect(paths).toContain(fix.adminFile); // apps/admin/src/DashboardPage.tsx

    // No path-sorting winner: the evidence cannot distinguish app ownership,
    // so the resolution is ambiguous with equally-weak candidates.
    expect(result.value.resolution).toBe('ambiguous');
    const phraseHints = result.value.topHints.filter((h) =>
      [fix.targetFile, fix.webFile, fix.adminFile].includes(h.file.displayPath),
    );
    expect(phraseHints.length).toBe(3);
    // Equivalent evidence: identical calibrated evidence confidence (the
    // ranking confidence may differ only by kind penalty, never by path).
    const evidenceConfidences = phraseHints.map((h) => h.evidence[0]?.confidence);
    expect(new Set(evidenceConfidences).size).toBe(1);
    for (const h of phraseHints) {
      expect(h.qualification).toBe('weak');
    }
    // Phase 30 thresholds untouched: no threshold constants changed here, and
    // duplicate-text candidates remain capped weak (never probable/exact).
    for (const h of result.value.topHints) {
      expect(h.qualification).not.toBe('probable');
      expect(h.qualification).not.toBe('exact');
    }
  });

  it('a target that uniquely identifies ONE app resolves instead of sorting by path', async () => {
    const fix = createWorkspaceFixture({ fileCount: 120, seed: 52 });
    fixture = fix;
    const engine = new SourceHintEngine(new EventBus());
    // The id exists ONLY in the web app's page: app ownership IS
    // distinguishable, so resolution resolves to the web file even though
    // packages/ui sorts before apps/web alphabetically.
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      fix.targetAbsolute,
      '// neutral\nexport function CheckoutWidget() {\n  return <div className="CheckoutWidget-surface">Order summary checkout widget status</div>;\n}\n',
      'utf-8',
    );
    writeFileSync(
      `${fix.root}/apps/web/src/CheckoutPage.tsx`,
      'import { CheckoutWidget } from \'@acme/ui/CheckoutWidget\';\n// deterministic fixture component CheckoutPage\nexport function CheckoutPage() {\n  return <div id="web-only-target" className="CheckoutPage-surface">Order summary checkout widget status</div>;\n}\n',
      'utf-8',
    );
    writeFileSync(
      `${fix.root}/apps/admin/src/DashboardPage.tsx`,
      'import { CheckoutWidget } from \'@acme/ui/CheckoutWidget\';\n// deterministic fixture component DashboardPage\nexport function DashboardPage() {\n  return <div className="DashboardPage-surface">Order summary checkout widget status</div>;\n}\n',
      'utf-8',
    );

    const input = hintInputFor(fixture, {
      id: 'web-only-target',
      text: 'Order summary checkout widget status',
    });
    const result = await engine.resolveUsageSiteHints(input, 10, { useImportGraph: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.resolution).toBe('resolved');
    const primary = result.value.topHints[0];
    expect(primary?.file.displayPath).toBe(fix.webFile);
    expect(primary?.qualification).not.toBe('weak');
  });

  it('resolveWorkspaceDirs covers both apps and the shared package roots', () => {
    const fix = createWorkspaceFixture({ fileCount: 40, seed: 53 });
    fixture = fix;
    const dirs = resolveWorkspaceDirs(fix.appDirs, fix.workspace);
    expect(dirs).toContain('apps/web/src');
    expect(dirs).toContain('apps/admin/src');
    expect(dirs).toContain('packages/ui/src');
    expect(dirs).toContain('packages/utils/src');
  });
});
