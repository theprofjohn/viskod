
> **Plugin System Specification**
>
> Version: 1.0
>
> Status: **Locked**

---

# Purpose

The Plugin System enables Viskod to be extended without modifying the core platform.

Its purpose is to allow new capabilities to be added through stable, versioned extension points while preserving the integrity, security and determinism of the platform.

Plugins extend Viskod.

They do not become part of Viskod's core architecture.

---

# Design Philosophy

The Plugin System follows one principle:

> **Everything is extensible. Nothing is privileged.**

Core functionality and third-party extensions should integrate through the same public contracts wherever practical.

---

# Responsibilities

The Plugin System is responsible for:

* plugin discovery
* plugin loading
* lifecycle management
* capability registration
* permission enforcement
* version compatibility
* plugin isolation

It is not responsible for:

* browser automation
* code generation
* project scanning
* Context Packet generation
* business logic

---

# Architecture

```text id="m8x4dp"
Plugin

↓

Plugin Manifest

↓

Plugin Manager

↓

Plugin Runtime

↓

Platform APIs

↓

Platform Services
```

Plugins interact only through published platform interfaces.

---

# Design Goals

The Plugin System should be:

* secure
* deterministic
* versioned
* isolated
* observable
* backwards compatible

Plugins should never weaken platform guarantees.

---

# Plugin Lifecycle

```text id="q4n7wr"
Discovered

↓

Validated

↓

Installed

↓

Loaded

↓

Activated

↓

Running

↓

Disabled

↓

Unloaded
```

Each lifecycle stage should be explicit.

---

# Plugin Manifest

Every plugin provides a manifest containing:

```text id="x3v9mk"
Name

Version

Description

Author

Main

Permissions

Capabilities

Icon

Homepage

License
```

The manifest defines the public identity of the plugin.

---

# Plugin Identity

Every plugin must have:

* globally unique identifier
* semantic version
* stable namespace

Identifiers should never change after publication.

---

# Capability Registration

Plugins may register capabilities including:

* Studio panels
* commands
* MCP resources
* MCP tools
* prompts
* diagnostics
* event listeners

Capability registration should occur during activation.

---

# Extension Points

Supported extension points may include:

```text id="f6k2pd"
Studio

Capture Pipeline

Diagnostics

Project Scanner

Visual Context Engine

Command Palette

Settings
```

Extension points should remain stable across minor releases.

---

# Permissions

Plugins must explicitly request permissions.

Examples include:

* browser access
* project metadata
* Context Packets
* diagnostics
* settings
* file access

Permissions should follow the principle of least privilege.

---

# Plugin Isolation

Plugins execute in-process as registered hooks and tools; the current implementation does not sandbox plugin code.

Isolation should prevent:

* shared mutable state
* unintended side effects
* namespace collisions
* platform instability

Plugin failures should not affect the core platform.

---

# Event System

Plugins may subscribe to platform events.

Examples:

* capture completed
* selection changed
* project opened
* browser connected
* diagnostics emitted

Events should be immutable.

---

# Data Access

Plugins should access platform data through published APIs.

Direct access to internal implementation details is prohibited.

Stable contracts should be preferred over shared objects.

---

# Version Compatibility

Compatibility should consider:

* platform version
* API version
* schema version
* capability version

Incompatible plugins should not be activated.

---

# Security

Plugins must never receive unrestricted access to:

* authentication tokens
* secrets
* internal services
* private runtime state

Sensitive platform resources should require explicit permissions.

---

# Performance Targets

Plugin discovery

```text id="v1r8ht"
<100 ms
```

Plugin loading

```text id="w5c7ja"
<200 ms
```

Capability registration

```text id="n9y4qe"
<50 ms
```

Plugin activation should not noticeably delay platform startup.

---

# Failure Policy

If a plugin fails:

* isolate the failure
* disable the plugin if necessary
* emit structured diagnostics
* preserve platform functionality

A faulty plugin should never compromise the stability of Viskod.

---

# Extensibility

Future plugin capabilities may include:

* browser adapters
* framework adapters
* design system integrations
* enterprise extensions
* cloud services
* custom analysis engines

New extension points should remain compatible with the existing plugin lifecycle.

---

# Relationship to Other Documents

* [Architecture](./architecture.md) — system boundaries and dependency direction
* [Glossary](./glossary.md) — canonical terminology
* [Plugin API](./plugin-api.md) — the public interface for plugins
* [Permission System](./permissions.md) — governs plugin access
* [Security](./security.md) — plugin security boundaries
* [SDK](./sdk.md) — developer integration path

---

# Invariants

The Plugin System guarantees:

* explicit lifecycle
* stable extension points
* isolated execution
* permission-based access
* version compatibility
* deterministic registration

These guarantees should remain stable across future platform versions.

---

# Plugin System North Star

The Plugin System exists to enable Viskod to evolve without increasing the complexity of its core.

Its responsibility is to provide a secure, stable and extensible foundation where new capabilities can be added through well-defined contracts while preserving the reliability, determinism and architectural integrity of the Visual Context Platform.
