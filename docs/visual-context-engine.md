
> **Visual Context Engine Specification**
>
> Version: 1.0
>
> Status: **Locked**

---

# Purpose

The Visual Context Engine (VCE) is the core intelligence layer of Viskod.

It transforms raw browser observations into structured, evidence-based visual context suitable for AI coding agents.

The engine never edits code.

It never generates implementations.

Its sole responsibility is to transform observations into reliable understanding.

---

# Design Philosophy

The Visual Context Engine follows one principle:

> **Observation precedes interpretation.**

Every conclusion produced by the engine must be traceable back to observable evidence.

Inference without evidence is prohibited.

---

# Responsibilities

The Visual Context Engine is responsible for:

* aggregating browser observations
* normalising runtime data
* building structural relationships
* generating semantic summaries
* attaching evidence
* calculating confidence
* producing Context Packets

It is not responsible for:

* browser automation
* filesystem access
* MCP communication
* AI prompting
* source code modification

---

# Processing Pipeline

The Visual Context Engine processes evidence through two mechanisms:

1. **Command invocation (VCE → Browser Runtime):** VCE requests capture, navigation, viewport changes, or browser evidence through the Browser Runtime's public API. These are synchronous or request-response calls initiated by VCE.

2. **Event subscription (Browser Runtime → Event Bus → VCE):** VCE subscribes to browser lifecycle, selection, and state-change events published by Browser Runtime through the Event Bus. VCE never receives browser events through direct callbacks or by importing Browser Runtime modules.

The processing pipeline below shows the flow from evidence collection to packet assembly.

```text id="zzwk08"
Browser Runtime
        │
        ▼
Evidence Collection
        │
        ▼
Normalisation
        │
        ▼
Semantic Analysis
        │
        ▼
Relationship Analysis
        │
        ▼
Confidence Evaluation
        │
        ▼
Context Assembly
        │
        ▼
Context Packet
```

Each stage is deterministic.

---

# Evidence Sources

The engine may consume evidence from:

* DOM
* computed styles
* accessibility tree
* browser diagnostics
* viewport state
* screenshots
* project metadata
* source hints
* browser events

No external AI model is required to construct a Context Packet.

---

# Evidence Classification

Evidence is divided into three categories.

## Direct Evidence

Observed directly.

Examples:

* DOM attributes
* computed styles
* viewport dimensions
* browser URL

Confidence is maximal.

---

## Derived Evidence

Calculated from observations.

Examples:

* layout hierarchy
* spacing relationships
* alignment groups
* responsive breakpoints

Derived evidence remains deterministic.

---

## Inferred Evidence

Probabilistic conclusions.

Examples:

* likely component boundaries
* probable implementation files
* inferred design system usage

Every inference must expose confidence and reasoning.

---

# Processing Stages

## Stage 1 — Collection

Collect raw runtime information.

No interpretation occurs.

---

## Stage 2 — Validation

Validate:

* schema
* completeness
* consistency
* timestamps
* references

Invalid evidence is rejected.

---

## Stage 3 — Normalisation

Normalise data into canonical representations.

Examples:

* colours
* units
* typography
* spacing
* coordinates

Normalisation improves consistency across browsers.

---

## Stage 4 — Structural Analysis

Construct relationships between elements.

Examples:

* parent-child
* siblings
* containers
* landmarks
* navigation hierarchy

Relationships describe structure rather than behaviour.

---

## Stage 5 — Visual Analysis

Analyse the rendered interface.

Examples:

* alignment
* spacing
* overflow
* clipping
* visibility
* stacking order
* layout groups

The engine analyses what users actually see.

---

## Stage 6 — Semantic Analysis

Identify meaningful UI concepts.

Examples:

* navigation
* sidebar
* modal
* form
* card
* table
* hero section
* footer

Semantic labels improve reasoning without exposing implementation details.

---

## Stage 7 — Confidence Evaluation

Every derived or inferred result receives a confidence score.

Confidence should decrease as interpretation increases.

Observed values remain highest.

---

## Stage 8 — Packet Assembly

Assemble all validated sections into a single immutable Context Packet.

No processing occurs after assembly.

---

# Semantic Model

The engine understands interface semantics rather than frameworks.

Examples:

```text id="t5ytkr"
Navigation

Card

Button Group

Toolbar

Sidebar

Modal

Dialog

Form

List

Table
```

These concepts remain stable regardless of implementation technology.

---

# Layout Intelligence

Layout analysis includes:

* flex layouts
* grid layouts
* stacking contexts
* spacing systems
* alignment
* responsive behaviour
* overflow detection

Layout should be described in human-meaningful terms rather than raw CSS whenever possible.

---

# Accessibility Intelligence

The engine collects accessibility information including:

* roles
* accessible names
* labels
* landmarks
* heading hierarchy
* focusability
* hidden elements

Accessibility information supplements visual analysis.

---

# Design System Detection

Future versions may identify:

* colour tokens
* spacing scales
* typography scales
* icon systems
* reusable components

Detection must remain evidence-based.

---

# Confidence Engine

Confidence is calculated independently for each subsystem.

Examples:

```text id="6f6q7v"
Hierarchy

0.99

Source Hint

0.72

Design System

0.58
```

Consumers should evaluate confidence before acting on inferred results.

---

# Deterministic Behaviour

Identical inputs must always produce identical Context Packets.

Randomness is prohibited.

Time-dependent behaviour should be isolated to metadata only.

---

# Performance Budget

Target processing times:

Evidence collection

```text id="i88pjm"
<100 ms
```

Semantic analysis

```text id="89u39g"
<150 ms
```

Packet assembly

```text id="5pwpdc"
<50 ms
```

Total processing target

```text id="1i7upz"
<500 ms
```

---

# Extension Architecture

Future processing modules may include:

* accessibility analysis
* visual regression
* animation analysis
* interaction analysis
* design token extraction
* component clustering

Modules should plug into the processing pipeline without altering existing stages.

---

# Failure Policy

If one analysis module fails:

* preserve successful analyses
* record diagnostics
* omit failed section
* continue packet generation where safe

Partial Context Packets are preferable to complete failure.

---

# Quality Principles

Every output should satisfy the following:

* evidence-backed
* deterministic
* reproducible
* explainable
* versioned
* machine-readable

The engine should favour correctness over completeness.

---

# Visual Context Engine North Star

The Visual Context Engine is the intelligence core of Viskod.

Its responsibility is not to think like an AI model, but to produce trustworthy, structured visual understanding that enables any AI coding agent to reason accurately about a running user interface.
