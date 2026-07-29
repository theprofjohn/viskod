
> **Viskod**
>
> **AI can read your code. Viskod lets it see your UI.**

---

# Overview

Viskod is a **Visual Context Engine** for AI coding agents.

Modern coding agents can understand source code extremely well.

What they cannot reliably understand is the **running user interface**.

Developers often end up writing prompts like:

> "The third button inside the card on the left doesn't align correctly."

That process is slow, ambiguous and error-prone.

Viskod removes that ambiguity.

Select an element in a running application and Viskod captures structured visual context—including screenshots, DOM metadata, computed styles, diagnostics and source hints—then exposes it through **Model Context Protocol (MCP)** so external AI coding agents can reason about what you are seeing.

---

# Vision

Make visual software understanding a standard capability for AI-assisted software development.

Instead of describing the interface, developers should simply point at it.

---

# What Viskod Is

Viskod is:

* A Visual Context Engine
* A browser inspection system
* An MCP server
* A local-first developer tool
* A bridge between running applications and AI coding agents

---

# What Viskod Is Not

Viskod is **not**:

* an IDE
* a code editor
* a chatbot
* an AI coding assistant
* a browser replacement
* a Figma alternative
* an autonomous software engineer

Viskod observes.

AI coding agents implement.

---

# How It Works

```text
Developer
      │
      ▼
Start Viskod
      │
      ▼
Open Running Application
      │
      ▼
Select UI Element
      │
      ▼
Visual Context Engine
      │
      ▼
Context Packet
      │
      ▼
MCP Server
      │
      ▼
Claude Code
OpenCode
Codex
Gemini CLI
Cursor
VS Code Extensions
```

---

# Example Workflow

```bash
cd my-project

npx viskod
```

Viskod will:

* detect the project
* start or connect to the development server
* launch the Studio
* launch the MCP server
* open the application preview

Next:

1. Select an element.
2. Open your preferred AI coding agent.
3. Ask it to inspect the current Viskod selection.
4. Let the coding agent implement the requested change.

---

# Example Prompt

Instead of writing:

> "The Save button looks strange."

Simply write:

> Inspect the current Viskod selection and fix the spacing while preserving the existing design system.

The coding agent already knows which element you selected.

---

# Features

## Phase 1

* Local-first execution
* React support
* Next.js support
* Vite support
* Chromium browser runtime
* Desktop, tablet and mobile viewports
* Interactive element selection
* Container selection
* Screenshot capture
* DOM inspection
* Computed style extraction
* Diagnostics collection
* Source hints
* MCP server
* Studio interface
* Structured visual context packets

---

# Architecture

```text
Studio
      │
      ▼
Visual Context Engine
      │
      ▼
Browser Runtime
      │
      ▼
Running Application

              │

              ▼

          MCP Server

              │

              ▼

      External AI Coding Agent
```

Every layer has a single responsibility.

---

# Repository Structure

```text
viskod/

├── CLAUDE.md
├── MEMORY.md
├── README.md
├── ROADMAP.md
│
├── docs/
│
├── apps/
│   └── studio/
│
├── packages/
│   ├── browser-runtime/
│   ├── cli/
│   ├── context-engine/
│   ├── mcp-server/
│   ├── shared/
│   └── config/
│
├── examples/
│
└── tests/
```

---

# Supported Technologies

Phase 1 targets:

* Node.js 22+
* TypeScript
* React
* Next.js
* Vite
* Chromium
* pnpm

Additional frameworks will be considered after the core architecture stabilises.

---

# Installation

```bash
pnpm install
```

---

# Development

```bash
pnpm dev
```

---

# Build

```bash
pnpm build
```

---

# Tests

```bash
pnpm test
```

End-to-end tests:

```bash
pnpm test:e2e
```

---

# Repository Validation

Run all quality checks:

```bash
pnpm check
```

This command should execute:

* formatting
* linting
* type checking
* unit tests
* package builds

Any failure should return a non-zero exit code.

---

# Development Philosophy

Viskod follows a few simple principles:

* Local first
* MCP first
* Explicit contracts
* Small packages
* Security by default
* Evidence over assumption

Read `CLAUDE.md` before contributing.

Review `MEMORY.md` before introducing architectural changes.

---

# MCP Agent Workflow

Viskod exposes two MCP tools for AI coding agents: `capture_context` and `recapture_context`.

The standard workflow:

1. **Start** `pnpm viskod serve --url <APP_URL>`
2. **Capture** `capture_context(selector, url, profile: "debug")` → receive a brief with source hints
3. **Fix** the issue in the identified source file
4. **Re-capture** `recapture_context(previousPacketPath, reload: true, cacheBust: true)` → verify with `comparisonSummary`

Detailed guides:
- [Quickstart](QUICKSTART_MCP.md) — 8-step walkthrough from install to verified fix
- [Agent Workflow](AGENT_WORKFLOW.md) — tool usage, profile guidance, comparison interpretation
- [MCP Config Examples](examples/mcp-configs/) — OpenCode, Cursor, and Claude Desktop templates
- [Agent Prompt Template](examples/agent-workflows/prompts/fix-visual-issue.md) — copy-paste prompt for coding agents

---

# Documentation

The architecture documentation baseline is frozen at v1.0 (score: 94/100).

| Document | Purpose |
|----------|---------|
| [Product](./docs/product.md) | Product identity, scope, and positioning |
| [Design Principles](./docs/design-principles.md) | Engineering philosophy |
| [Architecture](./docs/architecture.md) | System boundaries, dependencies, and data flow |
| [Architecture Baseline](./docs/ARCHITECTURE_BASELINE.md) | Frozen canonical snapshot |
| [Audit Report](./docs/AUDIT_REPORT_V2.md) | Documentation consistency audit results |
| [Change Summary](./docs/CHANGE_SUMMARY.md) | Remediation change log |
| [Governance](./docs/governance.md) | Decision-making framework |
| [RFC Process](./docs/rfcs.md) | Architectural change proposal process |
| [Glossary](./docs/glossary.md) | Canonical terminology |

Future architectural changes to product scope, subsystem ownership, dependency direction, runtime boundaries, public contracts or invariants require an RFC.

---

# Privacy

Viskod is designed to keep development data on your machine.

By default it does **not**:

* upload source code
* upload screenshots
* upload DOM information
* upload repository contents
* collect telemetry

The developer owns their data.

---

# Security

Default behaviour includes:

* localhost-only services
* validated inputs
* typed contracts
* sensitive attribute redaction
* no automatic `.env` inspection
* no cookie exposure
* no token exposure

Security is treated as a core product feature.

---

# Development MCPs

Recommended development tooling:

## Required

* Gortex MCP

Used for:

* repository indexing
* dependency analysis
* symbol lookup
* architectural navigation

Runtime must never depend on Gortex.

---

## Optional

* Playwright MCP

Useful for:

* Studio verification
* browser debugging
* automated UI inspection

Viskod itself uses the Playwright TypeScript library internally regardless of whether Playwright MCP is installed.

---

# Current Status

Current milestone:

**Phase 1 — Foundation**

Focus:

* repository architecture
* browser runtime
* visual context engine
* MCP integration
* Studio

Commercial features are intentionally deferred.

---

# Roadmap

## Phase 1

Visual Context Engine

## Phase 2

Source intelligence

Framework expansion

Visual diffing

Accessibility insights

## Phase 3

Commercial edition

Enterprise capabilities

Plugin ecosystem

---

# Contributing

Before making changes:

1. Read `CLAUDE.md`.
2. Read `MEMORY.md`.
3. Review the implementation documents under `docs/`.
4. Run `pnpm check`.
5. Keep documentation updated.

---

# Design Goal

The ideal workflow should feel effortless.

A developer should never need to explain where a visual issue exists.

Selecting the interface should provide enough context for an AI coding agent to understand the problem immediately.

That is the purpose of Viskod.

---

# License

Licence information will be added before the first public release.
