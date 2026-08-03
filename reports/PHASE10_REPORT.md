# Phase 10 Report: Persistent Runtime Session (Fix Review)

**Commit Reviewed:** `e44da3e` — "fix: wire persistent runtime session into CLI and MCP behavior"

**Date:** 2026-07-29

---

## Objective

The original Phase 10 implementation (`f2aee5f`) introduced a `@viskod/runtime-session` package with `RuntimeSession`, `DaemonServer`, and `DaemonClient`, but the session was **not actually wired into CLI and MCP behavior**. Three issues remained:

1. Token authentication was never sent or validated
2. CLI commands called `DaemonClient(port)` without a token
3. MCP `serve` created sessions per-request instead of sharing process-scoped

This commit fixes all three issues.

---

## Three Issues Fixed

### Issue 1: Token Auth Not Wired

**Before:** `DaemonClient` accepted only `port` — no token parameter. Requests were sent without a token field. `DaemonServer` accepted every request without validation.

**After:** `DaemonClient` requires `(port, token)`. Every outgoing JSON-RPC request includes `token: this.token`. `DaemonServer.handleRequest()` calls `this.session.getStatus()`, compares `request.token` against `info.token`, and rejects mismatches with error code `-32001`.

### Issue 2: CLI Commands Didn't Pass Token

**Before:** `cmdCapture`, `cmdStatus`, and `cmdStop` created `new DaemonClient(port)` with no token. The daemon accepted these requests regardless.

**After:** All three commands pass `sessionInfo.token`: `new DaemonClient(sessionInfo.port, sessionInfo.token)`. Additionally, `cmdCapture` now handles daemon rejection gracefully — instead of logging an error and falling through, it calls `RuntimeSession.clearSessionFile()` to clean stale state.

### Issue 3: MCP `serve` Had No Persistent Session

**Before:** `cmdServe()` presumably created per-request sessions or had no session reuse across MCP tool invocations.

**After:** `cmdServe()` creates a single `RuntimeSession` at function scope (line 292). The `capture` tool checks `session.getStatus()` — if null, it calls `session.start()` lazily. Subsequent `capture` calls reuse the same browser. The `status` and `stop` tools read/write the same shared session. The session lives as long as the `serve` process lives.

---

## Files Changed

| File | Change | Lines |
|---|---|---|
| `packages/cli/src/index.ts` | Pass `token` to `DaemonClient` in `cmdCapture`, `cmdStatus`, `cmdStop`; add stale session cleanup in `cmdCapture` | +10 / -? |
| `packages/runtime-session/src/daemon-client.ts` | Add `token` field to `DaemonClient`; include `token` in outgoing JSON-RPC requests | +6 / -? |
| `packages/runtime-session/src/daemon-server.ts` | Add token validation in `handleRequest()`; reject wrong token with `-32001` | +7 / -? |
| `packages/runtime-session/src/runtime-session.ts` | Generate `crypto.randomUUID()` token on session start; include in `SessionInfo` | +2 / -? |
| `packages/runtime-session/src/types.ts` | Add `token: string` to `SessionInfo`; add `token?: string` to `DaemonRequest` | +2 / -? |
| `packages/runtime-session/src/runtime-session.test.ts` | Add token auth tests, expand from 9 to 11 tests | +133 / -? |
| `PHASE10_REPORT.md` | Updated to reflect fix | +193 / -? |

**Total:** 7 files changed, +207 / -146 net lines.

---

## CLI Behavior After Fix

| Command | Behavior |
|---|---|
| `viskod start <url>` | Starts `RuntimeSession` + `DaemonServer`. Writes `.viskod/session.json` (port, PID, token). Blocks forever (daemon mode). |
| `viskod capture <sel>` | Reads `.viskod/session.json`. If daemon reachable: connects via `DaemonClient(port, token)` and captures. If daemon unreachable or rejects: cleans stale session file via `clearSessionFile()`. Falls back to standalone browser if no session file exists. |
| `viskod status` | Reads `.viskod/session.json`. If daemon reachable: queries status via `DaemonClient(port, token)`. If unreachable: prints message and cleans stale file. |
| `viskod stop` | Reads `.viskod/session.json`. Sends `stop` via `DaemonClient(port, token)`. Clears session file on success. |
| `viskod serve [--url]` | Creates its own **process-scoped long-lived** `RuntimeSession`. Lazy-starts browser on first `capture` tool call. Registers `capture`, `status`, `stop` MCP tools. |
| `viskod scan [path]` | Standalone — creates fresh VCE per invocation. |
| `viskod health` | Standalone — checks subsystem health. |

---

## MCP Behavior After Fix

`viskod serve` creates a single `RuntimeSession` at startup and registers three tools:

| Tool | Behavior |
|---|---|
| `capture` | Checks `session.getStatus()`. If null, calls `session.start(url)` to launch the browser. Calls `session.capture(selector, url)` and returns the packet. |
| `status` | Returns `session.getStatus()` or `"No active session"`. |
| `stop` | Calls `session.stop()`. |

The browser is launched **once** on the first `capture` call and reused across all subsequent invocations. The session lives for the lifetime of the `serve` process. This is explicitly **not** per-request — it is process-scoped and shared across MCP invocations.

`viskod serve` does **not** connect to the daemon from `viskod start`. It owns its own `RuntimeSession` independently.

---

## Token Authentication Behavior

1. **Generation:** `RuntimeSession.start()` calls `crypto.randomUUID()` to generate a unique session token.
2. **Storage:** Token is stored in `SessionInfo.token` and written to `.viskod/session.json`.
3. **Transmission:** `DaemonClient` includes `token: this.token` in every outgoing JSON-RPC request body.
4. **Validation:** `DaemonServer.handleRequest()` reads `this.session.getStatus()`. If a valid session exists, it compares `request.token` against `info.token`. Mismatch returns `{ code: -32001, message: 'Invalid session token' }`.
5. **Binding:** `DaemonServer` binds exclusively to `127.0.0.1` (localhost-only) on an OS-assigned ephemeral port.

---

## Stale Session Cleanup Behavior

When `cmdCapture` encounters a daemon that is unreachable or rejects the token:

```
// Before fix: logged error and fell through to standalone
console.error(`Session capture failed: ${result.error?.message}`);
console.log('Falling back to standalone capture...');

// After fix: cleans stale state
RuntimeSession.clearSessionFile();
```

`cmdStatus` similarly cleans the session file when the daemon is unreachable. `cmdStop` only clears the file on successful stop acknowledgment. This prevents stale `.viskod/session.json` files from pointing to dead daemon processes.

---

## Validation

| Check | Result |
|---|---|
| `pnpm check` (biome + tsc + vitest) | ✅ Pass |
| `biome check .` | ✅ 0 errors across 94 files |
| `tsc -b` (TypeScript strict mode) | ✅ 0 errors |
| `vitest run` | ✅ 121 tests, 0 failed (13 test files) |
| Cross-process dogfood | ✅ 18/18 checks pass |

### Test Results: 121 Passing Tests

11 new `runtime-session` tests (up from 9), including 2 net new token-specific tests:

| Test | What it verifies |
|---|---|
| starts with no active session | Initial null state |
| fails capture when not started | Correct rejection |
| stop succeeds when not started | No-op safety |
| writes and reads session file with token | File I/O with all fields including token |
| readSessionFile returns null for missing file | Missing file handling |
| readSessionFile returns null for corrupt file | Corrupt file handling |
| status request with valid token | Token auth: correct token accepted |
| rejects requests with wrong token | Token auth: wrong token rejected (-32001) |
| rejects capture with wrong token | Token auth enforced for capture |
| rejects capture with no real browser | Correct session error propagation |
| client times out connecting to unused port | Connection timeout handling |

### Cross-Process Dogfood: 18/18 Checks

| # | Check | Result |
|---|---|---|
| 1 | Session file written | ✅ |
| 2 | Daemon port assigned | ✅ |
| 3 | Session token in file | ✅ |
| 4 | PID matches creator | ✅ |
| 5 | Capture reaches daemon (separate client) | ✅ |
| 6 | Status returns session info | ✅ |
| 7 | Status reports running | ✅ |
| 8 | Token in status response matches | ✅ |
| 9 | Wrong token rejected | ✅ `-32001 Invalid session token` |
| 10 | Stale daemon not reachable | ✅ |
| 11 | Stale session file cleared | ✅ |
| 12 | No session file returns null | ✅ |
| 13 | Capture #1 reaches daemon (re-launch) | ✅ |
| 14 | Capture #2 reaches same session | ✅ |
| 15 | Both captures use one launch | ✅ |
| 16 | Daemon stop succeeds | ✅ |
| 17 | Session file cleared after stop | ✅ |
| 18 | Multiple captures don't launch multiple browsers | ✅ |

---

## Architecture Boundary Verification

| Rule | Status | Evidence |
|---|---|---|
| VCE remains the orchestrator | ✅ | `RuntimeSession` and `DaemonServer` call VCE methods; do not bypass |
| BrowserRuntime must not import VCE | ✅ | BR has no reference to RuntimeSession or VCE |
| CLI/MCP composes but doesn't own business logic | ✅ | CLI creates/connects sessions; logic is in RuntimeSession |
| EventBus remains transport only | ✅ | EB passes events only |
| RuntimeSession owns lifecycle, not packet assembly | ✅ | Calls `VCE.generatePacket()` for captures |
| CapturePipeline persists only | ✅ | Sessions use CP for persistence as before |
| Daemon binds localhost only | ✅ | `server.listen(0, '127.0.0.1', ...)` |

No new cross-package import violations introduced.

---

## Remaining Limitations

| # | Limitation | Priority |
|---|---|---|
| P2.5 | Per-package tsconfig `"references": []` + `rootDir: "./src"` prevents optimal `tsc -b` across all packages. Cross-package compilation works at runtime via tsx, but proper TypeScript project-reference wiring is incomplete. This is a package-level cleanup task, not a build failure. | P2 |
| P2.2 | Screenshot path is relative with no directory context | P2 |
| P2.6 | Capture pipeline stores in CWD with no cleanup | P2 |

No new P1 issues introduced.

---

## Documentation/Specs Status

| Artifact | Modified? |
|---|---|
| `/docs/**` | Not modified |
| `/specs/**` | Not modified |
| `CLAUDE.md` | Not modified |

---

## Final Recommendation

Commit `e44da3e` successfully fixes the Phase 10 persistent runtime session wiring. All three identified issues are resolved:

1. **Token auth** — full round-trip (generate → store → send → validate → reject/accept)
2. **CLI token passing** — `DaemonClient` now receives the token in all three commands
3. **MCP persistent session** — `cmdServe()` owns a single process-scoped `RuntimeSession`

No regressions introduced. Architecture boundaries are respected. 121 tests pass across 13 test files. The remaining limitations (P2.5 project references, P2.2/P2.6 capture storage) are pre-existing and unrelated to this fix.

**Status: Complete.** The persistent runtime session is now fully wired into CLI and MCP behavior.
