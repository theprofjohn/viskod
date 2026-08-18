
> **SDK Specification**
>
> Version: 1.0
>
> Status: **Locked**

---

# Purpose

The SDK (Software Development Kit) provides a stable, language-friendly interface for interacting with the Viskod platform.

Its purpose is to enable developers to build integrations, automation and applications without depending on internal platform implementation details.

The SDK exposes capabilities.

It does not expose platform internals.

---

# Design Philosophy

The SDK follows one principle:

> **Stable abstractions over stable contracts.**

Developers should interact with well-defined APIs rather than internal services.

---

# Responsibilities

The SDK is responsible for:

* exposing public APIs
* providing language bindings
* simplifying platform integration
* maintaining API compatibility
* supporting authentication where required
* documenting supported capabilities

It is not responsible for:

* platform execution
* browser automation
* business logic
* storage implementation
* internal state management

---

# Architecture

```text id="r5m8tx"
Developer Application

↓

SDK

↓

Public API

↓

Platform Services
```

The SDK communicates only through supported public interfaces.

---

# Design Goals

The SDK should be:

* stable
* predictable
* strongly typed where applicable
* well documented
* backwards compatible
* implementation-independent

SDK users should never depend on internal platform behaviour.

---

# Supported Languages

The SDK architecture should support multiple language implementations.

Initial priorities may include:

* TypeScript
* JavaScript
* Python
* Go

Each implementation should expose equivalent capabilities where practical.

---

# Public API Principles

Every public API should be:

* versioned
* documented
* deterministic
* validated
* consistent
* discoverable

Breaking API changes should only occur in major versions.

---

# Core Capabilities

The SDK may expose capabilities including:

* browser session management
* Context Packet generation
* project discovery
* source hint queries
* capture execution
* diagnostics access
* plugin interaction
* settings management

Capabilities should map to stable platform services.

---

# Data Models

All SDK models should be:

* explicitly defined
* versioned
* serialisable
* documented
* backwards compatible where practical

Models should avoid leaking internal implementation details.

---

# Error Model

SDK operations should return structured errors containing:

```text id="q3v7nh"
Code

Category

Message

Correlation ID

Recoverable

Metadata
```

Errors should be deterministic and machine-readable.

---

# Authentication

Where authentication is required, the SDK should support:

* secure credential handling
* session lifecycle management
* token refresh
* explicit authentication failures

Authentication mechanisms should remain replaceable.

---

# Versioning

SDK releases should follow Semantic Versioning.

Compatibility guarantees should align with the Release Specification.

Deprecated APIs should remain supported for a documented transition period where practical.

---

# Asynchronous Operations

Long-running operations should support:

* asynchronous execution
* cancellation
* progress reporting
* timeout handling

Blocking APIs should be avoided where practical.

---

# Extensibility

The SDK should support extension through:

* plugins
* custom middleware
* additional language bindings
* future platform capabilities

Extensions should not require modification of the SDK core.

---

# Documentation

Every public API should include:

* purpose
* parameters
* return values
* error conditions
* usage examples
* compatibility notes

Documentation should be generated from the authoritative API definitions where possible.

---

# Performance Targets

SDK initialisation

```text id="n8f2kp"
<50 ms
```

API invocation overhead

```text id="b6w9xr"
<5 ms
```

Model serialisation

```text id="c4m7zt"
<2 ms
```

The SDK should add minimal overhead to platform operations.

---

# Failure Policy

If an SDK operation fails:

* preserve platform integrity
* return structured errors
* avoid partial state changes
* expose actionable diagnostics

SDK failures should remain isolated from platform execution.

---

# Relationship to Other Subsystems

The SDK builds upon:

* Public APIs
* Browser Runtime
* Capture Pipeline
* Context Engine
* Event Bus
* Project Scanner
* Selection Engine
* Source Hint Engine

The SDK should never communicate directly with internal platform components.

---

# Invariants

The SDK guarantees:

* stable public interfaces
* versioned APIs
* deterministic behaviour
* structured error reporting
* implementation independence
* backwards compatibility within major versions

These guarantees should remain stable across future platform versions.

---

# SDK North Star

The SDK exists to provide developers with a stable, predictable and well-documented interface to the Viskod platform.

Its responsibility is to expose platform capabilities through versioned public contracts, enabling integrations and automation while preserving the architectural integrity and long-term evolution of the Visual Context Platform.
