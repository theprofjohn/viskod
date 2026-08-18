
> **Browser Runtime Specification**
>
> Version: 1.0
>
> Status: **Locked**

---

# Purpose

The Browser Runtime is responsible for interacting with a live browser instance.

It provides the execution environment that enables Viskod to observe a running application without modifying its source code.

This document specifies:

* runtime responsibilities
* browser lifecycle
* page lifecycle
* viewport management
* overlay architecture
* capture interfaces
* event model
* isolation guarantees

---

# Design Philosophy

The Browser Runtime is an execution engine.

It is **not**:

* a browser abstraction library
* a DOM parser
* a visual analysis engine
* an MCP server

Its only responsibility is to safely observe and control a browser session.

---

# Responsibilities

The Browser Runtime owns:

* browser processes
* browser contexts
* tabs
* pages
* navigation
* viewport configuration
* overlay injection
* screenshots
* browser events
* runtime diagnostics

No other package should communicate directly with Playwright.

---

# Runtime Architecture

```text id="p0ax0w"
Browser Runtime

├── Runtime Manager
├── Browser Manager
├── Context Manager
├── Page Manager
├── Viewport Manager
├── Overlay Manager
├── Screenshot Manager
├── Event Dispatcher
└── Diagnostics Manager
```

Each subsystem has a single responsibility.

---

# Runtime Manager

The Runtime Manager coordinates the lifecycle of the Browser Runtime.

Responsibilities:

* initialise services
* start runtime
* stop runtime
* recover failures
* monitor health

It does not perform browser operations directly.

---

# Browser Manager

Browser Manager owns the browser process.

Responsibilities

* launch Chromium
* reconnect to existing sessions
* close browser
* restart browser
* browser health monitoring

Only one Browser Manager exists per runtime.

---

# Context Manager

Every project executes inside its own browser context.

Responsibilities

* create contexts
* destroy contexts
* isolate storage
* isolate cookies
* isolate permissions

Contexts should never be shared across unrelated projects.

---

# Page Manager

The Page Manager owns all open pages.

Responsibilities

* active page tracking
* page discovery
* navigation
* reload
* lifecycle events

Exactly one page is designated as the active inspection target.

---

# Page Lifecycle

```text id="6ziv9k"
Page Created

↓

Navigate

↓

Load

↓

Ready

↓

Interactive

↓

Inspectable

↓

Closed
```

Inspection begins only after the page reaches a stable state.

---

# Viewport Manager

Viewport Manager controls rendering conditions.

Supported presets

```text id="s8h8ic"
Desktop

Laptop

Tablet

Mobile

Custom
```

Viewport changes should not invalidate the Browser Runtime.

---

# Overlay Manager

Overlay Manager renders the visual selection layer.

Responsibilities

* hover indicators
* selection borders
* measurement overlays
* labels
* hit testing

The overlay must remain visually isolated from the inspected application.

---

# Overlay Requirements

The overlay must:

* never affect layout
* never intercept application logic
* remain removable
* support high-DPI displays
* scale with zoom
* remain accessible

---

# Screenshot Manager

Screenshot Manager coordinates browser screenshot operations.

Supported capture types

```text id="svwghf"
Viewport

Selection

Full Page
```

Each capture receives a globally unique identifier.

---

# Navigation Model

Supported navigation methods

* URL navigation
* reload
* history back
* history forward

Future versions may support multi-tab workflows.

---

# Browser Events

The runtime publishes events to the Event Bus. These events are consumed by subscribing subsystems including the Visual Context Engine and Selection Engine. The Browser Runtime never knows which subscribers receive its events.

Published events include:

```text id="h1srf5"
BR_EVENT:BROWSER_STARTED

BR_EVENT:BROWSER_STOPPED

BR_EVENT:PAGE_LOADED

BR_EVENT:VIEWPORT_CHANGED

BR_EVENT:SELECTION_CHANGED

BR_EVENT:CAPTURE_COMPLETED
```

Events are immutable and ordered.

---

# Diagnostics

Runtime diagnostics include:

* browser crashes
* page crashes
* console errors
* network failures
* Playwright exceptions
* timeout events

Diagnostics are forwarded to the Context Engine but never interpreted here.

---

# Timeout Policy

Operations should use bounded execution.

Examples

* page load
* screenshot
* overlay injection
* navigation

No operation should wait indefinitely.

---

# Failure Recovery

Recoverable failures include:

* page reload
* browser reconnect
* overlay reinjection
* retrying captures

Fatal failures require runtime restart.

---

# Isolation

The Browser Runtime operates inside a strict boundary.

It should not:

* inspect project files
* infer source locations
* analyse design systems
* construct Context Packets

Those responsibilities belong to other packages.

---

# Performance Targets

Browser startup

```text id="70cfm6"
<5 seconds
```

Viewport update

```text id="h4i6e7"
<100 ms
```

Screenshot capture

```text id="jlwm5d"
<300 ms
```

Overlay update

```text id="pdijm7"
<16 ms
```

Targets should be validated through automated benchmarks.

---

# Extensibility

Future runtime capabilities may include:

* Firefox support
* WebKit support
* multiple browser sessions
* remote browser targets
* mobile device emulation
* accessibility overlays

Extensions should integrate through well-defined managers rather than modifying existing components.

---

# Relationship to Other Documents

This document specifies the Browser Runtime subsystem. It is complemented by:

* [Architecture](./architecture.md) — system boundaries and dependency direction
* [Glossary](./glossary.md) — canonical terminology
* [Visual Context Engine](./visual-context-engine.md) — consumes Browser Runtime output
* [Overlay System](./overlay-system.md) — architectural overlay concept
* [Selection Engine](./selection-engine.md) — converts pointer events to selections
* [Capture Pipeline](./capture-pipeline.md) — persists screenshots and captures
* [Diagnostics](./diagnostics.md) — runtime health reporting
* [Events](./events.md) — event-based communication model

---

# Browser Runtime North Star

The Browser Runtime exists to provide a reliable, deterministic and isolated interface to a live browser.

Its responsibility ends at observation and control.

Interpretation, reasoning and context generation belong to higher layers of the Viskod architecture.
