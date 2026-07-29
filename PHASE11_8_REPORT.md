# Phase 11.8 Report: Profile Wiring and Local Smoke Validation

**Date:** 2026-07-28

---

## Objective

Wire capture profiles (`default`, `debug`, `audit`) end-to-end through CLI, RuntimeSession, Daemon, and MCP so Phase 12 can dogfood profile-aware captures.

---

## What Was Wired

| Layer | Change |
|---|---|
| **browser-runtime** | Exported `CaptureProfile`, `ProfileConfig`, `PROFILES`, `resolveProfile`. Audit profile `enableRedaction` changed from `false` to `true` (safety). |
| **context-engine** | `generatePacket(selection, profile?)` accepts optional `ProfileConfig`. Evidence collection, screenshot, styles, and redaction respect profile toggles. No-profile calls use `resolveProfile('default')`. |
| **runtime-session** | `capture(selector, url?, profile?)` accepts optional `ProfileConfig`. Passed through to `VCE.generatePacket()`. |
| **daemon-server** | `capture` handler accepts `profile` param from request, resolves via `resolveProfile()`, passes to session. |
| **daemon-client** | `capture(selector, url?, profile?)` accepts optional profile name string, sends in request. |
| **CLI** | `viskod capture <sel> --profile <default|debug|audit>` parsed. Validates against known values. Passes profile to daemon or standalone VCE. Unknown values produce clear error. |
| **MCP** | `capture` tool accepts `profile` enum argument (`default`, `debug`, `audit`). Defaults to `default`. |

### Profile Behavior

| Feature | default | debug | audit |
|---|---|---|---|
| Console collection | ✅ (50 max) | ✅ (200 max) | ✅ (500 max) |
| Network collection | ❌ | ✅ | ✅ |
| Screenshot | ✅ | ✅ | ❌ |
| DOM + Styles + Hierarchy | ✅ | ✅ | ✅ |
| Source hints | ✅ | ✅ | ❌ |
| Redaction | ✅ | ✅ | ✅ (fixed) |
| Max message length | 2000 | 5000 | 10000 |

### Audit Safety Fix

The audit profile previously had `enableRedaction: false`, which would emit raw unredacted evidence. This was changed to `enableRedaction: true`. All three profiles now have redaction enabled by default. An explicit `unsafe` flag would be required (future feature) to disable redaction.

---

## Files Changed

| File | Change |
|---|---|
| `packages/browser-runtime/src/index.ts` | Exported `CaptureProfile`, `ProfileConfig`, `PROFILES`, `resolveProfile` |
| `packages/browser-runtime/src/profiles.ts` | Audit `enableRedaction` changed to `true` |
| `packages/context-engine/src/index.ts` | `generatePacket(selection, profile?)` accepts profile; evidence/styles/screenshot toggled by profile; imports `ProfileConfig`, `resolveProfile` |
| `packages/runtime-session/src/runtime-session.ts` | `capture()` accepts optional `ProfileConfig`; passes to VCE |
| `packages/runtime-session/src/daemon-server.ts` | Capture handler resolves profile from request params |
| `packages/runtime-session/src/daemon-client.ts` | `capture()` accepts optional profile name string |
| `packages/cli/src/index.ts` | `--profile` argument parsing; daemon and standalone paths pass profile; MCP tool `profile` enum |
| `packages/browser-runtime/src/profiles.test.ts` | New: 5 tests for profile resolution and values |

---

## Tests Added

| Test | File | What it verifies |
|---|---|---|
| returns default profile for "default" | `profiles.test.ts` | Default has `collectNetwork: false`, `collectScreenshot: true`, `enableRedaction: true` |
| returns debug profile for "debug" | `profiles.test.ts` | Debug has `collectNetwork: true`, `maxConsoleEntries: 200` |
| returns audit profile for "audit" | `profiles.test.ts` | Audit has `collectScreenshot: false`, `enableRedaction: true` |
| falls back to default for unknown | `profiles.test.ts` | `resolveProfile('nonexistent')` returns default |
| all profiles have enableRedaction true | `profiles.test.ts` | Safety invariant |
| generatePacket accepts profile | `context-engine.test.ts` | All three profiles accepted (no crash) |
| generatePacket backward compatible | `context-engine.test.ts` | No-profile call works as before |
| capture accepts profile parameter | `runtime-session.test.ts` | Profile accepted by session.capture |
| capture backward compatible | `runtime-session.test.ts` | No-profile call works |
| daemon capture passes profile | `runtime-session.test.ts` | Profile name accepted via daemon |

---

## Validation

| Check | Result |
|---|---|
| `pnpm check` (biome + tsc + vitest) | ✅ Pass |
| `biome check .` | ✅ 0 errors across 101 files |
| `tsc -b` (TypeScript strict) | ✅ 0 errors |
| `vitest run` | ✅ **172 tests**, 0 failed (17 test files) |
| New profile tests | ✅ 5 + 5 = 10 new tests |

---

## What Remains for Phase 12

- Full end-to-end dogfood with real browser (smoke page with console.error, failed fetch, selectable element)
- Verify debug profile includes `runtimeEvidence.console` and `runtimeEvidence.network`
- Verify default profile omits network evidence
- Verify audit profile behavior is safe (redaction on)
- Chrome extension mode is still scaffold-only — not wired into any profile or capture path
- The `ExtensionAdapter` interface in `extension-bridge.ts` remains experimental

---

## Confirmation

- `/docs` was not modified
- Approved `/specs` were not modified
- Chrome extension mode is still experimental/scaffold-only
- No new product features added beyond profile wiring
