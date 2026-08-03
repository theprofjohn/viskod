
> **Overlay System Specification**
>
> Version: 1.0
>
> Status: **Locked**

---

# Purpose

The Overlay System provides visual feedback inside the browser by rendering non-intrusive overlays above the inspected page.

Its purpose is to make browser inspection intuitive while ensuring the underlying application remains unchanged.

The Overlay System is purely visual.

It never modifies page behaviour.

---

# Design Philosophy

The Overlay System follows one principle:

> **Observe without interfering.**

Users should clearly understand what Viskod is inspecting without the overlay affecting the page itself.

---

# Responsibilities

The Overlay System is responsible for:

* highlighting selected elements
* rendering inspection boundaries
* displaying measurement guides
* visualising hierarchy
* indicating capture state
* presenting lightweight inspection metadata

It is not responsible for:

* browser automation
* DOM analysis
* event interception
* semantic reasoning
* code inspection

---

# Architecture

```text id="zv8d2m"
Selection Engine
        │
        ▼
Overlay Manager
        │
        ▼
Overlay Renderer
        │
        ▼
Browser Viewport
```

The overlay exists independently from the inspected application.

---

# Design Goals

The Overlay System should be:

* lightweight
* deterministic
* responsive
* visually clear
* framework-independent
* accessible

Overlay rendering should never degrade application performance.

---

# Overlay Types

Supported overlay modes:

```text id="q7j4fa"
hover

selection

box-select

diagnostics

hidden
```

Additional overlay types should remain modular.

---

# Selection Overlay

The Selection Overlay indicates the active inspection target.

It should clearly communicate:

* boundaries
* dimensions
* active state

Only one Selection Overlay may exist at a time.

---

# Hover Overlay

The Hover Overlay previews potential selections before activation.

Hover overlays should:

* update immediately
* disappear when inactive
* never replace an active selection

Hover state should remain temporary.

---

# Measurement Overlay

Measurement overlays visualise distances between elements.

Examples include:

* margins
* padding
* spacing
* alignment offsets

Measurements should reflect rendered values rather than declared CSS.

---

# Layout Overlay

Layout overlays may display:

* flex containers
* grid containers
* alignment axes
* spacing distribution
* stacking order

Layout information should assist visual understanding without overwhelming the interface.

---

# Hierarchy Overlay

Future versions may visualise:

* parent relationships
* child relationships
* nesting depth
* logical grouping

Hierarchy visualisation should complement, not replace, textual metadata.

---

# Rendering Layer

The Overlay System renders within an isolated layer above page content.

The rendering layer should:

* remain independent
* avoid CSS conflicts
* preserve application rendering
* prevent style leakage

Overlay rendering should never alter application DOM styling.

---

# Event Handling

Overlays should ignore pointer events whenever possible.

Examples:

* clicks
* scrolling
* dragging
* text selection

User interactions should continue to reach the underlying application.

---

# Synchronisation

Overlay updates should remain synchronised with:

* scrolling
* resizing
* viewport changes
* zoom level
* selection changes

Visual alignment should remain accurate throughout the session.

---

# Animation

Animations should be:

* subtle
* fast
* deterministic

Animations should communicate state changes rather than decorate the interface.

---

# Accessibility

The Overlay System should:

* remain distinguishable
* support high-contrast environments
* avoid flashing content
* preserve assistive technology behaviour

Accessibility should never be compromised by inspection features.

---

# Performance

Rendering should minimise:

* layout recalculation
* repaint frequency
* DOM mutations
* memory allocations

Overlay updates should remain inexpensive.

---

# Performance Targets

Overlay creation

```text id="3tp7kw"
<10 ms
```

Selection update

```text id="v5m2na"
<16 ms
```

Scroll synchronisation

```text id="u1b4gx"
60 FPS target
```

Overlay removal

```text id="x0jc9r"
<10 ms
```

Inspection should feel instantaneous.

---

# Failure Policy

If rendering fails:

* preserve inspection state
* log diagnostics
* retry where appropriate
* avoid affecting the inspected application

Overlay failures should never interrupt capture.

---

# Extensibility

Future overlay modules may include:

* accessibility visualisation
* animation paths
* interaction hotspots
* responsive breakpoints
* design token annotations
* visual diff overlays

Extensions should integrate without changing existing overlay contracts.

---

# Relationship to Other Documents

* [Architecture](./architecture.md) — system boundaries and dependency direction
* [Glossary](./glossary.md) — canonical terminology
* [Browser Runtime](./browser-runtime.md) — renders the overlay at runtime
* [Selection Engine](./selection-engine.md) — selection events trigger overlay updates

---

# Invariants

The Overlay System guarantees:

* non-destructive rendering
* deterministic positioning
* isolated rendering layer
* consistent synchronisation
* explicit lifecycle
* framework independence

These guarantees should remain stable across future releases.

---

# Overlay System North Star

The Overlay System exists to make visual inspection clear without becoming part of the inspected application.

Its responsibility is to present accurate, responsive and non-intrusive visual feedback that helps users and AI coding agents understand what is being analysed while preserving the integrity of the running interface.
