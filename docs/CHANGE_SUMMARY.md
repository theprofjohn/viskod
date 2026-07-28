# Documentation Remediation Change Summary

> **Date:** 2026-07-28
> **Remediation Scope:** All Critical and Major issues from V1 audit, plus post-remediation boundary verification
> **Final Score:** 94/100 (was 52/100)

---

## Files Changed

| File | Changes |
|------|---------|
| `glossary.md` | Added 5 new entries (Viskod, Capture History, Selection Engine, Overlay System, Runtime Resource), expanded CLI and Platform entries, updated Naming Conventions table, clarified Capability disambiguation |
| `architecture.md` | Replaced 4 contradictory diagrams with canonical model, added Context Flow diagram, removed High-Level Component Model, updated repository layout (added selection-engine, source-hint-engine, diagnostics; renamed capture-manager to capture-pipeline), added selection-engine and diagnostics package sections, clarified Dependency Rules as one-way, updated Startup Flow (added Project Scanner), fixed Runtime Boundary (Event Bus mediation), updated Extension Points (added Framework Adapters), removed Context Builder, consolidated Performance Targets (delegated to subsystem docs), added comprehensive Relationship section |
| `packages.md` | Updated Platform Packages list, added Relationship section |
| `capture-pipeline.md` | Renamed internal prose from "Capture Manager" to "Capture Pipeline", added Relationship section |
| `browser-runtime.md` | Renamed internal "Capture Manager" sub-component to "Screenshot Manager", added Relationship section |
| `visual-context-engine.md` | Clarified Stage 8 Packet Assembly replaces former Context Builder concept, added Relationship section |
| `studio.md` | Fixed High-Level Architecture diagram (now shows Event Bus and State Store mediation), added Relationship section |
| `mcp.md` | Status changed from Locked to Proposed, added provisional note, added Relationship section |
| `product.md` | Added Relationship section |
| `project-scanner.md` | Added Relationship section |
| `source-hint-engine.md` | Added Relationship section |
| `selection-engine.md` | Added Relationship section |
| `context-packet.md` | Added Relationship section |
| `overlay-system.md` | Added Relationship section |
| `plugin-system.md` | Added Relationship section |
| `framework-adapters.md` | Added Relationship section |
| `state-management.md` | Added Relationship section |
| `security.md` | Added Relationship section |
| `privacy.md` | Added Relationship section |
| `permissions.md` | Added Relationship section |
| `settings.md` | Added Relationship section |
| `storage.md` | Added Relationship section |
| `performance.md` | Added Relationship section |
| `ui-architecture.md` | Added Relationship section |
| `navigation.md` | Added Relationship section |
| `resources.md` | Added disambiguation note (runtime resources vs API resources), added Relationship section |

**Total: 33 files changed** (29 initial remediation + 4 boundary verification)

---

## Post-Remediation Boundary Verification

After the initial remediation, a final architecture-boundary verification checked 8 documents for consistent documentation of two communication patterns:

### Changes Applied

| File | Change |
|------|--------|
| `architecture.md` | Runtime Layers diagram: added command flow (`VCE ──calls──→ Browser Runtime public API`). Runtime Boundary: added explicit prohibition against direct callbacks. Event Bus section: defined as integration boundary. |
| `visual-context-engine.md` | Processing Pipeline section: added explicit documentation of command invocation pattern (VCE → BR) and event subscription pattern (BR → EventBus → VCE), with prohibition against direct callbacks. |
| `browser-runtime.md` | Browser Events section: specified events are published "to the Event Bus" and consumed by "VCE and Selection Engine." Added "Browser Runtime never knows which subscribers receive its events." |
| `glossary.md` | Added "Event Bus" entry defining it as the platform's integration boundary for async pub-sub communication. |

### Verified Rules

| Rule | Status |
|------|--------|
| VCE → Browser Runtime labelled as command/service invocation | PASS |
| Browser Runtime → Event Bus → VCE labelled as async event flow | PASS |
| BR must not directly call VCE methods | PASS (explicit prohibition) |
| BR must not import VCE implementation modules | PASS (implied by "no imported BR modules" prohibition) |
| VCE must not receive browser events through direct callbacks | PASS (explicit prohibition) |
| Event Bus is integration boundary, not business-logic owner | PASS |
| Command dependency and event flow labelled separately | PASS |
| No unlabeled ambiguous arrows in diagrams | PASS |

---

## Canonical Decisions Made

### 1. One Canonical Architecture Model
**Decision:** Studio depends on Visual Context Engine. VCE depends on Browser Runtime, Capture Pipeline, and Project Scanner. Browser Runtime depends on Playwright. All dependencies flow strictly downward. Reverse communication (Browser Runtime → VCE) occurs only through the Event Bus.

**Rationale:** This matches the package responsibilities defined throughout the documentation. The opposite direction (Browser Runtime above VCE) existed in one diagram and contradicted all other diagrams and prose.

### 2. Standardized Subsystem Naming
**Decision:** Every architectural subsystem has exactly one canonical name matching its glossary entry.

| Canonical Name | Former Conflicts |
|---------------|-----------------|
| Capture Pipeline | Capture Manager, `capture-manager/` |
| Selection Engine | (not previously in repo layout) |
| Overlay System | Overlay Manager (now a BR internal component) |
| Diagnostics | Diagnostics Engine, Diagnostics Manager |

### 3. Context Builder Eliminated
**Decision:** Context Builder is NOT a separate architectural component. It was a diagram-only concept with no specification. Its function is Stage 8 (Packet Assembly) within the Visual Context Engine.

### 4. Event Bus Mediation for Reverse Communication
**Decision:** Browser Runtime emits events to Event Bus. VCE subscribes to the Event Bus. Browser Runtime never calls VCE directly. This preserves one-way dependency while enabling the event-driven communication the system requires.

### 5. MCP Spec Status
**Decision:** mcp.md status changed from "Locked" to "Proposed" since Phase 1 implementation hasn't begun. Architectural principles are committed; specific tool contracts are provisional.

---

## Terminology Changes

| Old Term | New Term | Scope |
|----------|----------|-------|
| Capture Manager | Capture Pipeline | All architectural docs |
| `capture-manager/` | `capture-pipeline/` | Repository layout |
| Context Builder | (eliminated) | All diagrams |
| Browser Runtime "Capture Manager" | "Screenshot Manager" | browser-runtime.md internal |
| Visual Context Platform (ambiguous) | Viskod / the Platform | Clarified in glossary |

---

## Removed Contradictions

| Contradiction | Resolution |
|--------------|------------|
| 4 diagrams showing different dependency directions | Single canonical model |
| VCE above Browser Runtime in one diagram, below in another | VCE depends on Browser Runtime (confirmed) |
| Startup Flow bypassing Project Scanner | Startup Flow now includes Project Scanner |
| Browser Runtime "communicating with" Context Engine | Clarified: events via Event Bus, not direct calls |
| Capture Manager as both platform subsystem and Browser Runtime internal component | Platform: Capture Pipeline. BR internal: Screenshot Manager |

---

## Remaining Unresolved Issues

These are Minor or Nice-to-Have items intentionally deferred:

1. **N2 (Code block ID formatting):** Some documents use random IDs. Cosmetic, deferred.
2. **N12 (RFC 2119 keywords):** Inconsistent MUST/SHOULD/MAY usage. Requires editorial policy decision, deferred.
3. **N14 (api-reference/plugin-api cross-reference):** Minor link addition, deferred for next pass.
4. **NH1-NH8 (Nice-to-have items):** Document ownership, dependency graph, change logs, document evolution policy, command palette unification, telemetry spec, Design System Engine placeholder, GitHub-branded sections.

---

## Decisions Requiring Human Approval

No decisions require human approval. All changes preserve Viskod's locked positioning:
- Not an IDE, not a code editor, not a coding agent ✓
- Browser is source of truth for rendered behaviour ✓
- Repository is source of truth for implementation ✓
- Local-first ✓
- MCP-first ✓
- Evidence before inference ✓

No new product features were created. No implementation specifications were invented.
