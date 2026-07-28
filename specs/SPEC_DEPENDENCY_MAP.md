# SPEC-### Implementation Dependency Map

> **Specification ID:** SPEC-DEPS
> **Version:** 1.0
> **Status:** Approved
> **Owner:** Architecture
> **Last Updated:** 2026-07-28

---

## Architecture Sources

```
* docs/architecture.md — dependency direction, runtime boundary, Event Bus rules
* docs/packages.md — package categories, allowed dependency flow
* docs/events.md — event-based communication model
* docs/visual-context-engine.md — VCE processing pipeline
* docs/browser-runtime.md — BR responsibilities and boundaries
* docs/studio.md — Studio as display layer
* docs/capture-pipeline.md — capture orchestration
* docs/project-scanner.md — repository understanding
* docs/selection-engine.md — selection resolution
* docs/source-hint-engine.md — probabilistic source mapping
* docs/mcp.md — MCP server interface
* docs/state-management.md — runtime state synchronisation
* docs/diagnostics.md — cross-cutting health subsystem
* docs/cli.md — command-line entry point
* docs/sdk.md — developer SDK
```

---

## Dependencies

None. This document defines the dependency graph for all other specifications.

---

## Consumers

Every specification in `/specs`.

---

## Purpose

This document defines the implementation dependency graph for all Viskod specifications. It records:
- which specification must exist before another can be implemented (`←` = depends on)
- the runtime command and event flows
- the critical implementation path
- parallelisable workstreams
- prohibited dependency violations
- the minimal vertical slice for first end-to-end viability

---

## Scope

All Phase 1 implementation specifications keyed by SPEC-### identifiers. Future specifications (Phase 2+) are noted but not sequenced.

---

## 1. Build Dependency Graph

```
                       SPEC-004  ←  SPEC-006
                  event-bus       diagnostics
                       ↑              ↑
                       │              │
SPEC-001  ←  SPEC-002  ←  SPEC-003  ←  SPEC-005  ←  SPEC-007  ←  SPEC-009
repo-       shared-       error-        config        browser-      selection-
layout      types         model                       runtime       engine
                                                       ↑
                                                       │
SPEC-007  ←  SPEC-010                             SPEC-007  ←  SPEC-012
browser-      capture-                             browser-      visual-
runtime       pipeline                             runtime       context-
                                                       ↑         engine
SPEC-002  ←  SPEC-008  ←  SPEC-011                     │           ↑
shared-       project-     source-                      │           │
types         scanner       hint-engine                 │           │
                                                         SPEC-002, SPEC-003, SPEC-004,
                                                         SPEC-005, SPEC-006, SPEC-007,
                                                         SPEC-008, SPEC-009, SPEC-010,
                                                         SPEC-011
                                                              ↑
                                                              │
SPEC-012  ←  SPEC-013          SPEC-012  ←  SPEC-014  ←  SPEC-015
visual-       mcp-server       visual-      studio-       studio-
context-                        context-     state         shell
engine                          engine

SPEC-005, SPEC-007, SPEC-008, SPEC-012, SPEC-013  ←  SPEC-016
                                                     cli
```

---

## 2. Runtime Command Flow Diagram

```text
Studio Shell (SPEC-015) ──calls──→ Studio State (SPEC-014)
Studio Shell (SPEC-015) ──calls──→ Visual Context Engine (SPEC-012)
     │
     │ (issues commands)
     ▼
Visual Context Engine (SPEC-012)
     │
     ├──calls──→ Browser Runtime (SPEC-007)
     │               │  navigate, setViewport, captureScreenshot,
     │               │  getDOMSnapshot, getComputedStyles, injectOverlay,
     │               │  getDiagnostics, close
     │               ▼
     │           Playwright
     │
     ├──calls──→ Capture Pipeline (SPEC-010)
     │               │  queueCapture, persistPacket, exportCapture
     │               ▼
     │           Filesystem
     │
     ├──calls──→ Project Scanner (SPEC-008)
     │               │  getProjectMetadata, getRoutes, getFrameworkInfo
     │               ▼
     │           Repository
     │
     ├──calls──→ Selection Engine (SPEC-009)
     │               │  resolveTarget, validateSelection, buildHierarchy
     │               │
     │
     └──calls──→ Source Hint Engine (SPEC-011)
                       │  generateHints, rankCandidates
                       │

CLI (SPEC-016) ──calls──→ Visual Context Engine (SPEC-012)
CLI (SPEC-016) ──calls──→ MCP Server (SPEC-013)
CLI (SPEC-016) ──calls──→ Project Scanner (SPEC-008)
CLI (SPEC-016) ──calls──→ Browser Runtime (SPEC-007)
CLI (SPEC-016) ──calls──→ Config (SPEC-005)

MCP Server (SPEC-013) ──calls──→ Visual Context Engine (SPEC-012)
MCP Server (SPEC-013) ──calls──→ Event Bus (SPEC-004) [subscribe]
```

---

## 3. Runtime Asynchronous Event Flow Diagram

```text
Browser Runtime (SPEC-007)
     │  publishes events
     │  · BrowserStarted
     │  · PageLoaded
     │  · NavigationCompleted
     │  · ViewportChanged
     │  · SelectionChanged
     │  · CaptureCompleted
     │  · BrowserDisconnected
     │  · DiagnosticsUpdated
     │
     ▼ ──events──→
Event Bus (SPEC-004)
     │  immutable transport, no business logic
     │
     ▼ ──subscription──→
     │
     ├──events──→ Visual Context Engine (SPEC-012)
     │               receives: BrowserStarted, PageLoaded, CaptureCompleted,
     │                         SelectionChanged, ViewportChanged, BrowserDisconnected
     │
     ├──events──→ Selection Engine (SPEC-009)
     │               receives: ViewportChanged
     │
     ├──events──→ Diagnostics (SPEC-006)
     │               receives: BrowserStarted, BrowserDisconnected,
     │                         CaptureCompleted, DiagnosticsUpdated
     │
     ├──events──→ Studio State (SPEC-014)
     │               receives: BrowserStarted, SelectionChanged,
     │                         ViewportChanged, CaptureCompleted,
     │                         BrowserDisconnected
     │
     ├──events──→ Capture Pipeline (SPEC-010)
     │               receives: CaptureCompleted
     │
     ├──events──→ MCP Server (SPEC-013)
     │               receives: CaptureCompleted, SelectionChanged
     │
     └──events──→ Project Scanner (SPEC-008)
                     receives: [none in Phase 1; scans on command]

Project Scanner (SPEC-008) ──events──→ Event Bus (SPEC-004)
     │  publishes: ProjectLoaded, ScannerDiagnostics
     │

Selection Engine (SPEC-009) ──events──→ Event Bus (SPEC-004)
     │  publishes: SelectionChanged
     │

Capture Pipeline (SPEC-010) ──events──→ Event Bus (SPEC-004)
     │  publishes: CaptureCompleted, CaptureFailed
     │

Visual Context Engine (SPEC-012) ──events──→ Event Bus (SPEC-004)
     │  publishes: ContextGenerated, ContextPacketReady
     │

Diagnostics (SPEC-006) ──events──→ Event Bus (SPEC-004)
     │  publishes: DiagnosticAlert
     │
```

---

## 4. Specification Dependency Table

| Specification | Depends On (must exist first) | Depended By (consumers) |
|---|---|---|
| **SPEC-001** repository-layout | (none) | SPEC-002 through SPEC-016 (all packages) |
| **SPEC-002** shared-types | SPEC-001 (optional, structure only) | SPEC-003, SPEC-004, SPEC-005, SPEC-006, SPEC-007, SPEC-008, SPEC-009, SPEC-010, SPEC-011, SPEC-012, SPEC-013, SPEC-014, SPEC-015, SPEC-016 |
| **SPEC-003** error-model | SPEC-002 | SPEC-004, SPEC-005, SPEC-006, SPEC-007, SPEC-008, SPEC-009, SPEC-010, SPEC-011, SPEC-012, SPEC-013, SPEC-014, SPEC-016 |
| **SPEC-004** event-bus | SPEC-002, SPEC-003 | SPEC-006, SPEC-007, SPEC-008, SPEC-009, SPEC-010, SPEC-011, SPEC-012, SPEC-013, SPEC-014, SPEC-016 |
| **SPEC-005** config | SPEC-002, SPEC-003 | SPEC-007, SPEC-008, SPEC-012, SPEC-016 |
| **SPEC-006** diagnostics | SPEC-002, SPEC-003, SPEC-004 | SPEC-007, SPEC-012 |
| **SPEC-007** browser-runtime | SPEC-002, SPEC-003, SPEC-004, SPEC-005, SPEC-006 | SPEC-009, SPEC-010, SPEC-012, SPEC-016 |
| **SPEC-008** project-scanner | SPEC-002, SPEC-003, SPEC-004, SPEC-005 | SPEC-011, SPEC-012, SPEC-016 |
| **SPEC-009** selection-engine | SPEC-002, SPEC-003, SPEC-004, SPEC-007 | SPEC-012 |
| **SPEC-010** capture-pipeline | SPEC-002, SPEC-003, SPEC-004, SPEC-007 | SPEC-012 |
| **SPEC-011** source-hint-engine | SPEC-002, SPEC-008 | SPEC-012 |
| **SPEC-012** visual-context-engine | SPEC-002, SPEC-003, SPEC-004, SPEC-005, SPEC-006, SPEC-007, SPEC-008, SPEC-009, SPEC-010, SPEC-011 | SPEC-013, SPEC-014, SPEC-015, SPEC-016 |
| **SPEC-013** mcp-server | SPEC-002, SPEC-003, SPEC-004, SPEC-012 | SPEC-016 |
| **SPEC-014** studio-state | SPEC-002, SPEC-003, SPEC-004, SPEC-012 | SPEC-015 |
| **SPEC-015** studio-shell | SPEC-012, SPEC-014 | (endpoint; consumed by developer) |
| **SPEC-016** cli | SPEC-002, SPEC-003, SPEC-005, SPEC-007, SPEC-008, SPEC-012, SPEC-013 | (endpoint; consumed by developer/CI) |

---

## 5. Critical Path

The longest chain from bootstrap to end-to-end functionality:

```
SPEC-001 (repository-layout)
  → SPEC-002 (shared-types)
    → SPEC-003 (error-model)
      → SPEC-004 (event-bus)
        → SPEC-006 (diagnostics)
          → SPEC-007 (browser-runtime)
            → SPEC-009 (selection-engine)
              → SPEC-012 (visual-context-engine)
                → SPEC-013 (mcp-server)
                  → SPEC-014 (studio-state)
                    → SPEC-015 (studio-shell)
```

**10 specification hops** from repository structure to a running Studio displaying a captured context packet. Items not on this path (SPEC-005 config, SPEC-008 project-scanner, SPEC-010 capture-pipeline, SPEC-011 source-hint-engine, SPEC-016 cli) can be parallelised or deferred without blocking the critical chain.

---

## 6. Parallelisable Workstreams

### Foundation Layer (must complete first)

**Workstream F1:** SPEC-001 (repository-layout), SPEC-002 (shared-types)
**Workstream F2:** SPEC-003 (error-model) — starts after SPEC-002

### Infrastructure Layer (parallel after Foundation)

**Workstream I1:** SPEC-004 (event-bus), SPEC-005 (config), SPEC-006 (diagnostics)
*All three depend on SPEC-002, SPEC-003; no cross-dependency between I1 items except SPEC-006 → SPEC-004*

### Platform Layer (parallel after Infrastructure)

**Workstream A:** [SPEC-007 browser-runtime, SPEC-009 selection-engine, SPEC-010 capture-pipeline]
*SPEC-009 depends on SPEC-007; SPEC-010 depends on SPEC-007; both can proceed once SPEC-007 is done*

**Workstream B:** [SPEC-008 project-scanner, SPEC-011 source-hint-engine]
*SPEC-011 depends on SPEC-008*

### Integration Layer (parallel after Platform)

**Workstream C:** [SPEC-013 mcp-server]
*Depends on SPEC-012*

**Workstream D:** [SPEC-014 studio-state, SPEC-015 studio-shell]
*SPEC-015 depends on SPEC-014; both depend on SPEC-012*

**Workstream E:** [SPEC-016 cli]
*Depends on SPEC-005, SPEC-007, SPEC-008, SPEC-012, SPEC-013; can be developed last*

---

## 7. Circular Dependency Validation

**Result: No cycles detected.**

Every dependency arrow points from a higher-layer specification (consumer) to a lower-layer specification (dependency). The graph is a strict DAG. The architecture enforces this through four rules:

1. Dependencies always point inward/downward: `Application → Platform → Core → Shared`
2. Reverse communication from Browser Runtime to VCE goes exclusively through the Event Bus (SPEC-004), never through direct imports
3. Browser Runtime never imports Visual Context Engine
4. Visual Context Engine never receives direct callbacks from Browser Runtime

---

## 8. Prohibited Dependencies

| Dependency | Prohibition | Architecture Source |
|---|---|---|
| SPEC-007 (browser-runtime) depends on SPEC-012 (visual-context-engine) | BR never calls VCE directly | docs/architecture.md §Runtime Boundary |
| SPEC-009 (selection-engine) depends on SPEC-013 (mcp-server) | Selection Engine has no MCP responsibility | docs/architecture.md §Package Responsibilities |
| SPEC-008 (project-scanner) depends on SPEC-007 (browser-runtime) | Project Scanner does not inspect the browser | docs/architecture.md §Package Responsibilities |
| SPEC-010 (capture-pipeline) depends on SPEC-008 (project-scanner) | Capture Pipeline has no repository knowledge | docs/architecture.md §Package Responsibilities |
| SPEC-012 (visual-context-engine) receives direct callbacks from SPEC-007 (browser-runtime) | Must go through Event Bus (SPEC-004) | docs/architecture.md §Runtime Boundary |
| SPEC-013 (mcp-server) depends on SPEC-007 (browser-runtime) | MCP Server must not manipulate browser internals | docs/architecture.md §MCP Server |
| SPEC-015 (studio-shell) depends on SPEC-007 (browser-runtime) | Studio must not implement browser automation | docs/architecture.md §Package Responsibilities |
| SPEC-007 (browser-runtime) depends on SPEC-010 (capture-pipeline) | BR has no persistence responsibility; VCE handles | docs/architecture.md §Runtime Boundary |
| SPEC-007 (browser-runtime) depends on SPEC-013 (mcp-server) | BR must not expose MCP | docs/architecture.md §Package Responsibilities |
| SPEC-007 (browser-runtime) depends on SPEC-011 (source-hint-engine) | BR must not generate source hints | docs/architecture.md §Package Responsibilities |
| Any SPEC depends on a non-existent SPEC | Unknown dependency invalidates ordering | specs/SPEC_TEMPLATE.md §Dependencies |

---

## 9. Bootstrap Order

The exact sequence to write specifications for the full Phase 1 system:

```
 1. SPEC-001 (repository-layout)        — 0 deps; defines monorepo structure, package boundaries
 2. SPEC-002 (shared-types)             — 0 logical deps; canonical types, Zod schemas, contracts
 3. SPEC-003 (error-model)              — deps: SPEC-002; structured error codes, categories, recovery
 4. SPEC-004 (event-bus)                — deps: SPEC-002, SPEC-003; typed publish/subscribe infrastructure
 5. SPEC-005 (config)                   — deps: SPEC-002, SPEC-003; configuration schema, precedence, defaults
 6. SPEC-006 (diagnostics)              — deps: SPEC-002, SPEC-003, SPEC-004; cross-cutting health subsystem
 7. SPEC-007 (browser-runtime)          — deps: SPEC-002, SPEC-003, SPEC-004, SPEC-005, SPEC-006; Playwright wrapper
 8. SPEC-008 (project-scanner)          — deps: SPEC-002, SPEC-003, SPEC-004, SPEC-005; repository analysis
 9. SPEC-009 (selection-engine)         — deps: SPEC-002, SPEC-003, SPEC-004, SPEC-007; element resolution
10. SPEC-010 (capture-pipeline)         — deps: SPEC-002, SPEC-003, SPEC-004, SPEC-007; capture persistence
11. SPEC-011 (source-hint-engine)       — deps: SPEC-002, SPEC-008; probabilistic source mapping
12. SPEC-012 (visual-context-engine)    — deps: SPEC-002–011 (all preceding); context packet assembly
13. SPEC-013 (mcp-server)               — deps: SPEC-002, SPEC-003, SPEC-004, SPEC-012; MCP protocol exposure
14. SPEC-014 (studio-state)             — deps: SPEC-002, SPEC-003, SPEC-004, SPEC-012; UI state management
15. SPEC-015 (studio-shell)             — deps: SPEC-012, SPEC-014; desktop application shell
16. SPEC-016 (cli)                      — deps: SPEC-002, SPEC-003, SPEC-005, SPEC-007, SPEC-008, SPEC-012, SPEC-013; CLI entry
```

Items sharing the same dependency set may be authored in parallel (see §6 Parallelisable Workstreams).

---

## 10. First Vertical Slice

### Minimal Vertical Slice

The smallest set of specifications needed for an end-to-end working demo:
**select an element → capture → display context in a visible UI.**

| SPEC | Name | Rationale |
|---|---|---|
| SPEC-001 | repository-layout | Every package needs a canonical location. Without this, source files have no defined home. |
| SPEC-002 | shared-types | All cross-package contracts (ViewportState, SelectionSnapshot, ContextPacket, DiagnosticRecord) must exist before any package can be implemented. |
| SPEC-003 | error-model | Every component must produce structured, traceable errors. The error categories (BrowserError, CaptureError, ValidationError) are foundational. |
| SPEC-004 | event-bus | The runtime boundary requires Browser Runtime events to reach VCE exclusively through the Event Bus. No event bus means no async communication. |
| SPEC-005 | config | Browser Runtime and VCE both need configuration (viewport presets, browser launch flags, capture timeouts). Without config, there are no operational parameters. |
| SPEC-006 | diagnostics | All subsystems must report health. Without diagnostics, failures during the demo are opaque. |
| SPEC-007 | browser-runtime | The browser is the source of visual truth. Without BR, there is no browser, no DOM, no screenshots, no overlay. |
| SPEC-009 | selection-engine | The user must be able to click an element and have it resolved into a stable, validated selection. Without this, there is no "selected element." |
| SPEC-010 | capture-pipeline | Captured data must be persisted (screenshots, metadata). Without persistence, captures are ephemeral and cannot be reviewed. |
| SPEC-012 | visual-context-engine | The core engine that assembles browser evidence into a Context Packet. Without VCE, raw browser data has no structured form. |
| SPEC-014 | studio-state | The Studio UI needs synchronised state from the platform via the Event Bus. Without studio-state, the UI has no data to render. |
| SPEC-015 | studio-shell | The visible desktop interface. Without studio-shell, there is nothing for the developer to see or interact with. |

**Excluded from Minimal Vertical Slice (deferred to later slices):**

| SPEC | Name | Why Deferred |
|---|---|---|
| SPEC-008 | project-scanner | Not needed for visual inspection alone. The demo works without framework detection or route discovery. |
| SPEC-011 | source-hint-engine | Requires project-scanner. Source hints are a probabilistic enhancement, not a prerequisite for capture and display. |
| SPEC-013 | mcp-server | MCP is AI-facing. A human-only demo (select → capture → display in Studio) works without exposing context to external agents. |
| SPEC-016 | cli | CLI is automation-facing. The GUI demo works without a CLI entry point. |

**End-to-end flow for the Minimal Vertical Slice:**

```text
Developer opens Studio (SPEC-015)
  → Studio State (SPEC-014) initialises
  → Visual Context Engine (SPEC-012) starts
    → Browser Runtime (SPEC-007) launches browser
      → BR publishes BrowserStarted ──events──→ Event Bus (SPEC-004)
        → VCE receives BrowserStarted via subscription
      → Developer navigates to their application URL
        → BR publishes PageLoaded ──events──→ Event Bus
    → Developer clicks an element in the browser overlay
      → BR captures pointer event
      → Selection Engine (SPEC-009) resolves target
        → SE publishes SelectionChanged ──events──→ Event Bus
          → VCE receives SelectionChanged
          → VCE ──calls──→ BR.getDOMSnapshot()
          → VCE ──calls──→ BR.getComputedStyles()
          → VCE ──calls──→ BR.captureScreenshot()
    → VCE assembles Context Packet
    → VCE ──calls──→ Capture Pipeline (SPEC-010).persistPacket()
      → CP publishes CaptureCompleted ──events──→ Event Bus
        → Studio State receives CaptureCompleted
        → Studio Shell displays the Context Packet
```

---

## 11. Specification-to-Package Mapping

For cross-reference with `docs/packages.md`:

| SPEC | Specification | Package Path |
|---|---|---|
| SPEC-001 | repository-layout | (monorepo root structure) |
| SPEC-002 | shared-types | `packages/shared/` |
| SPEC-003 | error-model | `packages/shared/` (errors module) |
| SPEC-004 | event-bus | `packages/event-bus/` |
| SPEC-005 | config | `packages/config/` |
| SPEC-006 | diagnostics | `packages/diagnostics/` |
| SPEC-007 | browser-runtime | `packages/browser-runtime/` |
| SPEC-008 | project-scanner | `packages/project-scanner/` |
| SPEC-009 | selection-engine | `packages/selection-engine/` |
| SPEC-010 | capture-pipeline | `packages/capture-pipeline/` |
| SPEC-011 | source-hint-engine | `packages/source-hint-engine/` |
| SPEC-012 | visual-context-engine | `packages/context-engine/` |
| SPEC-013 | mcp-server | `packages/mcp-server/` |
| SPEC-014 | studio-state | `apps/studio/` (state module) |
| SPEC-015 | studio-shell | `apps/studio/` (shell module) |
| SPEC-016 | cli | `packages/cli/` |

---

## 12. Dependency Category Matrix

Organised by architectural layer (Application → Platform → Core → Shared):

```
APPLICATION LAYER
  SPEC-015 (studio-shell)      ← SPEC-014, SPEC-012
  SPEC-014 (studio-state)      ← SPEC-012, SPEC-004
  SPEC-016 (cli)               ← SPEC-012, SPEC-013, SPEC-007, SPEC-008, SPEC-005
  SPEC-013 (mcp-server)        ← SPEC-012, SPEC-004

PLATFORM LAYER
  SPEC-012 (visual-context-engine) ← SPEC-007, SPEC-008, SPEC-009, SPEC-010, SPEC-011, SPEC-004, SPEC-005, SPEC-006
  SPEC-007 (browser-runtime)       ← SPEC-004, SPEC-005, SPEC-006
  SPEC-008 (project-scanner)       ← SPEC-004, SPEC-005
  SPEC-009 (selection-engine)      ← SPEC-007, SPEC-004
  SPEC-010 (capture-pipeline)      ← SPEC-007, SPEC-004
  SPEC-011 (source-hint-engine)    ← SPEC-008

CORE LAYER
  SPEC-004 (event-bus)          ← SPEC-003, SPEC-002
  SPEC-005 (config)             ← SPEC-003, SPEC-002
  SPEC-006 (diagnostics)        ← SPEC-004, SPEC-003, SPEC-002

SHARED LAYER
  SPEC-002 (shared-types)       ← (none)
  SPEC-003 (error-model)        ← SPEC-002
  SPEC-001 (repository-layout)  ← (none)
```

No upward-pointing arrows exist. Architecture guarantees this.

---

## Version History

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2026-07-28 | Initial dependency graph, critical path, minimal vertical slice |
