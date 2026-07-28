
> **Frequently Asked Questions**
>
> Version: 1.0
>
> Status: **Locked**

---

# Purpose

This document answers the most common questions about Viskod's architecture, philosophy and intended usage.

Its purpose is to clarify misconceptions, reinforce platform principles and provide consistent guidance for users, contributors and plugin developers.

The FAQ complements the architecture documentation.

It does not replace it.

---

# General

## What is Viskod?

Viskod is a **Visual Context Platform** that provides structured visual and repository context for AI coding systems.

It helps AI agents understand what exists rather than guess what might exist.

---

## Is Viskod an IDE?

No.

Viskod does not replace existing IDEs or code editors.

It integrates alongside existing developer workflows.

---

## Is Viskod a code editor?

No.

Editing source code is intentionally outside the platform's primary responsibility.

---

## Is Viskod an AI coding agent?

No.

AI agents consume Viskod's outputs.

Viskod produces reliable context.

---

## What problem does Viskod solve?

Modern AI coding systems frequently lack sufficient runtime and visual context.

Viskod improves decision quality by collecting deterministic evidence from:

* browsers
* repositories
* project metadata
* framework information
* user selections

---

# Architecture

## Why does Viskod focus on visual context?

Many software engineering tasks depend on what is actually rendered rather than what source code alone suggests.

Visual evidence reduces ambiguity.

---

## Why is the browser a source of truth?

The browser reflects the real application experienced by users.

It provides authoritative information about:

* rendered interfaces
* layout
* interaction state
* runtime behaviour

---

## Why is the repository also a source of truth?

Repositories define implementation.

Together, the browser and repository provide complementary evidence.

Neither completely replaces the other.

---

## Why is determinism important?

Deterministic systems are:

* easier to trust
* easier to debug
* easier to reproduce
* easier to test

Reliable AI begins with reliable inputs.

---

# Context Packets

## What is a Context Packet?

A Context Packet is the primary structured output produced by the Visual Context Engine.

It contains verified contextual information suitable for AI consumption.

---

## Can Context Packets be edited manually?

No.

Context Packets represent collected evidence.

Derived annotations may exist separately, but the underlying evidence should remain immutable.

---

## Why not send raw browser data directly?

Raw browser data:

* is inconsistent
* contains unnecessary noise
* lacks structure
* varies between environments

Context Packets provide a stable abstraction.

---

# Plugins

## Can plugins modify internal platform behaviour?

No.

Plugins extend the platform through documented public interfaces.

Internal implementation remains private.

---

## Can plugins bypass permissions?

No.

Every capability must be explicitly granted.

The Permission System governs plugin access.

---

## Are plugins isolated?

Yes.

Plugins should execute independently and failures should not compromise core platform behaviour.

---

# SDK

## Which SDK should I use?

Use the official SDK appropriate for your programming language.

All official SDKs expose equivalent platform behaviour where practical.

---

## Can unofficial SDKs be created?

Yes.

Unofficial SDKs should follow the documented public API and preserve behavioural compatibility.

---

# MCP

## Why does Viskod use MCP?

Model Context Protocol provides a standard mechanism for communicating structured context to AI systems.

Using open protocols improves interoperability.

---

## Does MCP replace the SDK?

No.

They serve different purposes.

The SDK is designed for application integration.

MCP is designed for AI interoperability.

---

# Enterprise

## Can Viskod be self-hosted?

Yes.

The architecture supports self-hosted and enterprise deployment models.

Deployment strategy does not change platform architecture.

---

## Does enterprise change the developer workflow?

No.

Enterprise capabilities add governance and administration without changing the core developer experience.

---

# Security

## Does Viskod require internet access?

No.

The platform is designed with a local-first philosophy.

Online services enhance functionality but should not be mandatory for core workflows.

---

## How is user privacy protected?

The platform follows a privacy-by-design approach.

Only information required for documented platform behaviour should be collected.

---

## Are plugins trusted automatically?

No.

Plugins should be explicitly authorised according to documented permissions and capabilities.

---

# Performance

## Why is performance emphasised throughout the architecture?

Viskod operates within developer workflows.

High latency increases cognitive interruption and reduces productivity.

Performance is therefore considered an architectural concern rather than a later optimisation.

---

## Is scalability only for enterprise deployments?

No.

Every subsystem should scale predictably regardless of deployment size.

Enterprise features extend scalability rather than introducing it.

---

# Contributions

## Where should contributors start?

Recommended reading order:

1. Product
2. Design Principles
3. Architecture
4. Governance
5. Plugin API
6. SDK

Understanding the architecture should precede implementation work.

---

## When should an RFC be created?

RFCs are intended for significant architectural changes, public API modifications or long-term platform decisions.

Routine implementation work does not require an RFC.

---

# Roadmap

## Is the roadmap a release schedule?

No.

The roadmap describes strategic direction rather than specific delivery dates.

---

## Can roadmap priorities change?

Yes.

However, changes should preserve the platform's core architectural principles.

---

# Philosophy

## Why does the documentation emphasise evidence?

Because better evidence produces better engineering decisions.

Improving input quality is often more effective than increasing AI complexity.

---

## Why are architecture documents implementation-independent?

Architecture should remain stable even as implementation evolves.

Separating architecture from implementation improves long-term maintainability.

---

## Why are there so many specifications?

Each document has a single responsibility.

Smaller, focused documents are:

* easier to maintain
* easier to review
* easier to extend
* less likely to become internally inconsistent

---

# Relationship to Other Documents

This FAQ complements:

* Product
* Architecture
* Design Principles
* Governance
* Plugin API
* SDK
* Roadmap

Authoritative technical behaviour is defined by those documents.

The FAQ provides clarification rather than specification.

---

# Invariants

The FAQ guarantees:

* consistent explanations
* alignment with platform architecture
* terminology consistent with the Glossary
* implementation-independent guidance
* principle-driven answers

These guarantees should remain stable across future platform versions.

---

# FAQ North Star

The FAQ exists to provide clear, consistent and authoritative answers about Viskod's architecture, philosophy and intended usage.

Its responsibility is to reduce ambiguity, reinforce the platform's design principles and help every user, contributor and integrator understand the Visual Context Platform without relying on undocumented assumptions.
