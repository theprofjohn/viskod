
> **Viskod Engineering Constitution**
>
> Version: 1.0
>
> Status: **Locked**
>
> Last Updated: 2026-07-28

---

# Purpose

This document is the permanent engineering constitution for Viskod.

Every AI coding agent (OpenCode, Claude Code, Codex, Gemini, Cursor, etc.) **must read this document before making changes to the repository.**

This document defines:

* product vision
* engineering philosophy
* architecture
* coding standards
* repository conventions
* security principles
* implementation priorities
* quality expectations

This document is **authoritative**.

When conflicts exist between implementation and this document, this document takes precedence unless a newer architectural decision recorded in `MEMORY.md` explicitly supersedes it.

---

# Product Vision

Viskod is a **Visual Context Engine** for AI coding agents.

Its purpose is simple:

> **AI can read your code. Viskod lets it see your UI.**

Viskod allows developers to:

* inspect a running application visually
* select UI elements
* capture structured visual context
* expose that context through MCP
* allow external AI coding agents to understand what the developer is pointing at

Viskod exists to reduce ambiguity between developers and AI.

---

# Product Positioning

Viskod is **NOT**:

* an IDE
* a code editor
* an AI coding assistant
* a chatbot
* an autonomous software engineer
* a browser extension marketplace
* a design tool
* a Figma replacement

Viskod **IS**:

* a Visual Context Engine
* a browser inspection system
* an MCP server
* a bridge between the running UI and AI coding agents

---

# Core Principle

The running application is the source of visual truth.

The repository is the source of code truth.

The AI coding agent is responsible for code changes.

Viskod provides context.

Viskod does not own implementation.

---

# Product Philosophy

Always optimise for:

* clarity
* predictability
* correctness
* maintainability
* composability
* local-first execution

Never optimise for novelty.

---

# Engineering Principles

## 1. Local First

Everything should work locally.

Do not require:

* cloud services
* hosted APIs
* external databases
* authentication
* subscriptions

Phase 1 must function without an internet connection after dependencies are installed.

---

## 2. MCP First

Every capability should be designed as something that can be consumed through MCP.

The Studio exists primarily for humans.

The MCP server exists primarily for AI.

Neither is secondary.

---

## 3. Composable Packages

The repository must consist of focused packages.

Avoid monolithic applications.

Every package must have a single responsibility.

---

## 4. Explicit Contracts

All communication between packages must be:

* typed
* validated
* versioned

Use Zod for runtime validation.

Never trust unvalidated input.

---

## 5. Security by Default

Assume repositories contain:

* secrets
* credentials
* customer data
* proprietary source code

Never expose information unnecessarily.

Protect privacy before convenience.

---

## 6. Evidence Over Assumption

Never claim certainty without evidence.

Examples:

Instead of:

> This button comes from Button.tsx.

Prefer:

> Likely source: Button.tsx (84% confidence).

Confidence is a feature.

False certainty is a bug.

---

# Architecture Principles

Viskod follows a layered architecture.

```text
Developer
        │
        ▼
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

No layer should bypass another without justification.

---

# Responsibility Boundaries

## Viskod owns

* browser inspection
* viewport management
* screenshots
* DOM inspection
* computed styles
* diagnostics
* structured visual context
* MCP

---

## AI Coding Agents own

* source editing
* planning
* refactoring
* code generation
* debugging
* commits
* pull requests

---

## Browsers own

* rendering
* layout
* CSS
* JavaScript execution

Do not duplicate browser functionality.

---

# Repository Philosophy

Every directory must have a clear purpose.

Avoid "miscellaneous" folders.

Prefer explicit naming.

Good:

```text
context-engine
browser-runtime
mcp-server
```

Bad:

```text
core
utils
common
shared2
helpers_new
misc
```

Names should describe responsibility, not implementation.

---

# Package Rules

Each package must:

* compile independently
* have isolated tests
* expose explicit public APIs
* hide internal implementation

Never import private files across packages.

---

# Dependency Rules

Dependencies are liabilities.

Before adding a dependency ask:

1. Is it actively maintained?
2. Is it widely adopted?
3. Is it production proven?
4. Can we replace it with platform APIs?
5. Is the maintenance burden justified?

Prefer fewer dependencies.

---

# Technology Principles

Prefer:

* TypeScript
* Playwright
* Zod
* React
* Vite
* pnpm
* Biome
* Vitest

Avoid introducing frameworks without clear justification.

---

# Performance Principles

Performance is a feature.

Target:

* fast startup
* responsive UI
* low memory usage
* minimal CPU overhead

Do not optimise prematurely.

Measure first.

Optimise second.

---

# UI Principles

The interface must feel:

* professional
* minimal
* calm
* obvious
* consistent

Avoid:

* excessive animation
* decorative effects
* unnecessary gradients
* visual noise

The product exists to inspect applications, not distract from them.

---

# Error Handling

Never hide errors.

Every error must include:

* code
* message
* cause
* recovery suggestion

Avoid generic messages like:

> Something went wrong.

---

# Logging

Logs exist for debugging.

Not marketing.

Do not print unnecessary information.

Never log:

* passwords
* API keys
* cookies
* secrets
* tokens
* environment variables

---

# Security Rules

Never:

* read `.env` by default
* expose cookies
* expose local storage
* expose session tokens
* upload screenshots
* transmit repository contents externally

Default bind address:

```text
127.0.0.1
```

Never expose local services publicly unless explicitly configured.

---

# Privacy Principles

The developer owns their data.

Everything remains local unless the developer explicitly exports it.

No telemetry in Phase 1.

---

# Source Mapping

Source mapping is probabilistic.

Never represent guesses as facts.

Every source hint must include:

* confidence
* reasoning

---

# MCP Philosophy

MCP is the public interface.

Design MCP tools carefully.

Once released:

Treat them as APIs.

Avoid breaking changes.

Version schemas explicitly.

---

# Documentation Rules

Documentation is part of the product.

If implementation changes:

Documentation changes.

Never leave documentation stale.

---

# Testing Philosophy

Every important feature should have:

* unit tests
* integration tests
* end-to-end tests where practical

Passing tests are required.

Missing tests require justification.

---

# Code Style

Prefer:

Small files.

Small functions.

Explicit names.

Pure functions where practical.

Readable code over clever code.

---

# TypeScript Rules

Strict mode enabled.

Avoid:

```ts
any
```

Use:

* unknown
* generics
* discriminated unions

Document exceptions.

---

# Git Rules

Small commits.

Meaningful commit messages.

Avoid committing unrelated work together.

---

# Development Workflow

Implementation order matters.

Do not jump ahead.

Preferred sequence:

1. contracts
2. types
3. implementation
4. tests
5. documentation
6. optimisation

Never reverse this order without reason.

---

# Gortex Usage

Gortex is a development tool.

Use it to:

* inspect architecture
* understand dependencies
* locate symbols
* trace references
* estimate impact

Never make runtime depend on Gortex.

---

# Playwright

Playwright is Viskod's browser runtime.

Playwright MCP is optional.

The application must continue functioning without Playwright MCP.

---

# AI Coding Agent Rules

Before implementing any feature:

1. Read this document.
2. Read `MEMORY.md`.
3. Understand existing architecture.
4. Search for similar implementations.
5. Avoid duplication.
6. Produce an implementation plan.
7. Implement incrementally.
8. Run validation.
9. Fix failures.
10. Update documentation.

Never skip validation.

---

# Definition of Done

A task is complete only when:

* implementation works
* lint passes
* typecheck passes
* tests pass
* documentation updated
* no known regressions introduced

---

# Anti-Patterns

Avoid:

* giant classes
* giant React components
* hidden state
* circular dependencies
* duplicated logic
* copy-paste implementations
* premature optimisation
* excessive abstraction
* magic strings
* magic numbers

---

# Decision Making

When multiple solutions exist:

Choose the one that is:

* simpler
* easier to maintain
* easier to test
* easier to explain
* easier to remove

Complexity requires justification.

---

# Backwards Compatibility

Breaking changes require:

* explicit discussion
* migration strategy
* version increment

Do not silently break public behaviour.

---

# Future Expansion

Future features should integrate naturally with the existing architecture.

Avoid designs that prevent:

* new frameworks
* new browsers
* additional MCP tools
* commercial editions

Design for extension.

Not speculation.

---

# What Success Looks Like

A developer should be able to:

1. Start Viskod.
2. Open their application.
3. Click a UI element.
4. Ask an AI coding agent to inspect it.
5. Receive an accurate implementation based on the captured visual context.

The developer should never need to describe:

> "the third button on the left inside the white card..."

The software should already know.

---

# Final Principle

Every line of code should move Viskod closer to becoming the industry's standard **Visual Context Engine** for AI-assisted software development.

When uncertain, choose the solution that makes the system:

* simpler
* safer
* more composable
* easier to reason about
* easier for both humans and AI agents to understand

<!-- gortex:communities:start -->
## Codebase Overview (generated by Gortex)

- **Languages:** markdown (primary)
- **Graph size:** 3259 nodes, 2823 edges
- **Breakdown:** 1412 docs, 53 files, 1794 variables

## MANDATORY: Use Gortex MCP tools instead of Read/Grep/Glob

Gortex is running as an MCP server. You **MUST** prefer graph queries over file reads on every task in this repo — `search_symbols`, `find_usages`, `get_symbol_source`, `get_editing_context`, `smart_context`, `edit_symbol` / `edit_file` / `rename_symbol` / `batch_edit`. Hook posture is configurable; follow every Gortex hook instruction even when `Read` / `Grep` / `Glob` remain callable. The full per-tool catalog loads via `tools/list` — not restated here.

### Calibration: the graph narrows scope, source confirms behavior

The mandate above stands — but graph queries *narrow scope*, they do not *replace reading the implementation*. The graph tells you **where** the logic lives and **what** connects to it; the source tells you **how** it behaves. For the symbol you are about to change or depend on, read its full body with `get_symbol_source` — do not act on a one-line summary alone.

Be especially deliberate with **behavior-critical code** — database migrations, retry / fallback / error-recovery paths, compatibility shims, concurrency-sensitive sections, and the tests that pin them. For these, call `get_symbol_source` and read the real implementation; never pass `compress_bodies:true`, which elides exactly the branches that carry the risk. Reserve compressed bodies and graph summaries for breadth (surveying many symbols); use full source for the few you are about to commit to.

## Required workflow (every task on this repo)

These are not suggestions — run each step at the trigger.

1. Confirm the daemon is up with `index_health` (cheap liveness + scope). Call `graph_stats` only when you actually need node/edge counts or `per_repo` orientation — it returns a large payload and can block during warmup.
2. If `total_nodes` is 0, **call** `index_repository` with `"."` before anything else.
3. In multi-repo mode, **call** `get_active_project` to check scope; use `set_active_project` to switch.
4. Open a non-trivial task with `smart_context` for orientation. For a single known symbol or file, go straight to `search_symbols` / `get_symbol_source` — don't front-load `smart_context` before every read.
5. Before editing a file, **call** `get_editing_context` on it first.
6. Before changing any function signature, **call** `verify_change` to catch broken callers and interface implementors (cross-repo).
7. For any refactor, **call** `get_edit_plan` then `batch_edit` to apply atomically.
8. Verify with the project's real build/test. Reserve `check_guards` for guard-relevant changes and `get_test_targets` to find the tests covering a substantive change — not mechanically after every edit.

<!-- gortex:communities:end -->
