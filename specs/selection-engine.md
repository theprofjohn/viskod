# Selection Engine

> **Specification ID:** SPEC-014
> **Version:** 1.0
> **Status:** Draft
> **Owner:** Platform Architecture
> **Last Updated:** 2026-07-28

---

## Architecture Sources

* `docs/selection-engine.md` — full subsystem specification: target resolution, stable references, hierarchy construction, selection validation, overlay coordination, visibility rules, shadow DOM, cross-frame support, accessibility, invariants
* `docs/architecture.md` §Selection Engine — converts pointer events into structured selections: candidate validation, state management, selection targets; communicates via Event Bus; never analyses meaning
* `docs/architecture.md` §Selection Validation — validates element existence, DOM attachment, browser context, frame ownership, identifier consistency; invalid selections rejected before capture proceeds
* `docs/architecture.md` §Selection Levels — exactly one active selection per browser context; immutable snapshots; deterministic identifiers
* `docs/ARCHITECTURE_BASELINE.md` §Runtime Boundaries — Selection Engine depends on Browser Runtime for DOM access; communicates via Event Bus; no MCP responsibility
* `docs/ARCHITECTURE_BASELINE.md` §Prohibited Dependencies — Selection Engine must not directly call MCP Server methods; Selection Engine must not import MCP implementation modules
* `docs/glossary.md` §Selection Engine — subsystem that converts pointer events into structured selections with validated targets, hierarchy, and metadata

---

## Dependencies

| Specification | Status | Relationship |
|--------------|--------|-------------|
| SPEC-002 (shared-types) | Draft | Imports base types (`Identifier`, `Timestamp`, `Result`, `Maybe`), Zod schemas, error base types |
| SPEC-003 (error-model) | Draft | Imports `ViskodError`, `ErrorCategory`, `ErrorSeverity`; produces errors conforming to the error model |
| SPEC-008 (browser-runtime) | Draft | Depends on Browser Runtime for DOM access, element resolution, and overlay highlighting; communicates via Event Bus, never calls BR methods directly for selection state |
| SPEC-007 (event-bus) | Draft | Publishes `SelectionChanged` events; subscribes to `ViewportChanged` for coordinate recalibration |
| SPEC-022 (overlay-system) | Draft | Coordinates overlay highlighting — Selection Engine determines what to highlight; Overlay System renders it |

---

## Consumers

| Specification | Status | Relationship |
|--------------|--------|-------------|
| SPEC-009 (visual-context-engine) | Draft | VCE consumes validated `SelectionSnapshot` as input for Context Packet generation |
| SPEC-023 (studio) | Draft | Studio displays current selection state; Studio triggers selection start/clear/cancel |
| SPEC-013 (mcp-server) | Draft | MCP tools (`viskod_select_element`, `viskod_get_selection`) query and trigger selections |

---

## Purpose

Defines the Selection Engine subsystem: the component that transforms a user interaction (pointer event, keyboard event, Studio action, MCP tool invocation) into a precise, reproducible, and stable selection that can be consumed by the Visual Context Engine. The Selection Engine identifies the correct target and validates it — it does not analyse meaning, generate source hints, or construct Context Packets. Every observation in Viskod begins with a trustworthy selection.

---

## Scope

* Target resolution from pointer events (mouse click, hover, keyboard navigation)
* Element reference stability (surviving DOM mutations, re-renders, navigation)
* Selection validation (element existence, DOM attachment, browser context, frame ownership)
* Hierarchy construction (parent chain, child relationships, sibling relationships, ancestor depth, nearest landmarks)
* Selection geometry recording (position, bounding box, visible region, clipping state)
* Visibility evaluation (display state, opacity, clipping, overflow, viewport intersection, stacking order)
* Shadow DOM traversal (open shadow roots, nested shadow trees, distributed nodes)
* Accessibility metadata (role, accessible name, landmark, heading level, focus state)
* Selection snapshot production (immutable, deterministic, reproducible)
* Event publishing to Event Bus (never direct subscriber calls)
* Overlay coordination (communicates WHAT to highlight; overlay system renders HOW)
* Error handling and recovery (invalid selections, detached nodes, timeouts)

---

## Non-Goals

* Semantic analysis of selected elements (what does this button do?)
* Browser automation or navigation
* Source hint generation or project scanning
* Source code inspection or repository analysis
* MCP protocol handling or tool registration (MCP Server owns this)
* Context Packet construction (VCE owns this)
* Screenshot capture or DOM style retrieval (Browser Runtime owns this)
* Overlay rendering or CSS injection (Overlay System owns this)
* Multi-element or region selection (future concern)

---

## Terminology

| Term | Definition (this spec) |
|------|----------------------|
| **SelectionTarget** | Raw input describing the element to select: a selector string, a bounding box, and optional metadata; produced by overlay interaction or Studio action |
| **SelectionSnapshot** | Immutable, validated representation of the selected element containing metadata, hierarchy, geometry, accessibility info, and diagnostics |
| **StableReference** | A selection identifier that remains valid throughout the capture lifetime; implemented as a path-based reference (DOM hierarchy path) rather than a pointer or ID that can be invalidated by re-renders |
| **HierarchyNode** | A node in the element hierarchy tree containing tag name, depth, attributes, and relationship metadata |
| **CandidateResolution** | The process of resolving which DOM element a pointer event actually targeted, accounting for pointer location, z-index, visibility, and intentional targeting |
| **SelectionContext** | The runtime context for a selection operation: browser context ID, page ID, viewport state, and overlay state |

All other terms reference `docs/glossary.md` for canonical definitions.

---

## Runtime Boundary

| Boundary | Value |
|----------|-------|
| Process | Main desktop process (same as VCE and Studio) |
| Imports allowed | `@viskod/shared` (types, schemas, utilities, errors), `@viskod/event-bus` (event types for publishing/subscribing) |
| Imports forbidden | `@viskod/browser-runtime` (internal modules — communicates via Event Bus only), `@viskod/visual-context-engine`, `@viskod/mcp-server`, `@viskod/project-scanner`, `@viskod/source-hint-engine`, `@viskod/studio`, `@viskod/capture-pipeline`, `playwright` |
| Network | No direct network access; all browser communication through Event Bus |
| File system | No file system access |
| Secrets | Never accesses `.env` files, environment variables, or user credentials |

---

## Responsibilities

The Selection Engine owns:

* Converting pointer events into structured `SelectionTarget` objects
* Validating that selected elements exist and are attached to the DOM
* Constructing the element hierarchy (parent chain, siblings, children, ancestors, landmarks)
* Recording selection geometry (bounding box, visible region, clipping state)
* Evaluating element visibility (display, opacity, overflow, viewport intersection)
* Traversing Shadow DOM when present (open shadow roots)
* Collecting accessibility metadata (role, name, landmark, heading, focus state)
* Producing immutable `SelectionSnapshot` objects
* Publishing `SelectionChanged` events to the Event Bus
* Coordinating with the Overlay System for highlight targets
* Maintaining exactly one active selection at a time
* Handling invalid, detached, or timed-out selections

The Selection Engine must never:

* Call Browser Runtime methods directly (communicates via Event Bus)
* Import Playwright, Chromium, or any browser automation library
* Read project files or repository structure
* Generate source hints or framework-detection metadata
* Construct Context Packets
* Expose MCP tools, resources, or prompts
* Call Visual Context Engine methods directly
* Communicate with Studio, MCP Server, or Project Scanner directly
* Modify DOM or page state in any way

---

## Interfaces

### Public API

| Signature | Purpose | Preconditions | Postconditions | Errors |
|-----------|---------|---------------|----------------|--------|
| `resolveTarget(event: PointerEvent \| TargetRequest): Promise<Result<SelectionTarget>>` | Resolve a pointer event or explicit request into a SelectionTarget | Browser is in `Inspectable` state; overlay is injected | Returns a validated SelectionTarget; emits `SelectionChanged` on success | `SE_NO_ELEMENT_FOUND`, `SE_DETACHED_NODE`, `SE_TIMEOUT` |
| `validateSelection(target: SelectionTarget): Promise<Result<SelectionSnapshot>>` | Validate a SelectionTarget and produce an immutable snapshot | SelectionTarget exists and is resolvable | Returns immutable SelectionSnapshot with hierarchy, geometry, accessibility | `SE_NO_ELEMENT_FOUND`, `SE_DETACHED_NODE`, `SE_INVALID_CONTEXT` |
| `buildHierarchy(target: SelectionTarget): Promise<Result<HierarchyRoot>>` | Build the full hierarchy tree around a SelectionTarget | SelectionTarget is validated | Returns parent chain, siblings, children, landmarks; depth-limited to 50 levels | `SE_DETACHED_NODE`, `SE_TIMEOUT` |
| `getSelectionGeometry(target: SelectionTarget): Promise<Result<SelectionGeometry>>` | Get precise geometry for a SelectionTarget | SelectionTarget is validated | Returns bounding box, visible region, clip state, viewport intersection ratio | `SE_NO_ELEMENT_FOUND` |
| `evaluateVisibility(target: SelectionTarget): Promise<Result<VisibilityReport>>` | Evaluate element visibility | SelectionTarget is validated | Returns display state, opacity, clipping, overflow, viewport intersection, stacking context | None (always returns a report) |
| `getAccessibilityInfo(target: SelectionTarget): Promise<Result<AccessibilityInfo>>` | Collect accessibility metadata | SelectionTarget is validated | Returns role, accessible name, landmark, heading level, focus state | None (returns best-effort info) |
| `clearSelection(): Promise<Result<void>>` | Clear the active selection | Any state | Active selection cleared; emits `SelectionCleared` event | None (no-op if no selection active) |
| `health(): SelectionEngineHealth` | Return current selection engine health | Any state | Returns health status synchronously | None (synchronous) |

### TargetRequest

```typescript
interface TargetRequest {
  selector: string;
  boundingBox: BoundingBox;
  source: 'studio' | 'mcp' | 'overlay' | 'keyboard' | 'automation';
  timestamp: string;
}
```

### Events Published

| Event | Payload Schema | When Published |
|-------|---------------|----------------|
| `SelectionStarted` | `{ contextId: Identifier; source: SelectionSource; timestamp: Timestamp }` | When `resolveTarget()` begins |
| `SelectionChanged` | `{ contextId: Identifier; snapshot: SelectionSnapshot; timestamp: Timestamp }` | After successful `validateSelection()` |
| `SelectionCleared` | `{ contextId: Identifier; timestamp: Timestamp }` | After `clearSelection()` |
| `SelectionFailed` | `{ contextId: Identifier; error: ViskodError; timestamp: Timestamp }` | When `resolveTarget()` or `validateSelection()` fails |
| `HighlightRequested` | `{ contextId: Identifier; selector: string; boundingBox: BoundingBox; timestamp: Timestamp }` | When the Selection Engine determines what should be highlighted (consumed by Overlay System) |

### Events Subscribed

| Event | When Handled |
|-------|-------------|
| `ViewportChanged` | Recalculates selection geometry for the new viewport dimensions |
| `PageLoaded` | Clears previous selection (DOM is new); resets selection state |
| `BrowserDisconnected` | Invalidates all current selections; resets to Idle state |
| `OverlayInjected` | Enables selection processing (overlay must be present for pointer events) |
| `OverlayRemoved` | Disables pointer-event-based selection; existing selections remain valid |

---

## Data Models

### SelectionTarget
```typescript
interface SelectionTarget {
  selector: string;              // CSS selector resolving to the target element
  boundingBox: BoundingBox;      // viewport-relative position and dimensions
  source: SelectionSource;       // 'studio' | 'mcp' | 'overlay' | 'keyboard' | 'automation'
}
```

### SelectionSnapshot
```typescript
interface SelectionSnapshot {
  selectionId: string;           // globally unique, deterministic identifier
  target: SelectionTarget;       // the raw selection input
  hierarchy: HierarchyRoot;      // full hierarchy tree
  geometry: SelectionGeometry;   // precise geometry info
  visibility: VisibilityReport;  // visibility evaluation
  accessibility: AccessibilityInfo; // accessibility metadata
  timestamp: string;             // ISO 8601
  schemaVersion: string;         // '1.0.0'
}
```

### HierarchyRoot
```typescript
interface HierarchyRoot {
  selectedNode: HierarchyNode;   // the selected element
  parents: HierarchyNode[];      // parent chain, root-first
  siblings: HierarchyNode[];     // sibling elements at the same depth
  children: HierarchyNode[];     // direct children of the selected element
  landmarks: Landmark[];         // nearest landmark elements
}

interface HierarchyNode {
  tagName: string;               // lowercase
  depth: number;                 // 0 = root, 1 = first child, etc.
  attributes: Record<string, string>;
  childCount: number;
  text?: string;                 // truncated at 200 chars
}

interface Landmark {
  tagName: string;
  role?: string;
  label?: string;
  depth: number;
}
```

### SelectionGeometry
```typescript
interface SelectionGeometry {
  boundingBox: BoundingBox;      // position and dimensions
  visibleRegion: BoundingBox;    // portion of the element currently visible (accounting for scroll, clip, overflow)
  clipState: 'visible' | 'partially-clipped' | 'fully-clipped';
  viewportIntersectionRatio: number; // 0.0 to 1.0
}

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

### VisibilityReport
```typescript
interface VisibilityReport {
  display: string;               // CSS display value
  visible: boolean;              // true if element is rendered and visible
  opacity: number;               // 0.0 to 1.0
  isClipped: boolean;            // true if element is clipped by overflow: hidden/clip
  viewportVisible: boolean;      // true if any portion intersects the viewport
  stackingContext: string;       // z-index stacking context description
  reasons: string[];             // human-readable reasons for visibility determination
}
```

### AccessibilityInfo
```typescript
interface AccessibilityInfo {
  role: string | null;           // ARIA role or implicit role
  name: string | null;           // accessible name (from aria-label, aria-labelledby, text content, alt text)
  landmark: string | null;       // nearest landmark role
  headingLevel: number | null;   // 1-6 if a heading element
  hasFocus: boolean;             // true if element currently has focus
  tabIndex: number | null;       // tabindex value if present
}
```

### SelectionEngineHealth
```typescript
interface SelectionEngineHealth {
  status: 'healthy' | 'degraded' | 'unavailable';
  activeSelection: boolean;
  selectionsProcessed: number;
  selectionsFailed: number;
  averageProcessingTimeMs: number;
}
```

---

## State Model

### Selection Engine States

```
Idle → Resolving → Validating → Active
  ↓        ↓           ↓
  └── SelectionFailed ──┘
                              ↓
                          Cleared → Idle
```

| State | Description | Valid Operations |
|-------|-------------|-----------------|
| `Idle` | No selection in progress | `resolveTarget()`, `health()` |
| `Resolving` | Converting pointer event / request to SelectionTarget | Cannot start new selection until complete |
| `Validating` | Validating SelectionTarget and constructing snapshot | Cannot start new selection until complete |
| `Active` | Validated selection exists; snapshot available | `validateSelection()`, `buildHierarchy()`, `getSelectionGeometry()`, `evaluateVisibility()`, `getAccessibilityInfo()`, `clearSelection()`, `health()` |
| `SelectionFailed` | Last selection attempt failed; diagnostics available | `resolveTarget()` (retry), `clearSelection()`, `health()` |

### Invariants

* Exactly one active selection exists at any time
* `SelectionSnapshot` is immutable after creation — any change produces a new snapshot
* Selection identifiers are deterministic (path-based, not random)
* Hierarchy is bounded at 50 levels deep; deeper trees are truncated
* Parent chains are ordered root-first (ancestor at index 0, parent at index -1)
* Shadow DOM nodes are included when in open shadow roots; closed shadow roots are treated as opaque boundaries
* Visibility evaluation considers invisible elements valid when explicitly selected (dev may inspect hidden elements)

---

## Command Flows

### Selection from Overlay Click

```
Developer clicks element in browser overlay
  → Overlay System captures PointerEvent
    → Overlay publishes InteractionEvent to Event Bus
      → Selection Engine subscribes to InteractionEvent
        → resolveTarget(PointerEvent)
          → Validates browser is in Inspectable state
          → Resolves DOM element from pointer coordinates
          → Traverses Shadow DOM if present
          → Validates element is attached to DOM
          → Constructs SelectionTarget { selector, boundingBox, source: 'overlay' }
          → Emits SelectionStarted event
        → validateSelection(target)
          → Builds hierarchy (parents, siblings, children, landmarks)
          → Records geometry (bounding box, visible region, clip state)
          → Evaluates visibility (display, opacity, viewport intersection)
          → Collects accessibility metadata
          → Produces immutable SelectionSnapshot
          → Emits SelectionChanged event
        → Emits HighlightRequested event (consumed by Overlay System)
      → VCE receives SelectionChanged event → triggers Context Packet generation
```

### Selection from Studio

```
Developer clicks "Select Element" in Studio
  → Studio → VCE (command flow)
    → VCE enters selection mode
      → Studio state updates to Selecting
    → Selection Engine receives TargetRequest { selector: '.my-button', boundingBox: {...}, source: 'studio' }
      → resolveTarget(request)
        → Validates element exists (not checking DOM directly — uses cached DOM snapshot from last BR page state)
        → Same flow as overlay click from resolveTarget onwards
      → Studio displays SelectionSnapshot in Selection Inspector panel
```

### Selection from MCP

```
External AI agent → MCP Server calls viskod_select_element(selector: '.dashboard-header')
  → MCP Server → VCE (command flow)
    → VCE calls SelectionEngine.resolveTarget({ selector, boundingBox: resolveFromDOM, source: 'mcp' })
    → Same flow as above
    → SelectionSnapshot returned to MCP Server via Context Packet
```

### Clear Selection Flow

```
Studio / VCE → SelectionEngine.clearSelection()
  → Validates (no-op if no selection active)
  → Emits SelectionCleared event
  → Overlay System receives SelectionCleared → removes highlight
  → Studio receives SelectionCleared → resets Selection Inspector panel
```

---

## Event Flows

```
SelectionEngine.resolveTarget()
  → EventBus.publish(SelectionStarted { contextId, source })

SelectionEngine.validateSelection()
  → EventBus.publish(SelectionChanged { contextId, snapshot })

SelectionEngine.clearSelection()
  → EventBus.publish(SelectionCleared { contextId })

Selection resolution failure
  → EventBus.publish(SelectionFailed { contextId, error })

Element highlighted
  → EventBus.publish(HighlightRequested { contextId, selector, boundingBox })

--- Subscribed events ---

ViewportChanged
  → Selection Engine recalculates geometry for active selection
  → Emits SelectionChanged with updated geometry

PageLoaded
  → Clears previous selection (DOM is new)
  → Emits SelectionCleared

BrowserDisconnected
  → Invalidates all selections
  → Emits SelectionCleared
```

---

## Error Behaviour

| Condition | Error Code | Message | Recovery |
|-----------|-----------|---------|----------|
| No element found at pointer coordinates | `SE_NO_ELEMENT_FOUND` | "No element found at position ({x}, {y})" | Return error; caller may retry after user moves pointer |
| Element has been detached from DOM since selection | `SE_DETACHED_NODE` | "Selected element has been removed from the DOM" | Return error; caller should clear selection and re-select |
| Browser context is invalid or disconnected | `SE_INVALID_CONTEXT` | "Cannot resolve selection: browser context is no longer valid" | Return error; caller must await new BrowserStarted event |
| Selection resolution exceeds timeout (1000ms) | `SE_TIMEOUT` | "Selection resolution timed out after {timeout}ms" | Return error; caller may retry |
| Selection attempted without overlay injected | `SE_OVERLAY_NOT_READY` | "Cannot process pointer selection: overlay is not injected" | Return error; caller must inject overlay first |
| Selector resolves to multiple elements disambiguously | `SE_AMBIGUOUS_SELECTOR` | "Selector '{selector}' resolves to {count} elements" | Return error with candidate list; caller may refine selector |
| Selector resolves to zero elements | `SE_NO_ELEMENT_FOUND` | "Selector '{selector}' does not match any element" | Return error; caller may retry with different selector |
| Element is inside closed shadow root | `SE_SHADOW_ROOT_CLOSED` | "Element is inside a closed shadow root and cannot be resolved" | Return error; closed shadow roots are opaque boundaries |

---

## Security Requirements

### Trust Boundaries

* All input from browser overlays (PointerEvents) is untrusted — validated against DOM reality before producing SelectionSnapshot
* All selector strings from Studio and MCP are validated before DOM querying (no script injection)
* DOM data from the browser is untrusted — all element attributes, text content, and accessibility metadata are validated and sanitised
* The inspected application is untrusted — DOM structure may change at any time; stable references account for this

### Input Validation

* All `selector` strings are validated as CSS selectors (no JavaScript expressions, no `javascript:` URIs)
* All `boundingBox` coordinates must be non-negative numbers within viewport bounds
* `source` field must be one of the known enum values
* Accessibility text content truncated at 500 characters

---

## Privacy Requirements

| Data | Purpose | Retention |
|------|---------|-----------|
| SelectionSnapshot metadata | Identifying the selected element for visual context | Transient; not persisted beyond the selection session |
| Hierarchy tree | Structural context for VCE | Transient; becomes part of Context Packet |
| Selection geometry | Precise positioning data | Transient; becomes part of Context Packet |
| Accessibility metadata | Supplementary context for AI agents | Transient; becomes part of Context Packet |

### Data NOT Collected

* Form input values within selected elements
* Text content beyond structural truncation (200 chars)
* User interaction patterns or selection history
* Page content outside the selected element
* Any data from closed shadow roots

---

## Performance Budget

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Target resolution | < 10 ms | Benchmark: PointerEvent → SelectionTarget; p95 |
| Hierarchy construction (100-node tree) | < 20 ms | Benchmark: SelectionTarget → HierarchyRoot; p95 |
| Hierarchy construction (1000-node tree) | < 100 ms | Benchmark: SelectionTarget → HierarchyRoot; p95 |
| Snapshot generation | < 20 ms | Benchmark: SelectionTarget → SelectionSnapshot (all parts); p95 |
| Total selection processing | < 50 ms | Benchmark: resolveTarget → SelectionChanged event; p95 |
| Visibility evaluation | < 5 ms | Benchmark: SelectionTarget → VisibilityReport; p95 |
| Accessibility collection | < 5 ms | Benchmark: SelectionTarget → AccessibilityInfo; p95 |

---

## Observability

### Log Levels

| Level | Usage |
|-------|-------|
| `ERROR` | Invalid contexts, disconnects, shadow root access failures, timeout errors |
| `WARN` | Detached nodes, ambiguous selectors, missing accessibility metadata |
| `INFO` | Selection lifecycle events (started, changed, cleared), snapshot generation timing |
| `DEBUG` | Detailed hierarchy construction, visibility evaluation steps, DOM traversal traces |

### Diagnostic Signals

* `SelectionEngineHealth.status` — pollable health indicator
* `SelectionEngineHealth.selectionsProcessed` — total successful selections
* `SelectionEngineHealth.selectionsFailed` — total failed selections
* `SelectionEngineHealth.averageProcessingTimeMs` — moving average of last 50 selections

---

## Configuration

Configuration is loaded via SPEC-004 (configuration). The Selection Engine reads the following keys:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `selection.maxHierarchyDepth` | `number` | `50` | Maximum hierarchy tree depth before truncation |
| `selection.maxSiblings` | `number` | `100` | Maximum sibling nodes to include |
| `selection.timeout.resolve` | `number` (ms) | `1000` | Maximum time for target resolution |
| `selection.textTruncation` | `number` | `200` | Maximum characters for element text content |
| `selection.requireOverlay` | `boolean` | `true` | Require overlay injection for pointer-based selection |
| `selection.accessibilityTimeout` | `number` (ms) | `100` | Maximum time for accessibility metadata collection |

---

## Failure and Recovery

### Recoverable Failures

| Failure | Recovery Strategy |
|---------|-------------------|
| Pointer event on fast-moving element (DOM changed between event and resolve) | Retry resolution once; if still fails, return `SE_DETACHED_NODE` |
| Element detached during validation | Return `SE_DETACHED_NODE`; emit `SelectionCleared`; caller should re-select |
| Ambiguous selector | Return `SE_AMBIGUOUS_SELECTOR` with candidate list; caller may refine |
| Accessibility metadata timeout | Return best-effort info; do not block selection on accessibility timeout |

### Fatal Failures

| Failure | Recovery Strategy |
|---------|-------------------|
| Browser context destroyed during selection | Emit `SelectionCleared`; invalidate all selections; await `BrowserStarted` before new selections |
| Page navigated during selection | Emit `SelectionCleared`; clear all state; selection must be re-initiated after `PageLoaded` |
| Overlay removed during active selection | Emit `SelectionCleared`; pointer-based selection disabled; Studio/MCP-driven selection remains functional |

---

## Compatibility

### Breaking Change Policy

* Any change to `SelectionSnapshot` schema is a breaking change
* Any change to event payload schemas is a breaking change
* Any change to `SelectionTarget` structure is a breaking change
* Internal refactors preserving public API, event schemas, and snapshot schemas are non-breaking

---

## Testing Requirements

### Unit Tests

* Verify `resolveTarget()` from PointerEvent produces correct `SelectionTarget` with pinned coordinates
* Verify `resolveTarget()` from TargetRequest bypasses pointer logic and uses explicit selector
* Verify `validateSelection()` produces immutable `SelectionSnapshot` with all fields populated
* Verify `buildHierarchy()` returns parent chain ordered root-first
* Verify `buildHierarchy()` truncates at configured `maxHierarchyDepth`
* Verify `buildHierarchy()` includes open shadow root nodes
* Verify `buildHierarchy()` treats closed shadow roots as opaque boundaries
* Verify `getSelectionGeometry()` correctly calculates viewport intersection ratio
* Verify `evaluateVisibility()` correctly reports visibility for elements with `display: none`, `opacity: 0`, `visibility: hidden`
* Verify `evaluateVisibility()` reports `visible: true` for elements with `display: none` when explicitly selected (hidden element inspection)
* Verify `getAccessibilityInfo()` extracts role, name, landmark, heading level
* Verify `clearSelection()` emits `SelectionCleared` event
* Verify all selection lifecycle events are published to Event Bus at correct points
* Verify events are NEVER published to named subscribers directly
* Verify `SelectionEngine` NEVER imports `@viskod/browser-runtime` internal modules
* Verify `SelectionEngine` NEVER imports `playwright`

### Integration Tests

* Resolve target from a real browser page via overlay click; verify `SelectionTarget` contains correct selector
* Validate selection on a real element; verify `SelectionSnapshot` contains correct hierarchy
* Build hierarchy on a deeply nested element; verify parent chain is complete and root-first
* Evaluate visibility on a partially scrolled element; verify `visibleRegion` is correct
* Select an element inside an open shadow root; verify it appears in hierarchy
* Select an element inside a closed shadow root; verify `SE_SHADOW_ROOT_CLOSED` error
* Clear selection during active selection; verify `SelectionCleared` is emitted
* Navigate page during active selection; verify selection is cleared automatically

### Contract Tests

* `SelectionSnapshot` schema matches the schema defined in this specification
* All event payload schemas match the schemas defined in the Events tables
* All error codes conform to SPEC-003 error model
* All configuration keys map to the Configuration section

---

## Acceptance Criteria

- [ ] `resolveTarget()` accepts both `PointerEvent` and `TargetRequest` inputs
- [ ] `resolveTarget()` returns `SE_NO_ELEMENT_FOUND` when element not found
- [ ] `validateSelection()` produces `SelectionSnapshot` with all fields populated
- [ ] `buildHierarchy()` returns parent chain root-first, siblings, children, landmarks
- [ ] `buildHierarchy()` truncates at `maxHierarchyDepth` (default 50)
- [ ] `getSelectionGeometry()` returns bounding box, visible region, clip state, viewport intersection
- [ ] `evaluateVisibility()` returns report for all element states including hidden/invisible
- [ ] `getAccessibilityInfo()` returns role, name, landmark, heading, focus
- [ ] `clearSelection()` emits `SelectionCleared` event and resets state to Idle
- [ ] `SelectionStarted`, `SelectionChanged`, `SelectionCleared`, `SelectionFailed`, `HighlightRequested` events published to Event Bus
- [ ] Selection Engine NEVER directly imports `@viskod/browser-runtime` internal modules or `playwright`
- [ ] Selection Engine NEVER calls Browser Runtime, VCE, MCP Server, Studio, or Project Scanner methods directly
- [ ] Exactly one active selection at any time
- [ ] SelectionSnapshot is immutable after creation
- [ ] Total selection processing completes within 50 ms (p95)
- [ ] All errors return structured `ViskodError` objects conforming to SPEC-003
- [ ] `health()` returns correct status based on actual engine state

---

## Open Implementation Decisions

| ID | Topic | Status |
|----|-------|--------|
| — | Stable reference strategy (path-based vs mutation-observer-based) | To be determined during implementation |
| — | Overlay Selection Engine communication protocol (Event Bus vs direct callback) | Using Event Bus (per architecture boundary rules) |
| — | Multi-element selection support timeline | Phase 3+ (not in Phase 1 or Phase 2) |
| — | Keyboard-based selection navigation | Deferred to future extension |
| — | Selection undo/redo history | Deferred to future extension |

---

## Implementation Sequence

1. Define all TypeScript interfaces (`packages/selection-engine/src/types.ts`)
2. Implement target resolution (PointerEvent → SelectionTarget)
3. Implement target resolution (TargetRequest → SelectionTarget)
4. Implement hierarchy construction (DOM tree traversal, truncation)
5. Implement selection validation (DOM attachment, context, frame)
6. Implement geometry recording (bounding box, visible region, clip, viewport intersection)
7. Implement visibility evaluation (display, opacity, clip, viewport)
8. Implement Shadow DOM traversal (open roots, nested trees)
9. Implement accessibility metadata collection
10. Implement SelectionSnapshot production (immutable, deterministic)
11. Implement Event Dispatcher (publish all events to Event Bus)
12. Implement event subscriptions (ViewportChanged, PageLoaded, BrowserDisconnected)
13. Implement error handling (all error codes, recovery paths)
14. Write unit tests (mocked DOM, verified event publishing)
15. Write integration tests (real browser pages, end-to-end selection flows)
16. Write contract tests (schema validation, error code conformance)
17. Integrate with Event Bus (SPEC-007) — verify events consumed by VCE (SPEC-009)
18. Integrate with Overlay System (SPEC-022) — verify HighlightRequested events render correctly
19. Validate build tool enforces import restrictions

---

## Definition of Done

- [ ] All methods implemented with correct signatures, preconditions, postconditions, and error handling
- [ ] SelectionSnapshot schema matches this specification exactly
- [ ] All event schemas defined and published to Event Bus at correct lifecycle points
- [ ] All error codes conform to SPEC-003
- [ ] Unit tests pass (mocked DOM, verified event publishing)
- [ ] Integration tests pass (real browser pages, verified end-to-end selection flows)
- [ ] Contract tests pass (schema validation, error code conformance)
- [ ] Build tool verifies no forbidden imports
- [ ] Lint passes (`biome check`)
- [ ] TypeScript strict mode passes with zero errors
- [ ] Performance benchmarks recorded and within budget
- [ ] Selection state machine transitions correctly in all states

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Shadow DOM traversal fails for edge cases (adopted stylesheets, slot reassignment) | Medium | Medium | Graceful degradation: closed shadows treated as opaque; open shadows traversed depth-first; fallback to element-level only |
| Stable references break on framework re-renders (React, Vue, Svelte) | Medium | Medium | Path-based references survive most re-renders; mutation observer invalidates stale references; re-resolution on invalidation |
| Visibility evaluation performance on deeply nested elements | Low | Low | Early termination: stop evaluating once clipping or `display: none` detected on ancestor; cached viewport bounds |
| Accessibility metadata collection timing out on complex pages | Low | Low | Configurable timeout (default 100ms); best-effort return; never blocks selection |
| Rapid pointer events during fast mouse movement cause selection thrashing | Medium | Low | Debounce pointer events (50ms); only resolve on click, not on hover; cancel in-flight resolution on new request |
