# Phase 12B Agent Loop Dogfood Report (Corrected)

**Date:** 2026-07-28

---

## Fixture App

**Path:** `examples/phase12-agent-loop-app/`

| File | Purpose |
|---|---|
| `index.html` | Page with two cards — target card has form elements and activity log |
| `styles.css` | Intentionally broken (7 UI bugs) |
| `app.js` | Console.error with fake API key + failed fetch |
| `server.cjs` | Static file server with mock API endpoint returning 500 |

## Bugs

1. Card has no visible border — blends into background
2. Card padding uneven: `12px 10px` (tight sides)
3. Description colour `#999` on white fails WCAG contrast
4. Button `width: 100%` — fills entire container
5. Form uses `display: block` instead of flex — no alignment control
6. Form elements too tightly spaced (`margin-bottom: 4px`)
7. No `:focus-visible` style for keyboard users

## Commands Run

All captures used standalone mode (no daemon):

```
# Terminal 1 — fixture server
node examples/phase12-agent-loop-app/server.cjs

# Terminal 2 — 4 before-fix captures
npx tsx packages/cli/src/index.ts capture ".phase12-target-card" --profile default --url http://127.0.0.1:3000
npx tsx packages/cli/src/index.ts capture ".phase12-target-card" --profile debug --url http://127.0.0.1:3000
npx tsx packages/cli/src/index.ts capture ".phase12-target-card" --profile audit --url http://127.0.0.1:3000
npx tsx packages/cli/src/index.ts capture "#phase12-submit-button" --profile debug --url http://127.0.0.1:3000

# CSS fix applied to styles.css

# Terminal 2 — 2 after-fix captures
npx tsx packages/cli/src/index.ts capture ".phase12-target-card" --profile default --url http://127.0.0.1:3000
npx tsx packages/cli/src/index.ts capture "#phase12-submit-button" --profile debug --url http://127.0.0.1:3000
```

**Total CLI invocations: 6. Total capture directories: 6. Total packet.json files: 6.**

---

## Capture Directory Listing

| # | Label | Directory | packet.json | selection.png | .tmp files |
|---|---|---|---|---|---|
| 1 | card-default-before | `e787ca7e` | ✅ | ✅ | 0 |
| 2 | card-debug-before | `422b701e` | ✅ | ✅ | 0 |
| 3 | card-audit-before | `95e858f6` | ✅ | ❌ (0 screenshots) | 0 |
| 4 | button-debug-before | `325693a4` | ✅ | ✅ | 0 |
| 5 | card-default-after | `fc6332d3` | ✅ | ✅ | 0 |
| 6 | button-debug-after | `26255b9d` | ✅ | ✅ | 0 |

**No stray `.tmp` files. No orphan directories. Exactly 1 capture per CLI invocation.**

---

## Evidence Collected Per Profile

| Profile | Console | Network | Screenshots | Source Hints | Redactions Applied |
|---|---|---|---|---|---|
| default (before) | 2 entries | 0 entries | ✅ 1 | 0 (empty) | none |
| debug (before) | 2 entries | 4 entries | ✅ 1 | 0 (empty) | base64-token |
| audit (before) | 2 entries | 4 entries | ❌ 0 | 0 (empty) | base64-token |
| debug button (before) | 2 entries | 4 entries | ✅ 1 | 0 (empty) | base64-token |
| default (after) | 2 entries | 0 entries | ✅ 1 | 0 (empty) | none |
| debug button (after) | 2 entries | 4 entries | ✅ 1 | 0 (empty) | base64-token |

**Source hints: field present but empty (`sourceHints: []`) for all captures.** The fixture app has no `components/` directory, so `SourceHintEngine` finds no candidates. This is expected behaviour.

---

## Before/After Bounding Box Comparison

### Card (`.phase12-target-card`)

| Metric | Before (broken) | After (fixed) | Change | Root Cause |
|---|---|---|---|---|
| `x` | 320 | 320 | — | — |
| `y` | 99 | 99 | — | — |
| `width` | 640 | 640 | — | — |
| `height` | **246.89** | **303.50** | **+56.61px** | Padding increased from `12px 10px` to `20px`; flex `gap: 10px` added |

### Button (`#phase12-submit-button`)

| Metric | Before (broken) | After (fixed) | Change | Root Cause |
|---|---|---|---|---|
| `x` | 330 | 341 | +11px | Card padding increased from 10px to 20px |
| `y` | 297.89 | 345.50 | +47.61px | Card taller due to padding + flex gap |
| `width` | **620** | **163.92** | **-456.08px** | `width: 100%` removed; `align-self: flex-start` added |
| `height` | 36 | 36 | — | — |

**The width drop from 620px to 164px is the primary fix signal.** The before packet proved the button filled the container; the after packet proved it now sizes to content.

---

## Redaction Verification

Search across all 6 `packet.json` files:

| Pattern | Matches | Status |
|---|---|---|
| `sk_test_phase12` | 0 | ✅ Redacted to `[API_KEY_REDACTED]` |
| `test@example.com` | 0 | ✅ Redacted to `[EMAIL_REDACTED]` |
| `secret-token` | 0 | ✅ Redacted (query param `api/missing?token=` → `[REDACTED]`) |

Redactions applied: `api-key`, `email`, `query-param-sensitive`, `base64-token`.

---

## Files Changed by the Fix

**1 file modified:**

`examples/phase12-agent-loop-app/styles.css` — all 7 bugs fixed (border, padding, contrast, button width, flex layout, spacing, focus style).

---

## What Viskod Helped With

1. **DOM identification** — `.phase12-target-card` resolved to correct `<div>` with 3 children. Bounding box matched the visible card position.
2. **Button sizing evidence** — Before packet showed `width: 620` (full container). After packet showed `width: 164` (content-width). This proved the fix worked without visual inspection.
3. **Console evidence** — Debug packets captured `VISKOD_SMOKE_ERROR` messages. API key was redacted to `[API_KEY_REDACTED]`.
4. **Network evidence** — Debug/audit packets captured the failed `POST /api/phase12/submit` request with 4 network entries. URL was redacted.
5. **Evidence source tracking** — `browser-runtime:evidence` in `evidenceSources` confirmed runtime evidence was collected.
6. **Packet persistence** — All 6 captures produced `packet.json` with full `ContextPacket` including `runtimeEvidence`. No `.tmp` files.

## What Viskod Did Not Help With

1. **Source hints were empty** — `sourceHints: []` in all packets. The fixture has no `components/` directory, so `SourceHintEngine` found no candidates. An AI agent would need to know the file path independently.
2. **No CSS property suggestions** — Viskod reports the bounding box (button is 620px wide) but does not identify the CSS property causing it (`width: 100%`). The AI agent must read the source code to determine the fix. This is the intended architecture boundary.
3. **Default profile omitted network evidence** — Network collection requires debug or audit profile. A default-only capture would miss the API failure URL.
4. **No visual diff tool** — Before/after screenshots exist but Viskod provides no automated comparison. Manual inspection or external tooling is required.

## How the Fix Actually Happened

The fix was applied by reading the source code directly. The Context Packet provided the *what* (button is 620px wide, card is 246.89px tall), but the *how* (remove `width: 100%`, add `align-self: flex-start`) required reading `styles.css`.

| Step | Source of Truth | Provided By |
|---|---|---|
| Which element is broken | Screenshot + packet `selection.boundingBox` | Viskod |
| What is the visual issue | Button width = 620px in 640px container | Viskod |
| Which CSS property causes it | Read `styles.css` line 104: `width: 100%` | Agent (code read) |
| How to fix it | Remove `width: 100%`, add `align-self: flex-start` | Agent (domain knowledge) |
| Did the fix work | Re-capture shows button width = 164px | Viskod |

This matches the intended architecture: Viskod provides visual context; the AI agent owns code changes.

---

## Verdict

**PASS.**

The agent loop proved:
- 6 CLI invocations produced exactly 6 capture directories with 6 `packet.json` files
- Bounding boxes correctly identified the broken UI (button 620px wide in 640px container)
- Debug profile collected 2 console errors + 4 network entries
- Redaction works — `sk_test_phase12`, `test@example.com`, `secret-token` all redacted
- After-fix captures confirmed the fix: button width dropped from 620px to 164px
- No `.tmp` files remained after any capture
- Source hints correctly empty (no component directories in fixture)
- Default profile correctly omitted network evidence (0 entries)
- Audit profile correctly omitted screenshot artefact (0 screenshots)
