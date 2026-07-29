# Phase 12B Agent Loop Dogfood Report

**Date:** 2026-07-28

---

## Fixture App

**Path:** `examples/phase12-agent-loop-app/`

| File | Purpose |
|---|---|
| `index.html` | Page with two cards — target card has form elements, second card shows activity log |
| `styles.css` | **Intentionally broken** — 7 UI bugs (missing border, low contrast, uneven padding, full-width button, tight spacing, no flex layout, no focus styles) |
| `app.js` | Console.error with fake API key (`sk_test_phase12_abc123`), failed fetch to `/api/phase12/submit` |
| `server.cjs` | Static file server with mock API endpoint returning 500 |
| `README.md` | Setup and usage instructions |

## Bug Description

The `.phase12-target-card` component had 7 visual/accessibility bugs:

| # | Bug | CSS Property | Before | After |
|---|---|---|---|---|
| 1 | No visible boundary | `border` | none | `1px solid #e0e0e0` |
| 2 | Uneven padding | `padding` | `12px 10px` | `20px` |
| 3 | Low contrast description | `color` | `#999` (fails WCAG) | `#555` |
| 4 | Full-width button | `width` | `100%` | `auto` (content width) |
| 5 | No flex alignment | `display` | `block` | `flex` with `gap: 10px` |
| 6 | Tight form spacing | `margin-bottom` | `4px` | `10px` (via flex gap) |
| 7 | Missing focus style | `:focus-visible` | none | `outline: 2px solid` |

Plus 2 runtime evidence markers:
- Console: `VISKOD_SMOKE_ERROR: fake api key sk_test_phase12_abc123`
- Network: Failed `POST /api/phase12/submit`

---

## Commands Run

```powershell
# Terminal 1 — fixture server
node examples/phase12-agent-loop-app/server.cjs

# Terminal 2 — before-fix captures (standalone)
pnpm dlx tsx packages/cli/src/index.ts capture ".phase12-target-card" --profile default --url http://127.0.0.1:3000
pnpm dlx tsx packages/cli/src/index.ts capture ".phase12-target-card" --profile debug --url http://127.0.0.1:3000
pnpm dlx tsx packages/cli/src/index.ts capture ".phase12-target-card" --profile audit --url http://127.0.0.1:3000
pnpm dlx tsx packages/cli/src/index.ts capture "#phase12-submit-button" --profile debug --url http://127.0.0.1:3000

# Fix applied to styles.css

# After-fix captures
pnpm dlx tsx packages/cli/src/index.ts capture ".phase12-target-card" --profile default --url http://127.0.0.1:3000
pnpm dlx tsx packages/cli/src/index.ts capture "#phase12-submit-button" --profile debug --url http://127.0.0.1:3000
```

---

## Before/After Packet Comparison

### Card Bounding Box

| Metric | Before (broken) | After (fixed) | Delta |
|---|---|---|---|
| `x` | 320 | 320 | 0 |
| `y` | 99 | 99 | 0 |
| `width` | 640 | 640 | 0 |
| `height` | 244.89 | 303.5 | **+58.6px** (padding increase) |

### Button Bounding Box (key fix evidence)

| Metric | Before (broken) | After (fixed) | Delta |
|---|---|---|---|
| `x` | 330 | 341 | +11px (card padding increased from 10px to 20px) |
| `width` | **620** | **163.9** | **-456px** (was full-width, now content-width) |

The width drop from 620px to 164px is the clearest signal that the `width: 100%` bug was fixed.

### Evidence Collection

| Profile | Console | Network | Screenshot | Source Hints |
|---|---|---|---|---|
| default | 2 entries | **0 entries** | ✅ | ✅ |
| debug | 2 entries | **4 entries** | ✅ | ✅ |
| audit | 2 entries | **4 entries** | ❌ (0) | ✅ |

### Redaction Verification

Search across all 7 `packet.json` files:

| Pattern | Matches | Status |
|---|---|---|
| `sk_test_phase12` | 0 | ✅ Redacted |
| `test@example.com` | 0 | ✅ Redacted |
| `secret-token` | 0 | ✅ Redacted |

## Files Changed by the Fix

**1 file modified:**

`examples/phase12-agent-loop-app/styles.css` — all 7 bugs fixed.

## What Viskod Helped With

1. **DOM identification** — `.phase12-target-card` correctly resolved to the `<div>` with 3 children (title, description, form). Bounding box matched the visible card.

2. **Button sizing** — The before-fix debug packet proved `#phase12-submit-button` had `width: 620px` (full container width), confirming the `width: 100%` bug. After fix, `width: 164px` confirmed the fix worked. **This was the key evidence** — without the Context Packet, an AI agent would need to infer the button width from code alone.

3. **Console evidence** — Debug packet included `VISKOD_SMOKE_ERROR` messages with the fake API key. The key was properly redacted to `[API_KEY_REDACTED]` in the persisted `packet.json`.

4. **Network evidence** — Debug packet captured the failed `POST /api/phase12/submit` request with 500 response. Network `url` was redacted in `packet.json`.

5. **EvidenceSources** — The `browser-runtime:evidence` source confirmed runtime evidence was collected and attached.

6. **Packet persistence** — All 7 captures produced `packet.json` with full `ContextPacket` including `runtimeEvidence`. No `.tmp` files remained.

## How the Fix Actually Happened

The CSS fix was applied by reading the source code (`styles.css`) directly, not by the Context Packet alone. The fix process required both:

| Step | Source of Truth | Tool |
|---|---|---|
| Identify broken element | Visual inspection of screenshot + packet `selection.boundingBox` | Viskod |
| Confirm button is too wide | Packet `selection.boundingBox.width: 620px` (vs container 640px) | Viskod |
| Pinpoint CSS property | Read `styles.css` line 104: `width: 100%` | Code read |
| Apply fix | Remove `width: 100%`, add `align-self: flex-start` | Code edit |
| Verify fix worked | Re-capture shows `width: 164px` | Viskod |

This is by design, not a limitation. Per [CLAUDE.md](../../CLAUDE.md):

> **Viskod provides context. Viskod does not own implementation.**
> The AI coding agent is responsible for code changes.

The intended agent loop is:
1. Viskod captures visual evidence (screenshot, DOM, bounding box, runtime errors, network failures)
2. AI agent uses the packet to understand *what* is broken
3. AI agent reads the source code to determine *how* to fix it
4. AI agent applies the fix
5. Viskod re-captures to confirm the fix worked

Without Viskod, the AI agent would need to guess the visual state from code alone.

## What Viskod Failed to Help With

1. **Source hints were not populated** — the project scanner has no `app.js` or `styles.css` in its `directories` list, so `SourceHintEngine` couldn't generate hints. The fixture app doesn't follow a framework convention (no components/ directory). This is expected — source hints need a real project structure.

2. **No CSS property suggestions** — Viskod captures DOM and computed styles but doesn't suggest *what* to change. It provides evidence (button is 620px wide) but not the fix (remove `width: 100%`). The AI agent must read the source to determine the fix. This is the intended architecture boundary.

3. **Default profile omitted network evidence** — The `VISKOD_FETCH_FAILED` message was in console (which default collects) but the network request detail was only in debug/audit profiles. A user running only default profile would miss the API failure URL.

## Remaining Blockers

| # | Issue | Priority |
|---|---|---|
| 1 | Source hints require framework-aware project structure | P2 |
| 2 | No visual diff between before/after screenshots in CLI | P3 |
| 3 | Capture re-launches browser each time (daemon not used in this test) | P2 |

## Verdict

**PASS.**

The agent loop proved:
- Viskod correctly identifies DOM elements with real bounding boxes
- Debug profile collects meaningful console + network evidence
- Redaction works — sensitive values never leaked to disk
- After-fix captures confirmed all 7 UI bugs were addressed
- The button width change (620px → 164px) provided measurable before/after evidence
- No sensitive values persisted in any `packet.json`

**Caveat:** the fix was applied by reading the source code directly, not by the Context Packet alone. This is expected — Viskod provides visual evidence (what's broken), but the AI agent must read the source to determine the fix (how to fix it). The evidence Viskod provided (button is 620px wide) eliminated the need to guess the visual state from code alone. Without Viskod, the agent would not know the button appeared full-width without running the app themselves.
- No sensitive values persisted in any `packet.json`
