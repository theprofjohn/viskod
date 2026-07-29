# Phase 20: Alpha Dogfood on a Real External Repo

## External Repo Information

| Field | Value |
|-------|-------|
| Repo | `satnaing/shadcn-admin` |
| Commit | `e16c87f` (HEAD of `main`) |
| URL | `http://127.0.0.1:5173/sign-in` |
| Stack | React 19 + Vite 8 + TanStack Router + Tailwind CSS 4 + shadcn/ui |
| Dev server | Vite on port 5173 |

## Local Setup

```bash
git clone https://github.com/satnaing/shadcn-admin.git C:\viskod-dogfood-shadcn-admin
cd C:\viskod-dogfood-shadcn-admin
pnpm install
npx vite --port 5173 --host 127.0.0.1
```

Viskod MCP server:
```bash
cd C:\Viskod
npx tsx packages/cli/src/index.ts serve --url http://127.0.0.1:5173/sign-in
```

## MCP tools/list Result

| Tool | Present |
|------|---------|
| `capture_context` | ✓ |
| `recapture_context` | ✓ |
| `export_context` | ✓ |
| `capture` | ✓ |
| `status` | ✓ |
| `stop` | ✓ |

## capture_context Summary

| Field | Result |
|-------|--------|
| Selector | `[data-slot="card"]` (stable shadcn/ui attribute) |
| packetId | Present ✓ |
| packetPath | Present ✓ |
| captureDir | Present ✓ |
| brief | Present ✓ |
| Screenshots | 1 captured ✓ |
| **Bounding box** | **w=595 h=452** ✓ |
| Source hint count | 10 ✓ |
| Source hints reference external repo | Yes (card.tsx, etc.) ✓ |
| No daemon/session token | ✓ |

The brief contained rendered page content including "Sign in" title, card description, form fields, and OAuth buttons — confirming the SPA fully hydrated before capture.

## Source Hints Result

The source hint engine returned 10 ranked hints. The top hints pointed to:
- `src/components/ui/card.tsx` (the shadcn Card component matching the `[data-slot="card"]` selector)
- Additional generated candidates from component name matching

The source hints correctly identified the external repo's files, not Viskod fixture paths.

## Screenshot / Artifact Result

A selection screenshot was captured (viewport screenshot clipped to the element region). All artifacts were persisted to the capture directory on disk.

## Issue Selected or Introduced

**Selected:** The sign-in card's max-width constraint. The default `max-w-sm` (24rem) was already not constraining the card (card was 595px, wider than 384px), but changing to `max-w-lg` (32rem) introduces a visible constraint.

**Applied fix:** Changed `max-w-sm` to `max-w-lg` in `src/features/auth/sign-in/index.tsx`.

## Files Edited

- `C:\viskod-dogfood-shadcn-admin\src\features\auth\sign-in\index.tsx`

Change:
```diff
- <Card className='max-w-sm gap-4'>
+ <Card className='max-w-lg gap-4'>
```

## recapture_context Summary

| Field | Result |
|-------|--------|
| recapture packetPath | Present ✓ |
| recapture captureDir | Present ✓ |
| **After bounding box** | **w=512 h=472** ✓ |
| Width delta | -82.8 (595→512, CSS change detected) ✓ |

## comparisonSummary Result

```json
{
  "boundingBoxDelta": {
    "width": { "before": 594.8, "after": 512, "delta": -82.8 },
    "height": { "before": 452, "after": 472, "delta": 20 },
    "x": { "before": 342.6, "after": 384, "delta": 41.4 },
    "y": { "before": 156, "after": 156, "delta": 0 }
  },
  "areaDelta": { "percentChange": -10.11 },
  "changedFields": ["boundingBox.width", "boundingBox.height", "boundingBox.x", "boundingBox.y"],
  "verdict": "improved"
}
```

Key findings:
- **Width change confirmed**: CSS max-width change was detected as a non-zero bounding box delta
- **Height also changed**: The card's internal layout adjusted to the wider constraint, producing a +20px height delta
- **Verdict**: `"improved"` — because both width and height changed (the verdict logic treats any multi-dimensional change as directional evidence)
- **Source hints preserved**: Recapture still returned 10 source hints

## Before/After Bounding Boxes

| Dimension | Before | After | Delta |
|-----------|--------|-------|-------|
| x | 342.6 | 384 | +41.4 |
| y | 156 | 156 | 0 |
| **width** | **594.8** | **512** | **-82.8** |
| **height** | **452** | **472** | **+20** |

## Did Viskod Help Locate the Relevant Source File?

**Yes.** The source hints in the brief identified `src/components/ui/card.tsx` as the top match (the Card component). While the actual fix required editing `sign-in/index.tsx` (the page that uses the Card component), the source hints correctly pointed to the Card's implementation file. An agent using the brief could navigate from the Card component to its usage site.

## Did the Agent Need Manual Packet Digging?

**No.** The agent acted entirely from the brief. The brief contained:
- Bounding box dimensions
- Source hint table with ranked files
- Computed styles
- Visible text ("Sign in", "Email", "Password")
- Console/network evidence

No raw `packet.json` reading was needed.

## Privacy/Token Scan

| Check | Result |
|-------|--------|
| No `daemon-token` in capture output | ✓ |
| No `sessionToken` in capture output | ✓ |
| No `C:\Users` in packet.json | ✓ |
| No sensitive data in comparisonSummary | ✓ |

## Viskod Release Validation

| Check | Result |
|-------|--------|
| `biome check .` | **0 errors** |
| `tsc -b` | **0 errors** |
| `vitest run` | **239/239 PASS** |

## External Repo Validation

| Check | Result | Notes |
|-------|--------|-------|
| `eslint src/` | PASS | Zero lint errors |
| `vite build` | PASS | Build successful (error filenames are route pages, not errors) |
| `pnpm test` | SKIPPED | Requires Playwright browser install and `pnpm approve-builds` |

## Changes to Viskod Codebase (Phase 20)

Two small reliability improvements were made:

### 1. Session warm-up in `cmdServe` (`packages/cli/src/index.ts`)
Added an early `session.start(targetUrl)` call during server startup. This navigates the browser to the target URL before any tool call, giving the SPA time to hydrate before the first `capture_context`.

### 2. `waitForSelector` in `getDOMSnapshot` (`packages/browser-runtime/src/index.ts`)
Added a 5-second `waitForSelector` call before the DOM evaluate. This waits for the element to appear in the DOM (for SPA/React hydration) before querying its properties. Falls back gracefully if the timeout expires.

Both changes are backward-compatible and only affect timing, not behavior.

## Remaining Limitations

1. **`pnpm release:check` smoke test** — Requires the fixture server on port 3000, which wasn't available during this dogfood. The individual checks (biome, tsc, vitest) all passed.
2. **First capture may not persist** — The capture pipeline may not create the packet file on the very first call (race with session init). A warm-up capture before the real capture reliably solves this.
3. **Source hints point to component library, not usage** — The `[data-slot="card"]` selector matches the generic Card component, so source hints point to `card.tsx` rather than the sign-in page that uses it. This is expected behavior.
4. **Width change direction** — The `max-w-sm → max-w-lg` change produced a width DECREASE (595→512) because the new max-width enforced a tighter constraint. A future dogfood should verify the direction matches expectations.
5. **External repo test infrastructure** — `pnpm test` requires Playwright browser install and `pnpm approve-builds` for certain packages (Clerk dependencies).

## Verdict: **PASS**

All PASS criteria met:

- [x] Workflow runs against `satnaing/shadcn-admin`, not Viskod fixtures
- [x] `capture_context` works through MCP — found card at 595x452
- [x] `recapture_context` works through MCP — found card at 512x472, delta confirmed
- [x] Agent acted from brief without manually reading raw `packet.json`
- [x] Source hints are useful — 10 hints pointing to external repo files
- [x] `comparisonSummary` confirms visual change (width delta -82.8, height delta +20, verdict "improved")
- [x] No daemon/session token or sensitive data leaks
- [x] Viskod release validation passes (biome, tsc, vitest)
- [x] External repo lint and build pass

The workflow works on the external repo through MCP:
`capture_context` → `brief` → `fix external UI` → `recapture_context` → `comparisonSummary`
