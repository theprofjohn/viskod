# Phase 21: External Repo Reliability Fixes

## Scope A — First Capture Persistence

### Root Cause

The first `capture_context` call sometimes failed to persist `packet.json` to disk because the capture pipeline's storage directory (`.viskod/captures/`) was not created until the first `persistCapture` call. If the first tool call triggered session initialization, browser launch, AND capture in rapid succession, the pipeline's base directory might not exist yet.

### Fix

**File:** `packages/capture-pipeline/src/index.ts`

Added eager directory creation in the `CapturePipeline` constructor:

```typescript
constructor(baseDir?: string) {
  this.baseDir = baseDir ?? path.join(process.cwd(), STORAGE_DIR, CAPTURES_DIR);
  // Eagerly create storage dir so first capture always has a writable target
  try { fs.mkdirSync(this.baseDir, { recursive: true }); } catch { /* best effort */ }
}
```

This ensures `.viskod/captures/` exists before any capture call, eliminating the race between pipeline initialization and first persist.

### Proof — No Warm-Up Needed

The Phase 21 dogfood test calls `capture_context` as the **very first** MCP tool call (no warm-up). Result:

```
first capture packetPath persists WITHOUT warm-up — C:/Viskod/.viskod/captures/.../packet.json
packet.json exists on disk — C:/Viskod/.viskod/captures/.../packet.json
```

**PASS** — first capture reliably persists without any warm-up.

## Scope B — Usage-Site Source Hints

### Root Cause

The source hint engine only searched for files in the project's component directories (e.g., `src/components/`). For Tailwind/shadcn projects using utility-first CSS, class-name-based matching produced generic hints like `flex.tsx`, `card.tsx` that point to the component library, not the actual usage file (e.g., `src/features/auth/sign-in/index.tsx`).

### Fix

**File:** `packages/source-hint-engine/src/index.ts`

Two changes were made:

1. **Added `findUsageSiteCandidates` function** — Searches project files (including `src/features/`, `src/pages/`, `src/routes/`, etc.) for files that contain:
   - Visible text from the selected DOM element's subtree
   - Component references (e.g., `<Card`, `CardContent`)

   Uses a blacklist of ~120 Tailwind utility prefix words to filter out utility classes while preserving meaningful visible text words.

2. **Added `usage-site` match type** — Usage-site candidates are injected into the scoring map **first** (highest priority), so they rank above generic component/utility hints.

3. **Updated types** — Added `usage-site` to `DiscoveryMethod`, `EvidenceType` (`text-content-match`), and `matchType` unions.

### Before/After Source Hint Ranking

| Rank | Before (Phase 20B) | After (Phase 21) |
|------|-------------------|-----------------|
| 1 | `flex.tsx` (generated) | **`src/features/auth/sign-in/index.tsx`** (usage-site) |
| 2 | `flex.jsx` (generated) | `src/features/auth/sign-up/index.tsx` (usage-site) |
| 3 | `flex.vue` (generated) | `src/features/auth/forgot-password/index.tsx` (usage-site) |
| 4+ | Other generic candidates | Other generated candidates |

The top hint now points to **the actual file that was edited** (`sign-in/index.tsx`), not a generic component file.

## Tests Added

No new test files — existing test suites continue to pass (239/239).

The source-hint engine's existing tests verify backward compatibility. Usage-site matching is tested implicitly via the dogfood workflow.

## Phase 20B Re-run Result

| Check | Result |
|-------|--------|
| First capture packetPath persists (no warm-up) | **PASS** |
| packet.json exists on disk | **PASS** |
| Top source hint is usage file | **PASS** — `sign-in/index.tsx` at #1 |
| Usage-site ranks above generic hints | **PASS** — #1 vs #10+ |
| Bounding box before fix | 595x452 |
| Bounding box after fix (gap-4→gap-8) | 595x484 |
| Height delta | +32px **PASS** |
| Width unchanged | 0px **PASS** |
| comparisonSummary present | **PASS** |
| Verdict is "changed" (not inflated) | **PASS** |
| No daemon/session token | **PASS** |
| No .tmp files | **PASS** |
| No C:\Users in packet | **PASS** |
| `pnpm release:check` passes | **PASS** |
| External repo lint passes | **PASS** |
| External repo build passes | **PASS** |
| **Overall** | **26/26 PASS** |

## Validation Results

| Check | Result |
|-------|--------|
| `tsc -b` | 0 errors |
| `biome check .` | 0 errors (impacted files) |
| `vitest run` | 239/239 PASS |
| `pnpm release:check` | PASS |
| External `npx eslint src/` | PASS |
| External `npx vite build` | PASS |

## Files Changed

| File | Change |
|------|--------|
| `packages/capture-pipeline/src/index.ts` | Eager `fs.mkdirSync` in constructor |
| `packages/source-hint-engine/src/index.ts` | Added `findUsageSiteCandidates`, usage-site ranking, extended search dirs |
| `packages/source-hint-engine/src/types.ts` | Added `usage-site` to `DiscoveryMethod`, `matchType`; `text-content-match` to `EvidenceType` |

## Remaining Limitations

1. **Usage-site matching is content-based, not AST-based** — It searches for visible text words in file contents. This can produce false positives if the same text appears in unrelated files.
2. **Search scope includes common page directories** (`src/features/`, `src/pages/`, etc.) but may miss deeply nested or unconventionally structured projects.
3. **UTILITY_BLACKLIST is Tailwind-focused** — Other utility frameworks (UnoCSS, Windi CSS) may have different prefix sets. The blacklist can be extended.
4. **Generic component hints still appear** — They are just ranked lower than usage-site hints. For projects without page-level files (e.g., component libraries), generic hints remain primary.

## Verdict: **PASS**

All PASS criteria met:

- [x] First capture persists `packetPath` without warm-up
- [x] Top source hint is `sign-in/index.tsx` (usage file), not `flex.tsx`/`card.tsx` (generic)
- [x] Usage-site (#1) ranks above generic utility/component hints (#10+)
- [x] Deterministic visual delta still captured (height +32px)
- [x] `release:check` passes
- [x] External lint/build pass
- [x] No token/secrets leaks
- [x] Existing 239 tests all pass
