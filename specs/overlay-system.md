# Overlay System

> **Specification ID:** SPEC-022
> **Version:** 1.0
> **Status:** Draft
> **Owner:** Viskod Engineering
> **Last Updated:** 2026-07-28

---

## Architecture Sources

```
* docs/overlay-system.md — full subsystem specification (Purpose, Responsibilities, Design Philosophy, Overlay Types, Rendering Layer, Event Handling, Performance, Extensibility, Invariants)
* docs/architecture.md §Overlay System — architectural concept and runtime boundaries; clarifies Overlay System is the architectural concept, Overlay Manager is the Browser Runtime component that renders it
* docs/architecture.md §Overlay Isolation — namespaced classes, Shadow DOM, isolated styles, isolated event handlers
* docs/architecture.md §Selection Engine — selection pipeline (Pointer → Hovered Node → Candidate Validation → Selection → Highlight → Capture Request)
* docs/architecture.md §Selection Levels — Phase 1: Element, Container; Future: Component, Section, Layout, Region
* docs/ARCHITECTURE_BASELINE.md §Canonical Subsystem Names — "Overlay System" is the canonical name; "Overlay Manager" is the Browser Runtime internal component
* docs/ARCHITECTURE_BASELINE.md §Runtime Boundaries — Browser Runtime owns overlays; overlay injection is a Browser Runtime responsibility
* docs/glossary.md §Overlay — a visual annotation rendered on top of captured browser content by the Overlay System
* docs/glossary.md §Overlay System — injects visual indicators into the inspected page without modifying application behaviour, layout, or style; the Browser Runtime's Overlay Manager implements the Overlay System at runtime
* docs/glossary.md §Selection Engine — validates DOM node candidates, manages selection state, coordinates with Browser Runtime and Studio through the Event Bus
```

---

## Dependencies

| Specification | Status | Relationship |
|--------------|--------|-------------|
| SPEC-002 (shared-types) | Approved | Consumes BoundingBox type; defines OverlayState, OverlayCommands, OverlayEvents schemas |
| SPEC-003 (error-model) | Approved | Error codes OV_INJECTION_FAILED, OV_ELEMENT_NOT_FOUND, OV_SELECTOR_INVALID, OV_OVERLAY_DETECTED |
| SPEC-008 (browser-runtime) | Approved | Browser Runtime injects the overlay script via addScriptTag; bridges overlay postMessage events to the Event Bus |
| SPEC-011 (selection-engine) | Draft (P1, not yet written) | SelectionTarget interface enrichment (validation status, candidate scores, hierarchy); when SPEC-011 is approved, full selection validation is added |

---

## Consumers

| Specification | Status | Relationship |
|--------------|--------|-------------|
| SPEC-009 (visual-context-engine) | Draft | Subscribes to SelectionChanged events published by Browser Runtime after overlay emits element-clicked |
| SPEC-023 (studio) | Draft | Displays overlay state (visible/hidden, mode, highlighted element); subscribes to overlay state changes via Event Bus |

---

## Purpose

The Overlay System provides non-intrusive visual feedback inside the inspected browser page. It renders highlights, labels, measurement guides, and diagnostic overlays above the inspected application without modifying the application's behaviour, layout, or state. The Overlay System is purely visual — it observes without interfering. The inspected application must never know the overlay exists.

This specification defines the exact runtime boundary, injected script interface, data models, state transitions, command and event flows, error handling, security requirements, and performance budgets for the Overlay System. It covers the Phase 1 vertical slice scope: hover highlight and element selection via click. Diagnostic overlays, measurement overlays, layout overlays, and hierarchy visualization are defined in this specification's data model but deferred to later Phases.

---

## Scope

* Shadow DOM injection and lifecycle management in the inspected page context
* CSS isolation via `__viskod_` namespace prefix on all classes and IDs
* Hover mode: element highlight at pointer position with label display
* Selection mode: persistent element highlight after click
* Diagnostic mode: bounding box and spacing overlay rendering (Phase 2+)
* Click and hover event capture with element resolution (document.elementFromPoint)
* postMessage communication bridge to Browser Runtime
* Element resolution via hide-detect-show pattern (avoids self-detection)
* Overlay state management (visible, mode, highlighted element, label)
* Clean removal of all DOM/CSS/event artifacts
* Error handling for injection failures, element-not-found, invalid selectors

---

## Non-Goals

* Full selection validation — deferred to SPEC-011 (selection-engine); this spec handles raw click→element mapping only
* Candidate scoring, hierarchy enrichment of SelectionTarget — SPEC-011 responsibility
* Measurement overlays (distance between elements) — deferred to Phase 2
* Layout overlays (flex/grid visualization) — deferred to Phase 2
* Hierarchy overlays (parent/child/nesting depth visualization) — deferred to Phase 2
* Accessibility visualisation overlays — deferred to Phase 2
* Visual diff overlays — deferred to Phase 2
* Overlay configurability beyond mode toggle (Phase 1 uses sensible defaults)
* User-customizable overlay colours — Phase 1 uses fixed palette
* Overlay state persistence across Browser Runtime restarts

---

## Terminology

All canonical terms reference `docs/glossary.md`. Implementation-specific terms defined here:

| Term | Definition |
|------|-----------|
| Overlay Script | The self-contained JavaScript string injected into the inspected page via Playwright addScriptTag. No module imports, no network requests, no eval(). |
| Overlay Manager | The Browser Runtime component that owns overlay injection, lifecycle, and command dispatch. Implements the Overlay System architectural concept at runtime. |
| Overlay Host | The `<div id="__viskod_overlay_root">` element attached to document.body that hosts the Shadow DOM root. |
| Hide-Detect-Show Pattern | The technique where the overlay hides itself, calls document.elementFromPoint(x, y), then shows itself — preventing the overlay from detecting its own DOM nodes. |
| Event Layer | A transparent `<div>` in the Shadow DOM that captures click/hover events without intercepting page interactions (uses stopPropagation during selection mode only). |
| Highlight Layer | The Shadow DOM layer containing the highlight box (coloured border/overlay around the selected element) and label element. |
| Diagnostics Layer | The Shadow DOM layer containing bounding box and spacing overlay visualizations. |

---

## Runtime Boundary

| Boundary | Value |
|----------|-------|
| Execution context | Injected into inspected page (runs in browser page context) |
| Script source | Injected by Browser Runtime via Playwright addScriptTag |
| Process | Browser renderer process (untrusted page context) |
| DOM isolation | Shadow DOM (open mode for debug, closed mode for production) |
| CSS namespace | All classes and IDs prefixed with `__viskod_` |
| Imports allowed | None (self-contained script string; no ES modules, no dynamic import(), no <script type="module">) |
| Network access | Forbidden (no fetch, no XMLHttpRequest, no WebSocket) |
| Communication | Sends messages to Browser Runtime via window.postMessage or Playwright event bridge; NEVER publishes directly to Event Bus |
| Forbidden access | Must not read application DOM, write application DOM, access application window properties (window.myApp, etc.), access application globals, read localStorage, read sessionStorage, read cookies, access IndexedDB |
| Trust level | Untrusted (runs in potentially hostile page context; all outgoing messages validated by Browser Runtime) |
| Lifecycle owner | Browser Runtime (creates, commands, destroys) |

---

## Responsibilities

| Responsibility | Description | Verification |
|---------------|-------------|-------------|
| Highlight hovered elements | Render a coloured border/overlay at the bounding box of the element under the pointer, updated in real-time as the pointer moves | Hover highlight appears under pointer within 8ms of movement |
| Display element labels | Show a tooltip/label near the highlighted element with tag name (and optionally computed role, dimensions) | Label appears adjacent to highlight, updates synchronously |
| Capture click events for selection | Intercept clicks on the event layer, resolve the underlying element, emit overlay:element-clicked with selector and bounding box | Click event produces correct selector string |
| Intercept pointer events for hover | Capture pointer movement on the event layer, resolve elements, emit overlay:element-hovered with selector and bounding box | Hover events emitted at 60 FPS target |
| Maintain CSS isolation | All overlay CSS rules must be scoped within Shadow DOM and use `__viskod_` namespace prefix on all class names and IDs | No overlay style leaks to page; no page style affects overlay |
| Prevent page interaction during selection | On click during selection mode, call stopPropagation to prevent the inspected application from receiving the click | Application never receives click events intended for overlay selection |
| Advertise readiness | Emit overlay:ready event once Shadow DOM is attached and event listeners are registered | Browser Runtime receives overlay:ready before sending any commands |
| Clean removal | Remove Shadow DOM root, all event listeners, and all DOM artifacts on dispose; no CSS, no detached DOM nodes, no lingering event handlers | Zero artifacts after overlay:remove; verified by DOM inspection |

---

## Interfaces

### Public API — Overlay Script API (injected into page)

Commands received from Browser Runtime (via postMessage). All messages have the shape:

```typescript
interface OverlayMessage {
  type: string;   // command name, e.g. 'overlay:show'
  payload: unknown; // command-specific payload
}
```

| Command | Payload | Purpose | Preconditions | Postconditions | Errors |
|---------|---------|---------|---------------|----------------|--------|
| `overlay:show` | `{ mode: 'hover' \| 'selection' }` | Make the overlay visible in the specified mode | Shadow DOM must be attached (overlay:ready emitted) | Overlay is visible; event layer is active in the specified mode | OV_INJECTION_FAILED if Shadow DOM not attached |
| `overlay:hide` | `{}` | Hide the overlay without removing DOM | Overlay must be showing | Overlay is hidden (display: none on host); overlay state preserved | None |
| `overlay:highlight` | `{ selector: string; color?: string; label?: string }` | Highlight a specific element by CSS selector | Selector must resolve to an element in the page DOM | Highlight box rendered at element's bounding box; label displayed if provided | OV_SELECTOR_INVALID if selector does not resolve to an element |
| `overlay:clear` | `{}` | Clear all highlights, labels, and diagnostic overlays | Overlay DOM must exist | Highlight layer cleared; labels removed; diagnostics hidden | None |
| `overlay:measure` | `{ fromSelector: string; toSelector: string }` | Measure distance between two elements (Phase 2) | Both selectors must resolve to page elements | Deferred to Phase 2 | Deferred to Phase 2 |
| `overlay:label` | `{ selector: string; text: string; position?: 'top' \| 'bottom' \| 'left' \| 'right' }` | Display a tooltip/label near an element | Selector must resolve to an element | Label rendered adjacent to element in specified position (default: top) | OV_SELECTOR_INVALID if selector does not resolve |
| `overlay:diagnostics` | `{ show: boolean; showBoundingBoxes?: boolean; showSpacing?: boolean }` | Toggle diagnostic overlay display (Phase 2) | Overlay DOM must exist | Deferred to Phase 2 | Deferred to Phase 2 |
| `overlay:inspect` | `{ x: number; y: number }` | Resolve element at viewport coordinates (for hover) | x, y must be within viewport bounds | Element resolved via hide-detect-show pattern; overlay:element-hovered emitted | OV_ELEMENT_NOT_FOUND if document.elementFromPoint returns null |

### Events Published

Events emitted by the overlay script to Browser Runtime (via postMessage). Browser Runtime bridges these to the Event Bus as SelectionChanged events.

| Event | Payload Schema | When Published |
|-------|---------------|----------------|
| `overlay:ready` | `{}` | After Shadow DOM attached to document.body and all event listeners registered |
| `overlay:element-clicked` | `{ selector: string; boundingBox: BoundingBox; tagName: string }` | When user clicks on an element in the event layer during selection mode; after stopPropagation |
| `overlay:element-hovered` | `{ selector: string; boundingBox: BoundingBox; tagName: string }` | When pointer moves over a new element in the event layer during hover mode; emitted at most once per distinct element, with debounce (see Performance Budget) |

Where:

```typescript
interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

### Events Subscribed

The overlay script subscribes to no events from the Event Bus. It receives commands exclusively via postMessage from the Browser Runtime.

| Event | Source | Action |
|-------|--------|--------|
| (none) | — | The overlay script is a leaf node in the communication graph. It only receives commands from Browser Runtime via postMessage. |

---

## Data Models

### OverlayState

```typescript
interface OverlayState {
  visible: boolean;
  mode: 'hover' | 'selection' | 'diagnostics' | 'hidden';
  highlightedSelector?: string;
  highlightedBoundingBox?: BoundingBox;
  labelText?: string;
  labelPosition?: 'top' | 'bottom' | 'left' | 'right';
  diagnosticsVisible: boolean;
  diagnosticOptions?: {
    showBoundingBoxes: boolean;
    showSpacing: boolean;
  };
}
```

### OverlayMode

```typescript
type OverlayMode = 'hover' | 'selection' | 'diagnostics' | 'hidden';
```

- **hover**: Element under pointer is highlighted with a temporary border; label shows tag name; highlight moves with pointer
- **selection**: Clicked element is highlighted with a persistent border; previous selection cleared before new one applied; only one selection highlight at a time
- **diagnostics**: Bounding boxes and/or spacing overlays shown; diagnostics layer visible (Phase 2+)
- **hidden**: Shadow DOM host display:none; overlay DOM exists but not visible; no events emitted

### Shadow DOM Structure

```
<div id="__viskod_overlay_root">  ← Shadow DOM host attached to document.body
  #shadow-root (closed in production, open in debug mode)
    <style>
      /* All CSS rules use __viskod_ prefixed class selectors only */
    </style>

    <div id="__viskod_highlight_layer">
      <div id="__viskod_highlight_box" class="__viskod_highlight" />
      <div id="__viskod_label" class="__viskod_label" />
    </div>

    <div id="__viskod_diagnostics_layer">
      <div id="__viskod_bounding_boxes" />
      <div id="__viskod_spacing_overlays" />
    </div>

    <div id="__viskod_event_layer">
      <!-- Transparent full-viewport layer for capturing click/hover events -->
      <!-- pointer-events: none during hover mode; pointer-events: auto during selection mode -->
    </div>
</div>
```

### SelectionTarget (P0 alias — consumed from SPEC-009)

```typescript
interface SelectionTarget {
  selector: string;
  boundingBox: BoundingBox;
}
```

When SPEC-011 (selection-engine) is approved, SelectionTarget is enriched with:

```typescript
interface EnrichedSelectionTarget extends SelectionTarget {
  validationStatus: 'valid' | 'invalid' | 'uncertain';
  candidateScore?: number;       // 0.0–1.0 confidence
  hierarchy?: HierarchyNode;     // parent/child context
}
```

The overlay publishes raw `element-clicked` events; the Selection Engine (SPEC-011) validates and enriches them. SPEC-022 does not depend on this enrichment for vertical slice functionality.

### CSS Namespace Rules

All CSS class names and IDs used in the Shadow DOM must start with `__viskod_`. This is a build-time and review-time invariant; it must be verifiable via automated test.

| Valid | Invalid |
|-------|---------|
| `__viskod_highlight` | `highlight` |
| `__viskod_label` | `viskod-label` |
| `__viskod_overlay_root` | `overlay-root` |
| `__viskod_event_layer` | `event-layer` |

---

## State Model

### State Transitions

```
                    ┌─────────────┐
                    │ Initialised │
                    └──────┬──────┘
                           │ Shadow DOM attached,
                           │ event listeners registered
                           ▼
         ┌─────────────── Ready ───────────────┐
         │             overlay:ready emitted    │
         │                                      │
    overlay:show                          overlay:show
    {mode:'hover'}                        {mode:'selection'}
         │                                      │
         ▼                                      ▼
┌─────────────────┐                    ┌──────────────────┐
│  Active:hover   │                    │ Active:selection │
│  ─────────────  │                    │  ──────────────  │
│  event layer    │                    │  event layer     │
│  pointer-events │                    │  pointer-events  │
│  : none         │                    │  : auto          │
│  highlight      │                    │  persistent      │
│  follows cursor │                    │  highlight       │
└────────┬────────┘                    └────────┬─────────┘
         │                                      │
    overlay:hide                           overlay:hide
         │                                      │
         └──────────────┬───────────────────────┘
                        ▼
                 ┌─────────────┐
                 │   Hidden     │
                 │  ─────────   │
                 │  host display│
                 │  : none      │
                 │  state       │
                 │  preserved   │
                 └──────┬───────┘
                        │
                   dispose()
                        │
                        ▼
                 ┌─────────────┐
                 │  Disposed    │
                 │  ─────────   │
                 │  Shadow DOM  │
                 │  removed     │
                 │  No DOM/CSS  │
                 │  artifacts   │
                 └─────────────┘

Active:diagnostics (Phase 2+):
  Ready → overlay:diagnostics {show:true} → Active:diagnostics
  Active:diagnostics → overlay:diagnostics {show:false} → Ready
```

### Invariants

| Invariant | Description |
|-----------|-------------|
| Single selection | At most one element in selection highlight state at any time; new selection clears previous |
| No dual mode | Overlay is in exactly one mode at a time; transitioning to a new mode exits the previous |
| Shadow DOM exists | All commands except overlay:show and overlay:hide require the Shadow DOM to be attached |
| Host in document.body | The overlay host element must be a direct child of document.body |
| No page DOM mutation | The overlay must never add, remove, or modify any DOM node outside its Shadow DOM |
| No style leakage | No CSS rule in the overlay Shadow DOM may match any element outside the Shadow DOM |
| Selector uniqueness | Generated CSS selectors must be unique enough to resolve to exactly one element; fallback: nth-child or data-attribute selectors |

### Lifecycle

```
Initialised → Ready → Active (hover|selection|diagnostics) → Hidden → Disposed
```

1. **Initialised**: Browser Runtime calls `page.addScriptTag({ content: overlayScript })`. Script executes, creates `<div id="__viskod_overlay_root">`, attaches Shadow DOM. Duration: < 16ms.
2. **Ready**: `overlay:ready` event emitted. Overlay accepts commands. Host element has `display: none`.
3. **Active**: Overlay visible in one of three modes. Commands accepted. Events emitted.
4. **Hidden**: Overlay host `display: none`. DOM structure preserved. State (highlighted element, label, diagnostics options) preserved. Accepts show/hide/inspect commands. Does not emit hover/click events.
5. **Disposed**: Shadow DOM removed from host. Host removed from document.body. All event listeners removed. No recovery possible — requires re-injection.

---

## Command Flows

### Hover Flow

```
User moves pointer
  │
  ▼
Browser Runtime detects pointer movement (via Playwright page event or injected listener)
  │
  ▼
Browser Runtime calls page.evaluate() with overlay:inspect { x, y }
  │
  ▼
Overlay event layer intercepts (pointer-events: none — does not block page)
  │
  ▼
Overlay executes hide-detect-show pattern:
  1. Set host display: none (hide overlay)
  2. Call document.elementFromPoint(x, y)
  3. Set host display to previous state (show overlay)
  4. If element found:
     a. Build unique CSS selector for element
     b. Get element bounding box via getBoundingClientRect()
     c. Position __viskod_highlight_box at bounding box
     d. Update __viskod_label with tag name
     e. Emit overlay:element-hovered { selector, boundingBox, tagName }
  5. If element not found (null from elementFromPoint):
     a. Do nothing (no event emitted, overlay unchanged)
  │
  ▼
Browser Runtime receives overlay:element-hovered via postMessage
  │
  ▼
Browser Runtime publishes SelectionChanged event to Event Bus (simple mode: raw pointer→element mapping, no validation)
  │
  ▼
Event Bus delivers to subscribers (VCE, Studio)
```

### Selection Flow

```
User clicks on element
  │
  ▼
Overlay event layer detects click (pointer-events: auto in selection mode)
  │
  ▼
Overlay captures event:
  1. event.stopPropagation() — prevent page from receiving click
  2. event.preventDefault() — prevent default browser behaviour
  │
  ▼
Overlay resolves element:
  1. Hide overlay (display: none on host)
  2. Call document.elementFromPoint(event.clientX, event.clientY)
  3. Show overlay (restore display)
  4. Build unique CSS selector for element
  5. Get bounding box via getBoundingClientRect()
  │
  ▼
Overlay renders selection highlight:
  1. Clear previous selection highlight (if any)
  2. Position __viskod_highlight_box at element bounding box
  3. Apply selection style (persistent border, distinct from hover style)
  4. Update __viskod_label with tag name
  │
  ▼
Overlay emits overlay:element-clicked { selector, boundingBox, tagName }
  │
  ▼
Browser Runtime receives overlay:element-clicked via postMessage
  │
  ▼
Browser Runtime publishes SelectionChanged event to Event Bus
  │
  ▼
Event Bus delivers to VCE → VCE triggers processSelection()
```

### Cleanup Flow

```
Browser Runtime calls overlay:hide
  │
  ▼
Overlay sets host display: none
  │
  ▼
Overlay clears all highlights and labels
  │
  ▼
Browser Runtime calls dispose (removes overlay):
  1. Remove all event listeners from Shadow DOM elements
  2. Detach Shadow DOM root from host element
  3. Remove host element from document.body
  4. Verify: no __viskod_ prefixed elements remain in document
  │
  ▼
No CSS artifacts remain (Shadow DOM fully encapsulates styles)
No event listeners remain (removed with Shadow DOM)
No detached DOM nodes remain
```

---

## Event Flows

```
Overlay Script (in page context)
  │
  │  postMessage({ type: 'overlay:element-clicked', payload: {...} })
  │
  ▼
Browser Runtime (in Node.js/Playwright process)
  │
  │  Validates payload schema (Zod)
  │  Sanity-checks origin
  │  Converts to internal SelectionChanged event
  │
  │  publish(SelectionChanged { selector, boundingBox, tagName })
  │
  ▼
Event Bus
  │
  ├──deliver──→ Visual Context Engine (subscriber) → triggers processSelection()
  │
  └──deliver──→ Studio (subscriber) → updates overlay state display in UI
```

**Critical invariant**: The Overlay Script NEVER publishes to the Event Bus directly. Browser Runtime is the sole bridge. The Overlay Script has no knowledge of the Event Bus, VCE, Studio, or any other Viskod subsystem. It only knows about postMessage to its parent (Browser Runtime).

---

## Error Behaviour

| Condition | Error Code | Message | Recovery |
|-----------|-----------|---------|----------|
| Shadow DOM attachment to document.body fails (e.g., document.body is null, page not loaded) | `OV_INJECTION_FAILED` | "Failed to attach Shadow DOM overlay host to document.body" | Browser Runtime retries once after 100ms delay; if still fails, returns error to caller; page navigation may trigger re-injection |
| document.elementFromPoint(x, y) returns null (pointer outside viewport or over browser chrome) | `OV_ELEMENT_NOT_FOUND` | "No element found at coordinates (x, y)" | No event emitted; overlay state unchanged; no retry (transient — next pointer movement resolves) |
| Invalid CSS selector provided to overlay:highlight or overlay:label (selector syntax error or does not resolve to any element) | `OV_SELECTOR_INVALID` | "CSS selector '<selector>' does not resolve to any element in the page" | Command rejected; log warning; no DOM change |
| Application JavaScript detects and removes overlay DOM (unlikely with Shadow DOM closed mode) | `OV_OVERLAY_DETECTED` | "Overlay DOM detected and potentially modified by application code" | Log warning; continue operating; if host element missing, attempt re-attachment once |
| Browser Runtime sends command before overlay:ready received (race condition) | `OV_NOT_READY` | "Overlay not ready: received command '<command>' before overlay:ready" | Browser Runtime queues command and retries after overlay:ready received |
| Host element removed from document.body by external mutation | `OV_HOST_REMOVED` | "Overlay host element removed from document" | Log warning; attempt re-attachment to document.body; if re-attachment fails, emit overlay:disconnected; Browser Runtime handles re-injection |
| postMessage fails (e.g., origin mismatch, page navigated away) | `OV_COMMUNICATION_FAILED` | "Failed to send overlay event: <event type>" | Log error; continue operating; events lost for this interaction |

---

## Security Requirements

### Trust Boundaries

```
┌──────────────────────────────────────────────────┐
│ Untrusted Zone: Inspected Page Context            │
│                                                    │
│  ┌──────────────────────────────────────────┐    │
│  │ Application DOM                          │    │
│  │ (untrusted — may contain malicious       │    │
│  │  scripts, event listeners, mutations)     │    │
│  └──────────────────────────────────────────┘    │
│                                                    │
│  ┌──────────────────────────────────────────┐    │
│  │ Overlay Script (Shadow DOM)              │    │
│  │ (untrusted context but controlled code)  │    │
│  │  ───────────────────────────────────    │    │
│  │  Must not:                               │    │
│  │  • read window.myApp or application      │    │
│  │    globals                               │    │
│  │  • read localStorage / sessionStorage    │    │
│  │  • read document.cookie                  │    │
│  │  • execute any code from the page        │    │
│  └────────────┬─────────────────────────────┘    │
│               │ postMessage                       │
└───────────────┼──────────────────────────────────┘
                │
    ════════════╪══════════════════ Trust Boundary
                │
┌───────────────▼──────────────────────────────────┐
│ Trusted Zone: Browser Runtime (Node.js)           │
│  • Validates all incoming postMessage             │
│  • Validates origin of messages                   │
│  • Sanitizes payloads before publishing to        │
│    Event Bus                                      │
└──────────────────────────────────────────────────┘
```

### Validation Rules

1. **Origin validation**: All postMessage events received by Browser Runtime must have their origin validated against the page URL. Messages from unexpected origins are silently discarded.
2. **Payload validation**: All incoming payloads validated against Zod schemas before processing. Unknown properties stripped. Type mismatches rejected.
3. **Selector safety**: CSS selectors must not contain JavaScript URIs, expression(), or other executable CSS constructs. Selectors must be plain CSS selector strings.
4. **Coordinate bounds**: x, y coordinates in overlay:inspect must be finite numbers within viewport dimensions (0 ≤ x ≤ viewportWidth, 0 ≤ y ≤ viewportHeight). Out-of-bounds coordinates rejected.
5. **Self-containment**: Overlay script string must contain no eval(), no new Function(), no dynamic code execution, no import(), no network APIs. Verified by static analysis at build time.
6. **No page code execution**: The overlay must never call application functions, read application variables, or evaluate strings from the page context.

### Sensitive Data Handling

* The overlay must never read or transmit: page textContent, innerHTML, attribute values other than those needed for selector construction (id, class, data-testid), form input values, image src attributes
* Hover and click events contain only: CSS selector string, bounding box coordinates, tag name — no text content, no attribute values, no child content
* The overlay must never access: document.cookie, localStorage, sessionStorage, IndexedDB, Cache API

### Capability Requirements

* The overlay script requires no permissions, no capabilities, no user grants
* It operates entirely within the sandbox of the page it is injected into
* It has the same origin permissions as the page (no elevated privileges)

---

## Privacy Requirements

### Data Collected

| Data | Purpose | Retention | Deletion |
|------|---------|-----------|----------|
| CSS selector string | Identify the element for downstream processing (VCE, Studio) | Ephemeral — transmitted via postMessage; not stored by overlay | N/A (never persisted) |
| Bounding box (x, y, width, height) | Position highlights and provide spatial context | Ephemeral — transmitted via postMessage; not stored by overlay | N/A (never persisted) |
| Tag name | Element type identification | Ephemeral — transmitted via postMessage; not stored by overlay | N/A (never persisted) |

### What Must Not Be Collected

* Page text content (textContent, innerText, innerHTML)
* Element attribute values (except id, class, data-testid for selector construction)
* Form input values
* Image URLs or src attributes
* Link href attributes
* Application state (window globals, React/Vue/Angular component state)
* localStorage, sessionStorage, IndexedDB contents
* Cookies
* Page URL (beyond what Browser Runtime already knows from navigation)
* User input (keystrokes, form fills, clipboard contents)

### Ephemeral Guarantee

* Overlay state is entirely ephemeral — no persistence mechanism exists in the overlay script
* No data written to any storage API
* All state lost on page navigation (Browser Runtime re-injects after NavigationCompleted)
* No logging of page data within the overlay

---

## Performance Budget

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Overlay injection (Shadow DOM creation + style injection + event listener registration) | < 16 ms (< 1 frame at 60 FPS) | `performance.now()` delta between script execution start and overlay:ready emit |
| Hover highlight update (hide→detect→show cycle + highlight positioning + label update) | < 8 ms | `performance.now()` delta for full overlay:inspect command handling |
| Selection highlight update (click handler + hide→detect→show + highlight rendering) | < 8 ms | `performance.now()` delta for full click-to-highlight pipeline |
| Overlay removal (Shadow DOM detachment + event cleanup + host removal) | < 5 ms | `performance.now()` delta for dispose() execution |
| elementFromPoint hide/detect/show cycle | < 5 ms | `performance.now()` delta for hide→elementFromPoint→show sequence only |
| Page load time impact | < 1 ms added to page load (measured as delta of performance.timing.loadEventEnd with/without overlay injection) | Performance Observer on page load events |
| Page paint time impact | Zero (Shadow DOM rendering isolated from page compositor) | Chrome DevTools Performance panel — verify no additional layout/paint on page frames |
| Page JavaScript execution impact | Zero (overlay runs in its own microtask context; no long tasks introduced) | Long Tasks API — verify no tasks > 50ms introduced by overlay |
| Hover event emission rate | Debounced: max 1 event per 16ms (~60 FPS), no event if element unchanged | Count events over 1s interval at max pointer movement |
| Memory overhead | < 100 KB (Shadow DOM nodes + style strings + event handlers) | Performance.memory.usedJSHeapSize delta before/after injection |
| CPU idle impact | < 0.5% CPU time when overlay is hidden (no hover/selection active) | Chrome DevTools Performance panel — long-term idle trace |

---

## Observability

### Log Events

All log events from the overlay are communicated to Browser Runtime via postMessage and logged by Browser Runtime's logging infrastructure. The overlay itself does not produce its own logs (no console.log allowed in page context to avoid detection).

| Event | Level | When | Payload |
|-------|-------|------|---------|
| `overlay.injected` | INFO | Overlay script executed, Shadow DOM attached | `{ injectionTimeMs: number }` |
| `overlay.ready` | INFO | `overlay:ready` event received by Browser Runtime | `{}` |
| `overlay.mode_changed` | DEBUG | Overlay mode transitioned | `{ from: OverlayMode; to: OverlayMode }` |
| `overlay.highlight_set` | DEBUG | Element highlighted | `{ selector: string; mode: string }` |
| `overlay.highlight_cleared` | DEBUG | Highlights cleared | `{}` |
| `overlay.element_clicked` | INFO | Element selection event received | `{ selector: string; tagName: string }` |
| `overlay.element_hovered` | DEBUG | Element hover event received | `{ selector: string; tagName: string }` |
| `overlay.disposed` | INFO | Overlay removed from page | `{}` |
| `overlay.error` | ERROR | Error during overlay operation | `{ code: string; message: string; command?: string }` |

### Diagnostic Signals

| Signal | Description | Access |
|--------|-------------|--------|
| Overlay health check | Verify overlay host element exists in document.body and Shadow DOM is attached | `page.evaluate(() => !!document.getElementById('__viskod_overlay_root')?.shadowRoot)` |
| Overlay mode | Current overlay mode (hover/selection/diagnostics/hidden) | Read from OverlayState |
| Injection latency | Time from addScriptTag call to overlay:ready received | Tracked by Browser Runtime |
| Last error | Most recent overlay error code and message | Read from Browser Runtime overlay diagnostics |

### Health Check Endpoints

No HTTP endpoints. Overlay health is exposed via Browser Runtime's diagnostic interface:

```typescript
interface OverlayHealth {
  injected: boolean;
  ready: boolean;
  mode: OverlayMode;
  hostAttached: boolean;
  lastError?: { code: string; message: string; timestamp: number };
  injectionLatencyMs: number;
  disposeCount: number;
}
```

### Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `overlay.injection.duration_ms` | Histogram | Distribution of overlay injection latencies |
| `overlay.hover.latency_ms` | Histogram | Distribution of hover highlight update latencies |
| `overlay.selection.latency_ms` | Histogram | Distribution of selection highlight latencies |
| `overlay.dispose.duration_ms` | Histogram | Distribution of overlay removal latencies |
| `overlay.errors.total` | Counter | Total overlay error count by error code |
| `overlay.events.total` | Counter | Total overlay events emitted by event type |

---

## Configuration

### Compile-Time Configuration (baked into overlay script)

| Key | Default | Description | Validation |
|-----|---------|-------------|------------|
| `CSS_NAMESPACE_PREFIX` | `"__viskod_"` | Prefix for all CSS class names and IDs | Must match `/^__[a-z]+_$/`; changing this requires updating all tests |
| `SHADOW_DOM_MODE` | `"closed"` | Shadow DOM mode (`"open"` for debug, `"closed"` for production) | Must be `"open"` or `"closed"` |
| `HOVER_HIGHLIGHT_COLOR` | `"rgba(59, 130, 246, 0.3)"` | Highlight colour for hover mode | Valid CSS colour string |
| `SELECTION_HIGHLIGHT_COLOR` | `"rgba(59, 130, 246, 0.5)"` | Highlight colour for selection mode | Valid CSS colour string |
| `HIGHLIGHT_BORDER_WIDTH` | `"2px"` | Border width for highlight box | Valid CSS length |
| `HOVER_DEBOUNCE_MS` | `16` | Minimum interval between hover events (ms) | Integer, 0–100; 16ms = 60 FPS target |
| `INJECTION_RETRY_DELAY_MS` | `100` | Delay before retrying failed injection | Integer, 0–1000 |
| `INJECTION_MAX_RETRIES` | `1` | Maximum injection retry attempts | Integer, 0–3 |
| `LABEL_FONT_FAMILY` | `"system-ui, -apple-system, sans-serif"` | Font for labels | Valid CSS font-family |
| `LABEL_FONT_SIZE` | `"12px"` | Font size for labels | Valid CSS font-size |
| `LABEL_BACKGROUND` | `"rgba(0, 0, 0, 0.8)"` | Background for labels | Valid CSS colour |
| `LABEL_TEXT_COLOR` | `"#ffffff"` | Text colour for labels | Valid CSS colour |

### Runtime Configuration (passed by Browser Runtime)

| Key | Default | Description |
|-----|---------|-------------|
| `debug` | `false` | When true, Shadow DOM mode is "open" and diagnostic logging is enabled |
| `initialMode` | `"hidden"` | Mode to enter after initialisation (hidden, hover, or selection) |

### Environment Variable Mappings

No environment variables. Overlay configuration is embedded at compile time. The overlay runs in the page context and has no access to environment variables, file system, or process.env.

---

## Failure and Recovery

### Overlay Injection Fails

**Cause**: document.body is null (page not finished loading), Shadow DOM API not available (pre-Chromium browser), or page CSP prevents inline scripts.

**Recovery**: Browser Runtime retries once after 100ms. If retry fails, error returned to caller with `OV_INJECTION_FAILED`. Browser Runtime subscribes to navigation events; on NavigationCompleted, re-attempts injection.

### Overlay DOM Mutated or Removed by Application

**Cause**: Application uses MutationObserver or DOM manipulation that removes the overlay host element. (Unlikely with Shadow DOM closed mode — the host is the only visible element; Shadow DOM internals are inaccessible.)

**Recovery**: The overlay script uses a MutationObserver on the host element's parent (document.body). If the host is removed, overlay emits `overlay:disconnected` via postMessage. Browser Runtime re-injects overlay after a 200ms debounce. This is a defense-in-depth measure; the primary protection is Shadow DOM isolation.

### Element Resolution Fails

**Cause**: document.elementFromPoint returns null (pointer over browser chrome, iframe boundary, or outside viewport).

**Recovery**: No event emitted. No state change. No retry. Transient — next pointer movement triggers a fresh resolution. This is normal operation, not an error condition requiring recovery.

### postMessage Communication Fails

**Cause**: Page navigated away mid-operation, origin mismatch, or browser tab closed.

**Recovery**: Event lost for that interaction. Browser Runtime detects page navigation/closing via Playwright events and cleans up overlay state. Next interaction after re-injection operates normally.

### Downstream Impact

| Failure | Impact on VCE | Impact on Studio |
|---------|---------------|-----------------|
| Overlay not injected | No hover/click events; VCE cannot detect selections | Studio shows "overlay not available" state |
| Overlay injected but hover fails | No hover highlights visible; VCE receives no SelectionChanged events | Studio shows no hover state |
| Overlay injected but click fails | No selection events; VCE cannot trigger processSelection | Studio shows no selection state |
| Overlay DOM removed by page | Same as "Overlay not injected" after `overlay:disconnected` | Same as above |

### Isolation Guarantee

A failure in the overlay must never:
- Crash the Browser Runtime
- Crash the inspected application
- Leak memory in the page context
- Leave event listeners attached to application DOM elements
- Leave CSS rules applied to application elements

---

## Compatibility

### Breaking Change Policy

* OverlayCommands and OverlayEvents interfaces are versioned with the overlay script
* Adding new optional fields to payloads is non-breaking and does not require a version change
* Removing fields, changing field types, or adding required fields is breaking and requires a version increment
* Changing the Shadow DOM structure is an internal concern and is non-breaking as long as the postMessage interface is preserved
* Changing CSS class name prefixes is breaking (requires updating all tests and any consumers that reference overlay classes)

### Migration Strategy for Breaking Changes

1. New overlay script version compiled with incremented version identifier
2. Browser Runtime supports both old and new overlay script versions during a transition window (one release cycle)
3. Consumers (VCE, Studio) updated to handle new event schemas
4. Old version support removed after transition window

### Deprecation Window

* One release cycle (typically one sprint / two weeks) for non-security changes
* Zero-day for security vulnerabilities (immediate patch release)

### Backwards Compatibility

* SPEC-022 v1.0 defines the initial overlay interface; no backwards compatibility obligations exist
* Future versions must not break the postMessage message shape (`{ type: string, payload: unknown }`) as this is a fundamental architectural invariant

---

## Testing Requirements

### Unit Tests

1. **Shadow DOM injection creates correct DOM structure**
   - Inject overlay script into empty page
   - Assert: element with id `__viskod_overlay_root` exists in document.body
   - Assert: Shadow DOM root attached to host
   - Assert: Shadow DOM contains elements: `__viskod_highlight_layer`, `__viskod_event_layer`, `__viskod_diagnostics_layer`
   - Assert: Shadow DOM contains `<style>` element

2. **elementFromPoint resolution works correctly (hide→detect→show pattern)**
   - Create a page with a known element at known coordinates
   - Call overlay:inspect at those coordinates
   - Assert: overlay hides itself before calling elementFromPoint (verify via display property check)
   - Assert: overlay restores display after elementFromPoint
   - Assert: returns correct element selector

3. **overlay:hide + overlay:show transitions maintain state**
   - Show overlay in hover mode
   - Highlight an element
   - Hide overlay
   - Assert: host display is "none"
   - Show overlay again
   - Assert: previous highlight state restored (selector, bounding box preserved)
   - Assert: mode preserved

4. **CSS class prefix enforcement (all classes start with __viskod_)**
   - Extract all CSS class selectors from overlay script's style string
   - Assert: every class selector starts with `__viskod_`
   - Assert: every ID selector starts with `__viskod_`

5. **Overlay removal leaves zero artifacts**
   - Inject overlay, show in selection mode, highlight an element
   - Call dispose
   - Assert: `document.getElementById('__viskod_overlay_root')` returns null
   - Assert: `document.querySelector('[class*="__viskod_"]')` returns null
   - Assert: `document.querySelector('[id*="__viskod_"]')` returns null

6. **Multiple overlay:highlight calls update correctly**
   - Highlight element A by selector
   - Highlight element B by selector
   - Assert: only element B is highlighted (element A highlight removed)
   - Assert: highlight box positioned at element B's bounding box

7. **overlay:element-clicked event contains correct data**
   - Create page with known element
   - Simulate click on that element via overlay event layer
   - Assert: event payload contains `selector` (valid CSS selector)
   - Assert: event payload contains `boundingBox` with numeric x, y, width, height
   - Assert: event payload contains `tagName` (non-empty string)

### Integration Tests

1. **Inject overlay into real page → verify page layout unchanged (screenshot diff)**
   - Load a reference page with known layout
   - Take screenshot before overlay injection
   - Inject overlay
   - Take screenshot after injection
   - Assert: pixel diff < 0.1% (allow for anti-aliasing variance)

2. **Hover element → verify highlight appears at correct position**
   - Load page with positioned element
   - Send overlay:inspect at element coordinates
   - Assert: highlight box bounding rect matches element bounding rect (within 1px tolerance)

3. **Click element → verify overlay:element-clicked event with correct selector**
   - Load page with element at known coordinates
   - Activate selection mode
   - Simulate click on event layer at element coordinates
   - Assert: event payload.selector resolves to the correct element via document.querySelector

4. **Remove overlay → verify no DOM artifacts remain**
   - Same as unit test #5 but executed against a complex real-world page (e.g., a React application)

5. **Overlay survives page navigation (Browser Runtime re-injects)**
   - Inject overlay on Page A
   - Navigate to Page B
   - Assert: Browser Runtime detects NavigationCompleted and re-injects overlay
   - Assert: overlay:ready event received after navigation

6. **Overlay does not read/write application storage**
   - Set known values in localStorage and sessionStorage before overlay injection
   - Inject overlay, perform hover and click operations
   - Assert: localStorage and sessionStorage values unchanged
   - Assert: document.cookie unchanged

7. **Overlay event handlers do not leak to page**
   - Inject overlay
   - Dispatch a custom event on document.body
   - Assert: overlay does not respond to page-dispatched events
   - Assert: page event listeners do not receive overlay-internal events

### Contract Tests

1. **OverlayCommands schema matches Browser Runtime overlay interface**
   - Validate that all command types in OverlayCommands are handled by Browser Runtime's overlay dispatch
   - Validate that command payload shapes match between OverlayCommands definition and Browser Runtime's sendCommand implementation

2. **OverlayEvents schema matches Browser Runtime event handling**
   - Validate that all event types in OverlayEvents are processed by Browser Runtime's postMessage listener
   - Validate that event payload shapes match between OverlayEvents definition and Browser Runtime's Event Bus publication schema

3. **BoundingBox type compatibility with SPEC-002 (shared-types)**
   - Validate that BoundingBox defined in overlay script matches BoundingBox in shared-types package
   - Assert: same property names (x, y, width, height) with same types (number)

### End-to-End Tests

1. **Full selection flow: load page → inject overlay → hover → click → verify SelectionChanged on Event Bus**
   - Start Browser Runtime
   - Load test page
   - Inject overlay
   - Set mode to hover
   - Send overlay:inspect at element coordinates
   - Verify overlay:element-hovered event received by Browser Runtime
   - Set mode to selection
   - Click on element via overlay event layer
   - Verify overlay:element-clicked event received by Browser Runtime
   - Verify SelectionChanged event published to Event Bus with correct payload
   - Verify VCE subscriber receives SelectionChanged event

2. **Overlay removal and re-injection roundtrip**
   - Inject overlay, make a selection, remove overlay
   - Verify no artifacts
   - Re-inject overlay
   - Verify overlay:ready emitted
   - Verify overlay is in hidden mode (no stale state from previous instance)

---

## Acceptance Criteria

- [ ] Shadow DOM attached to document.body with `__viskod_overlay_root` host element ID
- [ ] All CSS classes and IDs prefixed with `__viskod_` (verified by automated test)
- [ ] Hover highlight appears under pointer position without affecting page layout (verified by screenshot diff with < 0.1% pixel difference)
- [ ] Click on element during selection mode emits `overlay:element-clicked` with correct CSS selector string and bounding box
- [ ] Element click does not propagate to the page (stopPropagation verified by page event listener that must not fire)
- [ ] Overlay removal (dispose) leaves zero DOM/CSS artifacts (verified by querySelector for `__viskod_` prefixed elements)
- [ ] Overlay injection completes in under 16ms (verified by performance.now delta measurement)
- [ ] Overlay page load time impact under 1ms (verified by Performance Observer loadEventEnd delta with/without overlay)
- [ ] `elementFromPoint` hide/detect/show cycle completes in under 5ms (verified by performance.now delta)
- [ ] No page JavaScript exceptions caused by overlay injection (verified by page console error listener)
- [ ] Multiple `overlay:highlight` calls in sequence update correctly — no stale highlights from previous calls
- [ ] Overlay survives page navigation (Browser Runtime re-injects after NavigationCompleted; overlay:ready emitted again)
- [ ] Overlay does not read or write localStorage, sessionStorage, or document.cookie (verified by pre/post storage diff)
- [ ] Overlay event handlers do not leak to page context (verified by page event listener that must not fire during overlay interactions)
- [ ] Shadow DOM is in closed mode in production build (verified by `hostElement.shadowRoot === null`)
- [ ] `overlay:ready` event emitted before any commands are accepted
- [ ] Overlay state correctly transitions through all lifecycle states: Initialised → Ready → Active → Hidden → Disposed
- [ ] Hover events debounced to max 1 per 16ms and not emitted when element unchanged

---

## Open Implementation Decisions

| ID | Decision | Resolution | Reference |
|----|----------|-----------|-----------|
| DEC-005 | Overlay injection strategy | Playwright `addScriptTag` with inline script content (not a file reference). Script is a self-contained string compiled at build time. | `docs/overlay-system.md` §Architecture; `docs/architecture.md` §Browser Runtime |
| — | CSS selector generation algorithm | Resolved: the overlay generates unique CSS selectors using `id` (if present), then `data-testid` (if present), then `nth-child` path from body. Algorithm is a Phase 1 implementation detail; SPEC-022 does not mandate a specific algorithm, only that selectors must be unique and valid. | — |
| — | All other architectural decisions | Fully resolved in architecture baseline v1.0. No deferred decisions remain for this specification. | `docs/ARCHITECTURE_BASELINE.md` |

---

## Migration Considerations

### Renamed from overlay-renderer.md

This specification was originally registered as `overlay-renderer.md` in the SPEC_INDEX. It was renamed to `overlay-system.md` to align with the canonical subsystem name defined in `docs/ARCHITECTURE_BASELINE.md` §Canonical Subsystem Names.

| Aspect | Old (overlay-renderer) | New (overlay-system) |
|--------|------------------------|----------------------|
| Specification file | `specs/overlay-renderer.md` | `specs/overlay-system.md` |
| Canonical name | Overlay Renderer (incorrect — implies a single rendering component) | Overlay System (correct — the architectural subsystem) |
| Architecture relationship | Confused with Overlay Manager naming | Clear: Overlay System = architectural concept; Overlay Manager = Browser Runtime internal component |

No other specification is affected by this rename. The SPEC_INDEX was updated to reflect the new name and a cross-reference entry was added for `overlay-renderer.md` pointing to `overlay-system.md`.

### No Previous Version

This is the initial specification for the Overlay System. No migration from a previous specification version is required.

---

## Risks

### Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Shadow DOM closed mode prevents debugging | Medium | Low | Debug build uses open mode; production build uses closed mode; configurable at compile time via `SHADOW_DOM_MODE` |
| elementFromPoint resolution fails on iframe boundaries | Medium | Medium | Document as known limitation; iframe support deferred to Phase 2 (requires iframe-aware coordinate translation) |
| CSS selector generation produces non-unique selectors in dynamic applications | Medium | Medium | Fallback: use nth-child path from body; guaranteed unique but may be fragile across DOM updates |
| Application CSP prevents inline script injection | Low | High | Playwright's addScriptTag bypasses CSP (executes in page context via CDP); if this fails, fallback to addInitScript |
| Overlay perf overhead becomes measurable on very large pages (10K+ DOM nodes) | Low | Medium | elementFromPoint is O(1) in browser; highlight repaint is localised; no DOM traversal by overlay |

### Sequencing Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| SPEC-011 (selection-engine) not yet written; full selection validation unavailable for vertical slice | High | Low | Phase 1 vertical slice uses raw click→element mapping via SelectionTarget (SPEC-009 alias); this is sufficient for hover+click demo. SPEC-011 adds validation, scoring, hierarchy — all additive, no breaking changes to overlay interface. |
| SPEC-008 (browser-runtime) is Approved but not yet fully implemented | High | Medium | Overlay specification is written against Browser Runtime's public API contract. Implementation can proceed once Browser Runtime has addScriptTag and postMessage bridge capabilities. |
| Shadow DOM API not available in legacy browsers | Low | Low | Viskod targets Chromium (via Playwright). Shadow DOM v1 is supported in all Chromium versions since Chrome 53 (2016). |

### Ambiguity Risks

| Risk | Resolution |
|------|-----------|
| Overlay naming (Overlay System vs Overlay Manager vs Overlay Renderer) | Resolved: architecture baseline v1.0 canonicalized naming. Overlay System = architectural concept; Overlay Manager = Browser Runtime component. This specification implements the Overlay System. |
| Extent of Phase 1 overlay features | Resolved: Phase 1 = hover highlight + click selection. Diagnostics, measurements, layout overlays are Phase 2+. All defined in data model for forward compatibility; implementation deferred. |

---

## Implementation Sequence

1. **Compile-time overlay script builder**
   - Create build step that produces a self-contained JavaScript string from overlay source modules
   - Verify: no module imports, no dynamic code execution, no network APIs in output
   - Output: single `.js` file containing the overlay script as a string export

2. **Shadow DOM structure and style injection**
   - Implement Shadow DOM creation and attachment to document.body
   - Implement `__viskod_` prefixed CSS class generation
   - Implement style injection into Shadow DOM
   - Verify: all classes prefixed; styles isolated within Shadow DOM

3. **Event layer and click/hover interception**
   - Implement transparent event layer over full viewport
   - Implement pointer-events toggle (none for hover, auto for selection)
   - Implement click handler with stopPropagation
   - Implement hover handler with debounce

4. **Element resolution (hide-detect-show)**
   - Implement hide→elementFromPoint→show pattern
   - Implement CSS selector generation (id → data-testid → nth-child fallback)
   - Implement bounding box extraction via getBoundingClientRect

5. **Highlight and label rendering**
   - Implement highlight box positioning and styling
   - Implement label rendering with position options (top/bottom/left/right)
   - Implement clear highlights functionality

6. **postMessage communication**
   - Implement message listener for incoming commands (overlay:show, overlay:hide, overlay:highlight, overlay:inspect, overlay:clear, overlay:label, overlay:diagnostics)
   - Implement message posting for outgoing events (overlay:ready, overlay:element-clicked, overlay:element-hovered)
   - Implement origin validation on incoming messages

7. **Overlay state management**
   - Implement OverlayState with mode transitions
   - Implement mode-specific behaviour (hover → pointer-events: none; selection → pointer-events: auto)
   - Implement state preservation across hide/show cycles

8. **Cleanup and disposal**
   - Implement dispose() that removes Shadow DOM, host element, and all event listeners
   - Implement MutationObserver for host removal detection

9. **Browser Runtime integration**
   - Implement addScriptTag injection in Browser Runtime
   - Implement postMessage bridge (receive overlay events, forward to Event Bus)
   - Implement command dispatch (Browser Runtime → overlay)

10. **Tests**
    - Write unit tests for each component
    - Write integration tests for overlay + real page
    - Write contract tests for API interoperability
    - Write E2E test for full selection flow

11. **Performance validation**
    - Measure injection latency, hover latency, selection latency, removal latency
    - Verify against performance budget targets
    - Optimize if any target exceeded

---

## Definition of Done

- [ ] Shadow DOM injection creates correct DOM structure with all three layers (highlight, diagnostics, event)
- [ ] All CSS classes and IDs prefixed with `__viskod_` — verified by automated test
- [ ] Hover mode: highlight follows pointer within 8ms, label displays tag name
- [ ] Selection mode: click captures element, highlight persists, stopPropagation prevents page interaction
- [ ] All OverlayCommands implemented and functional: show, hide, highlight, clear, inspect, label, diagnostics (diagnostics may be stubbed for Phase 1)
- [ ] All OverlayEvents emitted correctly: ready, element-clicked, element-hovered
- [ ] OverlayState transitions correct through all five lifecycle states
- [ ] Overlay removal leaves zero DOM/CSS/event artifacts — verified by automated test
- [ ] All error conditions handled with correct error codes (OV_INJECTION_FAILED, OV_ELEMENT_NOT_FOUND, OV_SELECTOR_INVALID, OV_OVERLAY_DETECTED, OV_NOT_READY, OV_HOST_REMOVED, OV_COMMUNICATION_FAILED)
- [ ] All performance budget targets met (injection < 16ms, hover < 8ms, selection < 8ms, removal < 5ms, load impact < 1ms, elementFromPoint < 5ms)
- [ ] All security requirements satisfied (no page DOM access, no storage access, no cookie access, origin validation, payload validation, no eval/import/network)
- [ ] All privacy requirements satisfied (only selector, boundingBox, tagName in events; no text content, no attributes, no page data)
- [ ] Unit tests pass (Shadow DOM structure, elementFromPoint pattern, state transitions, CSS prefix enforcement, artifact cleanup, sequential highlights, event payload validity)
- [ ] Integration tests pass (layout preservation via screenshot diff, hover position accuracy, click event correctness, artifact cleanup on real page, navigation re-injection, storage non-interference, handler leak prevention)
- [ ] Contract tests pass (OverlayCommands ↔ Browser Runtime, OverlayEvents ↔ Browser Runtime, BoundingBox ↔ shared-types)
- [ ] E2E test passes (full flow: inject → hover → click → SelectionChanged on Event Bus; removal → re-injection roundtrip)
- [ ] Lint passes (Biome)
- [ ] TypeScript typecheck passes (strict mode)
- [ ] No console errors during overlay operation on a standard page
- [ ] Shadow DOM closed mode verified in production build (shadowRoot === null)
- [ ] Documentation updated: SPEC_INDEX status updated to Approved; MEMORY.md updated if architectural decisions were made
- [ ] Build produces a single self-contained overlay script string with no external dependencies
