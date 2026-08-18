
> **Navigation Specification**
>
> Version: 1.0
>
> Status: **Locked**

---

# Purpose

The Navigation subsystem defines how users move throughout the Viskod Studio.

Its purpose is to make every capability easily discoverable while preserving orientation, efficiency and predictability.

Navigation should minimise cognitive load.

Users should always know where they are and where they can go next.

---

# Design Philosophy

The Navigation subsystem follows one principle:

> **Users should navigate the platform, not the implementation.**

Navigation should reflect user workflows rather than internal architecture.

---

# Responsibilities

The Navigation subsystem is responsible for:

* application navigation
* workspace organisation
* panel navigation
* command routing
* history navigation
* deep linking

It is not responsible for:

* business logic
* state ownership
* browser automation
* Context Packet generation
* project analysis

---

# Navigation Architecture

```text id="nh7w5k"
Application

↓

Workspace

↓

Feature

↓

Panel

↓

Section

↓

Content
```

Navigation should become progressively more specific.

---

# Navigation Principles

Navigation should be:

* predictable
* shallow
* consistent
* keyboard-friendly
* discoverable
* deterministic

Users should rarely need more than three interactions to reach any primary feature.

---

# Global Navigation

Global navigation provides access to the primary areas of Studio.

Examples:

```text id="cf4x1v"
Workspace

Captures

Projects

Diagnostics

Settings
```

Primary destinations should remain stable across releases.

---

# Workspace Navigation

Within the Workspace, users navigate between:

* Browser Session
* Context Explorer
* Selection Inspector
* Project Explorer
* Diagnostics

Workspace navigation should preserve inspection context.

---

# Context Navigation

Users should be able to move between related entities.

Examples include:

* selection → hierarchy
* hierarchy → parent
* hierarchy → child
* source hint → project
* capture → diagnostics

Relationships should be traversable with minimal interaction.

---

# Capture Navigation

Users may browse:

* previous captures
* latest capture
* pinned captures
* bookmarked captures

Capture navigation should never modify stored captures.

---

# Project Navigation

Project navigation includes:

* workspace overview
* detected routes
* source hints
* framework information
* configuration metadata

Projects should remain independent of active browser sessions.

---

# History Navigation

Navigation history records:

* visited pages
* viewed captures
* opened panels
* selected projects

History should support:

* back
* forward
* recent locations

Navigation history should not affect platform state.

---

# Deep Linking

Every major resource should expose a stable address.

Examples include:

```text id="jt8d6p"
Capture

Project

Selection

Diagnostic

Settings Page
```

Deep links should remain valid across sessions whenever possible.

---

# Search Navigation

Search should enable direct navigation to:

* captures
* projects
* diagnostics
* source hints
* settings
* commands

Search should prioritise relevance and speed.

---

# Keyboard Navigation

The interface should support:

* global shortcuts
* panel switching
* focus traversal
* search activation
* command execution

Keyboard navigation should be a first-class experience.

---

# Command Palette

The Command Palette provides quick access to:

* navigation
* commands
* searches
* settings
* recent resources

The Command Palette should complement—not replace—traditional navigation.

---

# Breadcrumbs

Breadcrumbs should indicate the current navigation hierarchy.

Example:

```text id="v5n2hk"
Workspace

>

Capture

>

Selection

>

Hierarchy
```

Breadcrumbs should reflect logical structure rather than file paths.

---

# Navigation State

Navigation state includes:

* current destination
* previous destination
* active workspace
* selected panel
* open resources

Navigation state should remain synchronised with platform state.

---

# Accessibility

Navigation should support:

* keyboard-only operation
* screen readers
* focus indicators
* logical tab order
* accessible labels

Every destination should remain reachable without a pointing device.

---

# Performance Targets

Primary navigation

```text id="g4u8wr"
<100 ms
```

Panel transition

```text id="n6k1pa"
<50 ms
```

Command Palette

```text id="e9d7qx"
<100 ms
```

Search navigation

```text id="p2m5jc"
<100 ms
```

Navigation should feel immediate.

---

# Extensibility

Future navigation capabilities may include:

* plugin destinations
* collaborative workspaces
* recently shared resources
* cloud workspaces
* enterprise dashboards

New destinations should integrate without restructuring the primary navigation model.

---

# Failure Policy

If a destination cannot be opened:

* preserve the current location
* present contextual diagnostics
* allow recovery
* avoid losing user context

Navigation failures should remain isolated.

---

# Relationship to Other Documents

* [Architecture](./architecture.md) — system boundaries
* [Glossary](./glossary.md) — canonical terminology
* [Studio](./studio.md) — the primary UI application
* [UI Architecture](./ui-architecture.md) — UI component structure
* [Command Palette](#command-palette) — referenced for command-based navigation

---

# Invariants

The Navigation subsystem guarantees:

* deterministic routing
* stable primary destinations
* reproducible deep links
* consistent history
* keyboard accessibility
* framework independence

These guarantees should remain stable across future versions.

---

# Navigation North Star

The Navigation subsystem exists to help users move through Viskod with confidence and efficiency.

Its responsibility is to provide a simple, predictable and accessible navigation model that reflects the way developers explore visual context rather than the way the platform is implemented.
