
> **Framework Adapter Specification**
>
> Version: 1.0
>
> Status: **Locked**

---

# Purpose

Framework Adapters enable Viskod to understand framework-specific project conventions while preserving a framework-agnostic core architecture.

Their purpose is to translate framework-specific knowledge into common platform abstractions.

Framework Adapters add understanding.

They do not change platform behaviour.

---

# Design Philosophy

Framework Adapters follow one principle:

> **Framework-specific knowledge belongs at the edge of the platform.**

The core platform should never depend on a particular frontend framework.

---

# Responsibilities

Framework Adapters are responsible for:

* detecting framework conventions
* mapping project structures
* identifying routes
* identifying layouts
* generating framework metadata
* assisting Source Hint generation

They are not responsible for:

* browser automation
* semantic analysis
* code generation
* Context Packet assembly
* project ownership

---

# Architecture

```text id="t5m8vk"
Repository

↓

Project Scanner

↓

Framework Detection

↓

Framework Adapter

↓

Platform Abstractions

↓

Visual Context Platform
```

Adapters translate framework conventions into common platform concepts.

---

# Design Goals

Framework Adapters should be:

* lightweight
* deterministic
* independently testable
* version-aware
* extensible
* replaceable

Adding a new framework should not require changes to existing adapters.

---

# Supported Frameworks

Initial framework support includes:

```text id="f2k9rp"
React

Next.js

Svelte

SvelteKit

Vue

Nuxt

Solid

Astro

Remix

Qwik

Angular
```

Support should expand through additional adapters rather than modifications to the platform core.

---

# Common Abstractions

Every adapter translates framework concepts into common platform concepts.

Examples include:

```text id="h6v1qd"
Route

Layout

Page

Component

Workspace

Entry Point

Static Asset
```

Consumers should never require framework-specific knowledge.

---

# Route Resolution

Adapters should identify:

* static routes
* dynamic routes
* nested routes
* layout hierarchy
* route groups

Routes should be represented using platform abstractions.

---

# Layout Resolution

Where supported, adapters should identify:

* root layouts
* nested layouts
* shared layouts
* application shells

Layout information assists visual reasoning.

---

# Component Discovery

Adapters may identify likely component locations using:

* framework conventions
* directory structure
* naming conventions
* routing metadata

Component discovery should remain probabilistic.

---

# Framework Metadata

Adapters may expose:

* framework name
* framework version
* routing model
* rendering model
* project structure
* supported capabilities

Metadata should remain descriptive rather than prescriptive.

---

# Source Hint Integration

Framework Adapters provide evidence to the Source Hint Engine.

Examples include:

* route-to-file mapping
* layout hierarchy
* framework conventions
* component locations

Adapters contribute evidence but do not determine final confidence.

---

# Version Awareness

Adapters should recognise supported framework versions.

Where behaviour differs significantly between versions:

* detect the version
* apply the appropriate strategy
* report compatibility

Unsupported versions should produce diagnostics.

---

# Adapter Interface

Every adapter should expose a common interface.

Responsibilities include:

* initialise
* discover metadata
* resolve routes
* locate layouts
* provide source hint evidence

The interface should remain stable across platform versions.

---

# Isolation

Adapters should remain isolated from one another.

An adapter should never:

* depend on another adapter
* modify another adapter's output
* assume another framework

Isolation simplifies maintenance.

---

# Performance Targets

Framework detection

```text id="r9w3mn"
<100 ms
```

Adapter initialisation

```text id="j2c7xp"
<50 ms
```

Route discovery

```text id="v5q8lh"
<100 ms
```

Metadata generation

```text id="y4f1zt"
<50 ms
```

Framework support should not significantly affect project scanning performance.

---

# Failure Policy

If an adapter cannot understand a project:

* report diagnostics
* preserve detected metadata
* continue generic scanning
* avoid blocking the platform

Unknown frameworks should remain usable through generic project analysis.

---

# Extensibility

Future adapters may support:

* React Native
* Electron
* Tauri
* Flutter Web
* Blazor
* custom enterprise frameworks

New adapters should integrate through the existing adapter interface.

---

# Relationship to Other Documents

* [Architecture](./architecture.md) — extension points
* [Glossary](./glossary.md) — canonical terminology
* [Project Scanner](./project-scanner.md) — consumes adapter output for framework detection
* [Source Hint Engine](./source-hint-engine.md) — consumes adapter output for source hints

---

# Invariants

Framework Adapters guarantee:

* framework isolation
* deterministic output
* stable platform abstractions
* version awareness
* modular implementation
* extensible architecture

These guarantees should remain stable across future releases.

---

# Framework Adapter North Star

Framework Adapters exist to bridge the gap between framework-specific implementations and Viskod's framework-agnostic architecture.

Their responsibility is to translate conventions into consistent platform abstractions, enabling AI coding agents to reason about diverse frontend ecosystems without embedding framework-specific logic into the core platform.
