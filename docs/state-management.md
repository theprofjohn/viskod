
> **State Management Specification**
>
> Version: 1.0
>
> Status: **Locked**

---

# Purpose

The State Management subsystem provides a predictable, deterministic model for managing runtime state across the Viskod platform.

Its purpose is to ensure every subsystem observes the same platform state while maintaining clear ownership and isolation.

State should describe the platform.

It should never become business logic.

---

# Design Philosophy

The State Management subsystem follows one principle:

> **One source of truth for every piece of state.**

Every state value must have exactly one owner.

Derived state should never become authoritative state.

---

# Responsibilities

The State Management subsystem is responsible for:

* maintaining application state
* synchronising runtime information
* coordinating subsystem updates
* exposing observable state
* preserving consistency
* managing state lifecycle

It is not responsible for:

* browser automation
* business logic
* data persistence
* diagnostics
* code generation

---

# State Architecture

```text id="6tf9nm"
Platform Events
        │
        ▼
State Store
        │
        ▼
Derived State
        │
        ▼
UI & Services
```

State should flow in one direction.

---

# State Categories

Platform state is divided into independent domains.

Core domains include:

```text id="k9a7ph"
Browser

Selection

Capture

Project

Diagnostics

Settings

Session
```

Each domain owns its own lifecycle.

---

# State Ownership

Every domain has one authoritative owner.

Examples:

| Domain      | Owner                 |
| ----------- | --------------------- |
| Browser     | Browser Runtime       |
| Selection   | Selection Engine      |
| Capture     | Capture Pipeline      |
| Project     | Project Scanner       |
| Diagnostics | Diagnostics Subsystem |
| Settings    | Settings Manager      |

Consumers may observe state.

They must not mutate state they do not own.

---

# State Lifecycle

```text id="v5u8rb"
Created

↓

Validated

↓

Published

↓

Observed

↓

Archived

↓

Disposed
```

State transitions should remain explicit.

---

# Immutable State

Published state should be immutable.

Updates produce new state rather than modifying existing state.

Immutability improves:

* reproducibility
* debugging
* deterministic behaviour
* concurrent execution

---

# Derived State

Derived state may include:

* active capture summary
* selected project
* filtered diagnostics
* current viewport
* recent activity

Derived values should never be persisted as canonical state.

---

# Event Flow

```text id="z4e6qw"
Subsystem Event

↓

State Update

↓

Validation

↓

Publication

↓

Subscriber Notification
```

Subscribers should observe completed state changes only.

---

# State Consistency

Every published state must satisfy:

* schema validation
* identifier consistency
* version compatibility
* ownership rules

Invalid state should never be published.

---

# State Isolation

Each subsystem should expose only the state necessary for integration.

Internal implementation details should remain private.

Isolation reduces coupling between components.

---

# State Synchronisation

Synchronisation occurs between:

* Browser Runtime
* Capture Pipeline
* Studio
* MCP Server
* Diagnostics

Synchronisation should remain event-driven.

Polling should be avoided whenever possible.

---

# Session State

Session state may include:

* connected browsers
* active pages
* active captures
* current selection
* connected MCP clients

Session state exists only for the lifetime of the session.

---

# Persistent State

Persistent state may include:

* user preferences
* window layout
* recent projects
* cached metadata
* plugin configuration

Persistent state should remain versioned.

---

# State Versioning

Every published state should include:

```text id="c8w1ys"
Schema Version

State Version

Timestamp
```

Versioning supports compatibility across platform updates.

---

# Conflict Resolution

Conflicting updates should be resolved by:

* ownership rules
* event ordering
* version comparison

Last-writer-wins should only be used where explicitly defined.

---

# Performance Targets

State publication

```text id="x7h2kp"
<5 ms
```

Subscriber notification

```text id="m1d9tv"
<10 ms
```

Derived state calculation

```text id="j6p4ya"
<20 ms
```

State operations should remain inexpensive.

---

# Extensibility

Future state domains may include:

* plugins
* collaboration
* automation
* cloud synchronisation
* enterprise policies

New domains should preserve existing ownership rules.

---

# Failure Policy

If a state update fails:

* reject invalid changes
* preserve previous valid state
* emit diagnostics
* continue platform operation where safe

State corruption must never propagate across subsystems.

---

# Relationship to Other Documents

* [Architecture](./architecture.md) — system boundaries and dependency direction
* [Glossary](./glossary.md) — canonical terminology
* [Events](./events.md) — event-driven state updates
* [Studio](./studio.md) — consumes state for display
* [Browser Runtime](./browser-runtime.md) — emits runtime state changes

---

# Invariants

The State Management subsystem guarantees:

* single ownership
* immutable published state
* deterministic updates
* explicit lifecycle
* event-driven synchronisation
* versioned schemas

These guarantees should remain stable across future versions.

---

# State Management North Star

The State Management subsystem exists to provide a consistent, deterministic and trustworthy view of the Viskod platform.

Its responsibility is to ensure every subsystem operates from the same validated state while preserving clear ownership, predictable behaviour and long-term maintainability.
