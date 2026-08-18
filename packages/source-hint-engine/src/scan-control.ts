/**
 * Phase 33A — scan control surface: deadline budget, file budget, and
 * cooperative cancellation.
 *
 * A scan carries a `ScanBudget` (maxFiles/maxTimeMs, optional AbortSignal).
 * Budgets are enforced at scheduling points (before new work is picked up) so
 * that once a budget is exceeded or the signal aborts, no new filesystem work
 * is scheduled. Already scheduled bounded work settles, then the caller maps
 * the typed error to unavailable/partial source evidence.
 */

export interface ScanBudget {
  /** Maximum number of files the scan may touch. */
  maxFiles: number;
  /** Maximum wall-clock time for the scan, in milliseconds. */
  maxTimeMs: number;
  /** Cooperative cancellation signal; aborting stops new work being scheduled. */
  signal?: AbortSignal;
}

/** Default scan budget — Phase 30 latency boundary (finite, bounded). */
export const DEFAULT_SCAN_BUDGET: ScanBudget = { maxFiles: 3000, maxTimeMs: 2500 };

/** Thrown when a scan exceeds its budget; the engine maps it to `unavailable`. */
export class ScanBudgetExceededError extends Error {
  constructor() {
    super('Source scan budget exceeded');
    this.name = 'ScanBudgetExceededError';
  }
}

/** Thrown when a scan is aborted via its AbortSignal. */
export class ScanCancelledError extends Error {
  constructor() {
    super('Source scan cancelled');
    this.name = 'ScanCancelledError';
  }
}

export interface BudgetState {
  files: number;
  startMs: number;
  budget: ScanBudget;
}

/**
 * Record one budgeted file. Throws when the file or time budget is exceeded,
 * or when the scan signal has aborted. Deterministic for the file budget;
 * the time budget is checked per file as before (Phase 30).
 */
export function touchBudget(state: BudgetState): void {
  if (state.budget.signal?.aborted) throw new ScanCancelledError();
  state.files++;
  if (state.files > state.budget.maxFiles || Date.now() - state.startMs > state.budget.maxTimeMs) {
    throw new ScanBudgetExceededError();
  }
}
