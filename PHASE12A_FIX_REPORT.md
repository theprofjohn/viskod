# Phase 12A Fix Report: Persist runtime evidence and align profile storage behavior

**Date:** 2026-07-28

---

## Blockers Fixed

| # | Blocker | Root Cause | Fix |
|---|---|---|---|
| 1 | runtimeEvidence missing from persisted captures | `CapturePipeline.persistCapture()` only stored screenshots and metadata.json — the full `ContextPacket` (including `runtimeEvidence`) was never written to disk. | Added `packetJson?: string` param to `persistCapture`. VCE now passes `JSON.stringify(packet)` on every capture. Written as `packet.json` alongside `metadata.json`. |
| 2 | audit profile wrote `selection.png` despite `screenshots: 0` | VCE always called `persistCapture` with 1 screenshot regardless of profile. The pipeline required ≥1 screenshot. | Made `screenshots[]` optional — 0-length array accepted. VCE passes empty array when `collectScreenshot` is false. Only `packet.json` is written for audit captures. |
| 3 | `metadata.json.tmp` left behind | Atomic write (`writeFileSync` + `renameSync`) had no safety cleanup for rare partial-write scenarios. | Added `cleanup()` pass to remove stray `.tmp` files before recursive directory removal. Added post-rename safety `rmSync` for leftover `.tmp`. |
| 4 | No `pnpm cli` / `pnpm viskod` script | Root `package.json` had no script wrapping the CLI entry point. | Added `"viskod": "tsx packages/cli/src/index.ts"` script. Users now run `pnpm viskod capture ".foo"` instead of `pnpm dlx tsx packages/cli/src/index.ts capture ".foo"`. |

---

## Files Changed

| File | Change |
|---|---|
| `package.json` | Added `"viskod": "tsx packages/cli/src/index.ts"` script |
| `packages/capture-pipeline/src/index.ts` | `persistCapture()` accepts `packetJson`; writes `packet.json`; allows 0 screenshots; added `.tmp` safety cleanup; `StoredCapture.packetFilePath` |
| `packages/context-engine/src/index.ts` | `generatePacket()` always calls `persistCapture` (even without screenshot); passes `packetJson`; only includes screenshots when `captureScreenshot` exists |
| `packages/capture-pipeline/src/capture-pipeline.test.ts` | Added 3 new tests: `packet.json` persistence, zero-screenshots (audit), no `.tmp` files |

---

## Before/After: Capture Directory Evidence

### Before (debug profile capture)
```
.viskod/captures/{uuid}/
  metadata.json          # screenshots + basic metadata only
  selection.png          # screenshot file
```
`runtimeEvidence.console` and `runtimeEvidence.network` were present in the returned `ContextPacket` object but **never persisted to disk**. The `CLI` only printed a summary — the full packet was lost after the process exited.

### After (debug profile capture)
```
.viskod/captures/{uuid}/
  packet.json            # FULL ContextPacket including runtimeEvidence
  metadata.json          # screenshots + basic metadata (backward compatible)
  selection.png          # screenshot file (only when collectScreenshot=true)
```

### After (audit profile capture)
```
.viskod/captures/{uuid}/
  packet.json            # FULL ContextPacket including runtimeEvidence
  metadata.json          # screenshots=[], screenshotCount=0
```
No `selection.png` written — `screenshotsForPersist` is empty array.

---

## Profile Storage Behavior

| Profile | packet.json | metadata.json | selection.png | network evidence |
|---|---|---|---|---|
| default | ✅ full packet | ✅ | ✅ | ❌ not collected |
| debug | ✅ full packet | ✅ | ✅ | ✅ collected + redacted |
| audit | ✅ full packet | ✅ | ❌ 0 screenshots | ✅ collected + redacted |

All profiles: redaction enabled, no `.tmp` files after successful persist.

---

## Tests Added

| Test | File | What it verifies |
|---|---|---|
| persists `packet.json` when `packetJson` provided | `capture-pipeline.test.ts` | Full ContextPacket written to disk |
| allows zero screenshots (audit profile) | `capture-pipeline.test.ts` | `screenshotCount: 0`, no screenshot file |
| no `.tmp` files remain after successful persist | `capture-pipeline.test.ts` | `entries.filter(e => e.endsWith('.tmp')).length === 0` |

**Total: 175 tests** (up from 172; 3 new)

---

## Validation

| Check | Result |
|---|---|
| `pnpm check` (biome + tsc + vitest) | ✅ Pass |
| `biome check .` | ✅ 0 errors across 101 files |
| `tsc -b` (TypeScript strict) | ✅ 0 errors |
| `vitest run` | ✅ **175 tests**, 0 failed (17 test files) |

---

## Local CLI Script

```bash
# Before:
pnpm dlx tsx packages/cli/src/index.ts capture ".foo"

# After:
pnpm viskod capture ".foo"
pnpm viskod help
pnpm viskod status
pnpm viskod start http://localhost:5173
```

---

## Documentation/Specs

- `/docs` — not modified
- `/specs` — not modified
