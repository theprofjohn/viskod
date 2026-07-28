
> **Viskod Engineering Memory**
>
> Version: 1.0
>
> Status: Active
>
> Last Updated: 2026-07-28

---

# Purpose

This document is the long-term engineering memory for Viskod.

Unlike `CLAUDE.md`, which defines permanent engineering principles, this file records **why important decisions were made**.

It provides historical context for future contributors and AI coding agents.

Every significant architectural, product, or engineering decision must be recorded here.

---

# Rules

## This file is append-only.

Do not rewrite previous decisions.

Do not silently change history.

If a previous decision becomes obsolete:

* create a new decision
* reference the previous one
* explain why the decision changed

Historical context is valuable.

---

## Every implementation session must:

1. Read this file.
2. Respect existing accepted decisions.
3. Add new decisions when appropriate.

Do not duplicate existing decisions.

---

## Record decisions, not progress.

Good:

* architecture
* trade-offs
* rejected approaches
* technology choices
* naming
* product direction
* security principles
* repository conventions

Avoid recording:

* bug fixes
* formatting changes
* dependency updates
* typo corrections
* routine maintenance

Git history already records those.

---

# Decision Template

Every entry must follow this structure.

```md id="8dn3re"
## Decision 001

Date:
YYYY-MM-DD

Status:
Accepted | Superseded | Rejected | Proposed

Category:
Architecture | Product | Security | Performance | Repository | Tooling | UI | MCP

Title:
Short descriptive title

Context:
Why this decision was necessary.

Decision:
What was decided.

Alternatives Considered:

- Option A
- Option B

Reason for Rejection:

Consequences:

Positive:
-

Negative:
-

Future Review:
Optional.

Supersedes:
Decision XXX (optional)
```

---

# Decision Log

---

## Decision 001

Date:

2026-07-28

Status:

Accepted

Category:

Product

Title:

Viskod is a Visual Context Engine

Context:

Early exploration considered building another AI IDE.

The market already contains strong editor experiences including VS Code, Cursor, Windsurf, Claude Code, Codex CLI and OpenCode.

Competing directly would require rebuilding mature editor functionality without delivering unique value.

Decision:

Viskod will become a Visual Context Engine rather than an IDE.

It provides structured visual understanding while external coding agents remain responsible for software implementation.

Alternatives Considered:

* Standalone IDE
* VS Code fork
* Browser-only editor
* AI coding platform

Reason for Rejection:

All alternatives duplicate existing products rather than complement them.

Consequences:

Positive:

* Smaller scope
* Clear positioning
* Easier integration
* Stronger product identity

Negative:

* Depends on external coding agents

Future Review:

None.

---

## Decision 002

Date:

2026-07-28

Status:

Accepted

Category:

Architecture

Title:

MCP-first architecture

Context:

Viskod needs to communicate with multiple AI coding tools.

A standard interface reduces vendor lock-in.

Decision:

Expose capabilities through Model Context Protocol.

The Studio is the human interface.

The MCP server is the machine interface.

Neither is optional.

Alternatives Considered:

* Custom HTTP API
* Plugin-only architecture
* Proprietary protocol

Reason for Rejection:

Reduced interoperability.

Consequences:

Positive:

* Vendor neutral
* Easier integrations
* Long-term flexibility

Negative:

* Public interfaces require careful versioning

---

## Decision 003

Date:

2026-07-28

Status:

Accepted

Category:

Architecture

Title:

Playwright powers browser runtime

Context:

Viskod requires a reliable browser automation layer.

Decision:

Use the Playwright TypeScript library as the production browser runtime.

Playwright MCP may be used during development but is never required at runtime.

Alternatives Considered:

* Puppeteer
* Selenium
* Browser extensions

Reason for Rejection:

Playwright provides better cross-browser architecture, modern APIs and robust automation.

Consequences:

Positive:

* Stable automation
* Mature ecosystem

Negative:

* Browser downloads increase installation size

---

## Decision 004

Date:

2026-07-28

Status:

Accepted

Category:

Tooling

Title:

Gortex is required during development

Context:

The repository will contain multiple packages with cross-package dependencies.

AI coding agents need repository-wide code intelligence.

Decision:

Use Gortex MCP as the primary repository intelligence tool during development.

Viskod must never depend on Gortex at runtime.

Alternatives Considered:

* Repository grep only
* Manual inspection

Reason for Rejection:

Poor understanding of large repositories.

Consequences:

Positive:

* Better refactoring
* Better architectural awareness

Negative:

* Additional development dependency

---

## Decision 005

Date:

2026-07-28

Status:

Accepted

Category:

Repository

Title:

Monorepo architecture

Context:

Browser runtime, Studio, CLI and MCP server evolve independently.

Decision:

Maintain separate packages inside a pnpm workspace.

Alternatives Considered:

* Single application
* Multiple repositories

Reason for Rejection:

Reduced modularity and harder dependency management.

Consequences:

Positive:

* Clear package ownership
* Easier testing
* Better scalability

Negative:

* Slightly more tooling complexity

---

## Decision 006

Date:

2026-07-28

Status:

Accepted

Category:

Security

Title:

Local-first execution

Context:

Developers inspect proprietary applications.

Decision:

Everything operates locally by default.

No screenshots, source code or visual context are uploaded without explicit user action.

Alternatives Considered:

* Cloud processing
* Hybrid architecture

Reason for Rejection:

Privacy concerns and unnecessary infrastructure.

Consequences:

Positive:

* Better trust
* Lower latency
* Works offline

Negative:

* More local resource usage

---

## Decision 007

Date:

2026-07-28

Status:

Accepted

Category:

Product

Title:

Viskod never edits code

Context:

The temptation exists to gradually become another AI coding assistant.

Decision:

Viskod only observes, captures and exposes context.

Code editing belongs to external coding agents.

Alternatives Considered:

* Built-in code generation
* Integrated AI editor

Reason for Rejection:

Weakens positioning and duplicates existing tools.

Consequences:

Positive:

* Clear product boundary
* Smaller maintenance surface
* Easier integrations

Negative:

* Requires external AI tooling

---

## Decision 008

Date:

2026-07-28

Status:

Accepted

Category:

Architecture

Title:

Evidence-based source mapping

Context:

DOM elements rarely map perfectly to a single source file.

Decision:

Source mapping returns ranked hints with confidence scores.

Never claim exact ownership without supporting evidence.

Alternatives Considered:

* Single guessed file
* Exact mapping claims

Reason for Rejection:

Misleading and unreliable.

Consequences:

Positive:

* Honest results
* Easier debugging
* Better AI reasoning

Negative:

* More implementation complexity

---

# Pending Decisions

Use this section only for decisions that require discussion.

Example:

```md id="mndfyk"
## Proposed Decision

Status:

Proposed

Question:

Should Safari become a supported runtime in Phase 2?

Options:

- Yes
- No

Decision Date:

TBD
```

---

# Rejected Ideas

Record major ideas that were intentionally abandoned.

This prevents repeatedly revisiting the same discussions.

Example:

```md id="od2wpl"
Title:

Embedded AI Chat

Reason:

Duplicates external coding agents.

Decision:

Rejected.
```

---

# Future Architecture Reviews

Major reviews should occur when:

* introducing a new runtime
* adding new supported frameworks
* changing MCP contracts
* introducing commercial features
* redesigning package boundaries

Each review should produce new decision records rather than modifying previous entries.

---

# Closing Principle

This document explains **why** Viskod became what it is.

`CLAUDE.md` defines how to build.

`MEMORY.md` explains why those decisions exist.

Together they provide the permanent engineering knowledge required for long-term development.
