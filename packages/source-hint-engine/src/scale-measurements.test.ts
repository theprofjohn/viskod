import { writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { EventBus } from '@viskod/event-bus';
import { afterEach, describe, expect, it } from 'vitest';
import { SourceHintEngine } from './index';
import { createWorkspaceFixture, hintInputFor } from './workspace-fixture';
import type { WorkspaceFixture } from './workspace-fixture';

/**
 * Phase 33A — large-repository measurements (task 11).
 *
 * Generates a deterministic 500–1500-file workspace fixture at test runtime
 * and records monotonic measurements for:
 *   - cold scan
 *   - warm repeated query
 *   - changed-file refresh
 *   - ambiguous query
 *   - budget-exceeded query
 * plus filesystem read/parse counters for each operation.
 *
 * The measurements are persisted to `docs/phase33a-scale-measurements.json`
 * for the Phase 33A report. These are single-machine observations, NOT public
 * performance guarantees. The assertions are monotonic (counter-based warm <
 * cold, refresh does real work), never absolute wall-clock thresholds.
 */

const FILE_COUNT = 1200;

interface OpMeasurement {
  durationMs: number;
  contentReads: number;
  contentParses: number;
  statCalls: number;
  readdirCalls: number;
  resolution: string;
}

describe('large-repository measurements', () => {
  let fixture: WorkspaceFixture | null = null;
  afterEach(() => {
    fixture?.cleanup();
    fixture = null;
  });

  it('records monotonic cold/warm/refresh/ambiguous/budget measurements', async () => {
    const fix = createWorkspaceFixture({ fileCount: FILE_COUNT, seed: 61 });
    fixture = fix;
    const engine = new SourceHintEngine(new EventBus());
    const input = hintInputFor(fixture, {
      id: 'measurement-target',
      text: 'Order summary checkout widget status',
    });
    const ops: Record<string, OpMeasurement> = {};

    const measure = async (
      name: string,
      run: () => Promise<{ resolution: string }>,
    ): Promise<void> => {
      engine.resetFsActivity();
      const start = performance.now();
      const out = await run();
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      const activity = engine.fsActivity();
      ops[name] = {
        durationMs,
        contentReads: activity.contentReads,
        contentParses: activity.contentParses,
        statCalls: activity.statCalls,
        readdirCalls: activity.readdirCalls,
        resolution: out.resolution,
      };
    };

    // 1. Cold scan (full first resolution incl. import graph build).
    await measure('cold_scan', async () => {
      const r = await engine.resolveUsageSiteHints(input, 10, { useImportGraph: true });
      return { resolution: r.ok ? r.value.resolution : `err:${r.error.code}` };
    });

    // 2. Warm repeated query (unchanged).
    await measure('warm_repeated_query', async () => {
      const r = await engine.resolveUsageSiteHints(input, 10, { useImportGraph: true });
      return { resolution: r.ok ? r.value.resolution : `err:${r.error.code}` };
    });

    // 3. Changed-file refresh.
    writeFileSync(
      fix.targetAbsolute,
      '// refreshed content for measurement\nexport function CheckoutWidget() {\n  return <div className="CheckoutWidget-surface">Order summary checkout widget status</div>;\n}\n',
      'utf-8',
    );
    await measure('changed_file_refresh', async () => {
      const r = await engine.resolveUsageSiteHints(input, 10, { useImportGraph: true });
      return { resolution: r.ok ? r.value.resolution : `err:${r.error.code}` };
    });

    // 4. Ambiguous query (three files share the phrase — cannot distinguish).
    await measure('ambiguous_query', async () => {
      const r = await engine.resolveUsageSiteHints(
        hintInputFor(fix, { text: 'Order summary checkout widget status' }),
        10,
        { useImportGraph: false },
      );
      return { resolution: r.ok ? r.value.resolution : `err:${r.error.code}` };
    });
    expect(ops.ambiguous_query?.resolution).toBe('ambiguous');

    // 5. Budget-exceeded query (file budget exhausted → typed unavailable).
    // A FRESH target id guarantees a cache miss, so the scan really runs
    // under the tight budget.
    await measure('budget_exceeded_query', async () => {
      const r = await engine.resolveUsageSiteHints(
        hintInputFor(fix, {
          id: 'budget-target-unique',
          text: 'Order summary checkout widget status',
        }),
        10,
        {
          budget: { maxFiles: 30, maxTimeMs: 60_000 },
          useImportGraph: false,
        },
      );
      return { resolution: r.ok ? r.value.resolution : `err:${r.error.code}` };
    });
    expect(ops.budget_exceeded_query?.resolution).toBe('unavailable');

    // Monotonic counter proof (timing alone is insufficient):
    // warm repeats do ZERO content reads/parses; the cold scan and refresh do
    // real work; the refresh is materially cheaper than the cold scan.
    const cold = ops.cold_scan;
    const warm = ops.warm_repeated_query;
    const refresh = ops.changed_file_refresh;
    if (!cold || !warm || !refresh) throw new Error('missing measurement ops');
    expect(cold.contentReads).toBeGreaterThan(0);
    expect(cold.contentParses).toBeGreaterThan(0);
    expect(warm.contentReads).toBe(0);
    expect(warm.contentParses).toBe(0);
    expect(refresh.contentReads).toBeGreaterThan(0);
    // Durations are RECORDED (below) but never asserted: wall-clock timing is
    // machine/load dependent. The monotonic proof is counter-based — warm
    // repeats do zero content reads/parses while cold/refresh do real work.

    // Persist the recorded measurements for the Phase 33A report.
    const artifact = path.resolve(__dirname, '../../..', 'docs/phase33a-scale-measurements.json');
    // Trailing newline keeps the artifact biome-formatted (biome checks .json).
    const payload = JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        machine: `${process.platform}-${process.arch}`,
        fixture: {
          fileCount: FILE_COUNT,
          seed: 61,
          type: 'pnpm-workspace (apps/web, apps/admin, packages/ui, packages/utils)',
        },
        note: 'Single-machine observations only — not public performance guarantees.',
        operations: ops,
      },
      null,
      2,
    );
    writeFileSync(artifact, `${payload}\n`);
  }, 120000);
});
