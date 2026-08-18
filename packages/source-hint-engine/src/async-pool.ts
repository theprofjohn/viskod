import { ScanCancelledError } from './scan-control';

/**
 * Phase 33A — bounded asynchronous worker pool.
 *
 * Maps an item list to promises while guaranteeing the number of SIMULTANEOUS
 * in-flight workers never exceeds `limit`. Exactly `limit` serial runners
 * drain the shared FIFO queue, so peak concurrency is bounded by construction
 * — never an unbounded `Promise.all` over the whole item list.
 *
 * Cancellation semantics (Phase 33A):
 * - `signal.aborted` is checked BEFORE each item is scheduled; once aborted no
 *   new work is scheduled.
 * - `beforeSchedule` may throw (e.g. scan file/time budget exceeded); the
 *   first throw stops scheduling.
 * - Already scheduled (bounded) in-flight work is allowed to settle.
 * - After the window drains, the stopping error is rethrown so callers can map
 *   the outcome to typed unavailable/partial evidence.
 *
 * Deterministic ordering: results are returned in input order regardless of
 * completion order.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  options: { signal?: AbortSignal; beforeSchedule?: () => void } = {},
): Promise<R[]> {
  const effectiveLimit = Math.max(1, Math.floor(limit));
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let stopError: unknown = null;

  const runner = async (): Promise<void> => {
    for (;;) {
      if (stopError !== null) return;
      if (options.signal?.aborted) {
        stopError ??= new ScanCancelledError();
        return;
      }
      if (nextIndex >= items.length) return;
      const index = nextIndex++;
      try {
        options.beforeSchedule?.();
      } catch (error) {
        stopError ??= error;
        return;
      }
      results[index] = await worker(items[index] as T, index);
    }
  };

  const runnerCount = Math.min(effectiveLimit, items.length);
  const runners: Promise<void>[] = [];
  for (let i = 0; i < runnerCount; i++) {
    runners.push(runner());
  }
  // Bounded: exactly `runnerCount` promises, never one per item.
  await Promise.all(runners);

  if (stopError !== null) throw stopError;
  return results;
}
