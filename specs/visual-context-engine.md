# Visual Context Engine

> **Specification ID:** SPEC-009
> **Version:** 1.0
> **Status:** Draft
> **Owner:** Platform Architecture
> **Last Updated:** 2026-07-28

---

## Architecture Sources

* `docs/visual-context-engine.md` — full VCE specification: 8-stage processing pipeline, evidence classification, deterministic behaviour, confidence engine, failure policy, performance budget, extension architecture
* `docs/architecture.md` §Visual Context Engine (lines 1354–1370) — VCE is Viskod's core; combines browser evidence, project evidence, diagnostics, screenshots; assembles context packets; validates schemas; Packet Assembly is final stage of VCE pipeline (not a separate component)
* `docs/architecture.md` §Packet Assembly (lines 1373–1407) — VCE's Packet Assembly stage combines DOM + Styles + Hierarchy + Screenshots + Diagnostics + Project Metadata + Source Hints into one Context Packet; one packet = one capture
* `docs/architecture.md` §Context Packet Lifecycle (lines 1413–1448) — Capture Requested → Collect Evidence → Validate → Build Packet → Persist → Expose via MCP → Ready; packets are immutable
* `docs/architecture.md` §Dependency Rules (lines 409–437) — dependencies always point inward: Studio → VCE → Browser Runtime → Playwright; reverse communication from BR to VCE occurs ONLY through Event Bus
* `docs/architecture.md` §Runtime Boundary (lines 764–785) — BR communicates with Chromium (via Playwright) and VCE (via VCE's public API which VCE calls); BR emits events to Event Bus; VCE subscribes to BR events exclusively through Event Bus; no direct callbacks, no imported BR modules; BR NEVER calls VCE directly
* `docs/architecture.md` §Context Builder → Packet Assembly — Context Builder is NOT a separate component; packet assembly is the final stage (Stage 8) of the VCE processing pipeline
* `docs/architecture.md` §Capture Pipeline (lines 1210–1268) — after selection: DOM Snapshot → Style Collection → Hierarchy → Diagnostics → Screenshots → Project Metadata → Source Hints → Context Packet
* `docs/ARCHITECTURE_BASELINE.md` §Canonical Dependency Model (lines 62–98) — Studio → VCE command flow; VCE → BR command flow; BR → Event Bus → VCE asynchronous event flow; prohibited dependencies: BR must not call VCE directly, VCE must not receive browser events through direct callbacks
* `docs/ARCHITECTURE_BASELINE.md` §Runtime Boundaries (lines 122–131) — VCE owns Context Packets, DOM analysis, style processing, hierarchy, confidence; forbidden access: browser process, Chromium API, Playwright directly
* `docs/design-principles.md` §Principle 1 (Evidence Before Inference) — evidence always preferable to assumptions; inference should only supplement evidence, never replace it; confidence is maximal for direct evidence, decreases for derived/inferred evidence
* `docs/design-principles.md` §Principle 4 (Determinism Over Probability) — platform outputs must be reproducible; identical inputs must produce materially identical outputs; avoid hidden randomness, undocumented heuristics, non-deterministic ordering

A specification with no architecture sources is invalid.

---

## Dependencies

| Specification | Status | Relationship |
|--------------|--------|-------------|
| SPEC-002 (shared-types) | Draft | Imports base types (`Identifier`, `Timestamp`, `Milliseconds`, `Bytes`, `Result`, `Maybe`, `DeepReadonly`), Zod schemas, `ViskodError`, `BaseEvent`, error categories and severities, constants (`CONTEXT_DIR`) |
| SPEC-003 (error-model) | Draft | Imports `ViskodError`, `ErrorCategory`, `ErrorSeverity`, error factory functions (`createError`, `isRecoverable`, `toDiagnostic`); produces VCE-2xxx errors conforming to error model; publishes `DiagnosticEvent` on pipeline failures |
| SPEC-005 (event-schema) | Draft | Imports `ViskodEvent` discriminated union and Zod schemas; publishes `ContextPacketGenerated` and `ProcessingFailed` events with typed payloads |
| SPEC-006 (context-packet-schema) | Draft | Produces Context Packets conforming to the canonical schema via Stage 8 Packet Assembly; imports `ContextPacket`, all sub-types (`ProjectMetadata`, `BrowserContext`, `SelectionInfo`, `DOMSummary`, `StyleSummary`, `HierarchySummary`, `ScreenshotInfo`, `DiagnosticEvent`, `SourceHint`, `ConfidenceScores`, `PacketMetadata`), `assemblePacket()`, `validatePacket()` |
| SPEC-007 (event-bus) | Draft | Subscribes to BR events through Event Bus (BR→EB→VCE flow); publishes `ContextPacketGenerated` and `ProcessingFailed` events to Event Bus; imports `EventBus` interface, `EventHandler` type, `SubscribeOptions` |
| SPEC-008 (browser-runtime) | Draft | Calls Browser Runtime public API (capture, navigate, DOM snapshot, styles, diagnostics); subscribes to BR events through Event Bus (never direct callbacks); imports `BrowserRuntime` interface, `BrowserHandle`, `Viewport`, `DOMSnapshot`, `StyleSnapshot`, `Screenshot`, `BrowserDiagnostics` |

**Optional P1 dependencies (graceful degradation when absent):**

| Specification | Status | Relationship |
|--------------|--------|-------------|
| SPEC-010 (capture-pipeline) | Planned (P1) | Delegates packet persistence when available; P0 handles persistence internally to `.viskod/context/{packetId}.json` |
| SPEC-012 (project-scanner) | Planned (P1) | Calls `ProjectScanner.getMetadata()` for framework detection, routes, package manager; P0 uses nullable `project` field with defaults |

---

## Consumers

| Specification | Status | Relationship |
|--------------|--------|-------------|
| SPEC-014 (mcp-server) | Draft | Calls `generatePacket()` to fulfil MCP tool requests (`capture_selection`, `capture_viewport`); reads `getLastPacket()` for MCP resources; calls `health()` for server health checks |
| Studio | Draft | Triggers `processCapture()` and `processSelection()` in response to user interactions; displays generated packet ID and confidence scores |
| SDK | Planned | Calls `generatePacket()` programmatically for automated capture workflows |
| Public API | Planned | Exposes VCE capabilities through versioned public interfaces |

---

## Purpose

Defines the Visual Context Engine (VCE): the architectural centerpiece and core intelligence layer of Viskod. The VCE is the central integration point that transforms raw browser observations into structured, evidence-based Context Packets suitable for AI coding agents. It combines browser evidence, project metadata, diagnostics, and screenshots through a deterministic 8-stage processing pipeline that progresses from raw Collection through Validation, Normalisation, Structural Analysis, Visual Analysis, Semantic Analysis, Confidence Evaluation, and Packet Assembly. The VCE never edits code, generates implementations, or accesses the browser process directly. Its sole responsibility is to transform observations into reliable understanding.

---

## Scope

* The complete 8-stage processing pipeline: Collection → Validation → Normalisation → Structural Analysis → Visual Analysis → Semantic Analysis → Confidence Evaluation → Packet Assembly
* Primary packet generation entry points: `generatePacket()`, `processCapture()`, `processSelection()`
* Browser Runtime public API invocation (capture, navigation, DOM snapshot, computed styles, diagnostics, overlay)
* Event Bus subscription to Browser Runtime events (BrowserStarted, PageLoaded, NavigationCompleted, ViewportChanged, CaptureCompleted, SelectionChanged, DiagnosticsUpdated, BrowserDisconnected)
* Context Packet assembly conforming to SPEC-006 canonical schema
* Deterministic processing guarantee: identical inputs → identical outputs
* Confidence scoring: observed evidence > derived evidence > inferred evidence
* Packet persistence (P0: internal to `.viskod/context/`; P1: delegates to Capture Pipeline)
* Sensitive attribute redaction (passwords, tokens, cookies, secrets stripped)
* Health monitoring and diagnostic access (`health()`, `getLastPacket()`)
* Graceful degradation when optional P1 dependencies (Capture Pipeline, Project Scanner) are unavailable
* Error isolation: individual pipeline stage failures preserve previous stage outputs; partial packets preferred over complete failure (except Assembly stage)

---

## Non-Goals

* Browser automation or browser process management (owned by SPEC-008 Browser Runtime)
* Browser process or Chromium API access — VCE must never import Playwright
* Source code modification, editing, or generation
* AI model invocation, prompting, or reasoning
* MCP communication protocols, tool definitions, or resource exposure (owned by SPEC-014 MCP Server)
* Capture storage management, retention policies, or export (owned by SPEC-010 Capture Pipeline)
* Repository scanning, framework detection, or package manager detection (owned by SPEC-012 Project Scanner)
* Source hint resolution or implementation file inference (owned by SPEC-011 Source Hint Engine)
* DOM parsing beyond what Browser Runtime provides
* File system access outside `.viskod/` storage directory
* Network communication or external service integration
* Cloud execution or hosted APIs
* Authentication or authorization

---

## Terminology

Terms specific to this specification. Reference `docs/glossary.md` for all canonical terms.

| Term | Definition |
|------|-----------|
| Processing pipeline | The deterministic 8-stage sequence through which all evidence flows: Collection, Validation, Normalisation, Structural Analysis, Visual Analysis, Semantic Analysis, Confidence Evaluation, Packet Assembly. Each stage is a pure function of its inputs. |
| Evidence source | A subsystem that provides data consumed by the VCE pipeline: Browser Runtime (DOM, styles, screenshots, diagnostics), Project Scanner (metadata, routes), Source Hint Engine (file hints), Diagnostics (console errors). |
| Confidence score | A value in [0.0, 1.0] representing how much interpretation was required to produce a result. 1.0 = directly observed (no interpretation). Lower values = more inference layers. Confidence decreases as interpretation increases. |
| Stage isolation | The design rule that a failure in pipeline stage N preserves outputs from stages 1 through N-1. The failed stage's output is omitted from the final packet. Only Assembly stage failure prevents packet production entirely. |
| Partial Context Packet | A Context Packet produced when one or more non-Assembly stages fail. The packet includes all successful stage outputs and omits failed stage outputs. Partial packets are preferred over complete failure. |
| Packet persistence | Writing a Context Packet to durable storage. In P0, VCE handles this internally (`.viskod/context/{packetId}.json`). In P1, VCE delegates to the Capture Pipeline. |
| Command flow | Synchronous or request-response calls from VCE to Browser Runtime (or other dependencies). VCE initiates; the dependency responds. |
| Event flow | Asynchronous event delivery from Browser Runtime through Event Bus to VCE. Browser Runtime publishes; Event Bus delivers; VCE subscribes. VCE never receives browser events through direct callbacks. |

---

## Runtime Boundary

| Boundary | Value |
|----------|-------|
| Process | Main desktop process (same as Studio, Browser Runtime, Event Bus) |
| Calls (command flow) | BrowserRuntime API (`captureScreenshot`, `navigate`, `getDOMSnapshot`, `getComputedStyles`, `getDiagnostics`, `injectOverlay`, `removeOverlay`, `highlightElement`, `clearHighlight`, `setViewport`, `getViewport`, `health`, `shutdown`); CapturePipeline API (`persist` — optional, P0 handles internally); ProjectScanner API (`getMetadata` — optional, P0 uses defaults) |
| Subscribes (event flow) | Event Bus: `BrowserStarted`, `PageLoaded`, `NavigationCompleted`, `ViewportChanged`, `SelectionChanged`, `CaptureStarted`, `CaptureCompleted`, `CaptureFailed`, `DiagnosticsUpdated`, `ConsoleError`, `BrowserDisconnected` |
| Publishes (event flow) | Event Bus: `ContextPacketGenerated`, `ProcessingFailed` |
| Imports forbidden | `playwright`, `chromium`, any Chromium DevTools Protocol module, any browser-process module, `@viskod/browser-runtime` internal modules (imports only the public `BrowserRuntime` interface) |
| Never calls | VCE never calls subscribers directly; never receives browser events through direct callbacks or by importing Browser Runtime internal modules; never imports Playwright or any browser engine API |
| File system | Write access only to `.viskod/context/` directory (P0 persistence); never reads repository files directly |
| Network | No outbound connections; all data originates from local subsystems |
| Secrets | Never accesses `.env` files, environment variables, authentication tokens, cookies, local storage, or session storage |

---

## Responsibilities

1. **Orchestrate the 8-stage deterministic processing pipeline** (Collection → Validation → Normalisation → Structural Analysis → Visual Analysis → Semantic Analysis → Confidence Evaluation → Packet Assembly)
2. **Call Browser Runtime public API** for capture, navigation, DOM snapshot, computed styles, diagnostics, overlay, viewport, and highlight operations — never access Playwright directly
3. **Subscribe to Browser Runtime events through Event Bus** — never receive browser events through direct callbacks or by importing BR internals
4. **Collect raw browser evidence** from DOM snapshots, computed styles, screenshots, diagnostics, and viewport state
5. **Validate all collected evidence** against schemas, rejecting malformed or incomplete data while preserving valid evidence sources
6. **Normalise evidence** into canonical units and representations (colours to hex, units to pixels, typography to points, coordinates to viewport-relative)
7. **Perform structural analysis** to construct parent-child relationships, sibling groupings, container hierarchies, landmarks, navigation hierarchy, and element depth
8. **Perform visual analysis** of rendered interface: alignment, spacing, overflow detection, clipping, visibility, stacking order, layout groups
9. **Perform semantic analysis** to identify meaningful UI concepts: navigation, sidebar, modal, form, card, table, hero section, footer, toolbar, button group, dialog, list — independently of implementation technology
10. **Calculate confidence scores** for every derived or inferred result; confidence decreases as interpretation increases; observed values remain highest (1.0)
11. **Assemble Context Packets** conforming to SPEC-006 canonical schema via Stage 8 Packet Assembly — combine DOM, styles, hierarchy, screenshots, diagnostics, project metadata, source hints, and confidence scores
12. **Redact sensitive attributes** from DOM: passwords, tokens, cookies, secrets, authentication attributes, environment variable patterns — replaced with `"[REDACTED]"`
13. **Truncate selection text** at 500 characters to prevent accidental PII inclusion
14. **Persist Context Packets** to `.viskod/context/{packetId}.json` in P0; delegate to Capture Pipeline in P1
15. **Publish `ContextPacketGenerated` event** to Event Bus on successful packet assembly
16. **Publish `ProcessingFailed` event** to Event Bus on Assembly stage failure
17. **Provide `health()` interface** returning VCE processing statistics
18. **Provide `getLastPacket()` interface** returning the most recently generated Context Packet or null
19. **Degrade gracefully** when optional P1 dependencies (Capture Pipeline, Project Scanner) are absent — handle persistence internally, use nullable project metadata
20. **Enforce stage isolation** — failure in one pipeline stage preserves previous stage outputs; omit failed stage output from packet; only Assembly stage failure prevents packet production
21. **Remain stateless between packet generations** — no mutable shared state; each `generatePacket()` invocation is a fresh pipeline run
22. **Guarantee deterministic output** — identical BrowserHandle state and identical selection must produce bit-identical ContextPacket output (except timestamp metadata)
23. **Contain zero business logic** unrelated to evidence processing and packet assembly
24. **Report all errors via structured `ViskodError`** conforming to SPEC-003; publish DiagnosticEvents on failure

---

## Interfaces

### Public API

| Signature | Purpose | Preconditions | Postconditions | Errors |
|-----------|---------|---------------|----------------|--------|
| `generatePacket(handle: BrowserHandle, selection?: SelectionTarget): Promise<Result<ContextPacket>>` | Primary entry point: generate a Context Packet from the current browser state and optional element selection | `handle` is a valid, active `BrowserHandle`; browser is in `PageLoaded` or `Inspectable` state; if `selection` provided, its `selector` resolves to a valid DOM element | Returns a validated, immutable `ContextPacket` conforming to SPEC-006; packet persisted to `.viskod/context/{packetId}.json` (or via Capture Pipeline in P1); `ContextPacketGenerated` event published to Event Bus; VCE health counters updated | `VCE_MISSING_BROWSER_EVIDENCE` if handle is invalid; `VCE_COLLECTION_FAILED` if BR API call fails; `VCE_ASSEMBLY_FAILED` if packet assembly fails; see §Error Behaviour for all failure modes |
| `processCapture(captureId: string, browserHandle: BrowserHandle): Promise<Result<ContextPacket>>` | Capture-triggered entry: called after a `CaptureCompleted` event, auto-generates a context packet for the captured state | `captureId` is a valid UUID v4 referencing a completed capture; `browserHandle` is a valid, active `BrowserHandle`; browser is in `PageLoaded` or `Inspectable` state | Same postconditions as `generatePacket()`; links packet `captureId` to the provided `captureId` | Same errors as `generatePacket()` plus `VCE_CAPTURE_NOT_FOUND` if captureId does not reference a valid capture |
| `processSelection(browserHandle: BrowserHandle, selection: SelectionTarget): Promise<Result<ContextPacket>>` | Selection-triggered entry: called after user selects a UI element, auto-generates a context packet focused on the selection | `browserHandle` is a valid, active `BrowserHandle`; `selection.selector` resolves to a valid DOM element; browser is in `Inspectable` state | Same postconditions as `generatePacket()` with focus on the selected element | Same errors as `generatePacket()` plus `VCE_INVALID_SELECTION` if selector does not resolve to a valid DOM element |
| `health(): VCEHealth` | Return current VCE processing statistics | None (synchronous, always returns a value) | Returns `VCEHealth` with status, packet count, and timing metrics | None (never fails) |
| `getLastPacket(): ContextPacket \| null` | Return the most recently generated Context Packet | None (synchronous, always returns a value) | Returns the last `ContextPacket` or `null` if no packet has been generated | None (never fails) |

### Construction

```typescript
interface VCECreationOptions {
  browserRuntime: BrowserRuntime;      // Required: BR public API for capture, navigate, DOM, styles, diagnostics
  eventBus: EventBus;                  // Required: Event Bus for subscribing to BR events and publishing VCE events
  capturePipeline?: CapturePipeline;   // Optional (P1): delegates packet persistence; P0 handles internally
  projectScanner?: ProjectScanner;     // Optional (P1): provides project metadata; P0 uses defaults (nullable)
}
```

### Supporting Types

```typescript
interface SelectionTarget {
  selector: string;          // CSS selector path to the selected element
  boundingBox: BoundingBox;  // Element bounding box in viewport coordinates
}

interface VCEHealth {
  status: 'healthy' | 'degraded' | 'unavailable';
  packetsGenerated: number;
  lastProcessingTimeMs: number;
  averageProcessingTimeMs: number;
  failedCount: number;
}
```

### Events Published

| Event | Payload Schema | When Published |
|-------|---------------|----------------|
| `ContextPacketGenerated` | `{ packetId: Identifier; captureId: Identifier; processingTimeMs: number; evidenceSources: string[]; timestamp: Timestamp }` | After Stage 8 Packet Assembly completes successfully and the packet is validated and persisted |
| `ProcessingFailed` | `{ packetId: Identifier \| null; captureId: Identifier; stage: string; error: ViskodError; timestamp: Timestamp }` | When the Assembly stage fails (packet cannot be produced); or when Collection stage fails with a fatal `VCE_MISSING_BROWSER_EVIDENCE` error |

### Events Subscribed

VCE subscribes to the following events through the Event Bus. All events originate from Browser Runtime (published to Event Bus), never from direct BR→VCE callbacks.

| Event | Source (Event Bus) | Action |
|-------|-------------------|--------|
| `BrowserStarted` | Event Bus ← Browser Runtime | Record browser context ID; transition VCE to `healthy` if currently `unavailable` |
| `PageLoaded` | Event Bus ← Browser Runtime | Update internal state with current URL; no automatic packet generation |
| `NavigationCompleted` | Event Bus ← Browser Runtime | Update internal state with navigation target URL |
| `ViewportChanged` | Event Bus ← Browser Runtime | Update internal state with current viewport dimensions |
| `CaptureCompleted` | Event Bus ← Browser Runtime | Auto-invoke `processCapture(captureId, handle)` to generate a context packet for the capture |
| `SelectionChanged` | Event Bus ← Browser Runtime | Auto-invoke `processSelection(handle, selection)` to generate a context packet for the selection |
| `DiagnosticsUpdated` | Event Bus ← Browser Runtime | Update internal diagnostic cache; attach to future packets |
| `BrowserDisconnected` | Event Bus ← Browser Runtime | Invalidate current BrowserHandle; transition VCE to `degraded`; log diagnostic; abort in-progress packet generation |

---

## Data Models

### Stage 1 — Collection: Raw Evidence Bundle (internal)

```typescript
interface RawEvidence {
  domSnapshot: DOMSnapshot | null;
  styleSnapshot: StyleSnapshot | null;
  screenshots: Screenshot[];
  diagnostics: BrowserDiagnostics | null;
  viewport: Viewport;
  url: string;
  projectMetadata: ProjectMetadata | null;
  sourceHints: SourceHint[];
  selection: SelectionTarget | null;
  captureId: string;
  timestamp: string;
}
```

`RawEvidence` is internal to the VCE pipeline. It is never exposed through the public API.

### Stage 2 — Validation: ValidatedEvidence

```typescript
interface ValidatedEvidence {
  domSnapshot: DOMSnapshot;               // Required — rejected if null
  styleSnapshot: StyleSnapshot;           // Required — rejected if null
  screenshots: Screenshot[];              // May be empty (no screenshots captured)
  diagnostics: BrowserDiagnostics | null; // Nullable — diagnostics are optional evidence
  viewport: Viewport;                     // Required — rejected if null or invalid dimensions
  url: string;                            // Required — rejected if empty or malformed
  projectMetadata: ProjectMetadata | null; // Nullable — project scanner is P1
  sourceHints: SourceHint[];              // May be empty (no hints available)
  selection: SelectionTarget | null;       // Nullable — packet may not have a specific selection
  captureId: string;                      // Required — UUID v4
  timestamp: string;                      // Required — ISO 8601
  validationErrors: string[];             // Empty if all evidence passed validation
}
```

Validation rejects:
- Null or undefined values for required evidence sources (`domSnapshot`, `styleSnapshot`, `viewport`, `url`, `captureId`, `timestamp`)
- DOM snapshots with no `tagName` or missing `boundingBox`
- Style snapshots with empty `computed` records
- Viewport with zero or negative dimensions
- Non-UUID `captureId`

If required evidence is rejected, `VCE_VALIDATION_ERROR` is recorded. The pipeline continues with remaining evidence (partial packet preferred over complete failure). If all required evidence fails validation, the pipeline terminates with `VCE_COLLECTION_FAILED`.

### Stage 3 — Normalisation: NormalisedEvidence

```typescript
interface NormalisedEvidence {
  domSnapshot: DOMSnapshot;       // Attributes normalised: boolean attributes → "true"/"false"; data-* preserved
  styleSnapshot: StyleSnapshot;   // Colours → hex; units → px (computed values already in px); typography → pt
  screenshots: Screenshot[];      // Unchanged (paths are already relative)
  diagnostics: BrowserDiagnostics | null;
  viewport: Viewport;             // Unchanged (already in px)
  url: string;                     // Normalised: trailing slashes stripped; hostname lowercased
  projectMetadata: ProjectMetadata | null;
  sourceHints: SourceHint[];
  selection: SelectionTarget | null;
  captureId: string;
  timestamp: string;
}
```

Normalisation rules:
- CSS colours: `rgb(255, 0, 0)` → `"#ff0000"`; `rgba(0, 0, 0, 0.5)` → `"rgba(0, 0, 0, 0.5)"` (alpha preserved)
- CSS units: computed values are already in pixels; no conversion needed for `StyleSummary.computed`
- DOM boolean attributes: `checked` → `checked="true"`; absence → not included
- URL: `https://Example.com/path/` → `https://example.com/path`
- Spacing: padding/margin values preserved as numbers (px)

### Stage 4 — Structural Analysis: StructureAnalysis

```typescript
interface StructureAnalysis {
  hierarchy: {
    selectedNode: {
      tagName: string;
      id: string | null;
      className: string | null;
      role: string | null;
      depth: number;
      text: string | null;             // Truncated at 500 chars
    };
    parents: HierarchyNode[];           // Ancestor chain, max 10, ordered root→parent
    siblings: HierarchyNode[];          // Sibling elements, max 20
    children: HierarchyNode[];          // Child elements, max 50
  };
  containerChain: ContainerInfo[];      // Identified containers (div, section, article, main, nav, aside, header, footer)
  landmarks: string[];                  // ARIA landmarks detected (banner, navigation, main, complementary, contentinfo)
  navigationHierarchy: NavInfo | null;   // Navigation structure if within <nav> or role="navigation"
  depth: number;                        // Selected element depth from document root
}

interface ContainerInfo {
  tagName: string;
  role: string | null;
  id: string | null;
  className: string | null;
  depth: number;
}

interface NavInfo {
  type: 'primary' | 'secondary' | 'breadcrumb' | 'pagination' | 'unknown';
  itemCount: number;
  activeIndex: number | null;
}
```

HierarchyNode is imported from SPEC-006.

### Stage 5 — Visual Analysis: VisualAnalysis

```typescript
interface VisualAnalysis {
  layout: LayoutInfo;                   // Display, position, flex/grid properties, dimensions, spacing
  alignment: AlignmentInfo;             // Alignment with siblings and parent
  spacing: SpacingAnalysis;             // Spacing relationships
  overflow: OverflowInfo;               // Overflow detection
  visibility: VisibilityInfo;           // Visibility status
  stacking: StackingInfo;               // Z-index and stacking context
}

interface LayoutInfo {
  display: string;                      // 'block', 'flex', 'grid', 'inline', 'inline-block', 'none', etc.
  position: string;                     // 'static', 'relative', 'absolute', 'fixed', 'sticky'
  flexDirection: string | null;         // 'row', 'column', 'row-reverse', 'column-reverse'
  gridTemplateColumns: string | null;   // e.g., 'repeat(3, 1fr)'
  width: number;                        // Computed width in px
  height: number;                       // Computed height in px
  margin: Spacing;                      // Margin in px (top, right, bottom, left)
  padding: Spacing;                     // Padding in px (top, right, bottom, left)
}

interface AlignmentInfo {
  horizontal: 'left' | 'center' | 'right' | 'stretch' | 'unknown';
  vertical: 'top' | 'middle' | 'bottom' | 'stretch' | 'unknown';
  withParent: 'aligned' | 'offset' | 'unknown';
  withSiblings: 'consistent' | 'inconsistent' | 'unknown';
}

interface SpacingAnalysis {
  gap: number | null;                   // Gap between flex/grid items in px
  consistentSpacing: boolean;           // Whether spacing pattern is consistent across siblings
  spacingScale: number[];               // Detected spacing values in px
}

interface OverflowInfo {
  hasHorizontalOverflow: boolean;
  hasVerticalOverflow: boolean;
  overflowX: string;                    // Computed overflow-x value
  overflowY: string;                    // Computed overflow-y value
  scrollHeight: number;
  scrollWidth: number;
  clientHeight: number;
  clientWidth: number;
}

interface VisibilityInfo {
  isVisible: boolean;                   // Not display:none, not visibility:hidden, opacity > 0
  opacity: number;                      // 0.0–1.0
  isInViewport: boolean;                // Bounding box intersects viewport
  clipPath: string | null;              // clip-path CSS value if applied
}

interface StackingInfo {
  zIndex: number | null;                // Computed z-index (null = auto)
  createsStackingContext: boolean;      // Whether element creates a new stacking context
  stackingContextParent: string | null; // Selector of the stacking context parent
}
```

### Stage 6 — Semantic Analysis: SemanticLabels

```typescript
interface SemanticLabels {
  primaryRole: string;                  // Primary ARIA role or implied role
  semanticCategory: SemanticCategory;   // High-level UI category
  ariaAttributes: Record<string, string>; // All ARIA attributes on the element
  label: string | null;                 // Accessible name (from aria-label, aria-labelledby, or associated <label>)
  description: string | null;           // Accessible description (from aria-describedby)
  headingLevel: number | null;          // 1–6 if element is a heading
  isFocusable: boolean;                 // Whether element can receive focus
  isDisabled: boolean;                  // Whether element has disabled attribute or aria-disabled="true"
  isRequired: boolean;                  // Whether element has required attribute or aria-required="true"
  isExpanded: boolean | null;           // null if not expandable; boolean if aria-expanded is set
  isSelected: boolean | null;           // null if not selectable; boolean if aria-selected is set
  isInteractive: boolean;               // Whether element is interactive (link, button, input, select, etc.)
  formAssociation: FormInfo | null;     // Form association if within a <form>
}

type SemanticCategory =
  | 'navigation'
  | 'sidebar'
  | 'modal'
  | 'dialog'
  | 'form'
  | 'card'
  | 'table'
  | 'list'
  | 'toolbar'
  | 'button-group'
  | 'hero-section'
  | 'footer'
  | 'header'
  | 'main-content'
  | 'search'
  | 'breadcrumb'
  | 'pagination'
  | 'tab-panel'
  | 'accordion'
  | 'alert'
  | 'unknown';

interface FormInfo {
  formId: string | null;
  formName: string | null;
  formAction: string | null;
  formMethod: string | null;
  inputType: string | null;             // 'text', 'email', 'password', 'checkbox', 'radio', 'submit', etc.
  fieldCount: number;                   // Number of form fields in the same form
}
```

### Stage 7 — Confidence Evaluation: ConfidenceScores

```typescript
interface ConfidenceScores {
  sourceMapping: number;       // 0.0–1.0 — confidence in source hint accuracy
  semanticLabeling: number;    // 0.0–1.0 — confidence in semantic role detection
  layoutAnalysis: number;      // 0.0–1.0 — confidence in layout analysis
  frameworkDetection: number;  // 0.0–1.0 — confidence in framework identification
  structuralAnalysis: number;  // 0.0–1.0 — confidence in DOM hierarchy correctness
  visualAnalysis: number;      // 0.0–1.0 — confidence in visual analysis (alignment, spacing, overflow)
  evidenceCompleteness: number; // 0.0–1.0 — ratio of available evidence sources to expected evidence sources
}

// Confidence scoring rules:
type EvidenceClass = 'observed' | 'derived' | 'inferred';

const confidenceRanges: Record<EvidenceClass, [number, number]> = {
  observed:  [0.95, 1.0],   // Direct browser measurement (DOM attributes, computed styles, viewport, URL)
  derived:   [0.60, 0.99],  // Calculation from observations (layout, hierarchy, spacing, alignment)
  inferred:  [0.01, 0.99],  // Probabilistic conclusion (semantic category, source hints, framework)
};

// Confidence calculation per category:
// - sourceMapping: inferred (0.01–0.99), based on hint resolution success and evidence count
// - semanticLabeling: inferred (0.01–0.99), based on ARIA attribute presence/absence
// - layoutAnalysis: derived (0.60–0.99), computed from style snapshot completeness
// - frameworkDetection: inferred (0.01–0.99), based on project scanner availability
// - structuralAnalysis: derived (0.60–0.99), based on DOM snapshot depth and completeness
// - visualAnalysis: derived (0.60–0.99), based on style snapshot completeness
// - evidenceCompleteness: derived (0.60–0.99), ratio of available evidence / total evidence sources
```

### Stage 8 — Packet Assembly: Output

Produces a `ContextPacket` conforming to SPEC-006. This stage calls `assemblePacket()` from SPEC-006 with the fully processed evidence. The assembled packet is validated against the Context Packet schema, serialised, and persisted. No further processing occurs after assembly.

### Internal Pipeline Context

```typescript
interface PipelineContext {
  packetId: string;                     // UUID v4, assigned at pipeline start
  correlationId: string;                // UUID v4, shared across related events
  startTime: number;                    // performance.now() at pipeline start
  stage: PipelineStage;                 // Current pipeline stage
  evidence: RawEvidence;                // Stage 1 output
  validatedEvidence: ValidatedEvidence | null;  // Stage 2 output
  normalisedEvidence: NormalisedEvidence | null; // Stage 3 output
  structureAnalysis: StructureAnalysis | null;   // Stage 4 output
  visualAnalysis: VisualAnalysis | null;         // Stage 5 output
  semanticLabels: SemanticLabels | null;         // Stage 6 output
  confidenceScores: ConfidenceScores | null;     // Stage 7 output
  contextPacket: ContextPacket | null;           // Stage 8 output
  errors: StageError[];                 // Accumulated errors across stages
  stageTimings: Record<string, number>; // Per-stage timing in ms
}

type PipelineStage =
  | 'idle'
  | 'collecting'
  | 'validating'
  | 'normalising'
  | 'analysing-structure'
  | 'analysing-visual'
  | 'analysing-semantic'
  | 'evaluating-confidence'
  | 'assembling'
  | 'complete'
  | 'failed';

interface StageError {
  stage: PipelineStage;
  error: ViskodError;
  timestamp: string;
}
```

---

## State Model

VCE is **stateless between packet generations**. Each invocation of `generatePacket()`, `processCapture()`, or `processSelection()` creates a new `PipelineContext` scoped to that generation. No mutable shared state persists across invocations.

### Pipeline State Machine

```
Idle
  │
  │  generatePacket() / processCapture() / processSelection()
  │
  ▼
Collecting ──→ Validating ──→ Normalising ──→ Analysing ──→ Evaluating ──→ Assembling ──→ Complete
    │               │               │               │              │              │
    │               │               │               │              │              │
    └───────────────┴───────────────┴───────────────┴──────────────┴──────────────┘
                                        │
                                        │  Any stage can fail
                                        │  (non-Assembly: preserve previous stages, continue)
                                        │  (Assembly: terminate, no packet produced)
                                        ▼
                                      Failed
```

### State Descriptions

| State | Description | Next State | Recovery |
|-------|-------------|------------|----------|
| **Idle** | VCE is ready; no pipeline running. `health()` returns current statistics. | `Collecting` on `generatePacket()` call | N/A |
| **Collecting** | Stage 1: Calling Browser Runtime APIs for DOM, styles, screenshots, diagnostics. | `Validating` on collection complete; `Failed` if all BR calls fail | Retry failed BR API calls once; if persistent, report `VCE_COLLECTION_FAILED` |
| **Validating** | Stage 2: Validating all collected evidence against schemas. | `Normalising` if enough evidence passes; `Failed` if all required evidence rejected | Reject individual invalid evidence sources; continue with remaining |
| **Normalising** | Stage 3: Normalising evidence to canonical representations. | `Analysing` (structural sub-stage) | N/A — normalisation is deterministic and cannot fail |
| **Analysing** | Stages 4–6: Structural, Visual, and Semantic analysis in sequence. | `Evaluating` on all three analysis stages complete | Each sub-stage is isolated; failure in one preserves outputs from others |
| **Evaluating** | Stage 7: Computing confidence scores for all evidence categories. | `Assembling` | Confidence defaults to 0.5 if computation fails |
| **Assembling** | Stage 8: Calling `assemblePacket()` from SPEC-006 to produce final Context Packet. | `Complete` on success; `Failed` if assembly fails | No recovery — Assembly failure is terminal for this packet; `ProcessingFailed` event published |
| **Complete** | Packet generated, validated, persisted, and published. Pipeline context discarded. | `Idle` (ready for next invocation) | N/A |
| **Failed** | Pipeline terminated. If failed before Assembly, previous stage outputs are preserved in the PipelineContext for diagnostics. If failed at Assembly, no packet produced. | `Idle` (ready for next invocation) | Failures increment `VCEHealth.failedCount`; `ProcessingFailed` event published for Assembly failures |

### Health State Machine

```
unavailable ──→ healthy ──→ degraded
     ▲              │            │
     │              │            │
     └──────────────┴────────────┘
```

| Health Status | Condition |
|---------------|-----------|
| `healthy` | No failures in last 10 packet generations; average processing time under budget |
| `degraded` | One or more failures in last 10 generations; or average processing time exceeds 500ms; or Browser Runtime is disconnected |
| `unavailable` | VCE has not yet generated any packets (pre-first-generation); or Event Bus is unavailable; or Browser Runtime has never connected |

### Invariants

1. VCE is stateless between `generatePacket()` invocations — each invocation creates a fresh `PipelineContext`
2. Exactly one `PipelineContext` exists at any time (no concurrent packet generation in Phase 1)
3. `PipelineContext.packetId` is assigned during `Collecting` and never changes
4. Non-Assembly stage failures preserve all previous stage outputs in the `PipelineContext`
5. Assembly stage failure prevents packet production entirely — no partial packet is emitted
6. `ContextPacketGenerated` event is published only after successful persistence
7. `ProcessingFailed` event is published only for fatal errors (Assembly failure, complete Collection failure)
8. VCE health transitions are monotonic within a session — `unavailable` → `degraded`/`healthy`; `healthy` → `degraded`; never `healthy` → `unavailable` while BR is connected

---

## Command Flows

### generatePacket Flow

```
Caller (MCP Server, Studio, SDK, Public API)
  │
  │  generatePacket(handle, selection?)
  │
  ▼
──calls──→ VCE.generatePacket()
              │
              │  Stage 1 — Collection
              │  ├──→ BrowserRuntime.getDOMSnapshot(handle, selection.selector) ──calls──→ Browser Runtime
              │  ├──→ BrowserRuntime.getComputedStyles(handle, selection.selector) ──calls──→ Browser Runtime
              │  ├──→ BrowserRuntime.captureScreenshot(handle, 'viewport') ──calls──→ Browser Runtime
              │  ├──→ BrowserRuntime.captureScreenshot(handle, 'selection') ──calls──→ Browser Runtime (if selection)
              │  ├──→ BrowserRuntime.getDiagnostics(handle) ──calls──→ Browser Runtime
              │  ├──→ BrowserRuntime.getViewport(handle) ──calls──→ Browser Runtime
              │  │
              │  ├──→ (optional) ProjectScanner.getMetadata() ──calls──→ Project Scanner (P1, nullable in P0)
              │  ├──→ (optional) SourceHintEngine.getHints(selection) ──calls──→ Source Hint Engine (P1, nullable in P0)
              │  │
              │  └── Construct RawEvidence bundle
              │
              │  Stage 2 — Validation
              │  ├── Validate each evidence source against expected schema
              │  ├── Reject individual invalid sources; accumulate validationErrors
              │  └── If all required evidence rejected → terminate, return VCE_COLLECTION_FAILED
              │
              │  Stage 3 — Normalisation
              │  ├── Normalise colours → hex
              │  ├── Normalise URLs → lowercase hostname, strip trailing slashes
              │  ├── Normalise boolean attributes
              │  └── Produce NormalisedEvidence
              │
              │  Stage 4 — Structural Analysis
              │  ├── Build hierarchy (selected node, parents, siblings, children)
              │  ├── Identify container chain (div, section, article, main, nav, aside, header, footer)
              │  ├── Detect ARIA landmarks
              │  ├── Detect navigation hierarchy
              │  └── Compute depth
              │
              │  Stage 5 — Visual Analysis
              │  ├── Extract layout info (display, position, flex/grid, dimensions, spacing)
              │  ├── Compute alignment (horizontal, vertical, with parent, with siblings)
              │  ├── Analyse spacing (gap, consistency, scale)
              │  ├── Detect overflow (horizontal, vertical, scroll dimensions)
              │  ├── Check visibility (display, opacity, viewport intersection)
              │  └── Analyse stacking context (z-index, stacking context parent)
              │
              │  Stage 6 — Semantic Analysis
              │  ├── Determine primary ARIA role or implied role
              │  ├── Classify semantic category (navigation, form, card, modal, etc.)
              │  ├── Collect ARIA attributes
              │  ├── Extract accessible name and description
              │  ├── Detect heading level
              │  ├── Check interactive state (focusable, disabled, required, expanded, selected)
              │  └── Identify form association
              │
              │  Stage 7 — Confidence Evaluation
              │  ├── Score sourceMapping (inferred, based on hint availability)
              │  ├── Score semanticLabeling (inferred, based on ARIA presence)
              │  ├── Score layoutAnalysis (derived, based on style completeness)
              │  ├── Score frameworkDetection (inferred, based on project scanner)
              │  ├── Score structuralAnalysis (derived, based on DOM snapshot depth)
              │  ├── Score visualAnalysis (derived, based on style completeness)
              │  └── Score evidenceCompleteness (derived, ratio of available evidence)
              │
              │  Stage 8 — Packet Assembly
              │  ├── Call SPEC-006 assemblePacket() with all evidence sections
              │  ├── Validate packet against ContextPacket schema
              │  ├── Apply redaction rules to DOM attributes
              │  ├── Truncate text content at 500 chars
              │  ├── Serialise to canonical JSON
              │  │
              │  ├── (P1) CapturePipeline.persist(packet) ──calls──→ Capture Pipeline
              │  │    OR
              │  ├── (P0) Write to .viskod/context/{packetId}.json directly
              │  │
              │  ├── Publish ContextPacketGenerated event ──publish──→ Event Bus
              │  ├── Update VCE health counters
              │  └── Return Result.ok(ContextPacket)
              │
              └── (on Assembly failure)
                    ├── Publish ProcessingFailed event ──publish──→ Event Bus
                    └── Return Result.err(VCE_ASSEMBLY_FAILED)

──returns──→ Result<ContextPacket>
```

### processCapture Flow

```
Event Bus ──delivers──→ VCE subscriber (CaptureCompleted event)
  │
  │  processCapture(captureId, browserHandle)
  │
  ▼
──calls──→ VCE.processCapture()
              │
              ├── Validate captureId references a valid, completed capture
              ├── Call generatePacket(browserHandle, selection=undefined)
              │     └── (full viewport capture, no specific element selection)
              ├── Link packet.captureId to the provided captureId
              └── Return Result<ContextPacket>

──returns──→ Result<ContextPacket>
```

### processSelection Flow

```
Event Bus ──delivers──→ VCE subscriber (SelectionChanged event)
  │
  │  processSelection(browserHandle, selection)
  │
  ▼
──calls──→ VCE.processSelection()
              │
              ├── Validate selection.selector resolves to a valid DOM element
              ├── Call generatePacket(browserHandle, selection)
              │     └── (selection-focused capture with element-specific DOM, styles, screenshot)
              └── Return Result<ContextPacket>

──returns──→ Result<ContextPacket>
```

### Health Check Flow

```
Caller (any consumer)
  │
  │  health()
  │
  ▼
──calls──→ VCE.health()
              │
              ├── Return VCEHealth synchronously
              │     ├── status: derived from recent failure history and BR connection state
              │     ├── packetsGenerated: monotonic counter since VCE initialisation
              │     ├── lastProcessingTimeMs: timing from most recent pipeline run
              │     ├── averageProcessingTimeMs: rolling average of last 10 runs
              │     └── failedCount: monotonic counter of failed packet generations

──returns──→ VCEHealth
```

---

## Event Flows

### Browser Runtime → Event Bus → VCE (Subscription Flow)

All browser events originate from Browser Runtime, are published to the Event Bus, and are delivered to VCE subscribers. VCE never receives browser events through direct callbacks or by importing Browser Runtime internal modules.

```
Browser Runtime ──publish──→ Event Bus ──deliver──→ VCE subscriber

Event: CaptureCompleted
  → VCE.processCapture(captureId, browserHandle)
  → Auto-generate context packet for the captured state

Event: SelectionChanged
  → VCE.processSelection(browserHandle, selection)
  → Auto-generate context packet focused on the selected element

Event: BrowserStarted
  → Record browser context ID
  → Transition VCE health to 'healthy' if previously 'unavailable'

Event: PageLoaded
  → Update internal state with current URL
  → No automatic packet generation (packets are generated on capture or selection)

Event: NavigationCompleted
  → Update internal state with navigation target URL

Event: ViewportChanged
  → Update internal state with current viewport dimensions

Event: DiagnosticsUpdated
  → Update internal diagnostic cache
  → Attach to future packets during Collection stage

Event: BrowserDisconnected
  → Invalidate current BrowserHandle
  → Transition VCE health to 'degraded'
  → Abort in-progress packet generation
  → Log diagnostic event
```

### VCE → Event Bus (Publication Flow)

```
VCE.generatePacket() completes successfully
  │
  ▼
──publish──→ EventBus.publish(ContextPacketGenerated { packetId, captureId, processingTimeMs, evidenceSources, timestamp })
  │
  │  (Event Bus delivers to subscribers: MCP Server, Studio, Diagnostics, Logging)

VCE.generatePacket() fails at Assembly stage
  │
  ▼
──publish──→ EventBus.publish(ProcessingFailed { packetId, captureId, stage, error, timestamp })
  │
  │  (Event Bus delivers to subscribers: Diagnostics, Logging, Studio)
```

### Subscriber Isolation

```
Publisher (Browser Runtime) ──publish──→ Event Bus
                                            │
                                            ├──deliver──→ VCE subscriber (processCapture/processSelection)
                                            ├──deliver──→ Diagnostics subscriber
                                            └──deliver──→ Studio subscriber

VCE subscriber fails ── does NOT affect delivery to Diagnostics or Studio
Other subscriber fails ── does NOT affect delivery to VCE
```

---

## Error Behaviour

### Pipeline Errors

| Condition | Error Code | Category | Severity | Message | Recovery |
|-----------|-----------|----------|----------|---------|----------|
| Browser Runtime API call fails (DOM snapshot, styles, screenshot, diagnostics) | `VCE_COLLECTION_FAILED` | Runtime | Recoverable | "Failed to collect evidence from Browser Runtime: {reason}" | Retry the failed BR API call once. If persistent, terminate pipeline; `ProcessingFailed` event published. |
| Evidence fails schema validation (null required field, wrong type, invalid UUID) | `VCE_VALIDATION_ERROR` | Validation | Warning | "Evidence validation failed: {field} — {reason}" | Reject that individual evidence source; continue pipeline with remaining evidence. If all required evidence rejected, terminate with `VCE_COLLECTION_FAILED`. |
| Structural analysis fails (hierarchy build, container chain, landmark detection) | `VCE_STRUCTURAL_ANALYSIS_FAILED` | Runtime | Warning | "Structural analysis failed for element '{selector}': {reason}" | Omit structural analysis from packet; continue pipeline with other analysis outputs. |
| Visual analysis fails (layout extraction, alignment, spacing, overflow, visibility) | `VCE_VISUAL_ANALYSIS_FAILED` | Runtime | Warning | "Visual analysis failed for element '{selector}': {reason}" | Omit visual analysis from packet; continue pipeline. |
| Semantic analysis fails (role detection, category classification, ARIA extraction) | `VCE_SEMANTIC_ANALYSIS_FAILED` | Runtime | Warning | "Semantic analysis failed for element '{selector}': {reason}" | Omit semantic labels from packet; default `semanticCategory` to `'unknown'` with confidence 0.0. |
| Confidence evaluation fails | `VCE_CONFIDENCE_EVALUATION_FAILED` | Internal | Warning | "Confidence evaluation failed: {reason}" | Default all confidence scores to 0.5; continue pipeline. |
| Packet assembly fails (assemblePacket rejects, validation fails, serialisation fails) | `VCE_ASSEMBLY_FAILED` | Runtime | Recoverable | "Failed to assemble context packet: {reason}" | **Terminal for this pipeline run.** No partial packet emitted. `ProcessingFailed` event published. Caller may retry with fresh handle. |
| Browser Handle is invalid, null, or refers to a disconnected browser | `VCE_MISSING_BROWSER_EVIDENCE` | Runtime | Critical | "Browser handle is invalid or browser is disconnected" | Return error immediately; no pipeline stages executed. Caller must obtain a valid handle from Browser Runtime. |
| Selection selector does not resolve to a valid DOM element | `VCE_INVALID_SELECTION` | Validation | Warning | "Selection selector '{selector}' does not resolve to a valid DOM element" | Return error; no pipeline executed. Caller must verify the element exists before calling `processSelection`. |
| Capture ID does not reference a valid, completed capture | `VCE_CAPTURE_NOT_FOUND` | Validation | Warning | "Capture '{captureId}' not found or not completed" | Return error; no pipeline executed. Caller must verify the capture ID. |
| Project Scanner unavailable (P0 expected behaviour) | None | Info | Info | N/A (not an error) | Graceful degradation: `projectMetadata` set to `null`; `frameworkDetection` confidence set to 0.0. |
| Capture Pipeline unavailable (P0 expected behaviour) | None | Info | Info | N/A (not an error) | Graceful degradation: packet persisted internally to `.viskod/context/{packetId}.json`. |

### Error Propagation Rules

1. **Stage isolation:** Non-Assembly stage failure preserves outputs from all previous successful stages. Failed stage output is omitted from the packet.
2. **Partial packets preferred:** The VCE produces a partial Context Packet whenever possible. Only Assembly stage failure prevents packet production entirely.
3. **All errors logged:** Every error is logged with correlation ID, stage, and context. Errors are published as `DiagnosticEvent` via the Event Bus.
4. **VCE never swallows errors:** All errors are either propagated to the caller (`Result.err`) or published as events (`ProcessingFailed`). No silent error suppression.
5. **Browser errors isolated:** Browser Runtime failures do not affect VCE's ability to process previously collected evidence. A BR crash during collection terminates the current pipeline but does not affect VCE's health state beyond incrementing `failedCount`.

---

## Security Requirements

### Trust Boundaries

* The browser is untrusted — all DOM snapshots, computed styles, and screenshots originate from the inspected application and are treated as hostile input
* The inspected application is untrusted — it may inject arbitrary HTML, attributes, JavaScript, and CSS
* Repository contents are sensitive — VCE must not expose absolute file system paths, source code content, or environment variables in any output
* The Event Bus is an integration boundary — events delivered to VCE are validated by the Event Bus before delivery; VCE validates payloads before processing

### Input Validation

* All DOM attributes are scanned before inclusion in Context Packet — see §Redaction Rules
* All `selector` strings are validated before passing to Browser Runtime (no script injection)
* All external inputs (event payloads, BR API responses, Project Scanner output) are validated against Zod schemas at each pipeline stage boundary
* Browser Handle validity is checked before every BR API call — stale handles are rejected with `VCE_MISSING_BROWSER_EVIDENCE`

### DOM Attribute Redaction

All DOM attributes are scanned before inclusion in the Context Packet. The following patterns are redacted (replaced with `"[REDACTED]"`):

| Pattern | Examples | Redaction Rule |
|---------|----------|---------------|
| Password-related | `password`, `passwd`, `pwd`, `secret` | Attribute name matches case-insensitive pattern → value replaced |
| Token-related | `token`, `accessToken`, `authToken`, `apiKey`, `api-key`, `csrf` | Attribute name matches case-insensitive pattern → value replaced |
| Cookie-related | `cookie`, `set-cookie`, `session` | Attribute name matches case-insensitive pattern → value replaced |
| Authentication | `auth`, `authenticate`, `authorization`, `jwt` | Attribute name matches case-insensitive pattern → value replaced |
| Hidden secrets | `data-secret`, `data-key`, `data-token`, `data-password` | Attribute name matches case-insensitive pattern → value replaced |

Redactions are recorded in `PacketMetadata.redactions` with the format: `"DOM attribute '<attribute-name>': matched redaction pattern '<pattern>'"`.

### Prohibited Content in Output

* No absolute file system paths in any Context Packet output — all paths relative to `.viskod/` root
* No `.env` file contents, environment variable values, or process environment data
* No cookies, localStorage, or sessionStorage contents
* No authentication tokens, session identifiers, or credentials
* No network request or response bodies
* No form input values (password fields, text inputs, etc.)
* No application source code content (only file paths are referenced via source hints)
* No user personal information from the operating system

### File System Access

* VCE writes only to `.viskod/context/` for packet persistence (P0)
* VCE never reads repository files directly (project metadata comes from Project Scanner)
* VCE never writes outside the `.viskod/` storage directory
* All file paths in output are relative to `.viskod/` root

---

## Privacy Requirements

### Data Collected and Purpose

| Data | Purpose | Retention |
|------|---------|-----------|
| DOM structural snapshots | Structural context for AI coding agents | Transient during pipeline; persisted only within Context Packet |
| Computed CSS property values | Styling context for AI coding agents | Transient during pipeline; persisted only within Context Packet |
| Screenshot image data | Visual context for AI coding agents | Referenced by relative path; image files managed by Capture Pipeline or `.viskod/captures/` |
| Browser URL | Page context for AI coding agents | Hostname + path only in diagnostics; full URL in browser context |
| Viewport dimensions | Layout context for AI coding agents | Transient during pipeline; persisted in Context Packet |
| ARIA attributes and roles | Accessibility context for AI coding agents | Transient during pipeline; persisted in Context Packet |
| Diagnostic console messages | Application health context | Transient; forwarded as events only |
| Selection element text | Text content context for AI coding agents | Truncated at 500 characters; persisted in Context Packet |

### Data NOT Collected

* Cookies, localStorage, or sessionStorage contents
* `.env` file contents or environment variable values
* Authentication tokens, session identifiers, or credentials
* Network request or response bodies
* Form input values, including password fields
* User interaction patterns or behaviour analytics
* Application state (Redux, Vuex, Pinia, etc.)
* Full URL query parameters in diagnostics (only hostname + path)
* Developer personal information from the operating system
* Machine hostnames, IP addresses, or network configuration

### Retention

* Context Packets are retained in `.viskod/context/` until explicitly deleted by the developer
* No automatic expiration is enforced by VCE (retention policy belongs to SPEC-010 Capture Pipeline)
* Deleting the `.viskod/` directory removes all packets and associated captures

### Deletion

* No deletion mechanism beyond removing the `.viskod/` directory — this is the developer's canonical deletion method
* No data persists outside `.viskod/`
* No cloud backup, external storage, or remote synchronisation

### Text Truncation

* `SelectionInfo.text` truncated at 500 characters
* `HierarchyNode.text` truncated at 500 characters
* Untruncated text length is never stored
* Truncation is applied during Stage 8 (Packet Assembly), not during Collection

### Privacy Invariants

* No PII in any pipeline stage output
* No telemetry collected in Phase 1
* No data transmitted to external services
* Screenshot paths are relative (never absolute)
* Correlation IDs are UUID v4 — they encode no identity information
* All processing is local; no network access occurs during pipeline execution

---

## Performance Budget

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Stage 1 — Collection (all BR API calls in parallel) | < 100 ms p95 | `performance.now()` from first BR API call start to last BR API call completion; measured across 100 packet generations on localhost |
| Stage 2 — Validation (all evidence sources) | < 20 ms p95 | `performance.now()` wrap around validation function; measured across 100 iterations |
| Stage 3 — Normalisation (all evidence sources) | < 20 ms p95 | `performance.now()` wrap around normalisation function; measured across 100 iterations |
| Stage 4 — Structural Analysis | < 50 ms p95 | `performance.now()` wrap around structural analysis function; measured across 100 iterations on 100-element DOM trees |
| Stage 5 — Visual Analysis | < 50 ms p95 | `performance.now()` wrap around visual analysis function; measured across 100 iterations |
| Stage 6 — Semantic Analysis | < 30 ms p95 | `performance.now()` wrap around semantic analysis function; measured across 100 iterations |
| Stage 7 — Confidence Evaluation | < 10 ms p95 | `performance.now()` wrap around confidence evaluation function; measured across 100 iterations |
| Stage 8 — Packet Assembly | < 50 ms p95 | `performance.now()` from assembly start to validated, serialised packet; measured across 100 iterations |
| **Total packet generation (end-to-end)** | **< 500 ms p95** | `performance.now()` from `generatePacket()` call start to `ContextPacketGenerated` event published; measured across 100 generations on localhost with 100-element DOM |
| Packet size (serialised JSON) | < 5 MB | Serialised JSON byte length, excluding screenshots (referenced by path) |
| VCE health() response | < 1 ms | Synchronous read of counters; measured as instantaneous |

### Performance Invariants

1. Pipeline stages are sequential — no intra-pipeline parallelism beyond parallel BR API calls in Stage 1
2. Performance budgets are measured against a localhost target page with a ~100-element DOM tree
3. p95 means 95th percentile: 95 out of 100 runs must complete within the budget
4. Screenshot capture time (Stage 1 BR API call) is excluded from VCE's budget — it is bounded by SPEC-008 Browser Runtime budgets
5. Packet serialisation and persistence I/O are included in the Stage 8 budget

---

## Deterministic Guarantee

Given **identical** `BrowserHandle` state (same page, same DOM, same viewport, same computed styles) and **identical** `selection` (same selector, same bounding box):

1. `generatePacket()` MUST produce a **bit-identical** `ContextPacket` output
2. Identical JSON serialisation — same field order, same values, same whitespace
3. No randomness in any pipeline stage — no `Math.random()`, no `Date.now()` (except `timestamp` metadata fields), no `crypto.randomUUID()` variance (UUIDs are derived deterministically from inputs for testing)
4. No time-dependent behaviour except `timestamp`, `processingTimeMs`, and `PacketMetadata.engineVersion`
5. No non-deterministic ordering — arrays (parents, siblings, children, screenshots, diagnostics, sourceHints) are sorted deterministically
6. No external AI model invocation — all processing is algorithmic

**Non-deterministic fields (excluded from bit-identical comparison):**
- `ContextPacket.timestamp`
- `ContextPacket.packetId` (UUID v4; deterministic in test mode, random in production)
- `PacketMetadata.processingTimeMs`
- `PacketMetadata.engineVersion` (reflects VCE build version, consistent within a build)

All other fields must be bit-identical across identical invocations.

---

## Observability

### Log Levels

| Level | Usage |
|-------|-------|
| `ERROR` | Assembly stage failures, Collection failures (all BR APIs failed), invalid Browser Handle, Event Bus publish failures |
| `WARN` | Individual pipeline stage failures (non-Assembly), validation warnings, redactions applied, performance budget exceeded, degraded health |
| `INFO` | Packet generation started/completed, pipeline stage transitions, `ContextPacketGenerated` event published, health status changes |
| `DEBUG` | Per-stage timing breakdowns, evidence source counts, confidence score values, redaction details |

### Diagnostic Signals

| Signal | Type | Description |
|--------|------|-------------|
| `vce.packets.generated` | Counter | Monotonic count of successful packet generations |
| `vce.packets.failed` | Counter | Monotonic count of failed packet generations |
| `vce.pipeline.duration_ms` | Histogram | End-to-end pipeline duration per generation |
| `vce.pipeline.stage.duration_ms` | Histogram | Per-stage duration (collect, validate, normalise, structure, visual, semantic, confidence, assemble) |
| `vce.evidence.sources_available` | Gauge | Number of evidence sources available per generation |
| `vce.redactions.applied` | Counter | Total redactions applied across all generations |
| `vce.health.status` | Gauge | Current VCE health status (0=unavailable, 1=degraded, 2=healthy) |

### Health Check

`health()` returns synchronously with:
- `status`: derived from recent failure history and BR connection state
- `packetsGenerated`: since VCE initialisation
- `lastProcessingTimeMs`: most recent pipeline duration
- `averageProcessingTimeMs`: rolling average of last 10 pipeline durations
- `failedCount`: since VCE initialisation

### Never Log

* Context Packet contents (DOM attribute values, text content, screenshot paths beyond relative references)
* DOM attribute values (only attribute names are logged for redaction events)
* Source hint file contents or absolute paths
* User-visible text content
* Page URLs with query parameters or fragments
* Correlation IDs as plain text (hashed or truncated in logs)
* Any personally identifiable information

---

## Configuration

| Key | Type | Default | Description | Validation |
|-----|------|---------|-------------|-----------|
| `vce.pipeline.maxCollectionRetries` | `number` | `1` | Maximum retries for failed BR API calls in Stage 1 | `z.number().int().min(0).max(5)` |
| `vce.pipeline.timeout.collection` | `number` (ms) | `5000` | Maximum total time for Stage 1 Collection | `z.number().int().min(1000).max(30000)` |
| `vce.pipeline.timeout.total` | `number` (ms) | `10000` | Maximum total time for entire pipeline (safety cutoff) | `z.number().int().min(1000).max(60000)` |
| `vce.redaction.enabled` | `boolean` | `true` | Whether DOM attribute redaction is enabled | `z.boolean()` |
| `vce.redaction.patterns` | `string[]` | `["password", "token", "secret", "key", "auth", "cookie", "session", "jwt", "csrf"]` | Case-insensitive patterns to match in attribute names | `z.array(z.string().min(1))` |
| `vce.text.truncationLength` | `number` | `500` | Maximum characters for element text in output | `z.number().int().min(50).max(10000)` |
| `vce.hierarchy.maxParents` | `number` | `10` | Maximum ancestor nodes in hierarchy | `z.number().int().min(1).max(50)` |
| `vce.hierarchy.maxSiblings` | `number` | `20` | Maximum sibling nodes in hierarchy | `z.number().int().min(0).max(100)` |
| `vce.hierarchy.maxChildren` | `number` | `50` | Maximum child nodes in hierarchy | `z.number().int().min(0).max(200)` |
| `vce.health.rollingWindowSize` | `number` | `10` | Number of recent pipeline runs for average calculation | `z.number().int().min(1).max(100)` |
| `vce.persistence.format` | `'json'` | `'json'` | Serialisation format for packet persistence | `z.enum(['json'])` |
| `vce.persistence.directory` | `string` | `".viskod/context"` | Directory for packet persistence (relative to project root) | `z.string().min(1)` |

No environment variable mappings are defined. Configuration is provided programmatically via `VCECreationOptions` or a configuration object conforming to SPEC-004.

---

## Failure and Recovery

### Pipeline Stage Failure

| Failure | Behaviour | Recovery |
|---------|-----------|----------|
| Stage 1 — Collection (individual BR API call fails) | Retry the failed call once. If still fails, omit that evidence source from the pipeline. | If all required evidence sources (DOM, styles) fail, terminate with `VCE_COLLECTION_FAILED`. Otherwise continue with partial evidence. |
| Stage 1 — Collection (all BR API calls fail) | Terminate pipeline with `VCE_COLLECTION_FAILED`. | `ProcessingFailed` event published. Caller may retry with fresh handle. |
| Stage 2 — Validation (individual evidence source rejected) | Reject that source; record validation error. | Continue with remaining valid evidence sources. If all required evidence rejected, escalate to `VCE_COLLECTION_FAILED`. |
| Stage 3 — Normalisation | Cannot fail — pure data transformation. | N/A |
| Stage 4 — Structural Analysis | Omit `StructureAnalysis` from packet. | Continue pipeline. Structural context will be absent from packet. |
| Stage 5 — Visual Analysis | Omit `VisualAnalysis` from packet. | Continue pipeline. Visual analysis will be absent from packet. |
| Stage 6 — Semantic Analysis | Omit `SemanticLabels` from packet; default `semanticCategory` to `'unknown'`. | Continue pipeline. Semantic labels will be minimal. |
| Stage 7 — Confidence Evaluation | Default all confidence scores to `0.5`. | Continue pipeline. All confidence values will be `0.5`. |
| Stage 8 — Packet Assembly | **Terminal.** No packet produced. | `ProcessingFailed` event published. Caller may retry `generatePacket()` with fresh inputs. |

### VCE-Level Failures

| Failure | Recovery |
|---------|----------|
| Event Bus unavailable for subscription | VCE enters `degraded` health. Automatic packet generation via events (processCapture, processSelection) stops. Direct `generatePacket()` calls still work. |
| Event Bus unavailable for publication | `ContextPacketGenerated` and `ProcessingFailed` events are silently dropped. Packets are still generated and persisted. Health is `degraded`. |
| Browser Runtime handle invalidated during pipeline | Abort pipeline; return `VCE_MISSING_BROWSER_EVIDENCE`. Incomplete pipeline context is discarded. |
| Persistence write fails (disk full, permissions) | Packet assembly still succeeds. Error logged; packet returned in-memory but not persisted. `ProcessingFailed` is NOT published (packet was assembled successfully). |
| Configuration invalid | VCE fails to initialise. `VCECreationOptions` validated at construction time. Invalid config prevents VCE creation. |

### Downstream Consumer Guidance

* If MCP Server receives `VCE_ASSEMBLY_FAILED`, it should report the error to the AI agent and suggest retrying the capture
* If Studio receives `ProcessingFailed`, it should display a diagnostic notification to the developer
* If Event Bus receives `ContextPacketGenerated`, it should deliver to all subscribers (MCP, Studio, Diagnostics)
* Callers should always check `Result.ok` before accessing `Result.value`

---

## Compatibility

### Breaking-Change Policy

A change to the VCE is considered breaking if it:

1. Changes the signature of `generatePacket()`, `processCapture()`, `processSelection()`, `health()`, or `getLastPacket()`
2. Removes or renames a public method on the VCE interface
3. Changes the `VCECreationOptions` interface such that existing callers cannot construct VCE instances
4. Modifies the Context Packet schema in a way that violates SPEC-006
5. Changes the event payloads for `ContextPacketGenerated` or `ProcessingFailed`
6. Removes or renames an error code (`VCE_COLLECTION_FAILED`, `VCE_VALIDATION_ERROR`, etc.)
7. Changes the pipeline stage order or removes a stage
8. Changes the deterministic guarantee contract (e.g., introduces randomness)
9. Changes the performance budget for total packet generation from 500ms to a higher value (lowering is non-breaking)
10. Changes the required dependencies (e.g., making Capture Pipeline required instead of optional)

### Non-Breaking Changes

1. Adding a new optional method to the VCE interface
2. Adding a new configuration key with a sensible default
3. Adding a new error code while preserving existing ones
4. Extending `VCEHealth` or `SelectionTarget` with optional fields
5. Adding a new pipeline stage after Stage 7 (before Assembly) — renumbering is breaking, insertion is non-breaking
6. Adding new event subscriptions (new event types VCE listens to)
7. Tightening redaction rules (more patterns) — improves security, non-breaking
8. Improving performance (reducing processing time) — non-breaking
9. Adding optional evidence sources (e.g., accessibility tree when available)

### Migration Strategy

Every breaking change requires:

1. A version increment of the VCE specification
2. A migration guide documenting the change, rationale, and upgrade steps
3. A deprecation window of at least one minor version where both old and new interfaces are supported
4. Decision record in `/decisions/` documenting the rationale
5. Notification to all consumer specification owners (SPEC-014, Studio, SDK, Public API)

### Deprecation Window

* Non-breaking additions: no deprecation window required, available immediately
* Breaking changes: minimum one minor version deprecation window before removal
* Emergency security fixes: may bypass the deprecation window with documented justification
* Pipeline stage changes: require a RFC before modification

---

## Testing Requirements

### Unit Tests

| # | Test | Scope | Expected Result |
|---|------|-------|----------------|
| 1 | Stage 1 — Collection: all BR API calls succeed with valid mock data | Happy path | `RawEvidence` populated with all evidence sources |
| 2 | Stage 1 — Collection: one BR API call fails, others succeed | Partial failure | `RawEvidence` populated with successful sources; failed source is null |
| 3 | Stage 1 — Collection: all required BR API calls fail | Total failure | `VCE_COLLECTION_FAILED` returned; no pipeline continuation |
| 4 | Stage 2 — Validation: valid evidence passes all schema checks | Happy path | `ValidatedEvidence` produced with zero `validationErrors` |
| 5 | Stage 2 — Validation: null DOM snapshot rejected | Invalid input | `validationErrors` contains entry for DOM; pipeline continues without DOM |
| 6 | Stage 2 — Validation: non-UUID captureId rejected | Invalid input | `validationErrors` contains entry for captureId |
| 7 | Stage 2 — Validation: zero viewport dimensions rejected | Invalid input | `validationErrors` contains entry for viewport |
| 8 | Stage 3 — Normalisation: RGB colours converted to hex | Normalisation | `rgb(255, 0, 0)` → `"#ff0000"` |
| 9 | Stage 3 — Normalisation: URLs lowercased and trailing slashes stripped | Normalisation | `https://Example.com/path/` → `https://example.com/path` |
| 10 | Stage 3 — Normalisation: boolean attributes converted | Normalisation | `checked` → `checked="true"`; absent attribute not added |
| 11 | Stage 4 — Structural Analysis: hierarchy built correctly | Happy path | Parents, siblings, children correctly identified; depth correct |
| 12 | Stage 4 — Structural Analysis: container chain identified | Happy path | div → section → main chain detected |
| 13 | Stage 4 — Structural Analysis: ARIA landmarks detected | Happy path | `role="navigation"` → `landmarks: ["navigation"]` |
| 14 | Stage 4 — Structural Analysis: hierarchy node limits enforced | Limits | Parents capped at 10, siblings at 20, children at 50 |
| 15 | Stage 4 — Structural Analysis: navigation hierarchy detected | Happy path | `NavInfo` populated when element is within `<nav>` |
| 16 | Stage 5 — Visual Analysis: layout info extracted | Happy path | `display`, `position`, `flexDirection`, dimensions, margin, padding correct |
| 17 | Stage 5 — Visual Analysis: alignment computed | Happy path | `horizontal`, `vertical`, `withParent`, `withSiblings` correct |
| 18 | Stage 5 — Visual Analysis: overflow detected | Happy path | `hasHorizontalOverflow`, `hasVerticalOverflow` correct when content overflows |
| 19 | Stage 5 — Visual Analysis: visibility checked | Happy path | `isVisible: false` when `display: none`; `opacity: 0.5` when set |
| 20 | Stage 5 — Visual Analysis: stacking context analysed | Happy path | `createsStackingContext: true` when z-index + position set |
| 21 | Stage 6 — Semantic Analysis: primary role determined | Happy path | ARIA role present → used; HTML element → implied role |
| 22 | Stage 6 — Semantic Analysis: semantic category classified | Happy path | `<nav>` → `'navigation'`; `<form>` → `'form'`; `<dialog>` → `'dialog'` |
| 23 | Stage 6 — Semantic Analysis: accessible name extracted | Happy path | `aria-label` value; `aria-labelledby` → referenced element text |
| 24 | Stage 6 — Semantic Analysis: interactive state detected | Happy path | `isFocusable`, `isDisabled`, `isRequired`, `isInteractive` correct |
| 25 | Stage 6 — Semantic Analysis: form association detected | Happy path | `FormInfo` populated when element is within `<form>` |
| 26 | Stage 7 — Confidence Evaluation: observed evidence → 1.0 | Scoring | `boundingBox`, `viewport`, `url` → `1.0` for related categories |
| 27 | Stage 7 — Confidence Evaluation: derived evidence → 0.60–0.99 | Scoring | `layoutAnalysis`, `structuralAnalysis` → within derived range |
| 28 | Stage 7 — Confidence Evaluation: inferred evidence → 0.01–0.99 | Scoring | `semanticLabeling`, `sourceMapping` → within inferred range |
| 29 | Stage 7 — Confidence Evaluation: no project scanner → frameworkDetection 0.0 | Scoring | `frameworkDetection: 0.0` when project metadata is null |
| 30 | Stage 8 — Packet Assembly: valid evidence → valid ContextPacket | Happy path | ContextPacket passes SPEC-006 validation |
| 31 | Deterministic guarantee: same input twice → identical output | Determinism | Two calls with identical mock inputs produce bit-identical packets |
| 32 | Deterministic guarantee: different timestamps ≠ identical | Determinism | Timestamp fields differ; all other fields identical |
| 33 | Redaction: password attributes replaced | Security | `data-password="secret123"` → `"[REDACTED]"` |
| 34 | Redaction: token attributes replaced | Security | `data-token="abc.def.ghi"` → `"[REDACTED]"` |
| 35 | Redaction: non-sensitive attributes preserved | Security | `data-testid="submit-btn"` → `"submit-btn"` (unchanged) |
| 36 | Redaction: redactions recorded in metadata | Security | `PacketMetadata.redactions` contains entry for each redacted attribute |
| 37 | Text truncation: text > 500 chars truncated | Privacy | Text content of 600 chars → 500 chars in output |
| 38 | Text truncation: text ≤ 500 chars unchanged | Privacy | Text content of 300 chars → 300 chars (unchanged) |
| 39 | Health: counters increment correctly | Health | `packetsGenerated` increments after successful generation; `failedCount` increments after failure |
| 40 | Health: status reflects recent failures | Health | `status: 'degraded'` after one failure in last 10 runs |
| 41 | Graceful degradation: Capture Pipeline absent | P0 fallback | Packet persisted to `.viskod/context/{packetId}.json` |
| 42 | Graceful degradation: Project Scanner absent | P0 fallback | `projectMetadata: null`; `frameworkDetection` confidence: 0.0 |

### Integration Tests

| # | Test | Scope | Expected Result |
|---|------|-------|----------------|
| 43 | VCE + Browser Runtime (mock) → valid ContextPacket | Integration | `generatePacket()` with mock BR returns valid ContextPacket conforming to SPEC-006 |
| 44 | VCE + Event Bus → subscribes to CaptureCompleted | Integration | `CaptureCompleted` event delivered through Event Bus triggers `processCapture()` |
| 45 | VCE + Event Bus → subscribes to SelectionChanged | Integration | `SelectionChanged` event delivered through Event Bus triggers `processSelection()` |
| 46 | VCE + Event Bus → publishes ContextPacketGenerated | Integration | Successful packet generation publishes `ContextPacketGenerated` event |
| 47 | VCE + Event Bus → publishes ProcessingFailed on Assembly failure | Integration | Assembly failure publishes `ProcessingFailed` event with correct stage and error |
| 48 | VCE → calls BR public API (no internal module imports) | Integration | VCE import graph verified: no imports from `@viskod/browser-runtime/src/**` beyond public interface |
| 49 | VCE → never imports Playwright | Integration | VCE import graph verified: no `playwright` or `chromium` imports |
| 50 | VCE → BrowserDisconnected handling | Integration | `BrowserDisconnected` event invalidates handle; in-progress pipeline aborted |
| 51 | VCE → graceful degradation with missing optional deps | Integration | VCE functions correctly when Capture Pipeline and Project Scanner are absent |

### Contract Tests

| # | Test | Scope | Expected Result |
|---|------|-------|----------------|
| 52 | Output matches SPEC-006 ContextPacket schema | Contract | Every `generatePacket()` output validates against `ContextPacketSchema` |
| 53 | Error codes match SPEC-003 error model | Contract | All VCE error codes conform to `VCE-xxxx` pattern with correct categories and severities |
| 54 | Event payloads match SPEC-005 event schema | Contract | `ContextPacketGenerated` and `ProcessingFailed` payloads validate against canonical event schemas |
| 55 | Configuration keys match §Configuration table | Contract | Every config key has a corresponding entry in the table with correct type and default |
| 56 | Public API matches `docs/visual-context-engine.md` | Contract | `generatePacket`, `processCapture`, `processSelection`, `health`, `getLastPacket` signatures match architecture document |
| 57 | Dependency direction verified: VCE never called by Browser Runtime | Contract | Static analysis confirms BR never imports VCE modules; BR never calls VCE methods |

### End-to-End Acceptance Criteria

| # | Test | Scope | Expected Result |
|---|------|-------|----------------|
| 58 | Full flow: launch browser → navigate to page → select element → generatePacket → valid ContextPacket | E2E | Packet validates against SPEC-006; all 8 stages executed in order |
| 59 | Full flow: CaptureCompleted event → processCapture → valid ContextPacket | E2E | Automatic packet generation after capture; packet links to correct captureId |
| 60 | Full flow: SelectionChanged event → processSelection → valid ContextPacket | E2E | Automatic packet generation after selection; packet focuses on selected element |
| 61 | Full flow: BrowserDisconnected → handle invalidated → generatePacket returns error | E2E | `VCE_MISSING_BROWSER_EVIDENCE` returned when handle is stale |
| 62 | Full flow: Deterministism verified — same page/selection twice → identical packets | E2E | Two packets generated from identical state are structurally identical (excluding timestamp) |
| 63 | Full flow: Redaction verified — page with data-token attribute → redacted in packet | E2E | `data-token` attribute value replaced with `"[REDACTED]"` in output |
| 64 | Full flow: Text truncation verified — element with 1000 chars text → truncated at 500 | E2E | Text content in packet is exactly 500 characters |

---

## Acceptance Criteria

Before this specification can move to Approved:

- [ ] `generatePacket()` produces valid ContextPacket conforming to SPEC-006 canonical schema
- [ ] 8-stage pipeline executes in order: Collection → Validation → Normalisation → Structural Analysis → Visual Analysis → Semantic Analysis → Confidence Evaluation → Packet Assembly
- [ ] Stage isolation: non-Assembly stage failure preserves previous stage outputs and continues pipeline
- [ ] Assembly stage failure prevents packet production entirely (no partial packet from Assembly)
- [ ] Partial Context Packets produced when non-Assembly stages fail (preferred over complete failure)
- [ ] Confidence scores decrease as interpretation increases: observed (0.95–1.0) > derived (0.60–0.99) > inferred (0.01–0.99)
- [ ] Deterministic guarantee verified: identical inputs produce bit-identical outputs (excluding timestamp metadata)
- [ ] VCE calls Browser Runtime public API only — never imports BR internal modules (`@viskod/browser-runtime/src/**`)
- [ ] VCE subscribes to Browser Runtime events through Event Bus exclusively — never receives browser events through direct callbacks
- [ ] VCE never imports Playwright, Chromium API, or any browser-process module (verifiable by build tool / dependency cruiser)
- [ ] Sensitive DOM attributes redacted: passwords, tokens, cookies, secrets, authentication attributes replaced with `"[REDACTED]"`
- [ ] Redactions recorded in `PacketMetadata.redactions` with attribute name and matched pattern
- [ ] Selection text truncated at 500 characters
- [ ] Packet generation under 500 ms p95 (measured against localhost with 100-element DOM)
- [ ] Optional dependencies degrade gracefully: Capture Pipeline absent → internal persistence; Project Scanner absent → nullable metadata
- [ ] `health()` returns correct status based on actual failure history and BR connection state
- [ ] `getLastPacket()` returns most recent packet or null
- [ ] `processCapture()` auto-generates packet on CaptureCompleted event
- [ ] `processSelection()` auto-generates packet on SelectionChanged event
- [ ] `ContextPacketGenerated` event published after successful packet generation and persistence
- [ ] `ProcessingFailed` event published on Assembly failure or fatal Collection failure
- [ ] BrowserDisconnected event invalidates handle and aborts in-progress pipeline
- [ ] All errors use VCE-2xxx error codes conforming to SPEC-003
- [ ] No absolute file system paths in any output
- [ ] No secrets, tokens, cookies, or environment variables in any pipeline output or log
- [ ] No PII in any analysis output
- [ ] All 64 unit, integration, contract, and E2E tests pass
- [ ] Performance budgets recorded with benchmarks and verified within limits
- [ ] Architecture sources cross-referenced to exact document sections
- [ ] No prohibited language (no "fast", "scalable", "secure" without numeric or verifiable definitions)

---

## Open Implementation Decisions

| Decision ID | Description | Resolution |
|-------------|-------------|-----------|
| DEC-006 | Local persistence format for P0 packets (JSON vs binary) | Determine whether Context Packets are persisted as plain JSON or a binary format. JSON is the default (human-readable, debuggable). Decision record in `/decisions/DEC-006.md`. |
| DEC-007 | Deterministic UUID generation strategy for testing | Determine whether tests use a seeded PRNG for UUID generation or a mock UUID provider. Production uses `crypto.randomUUID()`. Decision record in `/decisions/DEC-007.md`. |
| — | DOM serialisation depth limit during Collection | Determined by Browser Runtime (SPEC-008). VCE consumes whatever depth BR provides. |
| — | Normalisation colour profile (sRGB vs Display P3) | Computed styles from Playwright are in sRGB. No colour profile conversion needed in Phase 1. |
| — | Semantic category detection heuristics | Implementation will use a combination of ARIA roles, HTML5 semantic elements, and CSS class name heuristics. Exact heuristics deferred to implementation. |
| — | Parallelism within pipeline stages | Phase 1: Stage 1 Collection uses parallel BR API calls. All other stages are sequential. Intra-stage parallelism is a Phase 2 optimisation. |
| — | Event debouncing for rapid SelectionChanged events | If a user rapidly selects elements (e.g., scrubbing), each SelectionChanged event triggers `processSelection`. Debouncing or cancellation of in-progress pipelines is a Phase 2 concern. |

---

## Migration Considerations

This is the initial specification for the Visual Context Engine. No migration from a prior version is required.

Future migration paths:

* **P0 → P1:** When Capture Pipeline (SPEC-010) is implemented, VCE delegates `persist()` calls. The P0 fallback (internal `.viskod/context/` persistence) is removed. Existing packets remain at `.viskod/context/`.
* **P0 → P1:** When Project Scanner (SPEC-012) is implemented, `projectMetadata` transitions from nullable to populated. Consumer code that checks for null remains valid.
* **P0 → P1:** When Source Hint Engine (SPEC-011) is implemented, `sourceHints` transitions from empty array to populated. Consumer code handles empty arrays gracefully by design.
* **Schema v1 → v2 (Context Packet):** Additive changes only; VCE produces v1 packets until SPEC-006 v2 is approved. Backward compatibility maintained.
* **Pipeline stage reordering:** Requires a RFC — the pipeline order is contractual. Consumers (documentation, debugging, monitoring) depend on stage numbering.

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| BR API call latency causes Collection stage to exceed 100ms budget | Medium | Medium | Parallel BR API calls minimise serial latency; configurable timeout; budget adjusted if real-world measurements consistently exceed target |
| DOM snapshot size (deeply nested trees) causes structural analysis to exceed 50ms budget | Medium | Low | Hierarchy node limits (parents: 10, siblings: 20, children: 50); DOM serialisation depth controlled by BR |
| Semantic category classification accuracy is poor on non-standard UI patterns | High | Low | Confidence scores communicate uncertainty; AI agents should treat low-confidence semantic labels as suggestions; heuristics improve over time |
| Redaction rules miss novel sensitive attribute patterns | Medium | Medium | Redaction patterns are configurable (`vce.redaction.patterns`); `PacketMetadata.redactions` provides audit trail; security review before each release |
| Determinism breaks due to browser rendering differences (sub-pixel layout, font rendering) | Low | High | Determinism verified against the same browser instance; cross-browser determinism is explicitly NOT guaranteed — the guarantee is same BrowserHandle state |
| Pipeline stage failure isolation is incomplete — one stage's failure corrupts downstream stages | Low | High | Each stage validates its inputs independently; downstream stages check for null/absent upstream outputs; contract tests verify stage isolation |
| Event Bus delivery failure causes missed CaptureCompleted/SelectionChanged events | Low | Medium | VCE falls back to `degraded` health; direct `generatePacket()` calls still work; Event Bus reliability is guaranteed by SPEC-007 |
| Performance budget (500ms p95) cannot be met on low-resource machines | Medium | Medium | Budget is a p95 target, not a hard block; slow machines may exceed budget; real-world telemetry (Phase 2) will inform budget adjustments |
| Configuration surface grows too large as pipeline stages gain options | Medium | Low | Sensible defaults for all config keys; config validation at construction time; configuration spec (SPEC-004) constrains growth |

---

## Implementation Sequence

1. Define `VisualContextEngine` TypeScript interface (`packages/context-engine/src/visual-context-engine.ts`)
2. Define `VCECreationOptions` interface and construction validation
3. Implement Pipeline Context (`PipelineContext`, `PipelineStage`, `StageError`) — `packages/context-engine/src/pipeline/context.ts`
4. Implement Stage 1 — Collection (`packages/context-engine/src/pipeline/collection.ts`)
   - Parallel BR API calls: DOM snapshot, styles, screenshot, diagnostics, viewport
   - RawEvidence construction
   - Retry logic for failed BR calls
5. Implement Stage 2 — Validation (`packages/context-engine/src/pipeline/validation.ts`)
   - Schema validation for each evidence source
   - Partial rejection with accumulated `validationErrors`
6. Implement Stage 3 — Normalisation (`packages/context-engine/src/pipeline/normalisation.ts`)
   - Colour normalisation (rgb → hex)
   - URL normalisation
   - Boolean attribute normalisation
7. Implement Stage 4 — Structural Analysis (`packages/context-engine/src/pipeline/structure.ts`)
   - Hierarchy builder (parents, siblings, children, depth)
   - Container chain detection
   - Landmark detection
   - Navigation hierarchy detection
8. Implement Stage 5 — Visual Analysis (`packages/context-engine/src/pipeline/visual.ts`)
   - Layout extraction
   - Alignment computation
   - Spacing analysis
   - Overflow detection
   - Visibility check
   - Stacking context analysis
9. Implement Stage 6 — Semantic Analysis (`packages/context-engine/src/pipeline/semantic.ts`)
   - ARIA role determination
   - Semantic category classification
   - ARIA attribute collection
   - Accessible name/description extraction
   - Interactive state detection
   - Form association detection
10. Implement Stage 7 — Confidence Evaluation (`packages/context-engine/src/pipeline/confidence.ts`)
    - Evidence classification (observed/derived/inferred)
    - Per-category confidence scoring
    - Default fallback for computation failures
11. Implement Stage 8 — Packet Assembly (`packages/context-engine/src/pipeline/assembly.ts`)
    - Interface with SPEC-006 `assemblePacket()`
    - Redaction engine (`packages/context-engine/src/pipeline/redaction.ts`)
    - Text truncation
    - Packet validation
    - P0 persistence (`.viskod/context/{packetId}.json`)
12. Implement VCE → BR command flow (public API calls, handle validation) — `packages/context-engine/src/bridge/browser-runtime-bridge.ts`
13. Implement VCE → Event Bus subscription (subscribe to BR events, publish VCE events) — `packages/context-engine/src/bridge/event-bus-bridge.ts`
14. Implement `health()` and `getLastPacket()` — `packages/context-engine/src/health.ts`
15. Implement graceful degradation for optional P1 dependencies — `packages/context-engine/src/bridge/optional-deps.ts`
16. Implement error handling (all VCE-2xxx error codes, retry logic, stage isolation)
17. Write 42 unit tests (mocked BR, mock Event Bus, mock evidence)
18. Write 9 integration tests (VCE + mock BR + mock Event Bus)
19. Write 6 contract tests (schema conformance, error model, event schema, config)
20. Write 7 E2E tests (real browser where applicable, deterministic verification)
21. Add `@viskod/context-engine` to pnpm workspace per SPEC-001
22. Configure build tool to enforce import restrictions (no Playwright, no BR internals)
23. Run lint (`biome check`), typecheck (`tsc --noEmit --strict`), and all tests
24. Record performance benchmarks and verify budgets
25. Update `docs/visual-context-engine.md` if implementation-driven corrections needed
26. Document DEC-006 (persistence format) and DEC-007 (testing UUID strategy) in `/decisions/`

---

## Definition of Done

- [ ] `VisualContextEngine` interface implemented with exact signatures from this specification
- [ ] 8-stage pipeline implemented: Collection, Validation, Normalisation, Structural Analysis, Visual Analysis, Semantic Analysis, Confidence Evaluation, Packet Assembly
- [ ] Stage isolation enforced: non-Assembly failures preserve previous stage outputs
- [ ] `generatePacket()` returns valid ContextPacket conforming to SPEC-006
- [ ] `processCapture()` auto-generates packet on CaptureCompleted event
- [ ] `processSelection()` auto-generates packet on SelectionChanged event
- [ ] VCE calls Browser Runtime public API only — import restrictions verified by build tool
- [ ] VCE subscribes to BR events through Event Bus exclusively — no direct BR→VCE callbacks
- [ ] VCE publishes `ContextPacketGenerated` and `ProcessingFailed` events to Event Bus
- [ ] Redaction engine covers all defined patterns; redactions recorded in metadata
- [ ] Text content truncated at 500 characters
- [ ] Determinism verified: identical inputs → identical outputs (excluding timestamp fields)
- [ ] Confidence scoring rules implemented: observed > derived > inferred
- [ ] P0 persistence writes to `.viskod/context/{packetId}.json`
- [ ] Graceful degradation: Capture Pipeline absent → internal persistence
- [ ] Graceful degradation: Project Scanner absent → nullable project metadata
- [ ] `health()` returns correct status and counters
- [ ] `getLastPacket()` returns most recent packet or null
- [ ] All VCE-2xxx error codes implemented with correct categories and severities
- [ ] 42 unit tests pass (all pipeline stages, error handling, determinism, redaction, truncation)
- [ ] 9 integration tests pass (VCE + BR + Event Bus integration)
- [ ] 6 contract tests pass (SPEC-006 schema, error model, event schema, config, architecture)
- [ ] 7 E2E tests pass (full flow with real or mock browser)
- [ ] Performance benchmarks recorded: total packet generation under 500 ms p95
- [ ] Build tool verifies no forbidden imports (`playwright`, `chromium`, `@viskod/browser-runtime/src/**`)
- [ ] Lint passes (`biome check`)
- [ ] TypeScript strict mode passes with zero errors
- [ ] Configuration validated at construction time
- [ ] No secrets, tokens, or PII in any log output or error message
- [ ] Documentation in `docs/visual-context-engine.md` reflects implementation
- [ ] DEC-006 documented in `/decisions/DEC-006.md`
- [ ] DEC-007 documented in `/decisions/DEC-007.md`
- [ ] Specification status updated from Draft to Approved
