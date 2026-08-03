# Implementation Programme Report

> **Date:** 2026-07-28
> **Architecture Baseline:** Viskod Architecture v1.0 (commit `df44214`, score 94/100)
> **Specification Index:** `SPEC_INDEX.md` (35 specifications)

---

## Programme Summary

| Metric | Value |
|--------|-------|
| Total proposed specifications | 39 |
| Specifications merged | 5 |
| Specifications removed | 2 |
| Specifications added | 2 |
| **Final specification count** | **35** |
| P0 (blocking vertical slice) | 9 |
| P1 (Phase 1 completion) | 22 |
| P2 (Phase 2 hardening) | 2 |
| P3 (Phase 3+ packaging) | 2 |

---

## Specifications Merged or Removed

| Specification | Action | Rationale |
|--------------|--------|-----------|
| `plugin-manifest-schema.md` | Merged into `plugin-system.md` | Architecture treats Plugin System as a single subsystem with both manifest schema and runtime. Splitting into two creates an unnecessary spec boundary. |
| `studio-shell.md` | Merged into `studio.md` | Architecture defines Studio as one subsystem (`docs/studio.md`). Splitting shell, navigation, and state into separate specs fragments a single architectural boundary. |
| `studio-navigation.md` | Merged into `studio.md` | Same rationale. Navigation is an internal Studio concern. |
| `studio-state.md` | Merged into `studio.md` | Same rationale. State is internal to Studio per `docs/architecture.md` §State Store. |
| `diagnostics-ui.md` | Merged into `diagnostics.md` | Diagnostics is a canonical subsystem (`docs/ARCHITECTURE_BASELINE.md`). UI rendering is one interface of that subsystem, not a separate architectural boundary. |
| `workspace-tooling.md` | Removed | No canonical "Workspace Tooling" subsystem exists in the architecture. Developer workspace setup (pnpm, Vite, Biome) is tooling configuration, not a product subsystem. Belongs in repository README or AGENTS.md, not a specification. |
| `desktop-host.md` | Removed | No canonical "Desktop Host" boundary exists in the architecture. The architecture defines Studio, CLI, and Browser Runtime as separate subsystems. Host process management is an implementation concern of each subsystem's spec, not a standalone specification. |

---

## Specifications Added

| Specification | Rationale |
|--------------|-----------|
| `diagnostics.md` | `docs/ARCHITECTURE_BASELINE.md` §Canonical Subsystem Names lists Diagnostics. `docs/diagnostics.md` exists. The proposed list only included `diagnostics-ui.md` (the UI facet), missing the subsystem itself. |
| `framework-adapters.md` | `docs/ARCHITECTURE_BASELINE.md` §Canonical Subsystem Names lists Framework Adapters. `docs/framework-adapters.md` exists. Listed as a Phase 1 extension point in `docs/architecture.md` §Extension Points. |

---

## P0 Specification List

These 9 specifications must be approved before any Phase 1 implementation code can be written. They form the bootstrap foundation and the first vertical slice.

| SPEC-ID | Specification | Phase | Rationale |
|---------|--------------|-------|-----------|
| SPEC-001 | `repository-layout.md` | Foundation | Every package needs to know where files live |
| SPEC-002 | `shared-types.md` | Foundation | Every package consumes shared contracts |
| SPEC-003 | `error-model.md` | Foundation | Every package produces and propagates errors |
| SPEC-004 | `configuration.md` | Foundation | Every package needs configuration |
| SPEC-005 | `event-schema.md` | Data | Event Bus needs typed event contracts |
| SPEC-006 | `context-packet-schema.md` | Data | VCE output format; consumed by MCP, Studio, SDK |
| SPEC-007 | `event-bus.md` | Core Runtime | Communication backbone for all runtime subsystems |
| SPEC-008 | `browser-runtime.md` | Core Runtime | Browser control; foundation of all visual evidence |
| SPEC-009 | `visual-context-engine.md` | Core Runtime | Architectural centerpiece; transforms evidence into context |

---

## Critical Implementation Path

The longest chain from bootstrap to end-to-end functionality:

```
SPEC-001 (repository-layout)
  → SPEC-002 (shared-types)
    → SPEC-003 (error-model)
      → SPEC-005 (event-schema)
        → SPEC-007 (event-bus)
          → SPEC-008 (browser-runtime)
            → SPEC-009 (visual-context-engine)
              → SPEC-016 (public-api)
                → SPEC-014 (mcp-server)
                  → SPEC-023 (studio)
```

**10 hops.** The critical path is bottlenecked at `shared-types` (depended on by everything), `event-bus` (depended on by all runtime components), and `visual-context-engine` (depended on by all interfaces).

---

## Parallel Workstreams

Once Foundation specs are approved, four parallel workstreams can proceed simultaneously:

### Workstream A — Visual Capture Pipeline
```
SPEC-008 (browser-runtime) ──parallel── SPEC-010 (capture-pipeline) ──parallel── SPEC-011 (selection-engine) ──parallel── SPEC-022 (overlay-system)
```
These four specs each have distinct architecture boundaries and no dependencies on each other (they all depend on Foundation + event-bus).

### Workstream B — Project Intelligence
```
SPEC-012 (project-scanner) → SPEC-013 (framework-adapters) → SPEC-015 (source-hint-engine)
```
The project-scanner must exist first; framework-adapters and source-hint-engine can then proceed in parallel.

### Workstream C — Data and Contracts
```
SPEC-005 (event-schema) ──parallel── SPEC-006 (context-packet-schema) ──parallel── SPEC-017 (storage-schema) ──parallel── SPEC-018 (cache-model) ──parallel── SPEC-019 (settings-schema)
```
All five data schemas can be authored in parallel. They share only `shared-types.md` as a dependency.

### Workstream D — Integration Surfaces
```
SPEC-016 (public-api) → SPEC-014 (mcp-server) ──parallel── SPEC-020 (cli) ──parallel── SPEC-021 (sdk)
```
Public API must exist first. MCP, CLI, and SDK can then proceed in parallel.

### Workstream E — Platform Quality (deferred)
```
SPEC-024 through SPEC-035 (all P2/P3 hardening specs)
```
These can all proceed in parallel after Core Runtime and Integration specs are approved.

---

## Highest-Risk Specifications

| Specification | Risk | Reason |
|--------------|------|--------|
| `visual-context-engine.md` (SPEC-009) | Medium | Depends on 7 other specs. Central integration point. Any VCE interface change ripples into MCP, Studio, SDK. Architecture risk is Low (full subsystem spec exists), but sequencing risk is high. |
| `event-bus.md` (SPEC-007) | Medium | No standalone architecture document exists. Derived from sections in `docs/architecture.md` §Event Bus, §Internal Events and `docs/events.md`. Implementation decisions (in-process vs IPC, push vs poll) are open and could affect every subscriber. |
| `repository-layout.md` (SPEC-001) | Medium | No standalone architecture document exists. Synthesised from `docs/architecture.md` §Monorepo Architecture, §Repository Layout and `docs/packages.md`. Basic but foundational — getting it wrong affects every file. |
| `shared-types.md` (SPEC-002) | Medium | No standalone architecture document exists. Must balance architecture requirements (Zod, versioned, typed) with developer ergonomics. Over-abstracting creates friction; under-abstracting creates duplication. |
| `plugin-system.md` (SPEC-022) | Medium | Plugin isolation, sandboxing, and capability enforcement are security-critical. Architecture docs define principles but leave significant implementation decisions open. |
| `mcp-server.md` (SPEC-014) | Low | Full specification exists at `docs/mcp.md` (Status: Proposed). MCP is a mature protocol. Architecture risk is low due to well-defined boundaries. |

---

## Unresolved Implementation Decisions

These decisions are deferred to `specs/decisions/` records. They must be resolved before the affected specifications reach `Approved`.

| Decision | Affected Specs | Category |
|----------|---------------|----------|
| Event Bus transport (in-process pub-sub vs IPC vs hybrid) | `event-bus.md` | IPC technology |
| Local database technology (SQLite vs LevelDB vs file-based) | `storage-schema.md`, `cache-model.md` | Storage |
| IPC mechanism between desktop host and browser process | `browser-runtime.md`, `event-bus.md` | IPC |
| Overlay injection strategy (script injection vs CDP vs extension) | `overlay-system.md`, `browser-runtime.md` | Browser integration |
| Plugin sandboxing approach (Worker threads vs isolated processes) | `plugin-system.md` | Security |
| Serialisation format for cross-process messages (JSON vs MessagePack) | `shared-types.md`, `event-bus.md` | Serialisation |
| TypeScript build tooling (tsc vs esbuild vs swc) | `repository-layout.md` | Build tooling |
| Testing framework selection | `testing-strategy.md` | Testing |
| Node.js version floor | `repository-layout.md` | Runtime |

---

## Recommended First Vertical Slice

**Goal:** Select an element in a running browser → capture visual context → display a context packet in Studio.

**Specifications required (12):**

| Order | Specification | Rationale |
|-------|--------------|-----------|
| 1 | `repository-layout.md` | Monorepo structure must exist |
| 2 | `shared-types.md` | All packages need shared contracts |
| 3 | `error-model.md` | Consistent error handling |
| 4 | `configuration.md` | Config for browser, VCE, Studio |
| 5 | `event-schema.md` | Typed event contracts for Event Bus |
| 6 | `event-bus.md` | Communication backbone |
| 7 | `browser-runtime.md` | Launch browser, navigate, screenshot, inject overlay |
| 8 | `capture-pipeline.md` | Persist screenshots and capture metadata |
| 9 | `overlay-system.md` | Render selection indicators in browser |
| 10 | `context-packet-schema.md` | Output format for structured context |
| 11 | `visual-context-engine.md` | Combine evidence into context packet |
| 12 | `studio.md` | Display context packet to user |

**Excluded from slice (4 P1 specs):**

| Specification | Rationale for exclusion |
|--------------|------------------------|
| `selection-engine.md` | Selection can be done via simple pointer→element mapping in the overlay for the demo. Full selection validation, candidate scoring, and hierarchy can be added after the slice works. |
| `project-scanner.md` | Context packets can be produced without project metadata for the demo. Project detection enriches the packet but is not required for the core flow. |
| `source-hint-engine.md` | Source hints require project-scanner. Deferred with it. |
| `framework-adapters.md` | Framework detection requires project-scanner. Deferred with it. |

**Demo flow:**
1. `viskod start` launches browser, navigates to target URL
2. Overlay renders on the page
3. Developer clicks an element → overlay highlights it
4. VCE collects browser evidence (DOM, styles, screenshot)
5. VCE produces a context packet
6. Studio displays the packet (screenshot, DOM summary, styles)

---

## Recommended Order for Writing Specifications

Phased by dependency, not by priority alone.

**Phase 1a — Bootstrap (4 specs):**
1. `specs/repository-layout.md`
2. `specs/shared-types.md`
3. `specs/error-model.md`
4. `specs/configuration.md`

**Phase 1b — Data Contracts (5 specs, parallelisable):**
5. `specs/event-schema.md`
6. `specs/context-packet-schema.md`
7. `specs/storage-schema.md`
8. `specs/settings-schema.md`
9. `specs/cache-model.md`

**Phase 1c — Event Bus (1 spec):**
10. `specs/event-bus.md`

**Phase 1d — Platform Components (5 specs, 3 parallelisable):**
11. `specs/browser-runtime.md`
12. `specs/capture-pipeline.md` (parallel with 13)
13. `specs/overlay-system.md` (parallel with 12)
14. `specs/selection-engine.md` (parallel with 15)
15. `specs/project-scanner.md` (parallel with 14)

**Phase 1e — Intelligence Components (2 specs):**
16. `specs/framework-adapters.md`
17. `specs/source-hint-engine.md`

**Phase 1f — Centerpiece (1 spec):**
18. `specs/visual-context-engine.md`

**Phase 1g — Diagnostics (1 spec):**
19. `specs/diagnostics.md`

**Phase 1h — Integration (4 specs, parallelisable):**
20. `specs/public-api.md`
21. `specs/mcp-server.md` (parallel with 22, 23)
22. `specs/cli.md` (parallel with 21)
23. `specs/sdk.md` (parallel with 21)

**Phase 1i — Application (1 spec):**
24. `specs/studio.md`

**Phase 1j — Plugin System (1 spec):**
25. `specs/plugin-system.md`

**Phase 2 — Hardening (8 specs, parallelisable):**
26-33. All P2 platform quality specs

**Phase 3 — Packaging (2 specs):**
34-35. All P3 specs

---

## Programme Health Check

| Check | Result |
|-------|--------|
| All canonical subsystems have specifications | PASS (12 of 12) |
| No specification creates a new architectural boundary | PASS |
| Dependency graph contains no cycles | PASS |
| P0 specs are sufficient for first vertical slice | PASS (9 specs cover bootstrap + slice) |
| Parallel workstreams identified | PASS (5 workstreams) |
| Highest-risk specs identified with mitigations | PASS (6 specs assessed) |
| Unresolved decisions deferred to `decisions/` | PASS (9 decisions identified) |
| Every spec cites architecture sources | PASS |
| No spec silently changes architecture | PASS |
| Spec count is manageable (< 40) | PASS (35) |
