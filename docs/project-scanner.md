
> **Project Scanner Specification**
>
> Version: 1.0
>
> Status: **Locked**

---

# Purpose

The Project Scanner understands the structure of a software project.

Its purpose is to collect project metadata that helps explain a running user interface without analysing application behaviour.

The scanner provides context.

It does not generate code.

---

# Design Philosophy

The scanner should answer one question:

> **"What project is this browser currently displaying?"**

It should avoid answering:

> "How does this application work?"

That responsibility belongs to AI coding agents.

---

# Responsibilities

The Project Scanner is responsible for:

* detecting frameworks
* identifying project structure
* discovering routes
* locating configuration
* identifying package managers
* producing source hints
* generating project metadata

It is not responsible for:

* browser automation
* DOM inspection
* visual analysis
* code generation
* semantic reasoning

---

# Scanner Architecture

```text
Repository

↓

Workspace Discovery

↓

Framework Detection

↓

Configuration Discovery

↓

Project Analysis

↓

Metadata Generation

↓

Source Hint Index
```

Every stage should be deterministic.

---

# Workspace Discovery

The scanner first identifies the project root.

Typical indicators include:

* package.json
* pnpm-workspace.yaml
* bun.lock
* package-lock.json
* yarn.lock
* git repository

Only one active workspace exists per project.

---

# Repository Metadata

Basic metadata includes:

* project name
* repository root
* workspace type
* package manager
* operating system
* language
* runtime

Metadata should remain lightweight.

---

# Framework Detection

Supported frameworks include:

```text
React

Next.js

Vue

Nuxt

Svelte

SvelteKit

Angular

Solid

Astro

Remix

Qwik
```

Framework detection should rely on observable evidence.

---

# Build System Detection

Examples

```text
Vite

Webpack

Rspack

Parcel

Rollup

Turbopack
```

Only detected systems should be reported.

---

# Package Manager Detection

Supported managers

```text
pnpm

npm

Yarn

Bun
```

Exactly one manager should be considered primary.

---

# Monorepo Detection

Supported workspace systems

```text
pnpm Workspace

Turbo

Nx

Lerna

Rush
```

Workspace topology should be represented explicitly.

---

# Configuration Discovery

Configuration files may include:

* tsconfig.json
* vite.config.*
* next.config.*
* astro.config.*
* eslint.config.*
* biome.json
* tailwind.config.*
* package.json

Configuration should be described rather than copied.

---

# Route Discovery

Where supported, the scanner should identify:

* application routes
* layouts
* pages
* route groups
* dynamic routes

Route discovery should remain framework-aware.

---

# Component Discovery

The scanner may identify likely component locations.

Examples

```text
components/

app/

pages/

routes/

src/

ui/
```

Component discovery does not require parsing application logic.

---

# Design System Discovery

Future versions may detect:

* Tailwind CSS
* shadcn/ui
* DaisyUI
* Material UI
* Chakra UI
* Ant Design

Detection should remain evidence-based.

---

# Source Hint Generation

Source Hints estimate where a selected UI element is implemented.

Inputs include:

* project structure
* routes
* filenames
* component naming
* framework conventions
* runtime metadata

Source Hints are probabilistic.

---

# Source Hint Model

Every hint includes:

```text
File Path

Confidence

Evidence

Discovery Method
```

Hints should explain why they were generated.

---

# Confidence Rules

Observed project facts

Confidence

```text
1.00
```

Convention-based discoveries

Confidence

```text
0.70–0.95
```

Heuristic matches

Confidence

```text
0.30–0.69
```

Clients should distinguish certainty from probability.

---

# Caching

Project metadata changes infrequently.

The scanner should cache:

* framework detection
* workspace topology
* configuration metadata
* route metadata

Caches should invalidate when relevant files change.

---

# File Watching

Future versions may monitor:

* configuration changes
* dependency changes
* new routes
* renamed files
* workspace updates

Watching should minimise unnecessary rescans.

---

# Performance Targets

Workspace discovery

```text
<200 ms
```

Framework detection

```text
<100 ms
```

Initial project scan

```text
<2 seconds
```

Incremental rescans

```text
<200 ms
```

Large repositories should degrade gracefully.

---

# Failure Policy

If scanning fails:

* preserve existing metadata
* report diagnostics
* identify failed stages
* continue runtime operation

Project scanning should never block browser interaction.

---

# Extensibility

Future scanner modules may include:

* import graph generation
* component dependency graph
* design token extraction
* localisation discovery
* testing framework detection
* CI configuration discovery

Extensions should remain modular.

---

# Relationship to Other Documents

* [Architecture](./architecture.md) — system boundaries and dependency direction
* [Glossary](./glossary.md) — canonical terminology
* [Source Hint Engine](./source-hint-engine.md) — consumes project metadata for source hints
* [Framework Adapters](./framework-adapters.md) — framework-specific detection logic
* [Settings](./settings.md) — scanner configuration

---

# Project Scanner North Star

The Project Scanner exists to help AI coding agents understand the structure of a repository without becoming a source code analysis engine.

Its role is to provide trustworthy project metadata and evidence-backed source hints that complement visual context while remaining deterministic, lightweight and framework-aware.
