
> **Context Packet Specification**
>
> Version: 1.0
>
> Status: **Locked**

---

# Purpose

The Context Packet is the canonical data model produced by Viskod.

It represents a complete, immutable snapshot of a visual capture at a specific point in time.

Every AI coding agent interacting with Viskod ultimately consumes one or more Context Packets.

This document defines:

* packet structure
* data ownership
* evidence model
* confidence model
* lifecycle
* versioning
* compatibility

---

# Design Principles

Every Context Packet must be:

* immutable
* deterministic
* versioned
* self-contained
* evidence-based
* machine-readable

A packet should never require additional hidden context to be interpreted correctly.

---

# Design Goals

A Context Packet should answer:

* What is currently selected?
* What is visible?
* What hierarchy surrounds it?
* What styles affect it?
* What diagnostics exist?
* Where was it likely implemented?
* How confident is Viskod?

---

# High-Level Structure

```text
Context Packet

├── Metadata
├── Browser
├── Viewport
├── Selection
├── Hierarchy
├── DOM Summary
├── Computed Styles
├── Visual Assets
├── Diagnostics
├── Source Hints
├── Confidence
└── Evidence
```

Every section is optional only when unavailable.

Missing information should be represented explicitly rather than omitted silently.

---

# Packet Metadata

Metadata identifies the packet.

Fields include:

```text
Packet ID

Schema Version

Capture Timestamp

Project ID

Capture ID

Generator Version
```

Metadata never changes after creation.

---

# Browser Section

Describes the execution environment.

Example fields

```text
Browser

Browser Version

Engine

Platform

URL

Route
```

This information is observational.

No inference is performed.

---

# Viewport Section

Viewport captures rendering conditions.

Fields

```text
Width

Height

Device Scale Factor

Orientation

Preset

Zoom
```

Viewport information is essential for reproducing layouts.

---

# Selection Section

The selected target.

Contains

* element type
* role
* accessible name
* identifier
* classes
* attributes
* bounding rectangle
* visibility

Selection always represents exactly one primary target.

---

# Hierarchy Section

Hierarchy provides structural context.

Includes

* parents
* siblings
* children
* semantic containers
* document depth

Hierarchy should be concise.

Avoid serialising the entire DOM tree.

---

# DOM Summary

DOM Summary describes the selected region.

Instead of raw HTML, expose structured information such as:

* semantic tags
* landmark roles
* interactive elements
* form controls
* media
* layout containers

Avoid exposing implementation noise.

---

# Computed Styles

Only meaningful styles should be included.

Examples

* display
* position
* flex
* grid
* spacing
* typography
* colours
* sizing
* overflow
* z-index

Large computed-style dumps should be avoided unless explicitly requested.

---

# Visual Assets

Visual assets include:

```text
Viewport Screenshot

Selection Screenshot

Full Page Screenshot
```

Each asset references immutable capture files.

Assets are evidence.

Not interpretation.

---

# Diagnostics

Diagnostics include observations such as:

* console errors
* network failures
* missing resources
* rendering issues
* accessibility warnings
* layout overflow

Diagnostics should include severity and timestamp.

---

# Source Hints

Source Hints identify probable implementation files.

Each hint contains:

```text
Path

Confidence

Reason

Framework

Discovery Method
```

Hints are probabilistic.

They never claim certainty.

---

# Confidence Model

Every inferred section carries confidence.

Levels

```text
Very High

High

Medium

Low

Unknown
```

Confidence is evaluated independently for each subsystem.

---

# Evidence Model

Every inference should reference evidence.

Example

```text
Evidence

↓

DOM Attribute

↓

React Metadata

↓

Project Route

↓

File Match
```

Evidence should always be traceable.

---

# Confidence Rules

Observed values

Confidence

```text
1.00
```

Calculated values

Confidence

```text
0.60–0.99
```

Unknown values

Confidence

```text
0.00
```

Clients should distinguish observation from inference.

---

# Packet Lifecycle

```text
Capture Requested

↓

Evidence Collection

↓

Validation

↓

Context Assembly

↓

Packet Finalised

↓

Persisted

↓

Published
```

Once published, the packet never changes.

---

# Immutability

Packets are append-only.

If any observed value changes:

* create a new packet
* preserve the previous packet
* assign a new identifier

Historical captures remain reproducible.

---

# Validation

Before publication every packet validates:

* schema
* required fields
* identifier uniqueness
* timestamps
* asset references
* confidence ranges

Invalid packets must never be published.

---

# Serialization

Packets should support multiple serialisation formats.

Examples

* JSON
* MessagePack
* Protocol Buffers (future)

JSON remains the canonical interchange format.

---

# Compression

Large sections may be compressed internally.

Compression must never alter semantic meaning.

Clients should receive fully reconstructed packets.

---

# Compatibility

Older packet versions should remain readable.

Breaking schema changes require:

* new schema version
* migration documentation
* compatibility strategy

---

# Privacy

Sensitive information should never appear inside packets.

Examples

* passwords
* authentication cookies
* session tokens
* API keys
* environment variables
* hidden secrets

Redaction occurs before packet publication.

---

# Ownership

Context Packets belong exclusively to the capture that created them.

They are not shared mutable objects.

Multiple packets may reference the same screenshots, but each packet remains an independent snapshot.

---

# Future Extensions

Future packet sections may include:

* accessibility analysis
* visual regression results
* design system metadata
* performance metrics
* animation timelines
* interaction recordings

Extensions should remain additive.

---

# Relationship to Other Documents

* [Architecture](./architecture.md) — system boundaries and dependency direction
* [Glossary](./glossary.md) — canonical terminology
* [Visual Context Engine](./visual-context-engine.md) — produces Context Packets
* [MCP Server](./mcp.md) — exposes packets via MCP
* [Capture Pipeline](./capture-pipeline.md) — persists packet data

---

# North Star

The Context Packet is the single source of truth exchanged between Viskod and AI coding agents.

It should provide sufficient visual, structural and diagnostic evidence for reliable reasoning while remaining deterministic, immutable and independent of any specific AI model.
