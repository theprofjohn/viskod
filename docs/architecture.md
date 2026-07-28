
> **Viskod System Architecture**
>
> Version: 1.0
>
> Status: **Locked**
>
> Last Updated: 2026-07-28

---

# Purpose

This document defines the long-term technical architecture of Viskod.

It describes:

* architectural principles
* package responsibilities
* system boundaries
* communication flow
* scalability strategy
* extension points

Unlike implementation documentation, this document explains **how the system is designed** rather than how individual features are implemented.

Whenever implementation and architecture conflict, this document takes precedence unless superseded by a newer decision recorded in `MEMORY.md`.

---

# Architectural Philosophy

Viskod follows five fundamental principles.

## 1. Local First

The primary execution environment is the developer's machine.

Local execution provides:

* privacy
* lower latency
* offline capability
* predictable behaviour

Cloud infrastructure is optional and should never become a requirement for core functionality.

---

## 2. MCP First

Every capability should be designed so it can be consumed through Model Context Protocol.

The Studio exists for humans.

The MCP Server exists for AI.

Both are first-class interfaces.

---

## 3. Modular by Default

The system should consist of focused packages with explicit responsibilities.

Packages communicate through typed contracts.

Avoid hidden coupling.

---

## 4. Browser as Source of Truth

The rendered application is the authoritative representation of the UI.

Never infer layout purely from source code when the browser can provide the actual rendered result.

---

## 5. Evidence Before Inference

Viskod should distinguish between:

* observed facts
* inferred facts
* estimated facts

Confidence is part of the architecture.

---

# System Overview

```text
                         Developer
                             │
                             ▼
                     Viskod Studio
                             │
                             ▼
                  Visual Context Engine
                    │         │         │
                    │         │         │
                    ▼         ▼         ▼
             Browser Runtime  │  Project Scanner
                    │         │
                    │    Capture Pipeline
                    │
                    ▼
                Playwright
```

```text
Context Flow:
  Browser Runtime ──events──→ Event Bus ──subscription──→ Visual Context Engine
  Visual Context Engine ──calls──→ Browser Runtime (capture operations)
  Visual Context Engine ──calls──→ Project Scanner (metadata)
  Visual Context Engine ──calls──→ Capture Pipeline (persist)
```

Every component has a single responsibility.

No component owns responsibilities outside its boundary.

---

# System Responsibilities

Viskod is responsible for:

* rendering awareness
* visual inspection
* viewport management
* screenshots
* DOM inspection
* computed styles
* diagnostics
* context generation
* MCP exposure

Viskod is **not** responsible for:

* editing source code
* Git operations
* planning software
* AI conversations
* pull requests
* deployments

---

# Monorepo Architecture

The repository is organised as a pnpm workspace.

```text
viskod/

apps/
packages/
examples/
docs/
tests/
scripts/
```

The architecture separates:

* user interface
* browser automation
* context generation
* communication
* shared contracts

into independent packages.

---

# Repository Layout

```text
viskod/

apps/
└── studio/

packages/
├── browser-runtime/
├── cli/
├── context-engine/
├── mcp-server/
├── project-scanner/
├── selection-engine/
├── source-hint-engine/
├── capture-pipeline/
├── shared/
├── diagnostics/
└── config/

examples/

tests/

docs/
```

Every package owns a single domain.

---

# Package Responsibilities

## apps/studio

Purpose

The desktop interface.

Responsibilities

* viewport controls
* selection controls
* diagnostics
* project status
* screenshots
* current selection

Must not:

* implement browser automation
* implement MCP
* perform source mapping

---

## packages/browser-runtime

Purpose

Control Chromium.

Responsibilities

* browser lifecycle
* navigation
* viewport changes
* screenshot capture
* page diagnostics
* overlay injection

Must never:

* know repository structure
* expose MCP
* generate source hints

---

## packages/context-engine

Purpose

Transform observations into structured knowledge.

Responsibilities

* collect DOM information
* collect computed styles
* build hierarchy
* redact sensitive information
* create context packets
* validate schemas

Must remain deterministic.

---

## packages/project-scanner

Purpose

Understand the repository.

Responsibilities

* framework detection
* package manager detection
* route detection
* project metadata
* source hint discovery

This package does not inspect the browser.

---

## packages/capture-pipeline

Purpose

Persist and manage captures.

Responsibilities

* screenshot storage
* capture metadata
* retention
* cleanup
* export

No browser logic.
No analysis.

---

## packages/selection-engine

Purpose

Convert user interaction into structured selections.

Responsibilities

* process pointer events
* validate DOM node candidates
* manage selection state
* produce selection targets

Depends on Browser Runtime for DOM access.
Communicates via the Event Bus.

No MCP.
No source mapping.

---

## packages/mcp-server

Purpose

Expose Viskod to AI systems.

Responsibilities

* MCP tools
* MCP resources
* validation
* schema versioning

No browser logic.

No UI.

---

## packages/shared

Purpose

Shared contracts.

Contains

* types
* schemas
* utilities
* constants
* errors

No business logic.

---

## packages/cli

Purpose

Developer entry point.

Responsibilities

* startup
* shutdown
* project detection
* orchestration

The CLI coordinates.

It does not own business logic.

---

## packages/diagnostics

Purpose

Collect and expose platform health information.

Responsibilities

* record runtime events
* report failures
* expose health endpoints
* support debugging

Cross-cutting. Every subsystem may emit diagnostics.

---

# Dependency Rules

Dependencies always point inward.

```text
Studio

↓

Context Engine

↓

Browser Runtime

↓

Playwright
```

Never reverse the dependency direction.

Direction is strictly one-way. Reverse communication from
Browser Runtime to VCE occurs ONLY through the Event Bus.

Shared contracts flow upward.

Implementation flows downward.

---

# Communication Rules

Packages communicate through explicit interfaces.

Avoid:

```text
package A

↓

imports package B internals
```

Prefer:

```text
package A

↓

public API

↓

package B
```

---

# Startup Flow

```text
Developer

↓

viskod start

↓

CLI

↓

Project Scanner

↓

Browser Runtime

↓

Visual Context Engine

↓

Studio

↓

MCP Server

↓

Ready
```

Every subsystem reports health before Viskod becomes available.

---

# Shutdown Flow

```text
User exits

↓

Stop MCP

↓

Persist state

↓

Close browser

↓

Release resources

↓

Exit
```

No orphan processes.

No locked files.

No temporary resources.

---

# Data Ownership

Each package owns its own data.

Example

Browser Runtime owns

* pages
* browser contexts
* screenshots

Context Engine owns

* context packets

Studio owns

* UI state

Project Scanner owns

* project metadata

Never duplicate ownership.

---

# State Management

State should exist in the smallest possible scope.

Hierarchy

```text
Component

↓

Feature

↓

Package

↓

Persistent Storage
```

Avoid global mutable state.

---

# Configuration

Configuration precedence

```text
CLI flags

↓

Project config

↓

Environment variables

↓

Defaults
```

Configuration should be explicit.

Avoid hidden behaviour.

---

# Public Interfaces

Every package exposes one public API.

Example

```ts
createBrowserRuntime()

createContextPacket()

createProjectScanner()

createCaptureManager()

createMcpServer()
```

Avoid exposing implementation details.

---

# Internal Events

Packages communicate through typed events.

Examples

```text
BrowserStarted

ViewportChanged

SelectionChanged

CaptureCompleted

ContextGenerated

BrowserDisconnected

ProjectLoaded
```

Events are immutable.

---

# Error Boundaries

Each subsystem owns its own failures.

Browser failures remain inside Browser Runtime.

MCP failures remain inside MCP Server.

Studio failures never crash Browser Runtime.

---

# Logging Architecture

Every package produces structured logs.

Format

```text
timestamp

level

package

event

message

metadata
```

Logs should be machine-readable.

---

# Schema Strategy

Every cross-package payload must use Zod.

Schemas are versioned.

Breaking changes require:

* new version
* migration
* compatibility notes

Never silently modify shared schemas.

---

# Storage Layout

```text
.viskod/

captures/

context/

logs/

cache/

settings.json
```

Everything remains inside one hidden directory.

Easy to remove.

Easy to inspect.

---

# Security Boundary

The browser is untrusted.

The inspected application is untrusted.

Repository contents are sensitive.

Every boundary validates input.

Nothing is trusted by default.

---

# Runtime Boundary

The Browser Runtime communicates only with:

* Chromium (via Playwright)
* Visual Context Engine (via its own public API, which VCE calls; Browser Runtime never initiates calls to VCE)

The Browser Runtime emits events to the Event Bus.

The Event Bus delivers those events to Visual Context Engine subscribers.

VCE subscribes to Browser Runtime events exclusively through the Event Bus. No direct callbacks, no imported BR modules, no bypass of the event infrastructure.

Browser Runtime NEVER calls Visual Context Engine directly.

Browser Runtime never talks directly to:

* Studio
* MCP Server
* Project Scanner
* Capture Pipeline (VCE handles persistence)

---

# Extension Points

Future packages should integrate through defined interfaces.

Examples

```text
Accessibility Engine

↓

Context Engine

Visual Diff Engine

↓

Capture Pipeline

Framework Adapters
        │
        ▼
Source Hint Engine
        │
        ▼
Project Scanner

Design System Engine

↓

Project Scanner
```

Extensions should compose.

Not modify existing architecture.

---

# Performance Principles

Optimise for:

* startup time
* interaction latency
* predictable memory usage
* incremental processing

Avoid premature optimisation.

Measure before changing architecture.

---

# Scalability Strategy

The architecture should support future additions without restructuring the repository.

Examples include:

* Vue support
* Angular support
* Svelte support
* Firefox runtime
* WebKit runtime
* Accessibility engine
* Visual regression engine
* Enterprise plugins

New capabilities should arrive as packages rather than expanding existing ones indefinitely.

---

# Architectural Constraints

The following are intentionally excluded from the core architecture:

* cloud execution
* hosted databases
* AI models
* code generation
* authentication
* billing
* collaboration
* project management

These may exist as future optional services but must never become dependencies of the local developer experience.

---

# Definition of a Healthy Architecture

The architecture is considered healthy when:

* every package has one responsibility
* dependencies remain directional
* communication occurs through typed contracts
* failures remain isolated
* components can be tested independently
* documentation reflects implementation
* new features can be added without restructuring existing packages

---

# Architectural North Star

Viskod should evolve as infrastructure, not as another AI coding assistant.

Every architectural decision should reinforce one goal:

> **Provide accurate, trustworthy visual context that any AI coding agent can consume through a stable, extensible and local-first architecture.**
#

> **Core Runtime Architecture**
>
> This section defines how Viskod operates internally after the application has started.

---

# Runtime Philosophy

The runtime exists for one purpose:

> Transform a running user interface into trustworthy, structured visual context that AI coding agents can consume.

The runtime does **not** modify source code.

It observes.

Captures.

Analyses.

Publishes.

---

# Runtime Layers

```text
Selection (user interaction)

↓

Overlay System

↓

Browser Runtime

↓

Event Bus ──events──→ Visual Context Engine

↓

Context Packet

↓

MCP (expose) / Studio (display)

Command flow (VCE → Browser Runtime):
  VCE ──calls──→ Browser Runtime public API (capture, navigate, viewport)

```

This diagram describes data flow during a capture operation, NOT package dependencies.
For the authoritative dependency model, see the System Overview section above.

Each component has a single responsibility. Components communicate through the Event Bus
or typed public APIs. No bi-directional dependencies exist except through the Event Bus.

---

# Browser Runtime

The Browser Runtime is responsible for controlling the browser.

Responsibilities:

* launch Chromium
* connect existing browser
* manage tabs
* navigate
* refresh
* viewport changes
* screenshot capture
* diagnostics
* overlay injection

The Browser Runtime never understands business logic.

It only understands browsers.

---

# Browser Lifecycle

```text
CLI

↓

Browser Runtime

↓

Chromium Launch

↓

Browser Context

↓

Page

↓

Application

↓

Ready
```

Only one active Browser Runtime exists per project.

---

# Browser Context

Every project receives an isolated browser context.

Isolation prevents:

* cookie leakage
* storage conflicts
* authentication bleed
* extension interference

Never reuse browser contexts across unrelated projects.

---

# Page Management

The Browser Runtime owns:

```text
Current Page

Current Route

Current URL

Current Viewport

Current Selection

Browser Diagnostics
```

No other package owns browser state.

---

# Viewport Engine

The Viewport Engine controls visual rendering.

Supported modes:

```text
Desktop

Tablet

Mobile

Custom
```

Responsibilities:

* viewport size
* orientation
* zoom
* device scale factor
* refresh

Changing viewport should never rebuild the application.

---

# Responsive Philosophy

Responsive behaviour belongs to the browser.

Viskod records.

It does not simulate CSS.

---

# Selection Engine

The Selection Engine converts user interaction into structured targets.

Pipeline

```text
Pointer

↓

Hovered Node

↓

Candidate Validation

↓

Selection

↓

Highlight

↓

Capture Request
```

Selection is deterministic.

The Selection Engine resides between Studio (which captures pointer events via the Overlay)
and Browser Runtime (which provides DOM access). Communication flows through the Event Bus.

---

# Overlay System

The overlay is injected into the inspected page.

Responsibilities

* highlight hovered elements
* display labels
* capture clicks
* intercept selection events

The Overlay System is the architectural concept. The Overlay Manager
(within Browser Runtime) is the component that renders it at runtime.

The overlay must:

* avoid CSS conflicts
* avoid layout shifts
* avoid modifying application behaviour

The overlay must be removable at any time.

---

# Overlay Isolation

Use:

* namespaced classes
* Shadow DOM where appropriate
* isolated styles
* isolated event handlers

The inspected application must not know the overlay exists.

---

# Selection Levels

Phase 1

```text
Element

Container
```

Future

```text
Component

Section

Layout

Region
```

Selection granularity should evolve without redesigning the architecture.

---

# Selection Validation

Not every DOM node is meaningful.

Reject examples:

* script
* style
* overlay nodes
* injected runtime nodes

Prefer meaningful UI elements.

---

# Capture Pipeline

After selection:

```text
Selection

↓

DOM Snapshot

↓

Style Collection

↓

Hierarchy

↓

Diagnostics

↓

Screenshots

↓

Project Metadata

↓

Source Hints

↓

Context Packet
```

Every stage contributes evidence.

---

# Capture Pipeline

The Capture Pipeline persists and manages captures.

Responsibilities

* queue captures
* persist files
* assign capture IDs
* retention policy
* export

The Capture Pipeline never analyses data.

---

# Screenshot Pipeline

Three screenshots may exist.

```text
Viewport

Selection

Full Page
```

Each screenshot belongs to one capture.

Never overwrite previous captures.

---

# DOM Intelligence

DOM Intelligence converts raw HTML into structured information.

Examples

* tag
* role
* aria
* hierarchy
* attributes
* relationships
* visibility
* position

Raw DOM should never be exposed directly.

Always transform it into meaningful structures.

---

# Hierarchy Builder

Hierarchy Builder constructs context.

```text
Selected Node

↓

Parents

↓

Siblings

↓

Children

↓

Hierarchy Summary
```

AI rarely needs the full DOM.

It needs relevant context.

---

# Computed Style Engine

Responsibilities

* retrieve computed styles
* filter relevant properties
* remove noise
* normalise values

Avoid exposing hundreds of irrelevant CSS properties.

Return only meaningful information by default.

---

# Visual Context Engine

The Visual Context Engine is Viskod's core.

Responsibilities

* combine browser evidence
* combine project evidence
* combine diagnostics
* combine screenshots
* assemble context packets (Packet Assembly stage)
* validate schemas

Everything flows through this engine.

Context Builder is NOT a separate component. Packet assembly is the final stage of the VCE processing pipeline.

---

# Packet Assembly

The Visual Context Engine's Packet Assembly stage combines multiple inputs into one output.

```text
DOM

+

Styles

+

Hierarchy

+

Screenshots

+

Diagnostics

+

Project Metadata

+

Source Hints

↓

Context Packet
```

One packet represents one capture.

---

# Context Packet Lifecycle

```text
Capture Requested

↓

Collect Evidence

↓

Validate

↓

Build Packet

↓

Persist

↓

Expose via MCP

↓

Ready
```

Packets are immutable.

If anything changes:

Generate a new packet.

---

# Project Scanner

Project Scanner understands the repository.

Responsibilities

* framework detection
* package manager
* routes
* configuration
* project metadata

Future responsibilities

* component graph
* design system
* routing graph

---

# Source Hint Engine

Source Hint Engine attempts to identify likely implementation files.

Inputs

* DOM
* route
* IDs
* classes
* React metadata
* filenames
* imports

Output

```text
Source Hint

Confidence

Reason
```

Never claim certainty without evidence.

---

# Confidence Model

Every inferred value should include confidence.

Examples

```text
0.98

Almost Certain

0.82

Likely

0.63

Possible

0.31

Weak
```

Confidence should influence AI reasoning.

---

# Diagnostics Engine

Collect:

* console errors
* page errors
* network failures
* layout overflow
* rendering failures

Diagnostics become part of context.

---

# State Synchronisation

The Studio should never query the browser directly.

Instead

```text
Browser Runtime

↓

Event Bus (events)

↓

State Store

↓

Studio / Visual Context Engine
```

One direction.

No circular communication.

---

# Event Bus

Runtime communication uses events. The Event Bus is an integration boundary — it transports immutable facts between subsystems. It owns no business logic, makes no decisions, and never initiates actions.

Examples

```text
BrowserStarted

SelectionChanged

ViewportChanged

CaptureStarted

CaptureCompleted

BrowserDisconnected

DiagnosticsUpdated
```

Events are immutable.

---

# State Store

The Studio maintains presentation state only.

Business state belongs to runtime packages.

Avoid duplicating runtime information inside React state.

---

# Cache Strategy

Cache only expensive computations.

Examples

* source hints
* project scan
* hierarchy summaries

Never cache:

* live DOM
* viewport
* browser state

---

# Persistence

Persistent data

```text
Captured Context

Screenshots

Logs

Settings
```

Ephemeral data

```text
DOM

Browser

Selection

Hover State

Events
```

---

# Performance Targets

Every subsystem defines its own performance budgets. See the respective specification documents for authoritative targets:

* [Browser Runtime](./browser-runtime.md) — browser launch, viewport update, screenshot capture, overlay update
* [Visual Context Engine](./visual-context-engine.md) — evidence collection, semantic analysis, packet assembly
* [Studio](./studio.md) — workspace load, panel switching, selection update
* [CLI](./cli.md) — startup, command dispatch, config loading

Performance budgets should be measured continuously.

---

# Failure Recovery

If capture fails

Retry only failed stages.

Do not repeat successful stages unnecessarily.

---

# Runtime Isolation

Failure inside:

* overlay
* screenshot capture
* diagnostics
* source hints

must not crash the Browser Runtime.

Failure inside Browser Runtime must not crash the Studio.

Failure isolation is a core architectural requirement.

---

# Runtime North Star

Every runtime component should answer one question:

> **Does this improve the accuracy, reliability or usefulness of the visual context provided to AI coding agents?**

If not, it likely belongs outside the runtime architecture.
#

> **Platform Architecture**
>
> This section defines how Viskod exposes its capabilities to AI coding agents, secures its runtime, evolves over time, and scales into a long-term platform.

---

# Platform Philosophy

The platform exists to make visual context universally accessible.

Viskod should never be tied to a single:

* AI model
* coding agent
* IDE
* editor
* operating system

Every major capability should be exposed through stable, versioned interfaces.

---

# Platform Layers

```text
                  External AI Agent
                          │
                          ▼
                  Model Context Protocol
                          │
                          ▼
                     MCP Server
                          │
         ┌────────────────┼────────────────┐
         ▼                ▼                ▼
    Context Engine   Capture Pipeline   Project Scanner
         │                │                │
         └────────────────┼────────────────┘
                          ▼
                    Browser Runtime
```

---

# MCP Server

The MCP Server is Viskod's public interface.

It exposes visual understanding to AI systems.

The MCP Server must never:

* manipulate browser internals
* inspect the DOM directly
* understand Playwright
* generate screenshots

It orchestrates existing services.

---

# MCP Design Principles

Every MCP interface should be:

* deterministic
* discoverable
* versioned
* strongly typed
* stable
* self-documenting

Avoid hidden behaviour.

---

# MCP Surfaces

The platform exposes three kinds of interfaces.

## 1. Tools

Actions initiated by AI.

Examples

```text
viskod.v1.capture_selection

viskod.v1.capture_viewport

viskod.v1.clear_selection

viskod.v1.set_viewport
```

---

## 2. Resources

Persistent information.

Examples

```text
viskod://v1/selection/current

viskod://v1/project

viskod://v1/diagnostics

viskod://v1/captures/latest

viskod://v1/viewport/current
```

Resources should always represent the latest known state.

---

## 3. Prompts

Reusable workflows.

Examples

```text
Explain Current Selection

Review Layout

Explain Component Hierarchy

Find Alignment Problems

Review Accessibility

Generate Visual Summary

Review Responsive Behaviour
```

Prompts standardise common reasoning patterns across AI coding agents.

---

# MCP Lifecycle

```text
Client Connected

↓

Capability Discovery

↓

Resource Discovery

↓

Tool Invocation

↓

Context Retrieval

↓

Result

↓

Disconnect
```

Every session should be stateless wherever practical.

---

# Tool Design

Every tool should perform one operation.

Avoid "mega tools".

Bad

```text
analyse_everything()
```

Good

```text
capture_selection()

capture_viewport()

set_viewport()

clear_selection()
```

Small tools compose better.

---

# Resource Design

Resources should be:

* immutable snapshots
* cached safely
* readable without side effects

Reading a resource must never modify runtime behaviour.

---

# Prompt Design

Prompts should not contain implementation logic.

Instead they provide structured workflows.

Example

```text
Review the currently selected element.

Explain:

- hierarchy

- layout

- spacing

- responsive behaviour

- accessibility

- likely implementation
```

---

# Context Packet

The Context Packet is the canonical output of Viskod.

Everything ultimately becomes one packet.

It combines:

* browser state
* DOM
* styles
* hierarchy
* screenshots
* diagnostics
* source hints
* project metadata

The packet should remain versioned forever.

---

# Context Packet Evolution

Never silently change schemas.

Instead

```text
v1

↓

v2

↓

v3
```

Migration is preferred over breaking compatibility.

---

# Versioning Strategy

Public APIs use semantic versioning.

Examples

```text
viskod.v1.capture_selection

viskod.v2.capture_selection
```

Old clients should continue working where practical.

---

# API Stability

Stable APIs must:

* preserve names
* preserve behaviour
* preserve schema guarantees

Breaking changes require:

* migration path
* documentation
* version increment

---

# Error Model

Every public error contains

```text
Code

Message

Cause

Recovery

Details (optional)
```

Never expose internal stack traces through MCP.

---

# Error Categories

```text
Runtime

Browser

Capture

Validation

Project

MCP

Security

Configuration
```

Errors should be machine-readable.

---

# Security Architecture

Trust nothing.

Validate everything.

Every boundary validates:

* file paths
* browser events
* MCP inputs
* configuration
* schemas

No implicit trust.

---

# Privacy Model

Default assumptions

Repository

Sensitive

Browser

Untrusted

Developer

Trusted

Network

Optional

````

No repository information leaves the machine unless explicitly requested.

---

# Data Classification

## Public

Examples

- viewport size
- framework
- browser version

---

## Internal

Examples

- DOM hierarchy
- screenshots
- diagnostics

---

## Sensitive

Examples

- passwords
- cookies
- API keys
- tokens
- secrets
- environment variables

Sensitive information should never appear inside Context Packets.

---

# Capability Permissions

Future architecture should support permissions.

Example

```text
Capture

✓

Diagnostics

✓

Project Scan

✓

Filesystem

Limited

Secrets

Never
````

Least privilege should be the default.

---

# Plugin Architecture

Future capabilities should become plugins.

Example

```text
Accessibility Plugin

↓

Visual Diff Plugin

↓

Design System Plugin

↓

Performance Plugin
```

Plugins should consume stable interfaces rather than private internals.

---

# Framework Adapters

Framework-specific behaviour belongs inside adapters.

Example

```text
React Adapter

Vue Adapter

Angular Adapter

Svelte Adapter
```

Core architecture should remain framework-independent.

---

# Browser Adapters

Future browser support follows the same pattern.

```text
Chromium Adapter

Firefox Adapter

WebKit Adapter
```

Browser Runtime remains abstract.

---

# Observability

The platform should expose health information.

Examples

```text
Browser Status

Capture Duration

Runtime Health

Memory Usage

Cache Statistics

Project Status
```

Observability exists for diagnosis.

Not telemetry.

---

# Testing Architecture

Testing mirrors architecture.

```text
Unit

↓

Integration

↓

End-to-End

↓

Acceptance
```

Every package owns its own tests.

Cross-package behaviour belongs in integration tests.

---

# Release Architecture

Every release must pass

```text
Formatting

↓

Lint

↓

Type Check

↓

Unit Tests

↓

Integration Tests

↓

End-to-End Tests

↓

Documentation Validation
```

No skipped stages.

---

# Scalability

The architecture should support

* larger repositories
* larger applications
* multiple browser instances
* additional frameworks
* enterprise deployments

without redesigning the core runtime.

---

# Commercial Architecture

Commercial features should layer above the core.

```text
Enterprise

↓

Commercial Plugins

↓

Open Core

↓

Runtime

↓

Browser
```

Revenue should never compromise the local-first architecture.

---

# Future Platform

Potential platform capabilities include:

* team collaboration
* cloud synchronisation
* shared captures
* remote inspection
* plugin marketplace
* enterprise policy management
* SDK ecosystem

These should extend existing interfaces rather than replace them.

---

# Deprecation Policy

Public APIs should never disappear unexpectedly.

Deprecation process

```text
Announce

↓

Document

↓

Maintain

↓

Remove
```

Every removal requires a replacement path.

---

# Architecture Governance

Major architectural changes require:

* documented proposal
* recorded decision in `MEMORY.md`
* architecture review
* migration strategy
* updated documentation

Architecture should evolve deliberately.

Never accidentally.

---

# Platform North Star

Every platform decision should answer one question:

> **Does this make Viskod a better Visual Context Platform for every AI coding agent, while preserving local-first execution, stable interfaces and long-term maintainability?**

If the answer is yes, it aligns with the platform architecture.

If not, reconsider whether the capability belongs in Viskod at all.

---

# Relationship to Other Documents

This document is the authoritative architecture reference for Viskod. It is complemented by:

**Foundational**
* [Product](./product.md) — product identity and scope
* [Design Principles](./design-principles.md) — engineering philosophy
* [Governance](./governance.md) — decision-making framework
* [Glossary](./glossary.md) — canonical terminology

**Core Subsystems**
* [Visual Context Engine](./visual-context-engine.md)
* [Browser Runtime](./browser-runtime.md)
* [Capture Pipeline](./capture-pipeline.md)
* [Project Scanner](./project-scanner.md)
* [Selection Engine](./selection-engine.md)
* [Source Hint Engine](./source-hint-engine.md)

**Interfaces**
* [MCP Server](./mcp.md)
* [Studio](./studio.md)
* [CLI](./cli.md)
* [SDK](./sdk.md)
* [Plugin API](./plugin-api.md)
* [API Reference](./api-reference.md)

**Infrastructure**
* [Packages](./packages.md)
* [Events](./events.md)
* [State Management](./state-management.md)
* [Diagnostics](./diagnostics.md)
* [Error Handling](./error-handling.md)
* [Logging](./logging.md)
* [Security](./security.md)
* [Privacy](./privacy.md)

**Platform**
* [Roadmap](./roadmap.md)
* [Enterprise](./enterprise.md)
* [Deployment](./deployment.md)
