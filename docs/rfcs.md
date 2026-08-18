
> **Request for Comments (RFC) Process**
>
> Version: 1.0
>
> Status: **Locked**

---

# Purpose

The RFC process defines how significant changes to Viskod are proposed, evaluated, documented and adopted.

Its purpose is to ensure that architectural evolution is deliberate, transparent and evidence-driven.

RFCs are intended for major decisions.

They are not required for routine implementation work.

---

# Design Philosophy

The RFC process follows one principle:

> **Discuss architecture before implementing architecture.**

Every major platform decision should be documented before engineering effort begins.

---

# Objectives

The RFC process aims to:

* preserve architectural consistency
* encourage constructive discussion
* document design rationale
* reduce unnecessary redesign
* improve long-term maintainability
* create institutional knowledge

---

# When an RFC is Required

An RFC should be created for changes involving:

* platform architecture
* subsystem boundaries
* public APIs
* SDK behaviour
* Plugin API changes
* CLI behaviour
* Context Packet schema
* event schemas
* storage architecture
* security model
* enterprise capabilities
* major performance strategy
* long-term roadmap changes

---

# When an RFC is NOT Required

Routine work does not require an RFC.

Examples include:

* bug fixes
* documentation corrections
* code refactoring
* test improvements
* internal optimisation
* dependency updates
* CI improvements

These changes should still follow normal review processes.

---

# RFC Lifecycle

```text id="f8t3zw"
Draft

↓

Discussion

↓

Revision

↓

Architecture Review

↓

Accepted

↓

Implementation

↓

Released
```

Alternative outcomes:

```text id="g5m2pk"
Draft

↓

Rejected
```

or

```text id="v9q7hl"
Draft

↓

Superseded
```

---

# RFC Status

Each RFC should have one status.

| Status      | Meaning                     |
| ----------- | --------------------------- |
| Draft       | Initial proposal            |
| Discussion  | Community feedback          |
| Review      | Formal architectural review |
| Accepted    | Approved for implementation |
| Implemented | Delivered                   |
| Rejected    | Not proceeding              |
| Withdrawn   | Author withdrew proposal    |
| Superseded  | Replaced by another RFC     |

---

# RFC Structure

Every RFC should include:

```text id="m4k9xn"
Title

Status

Authors

Date

Summary

Motivation

Background

Proposal

Alternatives

Compatibility

Migration

Risks

Open Questions

Decision

References
```

The structure should remain consistent across all RFCs.

---

# Proposal Requirements

A proposal should clearly explain:

* the problem
* why it matters
* proposed solution
* expected benefits
* trade-offs
* implementation considerations
* compatibility impact
* future implications

Evidence should support significant claims.

---

# Alternatives

Every RFC should document reasonable alternatives.

Alternatives should include:

* advantages
* disadvantages
* reasons for rejection

Documenting rejected options provides valuable future context.

---

# Compatibility Assessment

Each RFC should explicitly describe:

* breaking changes
* backwards compatibility
* migration requirements
* deprecated behaviour
* API impact
* plugin impact

Compatibility should be a first-class consideration.

---

# Architectural Review

Architectural review should evaluate:

* consistency with Product Vision
* compliance with Design Principles
* subsystem boundaries
* public contracts
* long-term maintainability
* implementation feasibility

Architectural integrity takes precedence over implementation convenience.

---

# Decision Criteria

An RFC should generally be accepted only if it:

* solves a meaningful problem
* aligns with platform philosophy
* preserves architectural consistency
* maintains public contracts where practical
* provides sufficient long-term value
* introduces manageable complexity

---

# Implementation

Accepted RFCs should:

* update relevant documentation
* define implementation milestones
* identify affected subsystems
* specify testing expectations
* define success criteria

Implementation should follow the accepted proposal.

---

# Documentation Updates

After acceptance, related documents should be updated where applicable:

* Product
* Architecture
* Design Principles
* SDK
* Plugin API
* API Reference
* Roadmap
* Changelog

Documentation should reflect architectural decisions before release.

---

# Superseding RFCs

New RFCs may supersede earlier proposals.

The superseding RFC should:

* reference previous RFCs
* explain why replacement is necessary
* describe compatibility implications
* preserve historical context

Historical decisions should remain discoverable.

---

# RFC Repository

RFCs should be stored using sequential numbering.

Example structure:

```text id="n6w4cy"
rfcs/

RFC-0001-platform-vision.md

RFC-0002-context-packets.md

RFC-0003-plugin-api.md

RFC-0004-browser-runtime.md
```

RFC numbers should never be reused.

---

# Relationship to Other Documents

The RFC process complements:

* Governance
* Design Principles
* Architecture
* Roadmap
* Changelog
* Contributing

Governance defines how decisions are made.

RFCs document individual architectural decisions.

---

# Invariants

The RFC process guarantees:

* transparent architectural discussions
* documented decision history
* consistent proposal structure
* evidence-driven evaluation
* preservation of architectural integrity
* long-term institutional knowledge

These guarantees should remain stable throughout the lifetime of the project.

---

# RFC Process North Star

The RFC process exists to ensure that every significant architectural change to Viskod is proposed, evaluated and documented before implementation.

Its responsibility is to preserve the long-term integrity of the Visual Context Platform by providing a transparent, structured and repeatable decision-making framework that balances innovation with architectural stability.
