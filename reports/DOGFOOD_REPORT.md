# Viskod Dogfooding Report

**Date:** 2026-07-28
**Duration:** ~2 hours
**Test Engineer:** AI Agent (OpenCode)

---

## Test Environment

| Attribute | Value |
|---|---|
| **Platform** | Windows 11 x64 |
| **Node.js** | v22.16.0 |
| **pnpm** | 9.15.0 |
| **Runtime** | tsx v4.23.1 (via npx) |
| **Playwright** | ^1.46.0, Chromium 1234 (headless) |
| **Test Repo** | Viskod itself (`C:\Viskod`) |
| **Test App** | Static HTML page served via `node` HTTP server on `localhost:8080` |

### Test application

A hand-authored static HTML page with:
- `.header` (div with h1 + p)
- `.card` containers with interactive elements (button, input, select)
- `#test-button`, `#test-input`, `#test-select`, `#test-form`
- Basic CSS styling

---

## Commands Run

| Command | Status | Notes |
|---|---|---|
| `viskod help` | ✅ Pass | Help text displays all 5 commands |
| `viskod health` | ✅ Pass | All subsystems report status (browser-runtime shows "unavailable" — expected) |
| `viskod scan .` | ✅ Pass | Detects pnpm workspace, TypeScript, Node. Scan: 3ms |
| `viskod start http://localhost:8080/test-app.html` | ✅ Pass | Launches headless Chromium, navigates, blocks waiting for Ctrl+C |
| `viskod capture ".header"` | ✅ Pass | Full capture pipeline works |
| `viskod capture "#test-button"` | ✅ Pass | Button element captured correctly |
| `viskod serve` (with tools/list) | ✅ Pass | MCP server responds with 3 registered tools |

---

## What Worked

1. **CLI help & argument parsing** — all subcommands parse correctly
2. **Browser launch & navigation** — Playwright headless Chromium launches and navigates to URLs
3. **DOM snapshot** — element tree returned with tag name, attributes, bounding box, children, text
4. **Computed styles** — 20 CSS properties returned per selected element
5. **Screenshot capture** — viewport screenshot captured as PNG (~24KB)
6. **Context Packet assembly** — full `ContextPacket` generated with selection, DOM, styles, screenshots, confidence, metadata
7. **Capture pipeline persistence** — screenshots and metadata written to `.viskod/captures/`
8. **Event Bus** — all subsystems publish/receive typed events correctly
9. **Project scanner** — detects workspace structure, package manager, runtime, language
10. **MCP server** — stdio-based JSON-RPC server responds to `initialize` and `tools/list`

---

## What Failed

| # | Failure | Subsystem | Root Cause | Severity |
|---|---|---|---|---|
| 1 | DOM snapshot threw `ReferenceError: __name is not defined` | browser-runtime | tsx/esbuild injects `__name()` helper for named inner functions. When Playwright serializes the callback for `$eval`, the helper reference leaks into the browser context where it doesn't exist. | P0 (Fixed) |
| 2 | MCP server exposed zero tools | cli → mcp-server | `MCPServer.registerTool()` was never called anywhere in the codebase. `cmdServe` created a bare server instance and started it immediately. | P0 (Fixed) |
| 3 | JavaScript heap OOM (≥4 GB) during capture | context-engine | Infinite event loop: `generatePacket()` → `validateSelection()` → publishes `SE_EVENT:SELECTION_CHANGED` → VCE handler → `processSelection()` → `generatePacket()` → ... until heap exhaustion. | P0 (Fixed) |

---

## P0 Fixes Applied (this branch)

### Fix 1: `browser-runtime/src/index.ts` — DOM snapshot `__name` issue

**Problem:** `getDOMSnapshot()` used `page.$eval(selector, (el) => { const serialize = (node) => { ... }; ... })`. tsx transforms the named arrow function `serialize` and injects `__name(serialize, "serialize")` in the module scope. When Playwright serializes the outer function via `toString()`, the `__name` call is included in the serialized source but the helper definition is not. The browser context fails with `ReferenceError: __name is not defined`.

**Fix:** Replaced `page.$eval` with `page.evaluate` using a string-based IIFE. Strings are not transformed by tsx, so no `__name` injection occurs. The DOM serialization logic is concatenated as plain JavaScript string with the selector escaped for safe interpolation.

### Fix 2: `cli/src/index.ts` — MCP server tool registration

**Problem:** `cmdServe()` created `new MCPServer()` and called `server.start()` without registering any tools. The server responded to `tools/list` with an empty array.

**Fix:** Before starting the server, register three tools:
- `health` — returns subsystem health status
- `scan` — scans a project directory for metadata
- `capture` — navigates to URL, selects element, generates Context Packet

Tools use the same `createRuntime()` factory as the CLI commands.

### Fix 3: `context-engine/src/index.ts` — Re-entrancy guard for selection events

**Problem:** The VCE constructor subscribes to `SE_EVENT:SELECTION_CHANGED`. `validateSelection()` (called from `generatePacket()`) publishes this event upon success. The subscriber calls `processSelection()` → `generatePacket()` → `validateSelection()` → ... infinite loop.

**Fix:** Added `isProcessingFromEvent` guard flag. Set before entering the handler, cleared in `finally`. If the guard is already `true`, the handler returns immediately, breaking the cycle.

---

## P1 Issues (High Impact, Not Blocking Basic Workflow)

### P1.1 Selection bounding box is hardcoded placeholder

**File:** `packages/cli/src/index.ts:173-175`, `packages/context-engine/src/index.ts:128`

The `boundingBox` in `cmdCapture` and the VCE's `SE_EVENT:SELECTION_CHANGED` handler is always `{ x: 0, y: 0, width: 100, height: 100 }`. The actual element position/size from the browser is never captured.

**Impact:** The selection packet's `boundingBox` field is always wrong. AI agents cannot determine where on the page the element is located.

**Suggested fix:** After resolving the selector, call `page.evaluate` to get the element's `getBoundingClientRect()` and use those coordinates.

### P1.2 `viskod start` is non-interactive

**File:** `packages/cli/src/index.ts:60-93`

The `start` command opens a headless browser, navigates to a URL, prints a message, then blocks on process signal handlers. There is no way to:
- Send commands to the running browser instance
- Interact with the browser from another terminal
- Start the MCP server alongside the browser

Every `viskod capture` call creates its own browser instance (launch → navigate → capture → shutdown), which is slow and wasteful.

**Suggested fix:** Either:
- Make `start` launch both the browser and an MCP server that shares the same `BrowserRuntime` instance, OR
- Make `capture` reuse a persistent background process

### P1.3 Health check uptime is broken without prior launch

**File:** `packages/browser-runtime/src/index.ts:463-470`, `packages/cli/src/index.ts:230`

`health()` computes uptime as `Date.now() - this.startTime`. When `launch()` was never called, `startTime` is 0, resulting in uptime values like `1785262450063` ms (~56 years).

**Impact:** Health output is confusing. `cmdHealth` calls `health()` directly without launching the browser.

**Suggested fix:** Return `uptime: 0` when `startTime === 0`.

### P1.4 Configuration scan has false positives

**File:** `packages/project-scanner/src/index.ts` (presumably)

The scan reports config files that do not exist: `next.config.js`, `tailwind.config.js`, `eslint.config.js`, etc. It appears to list possible config file patterns rather than checking actual file existence.

**Impact:** Scan output is misleading.

**Suggested fix:** Verify file existence before including in configuration list.

### P1.5 Screenshot data lost in Context Packet assembly

**File:** `packages/context-engine/src/index.ts:312`

In `generatePacket()`, the screenshot buffer from `captureScreenshot()` is discarded. Only the metadata (`captureId`, `path`, `sizeBytes`, etc.) is preserved. When persisting through the capture pipeline, `Buffer.alloc(captureScreenshot.sizeBytes)` creates a **zero-filled buffer** instead of the actual screenshot data.

**Impact:** All persisted screenshots are empty (all-zero) PNGs. The capture pipeline writes junk data to disk.

**Suggested fix:** Either pass the buffer from Playwright's `page.screenshot()` through the `Screenshot` type, or capture the screenshot directly in the context engine where the buffer can be forwarded to the pipeline.

### P1.6 `buildHierarchy` returns mock data

**File:** `packages/selection-engine/src/index.ts:140-175`

`buildHierarchy()` always returns:
```json
{ "selectedNode": {"tagName": "element", "depth": 0},
  "parents": [{"tagName": "body", "depth": 1}],
  "children": [], "siblings": [],
  "landmarks": [{"tagName": "main", "role": "main"}, {"tagName": "nav", "role": "navigation"}] }
```

This is hardcoded mock data. The hierarchy never reflects the actual DOM tree.

**Impact:** Context Packet hierarchy is always misleading. AI agents get wrong parent/child/sibling information.

**Suggested fix:** Use the browser to walk up/down the DOM tree from the selected element.

### P1.7 Source hints always empty

**File:** `packages/context-engine/src/index.ts:227`

`sourceHints` is always `[]` because `SourceHintEngine` is created in `createRuntime()` but never called during packet generation.

**Impact:** The `sourceHints` field in Context Packets is always empty. AI agents never receive file path suggestions.

**Suggested fix:** Connect `SourceHintEngine` into the packet generation flow after DOM/selection data is available.

---

## P2 Issues (Lower Impact / Quality of Life)

| # | Issue | File | Description |
|---|---|---|---|
| 2.1 | `getLastPacket()` always returns null | `context-engine/src/index.ts:374-376` | Method exists but is never implemented. |
| 2.2 | Screenshot path is relative with no directory context | `browser-runtime/src/index.ts:247` | `path` is just `captureId.png`; if used to read from disk, would look in CWD. |
| 2.3 | Studio app has no frontend | `apps/studio/src/index.ts` | HTTP server created but no HTML/JS served. API endpoints exist for `/state`, `/capture`, `/health`, etc. but no UI renders them. |
| 2.4 | No tests for core packages | — | `packages/*/src/` have `.test.ts` files called out in some listings but are mostly empty or missing. No `vitest` config for individual packages. |
| 2.5 | Build fails with tsconfig errors | `packages/*/tsconfig.json` | Each package sets `rootDir: "./src"` with `"references": []`. Cross-package imports (workspace dependencies) fail because their source is outside `rootDir`. Need project references or removed rootDir constraints. |
| 2.6 | Capture pipeline stores in CWD | `capture-pipeline/src/index.ts:73-74` | `.viskod/captures/` is created in `process.cwd()` with no cleanup mechanism. |
| 2.7 | DOM snapshot depth hard-limited to 20 | `browser-runtime/src/index.ts` (after fix) | Walk function silently returns null at depth > 20. |
| 2.8 | `getComputedStyles` only returns 20 CSS properties | `browser-runtime/src/index.ts:312-334` | Hardcoded property list. May miss important layout properties like `grid-*`, `transform`, `box-shadow`, etc. |

---

## Architecture Concerns

### AC.1 Re-entrancy hazard in event-driven design

The VCE subscribes to `SE_EVENT:SELECTION_CHANGED` which is published by `validateSelection()` inside `generatePacket()`. This circular dependency is fragile. The re-entrancy guard (Fix 3) prevents the crash but doesn't address the design issue: the VCE reacts to a selection event by starting a new capture, which triggers another selection event.

**Recommendation:** Split the "selection changed" flow into two channels:
- `SE_EVENT:SELECTION_CHANGED` — informational, for UI updates only
- Dedicated `VCE_EVENT:START_CAPTURE` — when an explicit capture is requested

Or remove the automatic reaction entirely: let the CLI/Studio make explicit `generatePacket()` calls without the event handler routing through them.

### AC.2 Browser instance lifecycle is fragmented

Each CLI command (`start`, `capture`) creates its own browser instance. The `start` command holds one open but provides no way to connect to it. The `capture` command creates and destroys one per invocation. The `serve` command doesn't launch a browser at all.

**Recommendation:** The MCP server should own the browser lifecycle. `serve` should start a background browser on initialization and keep it running for the server's lifetime, sharing the `BrowserRuntime` across tool invocations.

### AC.3 Dockerfile integration not considered

The test app required a separate HTTP server. Viskod should either:
- Bundle a lightweight static file server for local file:// URLs
- Use Playwright's `route` API to serve mock content
- Accept `file://` protocol URLs for local HTML files

### AC.4 tsx compatibility is assumed but fragile

The project relies on tsx for TypeScript execution. The `__name` issue (Fix 1) is one example of tsx-specific transformations causing runtime failures. Other tsx/esbuild transforms could cause similar issues (e.g., `__spread`, `__awaiter`, etc.).

**Recommendation:** Either:
- Use a build step to compile to JS before running (fix tsconfig first)
- Or adopt a runtime that's closer to Node's native TypeScript support (e.g., `--experimental-strip-types` in Node 22+)
- Or explicitly test with compiled JS output as part of CI

---

## Context Packet Quality Assessment

| Aspect | Score (1-10) | Notes |
|---|---|---|
| Selection accuracy | 4 | Bound box is placeholder; selector works if provided externally |
| DOM depth | 7 | Recursive walk captures full element tree; depth limit prevents OOM in large pages |
| Style granularity | 5 | Only 20 properties; no inherited/computed distinction |
| Hierarchy | 2 | Mock data; never reflects actual DOM |
| Screenshot | 6 | Captured; persisted files are zero-filled |
| Source hints | 1 | Always empty |
| Confidence metrics | 5 | Values are hardcoded or derived from whether subsystems succeeded |
| Processing speed | 8 | ~130-140ms per capture |
| Metadata completeness | 6 | Timestamps, version, processing time present; diagnostics array always empty |

**Overall:** The packet structure is well-designed (types are comprehensive, versioned, with Zod schema validation potential). But the data within is heavily mocked or placeholder. A production-quality capture would require fixing P1.1, P1.5, P1.6, and P1.7.

---

## Recommended Fixes (Ranked)

| Priority | Issue | Effort | Impact |
|---|---|---|---|
| **P0** (all fixed this branch) | | | |
| P0.1 | DOM snapshot `__name` bug | Small | Blocking — capture never works |
| P0.2 | MCP server zero tools | Medium | Blocking — AI agents can't interact |
| P0.3 | Infinite event loop → OOM | Small | Blocking — capture OOMs |
| **P1** (next iteration) | | | |
| P1.1 | Real bounding box from browser | Small | High — selection data is wrong |
| P1.5 | Fix screenshot buffer loss | Small | High — persisted screenshots empty |
| P1.6 | Real hierarchy from DOM | Medium | High — hierarchy always mock |
| P1.7 | Connect source hint engine | Medium | High — source hints always empty |
| P1.2 | Persistent browser + IPC | Large | Medium — UX friction |
| P1.4 | Config scan false positives | Small | Medium — misleading output |
| P1.3 | Health uptime when no launch | Trivial | Low — cosmetic |
| **P2** (quality backlog) | | | |
| P2.5 | Fix tsconfig for build | Medium | Low — workaround via tsx exists |
| P2.1 | Implement getLastPacket() | Small | Low |
| P2.8 | Expand computed styles | Small | Low |
| P2.2 | Fix screenshot paths | Small | Low |

---

## Conclusion

Viskod's architecture is well-conceived. The layered design (browser-runtime → selection-engine → capture-pipeline → context-engine → CLI/MCP) cleanly separates concerns. The `ContextPacket` type is comprehensive and versioned. The event bus provides good observability.

However, the implementation was written before being tested end-to-end against a real application. This dogfooding session revealed:

1. **3 P0 blockers that made the product non-functional** (all fixed in this branch)
2. **7 P1 issues** that significantly degrade capture quality
3. **8 P2 issues** affecting polish and developer experience

The good news: once the P0 fixes are applied, the basic workflow (launch → navigate → select → capture → packet) works end-to-end in ~140ms. The product skeleton is solid. What's needed is a focused pass on data quality (P1.1, P1.5, P1.6, P1.7) before the first external release.
