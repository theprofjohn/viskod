
> **Model Context Protocol Specification**
>
> Version: 1.0
>
> Status: **Proposed**

---

> **NOTE:** This specification defines the planned MCP interface for Viskod Phase 1.
> Tool names, resource URIs and prompt templates are provisional and may change
> before the first release. The architectural principles (deterministic, versioned,
> transport-independent) are committed. Specific tool contracts are proposed.

# Purpose

This document defines the public Model Context Protocol (MCP) interface exposed by Viskod.

It specifies:

* MCP architecture
* available capabilities
* tools
* resources
* prompts
* schemas
* lifecycle
* versioning
* compatibility guarantees

This document is the authoritative specification for all MCP clients integrating with Viskod.

---

# Design Goals

The MCP interface must be:

* deterministic
* stable
* discoverable
* composable
* versioned
* transport-independent

Every AI coding agent should receive the same capabilities regardless of vendor.

---

# Why MCP

Viskod intentionally does not integrate directly with individual AI providers.

Instead, it implements the open Model Context Protocol.

Benefits include:

* vendor neutrality
* reusable integrations
* consistent interfaces
* simpler maintenance
* future compatibility

Any MCP-compatible client should be able to consume Viskod without custom integration.

---

# High-Level Architecture

```text
AI Coding Agent
        │
        ▼
Model Context Protocol
        │
        ▼
Viskod MCP Server
        │
        ▼
Visual Context Engine
        │
        ▼
Browser Runtime
```

---

# Server Responsibilities

The MCP Server is responsible for:

* exposing capabilities
* validating requests
* routing commands
* serialising responses
* schema negotiation
* version negotiation

The MCP Server is not responsible for:

* browser automation
* DOM analysis
* screenshot generation
* project scanning

Those remain delegated to internal services.

---

# Capability Categories

Viskod exposes three categories of capabilities.

## Tools

Actions requested by AI.

## Resources

Read-only contextual information.

## Prompts

Reusable reasoning workflows.

Each category has different lifecycle semantics and should evolve independently.

---

# Tool Design Principles

Every tool should:

* perform one action
* return structured output
* avoid hidden side effects
* be idempotent where practical
* provide deterministic responses

Avoid tools that combine unrelated operations.

---

# Core Tools

Phase 1 tools:

```text
viskod.v1.capture_selection

viskod.v1.capture_viewport

viskod.v1.capture_full_page

viskod.v1.set_viewport

viskod.v1.clear_selection

viskod.v1.get_status

viskod.v1.get_page_diagnostics

viskod.v1.refresh
```

Future tools must preserve naming consistency.

---

# Resource Model

Resources represent current platform state.

Examples:

```text
viskod://v1/project

viskod://v1/selection/current

viskod://v1/viewport/current

viskod://v1/context/latest

viskod://v1/captures/latest

viskod://v1/diagnostics/current
```

Resources are read-only snapshots.

Reading a resource must never modify runtime behaviour.

---

# Prompt Library

Prompts package reusable workflows.

Examples:

```text
Explain Current Selection

Review Layout

Review Responsive Design

Explain Component Hierarchy

Review Accessibility

Summarise Current Page

Review Visual Consistency
```

Prompts should remain implementation-agnostic.

---

# Session Lifecycle

```text
Connect

↓

Discover Capabilities

↓

Read Resources

↓

Invoke Tools

↓

Receive Results

↓

Disconnect
```

The server should minimise session state.

---

# Request Validation

Every request must validate:

* tool name
* parameters
* schema version
* required fields
* value types

Invalid requests return structured validation errors.

---

# Response Model

Every successful response includes:

```text
Status

Schema Version

Timestamp

Payload

Metadata
```

Responses should be deterministic and machine-readable.

---

# Error Model

Errors include:

```text
Error Code

Message

Category

Suggested Recovery
```

Internal implementation details must never leak through public errors.

---

# Context Packet Contract

Context Packets are immutable.

Each packet contains:

* packet identifier
* schema version
* capture timestamp
* browser metadata
* viewport information
* selected element
* hierarchy summary
* computed styles
* diagnostics
* screenshots
* source hints
* confidence scores

Packets represent a point-in-time snapshot.

---

# Schema Versioning

All public schemas use semantic versioning.

Breaking changes require a new major version.

Older schema versions should remain supported where feasible.

---

# Compatibility Policy

Viskod aims to maintain backwards compatibility for all stable interfaces.

When incompatibilities are unavoidable:

* announce changes
* document migration
* retain previous versions during transition
* remove deprecated versions only after a defined lifecycle

---

# Security

The MCP Server must never expose:

* secrets
* cookies
* authentication tokens
* environment variables
* filesystem contents outside approved scope

All outputs are sanitised before transmission.

---

# Performance Targets

Capability discovery:

```text
<100 ms
```

Tool execution:

```text
<500 ms
```

Resource retrieval:

```text
<100 ms
```

Performance targets should be monitored continuously.

---

# Client Compatibility

The MCP interface is designed to support clients including:

* Claude Code
* OpenCode
* Codex CLI
* Cursor
* Gemini CLI
* VS Code MCP clients
* future MCP-compatible tooling

No client-specific behaviour should exist within the protocol layer.

---

# Extension Policy

Future capabilities should be additive.

Examples:

* Accessibility tools
* Visual diff tools
* Design system inspection
* Performance analysis
* Multi-page workflows

New capabilities should extend existing interfaces rather than replace them.

---

# North Star

The MCP layer exists to make Viskod universally accessible.

Its responsibility is not to understand code or generate code.

Its responsibility is to expose accurate, trustworthy visual context through a stable, versioned protocol that any AI coding agent can consume.

# Relationship to Other Documents

This document specifies the MCP Server interface. It is complemented by:

* [Architecture](./architecture.md) — system boundaries and dependency direction
* [Glossary](./glossary.md) — canonical terminology
* [Visual Context Engine](./visual-context-engine.md) — provides the context that MCP exposes
* [Context Packet](./context-packet.md) — the data format exposed via MCP
* [SDK](./sdk.md) — alternative integration path
* [Tool Reference](./tool-reference.md) — catalogue of public tools
* [Security](./security.md) — MCP security policies
