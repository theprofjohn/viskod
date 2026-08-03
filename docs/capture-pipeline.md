
> **Capture Pipeline Specification**
>
> Version: 1.0
>
> Status: **Locked**

---

# Purpose

The Capture Pipeline persists and manages capture data (screenshots and metadata) produced by the Visual Context Engine.

The pipeline is storage and retrieval.

Individual analysis belongs to specialised engines.

Orchestration of the capture stages (browser snapshot → evidence collection → validation → analysis → packet assembly) is performed by the Visual Context Engine; the Capture Pipeline stores the assembled result.

---

# Design Philosophy

The Capture Pipeline follows one principle:

> **Collect first. Interpret later.**

Every stage should preserve evidence.

No stage should discard information before validation.

---

# Responsibilities

The Capture Pipeline is responsible for:

* persisting capture data
* retrieving captures
* listing captures
* deleting captures
* reporting storage stats

It is not responsible for:

* browser automation
* semantic analysis
* MCP communication
* source code inspection

Pipeline orchestration (browser snapshot → evidence collection → validation → analysis → packet assembly) is performed by the Visual Context Engine, which hands the assembled packet to the Capture Pipeline for storage.

---

# Pipeline Overview

```text id="gt8x3r"
Capture Request

↓

Browser Snapshot

↓

Evidence Collection

↓

Validation

↓

Normalisation

↓

Analysis

↓

Packet Assembly

↓

Persistence

↓

Publication
```

Each stage has clearly defined inputs and outputs.

---

# Capture Request

A capture begins from one of the following triggers:

* user selection
* viewport capture
* full-page capture
* MCP tool invocation
* Studio action
* future automation

Every request receives a unique Capture ID.

---

# Pipeline Context

Every capture is associated with:

* Capture ID
* Project ID
* Browser Context
* Page ID
* Timestamp
* Schema Version

These values remain constant throughout execution.

---

# Stage 1 — Browser Snapshot

Collect immutable runtime information.

Examples:

* URL
* viewport
* browser version
* page state
* scroll position

No analysis occurs.

---

# Stage 2 — Evidence Collection

Collect evidence from all available systems.

Sources include:

* DOM
* computed styles
* screenshots
* accessibility tree
* diagnostics
* browser metadata
* project metadata
* source hints

Collection should be performed concurrently where safe.

---

# Stage 3 — Validation

Validate:

* completeness
* schema
* identifiers
* timestamps
* references
* asset integrity

Invalid evidence should be rejected before processing continues.

---

# Stage 4 — Normalisation

Convert collected data into canonical representations.

Examples:

* colours
* spacing units
* typography
* coordinates
* browser metadata

Normalisation improves consistency across environments.

---

# Stage 5 — Analysis

Analysis engines consume validated evidence.

Examples:

* hierarchy construction
* semantic analysis
* layout analysis
* confidence calculation
* source hint generation

Analysis modules remain independent.

---

# Stage 6 — Packet Assembly

Merge validated outputs into one immutable Context Packet.

Assembly should never introduce new inference.

It only combines verified outputs.

---

# Stage 7 — Persistence

Persist generated artefacts.

Examples:

* Context Packet
* screenshots
* logs
* diagnostics
* metadata

Persistence occurs only after successful assembly.

---

# Stage 8 — Publication

Publish the completed packet to downstream consumers.

Possible consumers include:

* MCP Server
* Studio
* diagnostics
* plugins
* future SDKs

Published packets become read-only.

---

# Pipeline Dependencies

```text id="z3hd8a"
Browser Runtime

↓

Project Scanner

↓

Source Hint Engine

↓

Visual Context Engine

↓

Context Packet
```

Each dependency owns its own responsibilities.

---

# Concurrency

Independent stages should execute concurrently.

Examples:

* screenshots
* diagnostics
* computed styles
* project metadata

Dependent stages must preserve execution order.

---

# Ordering Guarantees

Pipeline execution must remain deterministic.

Identical inputs should always produce:

* identical packets
* identical identifiers (where applicable)
* identical confidence values
* identical ordering

Execution timing must not affect results.

---

# Retry Strategy

Recoverable failures may retry.

Examples:

* screenshot timeout
* transient browser error
* temporary filesystem issue

Retries should be bounded.

Infinite retry loops are prohibited.

---

# Partial Success

If one subsystem fails:

* preserve successful outputs
* record diagnostics
* omit failed sections
* continue where safe

A partial packet is preferable to a failed capture when data integrity is preserved.

---

# Failure Categories

Examples:

```text id="txhy1v"
Browser Failure

Validation Failure

Persistence Failure

Analysis Failure

Capture Failure

Timeout
```

Failures should be machine-readable.

---

# Timeouts

Every stage has a bounded execution time.

No stage should block the pipeline indefinitely.

Timed-out stages should produce structured diagnostics.

---

# Resource Management

The pipeline should minimise:

* duplicate screenshots
* repeated DOM traversal
* unnecessary allocations
* redundant analysis

Collected evidence should be reused whenever possible.

---

# Performance Targets

Pipeline initialisation

```text id="e0uyws"
<25 ms
```

Evidence collection

```text id="cpm08d"
<150 ms
```

Analysis

```text id="v8g0jm"
<200 ms
```

Packet assembly

```text id="6r2wqk"
<50 ms
```

Total capture

```text id="i2oj1o"
<500 ms
```

Targets should be validated continuously through automated benchmarking.

---

# Extensibility

Future pipeline stages may include:

* animation capture
* interaction recording
* visual regression
* accessibility auditing
* performance profiling

New stages should integrate without modifying existing stage contracts.

---

# Observability

The Capture Pipeline (persistence layer) does not emit events. Packet generation events are published by the Visual Context Engine:

```text id="af6i54"
VCE_EVENT:CONTEXT_PACKET_GENERATED

VCE_EVENT:PROCESSING_FAILED
```

Observability should aid debugging rather than alter execution.

---

# Pipeline Invariants

The Capture Pipeline guarantees:

* immutable outputs
* deterministic execution
* reproducible results
* evidence preservation
* ordered processing
* explicit diagnostics

These guarantees should remain true across all future versions.

---

# Relationship to Other Documents

This document specifies the Capture Pipeline subsystem. It is complemented by:

* [Architecture](./architecture.md) — system boundaries and dependency direction
* [Glossary](./glossary.md) — canonical terminology
* [Visual Context Engine](./visual-context-engine.md) — consumes the Capture Pipeline for persistence
* [Browser Runtime](./browser-runtime.md) — produces raw captures
* [Storage](./storage.md) — underlying storage layer

---

# Capture Pipeline North Star

The Capture Pipeline exists to transform a live browser session into trustworthy visual evidence.

Its responsibility is to coordinate reliable collection, validation and assembly while ensuring every Context Packet remains deterministic, reproducible and grounded in observable facts.
