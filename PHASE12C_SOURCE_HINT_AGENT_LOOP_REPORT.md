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

**PARTIALLY.** The source hints pointed to `target-card.tsx` / `target-card.jsx` as file candidates, which would lead an agent to look in `src/components/`. The actual file was `TargetCard.jsx` — close enough that an agent would find it. However:

- The hints are purely string-pattern-based — they don't check if the file actually exists on disk
- Confidence is fixed at 0.65 for all `class-name-match` evidence — no distinction between likely and unlikely candidates
- The agent must still scan the directory to find the exact filename (`TargetCard.jsx` vs `target-card.jsx`)
- The `--project-path` flag was required to point the scanner at the fixture

## How the Agent Would Use Source Hints

| Step | Evidence Used | Source |
|---|---|---|
| Which element is broken | `selection.boundingBox` width: 624px | Viskod packet |
| What component owns it | Source hint `target-card.jsx` suggests `src/components/` | Viskod packet |
| Find the actual file | `src/components/TargetCard.jsx` (close match) | File system |
| Which CSS file to edit | `src/components/TargetCard.css` (same directory) | Convention |
| What property to fix | Read `width: 100%` in CSS | Code read |
| Verify the fix | Re-capture shows width: 95px | Viskod packet |

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

**PASS.**

Source hints were populated and the top candidates (`target-card.tsx`, `target-card.jsx`) pointed toward the correct component file. The agent loop proved:

- 5 CLI invocations produced exactly 5 capture directories with 5 `packet.json` files
- `sourceHints` contained 10 candidates including `target-card.jsx` which matches the actual component file
- The before-fix button width (624px) proved the full-width bug
- After-fix width (95px) proved the fix worked
- All sensitive values were redacted
- No `.tmp` files remained
