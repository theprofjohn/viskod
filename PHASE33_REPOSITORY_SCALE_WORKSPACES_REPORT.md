# Phase 33: Repository Scale, Workspaces & Source-Resolution Performance — Completion Report

## Executive Summary

Phase 33 added monorepo/workspace support to Viskod's source resolution system. The implementation:

- Extended shared types with `WorkspaceMetadata` and `WorkspacePackageMetadata`
- Added workspace-aware directory scanning (`resolveWorkspaceDirs`)
- Added cross-package import resolution (`resolveWorkspaceImport`, `buildWorkspaceDependencyClosure`)
- Replaced unbounded caches with bounded LRU caches (500/5min hints, 50/10min import graph)
- Wired `discoverWorkspace()` into all three entry points (CLI, MCP, Studio)
- Added cache invalidation on workspace re-scan
- Created monorepo test fixture and integration tests

## Changes Summary

### New Files

- `packages/shared/src/workspace-metadata.test.ts` — WorkspaceMetadata type tests
- `packages/source-hint-engine/src/lru-cache.ts` — Generic LRU cache class
- `packages/source-hint-engine/src/lru-cache.test.ts` — LRU cache tests (9 tests)
- `packages/source-hint-engine/src/workspace-types.test.ts` — ProjectContext workspace field tests
- `packages/source-hint-engine/src/workspace-scan.test.ts` — resolveWorkspaceDirs tests (4 tests)
- `packages/source-hint-engine/src/workspace-imports.test.ts` — Cross-package import tests (6 tests)
- `packages/source-hint-engine/src/workspace-integration.test.ts` — Integration tests (4 tests)
- `packages/source-hint-engine/src/cache-bounds.test.ts` — Cache bounds tests (3 tests)
- `packages/context-engine/src/workspace-context.test.ts` — Context-engine workspace threading tests
- `packages/cli/src/workspace-wire.test.ts` — CLI workspace wiring tests
- `packages/mcp-server/src/workspace-wire.test.ts` — MCP workspace wiring tests
- `apps/studio/src/workspace-wire.test.ts` — Studio workspace wiring tests
- `tests/fixtures/monorepo/` — Monorepo test fixture (25 files across 3 packages)

### Modified Files

- `packages/shared/src/types.ts` — Added `WorkspaceMetadata` and `WorkspacePackageMetadata` interfaces
- `packages/context-engine/src/index.ts` — Extended `setProjectContext`/`getProjectContext` with workspace field
- `packages/source-hint-engine/src/types.ts` — Added workspace field to `ProjectContext`
- `packages/source-hint-engine/src/index.ts` — Added `resolveWorkspaceDirs`, replaced Maps with LRU caches, added `invalidateCache`
- `packages/source-hint-engine/src/import-graph.ts` — Added `resolveWorkspaceImport`, `buildWorkspaceDependencyClosure`
- `packages/cli/src/index.ts` — Wired `discoverWorkspace` and `invalidateCache`
- `packages/mcp-server/src/entry.ts` — Wired `discoverWorkspace` and `invalidateCache`
- `apps/studio/src/index.ts` — Wired `discoverWorkspace` and `invalidateCache`
- `packages/project-scanner/src/index.ts` — Fixed pre-existing type errors
- `tsconfig.json` — Excluded monorepo fixture from typecheck

## Test Results

| Package | Phase 33 Tests | Status |
|---------|---------------|--------|
| `@viskod/shared` | 2 | PASS |
| `@viskod/source-hint-engine` | 31 | PASS |
| `@viskod/context-engine` | 2 | PASS |
| `@viskod/cli` | 2 | PASS |
| `@viskod/mcp-server` | 1 | PASS |
| `apps/studio` | 1 | PASS |
| **Total Phase 33** | **37** | **PASS** |

| Metric | Value |
|--------|-------|
| Full test suite | 1156 passed, 11 failed |
| Pre-existing failures | 11 (all in `packages/setup/`) |
| New tests added (Phase 33) | 37 |
| Test files added (Phase 33) | 12 |
| Monorepo fixture files | 25 |

## Typecheck Results

- `pnpm typecheck` — PASS (clean)
- `pnpm lint` — 2 pre-existing errors in `packages/project-scanner/src/index.ts` (constant condition in unrelated code)

## Architecture Decisions

### 1. WorkspaceMetadata Projection

`WorkspaceDiscovery` (project-scanner) is NOT directly assignable to `WorkspaceMetadata` (shared) because of incompatible `workspaceType` unions. All entry points use a projection pattern:

```typescript
const workspace = workspaceResult.ok ? {
  isWorkspace: workspaceResult.value.isWorkspace,
  workspaceType: workspaceResult.value.workspaceType as WorkspaceMetadata['workspaceType'],
  packages: workspaceResult.value.packages,
  globs: workspaceResult.value.globs,
} : undefined;
```

This narrows `workspaceType` at the boundary and drops the `diagnostics` field.

### 2. LRU Cache Sizing

- Hint cache: 500 entries, 5min TTL (hints are expensive to compute)
- Import graph cache: 50 entries, 10min TTL (smaller cardinality, longer-lived)
- Both use lazy TTL expiration (checked on access, not background timer)

### 3. Cache Invalidation Strategy

`invalidateCache(rootPath)` clears the entire hint cache (composite keys make selective invalidation impractical) and deletes the specific import graph entry for the given root path. This is called on every workspace re-scan.

### 4. Cross-Package Import Resolution

`resolveWorkspaceImport` handles `@scope/pkg` and `@scope/pkg/subpath` specifiers by matching against `WorkspacePackageMetadata[]` source roots. It delegates relative (`.`) imports to the existing `resolveLocalImport`. Returns `null` for unknown packages.

## Known Limitations

1. **Type boundary `as` cast** — The `WorkspaceType` → `WorkspaceMetadata['workspaceType']` projection uses an `as` cast that silently widens scanner-specific types (turbo, nx, lerna, rush). A proper mapping function would be safer.

2. **Test coverage gaps** — Entry point tests only verify `discoverWorkspace()` works directly, not the full wiring through `setProjectContext()`. Mock-based tests would provide stronger coverage.

3. **Pre-existing failures** — 11 tests in `packages/setup/` fail due to schema version mismatches and MCP timeout logic. These are unrelated to Phase 33.

## Future Improvements

1. **Shared `mapWorkspaceType()` helper** — Extract the projection pattern into a shared utility to eliminate the `as` cast across entry points.

2. **Mock-based wiring tests** — Add tests that mock `projectScanner` and `vce` to verify `setProjectContext` receives workspace metadata.

3. **`WorkspaceType` alignment** — Unify the `WorkspaceType` union in project-scanner with `WorkspaceMetadata['workspaceType']` in shared to eliminate the type boundary mismatch.

## Commits

| Commit | Description |
|--------|-------------|
| `19cc09c` | `feat(shared): add WorkspaceMetadata type for monorepo support` |
| `78cc2df` | `feat(source-hint-engine): add bounded LRU cache with optional TTL` |
| `64ce174` | `feat(context-engine): thread workspace metadata through setProjectContext` |
| `c9cc220` | `feat(source-hint-engine): add workspace field to ProjectContext type` |
| `4a5e47c` | `feat(source-hint-engine): extend USAGE_SITE_DIRS with workspace package sourceRoots` |
| `c41dbc5` | `feat(source-hint-engine): add cross-package workspace import resolution` |
| `7cd88c7` | `feat(source-hint-engine): replace unbounded Maps with bounded LRU caches` |
| `66b0b00` | `feat(cli): wire discoverWorkspace into capture and scan commands` |
| `5ba862a` | `fix(cli): project WorkspaceDiscovery to WorkspaceMetadata at boundary` |
| `09190e9` | `feat(mcp-server): wire discoverWorkspace into ensureProjectScan` |
| `2a2d37d` | `feat(studio): wire discoverWorkspace into establishProjectContext` |
| `32e750b` | `test: add monorepo fixture and cross-package import integration test` |
| `2f70825` | `feat: invalidate hint cache on workspace re-scan` |

---

# Phase 33A Closure — Runtime/Scale: Concurrency, Cancellation, Caches, Generations, Warm Cache, Ambiguity, E2E

Phase 33A closed the Phase 33 runtime/scale gaps. All work below is
implemented and covered by deterministic tests in `pnpm test:ci` (unit) and
`pnpm test:e2e` (real processes).

## Workspace type mapping

`packages/project-scanner` exposes `mapWorkspaceType(detected)` which maps
scanner declarations (`single`, `pnpm-workspace`, `npm-workspace`,
`yarn-workspace`) onto the supported public model and returns `null` for
unsupported formats (turbo/nx/lerna/rush fail explicitly with diagnostics).
`discoverWorkspace` is fully async (async pnpm-workspace.yaml / package.json
workspaces parsing, async glob expansion).

**Unsafe-cast audit:** `apps/studio/src/index.ts` previously projected
`WorkspaceDiscovery.workspaceType as WorkspaceMetadata['workspaceType']`.
The unions are now structurally identical, so the cast was removed — studio
(and CLI/MCP, which never cast) pass the typed discovery directly. Verified
by `grep` for `as WorkspaceMetadata` across entry points (no matches).

## Root-containment proof

`isContainedPath` (lexical + `realpathSync` symlink protection) and
`safePath`/`isSafeRelativePath` guard every candidate that enters evidence
assembly; `collectCandidates.add()` drops any candidate that does not exist
or escapes the root. Safety tests (`safety.test.ts`, 19 tests) plus the
Phase 33A deletion/escape test prove deleted/escaped paths never survive as
valid hints.

## Async traversal

All high-volume filesystem work is async: source inventory
(`walkCodeFiles`), text matching (`scanProjectFiles`), workspace discovery,
import traversal (`buildImportGraphAsync`,
`buildLocalDependencyClosureAsync`, `resolveLocalImportAsync`), and the
manifest-validated fingerprint walk.

## Concurrency (task 1)

New `mapWithConcurrency(items, limit, worker, {signal})` — a bounded worker
pool with exactly `limit` serial runners draining a FIFO queue; never an
unbounded `Promise.all`. Used for per-file read/parse work in
`scanProjectFiles` and `buildImportGraphAsync` with
`DEFAULT_SCAN_CONCURRENCY = 16` (configurable per call). Instrumentation test
(`async-pool.test.ts`, 6 tests) proves the active-worker peak never exceeds
the configured limit and that results return in input order.

## Deadline / cancellation (task 2)

`ScanBudget` now carries an optional `AbortSignal`; `touchBudget` throws
typed `ScanBudgetExceededError` (file/time) or `ScanCancelledError` (signal).
Both propagate through traversal; the pool checks the signal before each
item so once cancelled/budget-exceeded NO new work is scheduled and only the
bounded in-flight window settles. The engine maps both to TYPED unavailable
evidence (`resolution: 'unavailable'`, warning text) — a capture is never
broken. `SH_SCAN_CANCELLED` joins `SH_BUDGET_EXCEEDED` in the VCE's
unavailable (not failed) status mapping. Tests (`cancellation.test.ts`, 6
tests): abort mid-scan → unavailable + empty cache; negative deadline →
unavailable; file budget → bounded reads; generation guard.

## Event-loop responsiveness (task 3)

`apps/studio/src/responsiveness.test.ts` generates a deterministic 1500-file
workspace at runtime, starts a REAL large source scan (ProjectScanner +
SourceHintEngine incl. import graph), and proves `/health` answers within a
generous 1000 ms threshold while the scan is provably active (fs-activity
counters increase between the first and last request). Readiness is
condition-based (polling real counters), never a fixed sleep. Observed
latency is a few ms.

## Cache contract (task 4)

Every repository/source cache has an explicit documented contract and a
capacity proof test (`cache-bounds.test.ts`, 7 tests):

| Cache | Key | Max entries | TTL | Invalidation trigger | Lifecycle/scope |
|---|---|---|---|---|---|
| Hint cache | `fingerprint:pathname:tag:id:class:role:testId:text` | 500 (`HINT_CACHE_MAX`) | 5 min | fingerprint/config change (key rotation), `invalidateCache(root)` | per `SourceHintEngine` instance, project-root scoped |
| Import graph cache | `fingerprint\0rootPath` | 50 (`IMPORT_GRAPH_CACHE_MAX`) | 10 min | fingerprint change (key rotation), `invalidateCache(root)` | per instance, root scoped |
| Manifest/fingerprint cache | `rootPath\0sorted-dirs` | 20 (`MANIFEST_CACHE_MAX`) | 10 min (expired entries revalidated stat-only before reuse) | any source/config size/mtimeMs change, add, delete; `invalidateCache(root)` | per instance, root + scanned-dir-set scoped |

Capacity proof: > 500 distinct hint keys and > 50 graph rotations and
> 20 distinct manifest roots all leave size ≤ the configured bound (LRU
eviction), asserted by test.

## Scan generations (task 5)

`SourceHintEngine.generationNumber` starts at 0; `invalidateCache(root)`
bumps it and clears hint/graph/manifest caches. One resolution snapshots the
generation at start; the cache commit is guarded so an in-flight scan from
generation N never populates generation N+1 (old inventory never combines
with new workspace/import metadata). The fingerprint memo is
per-resolution, so the hint key and the import-graph key observe ONE
coherent source snapshot. Deterministic tests: N → N+1 bump, mid-flight
invalidate → stale result returned but cache stays empty under the new
generation, graph rebuilt after edit (fingerprint-keyed).

## Warm-cache proof (task 6)

`FsActivity` (engine-scoped) counts `contentRead`/`contentParse`/`stat`/
`readdir`/`exists`. `warm-cache.test.ts` proves:
cold query → reads/parses > 0; unchanged query 2 → ZERO content reads and
ZERO parses with an identical deterministic result (manifest-validated
fingerprint — stat-only); edit relevant source → query 3 refreshes
(reads/parses > 0) and reflects new state (resolved packages/ui candidate
with a stable-identifier family); query 4 → warm again (0 reads). Timing is
never used as evidence.

## Invalidation completeness (task 7)

`invalidation.test.ts` (5 tests) proves on ONE engine instance (no Studio
restart): source edit, source addition, source deletion (deleted paths never
survive as valid hints), package.json change, and pnpm-workspace.yaml change
(+ a new package in the workspace metadata) all update results — verified
through read counters and changed candidate sets.

## Multi-app ambiguity (task 8)

`workspace-ambiguity.test.ts` (3 tests): a workspace with apps/web +
apps/admin both using packages/ui carries EQUIVALENT target evidence (the
visible phrase in all three files) → resolution stays `ambiguous` with equal
evidence confidence; no path-sorting winner; Phase 30 thresholds untouched
(duplicate-text stays capped `weak`). A target that uniquely identifies one
app resolves to the web file even though `packages/ui` sorts first
alphabetically.

## Cross-package import correctness (task 9)

`workspace-imports.test.ts` (9 tests): `@scope/pkg` root import,
`@scope/pkg/subpath`, relative imports, unknown external packages
(`react`, `@unknown/pkg`) resolve to null; closures never contain external
or node_modules paths; engine-level assertion that every hint is an existing
repository-relative file — unknown externals never become repository-owned
source.

## Real product workspace E2E (tasks 10 + fresh MCP persistence)

`tests/e2e/workspace-source-resolution.test.ts` (6 tests) generates a real
workspace (`repo/apps/web` + `repo/packages/ui`, pnpm-workspace, the target
source ONLY in the shared package), runs the rendered Studio workflow
select → capture → source resolution → handoff, and asserts:
- Studio `/state` reports `workspace: { isWorkspace: true, packageCount: 2 }`
  and `scan: 'ready'` (no absolute paths)
- the source candidate is repository-relative
  `packages/ui/src/CheckoutCard.jsx`
- Studio is STOPPED, then a FRESH MCP process starts with `cwd = workspace`
  and NO `--project-root` (no project scan)
- `get_handoff_context(handoffId)` returns the persisted candidate,
  qualification, reasons, order and resolution IDENTICAL to capture time,
  with `resolutionSource: 'persisted'` — never recomputed

Also fixed: stale compiled `tests/e2e/*.js`/`.d.ts`/`.map` artifacts were
shadowing the `.ts` sources in vitest resolution (`.js` precedes `.ts`),
silently reverting `harness.ts` changes; deleted (see MEMORY.md Decision
007).

## Large-repository measurements (task 11)

`scale-measurements.test.ts` generates a deterministic 1200-file workspace
fixture at runtime and records (persisted to
`docs/phase33a-scale-measurements.json` — single-machine observations, NOT
public performance guarantees):

| Operation | Duration | Content reads | Content parses | Resolution |
|---|---|---|---|---|
| cold scan | ~400 ms | 2406 | 2406 | ambiguous |
| warm repeated query | ~108 ms | 0 | 0 | ambiguous |
| changed-file refresh | ~364 ms | 2406 | 2406 | ambiguous |
| ambiguous query | ~134 ms | 1203 | 1203 | ambiguous |
| budget-exceeded query | ~58 ms | 0 | 0 | unavailable |

Monotonic counter proof (asserted): warm repeats do ZERO content
reads/parses while cold/refresh do real work; durations are recorded but
never asserted (wall-clock is machine/load dependent).

## Studio status (task 12)

`/state` and `/health` expose only: single-package vs workspace +
workspace package count (`project.workspace`), source scan
ready/refreshing/unavailable (`project.scan`, set around
`establishProjectContext`), and `project.budgetExceeded` when the last
resolution hit its budget (derived from the packet's source-hint
diagnostic). No absolute paths; no repository explorer
(`apps/studio/src/status.test.ts`, 3 tests).

## Full validation

Run exactly:

```
pnpm typecheck        — PASS
pnpm lint             — PASS
pnpm test:ci          — PASS (recorded below)
pnpm test:e2e         — PASS (recorded below; clean state, no pre-started Studio)
pnpm test:dogfood     — PASS (recorded below)
pnpm smoke:agent-workflow — PASS (recorded below)
pnpm build:cli && node scripts/verify-cli-artifact.mjs — PASS (recorded below)
pnpm release:check    — PASS (recorded below)
```

Results are recorded in the table below (no expected counts hardcoded).
Phase 33A added 8 new unit test files (+~60 tests) and 1 e2e file (6 tests)
to the Phase 33 baseline; the pre-existing `visual-review-ui` e2e race (DOM
read before the WebSocket render broadcast) was made deterministic with a
condition-based wait.

| Command | Result | Files | Tests |
|---|---|---|---|
| `pnpm typecheck` | PASS | — | — |
| `pnpm lint` (`biome check .`) | PASS | 323 files checked | — |
| `pnpm test:ci` | PASS | 71 | 1074 |
| `pnpm test:e2e` | PASS (clean state, no pre-started Studio) | 13 | 74 |
| `pnpm test:dogfood` | PASS | 7 | 126 |
| `pnpm smoke:agent-workflow` | PASS | — | 26/26 checks |
| `pnpm build:cli && node scripts/verify-cli-artifact.mjs` | PASS | — | artifact verified |
| `pnpm release:check` | PASS | — | — |

`pnpm release:check` (biome + tsc + test:ci + dogfood + smoke + CLI bundle +
packed-artifact verification) — PASS on the final run. No expected test counts
are hardcoded anywhere; all numbers above are actual recorded results.
