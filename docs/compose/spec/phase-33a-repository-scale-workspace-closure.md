---
feature: phase-33a-repository-scale-workspace-closure
status: designed
updated: 2026-08-18
branch: feat/phase-33a-scale-workspace
commits:
---

# Phase 33A — Repository Scale & Workspace Closure

## Report

## [S1] Problem
Phase 33 introduced workspace metadata threading, cross-package import resolution, and bounded LRU caches. However, several acceptance criteria remain open: the repository has test/lint regressions, workspace type casting is unsafe, source traversal is synchronous, caches lack invalidation semantics, and there is no proof that Studio remains responsive during large scans. This phase closes those gaps.

## [S2] Design

### S2.1 Green Baseline Restoration
- Remove stale `.js`/`.d.ts` files from `packages/setup/src/` that override `.ts` source
- Fix lint: remove dead ternary `'.' === '.' ? '' : '.'` in project-scanner `walkGlob`
- All existing Phase 27-32 contracts must remain green

### S2.2 Unsafe Workspace Type Mapping
- Replace `workspaceType as WorkspaceMetadata['workspaceType']` cast with explicit `mapWorkspaceType()` function
- Supported: `package.json` workspaces, `pnpm-workspace.yaml`
- Unsupported types (turbo/nx/lerna/rush) produce `workspaceType: 'unsupported'` with sanitized reason
- Tests verify supported and unsupported paths

### S2.3 Root-Containment Security
- Workspace declarations containing `../`, absolute paths, or symlink escapes are rejected
- `walkGlob` root-escape check uses `path.resolve` + prefix check instead of dead `startsWith('..')`
- Deterministic tests for each escape vector

### S2.4 Async Source Traversal
- `ProjectScanner` workspace/project traversal uses async `fs.promises` APIs
- `SourceHintEngine` file inventory and source matching use async APIs
- Import graph traversal is async
- No synchronous `readdir`/`readFile`/`stat` on the critical path

### S2.5 Bounded Concurrency
- Internal concurrency limiter with configurable max (default 32)
- All large async file reads/stat/parses use the limiter
- Test asserts max simultaneous operations never exceeds bound

### S2.6 Deadline/Cancellation
- Scan operations observe time deadline, file-count budget, and AbortSignal
- On cancellation: stop scheduling new work, in-flight settles, source evidence becomes unavailable
- Typed diagnostic emitted on budget exhaustion

### S2.7 Event-Loop Responsiveness
- Generated large repository fixture (500-1500 files)
- During active scan, Studio `/health` endpoint responds within deterministic threshold
- Proves scanning does not monopolize event loop

### S2.8 Cache Contract
- Documented for each cache: key, max entries, TTL, invalidation trigger, lifecycle
- Tests prove entry counts remain bounded after exceeding capacity

### S2.9 Change Detection/Invalidation
- mtime/size-based inventory fingerprint
- Edit target source → next query reflects edit
- Add candidate file → next refresh sees it
- Delete candidate → next refresh removes it
- Modify package.json/workspace declaration → package graph updates

### S2.10 Scan Generation Consistency
- Immutable repository generation/snapshot per scan
- One source-resolution operation consumes one coherent generation
- Invalidation bumps generation N → N+1

### S2.11 Warm-Cache Proof
- Query 1 cold, query 2 unchanged: same result, fewer filesystem reads
- Edit → query 3 refreshes, query 4 warm again
- Cache within configured limits

### S2.12 Multi-App Ambiguity
- Workspace fixture with two apps using same shared package
- Ambiguous evidence → resolution remains ambiguous (no lexicographic pick)

### S2.13 Cross-Package Import Correctness
- Imports based on package.json `name` field
- Unknown external packages not indexed as source
- Subpath coverage where supported

### S2.14 Studio Workspace E2E
- Real workspace with apps/web + packages/ui
- Select → capture → source resolution → workspace candidate
- Fresh MCP returns identical persisted workspace hint (no recomputation)

### S2.15 Large-Repository Performance
- Generated fixture: 500-1500 files, multiple packages, decoy text
- Monotonic timing: cold scan, warm query, refresh, ambiguous query, budget-exceeded
- File-read/parse counters recorded

### S2.16 Studio Status
- Minimal workspace/scan status: single-package/workspace, package count, scan state
- No absolute paths, no repository explorer

## [S3] Out of Scope
- Filesystem watcher (polling-only invalidation)
- Full node_modules resolution
- Nx/Turbo/Bazel/Lerna/Rush engine support
- Database or persistent index
- Public performance promises from single-machine benchmarks
- Phase 34 work

## Tasks
- [ ] T1: Fix lint error in project-scanner walkGlob — acceptance: `pnpm lint` green (covers: S2.1)
- [ ] T2: Remove stale .js/.d.ts from packages/setup/src — acceptance: all 1041 tests pass (covers: S2.1)
- [ ] T3: Implement mapWorkspaceType with explicit mapping — acceptance: supported types map correctly, unsupported produce sanitized reason (covers: S2.2)
- [ ] T4: Add root-containment security tests and fix walkGlob escape check — acceptance: path escape vectors rejected deterministically (covers: S2.3)
- [ ] T5: Convert ProjectScanner critical path to async — acceptance: no sync readdir/readFile/stat on workspace traversal (covers: S2.4)
- [ ] T6: Implement bounded concurrency limiter — acceptance: max simultaneous ops ≤ configured bound (covers: S2.5)
- [ ] T7: Add deadline/cancellation to scan operations — acceptance: budget exhaustion stops new work, typed diagnostic emitted (covers: S2.6)
- [ ] T8: Event-loop responsiveness proof — acceptance: Studio /health responds during large scan (covers: S2.7)
- [ ] T9: Document and test cache contracts — acceptance: each cache has documented key/max/TTL/lifecycle (covers: S2.8)
- [ ] T10: Implement mtime/size change detection — acceptance: edit/add/delete reflected in next query (covers: S2.9)
- [ ] T11: Implement scan generation consistency — acceptance: one operation = one coherent generation (covers: S2.10)
- [ ] T12: Prove warm-cache behavior — acceptance: query 2 has fewer fs reads than query 1 (covers: S2.11)
- [ ] T13: Multi-app ambiguity fixture and test — acceptance: ambiguous evidence stays ambiguous (covers: S2.12)
- [ ] T14: Cross-package import correctness tests — acceptance: imports based on package.json name (covers: S2.13)
- [ ] T15: Studio workspace E2E test — acceptance: fresh MCP returns persisted workspace hint (covers: S2.14)
- [ ] T16: Large-repository performance fixture — acceptance: timing/counters recorded for all scenarios (covers: S2.15)
- [ ] T17: Studio status endpoint — acceptance: minimal workspace/scan status exposed (covers: S2.16)
- [ ] T18: Full validation — acceptance: all gates green (covers: all)
- [ ] T19: Update Phase 33 report — acceptance: report reflects delivered behavior (covers: all)
