import { EventBus } from '@viskod/event-bus';
import { afterEach, describe, expect, it } from 'vitest';
import { SourceHintEngine } from './index';
import { createWorkspaceFixture, hintInputFor } from './workspace-fixture';
import type { WorkspaceFixture } from './workspace-fixture';

/**
 * Phase 33A — warm-cache proof with filesystem read/parse counters.
 *
 * Sequence (single engine instance, same input):
 *   1. cold query          → full scan (reads/parses > 0), result R1
 *   2. unchanged query     → SAME deterministic result, ZERO content reads
 *                            and ZERO parses (manifest-validated fingerprint)
 *   3. edit relevant source→ query refreshes (reads/parses > 0) and reflects
 *                            the new state (stable identifier appears)
 *   4. query after refresh → warm again (zero content reads/parses)
 *
 * Timing alone is never used: the assertions are counter deltas.
 */
describe('warm-cache proof (fs read/parse counters)', () => {
  let fixture: WorkspaceFixture | null = null;
  afterEach(() => {
    fixture?.cleanup();
    fixture = null;
  });

  it('cold → warm → refresh → warm with materially fewer reads/parses', async () => {
    fixture = createWorkspaceFixture({ fileCount: 300, seed: 31 });
    const engine = new SourceHintEngine(new EventBus());
    // Stable-id evidence is initially absent from every file: the three
    // phrase files are weak/ambiguous. After the edit the shared widget
    // defines the id, so it becomes the unique strong candidate.
    const input = hintInputFor(fixture, {
      id: 'checkout-widget',
      text: 'Order summary checkout widget status',
    });

    // 1. Cold query.
    engine.resetFsActivity();
    const q1 = await engine.resolveUsageSiteHints(input, 10, { useImportGraph: false });
    expect(q1.ok).toBe(true);
    if (!q1.ok) return;
    const cold = engine.fsActivity();
    expect(cold.contentReads).toBeGreaterThan(0);
    expect(cold.contentParses).toBeGreaterThan(0);
    expect(q1.value.resolution).toBe('ambiguous');
    const r1 = JSON.stringify(
      q1.value.topHints.map((h) => [h.file.displayPath, h.ranking.confidence]),
    );

    // 2. Unchanged query — warm.
    engine.resetFsActivity();
    const q2 = await engine.resolveUsageSiteHints(input, 10, { useImportGraph: false });
    expect(q2.ok).toBe(true);
    if (!q2.ok) return;
    const warm = engine.fsActivity();
    expect(warm.contentReads).toBe(0);
    expect(warm.contentParses).toBe(0);
    // Deterministic result: identical candidate set, order, and confidence.
    const r2 = JSON.stringify(
      q2.value.topHints.map((h) => [h.file.displayPath, h.ranking.confidence]),
    );
    expect(r2).toBe(r1);
    expect(q2.value.resolution).toBe('ambiguous');

    // 3. Edit the relevant source: the shared widget now defines the id.
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      fixture.targetAbsolute,
      `// deterministic fixture component CheckoutWidget\nexport function CheckoutWidget() {\n  return <div id="checkout-widget" className="CheckoutWidget-surface">Order summary checkout widget status</div>;\n}\n`,
      'utf-8',
    );

    engine.resetFsActivity();
    const q3 = await engine.resolveUsageSiteHints(input, 10, { useImportGraph: false });
    expect(q3.ok).toBe(true);
    if (!q3.ok) return;
    const refreshed = engine.fsActivity();
    expect(refreshed.contentReads).toBeGreaterThan(0); // actually rescanned
    expect(refreshed.contentParses).toBeGreaterThan(0);
    // The new state is reflected: the shared widget is now the strong,
    // resolved primary candidate — not the old ambiguous triple.
    expect(q3.value.resolution).toBe('resolved');
    const primary = q3.value.topHints[0];
    expect(primary?.file.displayPath).toBe(fixture.targetFile);
    expect(primary?.qualification).not.toBe('weak');
    const r3 = JSON.stringify(
      q3.value.topHints.map((h) => [h.file.displayPath, h.ranking.confidence]),
    );
    expect(r3).not.toBe(r1);

    // 4. Warm again after the refresh.
    engine.resetFsActivity();
    const q4 = await engine.resolveUsageSiteHints(input, 10, { useImportGraph: false });
    expect(q4.ok).toBe(true);
    if (!q4.ok) return;
    const warmAfter = engine.fsActivity();
    expect(warmAfter.contentReads).toBe(0);
    expect(warmAfter.contentParses).toBe(0);
    const r4 = JSON.stringify(
      q4.value.topHints.map((h) => [h.file.displayPath, h.ranking.confidence]),
    );
    expect(r4).toBe(r3);
  });
});
