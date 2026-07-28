
> **Package Architecture Specification**
>
> Version: 1.0
>
> Status: **Locked**

---

# Purpose

The Package Architecture defines how the Viskod codebase is organised into independent, cohesive and reusable packages.

Its purpose is to minimise coupling, establish clear ownership and enable long-term scalability.

Packages should express architectural boundaries rather than repository structure.

---

# Design Philosophy

The Package Architecture follows one principle:

> **Every package owns one capability.**

Packages should communicate through stable contracts rather than internal implementation details.

---

# Responsibilities

The Package Architecture is responsible for:

* defining package boundaries
* establishing dependency rules
* promoting modularity
* enabling independent development
* supporting future extensibility

It is not responsible for:

* build configuration
* deployment
* runtime orchestration
* version control workflows
* package publishing

---

# Architectural Overview

```text id="p4m7tw"
Applications

↓

Platform Packages

↓

Core Packages

↓

Shared Packages

↓

External Dependencies
```

Dependencies should always point downward.

---

# Package Categories

The repository is organised into four package categories.

```text id="j6h2rq"
Applications

Platform

Core

Shared
```

Each category has a distinct responsibility.

---

# Applications

Applications provide executable entry points.

Examples include:

* Studio
* MCP Server
* CLI
* Browser Extension

Applications should contain minimal business logic.

---

# Platform Packages

Platform packages implement major platform capabilities.

Examples:

* Browser Runtime
* Capture Pipeline
* Visual Context Engine
* Selection Engine
* Source Hint Engine
* Project Scanner
* Diagnostics

---

# Core Packages

Core packages provide reusable platform foundations.

Examples:

* schemas
* contracts
* events
* identifiers
* utilities
* configuration

Core packages should have minimal external dependencies.

---

# Shared Packages

Shared packages contain presentation and infrastructure utilities.

Examples:

* UI components
* icons
* themes
* common hooks
* helper libraries

Shared packages should remain generic.

---

# Dependency Rules

Packages may depend only on:

* lower architectural layers
* published contracts
* stable interfaces

Packages must never depend on implementation details of sibling packages.

---

# Allowed Dependency Flow

```text id="z1f3dk"
Application

↓

Platform

↓

Core

↓

Shared
```

Reverse dependencies are prohibited.

---

# Package Ownership

Every package has:

* a defined purpose
* clear ownership
* stable public interface
* internal implementation boundary

Only exported interfaces should be considered public.

---

# Public API

Every package should expose a single public entry point.

Consumers should avoid importing internal modules.

Public APIs should remain stable across minor releases.

---

# Internal Modules

Internal implementation details should remain private.

Examples include:

* helper functions
* internal models
* temporary utilities
* implementation-specific adapters

Internal modules may change without notice.

---

# Package Communication

Packages communicate through:

* typed interfaces
* events
* immutable data
* shared contracts

Communication should remain explicit.

---

# Versioning

Packages should follow semantic versioning.

Breaking changes require:

* interface updates
* migration guidance
* version increments

Version compatibility should be maintained wherever practical.

---

# Build Independence

Where practical, packages should support:

* independent testing
* isolated builds
* independent documentation
* standalone validation

Build independence improves maintainability.

---

# Testing Boundaries

Each package should include:

* unit tests
* contract tests
* integration tests where applicable

Packages should not rely on unrelated packages during testing.

---

# Performance

Packages should minimise:

* dependency depth
* startup overhead
* redundant abstractions
* unnecessary allocations

Architecture should prioritise clarity over micro-optimisation.

---

# Extensibility

Future package categories may include:

* enterprise features
* cloud services
* plugin packages
* SDK packages
* experimental modules

New packages should integrate without violating dependency rules.

---

# Failure Policy

If a package fails:

* isolate the failure
* preserve subsystem boundaries
* expose structured diagnostics
* avoid cascading failures

Failures should remain contained.

---

# Relationship to Other Documents

This document defines how code is organised into packages. It is complemented by:

* [Architecture](./architecture.md) — system boundaries and dependencies
* [Glossary](./glossary.md) — canonical terminology
* [Studio](./studio.md)
* [Browser Runtime](./browser-runtime.md)
* [Visual Context Engine](./visual-context-engine.md)
* [Capture Pipeline](./capture-pipeline.md)
* [Project Scanner](./project-scanner.md)
* [Selection Engine](./selection-engine.md)
* [Source Hint Engine](./source-hint-engine.md)
* [SDK](./sdk.md)
* [Plugin API](./plugin-api.md)

---

# Invariants

The Package Architecture guarantees:

* explicit ownership
* stable public APIs
* one-way dependencies
* modular composition
* implementation isolation
* long-term maintainability

These guarantees should remain stable across future versions.

---

# Package Architecture North Star

The Package Architecture exists to organise Viskod into clear, independent and maintainable modules.

Its responsibility is to ensure every package has a single purpose, communicates through stable contracts and evolves independently without compromising the overall integrity of the Visual Context Platform.
