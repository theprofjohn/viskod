# Documentation Remediation Plan

> **Version:** 1.0
> **Date:** 2026-07-28
> **Scope:** All Critical and Major issues from `AUDIT_REPORT.md`
> **Guiding documents:** `product.md`, `design-principles.md`, `architecture.md`, `glossary.md`

---

## Governing Rules

These rules take precedence over all implementation preferences during remediation.

1. **`product.md`** defines product identity and scope (not an IDE, not a code editor, not a coding agent).
2. **`design-principles.md`** defines platform principles (evidence before inference, browser as truth, local-first, MCP-first).
3. **`architecture.md`** defines system boundaries and dependency direction.
4. **Subsystem documents** define their own internal responsibilities; architecture.md defines how they connect.
5. **`glossary.md`** defines canonical terminology. Every term has exactly one meaning.
6. **Implementation-specific naming** must not override architectural naming.
7. **No subsystem** may have conflicting ownership across documents.
8. **Diagrams and prose** must describe the same dependency direction.
9. **No bi-directional dependency** unless explicitly mediated through the Event Bus or a documented interface.

---

## Canonical Architecture Model

Before resolving individual issues, we define the single canonical architecture model that every document must reflect.

### Canonical Package Dependency Direction

```
Studio
  ↓
Visual Context Engine
  ↓
Browser Runtime ──── Project Scanner ──── Capture Pipeline
  ↓                       ↓
Playwright            Repository
```

**Rules:**
- Visual Context Engine depends ON Browser Runtime (not the reverse).
- Visual Context Engine depends ON Project Scanner.
- Visual Context Engine depends ON Capture Pipeline.
- Browser Runtime does NOT call Visual Context Engine directly.
- Reverse communication (Browser Runtime → VCE) occurs ONLY through the Event Bus.
- Studio consumes VCE output; never drives the browser directly.
- MCP Server consumes VCE output through public APIs; never accesses Browser Runtime directly.

### Canonical Data Flow

```
Browser Runtime ──events──→ Event Bus ──subscription──→ Visual Context Engine
       │                                                       │
       │                                                       │
       └────────capture request────────────────────────────────→│
                                                                │
Project Scanner ──metadata────→ Visual Context Engine           │
                                                                │
Capture Pipeline ←──persist──── Visual Context Engine           │
                                                                │
                                                                ↓
                                                         Context Packet
                                                                │
                                                    ┌───────────┴───────────┐
                                                    ↓                       ↓
                                              Studio (display)        MCP Server (expose)
```

### Canonical Runtime Boundary

| Boundary | Owns | Forbidden Access |
|----------|------|-----------------|
| Browser Runtime | Chromium, pages, screenshots, overlays, browser events | Repository, MCP, source hints, file system |
| Visual Context Engine | Context Packets, DOM analysis, style processing, hierarchy, confidence | Browser process, Chromium API, Playwright directly |
| Project Scanner | Repository metadata, framework detection, routes, source hints | Browser, DOM, screenshots |
| Capture Pipeline | Screenshot storage, capture metadata, retention, export | Browser, DOM, analysis |
| MCP Server | MCP tools, resources, prompts, schema versioning | Browser, DOM, Playwright, file system |
| Studio | UI state, navigation, display, user interaction | Browser process, business logic, source mapping |

---

## Canonical Terminology

Every subsystem has exactly one canonical name.

| Canonical Term | Glossary Entry | Package Directory | Specification File | Replaces |
|---------------|---------------|-------------------|-------------------|----------|
| Visual Context Engine | Yes | `context-engine/` | `visual-context-engine.md` | VCE |
| Browser Runtime | Yes | `browser-runtime/` | `browser-runtime.md` | — |
| Capture Pipeline | Yes (add) | `capture-pipeline/` | `capture-pipeline.md` | Capture Manager, `capture-manager/` |
| Project Scanner | Yes | `project-scanner/` | `project-scanner.md` | — |
| Selection Engine | No (add) | `selection-engine/` | `selection-engine.md` | — |
| Source Hint Engine | Yes | `source-hint-engine/` | `source-hint-engine.md` | — |
| MCP Server | Yes | `mcp-server/` | `mcp.md` | — |
| Studio | Yes | `studio/` (under `apps/`) | `studio.md` | — |
| Overlay System | Yes | (Browser Runtime internal) | `overlay-system.md` | Overlay Manager |
| Diagnostics | Yes | (cross-cutting) | `diagnostics.md` | Diagnostics Engine, Diagnostics Manager |

**Context Builder is NOT a canonical term.** It is eliminated as a separate architectural concept. Its function is the Packet Assembly stage within the Visual Context Engine specification (§Stage 8).

**Viewport Engine is NOT a separate subsystem.** It is a component within Browser Runtime.

**Hierarchy Builder is NOT a separate subsystem.** It is a stage within the Visual Context Engine processing pipeline.

**DOM Intelligence is NOT a separate subsystem.** It is a stage within the Visual Context Engine processing pipeline.

**Computed Style Engine is NOT a separate subsystem.** It is a stage within the Visual Context Engine processing pipeline.

---

## Critical Issues — Canonical Decisions

### C1 — Contradictory Architecture Diagrams

**Affected files:** `architecture.md`

**Contradiction:** Four distinct diagrams in `architecture.md` show different dependency directions between Visual Context Engine and Browser Runtime.

**Proposed decision:** Replace all four diagrams with a single canonical model (see Canonical Architecture Model above). The System Overview diagram becomes the primary reference. The Core Runtime Architecture section becomes a data-flow narrative (not a dependency diagram). The Platform Architecture section becomes an external-interface diagram. The High-Level Component Model diagram is removed as redundant.

**Rationale:** Package responsibilities clearly indicate Browser Runtime provides raw browser data and VCE transforms it. VCE depends on Browser Runtime. This aligns with the Dependency Rules section (§395-413) and contradicts only the Core Runtime Architecture diagram (§892-912), which is a data-flow view, not a dependency view.

**Files that must be updated:**
- `architecture.md`: Replace all 4 diagrams with the canonical model; add a "Data Flow (Runtime)" section for the capture pipeline flow; add an "Interface Architecture" section for the MCP/external view.

**Risk:** Low. The Dependency Rules already encode the correct direction. We are removing a contradictory diagram, not changing the architecture.

---

### C2 — Inconsistent Package and Subsystem Naming

**Affected files:** `architecture.md`, `packages.md`, `capture-pipeline.md`, `browser-runtime.md`, `glossary.md`

**Contradiction:** Same subsystem called "Capture Manager" in `architecture.md` package list, "Capture Pipeline" in `packages.md` and `capture-pipeline.md`, and "Capture Manager" in `browser-runtime.md` internal components.

**Proposed decision:**
- Architectural name: **Capture Pipeline** (matches glossary and spec file)
- Package directory: **`capture-pipeline/`** (consistent with architectural name)
- All references to "Capture Manager" in `architecture.md`, `browser-runtime.md`, and `capture-pipeline.md` changed to "Capture Pipeline"
- `glossary.md`: Add "Capture Pipeline" entry (reuses existing §82 definition), remove any "Capture Manager" references
- `browser-runtime.md`: Rename internal "Capture Manager" sub-component to "Screenshot Manager" to disambiguate from the platform-level Capture Pipeline

**Rationale:** "Capture Pipeline" more accurately describes the subsystem — it's a pipeline of capture operations (queue → persist → assign IDs → retention → export), not just a "manager." The Browser Runtime's internal screenshot capture sub-component is an implementation detail and should not share a name with the platform-level subsystem.

**Files that must be updated:**
- `architecture.md`: Repository layout, prose references, diagrams
- `packages.md`: Platform Package listing
- `capture-pipeline.md`: Internal prose (already uses "Capture Pipeline" in title, "Capture Manager" in body)
- `browser-runtime.md`: Rename sub-component
- `glossary.md`: Add entry
- `visual-context-engine.md`: Any references
- `mcp.md`: Any references
- `api-reference.md`: Any references
- `tool-reference.md`: Any references
- `roadmap.md`: Any references

**Risk:** Low. The file is already named `capture-pipeline.md`. This aligns prose with the filename and glossary.

---

### C3 — Circular / Conflicting Runtime Boundaries

**Affected files:** `architecture.md`

**Contradiction:** Dependency Rules (§399) show `Studio → VCE → Browser Runtime → Playwright`. Runtime Boundary (§745-756) says Browser Runtime communicates with Context Engine, implying an upward call.

**Proposed decision:** The Runtime Boundary section is correct in spirit but wrong in wording. Clarify:
- Browser Runtime communicates with Context Engine ONLY through the Event Bus (events emitted by Browser Runtime, consumed by VCE).
- VCE calls Browser Runtime's public API for capture operations (downward dependency).
- Browser Runtime NEVER calls VCE directly.
- Update the Runtime Boundary prose to explicitly state: "Reverse communication from Browser Runtime to VCE occurs exclusively through the Event Bus."

**Rationale:** This preserves the one-way dependency rule while accurately describing the real communication pattern where Browser Runtime emits events that VCE subscribes to.

**Files that must be updated:**
- `architecture.md`: Runtime Boundary section, add explicit mention of Event Bus mediation

**Risk:** None. This clarifies existing architecture without changing any boundary.

---

## Major Issues — Canonical Decisions

### M1 — `architecture.md` Lacks Relationship Section

**Proposed decision:** Add a "Relationship to Other Documents" section referencing:
- `product.md`, `design-principles.md`, `governance.md` (foundational)
- Every subsystem specification document (browser-runtime, visual-context-engine, capture-pipeline, project-scanner, selection-engine, source-hint-engine, mcp, studio, cli, sdk, plugin-api, plugin-system, framework-adapters, overlay-system)
- `glossary.md`, `packages.md`, `events.md`, `state-management.md`, `diagnostics.md`, `error-handling.md`, `security.md`, `privacy.md`
- `roadmap.md`, `enterprise.md`

**Files:** `architecture.md`

**Risk:** None.

---

### M2 — 26 Documents Missing Relationship Sections

**Proposed decision:** Add relationship sections to all 26 documents identified in the audit. Each section must:
- Reference architecture.md and glossary.md (universal)
- Reference immediate upstream dependencies
- Reference immediate downstream consumers
- Not be boilerplate; only include architecturally meaningful references

**Affected files (26):** See audit report M2.

**Risk:** Medium. Adding empty/meaningless sections degrades quality. Each section must add real navigation value.

---

### M3 — "Context Builder" Has No Specification

**Proposed decision:** Eliminate "Context Builder" as a separate architectural concept. The VCE specification (`visual-context-engine.md`) already defines "Stage 8 — Packet Assembly" that performs the exact function attributed to Context Builder. Remove "Context Builder" from all architecture diagrams. The VCE produces Context Packets directly.

**Affected files:**
- `architecture.md`: Remove Context Builder from diagrams and prose
- `visual-context-engine.md`: Verify Stage 8 covers all Context Builder responsibilities

**Rationale:** "Context Builder" only exists as a diagram node. The VCE already owns this function. Eliminating the redundant concept reduces architectural ambiguity.

**Risk:** Low. No existing specification depends on Context Builder.

---

### M4 — Startup Flow Bypasses Project Scanner

**Proposed decision:** Update the Startup Flow in `architecture.md` to include Project Scanner:
```
viskod start → CLI → Project Scanner → Browser Runtime → Studio → MCP Server → Ready
```

**Rationale:** The CLI orchestrates; Project Scanner performs the actual project detection. This aligns with documented responsibilities (`cli.md`: "CLI coordinates, does not own business logic"; `project-scanner.md`: "detecting frameworks, identifying project structure").

**Affected files:**
- `architecture.md`: Startup Flow diagram

**Risk:** None. This is a documentation fix, not a runtime change.

---

### M5 — "Visual Context Platform" vs "Viskod" vs "Platform"

**Proposed decision:**
- Add "Viskod" to glossary: "The Visual Context Platform. See Platform."
- Standardize usage: Use "Viskod" for product/marketing contexts, "the Platform" for architectural contexts when referring to the system as a whole.
- "Visual Context Platform" remains the canonical product category descriptor.

**Affected files:**
- `glossary.md`: Add "Viskod" entry
- All documents: No bulk rename needed; existing usage is generally context-appropriate. The glossary definition removes ambiguity.

**Risk:** None.

---

### M6 — "Selection Engine" Missing from Repository Layout

**Proposed decision:** Add `selection-engine/` to the repository layout in `architecture.md` §220 and to the Core Packages section of `packages.md`.

Selection Engine is a Platform Package that:
- Converts user pointer events into structured selections
- Validates DOM node candidates
- Manages selection state
- Resides between Studio (which captures user interaction) and Browser Runtime (which has DOM access)
- Depends on Browser Runtime (for DOM access) and the Event Bus (for receiving pointer events from the overlay)

**Affected files:**
- `architecture.md`: Repository layout, package list, diagrams
- `packages.md`: Platform Package listing
- `browser-runtime.md`: Clarify that Selection Engine coordination is via Overlay → Browser Runtime → Event Bus → Selection Engine

**Risk:** Low. The Selection Engine already has a specification and appears in architecture diagrams.

---

### M7 — Overlay System vs Overlay Manager Naming

**Proposed decision:**
- The architectural concept is "Overlay System" (matches `overlay-system.md` and glossary).
- The Browser Runtime internal component that renders the overlay is "Overlay Manager" (it manages the overlay lifecycle within Browser Runtime).
- Updated `architecture.md` §1083 to clarify: "The Overlay System is the architectural concept. The Overlay Manager (within Browser Runtime) is the component that renders it."
- `browser-runtime.md`: Keep "Overlay Manager" as internal component name; add reference to Overlay System spec.

**Rationale:** The distinction is valid: Overlay System = architectural concept, Overlay Manager = implementation component within Browser Runtime. Similar to "Diagnostics" (subsystem) vs "Diagnostics Manager" (Browser Runtime internal).

**Affected files:**
- `architecture.md`: Add clarifying sentence
- `glossary.md`: Ensure both terms are defined or one is clearly the canonical term

**Risk:** None.

---

### M8 — No Framework Adapter Relationship in Extension Points

**Proposed decision:** Add Framework Adapters to the Extension Points diagram in `architecture.md` §763-788:
```
Framework Adapter (Next.js)
Framework Adapter (SvelteKit)
Framework Adapter (Remix)
    ↓
Source Hint Engine
    ↓
Project Scanner
```

And add `framework-adapters.md` to the `architecture.md` relationship section.

**Affected files:**
- `architecture.md`: Extension Points diagram
- `framework-adapters.md`: Add relationship section

**Risk:** None.

---

## Minor Issues — Summary

All N1-N14 issues from the audit will be resolved:
- N1: Add missing glossary entries
- N2: Remove or document code block IDs; use consistent formatting
- N3: Standardize "Last Updated" dates where absent
- N4: Deduplicate performance targets; keep in subsystem docs, reference from architecture.md
- N5: Disambiguate "capability" — use "permission capability" for granular permissions
- N6: Change `mcp.md` and other pre-implementation specs to `Status: Proposed` or `Status: Non-v1`
- N7: Expand CLI and SDK glossary entries
- N8: Update `capture-pipeline.md` body to consistently use "Capture Pipeline"
- N9: Fix `studio.md` diagram to align with canonical model
- N10: Clarify Diagnostics is a cross-cutting subsystem, not a package
- N11: Add "Context Explorer" and "Capture History" glossary entries
- N12: Adopt consistent RFC 2119 keyword usage (MUST, SHOULD, MAY) across all docs
- N13: Rename `resources.md` to clarify it's about runtime resource management, not API resources. Add "Runtime Resource" glossary entry.
- N14: Add cross-reference between `api-reference.md` and `plugin-api.md`

---

## Implementation Order

1. `glossary.md` — Establish canonical terminology first (C2, M5, M7, N1, N5, N7, N11, N13)
2. `architecture.md` — Fix all diagrams, boundary rules, startup flow, extension points, repository layout, add relationship section (C1, C3, M1, M4, M6, M7, M8)
3. `packages.md` — Align naming with canonical terminology (C2, M6)
4. `capture-pipeline.md` — Align internal prose with canonical name (C2, N8)
5. `browser-runtime.md` — Rename internal sub-component, fix overlay references (C2, M7)
6. `visual-context-engine.md` — Clarify Packet Assembly = former Context Builder (M3)
7. `studio.md` — Fix architecture diagram (N9)
8. `mcp.md` — Status change to Proposed (N6)
9. All other subsystem docs — Add relationship sections (M2, 26 files)
10. `resources.md` — Rename/clarify scope (N13)
11. Final pass — Consistency check across all 50 documents
