# Documentation Architecture Audit Report

> **Audit Scope:** Full `/docs` directory (50 documents)
> **Audit Date:** 2026-07-28
> **Audited By:** Automated architecture consistency review
> **Standard:** `MEMORY.md`, `glossary.md`, `design-principles.md`, `governance.md`

---

## Overall Architecture Score: **52 / 100**

The documentation set is thorough in coverage but suffers from significant internal contradictions in its architectural diagrams, inconsistent subsystem naming, and missing cross-references between documents. The severity breakdown:

| Category | Count |
|----------|-------|
| Critical | 3 |
| Major    | 8 |
| Minor    | 14 |
| Nice-to-have | 9 |

---

## Critical Issues

### C1 — Contradictory Architecture Diagrams (`architecture.md`)

**Severity:** Critical  
**Documents:** `architecture.md`  
**Lines:** 92-116 (System Overview), 149-176 (High-Level Component Model), 892-912 (Core Runtime Architecture), 1694-1712 (Platform Architecture)

The single most important document in the codebase contains **four distinct architectural diagrams** that contradict each other:

| Diagram | Top | Middle | Bottom |
|---------|-----|--------|--------|
| System Overview (§92) | Studio | VCE → Browser Runtime / Project Scanner | MCP Server |
| High-Level Component Model (§149) | Studio | VCE → Browser Runtime / Project Scanner / Capture Manager → Context Builder | MCP Server / Local Storage |
| Core Runtime Architecture (§892) | Studio → Selection Engine → Browser Runtime → Capture Pipeline | → VCE | MCP |
| Platform Architecture (§1694) | AI Agent → MCP | MCP Server → Context Engine / Capture Manager / Project Scanner | Browser Runtime |

**Specific contradictions:**
- Diagram 3 places Browser Runtime **above** VCE. Diagrams 1 and 2 place Browser Runtime **below** VCE. Two totally opposite dependency directions.
- Diagram 2 introduces a `Context Builder` component that appears nowhere in Diagrams 1, 3, or 4.
- Diagram 3 introduces a `Selection Engine` between Studio and Browser Runtime. Missing from Diagrams 1 and 2.
- Diagram 1 lacks `Capture Manager`; Diagram 2 and 4 include it.
- The package list at line 220 has `capture-manager/` but Diagrams 1 and 3 don't show it at that layer.

**Impact:** Two engineers reading different sections of `architecture.md` will implement radically different dependency graphs. One will build VCE on top of Browser Runtime; another will build Browser Runtime on top of VCE. This is the single highest-risk issue.

**Fix:** Choose one authoritative dependency graph. The other diagrams should be simplified views, not alternatives. The correct direction (implied by most diagrams and the package responsibilities) is: **Browser Runtime → VCE**, not the reverse. Eliminate the reversed diagram in §892-912.

---

### C2 — Inconsistent Package Naming Across Documents

**Severity:** Critical  
**Documents:** `architecture.md`, `packages.md`, `capture-pipeline.md`, `browser-runtime.md`, `glossary.md`

The same subsystem is called different names across documents:

| architecture.md (repo layout) | architecture.md (diagrams) | packages.md | Own Specification Doc | Glossary |
|-------------------------------|---------------------------|-------------|----------------------|----------|
| `capture-manager/` | Capture Manager | Capture Pipeline | `capture-pipeline.md` (titled "Capture Pipeline") | "Capture Manager" (defined implicitly) vs "Capture Pipeline" (defined in glossary §82) |

**Impact:** A developer creating the package directory would name it `capture-manager` (from `architecture.md`), `capture-pipeline` (from `packages.md`), or `capture-manager` (from `capture-pipeline.md`'s own content which describes "Capture Manager"). All three disagree.

Additional name mismatches:
- `architecture.md` §1012 refers to "Viewport Engine" — no corresponding package, no specification document
- `architecture.md` §1259 refers to "Hierarchy Builder" — no corresponding package, no specification document
- `architecture.md` §1238 refers to "DOM Intelligence" — no corresponding package, no specification document
- `architecture.md` §1288 refers to "Computed Style Engine" — no corresponding package, no specification document
- `architecture.md` §1318 refers to "Context Builder" — appears in diagrams, no specification document
- `architecture.md` §1472 refers to "Diagnostics Engine" — `diagnostics.md` calls it "Diagnostics subsystem"

**Fix:** Reconcile all naming to match `glossary.md`. Standardize on one name per subsystem. The glossary must cover every named subsystem.

---

### C3 — Circular/Conflicting Runtime Boundaries

**Severity:** Critical  
**Documents:** `architecture.md` §395-413 (Dependency Rules), §743-756 (Runtime Boundary)

**Dependency Rules** (§399) say:
```
Studio → Context Engine → Browser Runtime → Playwright
```

**Runtime Boundary** (§745-756) says:
- Browser Runtime communicates only with Chromium and Context Engine
- It never talks to Studio, MCP, or Project Scanner

These statements contradict: the Dependency Rules show Studio depending on Context Engine depending on Browser Runtime. But the Runtime Boundary says Browser Runtime talks to Context Engine (implying a bidirectional or upward dependency, which the Dependency Rules forbid: "Never reverse the dependency direction").

Furthermore, `studio.md` §47 shows:
```
Browser Runtime → Visual Context Platform → MCP Server → Studio Backend → Studio UI
```
This shows MCP Server feeding Studio Backend, which contradicts the Dependency Rules where Studio sits at the top.

**Impact:** The dependency graph is internally contradictory. The system cannot be implemented correctly without resolving these conflicts.

**Fix:** The correct model (from package responsibilities) is:
- Browser Runtime owns browser interaction only
- VCE consumes Browser Runtime output, not the reverse
- MCP Server consumes VCE output
- Studio consumes VCE and MCP Server state through the State Store/Event Bus
- Update all diagrams to reflect this single truth.

---

## Major Issues

### M1 — `architecture.md` Lacks a "Relationship to Other Documents" Section

**Severity:** Major  
**Documents:** `architecture.md` (entire document)

As the primary architectural reference, `architecture.md` should explicitly reference every subsystem document it defines. It references exactly zero other documents by filename or section. Compare with `governance.md` which has a clear relationship section (§369-382).

**Fix:** Add a comprehensive "Relationship to Other Documents" section listing all subsystem specs, and ensure each referenced document reciprocates.

---

### M2 — Subsystem Docs Missing Cross-References

**Severity:** Major  
**Documents:** 26 of 50 documents lack a "Relationship to Other Documents" section

Documents **with** relationship sections: `glossary.md`, `design-principles.md`, `governance.md`, `packages.md`, `api-reference.md`, `tool-reference.md`, `cli.md`, `sdk.md`, `plugin-api.md`, `events.md`, `resources.md`, `testing.md`, `error-handling.md`, `diagnostics.md`, `logging.md`, `observability.md`, `cache.md`, `faq.md`, `examples.md`, `roadmap.md`, `rfcs.md`, `enterprise.md`, `deployment.md`, `troubleshooting.md`

Documents **without** relationship sections: `architecture.md`, `product.md`, `studio.md`, `browser-runtime.md`, `visual-context-engine.md`, `mcp.md`, `context-packet.md`, `selection-engine.md`, `capture-pipeline.md`, `project-scanner.md`, `source-hint-engine.md`, `plugin-system.md`, `framework-adapters.md`, `overlay-system.md`, `state-management.md`, `storage.md`, `security.md`, `privacy.md`, `permissions.md`, `settings.md`, `performance.md`, `ui-architecture.md`, `navigation.md`, `changelog.md`, `contributing.md`, `release.md`

The most critical omissions are `architecture.md`, `visual-context-engine.md`, `mcp.md`, and `browser-runtime.md` — the core architectural documents.

**Fix:** Add relationship sections to all 26 documents.

---

### M3 — "Context Builder" Has No Specification Document

**Severity:** Major  
**Documents:** `architecture.md` §1318-1355, `capture-pipeline.md`

"Context Builder" appears in multiple architecture diagrams (§149-176, §1189-1200) as the component that "transforms multiple inputs into one output" and produces the Context Packet. It has:
- A defined responsibility (assembly of Context Packets)
- A defined input set (DOM + Styles + Hierarchy + Screenshots + Diagnostics + Project Metadata + Source Hints)
- A defined output (Context Packet)
- A position in the data flow

But it has no specification document. The Visual Context Engine specification (`visual-context-engine.md`) describes an 8-stage processing pipeline that includes a "Packet Assembly" stage (§8) — but this is within the VCE, not a separate "Context Builder" as the architecture diagrams suggest.

**Impact:** Implementers won't know whether Context Builder is a VCE internal stage or a separate package. Architecture suggests separate; VCE spec suggests internal.

**Fix:** Decide. If Context Builder is a separate package, create a specification document. If it's a VCE internal stage, remove it from the architecture diagrams.

---

### M4 — Runtime Startup Flow Contradicts Package Boundaries

**Severity:** Major  
**Documents:** `architecture.md` §453-488, `cli.md`, `studio.md`

The architecture startup flow (§456) shows:
```
viskod start → CLI → Project Detection → Browser Runtime → Studio → MCP Server → Ready
```

But:
- `cli.md` says CLI orchestrates and "does not own business logic" — yet this flow has CLI performing project detection
- `project-scanner.md` says the Project Scanner owns project detection — the flow never invokes Project Scanner
- Studio is started *after* Browser Runtime — this is correct for the flow described
- MCP Server is started last — but the architecture diagrams show MCP as a top-level interface

**Impact:** The startup sequence suggests CLI directly performs project detection, but the Project Scanner exists as a dedicated package for this. Responsibility is blurred.

---

### M5 — Terminology Drift: "Visual Context Platform" vs "Viskod" vs "Platform"

**Severity:** Major  
**Documents:** Multiple

The glossary defines:
- **Platform** = "The complete Viskod system, including all documented subsystems and public interfaces"
- **Viskod** = (not defined as a glossary entry)

Yet across documents:
- `product.md` uses "Viskod" ~80 times, "Visual Context Platform" ~0 times, "platform" ~10 times
- `architecture.md` uses "Viskod" ~30 times, "Visual Context Platform" ~3 times, "platform" ~20 times
- `glossary.md` uses "Visual Context Platform" in naming conventions table but "Platform" is the glossary entry
- `faq.md` uses "Visual Context Platform" ~8 times

The naming convention table in `glossary.md` §372 says "Visual Context Platform" is preferred and "Visual IDE" should be avoided. But the glossary itself defines "Platform", not "Visual Context Platform". This is a self-referential inconsistency.

**Fix:** Add "Viskod" as a glossary entry = "The Visual Context Platform. See Platform." Then ensure "Viskod" and "Platform" are used consistently per their glossary definitions.

---

### M6 — "Selection Engine" Missing from Repository Layout

**Severity:** Major  
**Documents:** `architecture.md` §210-230, `selection-engine.md`

The architecture repository layout (§210-230) does not include `selection-engine/` as a package. Yet:
- Section §1049-1077 ("Selection Engine") is a full architectural section in `architecture.md`
- `selection-engine.md` is a standalone specification document
- The Core Runtime Architecture diagram (§892-912) places Selection Engine between Studio and Browser Runtime
- `packages.md` §118 lists "Selection Engine" as a Platform Package

**Impact:** The package either exists (making the repository layout incomplete) or doesn't (making the architecture sections architectural guidance without corresponding implementation). Either way, it's a gap.

---

### M7 — Overlay System vs Overlay Manager Naming Conflict

**Severity:** Major  
**Documents:** `architecture.md` §1083-1114, `browser-runtime.md`, `overlay-system.md`

`architecture.md` §1083 says "Overlay System" but §1094 describes responsibilities.
`browser-runtime.md` has "Overlay Manager" as a sub-component of Browser Runtime (§1108-1130).
`overlay-system.md` is the specification document — titled "Overlay System".

Three names for the same concept. Additionally, `architecture.md` describes overlay responsibilities as a standalone concept, while `browser-runtime.md` subsumes it as a Browser Runtime sub-component.

**Fix:** Standardize on one name. Clarify whether overlay is a Browser Runtime sub-component or a standalone subsystem.

---

### M8 — Framework Adapters: Contract Spec vs Architecture

**Severity:** Major  
**Documents:** `framework-adapters.md`, `architecture.md`

`architecture.md` §763-788 (Extension Points) shows:
```
Accessibility Engine → Context Engine
Visual Diff Engine → Capture Manager
Design System Engine → Project Scanner
```

But `framework-adapters.md` defines adapters as "platform components that understand framework conventions." The extension points diagram doesn't mention Framework Adapters at all, despite them being a dedicated specification document.

Additionally, `framework-adapters.md` specifies adapters that connect to the Source Hint Engine, but this relationship is not documented in the architecture's extension points.

---

## Minor Issues

### N1 — Missing Glossary Entries

The following terms appear in architecture but are not in the glossary:
- **Capture Manager** — defined in `architecture.md` §1202, missing from glossary
- **Context Builder** — defined in `architecture.md` §1318, missing from glossary
- **Viewport Engine** — defined in `architecture.md` §1011, missing from glossary
- **Hierarchy Builder** — defined in `architecture.md` §1257, missing from glossary
- **DOM Intelligence** — defined in `architecture.md` §1236, missing from glossary
- **Computed Style Engine** — defined in `architecture.md` §1287, missing from glossary
- **State Store** — defined in `architecture.md` §1540, missing from glossary
- **Confidence Engine** — defined in `visual-context-engine.md`, missing from glossary
- **Diagnostics Engine** — defined in `architecture.md` §1472, same as "Diagnostics" in glossary

### N2 — Inconsistent Section Header Formatting

Some documents use code blocks with random IDs (e.g., ````text id="r4m7pk"`), others use plain markdown. The IDs appear to be randomly generated and serve no documented purpose. This pattern is inconsistent across documents and adds noise without value.

### N3 — "Last Updated" Dates Inconsistent

Foundational documents: `architecture.md` (2026-07-28), `product.md` (2026-07-28). Most other documents lack a "Last Updated" date entirely. Some documents use "Living Document" status but lack dates to indicate when they were last touched.

### N4 — Performance Targets Duplication

Performance targets appear in `architecture.md` §1598-1633 and also in individual subsystem documents (e.g., `browser-runtime.md` has own targets, `visual-context-engine.md` has own targets). The `performance.md` document also defines targets. Three sources of truth for the same metrics — and there's no guarantee they match.

### N5 — "Capability" Overloaded Term

`glossary.md` defines "Capability" as "a granular permission granted to plugins." But `design-principles.md` uses "capability" in the general sense (e.g., "every major capability should include documentation"). `product.md` uses it for product features. The permission-specific definition in the glossary conflicts with general usage.

### N6 — `mcp.md` Sets Version `1.0` with Status `Locked` Before Implementation

`mcp.md` has `Status: Locked` and defines specific MCP tools with versioned names (e.g., `viskod.v1.capture_selection`). Since Phase 1 hasn't been built, these tool names are speculative and locking them prematurely conflicts with the Design Principle of "determinism" — the tools don't exist yet so the spec can't be authoritative.

### N7 — `glossary.md` Defines "CLI" but Not the Full Phrase

The glossary defines "CLI" and "SDK" as entries, but the `cli.md` document title uses "Command-Line Interface (CLI)". The glossary should include the full expansion and the abbreviation.

### N8 — `capture-pipeline.md` Title vs Content

The file is named `capture-pipeline.md` and its header says "Capture Pipeline" but the body describes "Capture Manager" throughout ("Capture Manager coordinates capture operations," "Capture Manager never analyses data"). The filename and specification body use different names.

### N9 — `studio.md` Architecture Diagram Shows MCP Server Above Studio

`studio.md` §47-53 shows:
```
Browser Runtime → Visual Context Platform → MCP Server → Studio Backend → Studio UI
```
This suggests MCP Server sits between platform services and Studio, which contradicts `architecture.md` where MCP Server is a separate interface alongside Studio, not a layer between them.

### N10 — "Diagnostics" is Both a Subsystem and a Package Category

`packages.md` §121 lists "Diagnostics" as a Platform Package. `architecture.md`'s repository layout does not include a `diagnostics/` package. `diagnostics.md` treats it as a cross-cutting subsystem. The packaging decision needs to be consistent.

### N11 — `product.md` References "Context Explorer" and "Capture History"

`product.md` §109 mentions "Context Explorer" and captures/history concepts. `studio.md` defines Context Explorer (§188) and Capture History (§274) as Studio panels. The glossary defines "Context Explorer" but the product doc's narrative flows as if these are standalone features, not UI panels.

### N12 — Inconsistent Use of "Note" vs "Must Not" vs "Should" vs "Must"

Some documents use imperative form (e.g., architecture.md: "Never reverse the dependency direction"). Others use RFC-style SHOULD/MUST language (e.g., source-hint-engine.md: "The engine should communicate uncertainty explicitly"). The convention is not standardized. Consider adopting RFC 2119 keywords consistently.

### N13 — `resources.md` Defines "Resource Management" / Glossary Defines "Resource"

`glossary.md` defines "Resource" = "A platform-managed entity exposed through public APIs." But `resources.md` defines "Resource Management" as "how Viskod discovers, allocates, tracks and releases runtime resources" — this is about runtime resource management (memory, connections, browser sessions), while the glossary definition is about API-visible resources (Context Packets, captures). These are completely different concepts sharing the word "resource."

### N14 — `api-reference.md` Lists Plugin APIs; `plugin-api.md` is the Spec

`api-reference.md` §118-125 documents "Plugin APIs" operations. `plugin-api.md` is the authoritative spec. The two documents don't cross-reference each other. If `plugin-api.md` changes, `api-reference.md` could silently go out of date.

---

## Nice-to-Have Improvements

### NH1 — No Document Ownership Declaration
None of the 50 documents declare who maintains them or who approved the current version. Given `governance.md`'s emphasis on "documented architectural rationale" and "clear ownership," the documents themselves lack ownership metadata.

### NH2 — No Document Dependency Graph
There is no document that shows how the 50 documents relate to each other. A reader opening any document cannot tell which other documents are prerequisites. Suggested: add a "Prerequisites" or "See First" section to each document.

### NH3 — No Change Log Per Document
Individual documents lack revision histories. When a coordinated change touches multiple documents, there's no way to verify all were updated. Suggested: add a minimal history footer to each document (date + summary of last change).

### NH4 — No "What's Different in V2" Strategy
Multiple documents have `Version: 1.0` and `Status: Locked`. There's no documented strategy for how to produce a v1.1 or v2.0. The governance doc covers deprecation policy (§257-266) but not *document* evolution policy (versus *API* deprecation).

### NH5 — Command Palette Referenced But Not Specified
`studio.md` briefly mentions Command Palette, `navigation.md` §218-228 describes it, but `cli.md` also defines a command structure. There's no unified "Command" specification. Is the CLI command structure the same as the Studio Command Palette? These should be clarified.

### NH6 — Telemetry Is Mentioned But Not Covered
`privacy.md` §195-203 addresses telemetry ("optional, transparent, anonymised"). `diagnostics.md` touches on telemetry in settings. But no document defines *what* telemetry exists, what events are collected, or how to disable it. For an implementation, this needs a concrete specification.

### NH7 — No Document Exists for "Design System Engine"
`architecture.md` §779-784 shows "Design System Engine → Project Scanner" as a future extension. `project-scanner.md` §177 mentions "Design System Discovery" as a future feature. But there's no specification document for this future capability. Either remove it from the architecture extension points until it's planned, or create a placeholder spec.

### NH8 — GitHub-Branded Sections in Architecture
`architecture.md` uses sections like "Monorepo Architecture" (§180) that reference pnpm specifically. This is implementation detail leaking into an architecture document. The architecture should say "monorepo with workspace separation," not "pnpm workspace." `AGENTS.md` already specifies pnpm as the tool choice.

### NH9 — FAQ Should Cross-Reference Troubleshooting
`faq.md` covers architecture and philosophy. It has zero mentions of `troubleshooting.md`. Users encountering problems are split between two documents with no navigation between them.

---

## Summary of Systemic Patterns

1. **Diagram-first design without reconciliation**: Multiple architectural diagrams were created without verifying they agree. This is the root cause of Critical issues C1-C3.

2. **Document-first architecture without implementation**: All 50 documents are written as if the software exists. This creates speculative specifications that contradict each other because there's no implementation to ground them.

3. **Missing cross-reference discipline**: 26 of 50 documents (52%) lack relationship sections. The remaining 24 reference other documents inconsistently. There's no enforced convention.

4. **Subsystem naming is uncontrolled**: The same concept has 2-3 names across documents. The glossary doesn't cover all subsystems.

---

## Recommended Remediation Priority

1. **Immediate** (before any implementation): Fix C1, C2, C3 — reconcile the architecture diagrams, standardize package names, resolve runtime boundary conflicts.
2. **Next sprint**: Fix M1-M8 — add relationship sections, resolve Context Builder ambiguity, add missing packages, standardize terminology.
3. **Ongoing**: Fix N1-N14 — glossary completeness, formatting, minor naming issues.
4. **Improvement backlog**: NH1-NH9 — ownership, document dependency graph, change logs, future capability specs.
