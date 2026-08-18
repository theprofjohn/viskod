import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './async-pool';
import { ScanCancelledError } from './scan-control';

/**
 * Deferred gate. Executor form (not Promise.withResolvers) because the
 * repository targets ES2022, which lacks `withResolvers`.
 */
function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

/**
 * Phase 33A — bounded concurrency contract.
 *
 * Deterministic instrumentation: workers record an active-count peak via a
 * shared counter incremented on entry and decremented on exit. Interleaving
 * is driven by a gate the test opens once the first window is in flight — no
 * wall-clock timers, no races.
 */
describe('mapWithConcurrency', () => {
  it('never exceeds the configured concurrency limit', async () => {
    const limit = 4;
    const total = 50;
    const gate = deferred();
    const started = deferred();
    let startedCount = 0;
    let active = 0;
    let peak = 0;

    const resultsPromise = mapWithConcurrency(
      Array.from({ length: total }, (_, i) => i),
      limit,
      async (item) => {
        active++;
        peak = Math.max(peak, active);
        startedCount++;
        if (startedCount === limit) started.resolve();
        await gate.promise;
        active--;
        return item * 2;
      },
    );

    // Wait for the first window to be in flight, then open the gate.
    await started.promise;
    gate.resolve();
    const results = await resultsPromise;

    expect(peak).toBeLessThanOrEqual(limit);
    expect(peak).toBe(limit); // the limit was actually exercised
    // Order preserved.
    expect(results).toEqual(Array.from({ length: total }, (_, i) => i * 2));
  });

  it('runs single-item lists with limit 1', async () => {
    const calls: number[] = [];
    const results = await mapWithConcurrency([7], 1, async (item) => {
      calls.push(item);
      return item + 1;
    });
    expect(results).toEqual([8]);
    expect(calls).toEqual([7]);
  });

  it('handles empty input without scheduling anything', async () => {
    const results = await mapWithConcurrency([], 4, async (item) => item);
    expect(results).toEqual([]);
  });

  it('clamps invalid limits to at least 1', async () => {
    const results = await mapWithConcurrency([1, 2, 3], 0, async (item) => item);
    expect(results).toEqual([1, 2, 3]);
  });

  it('stops scheduling new work after abort and lets in-flight settle', async () => {
    const controller = new AbortController();
    const gate = deferred();
    const firstWindow = deferred();
    const scheduled = new Set<number>();
    let active = 0;
    let peak = 0;
    let startedCount = 0;

    const promise = mapWithConcurrency(
      Array.from({ length: 20 }, (_, i) => i),
      3,
      async (item) => {
        scheduled.add(item);
        active++;
        peak = Math.max(peak, active);
        startedCount++;
        if (startedCount === 3) firstWindow.resolve();
        await gate.promise;
        active--;
        return item;
      },
      { signal: controller.signal },
    );

    // The first window (3 workers) is guaranteed in flight before the abort
    // because the pool schedules synchronously up to the limit.
    await firstWindow.promise;
    controller.abort();
    gate.resolve(); // bounded in-flight window settles
    await expect(promise).rejects.toBeInstanceOf(ScanCancelledError);

    // Only the initially scheduled window ran; nothing new was scheduled
    // after the abort, and the peak never exceeded the limit.
    expect(scheduled.size).toBeLessThanOrEqual(3);
    expect(scheduled.size).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('rethrows a beforeSchedule error after in-flight work settles', async () => {
    const gate = deferred();
    const firstWindow = deferred();
    const started: number[] = [];
    let calls = 0;
    const budgetError = new Error('budget exceeded');

    const promise = mapWithConcurrency(
      Array.from({ length: 10 }, (_, i) => i),
      2,
      async (item) => {
        started.push(item);
        calls++;
        if (started.length === 2) firstWindow.resolve();
        await gate.promise;
        return item;
      },
      {
        beforeSchedule: (): void => {
          if (calls >= 2) throw budgetError;
        },
      },
    );

    await firstWindow.promise;
    gate.resolve(); // in-flight work settles
    await expect(promise).rejects.toBe(budgetError);
    // Exactly the bounded window ran; later items never started.
    expect(calls).toBe(2);
    expect(started).toEqual([0, 1]);
  });
});
