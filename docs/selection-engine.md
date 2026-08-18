
> **Selection Engine Specification**
>
> Version: 1.0
>
> Status: **Locked**

---

# Purpose

The Selection Engine determines which user interface element is the active subject of analysis.

It transforms a user interaction into a precise, reproducible and stable selection that can be consumed by the Visual Context Engine.

The Selection Engine does not analyse meaning.

It identifies the correct target.

---

# Design Philosophy

The Selection Engine follows one principle:

> **Every observation begins with a trustworthy selection.**

A poor selection produces poor context.

Selection accuracy is therefore a foundational requirement.

---

# Responsibilities

The Selection Engine is responsible for:

* identifying the selected element
* maintaining stable element references
* constructing selection hierarchies
* validating selection state
* exposing selection metadata
* coordinating overlay highlighting

It is not responsible for:

* semantic analysis
* browser automation
* source hint generation
* project scanning
* code understanding

---

# Architecture

```text id="f0jp6r"
Pointer Event
        │
        ▼
Target Resolution
        │
        ▼
Selection Validation
        │
        ▼
Hierarchy Construction
        │
        ▼
Metadata Generation
        │
        ▼
Selection Snapshot
```

Each stage should produce deterministic output.

---

# Selection Sources

Selections may originate from:

* mouse click
* keyboard navigation
* Studio interaction
* MCP tool invocation
* browser inspector integration
* future automation

All selection sources should produce the same internal representation.

---

# Selection Lifecycle

```text id="yq9vkt"
Idle

↓

Selection Requested

↓

Target Resolved

↓

Validated

↓

Active Selection

↓

Capture

↓

Selection Cleared
```

Only one active selection exists within a browser context.

---

# Target Resolution

The engine resolves the intended element from browser events.

Resolution should account for:

* rendered element
* shadow DOM
* nested elements
* pointer location
* visibility

Resolution should favour the element the user intended to inspect.

---

# Stable References

Each selection receives a stable identifier.

The identifier should remain valid throughout the lifetime of the capture.

Identifiers should not depend on browser implementation details.

---

# Selection Metadata

Each selection contains:

```text id="3s8m7p"
Selection ID

Element Reference

Timestamp

Capture ID

Page ID

Browser Context

Schema Version
```

Selection metadata should remain immutable after validation.

---

# Hierarchy Construction

The engine records:

* parent chain
* child relationships
* sibling relationships
* ancestor depth
* nearest landmarks

Hierarchy provides structural context without semantic interpretation.

---

# Selection Bounds

Selection geometry includes:

* position
* width
* height
* bounding rectangle
* visible region
* clipping state

Geometry should reflect the rendered interface.

---

# Visibility Rules

Visibility evaluation considers:

* display state
* opacity
* clipping
* overflow
* viewport intersection
* stacking order

Invisible elements should still be represented when explicitly selected.

---

# Shadow DOM

The current Viskod selection path is document-root scoped. It does not
traverse application Shadow DOM, including open or nested shadow roots.
Selecting a visible open or closed shadow tree target therefore resolves to
the host boundary when the overlay can emit a target; inner content is not
claimed as selected or captured. Closed roots remain inaccessible by browser
design.

---

# Nested Selections

If multiple candidate elements exist:

* prefer the directly targeted element
* preserve ancestor relationships
* avoid ambiguous selection

Selection behaviour should remain predictable.

---

# Selection Snapshot

Every validated selection produces an immutable snapshot.

The snapshot contains:

* metadata
* hierarchy
* geometry
* browser references
* diagnostics

Snapshots become part of the Context Packet.

---

# Selection Integrity

The engine validates:

* element existence
* DOM attachment
* browser context
* frame ownership
* identifier consistency

Invalid selections should be rejected before capture proceeds.

---

# Cross-Frame Support

The current Viskod overlay and selector-resolution path does not traverse
same-origin or cross-origin iframe contents. Same-origin child documents are
separate browser documents; cross-origin contents are additionally protected
by the browser. The top-level iframe may be observed as a boundary, or the
inner target may be unavailable. No inner-frame capture is claimed.

---

# Overlay Coordination

The Selection Engine communicates with the Overlay System to:

* highlight selected elements
* display selection bounds
* indicate active targets
* remove obsolete overlays

Overlay rendering remains outside the Selection Engine.

---

# Accessibility Support

Selection metadata may include:

* accessibility role
* accessible name
* landmark
* heading level
* focus state

Accessibility information supplements structural information.

---

# Error Handling

Possible errors include:

```text id="7kg0nr"
Element Not Found

Detached Node

Invalid Context

Selection Timeout

Frame Unavailable
```

Errors should be structured and reproducible.

---

# Performance Targets

Target resolution

```text id="rnh4hb"
<10 ms
```

Hierarchy construction

```text id="kpd4tm"
<20 ms
```

Snapshot generation

```text id="1m3nqy"
<20 ms
```

Total selection processing

```text id="9s7wfx"
<50 ms
```

Selection should feel instantaneous to the user.

---

# Extensibility

Future capabilities may include:

* multi-element selection
* region selection
* keyboard traversal
* accessibility navigation
* interaction history
* persistent bookmarks

Extensions should preserve the existing selection contract.

---

# Relationship to Other Documents

* [Architecture](./architecture.md) — system boundaries and dependency direction
* [Glossary](./glossary.md) — canonical terminology
* [Browser Runtime](./browser-runtime.md) — provides DOM access for selection validation
* [Overlay System](./overlay-system.md) — renders selection feedback
* [Events](./events.md) — processes selection events

---

# Invariants

The Selection Engine guarantees:

* exactly one active selection
* immutable snapshots
* deterministic identifiers
* reproducible hierarchy
* stable metadata
* explicit diagnostics

These guarantees should remain consistent across future releases.

---

# Selection Engine North Star

The Selection Engine exists to establish a precise and trustworthy target for visual analysis.

Its responsibility is to ensure every Context Packet begins with an accurate, stable and reproducible representation of the user-selected interface element, providing the foundation for reliable downstream reasoning.
