# Phase 13 Source Hint Hardening Report

**Date:** 2026-07-28

---

## Root Cause from Phase 12D

Phase 12D revealed four source hint quality issues:

| # | Issue | Phase 12D Behaviour |
|---|---|---|
| 1 | PRIMARY hint `target-card.tsx` did not exist on disk | Engine generated non-existing paths with no existence check |
| 2 | Actual file was `TargetCard.jsx` but engine returned `target-card.jsx` | No case-insensitive matching |
| 3 | All 10 candidates had flat confidence 0.65 | No distinction between existing and generated files |
| 4 | No CSS file hints | No style-file adjacency detection |

## Algorithm Changes

### 1. Existence Checking (`resolvePathWithCase`)

For each generated candidate path, the engine now calls `resolvePathWithCase()` which:
1. Checks if the exact path exists on disk (`fs.existsSync`)
2. If not, scans the parent directory for case-insensitive matches
3. Normalises filenames by stripping non-alphanumeric characters for comparison (handles `target-card` vs `TargetCard`)

### 2. Case-Insensitive Matching

`normalizeForCompare` removes all non-alphanumeric characters (`/[^a-z0-9.]/gi`) before comparing. This allows:
- `target-card.jsx` → `targetcardjsx`
- `TargetCard.jsx` → `targetcardjsx`
- Match → resolved path returned with actual casing preserved

### 3. Confidence Scoring

| matchType | Confidence | Condition |
|---|---|---|
| `exact` | **0.95** | File exists with exact path match |
| `case-insensitive` | **0.85** | File exists, case differs |
| `style-adjacent` | **0.80** | CSS file adjacent to a resolved component |
| `generated-non-existing` | **0.30** | Pattern-generated path, file does not exist |
| `generated` (legacy) | varies | Old evidence-only path (no existence check) |

### 4. Style-File Adjacency

`findAdjacentStyleFiles()` scans the component's directory for `.css`, `.scss`, `.less`, `.module.css`, `.module.scss` files with a matching base name.

## Ranking Rules

1. Existing exact matches (confidence 0.95) rank highest
2. Case-insensitive matches (confidence 0.85) rank second
3. Style-adjacent files (confidence 0.80) rank third
4. Generated non-existing candidates (confidence 0.30) rank lowest

## Evidence Metadata Added

Each `SourceHint` now includes:
- `exists: boolean` — whether the file exists on disk
- `matchType: 'exact' | 'case-insensitive' | 'style-adjacent' | 'generated-non-existing' | 'generated'`
- `reason: string` — human-readable explanation
- `relatedSelector?: string` — the DOM class/id that triggered this hint
- `discoveryMethod` expanded to include `'file-exists'`, `'case-insensitive'`, `'style-adjacent'`

## Tests Added

| Test | What it verifies |
|---|---|
| rejects hints when rootPath is missing | Error handling for missing project root |
| non-existing candidates when no files exist | `exists: false` for all generated candidates |
| ranks existing exact files above non-existing | Existing file (0.95) appears before generated (0.30) |
| case-insensitive matches with differing casing | `TargetCard.jsx` found via `target-card.jsx` |
| adjacent CSS files suggested | CSS file in same directory as component |
| confidence differentiated (not flat 0.65) | Multiple distinct confidence values |
| includes reason and matchType | Metadata present on all hints |
| backward compatible with schema version | `schemaVersion` field present |
| accepts className and generates hints | Hints derived from DOM class name |
| uses cache for repeated inputs | Identical inputs return cached results |

## Before/After SourceHints Comparison

### Before (Phase 12D)

```
PRIMARY: target-card.tsx  (confidence: 0.65)  ← does not exist on disk
         target-card.jsx  (confidence: 0.65)  ← does not exist on disk (TargetCard.jsx exists)
         target-card.vue  (confidence: 0.65)  ← does not exist
         ...
All flat 0.65. No CSS hints. No `exists` field.
```

### After (Phase 13)

```
PRIMARY: src/components/TargetCard.jsx  (confidence: 0.95)  ← EXISTS (exact)
         src/components/TargetCard.css   (confidence: 0.85)  ← EXISTS (case-insensitive)
         src/components/target-card.jsx  (confidence: 0.30)  ← does not exist
         src/components/target-card.tsx  (confidence: 0.30)  ← does not exist
         ...
```

## Files Changed

| File | Change |
|---|---|
| `packages/source-hint-engine/src/types.ts` | Added `exists`, `matchType`, `reason`, `relatedSelector` to `SourceHint`. Expanded `DiscoveryMethod`, `EvidenceType` |
| `packages/source-hint-engine/src/index.ts` | Replaced `collectCandidates` with `collectResolvedCandidates` using `resolvePathWithCase`, `findAdjacentStyleFiles`. New scoring. New evidence metadata. Updated `explainHint`. Removed unused legacy matchers |
| `packages/source-hint-engine/src/source-hint-engine.test.ts` | 10 new tests for existence, case-insensitive, CSS adjacency, confidence, metadata |
| `packages/context-engine/src/index.ts` | Updated `SourceHintEntry` with new fields; map them in `generatePacket` |

## Remaining Limitations

1. **MAX_HINTS = 10** — In a large project, useful hints may be truncated by the limit
2. **No file-existence check for legacy route/framework matchers** — Only class-name-derived candidates get existence checked
3. **Style adjacency only checks one directory** — Won't find CSS in a shared styles directory

## Verdict

**PASS.** The source hint engine now grounds candidates in actual repository files rather than generated name patterns alone.
