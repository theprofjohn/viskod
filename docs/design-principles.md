
> **Design Principles**
>
> Version: 1.0
>
> Status: **Locked**

---

# Purpose

The Design Principles define the fundamental engineering philosophy of Viskod.

Their purpose is to guide architectural decisions, implementation choices and future platform evolution through a consistent set of principles.

When uncertainty exists, these principles take precedence over implementation preferences.

---

# Design Philosophy

Viskod follows one overarching principle:

> **Build systems that make AI more reliable by improving the quality of evidence rather than increasing the amount of inference.**

Every subsystem should reinforce this objective.

---

# Principles Hierarchy

```text
Vision

↓

Design Principles

↓

Architecture

↓

Specifications

↓

Implementation
```

Implementation should never violate a higher-level principle.

---

# Principle 1 — Evidence Before Inference

Evidence is always preferable to assumptions.

The platform should collect verifiable information directly from authoritative sources before attempting interpretation.

Examples of evidence include:

* browser state
* repository structure
* DOM information
* source files
* framework metadata
* build configuration

Inference should only supplement evidence, never replace it.

---

# Principle 2 — Browser is the Source of Truth

The browser represents the actual user experience.

Whenever visual behaviour differs from source code assumptions, browser evidence takes precedence.

Platform features should prioritise:

* rendered interfaces
* runtime behaviour
* visual hierarchy
* interaction state

The browser is authoritative for presentation.

---

# Principle 3 — Repository is the Source of Truth

Repositories define application structure and implementation.

Project understanding should originate from:

* source code
* configuration
* dependency metadata
* project layout
* build systems

Generated artefacts should never replace repository evidence.

---

# Principle 4 — Determinism Over Probability

Platform outputs should be reproducible.

Given identical inputs, the platform should produce materially identical outputs.

Avoid:

* hidden randomness
* undocumented heuristics
* non-deterministic ordering
* unpredictable behaviour

Deterministic systems are easier to trust, debug and test.

---

# Principle 5 — Platform Before Product

Viskod is a platform.

Features should strengthen reusable platform capabilities rather than solving isolated use cases.

Every new capability should answer:

* Can it become a reusable platform service?
* Can other components benefit?
* Does it improve extensibility?

Platform value compounds over time.

---

# Principle 6 — Stable Public Contracts

Public APIs should evolve carefully.

Stable contracts include:

* SDK interfaces
* Plugin API
* MCP interfaces
* CLI behaviour
* event schemas

Internal implementation may change freely.

Public behaviour should not.

---

# Principle 7 — Local First

User data should remain under user control whenever practical.

The platform should favour:

* local processing
* local storage
* explicit synchronisation
* offline capability

Cloud functionality should enhance, not replace, local workflows.

---

# Principle 8 — MCP First

External AI systems should integrate through Model Context Protocol.

MCP provides:

* interoperability
* portability
* standardisation
* implementation independence

Native integrations should complement—not replace—MCP.

---

# Principle 9 — Explicit Over Implicit

Platform behaviour should be understandable.

Prefer:

* explicit configuration
* documented defaults
* visible state
* traceable execution

Avoid hidden behaviour whenever practical.

---

# Principle 10 — Composition Over Coupling

Subsystems should compose through well-defined interfaces.

Subsystems should not depend on each other's internal implementation.

Loose coupling improves:

* maintainability
* testing
* extensibility
* scalability

---

# Principle 11 — Security by Default

Secure behaviour should require minimal user effort.

The platform should favour:

* least privilege
* capability-based permissions
* isolated plugins
* secure defaults
* explicit authorisation

Convenience should never weaken security.

---

# Principle 12 — Privacy by Design

User privacy should be considered during system design rather than added later.

Platform components should:

* minimise collected information
* expose transparent behaviour
* avoid unnecessary persistence
* provide user control

Privacy should remain a platform capability.

---

# Principle 13 — Documentation is Part of the Product

Architecture is incomplete without documentation.

Every major capability should include:

* purpose
* responsibilities
* interfaces
* constraints
* examples where appropriate

Documentation should evolve with implementation.

---

# Principle 14 — Progressive Extensibility

The platform should anticipate future growth.

Extension mechanisms should support:

* plugins
* SDKs
* framework adapters
* enterprise capabilities

Extensibility should not compromise simplicity.

---

# Principle 15 — Graceful Failure

Failures should be predictable.

When failures occur, the platform should:

* preserve user data
* maintain integrity
* isolate faults
* emit diagnostics
* recover when possible

Unexpected behaviour is more harmful than reduced functionality.

---

# Decision Checklist

Before introducing a significant change, evaluate whether it:

* strengthens evidence quality
* preserves determinism
* maintains public compatibility
* improves platform capabilities
* respects subsystem boundaries
* aligns with security and privacy principles
* remains implementation independent

A proposal that violates multiple principles requires exceptional justification.

---

# Relationship to Other Documents

The Design Principles guide:

* Product
* Architecture
* Browser Runtime
* Visual Context Engine
* Plugin API
* SDK
* Governance
* Roadmap

These principles provide the foundation upon which all other documents are built.

---

# Invariants

The Design Principles guarantee:

* evidence-driven architecture
* deterministic platform behaviour
* stable public interfaces
* implementation independence
* extensibility
* long-term architectural consistency

These guarantees should remain stable across future platform versions.

---

# Design Principles North Star

The Design Principles exist to ensure that every architectural and implementation decision strengthens Viskod as a deterministic, evidence-driven Visual Context Platform.

Their responsibility is to provide a durable engineering philosophy that guides the platform's evolution while preserving its core identity, technical integrity and long-term maintainability.
