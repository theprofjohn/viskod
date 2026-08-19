
> **Privacy Specification**
>
> Version: 1.0
>
> Status: **Locked**

---

# Purpose

The Privacy subsystem defines how Viskod collects, processes, stores and exposes information while respecting user privacy.

Its purpose is to minimise data collection, maximise transparency and ensure users remain in control of their information.

Privacy is a platform principle.

It is not a configurable feature.

---

# Design Philosophy

The Privacy subsystem follows one principle:

> **Collect only what is necessary.**

Every piece of information processed by the platform should have a clear purpose and defined lifecycle.

Data should never be collected "just in case."

---

# Privacy Objectives

The platform should:

* minimise data collection
* process data locally where practical
* preserve user control
* make data handling transparent
* support secure deletion
* avoid unnecessary retention

Privacy decisions should favour the user.

---

# Responsibilities

The Privacy subsystem is responsible for:

* defining data handling policies
* classifying platform data
* enforcing retention rules
* supporting user consent
* protecting sensitive information
* governing data sharing

It is not responsible for:

* authentication
* authorisation
* encryption algorithms
* browser rendering
* business logic

---

# Privacy Architecture

```text id="m6r2xt"
User

↓

Platform Services

↓

Privacy Layer

↓

Storage

↓

External Integrations
```

Privacy policies apply across every subsystem.

---

# Privacy Principles

The platform follows these principles:

* data minimisation
* transparency
* explicit consent
* local-first processing
* user ownership
* purpose limitation

These principles apply regardless of deployment model.

---

# Data Classification

Platform information is classified into:

```text id="j8w4np"
Public

Internal

Private

Sensitive
```

Each classification defines handling requirements.

---

# Personal Data

Where personal information is processed, it should be:

* explicitly required
* clearly identified
* minimally retained
* securely stored
* removable upon request

Personal information should never be collected implicitly.

---

# Browser Data

Browser-derived information may include:

* URLs
* viewport dimensions
* rendered DOM
* screenshots
* accessibility metadata

Collection should occur only when necessary for platform functionality.

---

# Project Data

Project information may include:

* file paths
* framework metadata
* project structure
* configuration metadata
* source hints

Project data should remain local unless the user explicitly chooses otherwise.

---

# Screenshot Handling

Screenshots may contain sensitive information.

The platform should:

* avoid unnecessary capture
* minimise retention
* support automatic deletion
* respect user configuration

Screenshots should never be shared automatically.

---

# Context Packet Privacy

Context Packets should exclude:

* secrets
* authentication tokens
* cookies
* environment variables
* unrelated filesystem contents

Sensitive values should be removed before packet publication.

---

# Telemetry

Telemetry should be:

* optional
* transparent
* anonymised where practical
* configurable

Users should be able to disable telemetry without reducing core platform functionality.

---

# Consent

Where consent is required, it should be:

* explicit
* informed
* revocable
* recorded where appropriate

Consent should never be assumed.

---

# Data Retention

Every retained data category should define:

* purpose
* retention period
* deletion policy
* storage location

Retained information should not outlive its intended purpose.

---

# Data Deletion

Users should be able to remove:

* stored captures
* cached information
* project metadata
* configuration
* diagnostic history

Deletion should remove authoritative copies where practical.

---

# External Sharing

Platform data should never be shared with external services unless:

* explicitly requested by the user
* required for an enabled integration
* governed by documented permissions

Sharing policies should remain transparent.

---

# Plugin Privacy

Plugins should access only the information granted through explicit permissions.

Plugins should never receive unrestricted visibility into:

* browser sessions
* stored captures
* project metadata
* diagnostics

Privacy boundaries apply equally to first-party and third-party plugins.

---

# Performance Targets

Privacy policy evaluation

```text id="k5p1vr"
<2 ms
```

Consent validation

```text id="x9f6qd"
<5 ms
```

Sensitive data sanitisation

```text id="d4m8jw"
<10 ms
```

Privacy enforcement should not noticeably affect normal platform operation.

---

# Failure Policy

If a privacy policy cannot be enforced:

* deny the operation where appropriate
* preserve user data
* emit structured diagnostics
* avoid exposing sensitive information

Privacy failures should default to the safer outcome.

---

# Extensibility

Future privacy capabilities may include:

* regional compliance policies
* enterprise data governance
* automated data classification
* encrypted capture storage
* privacy impact reporting
* fine-grained retention controls

New capabilities should strengthen existing privacy guarantees.

---

# Relationship to Other Documents

* [Architecture](./architecture.md) — system boundaries and data flow
* [Glossary](./glossary.md) — canonical terminology
* [Security](./security.md) — complementary protection principles
* [Settings](./settings.md) — privacy configuration
* [Diagnostics](./diagnostics.md) — telemetry controls

---

# Invariants

The Privacy subsystem guarantees:

* data minimisation
* explicit consent
* transparent data handling
* local-first processing
* configurable retention
* user-controlled deletion

These guarantees should remain stable across future platform versions.

---

# Privacy North Star

The Privacy subsystem exists to ensure Viskod respects the information entrusted to it.

Its responsibility is to minimise collection, maximise transparency and preserve user control, enabling the Visual Context Platform to remain trustworthy by design while handling only the information necessary to fulfil its purpose.

## Local beta feedback

Studio feedback is a separate product-feedback artifact, not a VisualIssue or
VisualReview decision. It is stored locally under `.viskod/feedback/` by
default; Viskod does not submit feedback, upload diagnostics, or collect
telemetry.

Sanitized diagnostics are opt-in. They contain only runtime versions,
platform/architecture, setup/MCP/browser statuses, workspace mode/count,
workflow/source/review statuses, bounded error codes, and Studio health.
They explicitly exclude source code, DOM text, screenshots, packets, absolute
paths, executable paths, credentials, environment variables, browser storage,
and agent conversations. Users can preview, copy, or save the report before
sharing it. Any public GitHub issue action, when configured, requires an
explicit user action and does not attach local files automatically.
