
> **Tool Reference Specification**
>
> Version: 1.0
>
> Status: **Locked**

---

# Purpose

The Tool Reference defines the public capabilities exposed by the Viskod platform through MCP, SDK, CLI and future integrations.

Its purpose is to provide a stable catalogue of supported tools without exposing internal implementation details.

Tools expose capabilities.

They do not expose platform architecture.

---

# Design Philosophy

The Tool Reference follows one principle:

> **Every tool should perform one clear, well-defined responsibility.**

Tools should be composable, predictable and independently versioned where appropriate.

---

# Responsibilities

The Tool Reference is responsible for:

* defining public tools
* documenting tool contracts
* describing inputs and outputs
* documenting capability boundaries
* maintaining version compatibility
* supporting discoverability

It is not responsible for:

* business logic
* implementation details
* internal APIs
* platform workflows
* subsystem ownership

---

# Architecture

```text id="q7k3rm"
Client

↓

Tool Interface

↓

Public API

↓

Platform Service
```

Every public tool should execute through supported platform APIs.

---

# Design Goals

The Tool Reference should be:

* discoverable
* versioned
* deterministic
* implementation-independent
* backwards compatible
* self-documenting

Tool behaviour should remain consistent across supported interfaces.

---

# Tool Categories

The platform may expose tools within the following categories:

```text id="x4m8zt"
Browser

Project

Capture

Context Packet

Selection

Diagnostics

Plugins

Settings

Storage

Cache
```

Each category represents a stable platform capability.

---

# Tool Definition

Every tool should define:

* unique identifier
* purpose
* supported interface
* input schema
* output schema
* error model
* version

Tool definitions should remain machine-readable.

---

# Tool Identity

Each tool should have:

```text id="v6p2wh"
Namespace

Tool Name

Version

Capability Identifier
```

Identifiers should remain globally unique within the platform.

---

# Input Contracts

Tool inputs should:

* validate against schema
* define required fields
* define optional fields
* reject invalid values
* remain versioned

Input validation should occur before execution.

---

# Output Contracts

Tool outputs should:

* remain structured
* be deterministic
* include metadata where appropriate
* support serialisation
* preserve compatibility

Outputs should avoid exposing implementation-specific information.

---

# Error Contracts

Tool failures should return structured errors containing:

```text id="k3t9fq"
Error Code

Category

Message

Correlation ID

Recoverable

Metadata
```

Error contracts should remain consistent across all interfaces.

---

# Versioning

Public tools should support:

* semantic versioning
* documented deprecation
* compatibility guarantees
* migration guidance

Breaking changes should require a major version increment.

---

# Discovery

Clients should be able to discover:

* available tools
* supported versions
* required permissions
* input schemas
* output schemas

Discovery should remain interface-independent.

---

# Permissions

Every tool should define the permissions required for execution.

Examples include:

* browser access
* project access
* capture creation
* plugin management
* settings modification

Permission evaluation should occur before execution begins.

---

# Determinism

A tool should produce identical outputs when provided:

* identical inputs
* identical platform state
* identical supported version

Deterministic behaviour simplifies automation and testing.

---

# Documentation

Every tool should document:

* purpose
* parameters
* return values
* examples
* limitations
* compatibility notes

Documentation should remain synchronised with the authoritative tool definition.

---

# Performance Targets

Tool discovery

```text id="d8v5mn"
<20 ms
```

Schema validation

```text id="g1r7xp"
<5 ms
```

Dispatch overhead

```text id="m9k2tb"
<5 ms
```

Tool infrastructure should add minimal execution overhead.

---

# Failure Policy

If tool execution cannot proceed:

* reject invalid requests
* preserve platform integrity
* return structured errors
* emit diagnostics where appropriate
* avoid partial execution

Tool failures should remain isolated from unrelated platform operations.

---

# Relationship to Other Subsystems

The Tool Reference builds upon:

* SDK
* CLI
* MCP
* Plugin System
* Permission System
* Public APIs

The Tool Reference documents capabilities without owning their implementation.

---

# Extensibility

Future capabilities may include:

* dynamic tool registration
* plugin-defined public tools
* enterprise tool catalogues
* remote tool discovery
* capability negotiation
* AI-generated tool documentation

New capabilities should preserve stable public contracts.

---

# Invariants

The Tool Reference guarantees:

* stable public contracts
* deterministic behaviour
* versioned schemas
* structured inputs and outputs
* explicit permission requirements
* implementation-independent documentation

These guarantees should remain stable across future platform versions.

---

# Tool Reference North Star

The Tool Reference exists to provide a complete, stable and authoritative catalogue of Viskod's public capabilities.

Its responsibility is to define deterministic, versioned and well-documented tool contracts that enable SDKs, CLIs, MCP clients and future integrations to interact with the Visual Context Platform safely and consistently while preserving its architectural integrity.
