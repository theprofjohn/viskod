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
