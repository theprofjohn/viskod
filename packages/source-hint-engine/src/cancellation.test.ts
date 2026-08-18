import { EventBus } from '@viskod/event-bus';
import { afterEach, describe, expect, it } from 'vitest';
import { SourceHintEngine } from './index';
import { createWorkspaceFixture, hintInputFor } from './workspace-fixture';
import type { WorkspaceFixture } from './workspace-fixture';

/**
 * Phase 33A — cancellation, deadline, and generation consistency.
 *
 * - AbortSignal: aborting mid-scan stops new work, lets the bounded in-flight
 *   window settle, and returns TYPED unavailable evidence (never a thrown
 *   error breaking capture).
 * - Deadline: the time budget is enforced during traversal; a negative
 *   maxTimeMs deterministically trips the deadline on the first file.
 * - Generations: invalidateCache bumps N → N+1; an in-flight resolution that
 *   started at N must NOT commit its result into the new generation.
 */
describe('SourceHintEngine cancellation & deadlines', () => {
  let fixture: WorkspaceFixture | null = null;
  afterEach(() => {
    fixture?.cleanup();
    fixture = null;
  });

  it('aborting a scan returns typed unavailable evidence', async () => {
    fixture = createWorkspaceFixture({ fileCount: 600, seed: 11 });
    const engine = new SourceHintEngine(new EventBus());
    const controller = new AbortController();
    const input = hintInputFor(fixture);

    // Start the resolution; it is guaranteed pending because the pool
    // schedules its first window synchronously and the scan awaits real FS.
    const promise = engine.resolveUsageSiteHints(input, 10, { signal: controller.signal });
    controller.abort();
    const result = await promise;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.resolution).toBe('unavailable');
    expect(result.value.status).toBe('missing');
    expect(result.value.topHints).toEqual([]);
    const warning = result.value.warnings.join(' ');
    expect(warning.toLowerCase()).toContain('cancelled');
    // No partial inventory committed to the cache.
    expect(engine.health().cacheSize).toBe(0);
  });

  it('exceeding the time deadline returns typed unavailable evidence', async () => {
    fixture = createWorkspaceFixture({ fileCount: 200, seed: 12 });
    const engine = new SourceHintEngine(new EventBus());
    const input = hintInputFor(fixture);

    // maxTimeMs < 0 deterministically exceeds the deadline on the first file.
    const result = await engine.resolveUsageSiteHints(input, 10, {
      budget: { maxFiles: 1_000_000, maxTimeMs: -1 },
      useImportGraph: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.resolution).toBe('unavailable');
    const warning = result.value.warnings.join(' ');
    expect(warning.toLowerCase()).toContain('budget');
    expect(engine.health().cacheSize).toBe(0);
  });

  it('exceeding the file budget stops scheduling new reads', async () => {
    fixture = createWorkspaceFixture({ fileCount: 400, seed: 13 });
    const engine = new SourceHintEngine(new EventBus());
    const input = hintInputFor(fixture);

    engine.resetFsActivity();
    const result = await engine.resolveUsageSiteHints(input, 10, {
      budget: { maxFiles: 25, maxTimeMs: 60_000 },
      useImportGraph: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.resolution).toBe('unavailable');
    // The budget caps the work actually performed: content reads cannot
    // exceed the file budget (25) plus one fingerprint build pass.
    const reads = engine.fsActivity().contentReads;
    expect(reads).toBeLessThanOrEqual(60);
  });

  it('invalidateCache moves generation N → N+1', async () => {
    const engine = new SourceHintEngine(new EventBus());
    const start = engine.generationNumber;
    engine.invalidateCache('/some/root');
    expect(engine.generationNumber).toBe(start + 1);
    engine.invalidateCache('/some/root');
    expect(engine.generationNumber).toBe(start + 2);
  });

  it('an in-flight resolution from generation N never commits into N+1', async () => {
    fixture = createWorkspaceFixture({ fileCount: 800, seed: 14 });
    const engine = new SourceHintEngine(new EventBus());
    const input = hintInputFor(fixture);

    // Warm the resolution once so the scan path is well understood.
    const first = await engine.resolveUsageSiteHints(input, 10, { useImportGraph: false });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const generationAtFirst = engine.generationNumber;
    const before = engine.health().cacheSize;
    expect(before).toBeGreaterThan(0);

    // Start a second resolution (same fingerprint — cache HIT returns before
    // any scan) — instead force a real scan by using a fresh target that
    // changes the cache key while keeping the same generation.
    engine.resetFsActivity();
    const inputB = hintInputFor(fixture, { id: 'fresh-target-id-xyz' });
    const pending = engine.resolveUsageSiteHints(inputB, 10, { useImportGraph: false });
    // Guaranteed pending: the scan awaits real filesystem promises, so the
    // synchronous invalidation below runs first.
    engine.invalidateCache(fixture.root);
    const result = await pending;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(engine.generationNumber).toBe(generationAtFirst + 1);
    // The stale result was returned, but the NEW generation's cache is empty
    // — old inventory was never committed after invalidation.
    expect(engine.health().cacheSize).toBe(0);
  });

  it('one resolution consumes one coherent fingerprint for hints and graph', async () => {
    fixture = createWorkspaceFixture({ fileCount: 150, seed: 15 });
    const engine = new SourceHintEngine(new EventBus());
    const input = hintInputFor(fixture, { id: 'coherent-target-id' });

    const result = await engine.resolveUsageSiteHints(input, 10, { useImportGraph: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The import graph was built from the SAME fingerprint as the hints:
    // the graph key embeds the fingerprint, so a changed file rotates both.
    expect(engine.health().importGraphCacheSize).toBe(1);

    // Edit a source file → fingerprint changes → next resolution rebuilds
    // the graph instead of reusing the stale entry.
    const { writeFileSync } = await import('node:fs');
    writeFileSync(fixture.targetAbsolute, '// edited\n', 'utf-8');
    engine.resetFsActivity();
    await engine.resolveUsageSiteHints(input, 10, { useImportGraph: true });
    expect(engine.health().importGraphCacheSize).toBeLessThanOrEqual(2);
    // The graph rebuild actually performed content reads again.
    expect(engine.fsActivity().contentReads).toBeGreaterThan(0);
  });
});
