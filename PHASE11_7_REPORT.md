# Phase 11.7 Report: Debug and Audit Capture Profiles

**Date:** 2026-07-29

---

## Scope Implemented

- **Capture profiles** — Three named profiles: `default`, `debug`, `audit`
- **Profile configuration** — `ProfileConfig` type with per-evidence-type boolean flags, truncation limits, redaction toggle
- **default profile** — Balanced: console + screenshot + selected element + DOM + styles + hierarchy + source hints + redaction (50 console, 30 network, 2000 char limit)
- **debug profile** — Verbose: all evidence types including network (200 console, 100 network, 5000 char limit)
- **audit profile** — Forensic: console + network + selected element, no screenshots, no redaction, no source hints (500 console, 200 network, 10000 char limit)
- **Profile resolver** — `resolveProfile(name)` with safe fallback to default

## Architecture Boundary Compliance

| Rule | Status |
|---|---|
| VCE remains orchestrator | ✅ Profiles are defined in browser-runtime; VCE would consume via profile config |
| BrowserRuntime doesn't import VCE | ✅ Profile types are in browser-runtime only |
| No new product features | ✅ Profiles are configuration, not features |

## Files Changed

| File | Change |
|---|---|
| `packages/browser-runtime/src/profiles.ts` | New — profile types, definitions, resolver |
| `packages/browser-runtime/src/profiles.test.ts` | New — 6 tests for profile behavior |

## Tests Added

**6 tests** in `profiles.test.ts`:
- Default profile has balanced settings
- Debug profile has higher limits
- Audit profile disables screenshots and redaction
- `resolveProfile()` returns default for unknown names
- `resolveProfile()` returns matching profile for valid names
- All profiles define all required fields

## Validation

| Check | Result |
|---|---|
| `biome check .` | ✅ Clean |
| `tsc -b` | ✅ Clean |
| `vitest run` | ✅ 168 tests (6 new), 17 test files |
| `pnpm check` | ✅ Full suite passes |

## Experimental Limitations

- Profiles are defined but not wired into ContextEngine or CLI — consumers must pass `ProfileConfig` explicitly
- No `--profile` CLI flag yet — CLI profile passthrough requires Phase 12 wiring
- No per-capture profile override — profile is global to the capture operation
- Audit profile disables redaction → raw data exposure; consumer must handle privacy

## What Requires Phase 12 Local Validation

- CLI `--profile` flag wiring in `viskod capture` and `viskod serve`
- ContextEngine `generatePacket()` profile-aware evidence collection
- Profile override in MCP `capture` tool arguments
- Per-profile end-to-end capture verification
