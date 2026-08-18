
> **Resource Management Specification**
>
> Version: 1.0
>
> Status: **Locked**
>
> **NOTE:** This document defines **runtime resource management** (browser sessions, memory, connections, threads).
> For API-visible resources (Context Packets, captures, diagnostics), see [API Reference](./api-reference.md).
> The glossary entry for "Resource" refers to API-visible entities; see [Runtime Resource](./glossary.md#r) for the runtime concept.

---

# Purpose

The Resource Management subsystem defines how Viskod discovers, allocates, tracks and releases runtime resources.

Its purpose is to ensure platform resources are used efficiently, predictably and safely throughout their lifecycle.

This document covers runtime computational resources — NOT API-visible platform resources or Context Packets.

Resources enable execution.

They should never become unmanaged state.

---

# Design Philosophy

The Resource Management subsystem follows one principle:

> **Every acquired resource must have a defined owner and lifecycle.**

No resource should exist without clear ownership, allocation rules and release conditions.

---

# Responsibilities

The Resource Management subsystem is responsible for:

* resource allocation
* ownership tracking
* lifecycle management
* resource pooling
* cleanup
* capacity management

It is not responsible for:

* business logic
* permission evaluation
* platform configuration
* deployment
* diagnostics ownership

---

# Architecture

```text id="m8q4tw"
Platform Service

↓

Resource Manager

↓

Allocation

↓

Usage

↓

Release

↓

Cleanup
```

Every managed resource should pass through the Resource Manager.

---

# Design Goals

The Resource Management subsystem should be:

* deterministic
* efficient
* observable
* scalable
* leak-resistant
* implementation-independent

Resource behaviour should remain predictable regardless of workload.

---

# Resource Principles

The platform follows these principles:

* explicit ownership
* deterministic lifecycle
* minimal allocation
* automatic cleanup
* bounded resource usage
* observable utilisation

Resource usage should always be measurable.

---

# Resource Categories

Managed resources may include:

```text id="k5v2np"
Browser Sessions

Memory

Storage

Cache

Network Connections

Worker Threads

Plugin Instances

File Handles
```

Each category should define its own lifecycle policy.

---

# Ownership

Every resource should have exactly one authoritative owner.

Ownership may be transferred only through documented lifecycle transitions.

Shared resources should use explicit coordination mechanisms.

---

# Lifecycle

Every managed resource progresses through:

```text id="g7x9rf"
Created

↓

Allocated

↓

Active

↓

Idle

↓

Released

↓

Disposed
```

Lifecycle transitions should remain deterministic.

---

# Allocation

Allocation policies should:

* validate availability
* minimise duplication
* reuse pooled resources where appropriate
* respect configured limits

Allocation failures should never leave partially initialised resources.

---

# Resource Pooling

Suitable resources may support pooling.

Examples include:

* browser sessions
* worker processes
* parser instances
* reusable buffers

Pooling should reduce allocation overhead without compromising correctness.

---

# Capacity Limits

The platform should define limits for:

* concurrent browser sessions
* active workers
* cache size
* open files
* background tasks
* memory usage

Capacity limits should prevent uncontrolled resource growth.

---

# Cleanup

Resources should be released when:

* work completes
* ownership changes
* sessions terminate
* plugins unload
* errors occur
* application exits

Cleanup should occur automatically whenever practical.

---

# Leak Prevention

The platform should detect:

* unreleased resources
* orphaned browser sessions
* stale caches
* abandoned workers
* inactive handles

Resource leaks should generate structured diagnostics.

---

# Monitoring

Resource utilisation should expose:

* current usage
* peak usage
* allocation rate
* release rate
* utilisation trends

Monitoring should integrate with the Observability subsystem.

---

# Recovery

If resource exhaustion occurs, the platform may:

* reject new allocations
* release idle resources
* reduce concurrency
* pause background work
* emit diagnostics

Recovery should preserve platform stability.

---

# Performance Targets

Resource allocation

```text id="q1h8zm"
<2 ms
```

Resource release

```text id="n6p3vk"
<2 ms
```

Cleanup cycle

```text id="r4w7tb"
<100 ms
```

Resource management overhead should remain negligible.

---

# Failure Policy

If resource management fails:

* preserve existing allocations
* reject unsafe operations
* emit structured diagnostics
* prevent resource corruption
* maintain deterministic behaviour

Resource failures should remain isolated.

---

# Relationship to Other Subsystems

The Resource Management subsystem supports:

* Browser Runtime
* Capture Pipeline
* Cache
* Storage
* Plugin System
* Performance
* Observability

It manages resource lifecycles without owning subsystem behaviour.

---

# Extensibility

Future capabilities may include:

* adaptive resource scheduling
* distributed resource pools
* GPU resource management
* remote execution resources
* enterprise quota policies
* predictive capacity planning

Extensions should preserve deterministic resource ownership and lifecycle guarantees.

---

# Invariants

The Resource Management subsystem guarantees:

* explicit ownership
* deterministic lifecycles
* bounded resource usage
* automatic cleanup
* leak detection
* implementation-independent allocation

These guarantees should remain stable across future platform versions.

---

# Relationship to Other Documents

* [Architecture](./architecture.md) — system boundaries
* [Glossary](./glossary.md) — canonical terminology; see "Runtime Resource"
* [API Reference](./api-reference.md) — API-visible resource types
* [Cache](./cache.md) — cache as a managed resource
* [Storage](./storage.md) — persistent storage resources

---

# Resource Management North Star

The Resource Management subsystem exists to ensure every runtime resource within Viskod is allocated, used and released safely and efficiently.

Its responsibility is to provide deterministic ownership, predictable lifecycle management and efficient resource utilisation, enabling the Visual Context Platform to remain stable, scalable and performant across projects of every size.
