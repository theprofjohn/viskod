# Phase 12D Blind Source Hint Agent Test Report

**Date:** 2026-07-28

---

## Blind Agent Setup

### Fixture State

The existing `examples/phase12-source-hint-app` fixture was **reverted to broken state** (no border, `#999` contrast, `width: 100%` button, no focus style). The fixed version from Phase 12C was overwritten with the broken CSS.

### Blind Packet Given to Agent

**Path:** `.viskod/captures/1e98eaed-c4d9-443b-b044-8756cb16d4c2/packet.json`

### Source Hints Content (from packet)

```
10 candidates. PRIMARY: target-card.tsx (confidence 0.65)
  target-card.tsx             (PRIMARY)
  target-card.jsx
  target-card.vue
  target-card.svelte
  components/target-card/index.tsx
  components/target-card.tsx
  target-card/index.tsx
  target-card/index.jsx
  target-card.component.tsx
  target-card.component.jsx
```

### Blind Fixing Prompt Used

```
You are fixing a UI bug in this repo. Do not assume file paths.
First inspect the provided Viskod Context Packet. Use sourceHints,
DOM evidence, bounding boxes, and runtime evidence to locate the
likely source files. The visible issue is that the target card/button
layout is visually wrong. Fix the issue, then explain which sourceHint
entry led you to the file.

Packet path: .viskod/captures/1e98eaed-c4d9-443b-b044-8756cb16d4c2/packet.json
Selector: .target-card
Project root: examples/phase12-source-hint-app
```

The prompt intentionally omitted:
- `TargetCard.jsx` / `TargetCard.css`
- `src/components`
- `width: 100%`
- Any CSS property names

---

## How the Agent Actually Used Source Hints

### Step-by-step trace

| Step | Action | Evidence Used |
|---|---|---|
| 1 | Read packet.json | Packet path given in prompt |
| 2 | Found sourceHints array with 10 entries | `packet.sourceHints` |
| 3 | Read PRIMARY hint: `target-card.tsx` | `sourceHints[0].filePath` |
| 4 | Searched for `target-card.tsx` on disk | Not found (file does not exist) |
| 5 | Read hint #2: `target-card.jsx` | `sourceHints[1].filePath` |
| 6 | Searched for `target-card.jsx` on disk | Not found (actual file: `TargetCard.jsx`) |
| 7 | Did case-insensitive glob for `*target-card*` in project root | Found `TargetCard.jsx` and `TargetCard.css` |
| 8 | Identified `TargetCard.css` as the style file | `.target-card` class name matches selector |
| 9 | Read `TargetCard.css` | Found `width: 100%`, `#999`, missing `border`, missing `:focus-visible` |
| 10 | Applied fix | Added border, fixed contrast, removed full-width, added focus style |
| 11 | Verified with re-capture | packet shows height 110.89 → 147.5, button width ~95px |

### Which sourceHint Entry Was Used

**`sourceHints[0].filePath` = `"target-card.tsx"`** was the primary hint consulted. When this file was not found on disk, the agent fell back to `sourceHints[1].filePath` = `"target-card.jsx"`, which also didn't match exactly (`TargetCard.jsx`). The agent then used a case-insensitive search.

The source hint narrowed the search from the entire project to files matching `target-card`, which directly led to `TargetCard.jsx` and `TargetCard.css` within seconds.

### Files the Agent Opened

1. `packet.json` (inspected for sourceHints, boundingBox, evidence)
2. `TargetCard.css` (read, modified)
3. `TargetCard.jsx` (briefly inspected to confirm component structure)

### Files Changed

**1 file:** `examples/phase12-source-hint-app/src/components/TargetCard.css`

---

## Before/After Bounding Boxes

| Element | Before | After | Change | Root Cause |
|---|---|---|---|---|
| `.target-card` height | **110.89** | **147.50** | +36.61px | Padding `10px 8px` → `20px`; flex gap added |
| `.target-card` width | 640 | 640 | — | — |
| `#phase12-source-submit-button` width | **624** (from Phase 12C) | **95.45** | -528.55px | `width: 100%` removed |

---

## Redaction Results

| Pattern | Matches | Status |
|---|---|---|
| `sk_test_sourcehint` | 0 | ✅ Redacted |
| `test@example.com` | 0 | ✅ Redacted |
| `secret-token` | 0 | ✅ Redacted |

## .tmp Files

**0** — no stray `.tmp` files in any capture directory.

## Validation

| Check | Result |
|---|---|
| `pnpm check` (biome + tsc + vitest) | ✅ Pass |
| 3 captures, 3 packet.json files | ✅ 1:1 mapping |
| Redaction | ✅ No leaks |
| .tmp files | ✅ None |

---

## Verdict

**PASS.**

The agent successfully used source hints to locate the source file without prior knowledge of the file paths:

1. **Agent inspected packet before editing** — sourceHints, bounding boxes, and runtime evidence were all read before any code change.
2. **Agent used a sourceHint entry** — PRIMARY hint `target-card.tsx` was the starting point for file search. When the exact file wasn't found, hint #2 `target-card.jsx` guided a case-insensitive glob that found `TargetCard.jsx` and `TargetCard.css`.
3. **Agent fixed the UI without being told the exact file path** — the fixing prompt withheld all file paths, component names, and CSS properties.
4. **Re-capture proves the visual fix** — card height increased from 110.89 to 147.50; button width dropped to ~95px (content-width).
5. **Sensitive values remained redacted** — zero leaks.

**Limitation noted:** the source hint `target-card.tsx` (PRIMARY) did not exist on disk. The actual file was `TargetCard.jsx` (capitalised). The agent needed a case-insensitive search as a bridge. This could be improved by either:
- Making the source hint engine suggest case-insensitive file lookups
- Or adding a confidence penalty when the hinted file doesn't exist on disk
