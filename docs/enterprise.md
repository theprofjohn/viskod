
> **Enterprise Architecture Specification**
>
> Version: 1.0
>
> Status: **Locked**

---

# Purpose

The Enterprise Architecture defines how Viskod scales from an individual developer tool into an organisation-wide Visual Context Platform.

Its purpose is to enable secure, governed and collaborative adoption across engineering teams without changing the platform's core architecture.

Enterprise extends the platform.

It does not redefine the platform.

---

# Design Philosophy

The Enterprise Architecture follows one principle:

> **Single architecture, multiple organisational scales.**

The same core platform should support individuals, startups and large enterprises through configuration and governance rather than separate implementations.

---

# Responsibilities

The Enterprise Architecture is responsible for:

* organisational management
* governance
* enterprise authentication
* policy enforcement
* collaboration
* compliance integration

It is not responsible for:

* core platform behaviour
* browser execution
* Context Packet generation
* plugin implementation
* business logic

---

# Architecture

```text id="p8m3wv"
Organisation

↓

Enterprise Layer

↓

Platform Services

↓

Visual Context Engine
```

The Enterprise Layer augments existing platform capabilities without altering subsystem responsibilities.

---

# Design Goals

The Enterprise Architecture should be:

* scalable
* secure
* policy-driven
* auditable
* multi-tenant
* backwards compatible

Individual developer workflows should remain unchanged.

---

# Enterprise Principles

The platform follows these principles:

* policy over customisation
* central governance
* local autonomy
* explicit administration
* secure defaults
* organisational transparency

Enterprise capabilities should strengthen—not replace—the core platform.

---

# Organisation Model

Enterprise deployments may contain:

```text id="v2r7nk"
Organisation

↓

Business Unit

↓

Team

↓

Workspace

↓

Project
```

Ownership should remain hierarchical and explicit.

---

# Identity

Enterprise identity providers may include:

* Microsoft Entra ID
* Google Workspace
* Okta
* Ping Identity
* LDAP
* SAML providers

Identity integration should remain implementation-independent.

---

# Access Control

Enterprise deployments should support:

* role-based access control
* organisation policies
* team administration
* delegated management
* temporary access
* audit visibility

Permission evaluation should build upon the Permission System.

---

# Governance

Organisations may define policies for:

* approved plugins
* browser usage
* capture retention
* diagnostics
* storage
* security baselines

Policies should be centrally managed.

---

# Workspace Management

Enterprise administrators may manage:

* workspaces
* projects
* shared configurations
* browser profiles
* plugin catalogues

Workspace ownership should remain explicit.

---

# Enterprise Plugins

Organisations may distribute:

* approved plugins
* internal plugins
* organisation-specific integrations
* signed plugin bundles

Plugin governance should preserve the Plugin API contract.

---

# Compliance

Enterprise deployments may support:

* SOC 2
* ISO 27001
* GDPR
* HIPAA
* internal governance frameworks

Compliance features should extend existing Privacy and Security guarantees.

---

# Audit

Enterprise auditing may record:

* authentication events
* permission changes
* policy updates
* administrative actions
* plugin installation
* configuration changes

Audit records should remain immutable where practical.

---

# Administration

Enterprise administration may include:

* organisation management
* policy configuration
* user lifecycle management
* licence management
* usage reporting
* compliance reporting

Administrative interfaces should remain separate from developer workflows.

---

# Deployment Models

Supported enterprise deployments may include:

```text id="k6w4tx"
Local Desktop

Private Cloud

Self-Hosted

Managed Enterprise

Air-Gapped
```

Deployment flexibility should not alter platform architecture.

---

# Performance Targets

Organisation policy evaluation

```text id="x3q8pf"
<5 ms
```

Enterprise authentication

```text id="h7v2mk"
<500 ms
```

Administrative query

```text id="n4t9rw"
<200 ms
```

Enterprise capabilities should not significantly impact normal developer workflows.

---

# Failure Policy

If enterprise services become unavailable:

* preserve local platform operation where practical
* deny privileged administrative actions
* emit structured diagnostics
* maintain data integrity
* avoid policy inconsistencies

Enterprise failures should degrade gracefully.

---

# Relationship to Other Subsystems

The Enterprise Architecture builds upon:

* Permission System
* Security
* Privacy
* Plugin System
* SDK
* CLI
* Deployment
* Observability

Enterprise capabilities coordinate existing subsystems without changing their responsibilities.

---

# Extensibility

Future enterprise capabilities may include:

* organisation-wide AI governance
* central Context Packet repositories
* enterprise knowledge graph integration
* cross-organisation collaboration
* policy-as-code
* central analytics and reporting

New capabilities should preserve the core architecture and public platform contracts.

---

# Invariants

The Enterprise Architecture guarantees:

* organisation-aware governance
* scalable administration
* policy-driven behaviour
* secure multi-tenant operation
* compatibility with the core platform
* deterministic administrative workflows

These guarantees should remain stable across future platform versions.

---

# Enterprise North Star

The Enterprise Architecture exists to enable organisations to adopt Viskod at scale without sacrificing the simplicity, determinism and architectural integrity of the Visual Context Platform.

Its responsibility is to provide governance, security and collaboration capabilities that empower engineering organisations while preserving the same core experience used by individual developers.
