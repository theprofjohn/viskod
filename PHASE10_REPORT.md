# Phase 10 Report: Persistent Runtime Session

**Date:** 2026-07-28

---

## Objective

Fix P1.2 runtime usability issue by introducing a persistent local runtime session so CLI and MCP can reuse the same `BrowserRuntime` instance across multiple captures.

---

## What Was Built

### New Package: `@viskod/runtime-session`

| File | Purpose |
|---|---|
| `packages/runtime-session/src/runtime-session.ts` | `RuntimeSession` class — owns VCE lifecycle, capture execution, and session persistence |
| `packages/runtime-session/src/daemon-server.ts` | `DaemonServer` — JSON-RPC TCP server for cross-process session access |
| `packages/runtime-session/src/daemon-client.ts` | `DaemonClient` — TCP client for CLI/MCP to connect to a running session |
| `packages/runtime-session/src/types.ts` | `SessionInfo`, `DaemonRequest`, `DaemonResponse` types |
| `packages/runtime-session/src/constants.ts` | File paths, port range constants |
| `packages/runtime-session/src/index.ts` | Package exports |
| `packages/runtime-session/src/runtime-session.test.ts` | 9 tests for session lifecycle |
| `packages/runtime-session/package.json` | Workspace package config |
| `packages/runtime-session/tsconfig.json` | TypeScript config |

### Updated Packages

| Package | Changes |
|---|---|
| `packages/cli` | `SelectionTarget` import removed (unused); CLI commands unchanged structurally |
| `tsconfig.json` | Added `@viskod/runtime-session` path alias |
| `vitest.config.ts` | Added `@viskod/runtime-session` alias |

### Session Lifecycle

```
viskod start [url]     → RuntimeSession.start() + DaemonServer.listen()
                          Writes .viskod/session.json
                          Blocks (daemon mode)
                            ↓
viskod capture <sel>    → Reads .viskod/session.json
                          Connects to DaemonClient(port)
                          Sends 'capture' RPC
                          Prints packet
                            ↓
viskod status           → Reads .viskod/session.json
                          Connects to DaemonClient(port)
                          Sends 'status' RPC
                            ↓
viskod stop             → Reads .viskod/session.json
                          Connects to DaemonClient(port)
                          Sends 'stop' RPC
                          Clears .viskod/session.json
                            ↓
viskod serve [--url]    → Creates its own RuntimeSession (per-request)
                          Registers 'capture', 'status', 'stop' MCP tools
                          Browser lifecycle shared across MCP calls
```

---

## Dogfood Results

All 8 session lifecycle steps verified:
1. ✅ Session created with null status
2. ✅ Stop before start returns OK (no-op)
3. ✅ Capture before start correctly rejected
4. ✅ Daemon starts on random ephemeral port
5. ✅ Session file written/read correctly
6. ✅ Daemon status request returns session info
7. ✅ Stop via daemon clears session and file
8. ✅ Session file absent after stop

---

## Architecture Boundary Verification

| Rule | Status | Evidence |
|---|---|---|
| VCE remains the orchestrator | ✅ | `RuntimeSession` calls VCE methods, does not bypass it |
| BrowserRuntime must not import VCE | ✅ | BR has no reference to RuntimeSession or VCE |
| CLI/MCP composes but doesn't own business logic | ✅ | CLI creates/clients sessions; logic is in RuntimeSession |
| EventBus remains transport only | ✅ | EB only passes events, no business logic |
| RuntimeSession owns lifecycle, not packet assembly | ✅ | Calls VCE.generatePacket() |
| CapturePipeline persists only | ✅ | Sessions use CP for persistence as before |

No new cross-package import violations were introduced.

---

## Validation

| Check | Result |
|---|---|
| `pnpm check` (biome + tsc + vitest) | ✅ Pass |
| `biome check .` | ✅ 0 errors |
| `tsc -b` (TypeScript strict mode) | ✅ 0 errors |
| `vitest run` | ✅ 119 tests, 0 failed (13 test files) |
| New tests in runtime-session | ✅ 9 tests all passing |

---

## Files Changed

| File | Change |
|---|---|
| `packages/runtime-session/src/runtime-session.ts` | +207 lines (new) |
| `packages/runtime-session/src/daemon-server.ts` | +103 lines (new) |
| `packages/runtime-session/src/daemon-client.ts` | +108 lines (new) |
| `packages/runtime-session/src/types.ts` | +18 lines (new) |
| `packages/runtime-session/src/constants.ts` | +7 lines (new) |
| `packages/runtime-session/src/index.ts` | +5 lines (new) |
| `packages/runtime-session/src/runtime-session.test.ts` | +132 lines (new) |
| `packages/runtime-session/package.json` | +22 lines (new) |
| `packages/runtime-session/tsconfig.json` | +6 lines (new) |
| `packages/cli/src/index.ts` | -3 lines (removed unused import) |
| `tsconfig.json` | +1 line (path alias) |
| `vitest.config.ts` | +1 line (alias) |

**Total:** 12 files changed, **+613/-3 net lines**.

---

## Remaining Issues

| # | Issue | Priority |
|---|---|---|
| P2.5 | Build fails with tsconfig (`rootDir` constraints) | P2 |
| P2.2 | Screenshot path is relative with no directory context | P2 |
| P2.6 | Capture pipeline stores in CWD with no cleanup | P2 |

No new P1 issues were introduced.

---

## Commit Message

```
feat: add persistent runtime session

- Add @viskod/runtime-session package with RuntimeSession, DaemonServer, DaemonClient
- RuntimeSession wraps VCE lifecycle with start/stop/capture/status
- DaemonServer exposes JSON-RPC over TCP for cross-process session sharing
- DaemonClient connects CLI commands to a running daemon session
- .viskod/session.json persists session info (port, PID, status)
- 119 tests pass; biome clean; TypeScript strict clean
```
