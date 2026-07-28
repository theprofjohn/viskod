
> **Permission System Specification**
>
> Version: 1.0
>
> Status: **Locked**

---

# Purpose

The Permission System governs access to protected platform capabilities.

Its purpose is to ensure every operation is explicitly authorised before interacting with privileged platform resources.

Permissions control access.

They do not define business logic.

---

# Design Philosophy

The Permission System follows one principle:

> **Nothing is implicitly trusted.**

Every request should be evaluated against explicit permissions before execution.

Access should be granted deliberately, never assumed.

---

# Responsibilities

The Permission System is responsible for:

* evaluating permissions
* enforcing access policies
* defining permission scopes
* managing grants
* supporting permission inheritance
* auditing permission decisions

It is not responsible for:

* authentication
* browser automation
* plugin implementation
* Context Packet generation
* business logic

---

# Architecture

```text id="p8r4wm"
Caller

↓

Permission Manager

↓

Policy Evaluation

↓

Decision Engine

↓

Platform Service
```

Every privileged operation should pass through the Permission Manager.

---

# Design Goals

The Permission System should be:

* explicit
* deterministic
* auditable
* composable
* extensible
* secure

Permission evaluation should remain lightweight.

---

# Permission Principles

The platform follows these principles:

* least privilege
* explicit grants
* deny by default
* predictable evaluation
* complete mediation
* revocable access

Permission rules should remain simple and understandable.

---

# Permission Subjects

Permissions may be evaluated for:

* users
* plugins
* MCP clients
* SDKs
* CLI applications
* future automation agents

Every subject should have a unique identity.

---

# Protected Resources

Protected resources may include:

```text id="v3j8nk"
Browser Sessions

Projects

Context Packets

Captures

Settings

Diagnostics

Storage

Plugins
```

Resources define *what* is protected.

---

# Permission Actions

Supported actions may include:

```text id="r5t1qx"
Read

Create

Update

Delete

Execute

Manage
```

Actions define *how* a resource may be accessed.

---

# Permission Model

A permission consists of:

```text id="g7m4wc"
Subject

Resource

Action

Scope

Decision
```

Permissions should be machine-readable and versioned.

---

# Permission Scopes

Permissions may apply at different scopes.

Examples include:

* global
* workspace
* project
* session
* plugin
* resource

Scope should remain explicit.

---

# Permission Evaluation

Permission evaluation should consider:

* subject identity
* requested action
* target resource
* applicable policies
* explicit grants
* explicit denials

Evaluation should remain deterministic.

---

# Default Behaviour

Unless explicitly granted:

```text id="k9y2hd"
Access Denied
```

The platform should always fail securely.

---

# Permission Inheritance

Where appropriate, permissions may inherit from broader scopes.

Example:

```text id="n6f5pa"
Workspace

↓

Project

↓

Capture
```

Inheritance should never bypass explicit denials.

---

# Revocation

Permissions should support immediate revocation.

Revocation should invalidate:

* future requests
* cached permission decisions
* inherited grants where applicable

Revocation should not require platform restart.

---

# Auditing

Permission decisions should be auditable.

Audit records may include:

* subject
* resource
* action
* decision
* timestamp
* policy applied

Audit information should remain immutable.

---

# Plugin Permissions

Plugins should request permissions explicitly.

Examples include:

* browser access
* project metadata
* Context Packets
* diagnostics
* storage
* settings

Unrequested permissions should never be granted automatically.

---

# MCP Permissions

MCP clients should receive only the permissions necessary for the capabilities they invoke.

Protocol compatibility should never override platform security policies.

---

# Performance Targets

Permission lookup

```text id="d1k8qr"
<1 ms
```

Policy evaluation

```text id="y4v7tx"
<3 ms
```

Permission decision

```text id="m2n5wp"
<5 ms
```

Permission enforcement should remain effectively transparent during normal operation.

---

# Failure Policy

If permission evaluation cannot be completed:

* deny the request
* preserve platform integrity
* emit structured diagnostics
* avoid exposing implementation details

Permission failures should fail closed.

---

# Extensibility

Future permission capabilities may include:

* attribute-based access control
* enterprise policy engines
* delegated permissions
* temporary access grants
* organisation-level policies
* signed capability tokens

Extensions should preserve the existing permission model.

---

# Relationship to Other Documents

* [Architecture](./architecture.md) — system boundaries and trust model
* [Glossary](./glossary.md) — canonical terminology
* [Security](./security.md) — complementary security principles
* [Plugin System](./plugin-system.md) — plugin permissions
* [Plugin API](./plugin-api.md) — capability-based access

---

# Invariants

The Permission System guarantees:

* explicit permission evaluation
* deny-by-default behaviour
* least-privilege enforcement
* deterministic decisions
* auditable access
* immediate revocation

These guarantees should remain stable across future platform versions.

---

# Permission System North Star

The Permission System exists to ensure every privileged operation within Viskod is explicitly authorised.

Its responsibility is to provide deterministic, auditable and least-privilege access control, preserving the security and integrity of the Visual Context Platform while enabling safe extensibility through plugins, MCP clients and future integrations.
