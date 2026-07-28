
> **Diagnostics Specification**
>
> Version: 1.0
>
> Status: **Locked**

---

# Purpose

The Diagnostics subsystem provides structured insight into the health, performance and reliability of Viskod.

Its purpose is to explain what happened during execution without affecting execution itself.

Diagnostics exist for observability.

They are not part of the product's business logic.

---

# Design Philosophy

The Diagnostics subsystem follows one principle:

> **Every important event should be explainable.**

When something succeeds, fails or behaves unexpectedly, sufficient evidence should exist to understand why.

---

# Responsibilities

The Diagnostics subsystem is responsible for:

* recording runtime events
* reporting failures
* collecting performance metrics
* exposing health information
* generating structured diagnostics
* supporting debugging

It is not responsible for:

* modifying execution
* browser automation
* retry logic
* recovery strategies
* user interface rendering

---

# Architecture

```text
Runtime Components
        │
        ▼
Diagnostic Events
        │
        ▼
Diagnostic Collector
        │
        ▼
Event Processing
        │
        ▼
Structured Diagnostics
        │
        ▼
Consumers
```

Diagnostics should be produced independently of application behaviour.

---

# Diagnostic Sources

Diagnostics may originate from:

* Browser Runtime
* Capture Pipeline
* Selection Engine
* Visual Context Engine
* Project Scanner
* Source Hint Engine
* Overlay System
* MCP Server

Every subsystem should follow a consistent reporting model.

---

# Diagnostic Categories

Supported categories include:

```text
Information

Warning

Error

Critical

Performance

Debug
```

Categories communicate severity rather than ownership.

---

# Diagnostic Model

Each diagnostic contains:

```text
Diagnostic ID

Timestamp

Subsystem

Category

Severity

Message

Metadata
```

Diagnostics should be machine-readable.

---

# Event Lifecycle

```text
Event Created

↓

Validated

↓

Recorded

↓

Published

↓

Archived
```

Diagnostic records are immutable after publication.

---

# Correlation

Related diagnostics should share common identifiers.

Examples include:

* Capture ID
* Session ID
* Browser Context ID
* Context Packet ID
* Project ID

Correlation enables complete execution tracing.

---

# Structured Metadata

Metadata may include:

* execution duration
* browser version
* operating system
* framework
* schema version
* subsystem state

Metadata should remain structured.

Free-form text should be minimised.

---

# Performance Metrics

Subsystems may report:

* execution time
* memory usage
* queue length
* capture duration
* packet generation time
* overlay rendering time

Performance metrics should support continuous optimisation.

---

# Error Reporting

Errors should include:

```text
Error Code

Subsystem

Summary

Recovery Suggestion

Related Identifiers
```

Errors should avoid exposing internal implementation details.

---

# Health Reporting

Subsystem health may be reported as:

```text
Healthy

Degraded

Unavailable

Recovering
```

Health should describe operational readiness.

---

# Logging Policy

Diagnostics should prioritise:

* structured data
* deterministic formatting
* stable identifiers
* reproducible output

Logs should never become the primary source of system state.

---

# Privacy

Diagnostics must never expose:

* authentication tokens
* cookies
* secrets
* private environment variables
* sensitive filesystem contents

Sensitive information should always be sanitised before publication.

---

# Retention

Diagnostic retention should distinguish between:

* active diagnostics
* historical diagnostics
* archived diagnostics

Retention policies should remain configurable.

---

# Performance Targets

Diagnostic creation

```text
<1 ms
```

Event publication

```text
<5 ms
```

Health query

```text
<20 ms
```

Diagnostics should have negligible impact on runtime performance.

---

# Extensibility

Future diagnostic modules may include:

* distributed tracing
* performance flame graphs
* browser timeline integration
* memory profiling
* plugin diagnostics
* AI-assisted troubleshooting

Extensions should preserve the existing diagnostic contract.

---

# Failure Policy

If diagnostic collection fails:

* continue application execution
* preserve primary functionality
* report degraded observability where possible

Diagnostics should never become a single point of failure.

---

# Consumers

Diagnostic information may be consumed by:

* Studio
* MCP Server
* SDKs
* CLI
* plugins
* future monitoring integrations

All consumers should receive consistent structured data.

---

# Invariants

The Diagnostics subsystem guarantees:

* immutable records
* structured output
* deterministic formatting
* subsystem isolation
* correlation support
* privacy preservation

These guarantees should remain stable across future versions.

---

# Diagnostics North Star

The Diagnostics subsystem exists to make every significant system event observable, explainable and traceable.

Its responsibility is to provide accurate operational insight while remaining lightweight, deterministic and completely independent from the execution of the Visual Context Platform.
