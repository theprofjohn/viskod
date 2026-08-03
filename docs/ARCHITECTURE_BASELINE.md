# Viskod Architecture Baseline v1.0

> **Baseline Name:** Viskod Architecture v1.0
> **Baseline Version:** 1.0
> **Audit Score:** 94/100
> **Audit Status:** Passed
> **Audit Date:** 2026-07-28
> **Status:** **Frozen**

---

## Freeze Statement

The `/docs` architecture baseline is frozen as version 1.0. Future changes that alter product scope, subsystem ownership, dependency direction, runtime boundaries, public contracts or architectural invariants require an RFC.

Minor corrections that do not change architectural meaning (typos, formatting, broken links) may proceed without an RFC.

---

## Canonical Product Positioning

Viskod is a **Visual Context Platform** for AI coding agents. It is:

* A browser inspection system
* An MCP server
* A local-first developer tool
* A bridge between running applications and AI coding agents

Viskod is **not**:

* An IDE
* A code editor
* A coding agent
* A chatbot
* A browser replacement
* A Figma alternative

Authoritative source: `docs/product.md`

---

## Canonical Subsystem Names

| Subsystem | Specification | Glossary |
|-----------|--------------|----------|
| Visual Context Engine | `visual-context-engine.md` | Yes |
| Browser Runtime | `browser-runtime.md` | Yes |
| Capture Pipeline | `capture-pipeline.md` | Yes |
| Project Scanner | `project-scanner.md` | Yes |
| Selection Engine | `selection-engine.md` | Yes |
| Source Hint Engine | `source-hint-engine.md` | Yes |
| MCP Server | `mcp.md` | Yes |
| Studio | `studio.md` | Yes |
| Overlay System | `overlay-system.md` | Yes |
| Diagnostics | `diagnostics.md` | Yes |
| Framework Adapters | `framework-adapters.md` | Yes |

These names are canonical. No document may use alternative names for the same subsystem.

---

## Canonical Dependency Model

```
Studio
  ↓ command
Visual Context Engine
  ├──→ Browser Runtime
  ├──→ Capture Pipeline
  └──→ Project Scanner

Browser Runtime
  ↓ publishes asynchronous events
Event Bus
  ↓ delivers events
Visual Context Engine
```

### Command Flow

`VCE → Browser Runtime` represents command or service invocation.

VCE requests browser inspection, capture, navigation, viewport changes, or runtime evidence through the Browser Runtime's public API. These are synchronous or request-response calls initiated by VCE.

### Asynchronous Event Flow

`Browser Runtime → Event Bus → VCE` represents asynchronous event flow.

Browser Runtime publishes browser lifecycle, navigation, DOM, capture, selection and state-change events to the Event Bus. VCE subscribes to those events through the Event Bus. Browser Runtime never knows which subscribers consume its events.

### Prohibited Dependencies

1. Browser Runtime must not directly call VCE methods.
2. Browser Runtime must not import VCE implementation modules.
3. VCE must not receive browser events through direct callbacks that bypass the Event Bus.
4. The Event Bus is an integration boundary. It owns transport and delivery, not business logic.
5. Command dependency and event flow are distinct communication patterns. No diagram may conflate them with unlabeled arrows.
6. No bi-directional dependency exists except through the Event Bus.

### Repository Layout

```
viskod/
  apps/
    └── studio/
  packages/
    ├── agent-handoff/
    ├── audit/
    ├── browser-runtime/
    ├── capture-pipeline/
    ├── cli/
    ├── config/
    ├── context-engine/
    ├── diagnostics/
    ├── event-bus/
    ├── mcp-server/
    ├── overlay-system/
    ├── permissions/
    ├── plugin-system/
    ├── project-scanner/
    ├── runtime-session/
    ├── sdk/
    ├── selection-engine/
    ├── setup/
    ├── shared/
    ├── source-hint-engine/
    ├── visual-issue/
    ├── visual-review/
    ├── visual-selection/
    └── workspace/
```

---

## Runtime Boundaries

| Boundary | Owns | Forbidden Access |
|----------|------|-----------------|
| Browser Runtime | Chromium, pages, screenshots, overlays, browser events | Repository, MCP, source hints, file system |
| Visual Context Engine | Context Packets, DOM analysis, style processing, hierarchy, confidence | Browser process, Chromium API, Playwright directly |
| Project Scanner | Repository metadata, framework detection, routes, source hints | Browser, DOM, screenshots |
| Capture Pipeline | Screenshot storage, capture metadata, retention, export | Browser, DOM, analysis |
| MCP Server | MCP tools, resources, prompts, schema versioning | Browser, DOM, Playwright, file system |
| Studio | UI state, navigation, display, user interaction | Browser process, business logic, source mapping |

---

## Startup Flow

```
viskod start
  ↓
CLI
  ↓
Project Scanner
  ↓
Browser Runtime
  ↓
Visual Context Engine
  ↓
Studio
  ↓
MCP Server
  ↓
Ready
```

---

## Authoritative Document Precedence

When documents conflict, the higher-authority document governs until resolved through the RFC process.

1. `docs/product.md` — product identity and scope
2. `docs/design-principles.md` — engineering philosophy
3. `docs/architecture.md` — system boundaries and dependency direction
4. `docs/ARCHITECTURE_BASELINE.md` — this document; canonical snapshot
5. Subsystem documents — internal responsibilities of each subsystem
6. Public API and protocol documents — SDK, CLI, Plugin API, MCP, API Reference
7. Implementation specifications — `specs/` directory
8. Source code — the implementation in `packages/` and `apps/`

---

## Known Minor Limitations

These non-blocking issues are documented and deferred:

* Code block ID formatting is inconsistent across documents (N2)
* RFC 2119 keyword usage (MUST/SHOULD/MAY) is not standardized (N12)
* `api-reference.md` and `plugin-api.md` do not cross-reference each other (N14)
* Document ownership is not declared per file (NH1)
* No document dependency graph exists (NH2)
* Per-document change logs are not maintained (NH3)
* No document evolution strategy for v1→v2 exists (NH4)
* Command Palette is referenced in multiple docs without a unified spec (NH5)
* Telemetry is mentioned but not specified concretely (NH6)
* Design System Engine appears in extension points without a specification (NH7)

These do not affect architectural consistency.

---

## Governance Rule for Future Changes

Any change that affects the following requires an RFC before modification:

* Product scope or positioning
* Subsystem ownership boundaries
* Dependency direction between subsystems
* Runtime boundary rules
* Public API contracts
* Architectural invariants
* Canonical terminology (glossary additions or redefinitions)

The RFC process is defined in `docs/rfcs.md`. Governance rules are defined in `docs/governance.md`.

---

## Baseline Validation

| Check | Result |
|-------|--------|
| Zero Critical issues | PASS |
| Zero Major issues | PASS |
| Canonical subsystem names used consistently | PASS |
| Dependency directions unambiguous | PASS |
| Command flow labelled separately from event flow | PASS |
| Runtime boundaries documented | PASS |
| Prohibited dependencies explicit | PASS |
| Glossary covers all canonical terms | PASS |
| 35+ documents have relationship sections | PASS |
| No stale references to Context Builder or Capture Manager | PASS |
| Audit report confirms score ≥ 90 | PASS (94/100) |

---

## Reference Documents

| Document | Role |
|----------|------|
| `AUDIT_REPORT.md` | Initial audit findings |
| `REMEDIATION_PLAN.md` | Canonical decisions made during remediation |
| `AUDIT_REPORT_V2.md` | Post-remediation audit report |
| `CHANGE_SUMMARY.md` | Detailed change log of all edits |
