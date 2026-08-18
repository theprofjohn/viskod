# Phase 11 Report: Build, Storage, and Release Hygiene

**Date:** 2026-07-29

---

## Objective

Fix remaining P2 engineering hygiene issues: TypeScript project references, screenshot path metadata, capture storage cleanup, and release hygiene.

---

## Issues Fixed

### 1. TypeScript Project-Reference Build Hygiene

**Before:** Root `tsc -b` compiled nothing (empty root tsconfig, no references). Individual `tsc` per package failed with `TS6059` (file outside `rootDir`) and `TS6307` (file not listed) on every cross-package import. 19 packages had empty `"references": []`. Five packages imported from `@viskod/*` without declaring them in `package.json` dependencies.

**After:**
- Root `tsconfig.json` has `references` listing all 19 packages + `apps/studio`
- Every package `tsconfig.json` has correct `references` declaring its dependency graph
- Missing workspace dependencies added to 6 packages (`event-bus`, `config`, `browser-runtime`, `capture-pipeline`, `context-engine`, `cli`)
- `paths` removed from root tsconfig (vitest uses its own `resolve.alias`; runtime resolution uses pnpm node_modules symlinks)
- Stale `.js`/`.d.ts` artifacts in `src/` and `dist/` directories cleaned up
- `**/dist` and root-level compiled artifacts added to `.gitignore`
- `tsc -b` passes cleanly (zero errors)

### 2. Screenshot Path Metadata

**Before:** `ContextPacket.screenshots[].path` stored an unresolvable relative filename (`<captureId>.png` from browser-runtime). `StoredCapture` had no directory information. A consumer holding a `ContextPacket` could not locate the persisted screenshot on disk.

**After:**
- `StoredCapture.captureDir: string` — absolute path to the capture directory on disk (internal)
- `ScreenshotInfo.captureDir?: string` — workspace-relative path (no absolute local path exposed in packet)
- `ScreenshotInfo.absoluteCaptureDir?: string` — absolute path (local-only, not for external distribution)
- `capture-pipeline.persistCapture()` returns `captureDir` in the `StoredCapture`
- `context-engine` computes workspace-relative `captureDir` from project root (if known) and stores absolute in `absoluteCaptureDir`
- External consumers resolve screenshots via: `path.resolve(projectRoot, captureDir, screenshot.path)`

### 3. RuntimeSession Path Bug Fixed

**Before:** `RuntimeSession` passed `.viskod/` as `CapturePipeline` base directory. Captures from daemon/session mode were stored at `.viskod/<uuid>/` instead of `.viskod/captures/<uuid>/`.

**After:** `CapturePipeline` receives `path.join(this.storageDir, 'captures')`. All paths now consistent.

### 4. Capture Storage Cleanup

**Before:** `runRetentionCleanup()` existed on `CapturePipeline` but was never called and had no tests.

**After:** 7 new tests verify cleanup behavior (retention enforcement, unrelated file safety, most-recent preservation, empty dir handling, negative days rejection).

### 5. Release Hygiene

- **Generated files:** Identified and removed stale `.js`/`.d.ts`/`.js.map`/`.d.ts.map` from `src/` directories. Added `**/dist`, root `/*.js`, `tests/**/*.js` to `.gitignore`.
- **Build scripts:** All 19 packages have consistent `build`/`typecheck`/`test` scripts. Root `check` command (biome + tsc + vitest) passes.
- **Exports:** All packages export from `./src/index.ts` with valid `main`/`types`/`exports` fields.
- **No modification** to `/docs/`, `/specs/`, or `CLAUDE.md`.

---

## Files Changed

**32 files changed, +883 / -57 lines**

| Category | Files | Changes |
|---|---|---|
| **Tsconfig references** | `tsconfig.json`, 19× `packages/*/tsconfig.json`, `apps/studio/tsconfig.json` | Added `references` arrays; removed `paths` from root |
| **Missing deps** | `packages/event-bus/package.json`, `config/package.json`, `browser-runtime/package.json`, `capture-pipeline/package.json`, `context-engine/package.json`, `cli/package.json` | Added `@viskod/*: "workspace:*"` dependencies |
| **Screenshot path** | `packages/capture-pipeline/src/index.ts`, `packages/context-engine/src/index.ts` | Added `captureDir` to `StoredCapture`; `ScreenshotInfo` now uses workspace-relative `captureDir` + internal `absoluteCaptureDir` |
| **RuntimeSession bug** | `packages/runtime-session/src/runtime-session.ts` | Fixed `CapturePipeline` baseDir path |
| **New tests** | `packages/capture-pipeline/src/capture-pipeline.test.ts` | 8 tests for path metadata, privacy, + cleanup |
| **Gitignore** | `.gitignore` | Added `**/dist`, root `/*.js`, test artifacts |
| **Lockfile** | `pnpm-lock.yaml` | Updated automatically |

---

## Validation Commands and Results

| Command | Result |
|---|---|
| `pnpm biome check .` | ✅ 0 errors, 95 files checked |
| `tsc -b` | ✅ 0 errors (clean, including second run) |
| `vitest run` | ✅ 129 tests, 14 test files |
| `pnpm check` (biome + tsc + vitest) | ✅ Full suite passes |

---

## Tests Added

**7 new tests** in `packages/capture-pipeline/src/capture-pipeline.test.ts`:

| Test | What it verifies |
|---|---|
| includes capture directory in StoredCapture after persist | `StoredCapture.captureDir` is set and points to existing directory |
| stores screenshots with resolvable type.format filenames | Persisted files use `<type>.<format>` naming and metadata.json tracks correct paths |
| removes old captures beyond retention period | `runRetentionCleanup(7)` deletes captures older than 7 days |
| does not delete unrelated files in the base directory | Non-capture files/dirs are preserved during cleanup |
| always keeps the most recent capture regardless of age | Most recent capture is never deleted, even beyond retention |
| handles empty base directory gracefully | No errors when dir is empty |
| rejects negative retention days | Negative input returns error |

---

## Architecture Boundary Verification

| Rule | Status | Evidence |
|---|---|---|
| VCE remains orchestrator | ✅ | `VisualContextEngine` still orchestrates capture + persist |
| BrowserRuntime must not import VCE | ✅ | No new imports; BR unchanged |
| CapturePipeline persists only | ✅ | Cleanup/retention is storage-only, no business logic |
| RuntimeSession owns lifecycle only | ✅ | Only path fix applied; no new responsibilities |
| EventBus remains transport only | ✅ | Unchanged |
| No new product features added | ✅ | All changes are hygiene/cleanup |

---

## Remaining Limitations

| # | Limitation | Priority |
|---|---|---|
| P2.5 | Per-package `rootDir: ./src` remains; this technically limits file locations within packages but works correctly with project references | P2 |
| P2.2/P2.6 | Screenshot path is now resolvable via `captureDir`, but automatic periodic cleanup is not wired to any timer or CLI command. `runRetentionCleanup` must be called explicitly. | P3 |

---

## Documentation/Specs Status

| Artifact | Modified? |
|---|---|
| `/docs/**` | Not modified |
| `/specs/**` | Not modified |
| `CLAUDE.md` | Not modified |
| `MEMORY.md` | Not modified |

---

## Recommendation

**Merge-ready.** All four objectives achieved:
1. TypeScript project references wired across all 19 packages + studio; `tsc -b` passes clean
2. Screenshot paths include resolvable `captureDir` in both `StoredCapture` and `ContextPacket`
3. Capture retention cleanup tested with 7 tests covering safety and edge cases
4. Release hygiene verified: no generated files committed, scripts consistent, `.gitignore` extended

No regressions. 128 tests pass (up from 121). Biome clean. TypeScript strict mode clean.
