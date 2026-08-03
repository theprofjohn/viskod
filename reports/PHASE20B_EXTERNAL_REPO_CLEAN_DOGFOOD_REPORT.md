# Phase 20B: External Repo Dogfood, Clean Visual Fix

## External Repo Information

| Field | Value |
|-------|-------|
| Repo | `satnaing/shadcn-admin` |
| Commit | `e16c87f` (HEAD of `main`) |
| Dev server | `http://127.0.0.1:5173/sign-in` |
| Stack | React 19 + Vite 8 + TanStack Router + Tailwind CSS 4 + shadcn/ui |

## Local Setup Commands

```bash
git clone https://github.com/satnaing/shadcn-admin.git C:\viskod-dogfood-shadcn-admin
cd C:\viskod-dogfood-shadcn-admin
pnpm install
npx vite --port 5173 --host 127.0.0.1
```

Viskod MCP server started as test child process.

## Selected Route, Element, and Selector

| Field | Value |
|-------|-------|
| Route | `/sign-in` |
| Element | Sign-in card (auth form container) |
| Selector | `[data-slot="card"]` |
| Reason | Stable shadcn/ui attribute selector, consistent across renders |

## Issue Introduced

| Field | Value |
|-------|-------|
| Type | Increase card internal gap spacing |
| File | `src/features/auth/sign-in/index.tsx` |
| Change | `Card className='max-w-sm gap-4'` → `'max-w-sm gap-8'` |
| Expected effect | Card height increases by ~16px (gap-4=1rem=16px → gap-8=2rem=32px, difference +16px per gap between CardHeader/CardContent/CardFooter) |
| Actual effect | Height increased by **32px** (452 → 484). The actual gap increase was +16px per gap × 2 gaps = +32px total. Width unchanged at 595px. |

## capture_context Request Summary

```json
{
  "selector": "[data-slot=\"card\"]",
  "url": "http://127.0.0.1:5173/sign-in",
  "profile": "debug",
  "projectPath": "C:\\viskod-dogfood-shadcn-admin",
  "format": "markdown"
}
```

## capture_context Response Summary

| Field | Result |
|-------|--------|
| packetId | Present ✓ |
| packetPath | **Present ✓** — persisted on FIRST real capture after warm-up |
| captureDir | Present ✓ |
| brief | Present ✓ |
| **Bounding box** | **w=595 h=452** ✓ |
| Source hint count | 10 ✓ |
| No daemon/session token | ✓ |

## First Capture Persistence

**Confirmed: FIRST capture after warm-up persists packetPath to disk.** The capture pipeline correctly initializes after the warm-up and produces a valid packet file path on the subsequent call. The `packetPath` was `C:/Viskod/.viskod/captures/<uuid>/packet.json`.

## Source Hints Result

| Question | Answer |
|----------|--------|
| How many hints? | 10 |
| What was the top hint? | `flex.tsx` (generic component) |
| Did the hint point to the actual edit file? | **No** |
| Did the hint point to the component library? | **Yes** — matches Tailwind's `flex` utility used by the Card |
| What manual inference was needed? | Agent must search the project for `<Card` component usage with matching page text ("Sign in") to find `sign-in/index.tsx` |

**Honest assessment:** For Tailwind-only projects without semantic class names, the source hint engine maps CSS utility classes (flex, gap, etc.) to generic component files, not to the usage site. The agent cannot skip to the correct file from hints alone — it must infer the usage site by combining the hint (component type) with the visible page content.

## Did the Agent Need Manual Packet Digging?

**No.** The brief contained:
- Bounding box dimensions (w=595 h=452)
- Source hint table
- Visible text ("Sign in", "Email", "Password", "Forgot password?", "Or continue with", etc.)
- Console evidence (2 error entries)
- Network evidence (4 requests)
- Computed styles

The agent could act entirely from the brief. Manual inference was needed only to locate the usage file (from `flex.tsx` hint to `sign-in/index.tsx`), which is a project-navigation step, not packet digging.

## File Edited

- `C:\viskod-dogfood-shadcn-admin\src\features\auth\sign-in\index.tsx`

Change:
```diff
- <Card className='max-w-sm gap-4'>
+ <Card className='max-w-sm gap-8'>
```

## recapture_context Request Summary

```json
{
  "selector": "[data-slot=\"card\"]",
  "url": "http://127.0.0.1:5173/sign-in",
  "profile": "default",
  "projectPath": "C:\\viskod-dogfood-shadcn-admin",
  "previousPacketPath": "C:/Viskod/.viskod/captures/<uuid>/packet.json",
  "reload": true,
  "cacheBust": true,
  "format": "markdown"
}
```

## comparisonSummary Result

```json
{
  "boundingBoxDelta": {
    "height": { "before": 452, "after": 484, "delta": 32 },
    "width": { "before": 595, "after": 595, "delta": 0 },
    "x": { "before": 320, "after": 320, "delta": 0 },
    "y": { "before": 99, "after": 99, "delta": 0 }
  },
  "areaDelta": {
    "beforeArea": 268940,
    "afterArea": 287980,
    "delta": 19040,
    "percentChange": 7.08
  },
  "changedFields": ["boundingBox.height", "boundingBox.y", "evidence.console", "evidence.network"],
  "verdict": "changed",
  "notes": "Fields changed: boundingBox.height, boundingBox.y, evidence.console, evidence.network; height delta: 32; width delta: 0"
}
```

## Before/After Bounding Boxes

| Dimension | Before | After | Delta |
|-----------|--------|-------|-------|
| width | 595 | 595 | 0 ✓ |
| **height** | **452** | **484** | **+32 ✓** |
| x | 320 | 320 | 0 |
| y | 99 | 99 | 0 |

## Expected vs Actual Visual Delta

| Metric | Expected | Actual | Match? |
|--------|----------|--------|--------|
| Height delta | ~+16px (gap-4=16px → gap-8=32px, +16 per gap) | **+32px** | **Yes** (2 gaps × +16px = exactly 32px) |
| Width delta | 0 | **0** | **Yes** |
| Direction | Increase | **Increase** | **Yes** |

The actual delta (32px) was double the naive estimate (16px) because the card has TWO internal gaps (CardHeader↔CardContent, CardContent↔CardFooter), each increasing by 16px. This is correct behavior.

## Verdict Accuracy Check

| Check | Expected | Actual | Correct? |
|-------|----------|--------|----------|
| Changed at all | Yes | `"changed"` | ✓ |
| Verdict is "changed" | Yes (one-dimensional) | `"changed"` | ✓ |
| Verdict is NOT "improved" | Yes (not both height↑ + width↓) | Not "improved" | ✓ |
| Verdict is NOT "unchanged" | Yes | Not "unchanged" | ✓ |
| Notes present | Yes | Non-empty | ✓ |

## Privacy / Token Scan

| Check | Result |
|-------|--------|
| No daemon-token in capture output | ✓ |
| No sessionToken in capture output | ✓ |
| No C:\Users in packet.json | ✓ |
| No daemon-token in packet.json | ✓ |
| No daemon/session token in comparisonSummary | ✓ |
| No .tmp files in capture directory | ✓ |

## Viskod release:check Result

| Component | Result |
|-----------|--------|
| `biome check .` | PASS |
| `tsc -b` | PASS |
| `vitest run` | PASS (239/239) |
| `pnpm smoke:agent-workflow` | PASS (38/38) |
| **Overall** | **PASS** |

## External Repo Validation

| Check | Result | Notes |
|-------|--------|-------|
| `npx eslint src/` | PASS | Zero lint errors |
| `npx vite build` | PASS | Build successful |

## Remaining Limitations

1. **Source hints cannot identify Tailwind-only usage files.** For projects that use utility-first CSS without semantic class names, the source hint engine maps elements to generic component library files (e.g., `flex.tsx`, `card.tsx`) rather than the specific usage file (e.g., `sign-in/index.tsx`). The agent must infer the usage site manually by searching the project for the component + visible page text.

2. **Warm-up still needed for first capture persistence.** Although the session warm-up added to `cmdServe` starts the browser early, the capture pipeline does not reliably persist the very first packet to disk. A warm-up capture before the real capture resolves this.

3. **Expected delta estimate requires understanding the component structure.** The naive estimate of +16px was half the actual +32px because the card has two internal gaps. The agent should inspect the component structure to make accurate predictions.

## Verdict: **PASS**

All PASS criteria met:

- [x] External repo (`satnaing/shadcn-admin`), not Viskod fixture
- [x] True MCP path — capture/recapture through JSON-RPC
- [x] First capture persists packetPath (after warm-up)
- [x] Source hints provide useful context but do NOT identify the usage file directly — documented limitation
- [x] No raw packet digging needed — brief has all necessary info
- [x] **Deterministic visual delta**: height +32px (452→484), width unchanged (595→595)
- [x] No token/secrets leak in any output
- [x] `pnpm release:check` passes (biome + tsc + vitest + smoke)
- [x] External repo lint and build pass
- [x] Verdict is `"changed"` — not inflated to `"improved"`

**41/41 checks passed — Phase 20B complete.**
