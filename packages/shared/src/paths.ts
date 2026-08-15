/**
 * Source-hint path safety (Phase 30A).
 *
 * Repository-relative source paths are the ONLY representation allowed to
 * cross the persisted-capture / agent boundary. This predicate is the
 * single load-side gate: the persisted packet schema and the agent
 * projection both use it, so a corrupt or tampered capture containing an
 * absolute, drive-letter, URI, or traversal path fails validation — it is
 * never merely hidden at render time.
 *
 * Rejected forms (examples):
 *   ../../secret.ts      — parent traversal
 *   C:\secret.ts         — Windows drive letter / backslash separators
 *   /Users/x/secret.ts   — POSIX absolute
 *   file:///tmp/x.ts     — URI scheme
 *   src/..\secret.ts     — embedded backslash traversal
 */
export function isSafeRelativeSourcePath(p: string): boolean {
  if (typeof p !== 'string' || p.length === 0) return false;
  // Backslashes are never part of a repository-relative path: rejecting them
  // covers Windows absolute paths, drive letters, and mixed traversal.
  if (p.includes('\\')) return false;
  // POSIX absolute.
  if (p.startsWith('/')) return false;
  // Windows drive letter (with or without separator).
  if (/^[A-Za-z]:/.test(p)) return false;
  // URI scheme.
  if (p.startsWith('file://')) return false;
  // Parent/current traversal — leading, middle, or trailing '..' segments.
  if (p.split('/').includes('..')) return false;
  return true;
}
