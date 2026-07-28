
> **Public API Reference**
>
> Version: 1.0
>
> Status: **Locked**

---

# Purpose

This document defines the stable public API surface of Viskod.

Its purpose is to provide a single authoritative reference for developers integrating with the platform through the SDK, CLI, Plugin API or Model Context Protocol (MCP).

Only documented public APIs are considered stable.

Internal modules are explicitly excluded.

---

# Design Philosophy

The Public API follows one principle:

> **Small, stable and predictable APIs are more valuable than large APIs.**

Every public interface should be:

* explicit
* deterministic
* versioned
* documented
* backwards compatible within a major version

---

# API Layers

```text id="9gx3rh"
Application

↓

SDK

↓

Plugin API

↓

MCP

↓

Platform Services

↓

Core Engine
```

Each layer builds upon the one below it while preserving abstraction boundaries.

---

# Versioning

Public APIs follow **Semantic Versioning**.

| Version | Compatibility                     |
| ------- | --------------------------------- |
| Patch   | Bug fixes only                    |
| Minor   | New backwards-compatible features |
| Major   | Breaking changes permitted        |

Consumers should target documented API versions rather than internal implementations.

---

# Authentication

Public APIs may support:

* local authentication
* enterprise authentication
* capability-based authorisation
* API tokens
* signed plugin identities

Authentication mechanisms are implementation-specific.

Authorisation behaviour is part of the public contract.

---

# Error Format

Every public API should expose a consistent error structure.

```json
{
  "code": "RESOURCE_NOT_FOUND",
  "category": "client",
  "message": "Human-readable description",
  "correlationId": "...",
  "recoverable": true,
  "metadata": {}
}
```

Errors should remain stable across compatible versions.

---

# Resource Naming

Resources should use singular nouns.

Examples:

```text id="k8z2pm"
ContextPacket

Capture

Workspace

Project

Plugin

Selection

Resource

Diagnostic
```

Naming should remain consistent across SDKs, CLI and MCP.

---

# API Categories

The public API consists of the following categories:

* Context APIs
* Browser APIs
* Project APIs
* Workspace APIs
* Capture APIs
* Selection APIs
* Diagnostics APIs
* Settings APIs
* Event APIs
* Storage APIs
* Plugin APIs

Each category has a clearly defined responsibility.

---

# Context APIs

Purpose:

Access Context Packets and related metadata.

Typical operations:

* create
* read
* update metadata
* validate
* export
* compare

Context APIs should never expose internal engine implementation.

---

# Browser APIs

Purpose:

Interact with supported browser runtimes.

Typical operations:

* enumerate sessions
* capture state
* inspect elements
* retrieve visual metadata
* manage overlays

Browser APIs expose browser capabilities without exposing browser internals.

---

# Project APIs

Purpose:

Interact with repositories and project metadata.

Typical operations:

* scan project
* retrieve framework metadata
* inspect dependencies
* query structure
* analyse modules

Project APIs operate on repository evidence.

---

# Capture APIs

Purpose:

Manage captured visual evidence.

Typical operations:

* initiate capture
* retrieve capture
* annotate
* export
* archive

Captures remain immutable once finalised.

---

# Selection APIs

Purpose:

Represent user-selected visual regions or logical scopes.

Typical operations:

* create selection
* update selection
* inspect metadata
* convert to Context Packet

Selections describe user intent rather than browser state.

---

# Workspace APIs

Purpose:

Manage logical development environments.

Typical operations:

* create workspace
* open workspace
* configure workspace
* enumerate projects
* manage resources

Workspace APIs should remain independent of repository structure.

---

# Diagnostics APIs

Purpose:

Retrieve platform health and execution information.

Typical operations:

* retrieve logs
* inspect subsystem status
* collect diagnostics
* generate reports

Diagnostics APIs are intended for troubleshooting and observability.

---

# Event APIs

Purpose:

Publish and subscribe to platform events.

Typical operations:

* subscribe
* unsubscribe
* publish
* inspect metadata

Event payloads follow documented schemas.

---

# Storage APIs

Purpose:

Access managed platform storage.

Typical operations:

* store resource
* retrieve resource
* enumerate resources
* remove resource

Storage implementations remain private.

---

# Settings APIs

Purpose:

Read and update platform configuration.

Typical operations:

* retrieve settings
* update settings
* validate configuration
* reset defaults

Settings APIs should validate all changes before persistence.

---

# Plugin APIs

Purpose:

Support platform extensibility.

Typical operations:

* register plugin
* activate
* deactivate
* retrieve manifest
* validate capabilities

Plugin execution is governed by the Plugin API specification.

---

# SDK Consistency

All official SDKs should expose equivalent behaviour.

Language-specific conventions may differ, but:

* resource names
* capabilities
* semantics
* error behaviour
* lifecycle

should remain consistent.

---

# Deprecation

Deprecated APIs should:

* remain documented
* include migration guidance
* specify replacement APIs
* define expected removal versions

Deprecated functionality should continue operating during the supported compatibility period.

---

# Performance Expectations

Public APIs should aim for:

| Operation          | Target |
| ------------------ | -----: |
| Local read         | <10 ms |
| Metadata lookup    | <20 ms |
| Validation         | <10 ms |
| Event dispatch     |  <5 ms |
| Settings retrieval | <10 ms |

Targets describe expected platform behaviour rather than guaranteed latency.

---

# Security

Public APIs should:

* enforce capability checks
* validate input
* isolate plugin execution
* avoid exposing internal state
* emit structured diagnostics

Security behaviour should remain deterministic.

---

# Relationship to Other Documents

This document complements:

* SDK
* Plugin API
* CLI
* Events
* Resources
* Architecture
* Governance

The API Reference defines **what** public interfaces exist.

Implementation details belong elsewhere.

---

# Invariants

The Public API guarantees:

* stable contracts
* deterministic behaviour
* semantic versioning
* consistent resource naming
* structured error handling
* implementation independence

These guarantees should remain stable across future platform versions.

---

# API Reference North Star

The Public API Reference exists to define the complete, stable and authoritative contract between Viskod and every external consumer.

Its responsibility is to ensure that developers, plugin authors and AI systems can integrate with the Visual Context Platform through predictable, well-documented and long-lived interfaces without depending on internal implementation details.
