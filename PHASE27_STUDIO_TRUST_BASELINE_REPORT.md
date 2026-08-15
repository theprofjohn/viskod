# PHASE 27 — Studio Trust Boundary & Green Baseline

Date: 2026-08-15
Environment: Windows 11 (win32 10.0.26200), Node v22.16.0, pnpm 9.15.0, repo `C:\Viskod`

## 1. Summary

Phase 27 established a secure, deterministic, green baseline for Viskod before larger Studio workflow changes. Six audit findings were inspected against current code; all six were confirmed and fixed with the smallest correct changes:

- **VISKOD-AUDIT-006** (Studio security boundary) — Studio now binds `127.0.0.1` explicitly, never sends `Access-Control-Allow-Origin: *`, and enforces an origin allowlist on both HTTP and WebSocket.
- **VISKOD-AUDIT-029** (Studio lifecycle) — listen errors (incl. EADDRINUSE) produce a controlled, actionable failure; `start()` resolves only when listeners are ready; SIGINT/SIGTERM run an idempotent shutdown; resources close cleanly; repeated shutdown is safe.
- **VISKOD-AUDIT-017** (E2E self-containment) — `pnpm test:e2e` now runs from a clean checkout: each test file owns and cleans up its Studio/fixture processes, readiness is a real HTTP probe, and files are sequenced to avoid fixed-port collisions.
- **VISKOD-AUDIT-018** (release:check) — the gate is green end to end (exit 0). Root causes were repo-owned: a stray untracked Vite timestamp artifact (Biome `noVar` errors), `scripts/demo.mjs` import ordering, and stale Studio readiness patterns in `scripts/demo.mjs` and `scripts/smoke-phase18-agent-workflow.mjs`.
- **VISKOD-AUDIT-010** (capture profile gating) — `getComputedStyles()` and `captureScreenshot()` are now gated *before* the browser call; disabled fields perform zero browser work.
- **VISKOD-AUDIT-012** (single-element documentOrder) — the overlay TreeWalker now enumerates elements (`SHOW_ELEMENT`), so connected elements receive valid monotonic orders instead of `-1`.

Two additional real defects found while fixing in scope were repaired: the WebSocket broadcast set never registered clients (`wsClients.add` missing — chat pushes were dead), and the dogfood dev-server harness leaked `pnpm dev`/vite process trees on Windows.

## 2. Audit findings addressed

| Finding | Confirmed | Fixed | Verification |
|---|---|---|---|
| VISKOD-AUDIT-006 — Studio binds broadly, CORS `*`, no local boundary | Yes | Yes | Unit + integration tests, real listener assertions |
| VISKOD-AUDIT-029 — port collision/startup/shutdown | Yes | Yes | Unit tests, live SIGINT/SIGTERM demo |
| VISKOD-AUDIT-017 — `pnpm test:e2e` not self-contained | Yes | Yes | Full E2E from clean state, orphan checks |
| VISKOD-AUDIT-018 — `pnpm release:check` fails | Yes | Yes | Full gate exit 0 |
| VISKOD-AUDIT-010 — disabled capture still collects | Yes | Yes | Fake-BrowserRuntime spy tests |
| VISKOD-AUDIT-012 — documentOrder always `-1` | Yes | Yes | Real-Chromium dogfood regression test |

## 3. Findings confirmed vs not reproducible

All six findings were reproduced from current source before any change; none were stale.

- 006: `apps/studio/src/index.ts` had `this.server.listen(3001, …)` (all interfaces), `res.setHeader('Access-Control-Allow-Origin', '*')` on every response, and `new WebSocketServer({ server })` with no origin validation.
- 029: no `error` handler on the listen socket (EADDRINUSE = unhandled `error` crash), `start()` returned before readiness and advertised via a callback log only, `shutdown()` called `server.close()` without awaiting and without closing the WebSocket server/clients, and no SIGINT/SIGTERM wiring existed.
- 017: `tests/e2e/chat-workflow.test.ts` had no bootstrap — it hit `http://localhost:3001` assuming a Studio was already running, while the E2E config comment claims the suite owns its dependencies; vitest's default file parallelism makes the two fixed-port files race.
- 018: `pnpm biome check .` reported 3 errors (untracked `examples/dogfood-app/vite.config.ts.timestamp-*.mjs` with `noVar`, plus `scripts/demo.mjs` import ordering); the smoke script additionally waited for the old `http://localhost:3001` log line.
- 010: `generatePacket()` called `getComputedStyles()` and `captureScreenshot()` unconditionally; `p.collectStyles`/`p.collectScreenshot` only decided whether to keep the result.
- 012: `getDocumentOrder()` used `document.createTreeWalker(document.body, 4, …)` — `4` is `SHOW_TEXT` — and compared yielded text nodes against an Element; an element never equals a text node, so every connected element returned `-1`.

## 4. Root cause per confirmed issue

1. **006** — No bind host, unconditional `*` CORS, and no origin check on the WebSocket upgrade. Design assumed localhost-only usage without enforcing it.
2. **029** — The listen promise had no error path, readiness was only a console log, `shutdown()` was a fire-and-forget close, and signal handlers were never installed. A second root cause surfaced while testing: `WebSocketServer({ server })` re-emits HTTP server errors on itself, so EADDRINUSE became an unhandled `error` on the wss instance even with an HTTP error handler.
3. **017** — chat-workflow E2E was written against a pre-started Studio; the suite-level claim of owning dependencies was only implemented in studio-flow.
4. **018** — A Vite dev-server timestamp cache file sat untracked in the repo and Biome parses it; `demo.mjs` imports were not alphabetized; two readiness matchers hard-coded `localhost:3001`.
5. **010** — Gating was applied to the *result* (`if (styleResult.ok && p.collectStyles)`) instead of the *call*.
6. **012** — Wrong TreeWalker mask (`SHOW_TEXT`) for element ordering.

## 5. Files changed

Modified:
- `apps/studio/src/index.ts` — loopback bind, origin allowlist (HTTP gate + restricted CORS + WS check), awaitable `start()` with controlled listen errors, permanent HTTP/WS error handlers, `wsClients.add` fix, idempotent `shutdown()`, entry-point detection + SIGINT/SIGTERM wiring.
- `apps/studio/src/studio.test.ts` — 10 new security/lifecycle tests (see §11).
- `packages/context-engine/src/index.ts` — style/screenshot gating at the browser-call boundary.
- `packages/context-engine/src/context-engine.test.ts` — 3 new gating tests with a spied fake BrowserRuntime.
- `packages/overlay-system/src/index.ts` — `getDocumentOrder` TreeWalker fix.
- `packages/overlay-system/src/dogfood-actual.test.ts`, `dogfood-p25.test.ts` — process-tree kill for the dev server (was plain `proc.kill()`, leaking vite on Windows).
- `tests/e2e/chat-workflow.test.ts` — self-contained Studio bootstrap + teardown.
- `tests/e2e/studio-flow.test.ts` — reuses the shared harness.
- `vitest.e2e.config.ts` — `fileParallelism: false` (deterministic fixed-port sequencing).
- `scripts/demo.mjs` — import ordering; readiness pattern accepts loopback host.
- `scripts/smoke-phase18-agent-workflow.mjs` — Studio readiness pattern accepts loopback host.
- `MEMORY.md` — Decision 017 (Studio local control boundary).

New:
- `tests/e2e/harness.ts` — shared spawn/readiness/kill helpers.
- `packages/overlay-system/src/dogfood-p27.test.ts` — documentOrder regression in real Chromium.

Deleted (untracked build artifact blocking the release gate):
- `examples/dogfood-app/vite.config.ts.timestamp-1786714336207-487d9284d4099.mjs`

## 6. Security boundary before/after

| Aspect | Before | After |
|---|---|---|
| Bind | `server.listen(3001)` — all interfaces (`::`/`0.0.0.0`), LAN-reachable | `server.listen(port, '127.0.0.1')` — loopback only; unit test asserts `address === '127.0.0.1'` and not `0.0.0.0`/`::` |
| HTTP CORS | `Access-Control-Allow-Origin: *` on every response; blanket OPTIONS 204 | Origin gate first: hostile origin → 403 JSON before routing. CORS headers only for allowed origins (`Access-Control-Allow-Origin: <origin>`, `Vary: Origin`); no-Origin local clients get no CORS headers |
| HTTP control | Any web page could POST to localhost (simple requests bypass preflight) | 403 for foreign origins (covers DNS-rebinding hosts too — checked via `new URL(origin).hostname`) |
| WebSocket | Accepted any origin, no validation | `handleWsConnection` rejects non-allowed origins with close code 1008 before registering the client |
| Allowed origins | everything | absent (non-browser local clients), loopback hosts (`localhost`, `127.0.0.1`, `::1`/`[::1]`), `chrome-extension://` (sidepanel/background) |
| Legit flows | — | Studio UI (loopback), extension content scripts (manifest restricts to loopback pages), tests/CLI/demo/smoke (no Origin) all verified passing |
| Daemon security | unchanged | unchanged — runtime-session token model untouched |

## 7. Studio lifecycle behavior before/after

| Behavior | Before | After |
|---|---|---|
| Port collision | unhandled `error` crash, browser left running | `start()` returns `err` with code `STUDIO_PORT_IN_USE` and message "Port 3001 is already in use…"; browser + sockets released; entry prints actionable message and exits 1 |
| Startup advertising | log emitted from the listen callback; `start()` promise resolved before listening | `start()` resolves only after the `listening` event; actual bound port logged (`Viskod Studio running on http://127.0.0.1:3001`); tests fetch `/health` immediately after `await start()` |
| Listen errors (general) | none handled | permanent `error` handlers on the HTTP server and the WebSocketServer (which re-emits server errors on itself) |
| SIGINT/SIGTERM | none | entry installs `process.once('SIGINT'|'SIGTERM')` → idempotent `shutdown()` → `process.exit(0)`; verified live on Windows (clean exit, port released) |
| Shutdown | `server.close()` fire-and-forget; wss/clients left open; double-close unsafe | idempotent: WS clients closed (1001), wss closed, HTTP closed (tolerates not-running), selection mode exited, browser stopped; repeated calls are no-ops; unit test calls it 3× and re-binds the port |
| Entry imports | `void studio.start()` ran on import (tests launched a browser + bound 3001 per worker) | entry bootstrap gated on `isEntryPoint` (argv[1] check); tests import the class without side effects |

## 8. E2E orchestration changes

- New `tests/e2e/harness.ts`: `startStudio()` / `startFixture()` spawn the processes, wait on real `/health`/HTTP probes (no fixed sleeps), and `killTree()` uses `taskkill /T /F` on Windows / SIGTERM elsewhere so no process tree survives.
- `chat-workflow.test.ts` now owns its Studio (`beforeAll` start, `afterAll` tree-kill) — the audit's missing piece.
- `studio-flow.test.ts` reuses the harness (same behavior, less duplication).
- `vitest.e2e.config.ts` sets `fileParallelism: false`: both files own fixed ports 3000/3001, so sequential deterministic execution is the contract (documented in the config).
- No tests were weakened or removed; chat-workflow's six tests are unchanged in meaning.
- Result: `pnpm test:e2e` passes from a clean checkout; after the run, ports 3000/3001 are free and zero node processes remain.

## 9. Capture-profile gating proof

`generatePacket()` (selection path) before:

```ts
const styleResult = await this.browserRuntime.getComputedStyles(handle, selection.selector);
if (styleResult.ok && p.collectStyles) styleSnapshot = styleResult.value;
const captureResult = await this.browserRuntime.captureScreenshot(handle, 'selection');
if (captureResult.ok && p.collectScreenshot) captureScreenshot = captureResult.value;
```

After — the profile check wraps the browser call itself:

```ts
if (p.collectStyles) {
  const styleResult = await this.browserRuntime.getComputedStyles(handle, selection.selector);
  if (styleResult.ok) styleSnapshot = styleResult.value;
}
if (p.collectScreenshot) {
  const captureResult = await this.browserRuntime.captureScreenshot(handle, 'selection');
  if (captureResult.ok) captureScreenshot = captureResult.value;
}
```

Proof (new tests in `packages/context-engine/src/context-engine.test.ts`, spied fake BrowserRuntime):
- `collectStyles: false, collectScreenshot: false` → `getComputedStyles` and `captureScreenshot` **not called at all**; `getDOMSnapshot`/`captureConsoleLogs` still called once; packet has `styles.computed === {}` and `screenshots === []`.
- default profile → both called exactly once; packet carries the style and screenshot.
- `PROFILES.audit` → screenshot not called, styles called.

## 10. Document-order proof

Fix in `packages/overlay-system/src/index.ts`: `document.createTreeWalker(document.body, 1, …)` — mask `1` = `SHOW_ELEMENT` (was `4` = `SHOW_TEXT`).

New regression test (`dogfood-p27.test.ts`) runs the real overlay script in headless Chromium with three siblings (`s1`, `s2`, `s3`) plus a nested descendant (`n2` inside `s2`). Each element is clicked through the real selection overlay and its `documentOrder` read from the overlay bridge:

- all orders `>= 0` (no `-1`);
- strictly increasing in document order: `s1 < s2 < n2 < s3`.

Meaning elsewhere unchanged: `documentOrder` still means "index among elements under `<body>` in document order"; `includeDocumentOrder === false` still yields `-1` (hover path); the stable-selector/selection-key logic is untouched.

## 11. Tests added/changed

- `apps/studio/src/studio.test.ts` (+10):
  - `isAllowedStudioOrigin` allowlist/denylist table (loopback, extension, absent, evil/LAN/rebinding/malformed).
  - Hostile HTTP origin → 403, no ACAO header; no-Origin request → no ACAO; loopback origin → echoed ACAO.
  - Hostile OPTIONS preflight → 403.
  - Real listener binds `127.0.0.1` only (not `0.0.0.0`/`::`).
  - Loopback `/health` works over the real listener.
  - WebSocket: hostile origin → close 1008, no message; loopback and no-origin clients → receive `studio:state`.
  - EADDRINUSE → controlled `STUDIO_PORT_IN_USE` error + browser released (`stopBrowser` called).
  - Readiness: `/health` responds immediately after `await start()`.
  - Shutdown idempotent (3 calls, single `stopBrowser`, port reusable).
- `packages/context-engine/src/context-engine.test.ts` (+3): gating tests from §9.
- `packages/overlay-system/src/dogfood-p27.test.ts` (new): §10 regression.
- `tests/e2e/chat-workflow.test.ts`: bootstrap/teardown added (tests unchanged).
- `tests/e2e/studio-flow.test.ts`: harness reuse (tests unchanged).

## 12. Exact validation commands and results

All executed in this environment; no failures attributed to Viskod.

| Command | Result |
|---|---|
| `pnpm typecheck` (`tsc -b`) | PASS |
| `pnpm biome check .` | PASS (0 errors; 119 pre-existing warnings in untouched test files — not gate failures) |
| `pnpm test:ci` | PASS — 40 files, 755 tests |
| `pnpm test:e2e` | PASS — 2 files, 10 tests, from clean state |
| `pnpm test:dogfood` | PASS — 7 files, 126 tests |
| `pnpm smoke:agent-workflow` | PASS — 26/26 |
| `pnpm build:cli && node scripts/verify-cli-artifact.mjs` | PASS — artifact verified |
| `pnpm release:check` (biome + tsc + test:ci + dogfood + smoke + build/verify) | **PASS — exit 0** |
| Focused: `vitest run apps/studio/src/studio.test.ts` | 22/22 |
| Focused: `vitest run packages/context-engine/src/context-engine.test.ts` | 13/13 |
| Focused: `vitest run packages/overlay-system/src/overlay-system.test.ts` | 28/28 |
| Focused: dogfood-p27 (documentOrder) | 1/1 |
| Live SIGINT / SIGTERM on `apps/studio/src/index.ts` | clean exit, port 3001 released both times |
| `node scripts/demo.mjs` boot | fixture + Studio reach ready; SIGINT cleanup frees ports |
| Orphan check after E2E/dogfood/release runs | ports 3000/3001/5173 free; zero `node.exe` processes |

## 13. Regression results

- Visual overlay selection / box selection / click suppression / Escape / multi-select: full dogfood suite (126 tests across p22–p27, real Chromium) passes; overlay unit tests (28) pass.
- Studio workflow APIs (report → handoff → verify → decision): studio-flow E2E (4) + chat E2E (6) + smoke 26/26 pass; `workflow.test.ts`/`ui.test.ts` pass under test:ci.
- MCP tools, `viskod_capture_context`, recapture flow: smoke 26/26 (tools/list, capture_context, capture ok, no token leaks) + studio-flow E2E recapture with reload/cache-bust.
- VisualIssue/Handoff/Review persistence: workflow unit tests + dogfood p23/p24/p25 + setup suite under test:ci.
- Setup subsystem: test:ci setup tests + dogfood p26 (DF26-01…20) pass.
- CLI packaging: `build:cli` + `verify-cli-artifact` pass; bundled CLI unchanged.
- Daemon security (`runtime-session`): untouched; its tests pass under test:ci.
- Existing tests changed only where they asserted the old behavior contract: none — chat/studio-flow test bodies are unchanged; only bootstrap/helpers moved.

## 14. Known limitations

- The origin allowlist treats "no Origin" (non-browser local clients) as trusted; a malicious *local* process can still talk to Studio. That is the accepted local-tool model (documented in MEMORY.md Decision 017); the boundary defends remote pages, LAN hosts, and DNS rebinding.
- The Chrome extension sidepanel/background rely on `chrome-extension://` and the content script on loopback page origins; the server-side policy matches the extension's manifest restrictions, but the extension itself was not rebuilt/retested in this phase (no extension code changed).
- `Access-Control-Allow-Origin` is echoed per allowed origin; strict CORS consumers (no credentials flow) are unaffected — Studio uses no cookies.
- The dogfood dev-server leak fix covers `dogfood-actual` and `dogfood-p25` (the only files that spawn the fixture dev server); other dogfood files were inspected and do not spawn processes.
- Windows signal semantics: real Ctrl+C/SIGTERM delivery was verified via the console; `child.kill('SIGINT')` from Node on Windows force-terminates rather than delivering a signal (platform behavior, not a Viskod defect).

## 15. Deferred findings explicitly NOT addressed (Phase 28+ scope)

Per the Phase 27 non-goals, the following were not implemented or changed:
- Studio create-issue → handoff workflow changes; compact handoff packet retrieval
- Source hint redesign; Studio SourceHintEngine composition
- Screenshot redaction architecture; visual pixel-diff review
- Monorepo discovery; keyboard target navigation; issue-history UI
- Studio architecture decomposition; plugin/permissions/audit/workspace deletion
- Shadow DOM/iframe redesign
- Documentation rewrite beyond text directly invalidated by Phase 27 behavior (one MEMORY.md decision entry added, which AGENTS.md requires for durable architectural choices)

Pre-existing Biome warnings (`noNonNullAssertion` in older test files) remain — they do not fail the gate and were left untouched per the objective's no-cosmetic-rewrite rule.

## 16. Final verdict

**PASS**

Every confirmed Phase 27 defect is fixed with verification:
- Studio loopback-bound (tested), permissive cross-origin control removed (tested), WS origin validated (tested), legitimate local UI/extension/test flows working (E2E + smoke + unit).
- Port collision controlled (tested), shutdown wired and idempotent (unit + live SIGINT/SIGTERM), startup advertised only when ready (tested).
- `pnpm test:e2e` self-contained and clean (tested from clean state; no orphan ports/processes).
- Disabled capture fields execute no browser collection (spy-tested).
- `documentOrder` regression fixed (real-Chromium tested).
- `pnpm release:check` exits 0 in this environment (full gate run).
- No meaningful existing functionality regressed (full suites + smoke + packaging all green).
