# Phase 12C Source Hint Agent Loop Report

**Date:** 2026-07-28

---

## Fixture App

**Path:** `examples/phase12-source-hint-app/`

```
examples/phase12-source-hint-app/
  package.json
  tsconfig.json
  index.html
  server.cjs
  src/
    App.jsx
    main.jsx
    main.js
    components/
      TargetCard.jsx
      TargetCard.css
```

The fixture simulates a framework-like React project structure with a dedicated `src/components/` directory.

## Bug Description

The `.target-card` component (`TargetCard.css`) had 4 UI bugs:

| # | Issue | Property | Before | After |
|---|---|---|---|---|
| 1 | No visible boundary | `border` | none | `1px solid #e0e0e0` |
| 2 | Low contrast description | `color` | `#999` (WCAG fail) | `#555` |
| 3 | Full-width button | `width` | `100%` | auto (content-width) |
| 4 | Missing focus style | `:focus-visible` | none | `outline: 2px solid` |

Plus runtime evidence markers:
- Console: `VISKOD_SOURCE_HINT_ERROR: fake api key sk_test_sourcehint_abc123`
- Network: Failed `POST /api/source-hint/submit`

## Commands Run

```bash
# Terminal 1 — fixture server
node examples/phase12-source-hint-app/server.cjs

# Terminal 2 — 3 before-fix captures
npx tsx packages/cli/src/index.ts capture ".target-card" --profile default --url http://127.0.0.1:3000 --project-path examples/phase12-source-hint-app
npx tsx packages/cli/src/index.ts capture ".target-card" --profile debug --url http://127.0.0.1:3000 --project-path examples/phase12-source-hint-app
npx tsx packages/cli/src/index.ts capture "#phase12-source-submit-button" --profile debug --url http://127.0.0.1:3000 --project-path examples/phase12-source-hint-app

# CSS fix applied to src/components/TargetCard.css

# Terminal 2 — 2 after-fix captures
npx tsx packages/cli/src/index.ts capture ".target-card" --profile default --url http://127.0.0.1:3000 --project-path examples/phase12-source-hint-app
npx tsx packages/cli/src/index.ts capture "#phase12-source-submit-button" --profile debug --url http://127.0.0.1:3000 --project-path examples/phase12-source-hint-app
```

## Source Hints Content (before fix, debug packet)

```
10 candidates found.
Primary: target-card.tsx  (confidence: 0.65)
         target-card.jsx  (confidence: 0.65)
         target-card.vue  (confidence: 0.65)
         target-card.svelte  (confidence: 0.65)
         components/target-card/index.tsx  (confidence: 0.65)
         components/target-card.tsx  (confidence: 0.65)
         target-card/index.tsx  (confidence: 0.65)
         target-card/index.jsx  (confidence: 0.65)
         target-card.component.tsx  (confidence: 0.65)
         target-card.component.jsx  (confidence: 0.65)
```

**`target-card.jsx` matched the actual file `TargetCard.jsx`** (case-insensitive path match via `toLowerCase`).

## Did Source Hints Help Locate the File?

**NOT USED.** The agent (OpenCode/AI) who performed the fix already knew the file paths because it created the fixture. The source hints were verified to be populated (10 candidates, primary `target-card.tsx`), but they were never consulted to navigate to the source file.

This is a methodological gap in the dogfood design, not a source hint failure. A genuine agent loop would require an agent that does not already know the codebase.

## How the Agent Actually Used Source Hints

The agent did not use source hints. Here is what actually happened:

| Step | How It Was Done | Evidence Used |
|---|---|---|
| Which element is broken | Agent knew the fixture structure | Prior knowledge (agent created the fixture) |
| Where is the component file | Agent knew the path from creating the fixture | Prior knowledge |
| What CSS property to fix | Read `TargetCard.css` directly | Code read |
| Verify the fix | Re-capture showed width 624px → 95px | Viskod `selection.boundingBox` |

**The OpenCode/agent prompt used for this fix was:**
```
Now apply the fix to TargetCard.css: add border, fix contrast, remove width:100%, add focus style.
```

This prompt was issued without consulting the Context Packet's `sourceHints` field. The agent acted on prior knowledge from creating the fixture.

## How an Independent Agent Would Use Source Hints

If the agent did not know the codebase, the source hints would provide:

1. **First hint:** `target-card.tsx` (confidence 0.65, primary) — points the agent to look for a `target-card.tsx` file
2. **Second hint:** `target-card.jsx` (confidence 0.65) — the actual file is `TargetCard.jsx`, close match
3. **File structure:** the hint paths include `components/target-card.tsx`, revealing a `src/components/` directory convention
4. **CSS discovery:** from the `.jsx` hint, the agent would scan the same directory for `TargetCard.css`

The agent would still need to:
- Read the file system to find the exact filename (`TargetCard.jsx` vs `target-card.tsx`)
- Inspect the CSS to identify the specific property causing the width issue
- Determine the fix values (which border, which colour, which padding)

Without source hints, the agent would need to guess the component directory structure or search the entire repo for matching selectors.

## Before/After Bounding Box Comparison

### Card (`.target-card`)

| Metric | Before | After | Change |
|---|---|---|---|
| `width` | 640 | 640 | — |
| `height` | **110.89** | **147.50** | **+36.61px** (padding: `10px 8px` → `20px`) |

### Button (`#phase12-source-submit-button`)

| Metric | Before | After | Change |
|---|---|---|---|
| `width` | **624** | **95.45** | **-528.55px** (removed `width: 100%`) |
| `height` | 36 | 36 | — |

## Redaction Results

All patterns searched across 5 `packet.json` files:

| Pattern | Matches | Status |
|---|---|---|
| `sk_test_sourcehint` | 0 | ✅ Redacted (`api-key`, `base64-token`) |
| `test@example.com` | 0 | ✅ Redacted |

## Evidence Collection

| Profile | Console | Network | Screenshots | Source Hints |
|---|---|---|---|---|
| default | 1 entry | 0 entries | ✅ 1 | 10 candidates |
| debug (card) | 1 entry | 3 entries | ✅ 1 | 10 candidates |
| debug (button) | 1 entry | 3 entries | ✅ 1 | 10 candidates |

## Files Changed by the Fix

**1 file:** `examples/phase12-source-hint-app/src/components/TargetCard.css`

## CLI Enhancement

Added `--project-path` argument to `viskod capture` to allow specifying the project root for source scanning. Without this, the scanner auto-discovers from CWD and misses fixture component directories.

## What Viskod Helped With

1. **Source hints populated** — `target-card.jsx` appeared as the #2 hint, pointing the agent toward the correct component directory.
2. **DOM identification** — `.target-card` resolved with correct bounding box (640px wide, matching container width).
3. **Button sizing evidence** — Before: 624px (full-width bug). After: 95px (content-width). Direct proof of fix.
4. **Runtime evidence** — Console error captured and redacted. Network failure captured and redacted.
5. **Packet persistence** — 5 captures produced 5 `packet.json` files, all with full `runtimeEvidence`.

## What Viskod Did Not Help With

1. **Source hints are string-pattern-based** — they suggest file names but don't verify file existence. An agent might look for `target-card.tsx` which doesn't exist (the actual file is `TargetCard.jsx`).
2. **`--project-path` required** — the scanner doesn't auto-detect the fixture project from a capture URL. Without manually passing `--project-path`, source hints are empty.
3. **No CSS property identification** — the packet shows the button is 624px wide but doesn't identify `width: 100%` as the cause.
4. **Confidence is flat** — all class-name matches have confidence 0.65 with no ranking signal to indicate which candidate is most likely.

## Verdict

**PARTIAL.** Source hints were technically populated and correct (10 candidates, `target-card.jsx` matched the actual component file). However, the agent did not use them — the fix relied on prior knowledge because the agent created the fixture.

**Why not PASS:** The agent loop was not truly independent. The agent never consulted `sourceHints` to locate the file. Passing would require an agent with no prior knowledge of the codebase to successfully use source hints for navigation.

**What would make it PASS:**
1. An independent agent (one that did not create the fixture) is given the Context Packet
2. The agent uses `sourceHints[0].filePath` or `sourceHints[1].filePath` to locate the component
3. The agent navigates to the file and applies the fix
4. Re-capture confirms the fix

The technical evidence pipeline (capture → packet → sourceHints → bounding boxes → redaction) works correctly. The validation gap is in the agent loop methodology.
