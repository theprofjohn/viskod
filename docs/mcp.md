
> **Model Context Protocol Specification**
>
> Version: 1.0
>
> Status: **Proposed**

---

> **NOTE:** This specification documents the MCP interface implemented by Viskod (registered in `packages/mcp-server/src/entry.ts`).
> The architectural principles (deterministic, versioned, transport-independent) are committed.

# Purpose

This document defines the public Model Context Protocol (MCP) interface exposed by Viskod.

It specifies:

* MCP architecture
* available capabilities
* tools
* resources
* prompts
* schemas
* lifecycle
* versioning
* compatibility guarantees

This document is the authoritative specification for all MCP clients integrating with Viskod.

---

# Design Goals

The MCP interface must be:

* deterministic
* stable
* discoverable
* composable
* versioned
* transport-independent

Every AI coding agent should receive the same capabilities regardless of vendor.

---

# Why MCP

Viskod intentionally does not integrate directly with individual AI providers.

Instead, it implements the open Model Context Protocol.

Benefits include:

* vendor neutrality
* reusable integrations
* consistent interfaces
* simpler maintenance
* future compatibility

Any MCP-compatible client should be able to consume Viskod without custom integration.

---

# High-Level Architecture

```text
AI Coding Agent
        │
        ▼
Model Context Protocol
        │
        ▼
Viskod MCP Server
        │
        ▼
Visual Context Engine
        │
        ▼
Browser Runtime
```

---

# Server Responsibilities

The MCP Server is responsible for:

* exposing capabilities
* validating requests
* routing commands
* serialising responses
* schema negotiation
* version negotiation

The MCP Server is not responsible for:

* browser automation
* DOM analysis
* screenshot generation
* project scanning

Those remain delegated to internal services.

---

# Capability Categories

Viskod exposes three categories of capabilities.

## Tools

Actions requested by AI.

## Resources

Read-only contextual information.

## Prompts

Reusable reasoning workflows.

Each category has different lifecycle semantics and should evolve independently.

---

# Tool Design Principles

Every tool should:

* perform one action
* return structured output
* avoid hidden side effects
* be idempotent where practical
* provide deterministic responses

Avoid tools that combine unrelated operations.

---

# Core Tools

Implemented tools (31 total, registered by `packages/mcp-server/src/entry.ts`):

```text
viskod_navigate
viskod_select_element
viskod_capture_context
viskod_get_project_info
viskod_get_diagnostics
create_agent_handoff
get_agent_handoff
list_agent_handoffs
update_agent_handoff_status
cancel_agent_handoff
get_handoff_context
create_visual_review
get_visual_review
list_visual_reviews
recapture_visual_review
record_visual_review_decision
resolve_usage_site_hints
get_setup_state
detect_project
initialize_workspace
run_setup_checks
run_setup_smoke
complete_setup
repair_setup
verify_mcp_tools
validate_app_url
viskod_get_chat_messages
viskod_send_chat_response
viskod_notify_ui
viskod_get_settings
viskod_update_settings
```

Core capture tools use the `viskod_` prefix; handoff, review, and setup tools use snake_case names.

---

# Resource Model

Resources represent current platform state.

Implemented resources:

```text
viskod://captures/latest

viskod://project/info
```

Resources are read-only snapshots.

Reading a resource must never modify runtime behaviour.

---

# Prompt Library

Prompts package reusable workflows.

Examples:

```text
Explain Current Selection

Review Layout

Review Responsive Design

Explain Component Hierarchy

Review Accessibility

Summarise Current Page

Review Visual Consistency
```

Prompts should remain implementation-agnostic.

---

# Session Lifecycle

```text
Connect

↓

Discover Capabilities

↓

Read Resources

↓

Invoke Tools

↓

Receive Results

↓

Disconnect
```

The server should minimise session state.

---

# Request Validation

Every request must validate:

* tool name
* parameters
* schema version
* required fields
* value types

Invalid requests return structured validation errors.

---

# Response Model

Every successful response includes:

```text
Status

Schema Version

Timestamp

Payload

Metadata
```

Responses should be deterministic and machine-readable.

---

# Error Model

Errors include:

```text
Error Code

Message

Category

Suggested Recovery
```

Internal implementation details must never leak through public errors.

---

# Context Packet Contract

Context Packets are immutable.

Each packet contains:

* packet identifier
* schema version
* capture timestamp
* browser metadata
* viewport information
* selected element
* hierarchy summary
* computed styles
* diagnostics
* screenshots
* source hints
* confidence scores

Packets represent a point-in-time snapshot.

---

# Handoff Context Retrieval

`get_handoff_context(handoffId)` resolves a handoff's durable persisted
capture(s) into a compact agent-safe context projection by opaque ID. The
projection is derived from the schema-validated safe capture on disk —
never from in-memory objects — so it survives Studio/MCP restarts and fresh
coding-agent connections. It includes the selected target (selector, text,
redacted attributes), page URL (redacted), viewport, compact hierarchy,
budgeted computed styles, runtime evidence summary, per-provider evidence
statuses, screenshot status, issue intent, and — when source resolution was
available at capture time — a bounded set of QUALIFIED source candidates
(Phase 30): each candidate carries a repository-relative path, a semantic
qualification (`exact | probable | possible | weak`), a calibrated
confidence, and concise reasons. The overall `resolution` field is
`resolved | ambiguous | unavailable` and — for captures made since Phase 30A —
is the PERSISTED capture-time conclusion: the packet records a
`sourceHintsResolution` snapshot (`status` + `modelVersion` + optional
`topCandidate`) and the projection reports it verbatim (`resolutionSource:
"persisted"`) together with the `modelVersion` that produced it. The fresh
agent process never recomputes source hints and never reranks historical
candidates: qualification, confidence, and ordering are the capture-time
values. Legacy packets that predate the snapshot are derived
deterministically with an explicit `resolutionSource: "derived"` marker —
never presented as the original capture-time conclusion. Duplicate-text
targets persist as `ambiguous` with both bounded candidates and neither
presented as confirmed. Returns typed errors for missing/corrupt/mismatched
handoff or capture state; structurally invalid persisted source data
(invalid qualification, out-of-range confidence, absolute/traversal paths)
is rejected as corrupt — never returned as normal agent context. Never
exposes raw packet JSON, absolute filesystem paths, or raw screenshot
pixels.

---

# Schema Versioning

All public schemas use semantic versioning.

Breaking changes require a new major version.

Older schema versions should remain supported where feasible.

---

# Compatibility Policy

Viskod aims to maintain backwards compatibility for all stable interfaces.

When incompatibilities are unavoidable:

* announce changes
* document migration
* retain previous versions during transition
* remove deprecated versions only after a defined lifecycle

---

# Security

The MCP Server must never expose:

* secrets
* cookies
* authentication tokens
* environment variables
* filesystem contents outside approved scope

All outputs are sanitised before transmission.

---

# Performance Targets

Capability discovery:

```text
<100 ms
```

Tool execution:

```text
<500 ms
```

Resource retrieval:

```text
<100 ms
```

Performance targets should be monitored continuously.

---

# Client Compatibility

The MCP interface is designed to support clients including:

* Claude Code
* OpenCode
* Codex CLI
* Cursor
* Gemini CLI
* VS Code MCP clients
* future MCP-compatible tooling

No client-specific behaviour should exist within the protocol layer.

---

# Extension Policy

Future capabilities should be additive.

Examples:

* Accessibility tools
* Visual diff tools
* Design system inspection
* Performance analysis
* Multi-page workflows

New capabilities should extend existing interfaces rather than replace them.

---

# North Star

The MCP layer exists to make Viskod universally accessible.

Its responsibility is not to understand code or generate code.

Its responsibility is to expose accurate, trustworthy visual context through a stable, versioned protocol that any AI coding agent can consume.

# Relationship to Other Documents

This document specifies the MCP Server interface. It is complemented by:

* [Architecture](./architecture.md) — system boundaries and dependency direction
* [Glossary](./glossary.md) — canonical terminology
* [Visual Context Engine](./visual-context-engine.md) — provides the context that MCP exposes
* [Context Packet](./context-packet.md) — the data format exposed via MCP
* [SDK](./sdk.md) — alternative integration path
* [Tool Reference](./tool-reference.md) — catalogue of public tools
* [Security](./security.md) — MCP security policies
