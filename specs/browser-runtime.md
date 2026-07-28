# Browser Runtime

> **Specification ID:** SPEC-008
> **Version:** 1.0
> **Status:** Approved
> **Owner:** Platform Architecture
> **Last Updated:** 2026-07-28
> **Phase 2 Note:** P0 stub implementation exists in `packages/browser-runtime/`. Phase 2 replaces stub methods (launch, navigate, captureScreenshot, getDOMSnapshot, getComputedStyles) with real Playwright calls. Overlay injection script provided by `@viskod/overlay-system` (SPEC-022). Selection events consumed by `@viskod/selection-engine` (SPEC-014).

---

## Architecture Sources

* `docs/browser-runtime.md` — full subsystem specification: runtime responsibilities, browser lifecycle, page lifecycle, viewport management, overlay architecture, capture interfaces, event model, isolation guarantees
* `docs/architecture.md` §Browser Runtime — controls Chromium: launch, connect, tabs, navigation, refresh, viewport changes, screenshot capture, diagnostics, overlay injection; never understands business logic
* `docs/architecture.md` §Browser Lifecycle — CLI → Browser Runtime → Chromium Launch → Browser Context → Page → Application → Ready; only one active Browser Runtime per project
* `docs/architecture.md` §Runtime Boundary — communicates only with Chromium (via Playwright) and VCE (via its own public API which VCE calls); Browser Runtime NEVER calls VCE directly; emits events to Event Bus
* `docs/architecture.md` §Viewport Engine — controls visual rendering: viewport size, orientation, zoom, device scale factor, refresh; supported modes: Desktop, Tablet, Mobile, Custom
* `docs/architecture.md` §Page Management — owns Current Page, Current Route, Current URL, Current Viewport, Current Selection, Browser Diagnostics
* `docs/architecture.md` §Overlay System, §Overlay Isolation — namespaced classes, Shadow DOM where appropriate, isolated styles, isolated event handlers; inspected application must not know overlay exists
* `docs/ARCHITECTURE_BASELINE.md` §Runtime Boundaries — Browser Runtime owns Chromium, pages, screenshots, overlays, browser events; forbidden access: Repository, MCP, source hints, file system
* `docs/ARCHITECTURE_BASELINE.md` §Canonical Dependency Model — Browser Runtime → Event Bus → VCE (asynchronous event flow); VCE → Browser Runtime (command flow); no bi-directional dependency exists except through Event Bus
* `docs/ARCHITECTURE_BASELINE.md` §Prohibited Dependencies — Browser Runtime must not directly call VCE methods; Browser Runtime must not import VCE implementation modules
* `docs/glossary.md` §Browser Runtime — the subsystem responsible for interacting with supported browsers, capturing visual state and coordinating browser operations; one of the platform's primary evidence sources

---

## Dependencies

| Specification | Status | Relationship |
|--------------|--------|-------------|
| SPEC-002 (shared-types) | Draft | Imports base types (`Identifier`, `Timestamp`, `Milliseconds`, `Bytes`, `Result`, `Maybe`), Zod schemas, error base types |
| SPEC-003 (error-model) | Draft | Imports `ViskodError`, `ErrorCategory`, `ErrorSeverity`; produces errors conforming to the error model |
| SPEC-004 (configuration) | Draft | Reads `BrowserRuntimeConfig` defaults (headless, viewport, timeout, screenshot output directory) |

---

## Consumers

| Specification | Status | Relationship |
|--------------|--------|-------------|
| SPEC-007 (event-bus) | Draft | Browser Runtime publishes events to Event Bus; Event Bus delivers them to subscribers |
| SPEC-009 (visual-context-engine) | Draft | VCE calls Browser Runtime public API (capture, navigate, viewport); VCE subscribes to Browser Runtime events via Event Bus |
| overlay-system | Draft | Browser Runtime's Overlay Manager is the runtime component that renders the Overlay System |
| selection-engine | Draft | Selection Engine depends on Browser Runtime for DOM access; coordinates through Event Bus |

---

## Purpose

Defines the Browser Runtime subsystem: the execution engine responsible for controlling Chromium via Playwright. The Browser Runtime provides the execution environment that enables Viskod to observe a running application without modifying its source code. Its responsibility ends at observation and control — it is not a browser abstraction library, a DOM parser, a visual analysis engine, or an MCP server. It is one of the platform's primary evidence sources.

---

## Scope

* Browser process lifecycle (launch, health, shutdown)
* Browser context management (create, isolate, destroy)
* Page lifecycle (navigation, reload, history, active page tracking)
* Viewport configuration (size, orientation, device scale factor, presets)
* Screenshot capture (viewport, selection, full-page)
* DOM snapshots (structured element tree, attributes, bounding boxes)
* Computed style retrieval (filtered, normalised CSS properties)
* Overlay injection and removal (Shadow DOM, namespaced CSS, isolated styles)
* Element highlighting and clearing
* Browser diagnostics (console errors, page errors, memory usage)
* Event publishing to Event Bus (never direct subscriber calls)
* Error handling and recovery (retry, graceful degradation, handle invalidation)

---

## Non-Goals

* Source code inspection or repository analysis
* Source location inference or source hint generation
* Design system analysis or framework detection
* Context Packet construction (VCE owns this)
* MCP exposure or AI communication protocols
* Screenshot persistence or storage management (Capture Pipeline owns this)
* Business logic, UI state management, or Studio communication
* DOM parsing beyond structural snapshots (no accessibility tree, no role inference, no semantic analysis)
* Network interception or request/response inspection
* Multi-browser runtime (Firefox, WebKit are future concerns)

---

## Terminology

| Term | Definition (this spec) |
|------|----------------------|
| **BrowserHandle** | Opaque reference returned by `launch()`; identifies a running browser instance; invalidated on disconnect |
| **PageHandle** | Opaque reference identifying an active page within a browser instance |
| **Inspectable** | Page state reached after load + stability; inspection operations are valid only in this state |
| **Overlay** | Visual annotation layer injected into the page via Shadow DOM with `__viskod_` prefixed classes; never affects application layout |
| **Capture** | The act of producing a screenshot and returning a `Screenshot` result; persistence is delegated to the Capture Pipeline via VCE |

All other terms reference `docs/glossary.md` for canonical definitions.

---

## Runtime Boundary

| Boundary | Value |
|----------|-------|
| Process | Main desktop process (same as Studio) |
| Browser Engine | Chromium (via Playwright) |
| Imports allowed | `playwright`, `@viskod/shared` (types, schemas, utilities, errors), `@viskod/config` (configuration defaults) |
| Imports forbidden | `@viskod/visual-context-engine`, `@viskod/mcp-server`, `@viskod/project-scanner`, `@viskod/source-hint-engine`, `@viskod/studio`, `@viskod/capture-pipeline`, any `/docs/` or `/specs/` that define business logic |
| Network | localhost only; no outbound connections beyond the browser process |
| File system | Write access only to screenshot output directory (`<project>/.viskod/captures/`); no repository file scanning |
| Secrets | Never accesses `.env` files, environment variables beyond config keys, or user credentials |

---

## Responsibilities

The Browser Runtime owns:

* Browser process launch, health monitoring, and shutdown
* Browser context creation, isolation, and destruction (one per project)
* Page navigation, reload, history traversal, and active page tracking
* Viewport configuration (size, device scale factor, orientation presets)
* Screenshot capture (viewport, selection, full-page) returning `Screenshot` results
* Overlay injection via Shadow DOM with `__viskod_` namespaced classes
* Element highlighting and highlight clearing
* DOM structural snapshots (tag name, attributes, bounding box, children, text content)
* Computed style retrieval (filtered to relevant properties)
* Browser diagnostics collection (console errors, page errors, memory usage)
* Event publishing to Event Bus for all state transitions and lifecycle events
* Error handling, retry, and graceful degradation within the browser boundary

The Browser Runtime must never:

* Inspect project files or repository structure
* Infer source locations or generate source hints
* Analyse design systems or framework conventions
* Construct Context Packets
* Expose MCP tools, resources, or prompts
* Call Visual Context Engine methods directly
* Communicate with Studio, MCP Server, or Project Scanner directly
* Import internal modules from any other Viskod package
* Log page content, URLs with query parameters, cookies, or local storage

---

## Interfaces

### Public API

| Signature | Purpose | Preconditions | Postconditions | Errors |
|-----------|---------|---------------|----------------|--------|
| `launch(options?: LaunchOptions): Promise<Result<BrowserHandle>>` | Start Chromium and return a handle | Config loaded; Playwright available | Browser process running; handle valid; `BrowserStarted` event published | `BR_LAUNCH_FAILED` |
| `shutdown(handle: BrowserHandle): Promise<Result<void>>` | Terminate Chromium cleanly | Handle is valid and active | Browser process terminated; all pages closed; `BrowserStopped` event published | `BR_DISCONNECTED` (if already dead) |
| `health(handle: BrowserHandle): BrowserHealth` | Return current browser health snapshot | Handle is valid | Returns health status synchronously | None (synchronous, always returns a value) |
| `navigate(handle: BrowserHandle, url: string): Promise<Result<PageHandle>>` | Navigate active page to URL | Handle is valid; URL is well-formed | Page navigates to URL; `PageLoaded` event published on completion | `BR_NAVIGATION_FAILED`, `BR_TIMEOUT` |
| `reload(handle: BrowserHandle): Promise<Result<void>>` | Reload the active page | Handle is valid; page exists | Page reloads; `PageLoaded` event published | `BR_NAVIGATION_FAILED`, `BR_TIMEOUT` |
| `goBack(handle: BrowserHandle): Promise<Result<void>>` | Navigate back in page history | Handle is valid; history entry exists | Page navigates to previous URL; `NavigationCompleted` event published | `BR_NAVIGATION_FAILED`, `BR_TIMEOUT` |
| `goForward(handle: BrowserHandle): Promise<Result<void>>` | Navigate forward in page history | Handle is valid; forward history entry exists | Page navigates to next URL; `NavigationCompleted` event published | `BR_NAVIGATION_FAILED`, `BR_TIMEOUT` |
| `setViewport(handle: BrowserHandle, viewport: Viewport): Promise<Result<void>>` | Change the viewport dimensions and scale | Handle is valid | Viewport updated; `ViewportChanged` event published | `BR_TIMEOUT` |
| `getViewport(handle: BrowserHandle): Viewport` | Return current viewport dimensions | Handle is valid | Returns current viewport synchronously | None |
| `captureScreenshot(handle: BrowserHandle, type: 'viewport'\|'selection'\|'full-page', options?: ScreenshotOptions): Promise<Result<Screenshot>>` | Capture a screenshot of the specified scope | Handle is valid; page is inspectable | Screenshot saved to `.viskod/captures/{captureId}.png`; `CaptureCompleted` event published | `BR_CAPTURE_FAILED`, `BR_TIMEOUT` |
| `injectOverlay(handle: BrowserHandle): Promise<Result<void>>` | Inject the visual overlay into the page | Handle is valid; page is inspectable; overlay not already injected | Shadow DOM overlay present in page; application layout unchanged | `BR_OVERLAY_INJECTION_FAILED` |
| `removeOverlay(handle: BrowserHandle): Promise<Result<void>>` | Remove the visual overlay from the page | Handle is valid; overlay is injected | Overlay removed; page state unchanged | None (no-op if overlay not present) |
| `highlightElement(handle: BrowserHandle, selector: string): Promise<Result<void>>` | Apply highlight styling to an element | Handle is valid; overlay is injected; selector resolves to valid element | Element visually highlighted; `SelectionChanged` event published | `BR_OVERLAY_INJECTION_FAILED` (if overlay missing) |
| `clearHighlight(handle: BrowserHandle): Promise<Result<void>>` | Remove highlight from previously highlighted element | Handle is valid; overlay is injected | Highlight removed; `SelectionChanged` event published | None (no-op if no highlight active) |
| `getDOMSnapshot(handle: BrowserHandle, selector: string): Promise<Result<DOMSnapshot>>` | Return a structural snapshot of the element tree | Handle is valid; page is inspectable; selector resolves to a valid element | Returns structured DOM tree with bounding boxes | `BR_TIMEOUT` |
| `getComputedStyles(handle: BrowserHandle, selector: string): Promise<Result<StyleSnapshot>>` | Return computed CSS styles for an element | Handle is valid; page is inspectable; selector resolves to a valid element | Returns filtered, normalised style map | `BR_TIMEOUT` |
| `getDiagnostics(handle: BrowserHandle): Promise<Result<BrowserDiagnostics>>` | Collect runtime diagnostics | Handle is valid | Returns diagnostic snapshot; `DiagnosticsUpdated` event published | None (returns whatever is available) |
| `getConsoleErrors(handle: BrowserHandle): Promise<Result<ConsoleError[]>>` | Collect console errors from the page | Handle is valid; page is inspectable | Returns array of console errors; `ConsoleError` event published per error | None (returns empty array if none) |

### Events Published

| Event | Payload Schema | When Published |
|-------|---------------|----------------|
| `BrowserStarted` | `{ contextId: Identifier; timestamp: Timestamp }` | After `launch()` completes successfully |
| `BrowserStopped` | `{ contextId: Identifier; timestamp: Timestamp }` | After `shutdown()` completes |
| `BrowserDisconnected` | `{ contextId: Identifier; timestamp: Timestamp; reason: string }` | When browser process dies unexpectedly |
| `PageLoaded` | `{ contextId: Identifier; pageId: Identifier; url: string; timestamp: Timestamp }` | After page reaches Load event and stabilises |
| `NavigationCompleted` | `{ contextId: Identifier; pageId: Identifier; url: string; timestamp: Timestamp }` | After any navigation (navigate, reload, goBack, goForward) completes |
| `ViewportChanged` | `{ contextId: Identifier; viewport: Viewport; timestamp: Timestamp }` | After `setViewport()` applies new dimensions |
| `SelectionChanged` | `{ contextId: Identifier; selector: string \| null; boundingBox: BoundingBox \| null; timestamp: Timestamp }` | After `highlightElement()` or `clearHighlight()` |
| `CaptureStarted` | `{ contextId: Identifier; type: ScreenshotType; timestamp: Timestamp }` | At the start of `captureScreenshot()` |
| `CaptureCompleted` | `{ captureId: Identifier; contextId: Identifier; type: ScreenshotType; path: string; format: string; width: number; height: number; sizeBytes: number; timestamp: Timestamp }` | After screenshot is saved to disk |
| `CaptureFailed` | `{ contextId: Identifier; type: ScreenshotType; error: ViskodError; timestamp: Timestamp }` | When screenshot capture fails |
| `DiagnosticsUpdated` | `{ contextId: Identifier; diagnostics: BrowserDiagnostics; timestamp: Timestamp }` | After `getDiagnostics()` collects new data |
| `ConsoleError` | `{ contextId: Identifier; pageId: Identifier; error: ConsoleError; timestamp: Timestamp }` | When a new console error is captured from the page |

### Events Subscribed

Browser Runtime subscribes to no events. It is exclusively a publisher.

---

## Data Models

### LaunchOptions
```typescript
interface LaunchOptions {
  headless?: boolean;       // default: from config
  viewport?: Viewport;      // default: from config
  timeout?: number;         // default: from config; max wait for launch in ms
}
```

### BrowserHandle
```typescript
interface BrowserHandle {
  contextId: string;
}
```

### PageHandle
```typescript
interface PageHandle {
  contextId: string;
  pageId: string;
  url: string;
}
```

### Viewport
```typescript
interface Viewport {
  width: number;            // pixels, > 0
  height: number;           // pixels, > 0
  deviceScaleFactor: number; // 1.0 = standard DPI, 2.0 = Retina; default: 1.0
}
```

### ScreenshotOptions
```typescript
interface ScreenshotOptions {
  format?: 'png' | 'jpeg';        // default: 'png'
  quality?: number;                // 0-100, JPEG only; default: 80
  clip?: BoundingBox;              // crop region; default: full viewport/selection/page
  fullPage?: boolean;              // capture full scrollable page; default: false
}
```

### Screenshot
```typescript
interface Screenshot {
  captureId: string;         // globally unique identifier
  path: string;              // relative path: .viskod/captures/{captureId}.png
  format: string;            // 'png' or 'jpeg'
  width: number;             // pixels
  height: number;            // pixels
  sizeBytes: number;         // file size on disk
}
```

### DOMSnapshot
```typescript
interface DOMSnapshot {
  tagName: string;                     // lowercase, e.g. 'div', 'button'
  attributes: Record<string, string>;  // element attributes as key-value pairs
  boundingBox: BoundingBox;            // position and dimensions in viewport coordinates
  children: DOMSnapshot[];             // recursive child snapshots
  text?: string;                       // text content, present only for text-containing elements; truncated at 500 chars
}
```

### StyleSnapshot
```typescript
interface StyleSnapshot {
  computed: Record<string, string>;    // CSS property name → computed value (e.g. { "display": "flex", "color": "rgb(0,0,0)" })
}
```

### BrowserHealth
```typescript
interface BrowserHealth {
  status: 'healthy' | 'degraded' | 'unavailable' | 'starting';
  uptime: number;            // seconds since launch
  pageCount: number;         // number of open pages
  memoryUsage?: number;      // bytes, if available
}
```

### BrowserDiagnostics
```typescript
interface BrowserDiagnostics {
  consoleErrors: ConsoleError[];
  pageErrors: PageError[];
  memoryUsage: number;         // bytes, approximate
  pageCount: number;
  timestamp: string;           // ISO 8601
}
```

### ConsoleError
```typescript
interface ConsoleError {
  message: string;       // truncated at 1000 chars
  source: string;        // e.g. 'console.error', 'unhandledrejection', 'window.onerror'
  line: number;          // line number in page source; 0 if unavailable
  url?: string;          // hostname + path only; query parameters stripped
  timestamp: string;     // ISO 8601
}
```

### PageError
```typescript
interface PageError {
  message: string;       // truncated at 1000 chars
  stack?: string;        // stack trace if available; truncated at 2000 chars
  timestamp: string;     // ISO 8601
}
```

### BoundingBox
```typescript
interface BoundingBox {
  x: number;             // viewport-relative left edge
  y: number;             // viewport-relative top edge
  width: number;         // pixels
  height: number;        // pixels
}
```

---

## State Model

### Browser Runtime States

```
Starting → Ready → Navigating → PageLoaded → Inspectable
                       ↓                    ↓
                  NavigationFailed    BrowserDisconnected
                                            ↓
                                       ShuttingDown → Stopped
```

| State | Description | Valid Operations |
|-------|-------------|-----------------|
| `Starting` | Chromium process is launching; Playwright is connecting | None; transitions to `Ready` or crashes |
| `Ready` | Browser is running; no page loaded yet | `navigate()`, `shutdown()`, `health()` |
| `Navigating` | Page is loading a URL; not yet stable | `shutdown()`, `health()` |
| `PageLoaded` | Page has reached Load event | `captureScreenshot()`, `injectOverlay()`, `getDOMSnapshot()`, `getComputedStyles()`, `getDiagnostics()`, `getConsoleErrors()`, `reload()`, `goBack()`, `goForward()`, `setViewport()`, `shutdown()`, `health()` |
| `Inspectable` | Page is loaded, overlay is injected, element is selectable | All operations from `PageLoaded` plus `highlightElement()`, `clearHighlight()` |
| `NavigationFailed` | Last navigation attempt failed; page remains at previous URL | `navigate()`, `reload()`, `shutdown()`, `health()` |
| `BrowserDisconnected` | Browser process died unexpectedly; all handles invalidated | Only `shutdown()` (cleanup), `launch()` (new instance) |
| `ShuttingDown` | Browser is being closed; pages are being terminated | None; transitions to `Stopped` |
| `Stopped` | Browser process terminated; all resources released | `launch()` (new instance) |

### Invariants

* Exactly one `BrowserHandle` is active per Viskod session at any time
* Exactly one page is the active inspection target at any time
* `captureScreenshot()`, `injectOverlay()`, `getDOMSnapshot()`, and `getComputedStyles()` require a page in `PageLoaded` or `Inspectable` state
* `highlightElement()` and `clearHighlight()` require `Inspectable` state (overlay must be injected)
* Once `BrowserDisconnected` is emitted, all outstanding `BrowserHandle` references are invalid
* Viewport changes do not invalidate the Browser Runtime or page state

---

## Command Flows

### Launch Flow

```
viskod start
  ──calls──→ loadConfig()
  ──calls──→ BrowserRuntime.launch(options)
  ──calls──→ Playwright launches Chromium
  ──calls──→ Create BrowserContext (isolated per project)
  ──calls──→ Create Page (blank)
  ──calls──→ Apply default viewport
  ──calls──→ emit BrowserStarted event to Event Bus
  ──returns──→ BrowserHandle
```

### Navigate Flow

```
VCE
  ──calls──→ BrowserRuntime.navigate(handle, url)
  ──calls──→ Validate handle is active
  ──calls──→ Playwright page.goto(url)
  ──calls──→ Wait for 'load' event + stability (no network for 500ms)
  ──calls──→ emit PageLoaded event to Event Bus
  ──returns──→ Result<PageHandle>
```

### Capture Flow

```
VCE
  ──calls──→ BrowserRuntime.captureScreenshot(handle, type, options)
  ──calls──→ Validate handle active + page in PageLoaded/Inspectable
  ──calls──→ emit CaptureStarted event to Event Bus
  ──calls──→ Playwright page.screenshot({ type: 'png', ...options })
  ──calls──→ Write to .viskod/captures/{captureId}.png
  ──calls──→ emit CaptureCompleted event to Event Bus
  ──returns──→ Result<Screenshot>
```

### Shutdown Flow

```
VCE / CLI
  ──calls──→ BrowserRuntime.shutdown(handle)
  ──calls──→ Validate handle
  ──calls──→ Remove overlay from all pages
  ──calls──→ Close all pages
  ──calls──→ Destroy BrowserContext
  ──calls──→ Close Chromium process
  ──calls──→ Validate no orphan processes
  ──calls──→ emit BrowserStopped event to Event Bus
  ──returns──→ Result<void>
```

### Overlay Injection Flow

```
VCE / Selection Engine
  ──calls──→ BrowserRuntime.injectOverlay(handle)
  ──calls──→ Validate handle active + page in PageLoaded/Inspectable
  ──calls──→ Verify overlay not already injected
  ──calls──→ Playwright page.addScriptTag() or page.evaluate()
  ──calls──→ Create Shadow DOM root on injected container
  ──calls──→ Apply __viskod_ namespaced CSS classes
  ──calls──→ Attach isolated event handlers (pointermove, click, etc.)
  ──calls──→ Verify application layout unchanged (bounding-box comparison pre/post)
  ──returns──→ Result<void>
```

### DOM Snapshot Flow

```
VCE
  ──calls──→ BrowserRuntime.getDOMSnapshot(handle, selector)
  ──calls──→ Validate handle active + page in PageLoaded/Inspectable
  ──calls──→ Playwright page.$eval(selector, serializeDOM)
  ──calls──→ Recursively serialise: tagName, attributes, boundingBox, children, text (truncated)
  ──calls──→ Filter out script, style, and __viskod_ prefixed overlay nodes
  ──returns──→ Result<DOMSnapshot>
```

---

## Event Flows

Browser Runtime publishes events to the Event Bus. It never calls subscribers directly. It never knows which subscribers consume its events.

### Browser Lifecycle Events

```
BrowserRuntime.launch()
  ──events──→ EventBus.publish(BrowserStarted)

BrowserRuntime.shutdown()
  ──events──→ EventBus.publish(BrowserStopped)

Browser process crash (detected by health monitor)
  ──events──→ EventBus.publish(BrowserDisconnected)
```

### Page Lifecycle Events

```
BrowserRuntime.navigate()
  ──events──→ EventBus.publish(PageLoaded)

BrowserRuntime.navigate() / reload() / goBack() / goForward()
  ──events──→ EventBus.publish(NavigationCompleted)
```

### Viewport Events

```
BrowserRuntime.setViewport()
  ──events──→ EventBus.publish(ViewportChanged)
```

### Selection Events

```
BrowserRuntime.highlightElement()
  ──events──→ EventBus.publish(SelectionChanged { selector, boundingBox })

BrowserRuntime.clearHighlight()
  ──events──→ EventBus.publish(SelectionChanged { selector: null, boundingBox: null })
```

### Capture Events

```
BrowserRuntime.captureScreenshot()
  ──events──→ EventBus.publish(CaptureStarted)
  ──events──→ EventBus.publish(CaptureCompleted)  // on success
  ──events──→ EventBus.publish(CaptureFailed)      // on failure
```

### Diagnostics Events

```
BrowserRuntime.getDiagnostics()
  ──events──→ EventBus.publish(DiagnosticsUpdated)

Console error detected on page
  ──events──→ EventBus.publish(ConsoleError)
```

---

## Error Behaviour

| Condition | Error Code | Message | Recovery |
|-----------|-----------|---------|----------|
| Chromium fails to start | `BR_LAUNCH_FAILED` | "Failed to launch Chromium: {cause}" | Retry once; if still fails, return error; caller responsible for notifying user |
| URL is unreachable (DNS, timeout, invalid URL) | `BR_NAVIGATION_FAILED` | "Navigation to {sanitised_url} failed: {cause}" | Return error; page remains at current URL; page state unchanged |
| Navigation exceeds timeout (configurable, default 30s) | `BR_TIMEOUT` | "Operation timed out after {timeout}ms" | Cancel operation; return error; page state unchanged |
| Screenshot capture fails (browser error, disk full) | `BR_CAPTURE_FAILED` | "Screenshot capture failed: {cause}" | Return error; browser state unchanged; no partial file retained |
| Overlay injection script fails (page CSP blocks, DOM error) | `BR_OVERLAY_INJECTION_FAILED` | "Overlay injection failed: {cause}" | Return error; page continues functioning without overlay; caller may retry |
| Browser process dies unexpectedly (crash, killed, OOM) | `BR_DISCONNECTED` | "Browser disconnected unexpectedly: {cause}" | Emit `BrowserDisconnected` event; all handles invalidated; caller must `launch()` new instance |
| Handle is invalid (stale, wrong context) | `BR_INVALID_HANDLE` | "Browser handle is invalid or expired" | Return error immediately; no side effects |
| Operation attempted in wrong state (e.g., capture before page loaded) | `BR_INVALID_STATE` | "Operation not allowed in state {current_state}: expected {required_state}" | Return error; no state change |
| Playwright API throws unexpected error | `BR_INTERNAL_ERROR` | "Browser Runtime internal error: {cause}" | Return error; may indicate bug; log full stack trace |
| Shutdown called on already-stopped browser | `BR_ALREADY_STOPPED` | "Browser is already stopped" | Return success (idempotent); no event published |

---

## Security Requirements

### Trust Boundaries

* The browser process is untrusted — all output from Playwright is validated before use
* The inspected application is untrusted — injected overlay scripts run in page context and must not modify application state
* The page's JavaScript environment is untrusted — never execute untrusted strings as code; use structured serialisation only
* Repository contents are sensitive — Browser Runtime must never read project files
* Environment variables and `.env` files are sensitive — Browser Runtime must never access them beyond config keys

### Input Validation

* All `selector` strings are validated before passing to Playwright (no script injection)
* All `url` strings are validated as well-formed URLs; protocol restricted to `http` and `https`
* All viewport dimensions must be positive integers within reasonable bounds (1–8192 pixels)
* All `ScreenshotOptions.clip` coordinates must be non-negative and within viewport bounds
* `deviceScaleFactor` must be a positive number (0.5–4.0)

### Overlay Security

* Overlay scripts use Shadow DOM for CSS isolation — no style leakage into application
* All overlay CSS classes prefixed with `__viskod_` to prevent collision
* Overlay event handlers are isolated — they do not bubble to application event listeners
* Overlay never calls `eval()` or `new Function()` with untrusted input
* Overlay DOM mutations are restricted to the Shadow DOM root — application DOM tree is never modified
* Overlay removal must leave the page in its pre-injection state (verified by DOM node count comparison)

### Sensitive Data Handling

* URLs in diagnostics are truncated to `hostname + path` only — query parameters, fragments, and credentials stripped
* Page content text in `DOMSnapshot.text` is truncated at 500 characters
* `ConsoleError` messages are truncated at 1000 characters
* Console error `url` field strips query parameters
* Screenshots saved only to `.viskod/captures/` — never transmitted externally
* No page content, cookies, or local storage is ever logged
* No automatic page content logging or surveillance

---

## Privacy Requirements

### Data Collected

| Data | Purpose | Retention |
|------|---------|-----------|
| Screenshots | Visual context for AI coding agents | Until explicitly deleted by user or retention policy |
| DOM snapshots | Structural context for AI coding agents | Transient; not persisted beyond the capture session |
| Computed styles | Styling context for AI coding agents | Transient; not persisted beyond the capture session |
| Console errors | Diagnostics for debugging application issues | Transient; forwarded as events only |
| Browser health metrics | Runtime monitoring | Transient; not persisted beyond session |

### Data NOT Collected

* Page content beyond DOM structural snapshots
* Form input values, passwords, or sensitive fields
* Cookies, local storage, session storage
* Authentication tokens or credentials
* Network request/response bodies
* User interaction patterns or behaviour analytics
* Application state or Redux/Vuex/Pinia stores
* Full URL query parameters (only hostname + path in diagnostics)

### Privacy Invariants

* Screenshots saved only on explicit capture request — no automatic or periodic capture
* No page content is automatically logged
* All data remains local unless explicitly exported by the developer
* No telemetry is collected in Phase 1
* No data is transmitted to external services

---

## Performance Budget

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Browser launch (cold start) | < 5000 ms | Benchmark: `launch()` → `BrowserStarted` event; measured 100 times; p95 |
| Browser launch (warm start) | < 2000 ms | Benchmark: `launch()` after recent `shutdown()`; p95 |
| Viewport update | < 100 ms | Benchmark: `setViewport()` → `ViewportChanged` event; p95 |
| Screenshot capture (viewport, PNG) | < 300 ms | Benchmark: `captureScreenshot()` → file on disk; viewport 1920×1080; p95 |
| Screenshot capture (full-page, up to 10k px) | < 1000 ms | Benchmark: full-page capture on long scrollable page; p95 |
| Overlay injection | < 50 ms | Benchmark: `injectOverlay()` → overlay present in DOM; p95 |
| Overlay highlight update | < 16 ms | Benchmark: `highlightElement()` → visual change rendered; p95 (single frame budget) |
| DOM snapshot (100-element tree) | < 50 ms | Benchmark: `getDOMSnapshot()` on element with 100 descendants; p95 |
| DOM snapshot (1000-element tree) | < 200 ms | Benchmark: `getDOMSnapshot()` on element with 1000 descendants; p95 |
| Computed styles retrieval | < 50 ms | Benchmark: `getComputedStyles()` on a single element; p95 |
| Page navigation (localhost) | < 2000 ms | Benchmark: `navigate()` → `PageLoaded` event; p95 |
| Shutdown sequence | < 3000 ms | Benchmark: `shutdown()` → all processes terminated; p95 |

---

## Observability

### Log Levels

| Level | Usage |
|-------|-------|
| `ERROR` | Launch failures, disconnects, capture failures, unhandled Playwright exceptions |
| `WARN` | Timeouts, navigation failures, degraded health, non-fatal overlay errors |
| `INFO` | Lifecycle events (launch, shutdown, navigation), capture completion, overlay injection |
| `DEBUG` | Detailed Playwright protocol messages, DOM snapshot sizes, timing breakdowns |

### Diagnostic Signals

* `BrowserHealth.status` — pollable health indicator
* `BrowserHealth.uptime` — seconds since launch
* `BrowserDiagnostics.memoryUsage` — approximate memory footprint
* `BrowserDiagnostics.consoleErrors` — captured page console errors
* `BrowserDisconnected` event — crash/unexpected termination signal

### Health Check

The `health(handle)` method is synchronous and always returns a `BrowserHealth` value. It functions as a liveness check:
* `healthy` — browser process running, at least one page active, no recent crashes
* `degraded` — browser process running but console errors exceed threshold or page count is zero
* `unavailable` — browser process not running (pre-launch or post-shutdown)
* `starting` — browser process is launching but not yet ready

---

## Configuration

Configuration is loaded via SPEC-004 (configuration). The Browser Runtime reads the following keys:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `browser.runtime.headless` | `boolean` | `true` | Launch Chromium in headless mode; overridable by `LaunchOptions.headless` |
| `browser.runtime.defaultViewport` | `Viewport` | `{ width: 1280, height: 720, deviceScaleFactor: 1.0 }` | Default viewport on launch; overridable by `LaunchOptions.viewport` |
| `browser.runtime.timeout.launch` | `number` (ms) | `30000` | Maximum wait for Chromium to start |
| `browser.runtime.timeout.navigate` | `number` (ms) | `30000` | Maximum wait for page navigation |
| `browser.runtime.timeout.screenshot` | `number` (ms) | `10000` | Maximum wait for screenshot capture |
| `browser.runtime.timeout.overlay` | `number` (ms) | `5000` | Maximum wait for overlay injection |
| `browser.runtime.screenshot.outputDir` | `string` | `".viskod/captures"` | Directory for screenshot output (relative to project root) |
| `browser.runtime.screenshot.format` | `'png' \| 'jpeg'` | `'png'` | Default screenshot format |
| `browser.runtime.screenshot.quality` | `number` | `80` | Default JPEG quality (0–100) |
| `browser.runtime.chromium.executablePath` | `string \| undefined` | `undefined` | Path to Chromium executable; `undefined` uses Playwright's bundled Chromium |

### Environment Variable Mappings

| Environment Variable | Config Key |
|---------------------|-----------|
| `VISKOD_BROWSER_HEADLESS` | `browser.runtime.headless` |
| `VISKOD_CHROMIUM_PATH` | `browser.runtime.chromium.executablePath` |

---

## Failure and Recovery

### Recoverable Failures

| Failure | Recovery Strategy |
|---------|-------------------|
| Page navigation timeout | Return `BR_TIMEOUT`; page remains at current URL; caller may retry with same or different URL |
| Screenshot capture failure | Return `BR_CAPTURE_FAILED`; emit `CaptureFailed` event; browser state unchanged; caller may retry immediately |
| Overlay injection failure | Return `BR_OVERLAY_INJECTION_FAILED`; page continues functioning without overlay; caller may retry after investigating CSP or DOM issues |
| Console error spike (page issue) | Publish `ConsoleError` events; do not degrade browser state; diagnostics reflect the spike |
| Single page crash | Publish `PageError`; if active page crashed, recreate page at last known URL; if non-active page crashed, close it silently |

### Fatal Failures

| Failure | Recovery Strategy |
|---------|-------------------|
| Browser process crash/disconnect | Emit `BrowserDisconnected`; invalidate all handles; caller must `launch()` a new instance; previous captures remain on disk |
| Launch failure after retry | Return `BR_LAUNCH_FAILED`; no handles exist; caller must notify user and suggest checking Playwright/Chromium installation |
| Multiple consecutive page crashes | Degrade health to `degraded`; suggest browser restart via diagnostics |

### Downstream Component Guidance

* When VCE receives `BrowserDisconnected`, it must discard any in-progress context assembly and await a new `BrowserStarted` event before requesting captures
* When Event Bus receives events from a handle that has been invalidated, it should drop them (handles carry a monotonic generation counter for deduplication)
* Browser Runtime never initiates recovery actions — it reports failures and leaves orchestration to VCE and CLI

---

## Compatibility

### Breaking Change Policy

* Any change that modifies the `BrowserRuntime` interface signature (add/remove/rename methods, change parameter types, change return types) is a breaking change
* Any change that modifies the schema of a published event payload is a breaking change
* Any change that adds a new required configuration key is a breaking change
* Internal refactors that preserve the public API, event schemas, and configuration contract are non-breaking

### Migration Strategy

* Breaking changes require a new interface version (`BrowserRuntimeV2`) or a new event schema version
* Old interface/schemas remain supported for one major version after deprecation
* Deprecation is announced in release notes with migration guide

### Deprecation Window

* Deprecated features remain functional for at least one major version
* Deprecation warnings are logged at `WARN` level for one version before removal

---

## Testing Requirements

### Unit Tests

* Mock Playwright; verify `launch()` creates browser, context, and page in correct order
* Mock Playwright; verify `shutdown()` closes page, context, and browser process in correct order
* Mock Playwright; verify `navigate()` calls `page.goto()` with correct URL
* Mock Playwright; verify `setViewport()` calls `page.setViewportSize()` with correct dimensions
* Verify viewport dimensions are validated (reject negative, zero, or excessively large values)
* Verify URL validation rejects non-HTTP protocols, malformed URLs, and empty strings
* Verify `captureScreenshot()` with type `'viewport'` calls `page.screenshot()` without `fullPage`
* Verify `captureScreenshot()` with type `'full-page'` calls `page.screenshot()` with `fullPage: true`
* Verify `injectOverlay()` creates Shadow DOM with `__viskod_` prefixed classes
* Verify `removeOverlay()` removes Shadow DOM and leaves page unchanged
* Verify events are published to Event Bus on state changes (mock Event Bus, verify `publish` called)
* Verify events are NEVER published to named subscribers (no direct subscriber method calls)
* Verify `health()` returns `BrowserHealth` with correct status based on internal state
* Verify `getDOMSnapshot()` filters out `script`, `style`, and `__viskod_` prefixed nodes
* Verify `getConsoleErrors()` returns structured `ConsoleError[]` with truncated messages

### Integration Tests

* Launch real Chromium; verify `BrowserStarted` event is emitted with correct `contextId`
* Navigate to a test HTML page served on localhost; verify `PageLoaded` event is emitted
* Capture a viewport screenshot; verify file exists at `.viskod/captures/{captureId}.png` with non-zero size
* Capture a full-page screenshot; verify file dimensions match or exceed viewport dimensions
* Inject overlay into a test page; verify Shadow DOM is present; verify page bounding boxes are unchanged
* Remove overlay; verify Shadow DOM is absent; verify page DOM node count is unchanged
* Set viewport to 1024×768; verify `ViewportChanged` event payload contains correct dimensions
* Set viewport to 375×812 (mobile); verify `ViewportChanged` event reflects mobile dimensions
* Trigger a console error in the test page; verify `ConsoleError` event is published with correct message
* Shutdown browser; verify `BrowserStopped` event is emitted; verify no orphan Chromium processes remain
* Kill Chromium process externally; verify `BrowserDisconnected` event is emitted within 5 seconds

### Contract Tests

* `BrowserRuntime` TypeScript interface exactly matches the `BrowserRuntime` interface defined in `docs/browser-runtime.md` §Public API
* All event payload schemas match the schemas defined in the Events Published table above
* All error codes conform to the error model defined in SPEC-003
* All configuration keys map to the Configuration section above

### End-to-End Acceptance Criteria

* Developer runs `viskod start` → CLI → Project Scanner → Browser Runtime → VCE → Studio → MCP Server → Ready. Browser Runtime launches Chromium within 5s and emits `BrowserStarted`.
* Developer clicks a UI element in the Studio → Selection Engine → Overlay Manager → `highlightElement()` → element is highlighted on screen.
* Developer triggers a capture → VCE calls `captureScreenshot()` → screenshot saved to disk → `CaptureCompleted` event published → Context Packet generated by VCE.
* Developer closes Viskod → CLI calls `shutdown()` → browser process terminated cleanly → no orphan Chromium processes.

---

## Acceptance Criteria

- [ ] `launch()` starts Chromium and returns `BrowserHandle` within 5000 ms (cold start, p95)
- [ ] `navigate()` loads URL and emits `PageLoaded` event to Event Bus (not called directly on subscribers)
- [ ] `captureScreenshot()` produces valid PNG file in `.viskod/captures/` with non-zero size
- [ ] `captureScreenshot()` supports all three types: `viewport`, `selection`, `full-page`
- [ ] `injectOverlay()` injects Shadow DOM without affecting application page layout (verified by bounding-box comparison)
- [ ] `injectOverlay()` uses `__viskod_` namespaced CSS classes only
- [ ] `removeOverlay()` removes overlay leaving page DOM node count unchanged (verified by pre/post comparison)
- [ ] `highlightElement()` applies visual highlight to the specified element
- [ ] `clearHighlight()` removes highlight from previously highlighted element
- [ ] `getDOMSnapshot()` returns valid `DOMSnapshot` tree for any valid selector
- [ ] `getDOMSnapshot()` filters out `script`, `style`, and `__viskod_` prefixed overlay nodes
- [ ] `getComputedStyles()` returns a `Record<string, string>` of computed CSS properties
- [ ] `getDiagnostics()` returns `BrowserDiagnostics` with `consoleErrors`, `pageErrors`, and `memoryUsage`
- [ ] `getConsoleErrors()` returns structured `ConsoleError[]` with truncated messages and sanitised URLs
- [ ] All lifecycle events published to Event Bus via `eventBus.publish(event)` — never called directly on subscribers
- [ ] `BrowserStarted`, `BrowserStopped`, `PageLoaded`, `NavigationCompleted`, `BrowserDisconnected` events published at correct lifecycle points
- [ ] `ViewportChanged`, `SelectionChanged`, `CaptureStarted`, `CaptureCompleted`, `CaptureFailed` events published at correct operation points
- [ ] `DiagnosticsUpdated`, `ConsoleError` events published when diagnostics are collected
- [ ] Browser Runtime NEVER imports `@viskod/visual-context-engine`, `@viskod/mcp-server`, `@viskod/project-scanner`, `@viskod/source-hint-engine`, or `@viskod/studio` (verifiable by build tool / dependency cruiser)
- [ ] Browser Runtime NEVER calls VCE methods directly (verifiable by static analysis)
- [ ] Browser contexts are isolated — cookies and storage are not shared across projects
- [ ] `shutdown()` terminates Chromium process cleanly — no orphan processes remain (verified by process list)
- [ ] All errors return structured `ViskodError` objects conforming to SPEC-003
- [ ] `health()` returns correct status based on actual browser state
- [ ] `setViewport()` applies viewport changes within 100 ms (p95)
- [ ] Overlay highlight update completes within 16 ms (single frame budget, p95)

---

## Open Implementation Decisions

| ID | Topic | Decision Record | Status |
|----|-------|----------------|--------|
| DEC-004 | IPC between browser process and main process (shared with Event Bus) | `decisions/DEC-004.md` | Not yet created |
| DEC-005 | Overlay injection strategy (script injection via `page.addScriptTag()` vs CDP `Page.addScriptToEvaluateOnNewDocument`) | `decisions/DEC-005.md` | Not yet created |
| — | DOM snapshot serialisation depth limit | To be determined during implementation | Open |
| — | Screenshot file naming convention (`{captureId}.png` vs `{timestamp}_{type}.png`) | To be determined during implementation | Open |
| — | Event debouncing strategy for rapid viewport changes | To be determined during implementation | Open |

---

## Implementation Sequence

1. Define full `BrowserRuntime` TypeScript interface (`packages/browser-runtime/src/browser-runtime.ts`)
2. Implement Runtime Manager (lifecycle coordination, health monitoring)
3. Implement Browser Manager (launch Chromium via Playwright, reconnect, close, restart)
4. Implement Context Manager (create isolated browser contexts, destroy, storage isolation)
5. Implement Page Manager (active page tracking, navigation, reload, history)
6. Implement Viewport Manager (set/get viewport, presets, validation)
7. Implement Screenshot Manager (viewport, selection, full-page capture)
8. Implement Overlay Manager (inject Shadow DOM, `__viskod_` CSS classes, remove)
9. Implement DOM snapshot serialisation (recursive tree, filtering, text truncation)
10. Implement computed styles retrieval (filtering, normalisation)
11. Implement Diagnostics Manager (console error capture, page error capture, memory tracking)
12. Implement Event Dispatcher (publish all events to Event Bus; never call subscribers directly)
13. Implement error handling (all error codes, retry logic, handle invalidation)
14. Write unit tests (mock Playwright, verify all flows)
15. Write integration tests (real Chromium, test HTML pages, verify end-to-end)
16. Write contract tests (verify interface matches spec, event schemas match, error codes conform)
17. Integrate with Event Bus (SPEC-007) — verify events flow correctly to VCE (SPEC-009)
18. Validate build tool enforces import restrictions (no VCE, MCP, Project Scanner imports)

---

## Definition of Done

- [ ] `BrowserRuntime` TypeScript interface matches this specification exactly
- [ ] All methods implemented with correct signatures, preconditions, postconditions, and error handling
- [ ] All event schemas defined and published to Event Bus at correct lifecycle points
- [ ] Overlay injection uses Shadow DOM with `__viskod_` prefixed classes
- [ ] Browser contexts are isolated per project
- [ ] All configuration keys are read from SPEC-004 with correct defaults
- [ ] Unit tests pass (mocked Playwright, verified event publishing)
- [ ] Integration tests pass (real Chromium, verified screenshots, events, overlay, shutdown)
- [ ] Contract tests pass (interface matches spec, event schemas match, error codes conform)
- [ ] Build tool verifies no forbidden imports (`@viskod/visual-context-engine`, `@viskod/mcp-server`, etc.)
- [ ] Lint passes (`biome check`)
- [ ] TypeScript strict mode passes with zero errors
- [ ] Performance benchmarks recorded and within budget
- [ ] Documentation in `docs/browser-runtime.md` reflects implementation (if any implementation-driven corrections needed)
- [ ] No orphan Chromium processes on shutdown

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Playwright version compatibility breaks API surface | Low | High | Pin Playwright version; test against Playwright releases in CI; Browser Runtime wraps Playwright so internal adaptation is possible |
| Chromium launch time exceeds 5s on CI/low-resource machines | Medium | Medium | Configurable timeout; warm-start path for reconnects; cold-start budget is a target, not a hard block |
| Overlay injection conflicts with page Content Security Policy | Medium | Medium | DEC-005 will determine CDP vs script injection strategy; CDP bypasses CSP; fallback to non-overlay mode |
| Shadow DOM overlay affects page layout on edge-case CSS (e.g., `:host`, `*` selectors) | Low | Medium | Integration tests verify bounding boxes pre/post injection; `all: initial` on Shadow DOM root |
| Browser context isolation insufficient for same-origin iframes | Low | Low | Browser contexts provide process-level isolation in Chromium; iframe isolation is a separate concern handled by page-level policies |

