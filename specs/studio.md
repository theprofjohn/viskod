# Studio

> **Specification ID:** SPEC-023
> **Version:** 1.0
> **Status:** Draft
> **Owner:** Viskod Engineering
> **Last Updated:** 2026-07-28

---

## Architecture Sources

```
* docs/studio.md — full Studio specification: purpose, design philosophy, responsibilities, core workspace, panels, performance targets, extensibility, failure policy, invariants
* docs/architecture.md §Studio — desktop interface responsibilities: must not implement browser automation, must not implement MCP, must not perform source mapping
* docs/architecture.md §State Store — Studio maintains presentation state only; business state belongs to runtime packages; avoid duplicating runtime information inside React state
* docs/architecture.md §State Synchronisation — Studio should never query the browser directly; Browser Runtime → Event Bus → State Store → Studio/Visual Context Engine; one direction, no circular communication
* docs/architecture.md §Startup Flow — CLI → Project Scanner → Browser Runtime → Visual Context Engine → Studio → MCP Server → Ready; every subsystem reports health before Viskod becomes available
* docs/ARCHITECTURE_BASELINE.md §Runtime Boundaries — Studio owns UI state, navigation, display, user interaction; forbidden access: browser process, business logic, source mapping
* docs/ARCHITECTURE_BASELINE.md §Startup Flow — canonical startup sequence with Studio starting after Visual Context Engine
* docs/ARCHITECTURE_BASELINE.md §Canonical Dependency Model — Studio sits at top of dependency chain; Studio → command → Visual Context Engine
* docs/state-management.md — state categories, state ownership (Studio consumes; never mutates state it does not own), state synchronisation between Browser Runtime, Capture Pipeline, Studio, MCP Server, Diagnostics
* docs/navigation.md — navigation architecture (Application → Workspace → Feature → Panel → Section → Content), global navigation destinations (Workspace, Captures, Projects, Diagnostics, Settings), workspace navigation (Browser Session, Context Explorer, Selection Inspector, Project Explorer, Diagnostics), keyboard navigation, accessibility
* docs/glossary.md §Studio — the primary graphical interface of the Viskod platform; coordinates workflows while remaining independent of core platform services
* docs/glossary.md §Context Explorer — a user interface for browsing Context Packets and related artefacts
* docs/glossary.md §Selection Inspector — referenced as part of workspace navigation model
```

---

## Dependencies

| Specification | Status | Relationship |
|--------------|--------|-------------|
| SPEC-002 (shared-types) | Draft | Consumes base types (BoundingBox, DeepReadonly, Result, JsonObject), StudioState schema elements, shared Zod schemas |
| SPEC-003 (error-model) | Draft | Error codes STU_STARTUP_FAILED, STU_SELECTION_FAILED, STU_CAPTURE_TIMEOUT, STU_DISPLAY_ERROR; error categories, recovery suggestion format |
| SPEC-006 (context-packet-schema) | Draft | Consumes ContextPacket type for display in Context Explorer panel; validates packet structure before rendering |
| SPEC-007 (event-bus) | Draft | Subscribes to Event Bus for all platform events; publishes UI-only panel navigation events |
| SPEC-009 (visual-context-engine) | Draft | Calls VCE public API (processSelection, getLastPacket, getState); receives ContextPacketGenerated events |
| SPEC-022 (overlay-system) | Draft | Displays overlay state (visible/hidden, mode, highlighted element) in Browser Session panel; subscribes to overlay state changes via Event Bus |

Note: SPEC-008 (browser-runtime) is **NOT** a dependency. Studio never accesses the browser or Browser Runtime directly.

---

## Consumers

| Specification | Status | Relationship |
|--------------|--------|-------------|
| Developer (human user) | N/A | Primary consumer; interacts with Studio to inspect visual context, manage browser sessions, explore captures |
| (none) | — | Studio is a terminal node in the dependency graph. No downstream specifications depend on Studio. |

---

## Purpose

Studio is the graphical interface for Viskod. It provides a visual workspace for inspecting browser state, exploring Context Packets, and interacting with the Visual Context Platform. Studio is the human-facing surface of the platform — the layer that lets a developer see what the browser is rendering and capture that visual understanding as structured context.

Studio is not an IDE. Studio is not a code editor. Studio is not a coding agent. It is an inspection and context exploration environment. Its sole responsibility is to present the state of a running application through a clear, structured, and trustworthy interface.

Every capability Studio provides is designed to be consumed through the Event Bus and State Store. Studio reflects business state; it never creates, mutates, or stores authoritative versions of business data.

---

## Scope

* Desktop application shell: window management, lifecycle (start, shutdown), workspace creation and disposal
* Five studio panels: Browser Session, Context Explorer, Selection Inspector, Capture History, Diagnostics
* Settings panel for user preferences
* Panel navigation via sidebar, keyboard shortcuts, and command palette
* Selection workflow: start selection mode, live hover preview, confirm selection, clear selection
* Capture workflow: request capture via VCE, display resulting Context Packet
* Workspace management: open project workspace, close workspace
* State synchronisation: subscribe to Event Bus for all platform events, reflect runtime state in UI
* Error display: structured error presentation with recovery suggestions
* Degraded mode: offline state when VCE or Event Bus is unreachable, reconnect option
* Keyboard accessibility: all panels navigable via keyboard, focus indicators, logical tab order
* Light and dark theme support
* Viewport preset selection (Desktop, Tablet, Mobile, Custom) via Browser Session panel

---

## Non-Goals

* Code editing, syntax highlighting, file tree — Studio is NOT an IDE and provides no code modification capabilities
* AI chat interface, prompt input, agent conversation — Studio is NOT a coding agent
* Plugin marketplace UI — Studio is NOT an extension host
* Design tools, color pickers, CSS editors — Studio is NOT a design tool
* Browser automation controls (navigate, refresh, type) beyond what VCE proxies — Studio does not control the browser
* MCP protocol implementation or MCP tool registration — Studio is not the MCP Server
* Source mapping implementation — Studio displays source hints from Context Packets but never computes them
* Multi-monitor / ultra-wide display support — deferred to Phase 2
* Custom themes beyond light/dark — deferred to Phase 2
* Collaborative workspaces — deferred to Phase 3
* Capture persistence configuration (retention policies, cleanup) — Capture Pipeline responsibility
* Project configuration editing (framework detection settings, scanner options) — Project Scanner responsibility
* File system access beyond user-initiated capture export
* Repository file reading beyond project metadata display
* Real-time collaboration or multi-user support
* Mobile / tablet interface — Studio is desktop-only for Phase 1

---

## Terminology

All canonical terms reference `docs/glossary.md`. Implementation-specific terms defined here:

| Term | Definition |
|------|-----------|
| Panel | A discrete, navigable UI surface within Studio. Each panel has a single responsibility. Panels are switched via sidebar, keyboard shortcut, or command palette. |
| PanelId | A unique string identifier for each panel: `'browser-session'`, `'context-explorer'`, `'selection-inspector'`, `'capture-history'`, `'diagnostics'`, `'settings'`. |
| Workspace | A logical session tied to a project directory. Contains the active browser session state, panel layout, and navigation history. |
| WorkspaceHandle | A lightweight reference to an open workspace: project path, project name, and opening timestamp. |
| DisplayError | A presentation-layer error derived from platform error events. Includes origin subsystem, message, timestamp, recovery suggestion, and dismissal state. |
| Selection Mode | Studio UI state where the overlay is active and the user is hovering or clicking elements. Studio reflects this as `isSelecting: true`. |
| Degraded Mode | Studio state when a required subsystem (VCE, Event Bus) is unreachable. UI shows offline indicators and recovery actions. Non-dependent panels remain functional. |
| VCE Proxy | Studio's only path to VCE capabilities — a typed proxy that calls VCE's public API. Studio never imports VCE internals or bypasses the proxy. |
| Presentation State | UI-only state owned by Studio: active panel, navigation history, display preferences, error dismissal status. Never authoritative business state. |
| Capture History Scroll | Navigation within the capture history panel. Emits UI-only events (never drives business logic). |

---

## Runtime Boundary

| Boundary | Value |
|----------|-------|
| Process | Main desktop process (Electron shell) |
| Imports allowed | shared-types, error-model, event-bus, context-packet-schema, visual-context-engine (public API only), overlay-system (public API only) |
| Imports forbidden | browser-runtime, mcp-server, project-scanner, capture-pipeline, selection-engine, source-hint-engine, diagnostics-engine, Playwright, any DOM/browser module, any file system module (except user-initiated export), any repository-scanning module |
| Never accesses | Browser processes, Playwright APIs, Chromium DevTools Protocol, file system (except user-initiated export), repository files (except project metadata for workspace), browser DOM, page JavaScript context, network interception |
| State ownership | UI state only: active panel, navigation history, display preferences, selection state presentation, error dismissal state, workspace metadata, theme preference |
| State consumption | Business state via Event Bus subscriptions and State Store queries; never through direct subsystem imports |
| Communication direction | Studio → VCE (commands via public API proxy); EventBus → Studio (events via subscription); BrowserRuntime → Studio (NEVER — goes through EventBus) |
| Lifecycle owner | CLI (launches Studio process); Studio manages its own window lifecycle internally |
| Trust level | Trusted (runs in desktop process with Node.js access); must validate all incoming Event Bus payloads; must never trust data from untrusted sources |

---

## Responsibilities

| Responsibility | Description | Verification |
|---------------|-------------|-------------|
| Display Context Packets | Render Context Packet contents (screenshots, DOM summary, computed styles, hierarchy, source hints) in Context Explorer panel; structured presentation with expandable sections | Packet displays within 100ms of ContextPacketGenerated event receipt |
| Manage browser session display | Show active URL, viewport dimensions, browser health status; provide viewport preset toggles and selection mode controls | Browser session panel reflects Event Bus state within 50ms of event |
| Present selection state | Display selected element details (tag, bounding box, role, computed styles) in Selection Inspector; update live during hover | Selection Inspector updates within 50ms of SelectionChanged event |
| Browse capture history | List recent captures with timestamp, page URL, and packet ID; allow selection for viewing and deletion | Capture history panel loads within 200ms |
| Present diagnostics | Display subsystem health status, recent errors, and console output in Diagnostics panel; allow error dismissal and filtering | Diagnostics panel updates within 100ms of DiagnosticsUpdated event |
| Manage panel navigation | Provide sidebar, keyboard shortcuts, and command palette for switching between panels; preserve panel state during navigation | Panel switching under 100ms; state preserved across switches |
| Coordinate workspace lifecycle | Open workspace for a project path, close workspace and release UI state | Workspace load under 500ms |
| Initiate capture workflow | Call VCE.processSelection() with BrowserHandle and SelectionTarget; display progress during capture; display resulting packet | End-to-end capture workflow completes — packet displayed in Context Explorer |
| Degrade gracefully | Show offline state when VCE or Event Bus unreachable; offer reconnect; preserve remaining functional panels | Non-dependent panels remain interactive during subsystem outage |
| Present errors to user | Convert platform error events to DisplayError structures; show in Diagnostics panel with recovery suggestions; support dismissal | Errors displayed within 100ms of error event; recovery text shown |

---

## Interfaces

### Public API — Studio Shell

Every function, method, or endpoint exposed by Studio.

| Signature | Purpose | Preconditions | Postconditions | Errors |
|-----------|---------|---------------|----------------|--------|
| `start(): Promise<Result<void>>` | Initialise Studio: connect to Event Bus, verify VCE health, load user preferences, create main window, render initial panel | Event Bus must be running; VCE must be initialised (or degraded mode if not) | Studio window displayed; Browser Session panel active; all Event Bus subscriptions active | STU_STARTUP_FAILED if Event Bus unreachable or VCE health check fails after retry |
| `shutdown(): Promise<Result<void>>` | Gracefully shut down Studio: unsubscribe from Event Bus, persist user preferences, close all panels, release resources | Studio must be in Running state | All subscriptions removed; preferences persisted; window closed; no orphan processes | None — best-effort shutdown |
| `openWorkspace(projectPath: string): Promise<Result<WorkspaceHandle>>` | Open a project workspace: resolve project name from path, initialise workspace state, update panel context | `projectPath` must be a valid absolute directory path; Studio must be in Running or Degraded state | WorkspaceHandle returned; activeWorkspace set in StudioState; workspace reflected in UI | Validation error if path is invalid or inaccessible |
| `closeWorkspace(): Promise<Result<void>>` | Close the current workspace: clear workspace-specific UI state, reset panels to default state | A workspace must be open | activeWorkspace cleared; panel state reset to defaults; WorkspaceHandle released | None — idempotent (safe to call with no workspace open) |
| `startSelection(): Promise<Result<void>>` | Initiate selection mode: set `isSelecting` to true, transition state to Selecting, communicate mode change to overlay via Event Bus | Overlay must be injected and ready (verified via overlay state); browser must be connected; workspace must be open | `isSelecting` is true; StudioState transitioned to Selecting; overlay mode set to hover | STU_SELECTION_FAILED if overlay communication fails |
| `confirmSelection(): Promise<Result<SelectionTarget \| null>>` | Confirm the current selection: transition to Capturing state, call VCE.processSelection() with BrowserHandle and current SelectionTarget | `isSelecting` must be true; a SelectionChanged event must have been received with a valid SelectionTarget | StudioState transitioned to Capturing; VCE processing initiated; returns the confirmed SelectionTarget or null if no element selected | STU_CAPTURE_TIMEOUT if VCE processing exceeds 5s |
| `clearSelection(): Promise<Result<void>>` | Clear the current selection: transition to Ready state, clear Selection Inspector, communicate clear to overlay | Selection must exist (or call is idempotent — no error if no selection) | `currentSelection` cleared; Selection Inspector reset; `isSelecting` set to false; overlay highlight cleared | None — idempotent |
| `requestCapture(handle: BrowserHandle): Promise<Result<void>>` | Request a capture of the current browser state: calls VCE proxy, which orchestrates evidence collection and packet assembly | Browser must be connected; workspace must be open | VCE processing pipeline initiated; ContextPacketGenerated event expected | STU_CAPTURE_TIMEOUT if no packet received within 5s |
| `displayPacket(packet: ContextPacket): void` | Render a Context Packet in the Context Explorer panel: parse packet sections, render expandable sections, position screenshots | `packet` must be a valid ContextPacket (validated against schema) | Context Explorer updated with packet contents; activePanel switched to context-explorer if not already there | STU_DISPLAY_ERROR if packet is malformed or fails schema validation |
| `navigateTo(panel: PanelId): void` | Switch the active panel to the specified PanelId | `panel` must be a valid PanelId | `activePanel` updated; previous panel state preserved; panel rendered within 100ms | None — invalid PanelId is silently ignored or logged |
| `getCurrentPanel(): PanelId` | Return the currently active panel identifier | Studio must be in Running or Degraded state | Current PanelId returned | None |
| `getState(): StudioState` | Return the current StudioState snapshot | Studio must be initialised | StudioState returned; all fields reflect current UI state | None |

### PanelId

```typescript
type PanelId =
  | 'browser-session'
  | 'context-explorer'
  | 'selection-inspector'
  | 'capture-history'
  | 'diagnostics'
  | 'settings';
```

### StudioState

```typescript
interface StudioState {
  activePanel: PanelId;
  activeWorkspace?: string;
  currentPacket?: ContextPacket;
  currentSelection?: SelectionTarget;
  isSelecting: boolean;
  browserConnected: boolean;
  vceConnected: boolean;
  errors: DisplayError[];
}
```

### DisplayError

```typescript
interface DisplayError {
  id: string;
  timestamp: string;
  subsystem: string;
  message: string;
  recovery?: string;
  dismissed: boolean;
}
```

### WorkspaceHandle

```typescript
interface WorkspaceHandle {
  projectPath: string;
  projectName: string;
  openedAt: string;
}
```

### Events Published

Studio publishes UI-only events. These events describe user interface actions and never drive business logic. Business events originate exclusively from runtime packages.

| Event | Payload Schema | When Published |
|-------|---------------|----------------|
| `studio:panel-switched` | `{ from: PanelId; to: PanelId }` | User switches active panel via sidebar, keyboard shortcut, or command palette |
| `studio:capture-history-scrolled` | `{ scrollPosition: number }` | User scrolls within Capture History panel — UI state change only |
| `studio:preferences-changed` | `{ key: string; value: unknown }` | User modifies a display preference (theme, panel layout) |
| `studio:error-dismissed` | `{ errorId: string }` | User dismisses a DisplayError in the Diagnostics panel |
| `studio:workspace-opened` | `{ projectPath: string; projectName: string }` | Workspace successfully opened |
| `studio:workspace-closed` | `{}` | Workspace closed |

These events are published for internal Studio state synchronisation and potential future extension (e.g., plugin system observing UI state). No runtime package subscribes to Studio events in Phase 1.

### Events Subscribed

Studio subscribes to platform events from runtime packages via the Event Bus. Studio is a pure consumer — it reflects business state without modifying it.

| Event | Source | Action |
|-------|--------|--------|
| `BrowserStarted` | Browser Runtime → Event Bus | Set `browserConnected` to true; update Browser Session panel header; show browser healthy indicator |
| `PageLoaded` | Browser Runtime → Event Bus | Update URL display in Browser Session panel; refresh viewport dimensions display |
| `NavigationCompleted` | Browser Runtime → Event Bus | Update URL display in Browser Session panel |
| `ViewportChanged` | Browser Runtime → Event Bus | Update viewport dimensions display in Browser Session panel |
| `SelectionChanged` | Browser Runtime (via overlay) → Event Bus | Update Selection Inspector panel: if hover (isSelecting && tentative), show live preview; if confirmed (click), store as currentSelection |
| `CaptureCompleted` | Capture Pipeline → Event Bus | Log capture completion; refresh Capture History panel; add entry to capture list |
| `ContextPacketGenerated` | Visual Context Engine → Event Bus | **THE KEY EVENT**: call `displayPacket(packet)`; transition StudioState from Capturing to Displaying; switch active panel to context-explorer |
| `ProcessingFailed` | Visual Context Engine → Event Bus | Create DisplayError; add to errors array; transition from Capturing to Ready (or ErrorDisplaying); show recovery suggestion in Diagnostics panel |
| `DiagnosticsUpdated` | Diagnostics Subsystem → Event Bus | Update Diagnostics panel: refresh subsystem health statuses, add new errors, update metrics |
| `BrowserDisconnected` | Browser Runtime → Event Bus | Set `browserConnected` to false; show disconnected state in Browser Session panel; offer reconnect option; clear current selection |

---

## Data Models

### Browser Session Panel

**Displays:**
- Active URL (from `PageLoaded` / `NavigationCompleted` events)
- Viewport dimensions (from `ViewportChanged` events)
- Browser health status: connected / disconnected / degraded
- Connection uptime

**Actions:**
- `startSelection()` — toggle selection mode (hover)
- Toggle viewport presets: Desktop (1920×1080), Tablet (768×1024), Mobile (375×812), Custom
- `clearSelection()` — exit selection mode

**State source:**
- Event Bus subscriptions: `BrowserStarted`, `PageLoaded`, `NavigationCompleted`, `ViewportChanged`, `BrowserDisconnected`
- VCE.getState() for browser handle reference

**Data types:**

```typescript
interface BrowserSessionDisplay {
  url: string | null;
  viewport: { width: number; height: number };
  devicePreset: 'desktop' | 'tablet' | 'mobile' | 'custom';
  isConnected: boolean;
  connectedAt: string | null;
  isSelecting: boolean;
}
```

### Context Explorer Panel

**Displays:**
- Current ContextPacket contents, structured in expandable sections:
  - Screenshots (viewport, selection, full-page — rendered as images)
  - DOM Summary (tag, role, aria attributes, visibility, position)
  - Computed Styles (filtered relevant CSS properties)
  - Hierarchy (parent → siblings → children tree)
  - Diagnostics (console errors, page errors, network failures)
  - Project Metadata (framework, package manager, routes)
  - Source Hints (file paths, confidence scores, reasoning — P1 enhancement)

**Actions:**
- Expand/collapse individual sections
- Copy selected section content to clipboard
- Copy full packet JSON to clipboard
- Export packet as JSON file (user-initiated, validates destination path)

**State source:**
- `ContextPacketGenerated` event (primary)
- VCE.getLastPacket() (secondary — for initial load or refresh)

**Data types:**

```typescript
interface ContextExplorerState {
  packet: ContextPacket | null;
  expandedSections: Set<PacketSection>;
  isLoading: boolean;
  copyFeedback: { visible: boolean; message: string } | null;
}

type PacketSection =
  | 'screenshots'
  | 'dom-summary'
  | 'computed-styles'
  | 'hierarchy'
  | 'diagnostics'
  | 'project-metadata'
  | 'source-hints';
```

### Selection Inspector Panel

**Displays:**
- Selected element tag name
- Bounding box coordinates: x, y, width, height
- Computed role (aria role if available)
- Computed styles summary (key CSS properties)
- Selection status: hover (preview) vs confirmed vs cleared

**Actions:**
- `clearSelection()` — clear current selection
- `confirmSelection()` — trigger capture of current selection

**State source:**
- `SelectionChanged` events (hover preview and confirmed selection)

**Data types:**

```typescript
interface SelectionInspectorState {
  target: SelectionTarget | null;
  isConfirmed: boolean;       // true = clicked/confirmed; false = hover preview
  lastUpdated: string | null;  // ISO timestamp
}
```

### Capture History Panel

**Displays:**
- List of recent captures, each entry showing:
  - Capture ID
  - Timestamp (ISO 8601)
  - Page URL
  - Packet version
  - Selection tag name (if capture was from a selection)
- Capture count
- Scroll position

**Actions:**
- Select a capture entry to view its Context Packet in Context Explorer
- Delete a capture (calls CapturePipeline.deleteCapture via VCE proxy)
- Scroll through history (emits UI-only `studio:capture-history-scrolled` event)

**State source:**
- VCE.listCaptures() via VCE proxy
- `CaptureCompleted` events (incremental addition)

**Data types:**

```typescript
interface CaptureHistoryEntry {
  captureId: string;
  timestamp: string;
  pageUrl: string;
  packetVersion: string;
  selectionTag?: string;
}

interface CaptureHistoryState {
  entries: CaptureHistoryEntry[];
  selectedEntryId: string | null;
  isLoading: boolean;
}
```

### Diagnostics Panel

**Displays:**
- Subsystem health status (connected / degraded / offline) for each:
  - Browser Runtime
  - Visual Context Engine
  - Capture Pipeline
  - Event Bus
  - MCP Server
  - Project Scanner
- Recent errors with: error code, subsystem, message, timestamp, recovery suggestion, dismissal state
- Console output (mirrored from Browser Runtime console)
- Filter control: filter errors by subsystem

**Actions:**
- Dismiss individual errors (marks `dismissed: true` in DisplayError, emits `studio:error-dismissed`)
- Filter errors by subsystem (dropdown or tab selector)
- Clear all dismissed errors
- View error details (expand to show full error information)

**State source:**
- `DiagnosticsUpdated` events
- VCE.getDiagnostics() via VCE proxy
- `ProcessingFailed` events (create DisplayError entries)

**Data types:**

```typescript
interface DiagnosticsPanelState {
  subsystemHealth: Record<string, SubsystemHealthStatus>;
  errors: DisplayError[];
  activeFilter: string | null;  // null = show all
  consoleOutput: ConsoleEntry[];
}

interface SubsystemHealthStatus {
  name: string;
  status: 'connected' | 'degraded' | 'offline' | 'unknown';
  lastHeartbeat: string | null;
  uptime: number;  // seconds
}

interface ConsoleEntry {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  message: string;
  timestamp: string;
  source: string;  // page URL or 'platform'
}
```

### Settings Panel

**Displays:**
- Theme toggle: light / dark / system
- Viewport presets (editable custom presets)
- Default panel on startup
- Keyboard shortcut reference
- About section (version, build info)

**Actions:**
- Toggle theme
- Add/edit/remove custom viewport presets
- Reset all settings to defaults

**State source:**
- Studio persisted preferences (local storage)
- Config package for viewport presets

---

## State Model

### Studio State Transitions

```
                         ┌──────────┐
                         │ Starting │
                         └────┬─────┘
                              │ Event Bus connected,
                              │ VCE health verified,
                              │ preferences loaded
                              ▼
                         ┌──────────┐
              ┌──────────│  Ready   │◄─────────────────────────┐
              │          └────┬─────┘                          │
              │               │ startSelection()               │
              │               ▼                                │
              │          ┌───────────┐                         │
              │          │ Selecting │                         │
              │          └─────┬─────┘                         │
              │                │ confirmSelection()            │
              │                ▼                               │
              │          ┌───────────┐                         │
              │          │ Capturing │                         │
              │          └─────┬─────┘                         │
              │                │ ContextPacketGenerated        │
              │                ▼                               │
              │          ┌─────────────┐                       │
              │          │ Displaying  │                       │
              │          └──────┬──────┘                       │
              │                 │ clearSelection()             │
              │                 │ OR startSelection() (new)    │
              │                 └──────────────────────────────┘
              │
              │  On ProcessingFailed (from VCE):
              │  Capturing ──→ Ready (with DisplayError)
              │
              └── (VCE or Event Bus unreachable):
                  Any state ──→ Degraded
                  Degraded ──→ Ready (on reconnect)
```

### State Descriptions

| State | Description |
|-------|-------------|
| **Starting** | Studio initialising: connecting to Event Bus, verifying VCE health, loading user preferences, creating main window. Transitional — does not accept user input. Duration: under 2s. |
| **Ready** | Idle state. All subsystems healthy. Browser Session panel active. Studio accepts all commands. This is the default operating state. |
| **Selecting** | Overlay active in hover mode. `isSelecting` is true. Selection Inspector panel shows live hover preview. User is moving pointer over page elements. Studio updates Selection Inspector on each SelectionChanged event. |
| **Capturing** | Selection confirmed. VCE processing pipeline is running. Studio shows progress indicator (spinner) in Context Explorer panel. User cannot make new selections. Duration: VCE processing time (target under 2s; timeout at 5s). |
| **Displaying** | Context Packet rendered in Context Explorer panel. User can browse packet sections, copy content, export, or start a new selection. Studio returns to Ready on clearSelection or new startSelection. |
| **ErrorDisplaying** | Transient substate within any active state. An error is displayed in the Diagnostics panel. User can dismiss the error. Does not block other panel interactions. |
| **Degraded** | One or more required subsystems (VCE, Event Bus) are unreachable. Browser Session panel shows disconnected state. Context Explorer and Selection Inspector show offline indicators. Diagnostics and Settings panels remain functional. Reconnect option available. |

### State Ownership Rule

Studio state is **PRESENTATION ONLY**. The canonical source of truth for business state resides exclusively in runtime packages:

| Business State | Canonical Owner |
|----------------|-----------------|
| Browser state (pages, viewport, connection) | Browser Runtime |
| Selection state (target, validation, hierarchy) | Selection Engine → Event Bus |
| Context Packets | Visual Context Engine |
| Capture history | Capture Pipeline |
| Diagnostics (health, errors, console) | Diagnostics Subsystem |
| Project metadata | Project Scanner |

Studio **reflects** these states. It never creates, mutates, or stores authoritative versions. Studio caches the current packet in memory for display purposes only (ephemeral — lost on workspace close or new selection).

### Invariants

| Invariant | Description |
|-----------|-------------|
| No business state mutation | StudioState fields derived from Event Bus events must never be mutated by Studio code; they are read-only reflections of platform state |
| Single active workspace | At most one workspace open at any time; opening a new workspace implicitly closes the previous |
| Panel state preserved | Switching panels preserves the state of the panel being left (scroll position, expanded sections, selected items) |
| Error isolation | A display error in one panel does not block other panels; errors are non-modal |
| No direct subsystem access | Studio never imports runtime package internals; all communication goes through Event Bus (events) or VCE public API proxy (commands) |
| Selection state consistency | `isSelecting` is true if and only if the overlay is in hover or selection mode; cleared on confirmSelection, clearSelection, or BrowserDisconnected |
| Packet display exclusivity | Only one Context Packet displayed at a time; new packet replaces previous in Context Explorer |
| Degraded mode integrity | In Degraded mode, Studio must not attempt to call unreachable subsystems; calls to disconnected VCE return immediately with appropriate error |

### Lifecycle

```
Initialised → Starting → (Ready ⇄ Selecting ⇄ Capturing → Displaying) → ShuttingDown → Terminated
                                                                              ↑
                                                                         Degraded
```

1. **Initialised**: CLI spawns Studio process. Electron app created. Window not yet visible.
2. **Starting**: Event Bus connection established. VCE health verified. Preferences loaded. Window rendered.
3. **Running** (Ready/Selecting/Capturing/Displaying): Normal operation. Panels functional. Commands accepted.
4. **Degraded**: Subsystem unreachable. Limited functionality. Reconnect available.
5. **ShuttingDown**: User initiated shutdown or CLI sent shutdown signal. Unsubscribing from Event Bus. Persisting preferences. Releasing resources.
6. **Terminated**: Process exited. No orphan resources.

---

## Command Flows

### Select → Capture → Display Workflow (The Vertical Slice)

```
1. User clicks "Start Selection" in Studio Browser Session panel
   → Studio.startSelection()
   → StudioState transitions: Ready → Selecting
   → isSelecting set to true
   → Studio publishes studio:selection-mode-changed { active: true }
   → VCE proxy relays selection start to Browser Runtime
   → Browser Runtime injects overlay in hover mode
   → Cursor changes to crosshair in browser viewport

2. User moves pointer over page elements
   → Overlay detects hover → overlay:element-hovered
   → Browser Runtime publishes SelectionChanged to Event Bus
   → Studio subscriber receives SelectionChanged
   → Studio updates Selection Inspector panel (live preview):
     - Displays: tag name, bounding box, role
     - Shows "Hover Preview" indicator
     - Style: dashed border highlight representation
   → VCE subscriber does NOT trigger (hover is preview only — no capture)

3. User clicks an element in the browser viewport
   → Overlay detects click → overlay:element-clicked
   → Browser Runtime publishes SelectionChanged to Event Bus
   → Studio subscriber receives SelectionChanged
   → Studio transitions: Selecting → Capturing
     - isSelecting: false
     - Context Explorer shows loading spinner
     - Selection Inspector shows "Capturing..." status
   → Studio.confirmSelection() called
   → Studio calls VCE.processSelection(handle, selectionTarget)
   → CAPTURE_TIMEOUT timer started (5s)

4. VCE generates Context Packet (8-stage pipeline)
   → VCE collects evidence: DOM, styles, hierarchy, screenshots, diagnostics, project metadata, source hints
   → VCE assembles Context Packet
   → VCE publishes ContextPacketGenerated to Event Bus
   → Capture Pipeline persists packet → publishes CaptureCompleted to Event Bus
   → CAPTURE_TIMEOUT timer cleared

5. Studio subscriber receives ContextPacketGenerated
   → Studio transitions: Capturing → Displaying
   → Studio.displayPacket(packet)
   → Context Explorer panel becomes active (or user's current panel preserved)
   → Context Explorer renders packet in expandable sections:
     - Screenshots section (default expanded)
     - DOM Summary section
     - Computed Styles section
     - Hierarchy section
     - Diagnostics section (if any)
   → Sidebar shows notification badge on Context Explorer icon

6. User views packet, optionally:
   a. Expands/collapses sections to explore context
   b. Copies section content or full JSON to clipboard
   c. Exports packet as JSON file
   d. Starts new selection (returns to step 1)
   e. Clears selection (returns to Ready state)
```

### Start Selection Cancellation

```
User clicks "Cancel Selection" or presses Escape
  → Studio.clearSelection()
  → StudioState transitions: Selecting → Ready
  → isSelecting set to false
  → Studio publishes studio:selection-mode-changed { active: false }
  → VCE proxy relays clear to Browser Runtime
  → Overlay exits selection mode, clears highlight
  → Selection Inspector cleared
```

### Workspace Open Flow

```
User opens a workspace (File → Open Workspace, or CLI parameter)
  → Studio.openWorkspace(projectPath)
  → Validate projectPath (exists, is directory, accessible)
  → Resolve project name from path (basename)
  → Create WorkspaceHandle { projectPath, projectName, openedAt }
  → Set activeWorkspace in StudioState
  → Initialise panel states for new workspace:
    - Browser Session: show "waiting for browser" state
    - Context Explorer: empty state "No capture yet"
    - Selection Inspector: empty state "No selection"
    - Capture History: loading (fetch from VCE proxy)
    - Diagnostics: show current subsystem health
  → Publish studio:workspace-opened
  → Return WorkspaceHandle
```

### Error Display Flow

```
ProcessingFailed event received from Event Bus
  → Studio subscriber receives event
  → Create DisplayError:
    { id: uuid(), timestamp: now(), subsystem: 'VCE',
      message: event.error.message, recovery: event.error.recovery,
      dismissed: false }
  → Append to StudioState.errors
  → Studio transitions: Capturing → Ready
  → Diagnostics panel shows error with recovery suggestion
  → If CAPTURE_TIMEOUT timer was running, cancel it

User dismisses error in Diagnostics panel
  → Set DisplayError.dismissed = true
  → Publish studio:error-dismissed { errorId }
  → Dismissed errors hidden (or greyed out) in Diagnostics panel
```

---

## Event Flows

### Studio as Subscriber (Primary Communication Pattern)

```
                           ┌──────────────────────┐
                           │    Runtime Packages   │
                           │  (Browser Runtime,    │
                           │   VCE, Capture        │
                           │   Pipeline,           │
                           │   Diagnostics)        │
                           └──────────┬───────────┘
                                      │ publish events
                                      ▼
                           ┌──────────────────────┐
                           │      Event Bus        │
                           │  (immutable transport,│
                           │   no business logic)  │
                           └──────────┬───────────┘
                                      │ deliver via subscription
                                      ▼
                           ┌──────────────────────┐
                           │       Studio          │
                           │  ┌─────────────────┐ │
                           │  │ Event Handlers   │ │
                           │  │  ─────────────  │ │
                           │  │ BrowserStarted   │ │
                           │  │   → update       │ │
                           │  │     browser       │ │
                           │  │     session panel │ │
                           │  │                  │ │
                           │  │ SelectionChanged  │ │
                           │  │   → update       │ │
                           │  │     selection     │ │
                           │  │     inspector     │ │
                           │  │                  │ │
                           │  │ ContextPacket-   │ │
                           │  │   Generated       │ │
                           │  │   → displayPacket │ │
                           │  │                  │ │
                           │  │ ...               │ │
                           │  └─────────────────┘ │
                           └──────────────────────┘
```

### Detailed Event-to-Action Mapping

```
Event Bus
  │
  ├──BrowserStarted──→
  │     Studio: browserConnected = true
  │     Browser Session panel: show "Connected" badge, show URL "waiting..."
  │     Diagnostics panel: update Browser Runtime health to "connected"
  │
  ├──PageLoaded──→
  │     Studio: update BrowserSessionDisplay.url
  │     Browser Session panel: show current URL in address bar
  │
  ├──NavigationCompleted──→
  │     Studio: update BrowserSessionDisplay.url (final URL after redirects)
  │     Browser Session panel: show final URL
  │
  ├──ViewportChanged──→
  │     Studio: update BrowserSessionDisplay.viewport { width, height }
  │     Browser Session panel: show viewport dimensions
  │
  ├──SelectionChanged──→
  │     if isSelecting && event is hover:
  │       Studio: update SelectionInspectorState with preview
  │       Selection Inspector: show live preview (tag, bbox, role)
  │     if isSelecting && event is click/confirmed:
  │       Studio: currentSelection = event.target
  │       Studio: auto-call confirmSelection()
  │       Studio: transition Selecting → Capturing
  │
  ├──CaptureCompleted──→
  │     Studio: refresh CaptureHistoryState
  │     Capture History panel: add entry, update count
  │
  ├──ContextPacketGenerated──→
  │     Studio: CAPTURE_TIMEOUT cleared
  │     Studio: transition Capturing → Displaying
  │     Studio: displayPacket(event.packet)
  │     Context Explorer: render packet with expandable sections
  │     Selection Inspector: show "Capture complete" status
  │
  ├──ProcessingFailed──→
  │     Studio: CAPTURE_TIMEOUT cleared (if running)
  │     Studio: create DisplayError with event.error details
  │     Studio: transition Capturing → Ready
  │     Diagnostics panel: show error with recovery suggestion
  │
  ├──DiagnosticsUpdated──→
  │     Studio: update subsystem health statuses
  │     Diagnostics panel: refresh health indicators, add new errors, update metrics
  │
  └──BrowserDisconnected──→
        Studio: browserConnected = false
        Browser Session panel: show "Disconnected" state, offer reconnect
        Studio: clearSelection() (clear any active selection)
        Studio: if in Selecting state, transition → Ready
```

### Studio as Publisher (UI-Only Events)

Studio publishes UI-only events for internal state synchronisation. These are consumed ONLY by Studio internals (e.g., sidebar ↔ panel communication). No runtime package subscribes to Studio events in Phase 1.

```
Studio (UI Layer)
  │
  ├──studio:panel-switched { from, to }──→
  │     Internal: update sidebar active indicator, update command palette context
  │
  ├──studio:workspace-opened { projectPath, projectName }──→
  │     Internal: update window title, update recent projects list
  │
  ├──studio:workspace-closed {}──→
  │     Internal: reset window title, clear workspace-specific state
  │
  ├──studio:error-dismissed { errorId }──→
  │     Internal: update error visibility in Diagnostics panel
  │
  ├──studio:preferences-changed { key, value }──→
  │     Internal: apply theme change, update panel layout
  │
  └──studio:capture-history-scrolled { scrollPosition }──→
        Internal: preserve scroll position on panel switch
```

---

## Error Behaviour

| Condition | Error Code | Message | Recovery |
|-----------|-----------|---------|----------|
| Event Bus unreachable during startup (connection refused, timeout) | `STU_STARTUP_FAILED` | "Studio failed to connect to the Event Bus. The platform messaging system is not running." | Show degraded state. Retry connection every 2s for up to 30s. If still failing, allow user to retry manually or exit. |
| VCE health check fails during startup (not responding, process crashed) | `STU_STARTUP_FAILED` | "Studio cannot reach the Visual Context Engine. Context capture and display will be unavailable." | Show degraded state with VCE offline indicator. Other panels (Diagnostics, Settings) remain functional. VCE reconnect attempt on user action. |
| startSelection() called but overlay injection fails (Browser Runtime reports overlay not ready) | `STU_SELECTION_FAILED` | "Failed to start selection mode. The visual overlay could not be activated in the browser." | Return to Ready state. Show error in Diagnostics panel with suggestion: "Check that the browser is connected and the inspected page has finished loading." |
| confirmSelection() called but no selection exists (no SelectionChanged event received) | `STU_SELECTION_FAILED` | "No element is currently selected. Click an element in the browser viewport or press Escape to cancel." | Return to Selecting state. No state transition. User can try again. |
| VCE.processSelection() exceeds 5s timeout | `STU_CAPTURE_TIMEOUT` | "Capture timed out. The Visual Context Engine took longer than 5 seconds to process the selection." | Transition to Ready. Show timeout error in Diagnostics panel with recovery: "The page may be very large or complex. Try selecting a smaller element, or check the Diagnostics panel for VCE errors." Offer retry button. |
| Context Packet received but fails schema validation (malformed packet from VCE) | `STU_DISPLAY_ERROR` | "The received Context Packet failed validation. Some data may be missing or malformed." | Show raw packet data as fallback (JSON tree view). Show validation errors alongside. Do not crash. Allow user to view partial data. |
| displayPacket() called with corrupted screenshots (file missing, invalid format) | `STU_DISPLAY_ERROR` | "One or more screenshots in the Context Packet could not be displayed." | Show placeholder with error icon for missing screenshots. Display other packet sections normally. |
| Workspace open with invalid path (not a directory, no permissions) | `STU_WORKSPACE_ERROR` | "Cannot open workspace: '<path>' is not a valid project directory." | Return error. Do not modify current workspace. Show validation error to user. |
| User attempts export with invalid destination path | `STU_EXPORT_ERROR` | "Cannot export to '<path>'. The destination path is not writable." | Validate destination before write. Show error. Do not write partial data. |
| Panel render crashes (unhandled React error) | `STU_RENDER_ERROR` | "The '<panel>' panel encountered a rendering error." | Catch via error boundary. Show panel-level error state with "Reload Panel" button. Other panels remain functional. Never crash entire Studio window. |

### Error Display Rules

- All errors appear in the Diagnostics panel as `DisplayError` entries
- Errors from `STU_CAPTURE_TIMEOUT` and `STU_SELECTION_FAILED` also show as contextual toasts/banners near the relevant panel
- Recovery suggestions are rendered as actionable text (buttons for retry, links to settings)
- Errors can be dismissed individually; dismissed errors are hidden from the main view but retained in error history for the session
- Error history is cleared on workspace close
- Error count badge shown on Diagnostics panel sidebar icon

---

## Security Requirements

### Trust Boundaries

```
┌──────────────────────────────────────────────────────┐
│ Trusted Zone: Desktop Process (Electron Main/Renderer) │
│                                                       │
│  ┌──────────────────────────────────────────────┐    │
│  │ Studio                                       │    │
│  │  • Full Node.js access (Electron renderer)   │    │
│  │  • Reads/writes preferences to user dir      │    │
│  │  • Receives Event Bus payloads               │    │
│  │  • Calls VCE public API                      │    │
│  │  • Exports files on user request              │    │
│  └──────────────┬───────────────────────────────┘    │
│                 │                                      │
│    ═════════════╪══════════════════ Process Boundary   │
│                 │                                      │
│  ┌──────────────▼───────────────────────────────┐    │
│  │ Event Bus (local, 127.0.0.1)                  │    │
│  │  • Transports immutable events                │    │
│  │  • No business logic                          │    │
│  └──────────────────────────────────────────────┘    │
│                                                       │
│  ┌──────────────────────────────────────────────┐    │
│  │ Visual Context Engine (local process)         │    │
│  │  • Generates Context Packets                  │    │
│  │  • Can access file system, browser            │    │
│  │  • Validates all outputs against schemas      │    │
│  └──────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

### Validation Rules

1. **Event Bus payload validation**: All incoming Event Bus messages must be validated against the expected event schema before processing. Unknown event types are logged and discarded. Malformed payloads are logged and the event is rejected — Studio state is not updated.
2. **Context Packet validation**: Before calling `displayPacket()`, Studio validates the packet against the Context Packet schema (SPEC-006). Malformed packets trigger `STU_DISPLAY_ERROR` — raw data shown as fallback, no crash.
3. **Export destination validation**: Before writing an exported file, Studio validates the destination path: must be an absolute path, must not point to the `.viskod/` internal directory, must not overwrite an existing file without user confirmation.
4. **User input sanitisation**: Workspace path inputs are validated as valid directory paths. PanelId values from keyboard shortcuts are validated against the PanelId union type.
5. **No code execution**: Studio must never execute code from Context Packets, Event Bus payloads, or any external source. All rendering is declarative (React components) — no `eval()`, no `new Function()`, no dynamic code injection.

### Sensitive Data Handling

* Studio displays screenshots from Context Packets via relative file paths — screenshots are loaded from the `.viskod/captures/` directory and never uploaded
* Studio must never read or display: `.env` file contents, API keys, session tokens, cookies, localStorage contents, environment variables
* The Context Explorer panel must never render raw HTML from the inspected page (screenshots only; DOM data is presented as structured JSON/text)
* Export functionality writes to user-specified path only; Studio never transmits data over the network
* Studio persists only: user preferences (theme, viewport presets, recent workspaces), window position/size — never business data, never capture contents

### Capability Requirements

* Studio requires Electron sandbox permissions: file system access (limited to user-initiated export), local storage (preferences), window management
* Studio requires no network access beyond localhost (Event Bus connection to 127.0.0.1)
* Studio requires no elevated OS permissions

---

## Privacy Requirements

### Data Collected and Purpose

| Data | Purpose | Retention | Deletion |
|------|---------|-----------|----------|
| Active workspace path | Display project name in window title; populate recent projects list | Persistent — stored in user preferences | Removed on user request via Settings panel ("Clear Recent Projects") |
| Panel navigation state (activePanel, expanded sections, scroll position) | Restore UI state on panel switch and session resume | Session duration (lost on Studio close) | N/A — ephemeral |
| Theme preference (light/dark/system) | Apply user's visual preference | Persistent — stored in user preferences | Reset via Settings panel |
| Viewport preset customisations | Persist user-defined viewport dimensions | Persistent — stored in user preferences | Reset via Settings panel |
| Error dismissal state | Track which errors the user has acknowledged | Session duration (lost on workspace close) | N/A — ephemeral |
| Capture history scroll position | Restore scroll position on panel switch | Session duration | N/A — ephemeral |
| Recently opened workspaces list | Quick workspace access | Persistent — stored in user preferences | Cleared via Settings panel |

### What Must Not Be Collected

* User interaction analytics (no click tracking, no feature usage metrics, no session duration logging)
* Keystrokes (except keyboard shortcuts — processed locally, never logged)
* Panel dwell time or navigation patterns
* Screenshots of Studio itself
* Clipboard contents (except on explicit user "Copy" action — processed locally, never stored)
* Network request data from the inspected application
* Any information about the inspected application beyond what is displayed in the Context Packet

### Ephemeral Guarantee

* Context Packet in-memory cache: exists only while the current packet is displayed; cleared on new selection, workspace close, or Studio shutdown
* Selection preview state (hover highlights): exists only during Selecting state; cleared on state transition
* Error history: exists only for the current workspace session; cleared on workspace close
* All ephemeral data lives in React component state or context — no persistence to disk, no transmission over network

---

## Performance Budget

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Studio startup (cold — first launch after install) | < 2000 ms | `performance.now()` delta from process spawn to first paint of Browser Session panel |
| Studio startup (warm — subsequent launches) | < 1000 ms | `performance.now()` delta from process spawn to Ready state |
| Panel switching | < 100 ms | `performance.now()` delta from navigateTo() call to panel content rendered (first paint) |
| Selection response (hover highlight update in Selection Inspector) | < 50 ms | Time from SelectionChanged event received by Studio subscriber to Selection Inspector DOM update complete |
| Packet display (after ContextPacketGenerated event received) | < 100 ms | Time from displayPacket() call to first expandable section rendered in Context Explorer |
| Workspace load | < 500 ms | Time from openWorkspace() call to panels initialised and Browser Session panel rendered |
| UI thread never blocked on VCE processing | Async guarantee | VCE.processSelection() called asynchronously; Studio render loop never awaits VCE completion synchronously |
| Memory baseline (idle, no workspace open) | < 150 MB | Process memory (RSS) measured after startup, before workspace open |
| Memory under load (packet displayed, all panels active) | < 300 MB | Process memory (RSS) measured with Context Packet displayed and all panels having been navigated to |
| Frame rate during hover (Selection Inspector updates) | ≥ 30 FPS | Chrome DevTools FPS meter during rapid pointer movement with Selection Inspector visible |
| Frame rate during normal operation | ≥ 60 FPS | Chrome DevTools FPS meter during panel switching and idle operation |
| Event processing latency (event received → UI updated) | < 50 ms | Time from Event Bus subscriber callback invoked to React state update committed |
| Export file write (1 MB Context Packet JSON) | < 200 ms | Time from user confirming export to file write complete callback |

---

## Observability

### Log Events

Studio emits diagnostic log events through the platform logging infrastructure. These are UI-level observability signals only — not business metrics.

| Event | Level | When | Payload |
|-------|-------|------|---------|
| `studio.startup.begin` | INFO | Studio process started, initialisation beginning | `{ version: string; electronVersion: string }` |
| `studio.startup.complete` | INFO | Studio reached Ready state | `{ startupTimeMs: number; vceConnected: boolean }` |
| `studio.startup.failed` | ERROR | Studio failed to reach Ready state | `{ reason: string; startupTimeMs: number }` |
| `studio.workspace.opened` | INFO | Workspace successfully opened | `{ projectPath: string; projectName: string }` |
| `studio.workspace.closed` | INFO | Workspace closed | `{ projectPath: string }` |
| `studio.panel.switched` | DEBUG | Active panel changed | `{ from: PanelId; to: PanelId }` |
| `studio.panel.render_error` | ERROR | A panel's error boundary caught a render error | `{ panel: PanelId; error: string }` |
| `studio.selection.started` | DEBUG | startSelection() called | `{}` |
| `studio.selection.confirmed` | INFO | confirmSelection() completed successfully | `{ selector: string; tagName: string }` |
| `studio.selection.failed` | WARN | Selection operation failed | `{ reason: string; errorCode: string }` |
| `studio.capture.timeout` | WARN | VCE capture exceeded 5s timeout | `{ selectionSelector?: string }` |
| `studio.packet.displayed` | INFO | Context Packet successfully rendered | `{ packetId: string; sections: number }` |
| `studio.packet.validation_failed` | ERROR | Context Packet failed schema validation | `{ packetId: string; validationErrors: string[] }` |
| `studio.export.complete` | INFO | User export completed | `{ path: string; sizeBytes: number }` |
| `studio.degraded.entered` | WARN | Studio entered Degraded mode | `{ reason: string; unreachableSubsystems: string[] }` |
| `studio.degraded.exited` | INFO | Studio exited Degraded mode | `{ recoveredSubsystems: string[] }` |
| `studio.shutdown.begin` | INFO | Shutdown initiated | `{}` |
| `studio.shutdown.complete` | INFO | Shutdown complete, process exiting | `{}` |
| `studio.error.displayed` | WARN | DisplayError shown to user | `{ errorCode: string; subsystem: string }` |
| `studio.error.dismissed` | DEBUG | User dismissed a DisplayError | `{ errorId: string }` |

### Diagnostic Signals

| Signal | Description | Access |
|--------|-------------|--------|
| Studio health check | Verify Studio is responsive: Event Bus connected, all panel renderers healthy, no stuck state transitions | Internal health check endpoint (Electron IPC) |
| Event Bus connection status | Connected / disconnected / reconnecting | Read from Event Bus client state |
| Panel render health | Per-panel error boundary status: healthy / errored / recovering | Read from React error boundary state |
| State machine position | Current Studio state: Starting / Ready / Selecting / Capturing / Displaying / Degraded | Read from StudioState |
| Active subscriptions | List of Event Bus subscriptions with last event received timestamp | Read from Event Bus client |
| Memory pressure | Current process memory usage vs budget | Read from process.memoryUsage() |

### Health Check Endpoints

No HTTP endpoints. Studio health is exposed via Electron IPC:

```typescript
interface StudioHealth {
  state: StudioState;
  uptime: number;  // seconds since start
  memoryUsage: { rss: number; heapTotal: number; heapUsed: number };
  eventBusConnected: boolean;
  vceConnected: boolean;
  panelHealth: Record<PanelId, 'healthy' | 'errored' | 'recovering'>;
  lastEventReceived: Record<string, string>;  // event type → ISO timestamp
  errorCount: number;
}
```

### Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `studio.startup.duration_ms` | Histogram | Distribution of startup durations |
| `studio.panel.switch.duration_ms` | Histogram | Distribution of panel switching latencies |
| `studio.packet.display.duration_ms` | Histogram | Distribution of packet display latencies |
| `studio.selection.response.duration_ms` | Histogram | Distribution of selection UI update latencies |
| `studio.errors.total` | Counter | Total display errors by error code |
| `studio.degraded.duration_ms` | Histogram | Distribution of Degraded mode durations |
| `studio.workspace.open.duration_ms` | Histogram | Distribution of workspace open latencies |
| `studio.memory.rss_bytes` | Gauge | Current process RSS memory |
| `studio.panels.rendered` | Counter | Total panel renders by PanelId |

---

## Configuration

### User Preferences (Persisted)

| Key | Default | Description | Validation |
|-----|---------|-------------|------------|
| `theme` | `"system"` | Visual theme: `"light"`, `"dark"`, or `"system"` (follows OS) | Must be one of `"light"`, `"dark"`, `"system"` |
| `defaultPanel` | `"browser-session"` | Panel shown on startup | Must be a valid PanelId |
| `customViewports` | `[]` | User-defined custom viewport presets | Array of `{ name: string; width: number; height: number }`; width/height must be positive integers |
| `recentWorkspaces` | `[]` | Recently opened workspace paths (max 10) | Array of strings; must be valid absolute paths (trimmed to max 10) |
| `sidebarCollapsed` | `false` | Whether sidebar is collapsed | Boolean |
| `windowBounds` | `{ width: 1440; height: 900 }` | Last window size | width ≥ 800; height ≥ 600 |
| `windowPosition` | `{ x: undefined; y: undefined }` | Last window position (undefined = center) | x, y must be numbers or undefined |
| `captureHistorySort` | `"newest"` | Sort order for capture history | Must be `"newest"` or `"oldest"` |
| `consoleAutoScroll` | `true` | Auto-scroll console output in Diagnostics panel | Boolean |

### Startup Configuration

| Key | Default | Description |
|-----|---------|-------------|
| `eventBusReconnectDelayMs` | 2000 | Delay between Event Bus reconnection attempts in Degraded mode |
| `eventBusReconnectMaxAttempts` | 15 | Maximum Event Bus reconnection attempts (15 × 2s = 30s total) |
| `captureTimeoutMs` | 5000 | Maximum wait time for VCE.processSelection() before STU_CAPTURE_TIMEOUT |
| `recentWorkspacesMax` | 10 | Maximum number of recent workspaces to persist |
| `panelRenderErrorRetryDelayMs` | 3000 | Delay before auto-reloading a panel after render error |

### Environment Variable Mappings

No environment variables. Studio configuration is managed through the Settings panel UI and persisted to user preferences. The config is loaded at startup and applied before the first render.

---

## Failure and Recovery

### Studio Startup Fails

**Cause**: Event Bus process not running, VCE not initialised, or port conflicts.

**Recovery**: Studio enters Degraded mode. Event Bus reconnection attempted every 2s for up to 30s. If VCE is unreachable but Event Bus is connected, Studio operates with limited functionality (Diagnostics and Settings panels functional; Browser Session, Context Explorer, Selection Inspector show offline states). On VCE reconnect, Studio transitions from Degraded to Ready.

**Downstream impact**: None — Studio is a terminal node. Its failure does not affect runtime packages.

### Event Bus Disconnection During Operation

**Cause**: Event Bus process crashed or network (localhost) interrupted.

**Recovery**: Studio detects disconnection via Event Bus client heartbeat. Studio transitions to Degraded mode. All panels show stale data with "Reconnecting..." indicator. Automatic reconnection attempts every 2s. On reconnect, Studio re-subscribes to all event types, requests current state from VCE proxy, and transitions back to Ready.

### Panel Render Error

**Cause**: Unhandled React exception in a panel component (e.g., malformed data causing render failure).

**Recovery**: React Error Boundary catches the error. Affected panel shows error state with "Reload Panel" button. Error logged via `studio.panel.render_error`. Other panels continue functioning. Auto-reload attempted after 3s for transient errors. If error persists, panel remains in error state until user manually reloads or data changes.

### VCE Unreachable During Capture

**Cause**: VCE process crashed or became unresponsive during `processSelection()`.

**Recovery**: CAPTURE_TIMEOUT timer fires after 5s. Studio transitions Capturing → Ready. `STU_CAPTURE_TIMEOUT` DisplayError created. User can retry capture. If VCE has actually crashed, Studio detects via health check and transitions to Degraded mode.

### Workspace Open Fails

**Cause**: Invalid path, insufficient permissions, or path does not exist.

**Recovery**: Validation error returned. Current workspace (if any) preserved unchanged. Error displayed to user with validation details. User can correct path and retry.

### Export Fails

**Cause**: Destination path not writable, disk full, or permission denied.

**Recovery**: Pre-write validation catches most errors. If write fails mid-operation, partial file is cleaned up. Error displayed with suggestion: "Check disk space and write permissions for the destination folder."

### Memory Pressure

**Cause**: Large Context Packets, many captures displayed, or memory leak.

**Recovery**: Studio monitors memory usage via `process.memoryUsage()` polling (every 10s in Development, every 60s in Production). If RSS exceeds 300 MB, Studio logs a warning and suggests restart. If RSS exceeds 500 MB, Studio shows a user-visible warning with "Restart Studio" suggestion.

### Downstream Impact

| Studio Failure | Impact on VCE | Impact on Browser Runtime | Impact on MCP Server |
|----------------|---------------|---------------------------|---------------------|
| Studio crashes | None — VCE continues operating | None — browser continues running | None — MCP continues serving AI agents |
| Studio enters Degraded mode | None — VCE processes captures normally | None — BR continues managing browser | None |
| Panel render error | None | None | None |
| Studio shutdown | None — VCE notified, may persist in-flight capture | None — BR continues until CLI orchestrates shutdown | None |

### Isolation Guarantee

A failure in Studio must never:
- Crash the Visual Context Engine
- Crash the Browser Runtime
- Crash the MCP Server
- Cause the inspected browser to close
- Corrupt persisted captures
- Cause data loss in runtime packages
- Prevent AI agents from consuming Context Packets through MCP

---

## Compatibility

### Breaking Change Policy

* Studio API (Studio interface methods and signatures) is versioned with the Studio package
* Adding a new optional parameter to an existing method is non-breaking
* Renaming a method, changing return types, adding required parameters, or removing methods is breaking
* PanelId values are part of the public interface — adding a new PanelId is non-breaking; removing or renaming a PanelId is breaking
* StudioState shape changes are breaking if fields are removed or renamed; adding new optional fields is non-breaking
* Studio events (studio:*) are internal to Studio — changes to their schema are non-breaking for the platform

### Migration Strategy for Breaking Changes

1. New Studio API version with incremented version identifier
2. Studio consumer (CLI) updated to use new API
3. Old API methods deprecated with warning during one release cycle
4. Old methods removed after deprecation window

### Deprecation Window

* One release cycle (typically one sprint / two weeks) for non-security changes
* Immediate (zero-day) for security vulnerabilities

### Backwards Compatibility

* SPEC-023 v1.0 defines the initial Studio interface; no backwards compatibility obligations exist
* Future versions must preserve the fundamental architecture: Studio consumes platform state through Event Bus and State Store; Studio never accesses browser or runtime packages directly

---

## Testing Requirements

### Unit Tests

1. **State transitions correct**
   - Test each valid transition: Starting → Ready, Ready → Selecting, Selecting → Capturing, Capturing → Displaying, Displaying → Ready
   - Test state invariants: cannot transition from Starting directly to Capturing, cannot confirmSelection when not Selecting
   - Test degraded transitions: Ready → Degraded → Ready on reconnect

2. **StudioState immutable updates**
   - Verify that state updates produce new objects (reference equality test)
   - Verify that business-state fields (browserConnected, vceConnected, currentSelection) are never mutated by Studio code — only set from Event Bus event handlers

3. **DisplayError creation and rendering**
   - Create DisplayError from ProcessingFailed event payload with all fields populated
   - Verify error dismissal: setting dismissed = true removes from visible list
   - Verify error filtering by subsystem

4. **Panel switching preserves state**
   - Set panel-specific state (e.g., expanded sections in Context Explorer)
   - Switch to different panel
   - Switch back — verify state preserved

5. **displayPacket renders all sections**
   - Provide valid ContextPacket with all sections populated
   - Verify each section is rendered with correct content
   - Verify expand/collapse behaviour per section

6. **Export destination validation**
   - Test with valid writable path → passes validation
   - Test with path inside .viskod/ → rejected
   - Test with non-existent directory → rejected with appropriate error

7. **WorkspaceHandle creation**
   - Valid projectPath → returns WorkspaceHandle with correct projectName and openedAt
   - Invalid path → returns error, no state change

8. **getState snapshot accuracy**
   - Set up known StudioState
   - Call getState() — verify all fields match
   - Verify snapshot is not mutated by subsequent state changes (defensive copy)

### Integration Tests

1. **Studio subscribes to Event Bus → receives ContextPacketGenerated → calls displayPacket**
   - Mock Event Bus publishing ContextPacketGenerated with valid packet
   - Assert: displayPacket called with correct packet argument
   - Assert: StudioState transitioned to Displaying

2. **startSelection triggers overlay injection flow**
   - Call startSelection()
   - Verify StudioState.isSelecting = true
   - Verify VCE proxy called with correct selection start command
   - Mock SelectionChanged hover event → verify Selection Inspector updates

3. **SelectionChanged (confirmed click) → auto-calls confirmSelection**
   - Studio in Selecting state (isSelecting = true)
   - Mock SelectionChanged event with confirmed selection payload
   - Assert: Studio transitions Selecting → Capturing
   - Assert: VCE.processSelection called with correct handle and target

4. **ProcessingFailed → error displayed and state rolled back**
   - Studio in Capturing state
   - Mock ProcessingFailed event
   - Assert: Studio transitions Capturing → Ready
   - Assert: DisplayError added to StudioState.errors

5. **BrowserDisconnected → clears selection and updates UI**
   - Studio in Selecting state with active selection
   - Mock BrowserDisconnected event
   - Assert: browserConnected = false
   - Assert: isSelecting = false
   - Assert: currentSelection cleared
   - Assert: Studio transitions Selecting → Ready

6. **All 5 panels render without errors**
   - Start Studio
   - Navigate to each panel in sequence
   - Assert: each panel renders within 100ms
   - Assert: no console errors during navigation

### Contract Tests

1. **StudioState schema validates**
   - Validate that StudioState Zod schema matches the TypeScript interface
   - Validate that all PanelId values are covered
   - Validate that DisplayError shape matches the interface definition

2. **ContextPacket schema compatibility**
   - Validate that Studio's packet display logic works with the canonical ContextPacket schema from SPEC-006
   - Test with a valid full packet, a minimal packet, and a packet with optional sections omitted

3. **EventBus event type registration**
   - Verify that every event type Studio subscribes to is registered with the Event Bus
   - Verify that event payload schemas match between Studio's expectations and the Event Bus event catalog

### End-to-End Tests

1. **Full workflow: open workspace → start selection → capture → display packet in Context Explorer**
   - Start Studio
   - Open workspace
   - Start selection mode
   - Simulate element click (SelectionChanged event with confirmed target)
   - Wait for ContextPacketGenerated event
   - Assert: packet rendered in Context Explorer panel
   - Assert: Capture History panel shows new entry

2. **Error flow: capture timeout → error displayed → retry**
   - Start capture
   - Simulate VCE timeout (no ContextPacketGenerated within 5s)
   - Assert: STU_CAPTURE_TIMEOUT error displayed
   - Click "Retry" → assert capture re-initiated

3. **Degraded mode: VCE disconnect → reconnect**
   - Start Studio in normal mode
   - Simulate VCE disconnection
   - Assert: Studio enters Degraded mode
   - Assert: Browser Session and Context Explorer show offline states
   - Simulate VCE reconnection
   - Assert: Studio transitions to Ready

4. **Panel navigation: all panels accessible via keyboard**
   - Start Studio
   - Use keyboard shortcuts to navigate to each panel
   - Assert: each panel becomes active with correct focus

5. **Export: capture packet → export to file**
   - After packet displayed in Context Explorer
   - Trigger export
   - Assert: file written to specified path
   - Assert: file contents match Context Packet JSON

---

## Acceptance Criteria

- [ ] Studio starts and displays Browser Session panel within 2s of process launch
- [ ] `startSelection()` initiates hover mode on injected overlay and sets `isSelecting` to true
- [ ] Selection Inspector updates live during hover within 50ms of each SelectionChanged event
- [ ] `confirmSelection()` triggers `VCE.processSelection()` call with correct BrowserHandle and SelectionTarget
- [ ] `displayPacket()` renders Context Packet in Context Explorer panel with all sections expandable
- [ ] Error panel displays ProcessingFailed events with recovery suggestions within 100ms
- [ ] Studio NEVER imports browser-runtime, mcp-server, or Playwright modules (verified by dependency analysis)
- [ ] Studio state is presentation only — business state fields (browserConnected, currentSelection, currentPacket) are set exclusively from Event Bus event handlers, never mutated by Studio-internal code
- [ ] All 5 panels render without errors (browser-session, context-explorer, selection-inspector, capture-history, diagnostics)
- [ ] Settings panel renders and preferences persist across restarts
- [ ] Panel switching completes in under 100ms
- [ ] Studio degrades when VCE is unavailable: shows offline indicators, provides reconnect option, Diagnostics and Settings panels remain functional
- [ ] Studio degrades when Event Bus is unavailable: automatic reconnection attempts, all panels show "Reconnecting..." state
- [ ] No code editing functionality exists (verified by feature audit: no text editor, no file tree, no syntax highlighting, no save-to-disk for code)
- [ ] Keyboard navigation: all panels reachable via keyboard shortcuts; focus order is logical; focus indicators visible
- [ ] Export validates destination path; rejects paths inside `.viskod/` directory
- [ ] All state transitions follow the documented state machine (Starting → Ready → Selecting → Capturing → Displaying, with Degraded entry/exit)
- [ ] Studio shutdown completes cleanly: no orphan processes, no locked files, preferences persisted
- [ ] Memory under load stays under 300 MB RSS with full packet displayed and all panels navigated

---

## Open Implementation Decisions

| Decision ID | Description | Status |
|-------------|-------------|--------|
| DEC-007 | Desktop shell technology: Electron vs Tauri vs native desktop framework | Open — documented in `specs/decisions/DEC-007.md` |
| DEC-008 | React state management library: Zustand vs Jotai vs Redux Toolkit for StudioState management | Open — to be determined during implementation |
| DEC-009 | UI component library: custom components vs Radix UI vs shadcn/ui vs Ant Design | Open — to be determined based on design system requirements |
| DEC-010 | IPC mechanism for Studio ↔ VCE communication: Electron IPC vs HTTP REST on localhost vs gRPC | Open — to be determined based on shell technology decision (DEC-007) |

---

## Implementation Sequence

1. **Studio shell scaffold**: Electron/Tauri app shell, main window, process lifecycle (start/shutdown)
2. **Event Bus integration**: Connect to Event Bus, subscribe to all platform events, establish health monitoring
3. **State management**: Implement StudioState store with immutable updates and state machine transitions
4. **Panel shell**: Sidebar navigation, panel switching, panel state preservation, keyboard shortcuts
5. **Browser Session panel**: URL display, viewport dimensions, browser health status, selection mode toggle
6. **Selection Inspector panel**: SelectionTarget display, hover preview, confirmed selection display
7. **Context Explorer panel**: Context Packet rendering with expandable sections, copy to clipboard, export
8. **Capture History panel**: Capture list rendering, selection, deletion
9. **Diagnostics panel**: Subsystem health display, error list, filtering, dismissal, console output
10. **Settings panel**: Theme toggle, viewport presets, preference persistence
11. **Workspace management**: Open/close workspace, workspace handle, recent workspaces
12. **Selection workflow**: startSelection → hover preview → confirmSelection → clearSelection
13. **Capture workflow**: requestCapture → progress display → displayPacket
14. **Error handling**: DisplayError creation, error boundaries, degraded mode entry/exit
15. **Performance optimisation**: Panel render memoisation, virtualised capture history, packet display lazy loading
16. **Integration tests**: Full end-to-end workflow verification
17. **Accessibility audit**: Keyboard navigation, screen reader compatibility, focus management

---

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Desktop shell technology choice (DEC-007) may change architecture assumptions late in implementation | Medium | Decision must be finalised before implementation begins; Studio API is shell-agnostic |
| Event Bus connection reliability on Windows (named pipes vs TCP) | Medium | Test Event Bus connection on all target platforms early in implementation; fallback to TCP on localhost |
| Large Context Packets may cause render performance issues (screenshots, large DOM trees) | Medium | Lazy loading of packet sections; screenshot thumbnail with full-size on expand; virtualised hierarchy tree rendering |
| Studio startup time may exceed 2s budget with Electron | Medium | Profile startup; defer non-critical initialisation (preferences load, recent workspaces); show skeleton UI immediately |
| Overlay hover events at 60 FPS may overwhelm Selection Inspector re-renders | Low | Debounce Selection Inspector updates to 30 FPS (33ms); use requestAnimationFrame batching |
| Settings panel may grow unbounded with future features | Low | Settings architecture designed for extensibility (key-value preference store); new preferences are additive |

---

## Definition of Done

- [ ] Specification reviewed by architecture owner
- [ ] All acceptance criteria verified
- [ ] All dependency specifications acknowledged by their owners
- [ ] SPEC-023 approved (status: Approved)
- [ ] Implementation complete per implementation sequence
- [ ] All unit tests pass (≥ 90% coverage on state machine and panel logic)
- [ ] All integration tests pass
- [ ] All contract tests pass
- [ ] All end-to-end tests pass
- [ ] Performance budgets verified (startup < 2s, panel switch < 100ms, packet display < 100ms)
- [ ] Dependency audit confirms no forbidden imports (browser-runtime, mcp-server, Playwright)
- [ ] Accessibility baseline verified (keyboard navigation, focus indicators, screen reader labels)
- [ ] Degraded mode tested with VCE and Event Bus disconnected
- [ ] Clean shutdown verified (no orphan processes, preferences persisted)
- [ ] Documentation updated (`docs/studio.md` reflects implementation)
- [ ] No known regressions introduced in dependent subsystems
