# Implementation Decision Records

> **Purpose:** Record implementation-level decisions that do not affect architecture
> **Authority:** Architecture (`/docs`) → Specifications (`/specs`) → Decision Records → Source Code

---

## Scope

This directory records implementation-level decisions. These are choices about **how** an approved specification is built — not about **what** the architecture defines.

Implementation decisions may cover:

- Library selection (e.g., which IPC library, which serialisation format)
- File and module naming conventions
- Internal algorithms and data structures
- IPC transport technology (e.g., named pipes vs Unix sockets vs stdio)
- Local database technology (e.g., SQLite vs LevelDB)
- Testing framework and tool selection
- Build tooling and bundler configuration
- Logging library and format
- Package manager choices within approved constraints

---

## What Does NOT Belong Here

Decisions that affect these areas do **not** belong in implementation decision records. They require an RFC:

- Product scope or positioning
- Subsystem ownership boundaries
- Dependency direction between subsystems
- Runtime boundary rules
- Public API contracts
- Architectural invariants
- Canonical terminology redefinitions

If a proposed implementation decision would effectively change any of the above, it must go through the RFC process (`docs/rfcs.md`).

---

## Decision Record Template

Every decision record must follow this structure:

```markdown
# DEC-###: Title

**Date:** YYYY-MM-DD
**Status:** Proposed | Accepted | Rejected | Superseded
**Author:**
**Related Specification:**

## Context

Why this decision is necessary. What problem it solves.

## Decision

What was decided.

## Alternatives Considered

- Option A — advantages and disadvantages
- Option B — advantages and disadvantages

## Consequences

Positive and negative outcomes of this decision.

## Supersedes

DEC-### (if applicable)
```

---

## Decision Record Lifecycle

| Status | Meaning |
|--------|---------|
| **Proposed** | Under discussion |
| **Accepted** | Approved for implementation |
| **Rejected** | Not proceeding |
| **Superseded** | Replaced by a later decision |

---

## Numbering

Decision records use sequential numbering: `DEC-001`, `DEC-002`, etc.

Numbers are never reused.

---

## Relationship to Specifications

- A specification may reference decision records for implementation guidance.
- A decision record must cite the specification it serves.
- A decision record may not contradict an approved specification.
