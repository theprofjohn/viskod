
> **Studio Specification**
>
> Version: 1.0
>
> Status: **Locked**

---

# Purpose

Studio is the graphical interface for Viskod.

It walks the user through the first product workflow — **Report UI issue →
Prepare agent handoff → Verify fix** — by pointing at elements in a running
local app instead of operating selectors, packets, or IDs.

Studio is not an IDE.

Studio is not a code editor.

Studio is not an AI coding assistant.

The primary user journey is the three-stage workflow below. Context Explorer,
Diagnostics, and raw evidence remain available as secondary expandable views.

---

# Design Philosophy

Studio follows one principle:

> **Visual context should be easier to understand than source code.**

Every screen should help users understand what the browser is actually rendering.

---

# Responsibilities

Studio is responsible for:

* driving the Report UI issue → Prepare agent handoff → Verify fix workflow
* managing browser sessions
* presenting diagnostics
* visualising selections
* displaying Context Packets (secondary, expandable)
* exposing project metadata
* browsing capture history
* configuring platform settings

It is not responsible for:

* editing source code
* generating code
* invoking external coding agents (it prepares handoffs the connected agent
  can consume)
* browser automation details
* AI conversations
* repository management

---

# High-Level Architecture

```text id="r4m7pk"
Visual Context Engine
        │
        ▼
MCP Server ──── Event Bus ──── State Store
        │                          │
        ▼                          ▼
Studio Backend ─────────── Studio UI
```

Studio consumes platform services through the Event Bus and State Store.

It should not duplicate platform logic.

---

# Design Goals

Studio should be:

* fast
* uncluttered
* deterministic
* responsive
* discoverable
* keyboard-friendly

Every interface should prioritise clarity over feature density.

---

# User-Facing Stages

The primary journey has three stages:

## Report

* app URL input and `Open app`
* one primary `Report UI issue` button
* "Hover over the problem and click it" while selecting
* after selection: a redacted target summary and `Continue`

## Prepare for agent

* fields labeled `What is wrong?` and `What should happen?`, severity select
* one `Prepare agent handoff` button
* `Handoff ready` with a copyable agent prompt/ID
* the UI never claims Studio invoked an external coding agent

## Verify

* before/after evidence with a plain-language status
* `Accept fix`, `Issue persists`, and `Needs follow-up` buttons
* comparison status is evidence, not truth: a changed screenshot never
  auto-accepts the fix

Selectors, packet JSON, local paths, and IDs never appear as primary UI
labels.

# Core Workspace

The primary workspace consists of:

* Browser Session
* Context Explorer
* Selection Inspector
* Project Explorer
* Diagnostics Panel

Context Explorer, Diagnostics, and raw evidence are secondary expandable
views behind the three user-facing stages.

These areas should remain logically independent.

---

# Browser Session

The Browser Session displays:

* active browser
* connected pages
* current URL
* viewport information
* capture status

Studio should accurately reflect runtime state.

---

# Context Explorer

The Context Explorer allows users to inspect:

* Context Packets
* hierarchy
* semantic structure
* layout analysis
* source hints
* confidence scores

Information should be grouped rather than presented as raw data.

---

# Selection Inspector

The Selection Inspector displays:

* selected element
* geometry
* computed styles
* accessibility metadata
* hierarchy
* diagnostics

Selection details should update immediately after a new selection.

---

# Project Explorer

The Project Explorer provides:

* project information
* framework detection
* routes
* workspace structure
* source hints
* scanner diagnostics

Project information should complement browser context rather than replace it.

---

# Diagnostics Panel

The Diagnostics Panel presents:

* runtime health
* warnings
* errors
* performance metrics
* subsystem status

Diagnostics should remain secondary to inspection tasks.

---

# Capture History

Studio maintains a history of completed captures.

Each capture includes:

* Capture ID
* timestamp
* page
* selection
* packet version

History entries should remain immutable.

---

# Navigation

Primary navigation may include:

```text id="w3k1hy"
Workspace

Captures

Projects

Diagnostics

Settings
```

Navigation should remain shallow and predictable.

---

# Search

Studio should support searching across:

* captures
* projects
* diagnostics
* source hints
* metadata

Search should favour speed over advanced query syntax.

---

# State Synchronisation

Studio synchronises with:

* Browser Runtime
* MCP Server
* Capture Pipeline
* Diagnostics subsystem

Studio should reflect current platform state without polling unnecessarily.

---

# Accessibility

Studio should support:

* keyboard navigation
* screen readers
* high-contrast themes
* scalable typography
* visible focus indicators

Accessibility is a platform requirement.

---

# Responsiveness

Studio should adapt to:

* laptops
* large monitors
* ultra-wide displays

Mobile interfaces are outside the scope of the initial release.

---

# Performance Targets

Workspace load

```text id="m7j3nb"
<500 ms
```

Panel switching

```text id="p6d2xt"
<100 ms
```

Selection update

```text id="q2h8cv"
<50 ms
```

Capture history loading

```text id="z8g5lr"
<200 ms
```

The interface should feel immediate.

---

# Extensibility

Future Studio modules may include:

* visual diff explorer
* accessibility explorer
* design token browser
* plugin marketplace
* workflow automation
* collaboration tools

Extensions should integrate without altering core workspace concepts.

---

# Failure Policy

If a subsystem becomes unavailable:

* preserve the remaining workspace
* indicate degraded functionality
* display relevant diagnostics
* avoid blocking unrelated features

Studio should degrade gracefully.

---

# Invariants

Studio guarantees:

* read-only inspection
* deterministic presentation
* immutable capture history
* consistent navigation
* clear subsystem boundaries
* framework independence

These guarantees should remain stable across future versions.

---

# Relationship to Other Documents

This document specifies the Studio interface. It is complemented by:

* [Architecture](./architecture.md) — system boundaries and dependency direction
* [Glossary](./glossary.md) — canonical terminology
* [Visual Context Engine](./visual-context-engine.md) — produces the content Studio displays
* [Browser Runtime](./browser-runtime.md) — provides browser state
* [MCP Server](./mcp.md) — parallel interface for AI systems
* [Navigation](./navigation.md) — user navigation model
* [State Management](./state-management.md) — runtime state synchronisation
* [UI Architecture](./ui-architecture.md) — UI component architecture

---

# Studio North Star

Studio exists to take a developer from "this UI is broken" to "the fix is
verified" without exposing selectors, packets, or handoff mechanics.

Its responsibility is to present the state of a running application through a
clear, structured and trustworthy interface, enabling developers to report
issues by pointing, prepare agent handoffs, and verify rendered results —
without becoming another IDE or code editor.
