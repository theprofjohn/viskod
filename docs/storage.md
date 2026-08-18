
> **Storage Specification**
>
> Version: 1.0
>
> Status: **Locked**

---

# Purpose

The Storage subsystem provides durable persistence for Viskod.

Its purpose is to preserve platform data across sessions while maintaining consistency, integrity and predictable retrieval.

Storage supports the platform.

It does not own platform behaviour.

---

# Design Philosophy

The Storage subsystem follows one principle:

> **Persist only what cannot be reconstructed.**

Derived or temporary information should be regenerated whenever practical.

Persistent storage should remain minimal and authoritative.

---

# Responsibilities

The Storage subsystem is responsible for:

* persisting platform data
* retrieving stored data
* versioning persisted schemas
* managing storage lifecycle
* enforcing data integrity
* supporting backup and recovery

It is not responsible for:

* runtime state
* browser automation
* Context Packet generation
* diagnostics
* business logic

---

# Architecture

```text id="h8k4rv"
Platform Services
        │
        ▼
Storage Interface
        │
        ▼
Persistence Layer
        │
        ▼
Storage Backend
```

Every subsystem should communicate through the Storage Interface.

---

# Design Goals

The Storage subsystem should be:

* deterministic
* reliable
* versioned
* replaceable
* efficient
* resilient

Storage implementation should remain independent from consumers.

---

# Storage Categories

Platform data is divided into the following categories.

```text id="q6m9tx"
Configuration

Captures

Projects

Settings

Plugins

Cache

Logs
```

Each category has independent lifecycle requirements.

---

# Persistent Data

Persistent storage may contain:

* Context Packets
* capture history
* project metadata
* user preferences
* plugin configuration
* application layout

Persistent data should survive platform restarts.

---

# Ephemeral Data

Ephemeral data includes:

* active sessions
* browser connections
* temporary analysis
* in-flight captures
* transient buffers

Ephemeral data should not be written to persistent storage unless explicitly required.

---

# Storage Interface

All persistence operations should occur through a common interface.

Core operations include:

```text id="n3w8qy"
Create

Read

Update

Delete

List
```

Consumers should remain unaware of the underlying storage implementation.

---

# Data Model

Every stored record should include:

```text id="y1f5pa"
Identifier

Schema Version

Created Timestamp

Updated Timestamp

Metadata
```

Identifiers should remain stable throughout the record lifetime.

---

# Context Packet Storage

Stored Context Packets should preserve:

* immutable packet contents
* schema version
* capture timestamp
* related identifiers

Stored packets should never be modified after creation.

---

# Versioning

Persistent data should support schema evolution.

Each stored object should include:

* schema version
* migration status
* compatibility metadata

Older versions should remain readable whenever practical.

---

# Data Integrity

The Storage subsystem should validate:

* schema correctness
* identifier uniqueness
* reference consistency
* checksum integrity where applicable

Invalid records should never become authoritative.

---

# Transactions

Where supported, storage operations should be atomic.

Partial writes should not produce inconsistent platform state.

Transaction boundaries should remain explicit.

---

# Backup and Recovery

The Storage subsystem should support:

* backup creation
* backup verification
* restore operations
* integrity validation

Recovery should preserve schema compatibility.

---

# Storage Independence

The platform should remain independent from any specific storage engine.

Possible implementations include:

* SQLite
* PostgreSQL
* IndexedDB
* filesystem storage
* cloud storage

Consumers should interact only with the Storage Interface.

---

# Performance Targets

Record retrieval

```text id="g2j7nd"
<20 ms
```

Context Packet persistence

```text id="u8k4mx"
<50 ms
```

Settings retrieval

```text id="b6r3qw"
<10 ms
```

Bulk listing

```text id="w9h1zc"
<100 ms
```

Storage operations should remain predictable under normal workloads.

---

# Failure Policy

If persistence fails:

* preserve in-memory state
* report structured diagnostics
* prevent partial writes
* allow retry where appropriate

Storage failures should never silently corrupt platform data.

---

# Extensibility

Future storage capabilities may include:

* encrypted storage
* cloud synchronisation
* enterprise backends
* distributed persistence
* snapshot management
* storage compression

Extensions should preserve existing storage contracts.

---

# Relationship to Other Documents

* [Architecture](./architecture.md) — storage layout and data ownership
* [Glossary](./glossary.md) — canonical terminology
* [Capture Pipeline](./capture-pipeline.md) — capture storage access
* [Cache](./cache.md) — caching strategy
* [Settings](./settings.md) — storage configuration

---

# Invariants

The Storage subsystem guarantees:

* deterministic persistence
* immutable Context Packets
* versioned schemas
* storage independence
* explicit lifecycle
* data integrity

These guarantees should remain stable across future platform versions.

---

# Storage North Star

The Storage subsystem exists to preserve the durable knowledge of the Viskod platform.

Its responsibility is to provide reliable, versioned and implementation-independent persistence while ensuring stored information remains trustworthy, reproducible and resilient across the lifetime of the platform.
