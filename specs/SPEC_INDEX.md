# Specification Index

> Canonical inventory of all Viskod implementation specifications
> Architecture Baseline: Viskod Architecture v1.0 (94/100)
> Last Updated: 2026-07-28

## Summary

| Metric | Count |
|--------|-------|
| Total specifications | 35 |
| P0 (blocking vertical slice) | 9 |
| P1 (Phase 1 completion) | 22 |
| P2 (Phase 2 hardening) | 2 |
| P3 (Phase 3+ packaging) | 2 |

---

## Foundation

Specifications that define the repository structure, shared contracts, and cross-cutting patterns. Every other specification depends on these.

| Specification | Architecture Sources | Purpose | Dependencies | Consumers | Priority | Phase | Status | Architecture Risk | Notes |
|--------------|---------------------|---------|-------------|-----------|----------|-------|--------|-------------------|-------|
| `repository-layout.md` | `docs/architecture.md` §Monorepo Architecture, §Repository Layout; `docs/packages.md` | Defines monorepo structure, package categories, naming conventions, and dependency direction rules | None | All other specs | P0 | Foundation | Draft | Medium | No standalone `/docs` file; synthesised from architecture.md + packages.md |
| `shared-types.md` | `docs/architecture.md` §packages/shared, §Schema Strategy; `docs/glossary.md` | Defines the `@viskod/shared` package: base types, Zod schemas, constants, and cross-package contracts | `repository-layout.md` | All specs consuming shared contracts | P0 | Foundation | Draft | Medium | No standalone `/docs` file; derived from architecture §packages/shared |
| `error-model.md` | `docs/architecture.md` §Error Boundaries, §Error Handling; `docs/error-handling.md`; `docs/design-principles.md` | Defines structured error codes, categories, messages, recovery suggestions, and error propagation rules | `shared-types.md` | All runtime specs | P0 | Foundation | Draft | Medium | `docs/error-handling.md` is high-level; needs concrete code/type definitions |
| `configuration.md` | `docs/architecture.md` §Configuration; `docs/settings.md` | Defines configuration precedence (CLI flags > project config > env vars > defaults), config file format, and validation | `shared-types.md` | `cli.md`, `browser-runtime.md`, `project-scanner.md`, all runtime specs | P0 | Foundation | Draft | Medium | `docs/settings.md` covers persisted settings; this spec covers the full config system |

---

## Core Runtime

Specifications for the twelve canonical subsystems and the integration boundary that connect them at runtime.

| Specification | Architecture Sources | Purpose | Dependencies | Consumers | Priority | Phase | Status | Architecture Risk | Notes |
|--------------|---------------------|---------|-------------|-----------|----------|-------|--------|-------------------|-------|
| `visual-context-engine.md` | `docs/visual-context-engine.md`; `docs/architecture.md` §Visual Context Engine, §Packet Assembly, §Capture Pipeline; `docs/ARCHITECTURE_BASELINE.md` §Canonical Subsystem Names | Central intelligence that combines browser evidence, project evidence, diagnostics, and screenshots into validated context packets | `shared-types.md`, `error-model.md`, `event-bus.md`, `context-packet-schema.md`, `browser-runtime.md`, `capture-pipeline.md`, `project-scanner.md` | `mcp-server.md`, `studio.md`, `sdk.md` | P0 | Core Runtime | Draft | Low | Full subsystem spec at `docs/visual-context-engine.md`; VCE is the architectural centerpiece |
| `browser-runtime.md` | `docs/browser-runtime.md`; `docs/architecture.md` §Browser Runtime, §Browser Lifecycle, §Runtime Boundary; `docs/ARCHITECTURE_BASELINE.md` §Runtime Boundaries | Controls Chromium via Playwright: launch, navigation, viewport, screenshot capture, overlay injection, page diagnostics | `shared-types.md`, `error-model.md`, `configuration.md` | `visual-context-engine.md`, `event-bus.md` (as event publisher), `overlay-system.md` | P0 | Core Runtime | Draft | Low | Full subsystem spec at `docs/browser-runtime.md`; must never call VCE directly |
| `event-bus.md` | `docs/architecture.md` §Internal Events, §Event Bus, §Runtime Boundary, §Dependency Rules; `docs/events.md`; `docs/ARCHITECTURE_BASELINE.md` §Asynchronous Event Flow, §Prohibited Dependencies | Integration boundary that transports immutable events between subsystems; owns transport/delivery, never business logic | `shared-types.md`, `error-model.md`, `event-schema.md` | `visual-context-engine.md`, `selection-engine.md`, `diagnostics.md`, `plugin-system.md`, `studio.md` | P0 | Core Runtime | Draft | Medium | Derived from architecture sections + `docs/events.md`; no standalone `docs/event-bus.md` |
| `capture-pipeline.md` | `docs/capture-pipeline.md`; `docs/architecture.md` §Capture Pipeline; `docs/ARCHITECTURE_BASELINE.md` §Runtime Boundaries | Persists and manages captures: screenshot storage, metadata, retention, cleanup, export | `shared-types.md`, `error-model.md`, `storage-schema.md` | `visual-context-engine.md` | P1 | Core Runtime | Draft | Low | Full subsystem spec at `docs/capture-pipeline.md`; no browser logic, no analysis |
| `selection-engine.md` | `docs/selection-engine.md`; `docs/architecture.md` §Selection Engine, §Selection Validation, §Selection Levels; `docs/ARCHITECTURE_BASELINE.md` §Runtime Boundaries | Converts pointer events into structured selections: candidate validation, state management, selection targets | `shared-types.md`, `error-model.md`, `browser-runtime.md`, `event-bus.md`, `overlay-system.md` | `studio.md`, `visual-context-engine.md` | P1 | Core Runtime | Draft | Low | Full subsystem spec at `docs/selection-engine.md`; communicates via Event Bus |
| `project-scanner.md` | `docs/project-scanner.md`; `docs/architecture.md` §Project Scanner; `docs/ARCHITECTURE_BASELINE.md` §Runtime Boundaries | Understands the repository: framework detection, package manager, routes, configuration, project metadata | `shared-types.md`, `error-model.md`, `configuration.md` | `visual-context-engine.md`, `source-hint-engine.md`, `framework-adapters.md` | P1 | Core Runtime | Draft | Low | Full subsystem spec at `docs/project-scanner.md`; never inspects the browser |
| `source-hint-engine.md` | `docs/source-hint-engine.md`; `docs/architecture.md` §Source Hint Engine, §Confidence Model; `docs/ARCHITECTURE_BASELINE.md` §Runtime Boundaries | Estimates likely implementation files from DOM, routes, IDs, classes with confidence scores and reasoning | `shared-types.md`, `error-model.md`, `project-scanner.md` | `visual-context-engine.md`, `framework-adapters.md` | P1 | Core Runtime | Draft | Low | Full subsystem spec at `docs/source-hint-engine.md`; probabilistic, never claims certainty |
| `framework-adapters.md` | `docs/framework-adapters.md`; `docs/architecture.md` §Extension Points; `docs/ARCHITECTURE_BASELINE.md` §Canonical Subsystem Names | Translates framework-specific conventions (React, Vue, Svelte, Angular) into common platform abstractions for route detection, layout identification, source hints | `shared-types.md`, `error-model.md`, `project-scanner.md`, `source-hint-engine.md` | `source-hint-engine.md`, `project-scanner.md` | P1 | Core Runtime | Draft | Low | Full subsystem spec at `docs/framework-adapters.md`; added — missing from proposed list |
| `diagnostics.md` | `docs/diagnostics.md`; `docs/architecture.md` §Diagnostics Engine, §Failure Recovery; `docs/ARCHITECTURE_BASELINE.md` §Runtime Boundaries | Collects and exposes platform health: console errors, page errors, network failures, layout overflow, rendering failures | `shared-types.md`, `error-model.md`, `event-bus.md` | `studio.md`, `mcp-server.md`, `logging.md`, `observability.md` | P1 | Core Runtime | Draft | Low | Full subsystem spec at `docs/diagnostics.md`; added — canonical subsystem, merged `diagnostics-ui.md` |

---

## Data and Contracts

Specifications that define the canonical data models, schemas, and persistence contracts used across subsystem boundaries.

| Specification | Architecture Sources | Purpose | Dependencies | Consumers | Priority | Phase | Status | Architecture Risk | Notes |
|--------------|---------------------|---------|-------------|-----------|----------|-------|--------|-------------------|-------|
| `context-packet-schema.md` | `docs/context-packet.md`; `docs/architecture.md` §Context Packet, §Packet Assembly, §Context Packet Lifecycle, §Context Packet Evolution; `docs/ARCHITECTURE_BASELINE.md` §Canonical Output | Defines the canonical Context Packet schema: structure, versioning, immutability rules, and the combined evidence model | `shared-types.md` | `visual-context-engine.md`, `mcp-server.md`, `sdk.md`, `public-api.md`, `resource-model.md` | P0 | Foundation | Draft | Low | Canonical output of VCE; everything becomes a context packet |
| `event-schema.md` | `docs/events.md` §Event Structure, §Event Payloads, §Event Versioning; `docs/architecture.md` §Internal Events | Defines versioned event schemas for all platform events: structure, payload, categories, ordering guarantees | `shared-types.md` | `event-bus.md`, `mcp-server.md`, `plugin-system.md` | P1 | Foundation | Draft | Medium | Derived from `docs/events.md`; needs concrete Zod schema definitions |
| `resource-model.md` | `docs/resources.md`; `docs/mcp.md` §Resources, §Resource Design; `docs/storage.md` | Defines MCP resource models: URIs, content types, immutability rules, and resource lifecycle | `shared-types.md`, `context-packet-schema.md` | `mcp-server.md`, `sdk.md`, `public-api.md` | P1 | Foundation | Draft | Medium | No standalone `docs/resource-model.md`; synthesised from resources.md + mcp.md |
| `storage-schema.md` | `docs/storage.md`; `docs/architecture.md` §Storage Layout, §Persistence | Defines the `.viskod/` storage layout, file formats, directory conventions, and retention policies | `shared-types.md` | `capture-pipeline.md`, `cache-model.md` | P1 | Foundation | Draft | Medium | Architecture defines layout; `docs/storage.md` provides high-level guidance |
| `cache-model.md` | `docs/cache.md`; `docs/architecture.md` §Cache Strategy | Defines caching policies: what is cached, invalidation rules, TTLs, and exclusion rules (never cache live DOM, viewport, browser state) | `shared-types.md`, `storage-schema.md` | `visual-context-engine.md`, `project-scanner.md`, `source-hint-engine.md` | P1 | Foundation | Draft | Medium | Architecture provides cache strategy at paragraph level only |
| `settings-schema.md` | `docs/settings.md`; `docs/architecture.md` §Configuration | Defines persisted settings schema: keys, types, defaults, validation rules, and upgrade migration | `shared-types.md` | `configuration.md`, `studio.md`, `cli.md` | P1 | Foundation | Draft | Medium | `docs/settings.md` covers the system but not the concrete schema |

---

## Integration Surfaces

Specifications that define how external systems (AI agents, developers, plugins, automation) interact with Viskod.

| Specification | Architecture Sources | Purpose | Dependencies | Consumers | Priority | Phase | Status | Architecture Risk | Notes |
|--------------|---------------------|---------|-------------|-----------|----------|-------|--------|-------------------|-------|
| `mcp-server.md` | `docs/mcp.md`; `docs/architecture.md` §MCP Server, §MCP Surfaces, §MCP Lifecycle, §Tool Design; `docs/ARCHITECTURE_BASELINE.md` §Runtime Boundaries | Exposes Viskod to AI systems via MCP: tools, resources, prompts, schema versioning, capability discovery | `shared-types.md`, `error-model.md`, `visual-context-engine.md`, `context-packet-schema.md`, `event-schema.md` | External AI coding agents | P0 | Integration | Draft | Low | Full spec at `docs/mcp.md`; first-class interface for AI systems |
| `plugin-system.md` | `docs/plugin-system.md`; `docs/plugin-api.md`; `docs/architecture.md` §Extension Points; `docs/permissions.md` | Defines the plugin lifecycle, manifest, capability registration, isolation, and extension points | `shared-types.md`, `error-model.md`, `event-bus.md`, `permissions-enforcement.md` | `studio.md`, `mcp-server.md`, `sdk.md` | P1 | Integration | Draft | Low | Renamed from `plugin-runtime.md`; merged `plugin-manifest-schema.md` — manifest is part of the system spec |
| `sdk.md` | `docs/sdk.md`; `docs/api-reference.md`; `docs/architecture.md` §Public Interfaces | Defines the language-agnostic SDK architecture: public API surface, error model, versioning, language binding patterns | `shared-types.md`, `error-model.md`, `public-api.md` | `cli.md`, external integrations | P1 | Integration | Draft | Low | Renamed from `sdk-typescript.md`; SDK spec is language-agnostic per architecture |
| `cli.md` | `docs/cli.md`; `docs/architecture.md` §Startup Flow, §CLI; `docs/ARCHITECTURE_BASELINE.md` §Startup Flow | Defines the developer CLI: command structure, orchestration, exit codes, output formats, configuration | `shared-types.md`, `error-model.md`, `configuration.md`, `sdk.md` | Developer tooling, CI/CD pipelines | P1 | Integration | Draft | Low | CLI is the orchestration entry point; owns startup sequence |
| `public-api.md` | `docs/api-reference.md`; `docs/architecture.md` §Public Interfaces; `docs/ARCHITECTURE_BASELINE.md` §Authoritative Document Precedence | Defines the stable public API surface: categories, resource naming, deprecation policy, cross-SDK consistency | `shared-types.md`, `error-model.md`, `context-packet-schema.md` | `sdk.md`, `cli.md`, `plugin-system.md` | P1 | Integration | Draft | Low | Full spec at `docs/api-reference.md` |

---

## Application

Specifications that define the human-facing graphical interface.

| Specification | Architecture Sources | Purpose | Dependencies | Consumers | Priority | Phase | Status | Architecture Risk | Notes |
|--------------|---------------------|---------|-------------|-----------|----------|-------|--------|-------------------|-------|
| `studio.md` | `docs/studio.md`; `docs/architecture.md` §Studio, §State Store, §State Synchronisation, §Startup Flow; `docs/state-management.md`; `docs/navigation.md`; `docs/ARCHITECTURE_BASELINE.md` §Runtime Boundaries, §Startup Flow; `docs/glossary.md` §Studio, §Context Explorer, §Selection Inspector | Defines the Studio desktop interface (SPEC-023): 5 panels (Browser Session, Context Explorer, Selection Inspector, Capture History, Diagnostics), Settings, selection workflow, capture workflow, workspace management, state machine (Starting→Ready→Selecting→Capturing→Displaying), Event Bus subscriptions, degraded mode, performance budgets, accessibility | `shared-types.md` (SPEC-002), `error-model.md` (SPEC-003), `context-packet-schema.md` (SPEC-006), `event-bus.md` (SPEC-007), `visual-context-engine.md` (SPEC-009), `overlay-system.md` (SPEC-022) | Developer (human user) | P1 | Application | Draft | Low | SPEC-023. Merged `studio-shell.md`, `studio-navigation.md`, `studio-state.md` — one subsystem, one spec. Studio NEVER accesses Browser Runtime or MCP Server directly. |
| `overlay-system.md` | `docs/overlay-system.md`; `docs/architecture.md` §Overlay System, §Overlay Isolation; `docs/ARCHITECTURE_BASELINE.md` §Canonical Subsystem Names | Defines the visual overlay injected into inspected pages: highlighting, labels, click interception, CSS isolation, Shadow DOM usage | `shared-types.md`, `error-model.md`, `browser-runtime.md`, `selection-engine.md` | `studio.md`, `visual-context-engine.md` | P1 | Application | Draft | Low | Renamed from `overlay-renderer.md` — canonical subsystem name is Overlay System |

---

## Platform Quality

Specifications that define security, reliability, observability, and operational readiness.

| Specification | Architecture Sources | Purpose | Dependencies | Consumers | Priority | Phase | Status | Architecture Risk | Notes |
|--------------|---------------------|---------|-------------|-----------|----------|-------|--------|-------------------|-------|
| `security-model.md` | `docs/security.md`; `docs/architecture.md` §Security Boundary, §Security Rules; `docs/ARCHITECTURE_BASELINE.md` §Runtime Boundaries | Defines the platform security model: trust boundaries, input validation, the untrusted browser principle, no-secrets-in-logs rule | `shared-types.md`, `error-model.md` | `permissions-enforcement.md`, `privacy-controls.md`, all runtime specs | P1 | Hardening | Draft | Low | Full spec at `docs/security.md`; foundational per constitution |
| `permissions-enforcement.md` | `docs/permissions.md`; `docs/architecture.md` §Security Boundary; `docs/plugin-system.md` §Permissions | Defines the permission system: capability model, grant/revoke lifecycle, plugin sandboxing, least-privilege enforcement | `shared-types.md`, `error-model.md`, `security-model.md` | `plugin-system.md`, `mcp-server.md` | P1 | Hardening | Draft | Low | Full spec at `docs/permissions.md` |
| `privacy-controls.md` | `docs/privacy.md`; `docs/architecture.md` §Security Rules, §Privacy; `docs/ARCHITECTURE_BASELINE.md` §Runtime Boundaries | Defines privacy controls: data collection boundaries, retention rules, deletion mechanisms, forbidden collection categories | `shared-types.md`, `error-model.md`, `security-model.md` | All runtime specs, `studio.md` | P1 | Hardening | Draft | Low | Full spec at `docs/privacy.md`; constitution mandates no telemetry in Phase 1 |
| `logging.md` | `docs/logging.md`; `docs/architecture.md` §Logging Architecture; `docs/error-handling.md` | Defines structured logging format, levels, categories, and the prohibition on logging secrets, tokens, cookies, or environment variables | `shared-types.md`, `error-model.md`, `diagnostics.md` | All runtime specs | P1 | Hardening | Draft | Low | Renamed from `logging-telemetry.md`; telemetry is deferred (Phase 1 has no telemetry per constitution) |
| `observability.md` | `docs/observability.md`; `docs/architecture.md` §Performance Targets; `docs/diagnostics.md` | Defines observability infrastructure: health check endpoints, metrics, tracing, diagnostic signals | `shared-types.md`, `error-model.md`, `diagnostics.md`, `logging.md` | All runtime specs | P2 | Hardening | Draft | Low | Full spec at `docs/observability.md`; Phase 2 hardening concern |
| `performance-budget.md` | `docs/performance.md`; `docs/architecture.md` §Performance Principles, §Performance Targets | Defines cross-subsystem performance budgets: startup time, interaction latency, memory usage, incremental processing targets | `shared-types.md`, `error-model.md` | All runtime specs | P2 | Hardening | Draft | Low | Full spec at `docs/performance.md`; per-subsystem budgets live in subsystem specs |
| `testing-strategy.md` | `docs/testing.md`; `docs/architecture.md` §Testing Boundaries; `docs/design-principles.md` | Defines the testing strategy: unit, integration, contract, and end-to-end test requirements, fixture management, isolation rules | `shared-types.md` | All implementation specs | P1 | Hardening | Draft | Low | Full spec at `docs/testing.md` |
| `release.md` | `docs/release.md`; `docs/architecture.md` §Versioning Strategy; `docs/ARCHITECTURE_BASELINE.md` §Freeze Statement | Defines the release pipeline: versioning, artifact generation, validation gates, changelog, rollback | `testing-strategy.md` | `deployment.md` | P3 | Hardening | Draft | Low | Renamed from `release-packaging.md` — canonical subsystem name is Release |
| `deployment.md` | `docs/deployment.md`; `docs/architecture.md` §Shutdown Flow; `docs/enterprise.md` §Deployment Models | Defines deployment models: local desktop, distribution channels, platform-specific packaging, update mechanisms | `release.md` | Distribution infrastructure | P3 | Hardening | Draft | Low | Full spec at `docs/deployment.md` |

---

## Specifications Removed or Merged

| Original Spec | Disposition | Rationale |
|--------------|-------------|-----------|
| `workspace-tooling.md` | **Removed** | pnpm workspace configuration is development tooling, not a product subsystem. No architecture document defines a "workspace tooling" boundary. Concerns absorbed by `repository-layout.md`. |
| `desktop-host.md` | **Removed** | No "desktop host" subsystem exists in the canonical architecture. The CLI is the entry point that orchestrates startup (`docs/architecture.md` §Startup Flow). Studio runs as an Electron/desktop process, not a separate "host" boundary. |
| `plugin-manifest-schema.md` | **Merged into `plugin-system.md`** | The manifest is an integral part of the plugin system (`docs/plugin-system.md` §Plugin Manifest). Splitting it into a separate spec violates the single-responsibility principle for the Plugin System subsystem. |
| `studio-shell.md` | **Merged into `studio.md`** | Studio is one canonical subsystem (`docs/studio.md`). The shell, navigation, and state are internal concerns of that subsystem, not independent specification boundaries. |
| `studio-navigation.md` | **Merged into `studio.md`** | Same rationale as `studio-shell.md`. Navigation is covered by `docs/navigation.md` as a sub-concern of Studio. |
| `studio-state.md` | **Merged into `studio.md`** | Same rationale as `studio-shell.md`. State management is covered by `docs/state-management.md` as a sub-concern of Studio. |
| `diagnostics-ui.md` | **Merged into `diagnostics.md`** | Diagnostics is one canonical subsystem (`docs/diagnostics.md`). The UI is a presentation concern of that subsystem, not an independent boundary. The architecture defines Diagnostics as a cross-cutting runtime component, not solely a UI feature. |
| `logging-telemetry.md` | **Renamed to `logging.md`** | Telemetry is explicitly deferred in the constitution: "No telemetry in Phase 1." The `ARCHITECTURE_BASELINE.md` notes telemetry as an unresolved item (NH6). Logging alone is well-defined (`docs/logging.md`) and required from day one. |
| `overlay-renderer.md` | **Renamed to `overlay-system.md`** | The canonical subsystem name in `docs/ARCHITECTURE_BASELINE.md` §Canonical Subsystem Names is "Overlay System." The architecture distinguishes the Overlay System (architectural concept) from the Overlay Manager (runtime component within Browser Runtime). |
| `plugin-runtime.md` | **Renamed to `plugin-system.md`** | The canonical subsystem name is "Plugin System" (`docs/plugin-system.md`), not "Plugin Runtime." The manifest is part of the system spec, not a separate boundary. |
| `sdk-typescript.md` | **Renamed to `sdk.md`** | The architecture defines the SDK as language-agnostic (`docs/sdk.md` §Supported Languages: TypeScript, JavaScript, Python, Go). Per-language SDKs are implementations of this spec, not separate specifications. |
| `release-packaging.md` | **Renamed to `release.md`** | The canonical subsystem is "Release" (`docs/release.md`). "Packaging" is one concern within the release specification. |

---

## Specifications Added

| Added Spec | Disposition | Rationale |
|-----------|-------------|-----------|
| `diagnostics.md` | **Added to Core Runtime** | `docs/ARCHITECTURE_BASELINE.md` §Canonical Subsystem Names lists "Diagnostics" as a canonical subsystem. `docs/diagnostics.md` exists with a full subsystem specification. The proposed list only included `diagnostics-ui.md` under Application, which is the presentation layer of diagnostics, not the subsystem itself. The Diagnostics subsystem is a cross-cutting runtime component that every other subsystem may emit into. |
| `framework-adapters.md` | **Added to Core Runtime** | `docs/ARCHITECTURE_BASELINE.md` §Canonical Subsystem Names lists "Framework Adapters" as a canonical subsystem. `docs/framework-adapters.md` exists with a full subsystem specification. Framework Adapters are listed as an extension point in `docs/architecture.md` §Extension Points and are a Phase 1 deliverable per `docs/roadmap.md`. They translate framework-specific conventions (React, Vue, Svelte, Angular) into common platform abstractions. |

---

## Priority Definitions

| Priority | Meaning |
|----------|---------|
| **P0** | Blocking the first vertical slice. This spec must be approved before any Phase 1 code can be written. |
| **P1** | Required for Phase 1 completion. This spec must be approved before the Phase 1 milestone. |
| **P2** | Phase 2 hardening concern. Deferred until the core platform is stable. |
| **P3** | Phase 3+ operational/packaging concern. Required before public distribution. |

## Phase Definitions

| Phase | Scope |
|-------|-------|
| **Foundation** | Repository structure, shared contracts, data schemas, cross-cutting error/config models. Every other spec depends on these. |
| **Core Runtime** | The twelve canonical subsystems defined in `docs/ARCHITECTURE_BASELINE.md` §Canonical Subsystem Names plus the Event Bus integration boundary. |
| **Integration** | External-facing interfaces: MCP, CLI, SDK, Plugin System, Public API. How AI agents, developers, and automation interact with Viskod. |
| **Application** | The human-facing graphical interface: Studio and the Overlay System. |
| **Hardening** | Security, privacy, logging, observability, performance budgets, testing strategy, release, and deployment. |
