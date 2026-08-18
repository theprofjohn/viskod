
> **Viskod Product Strategy**
>
> Version: 1.0
>
> Status: **Locked**
>
> Last Updated: 2026-07-28

---

# Executive Summary

Viskod is a **Visual Context Engine** for AI coding agents.

Large Language Models have become exceptionally good at understanding source code, yet they remain fundamentally limited by one missing capability:

**They cannot reliably understand what developers are actually looking at on the screen.**

Developers constantly compensate by writing lengthy descriptions such as:

> "The third button inside the white card on the left has the wrong padding."

This communication overhead creates ambiguity, slows iteration and reduces the quality of AI-generated code.

Viskod eliminates that gap.

It enables developers to visually select any element within a running application, captures structured visual context and exposes that information through the Model Context Protocol (MCP). External AI coding agents can then reason about the actual interface rather than relying solely on textual descriptions.

Viskod does not compete with coding agents.

It makes every coding agent significantly more capable.

---

# Vision

Become the industry standard **Visual Context Layer** between running software and AI coding agents.

In the future, every serious AI-assisted development workflow should include visual understanding as naturally as source code understanding.

---

# Mission

Enable developers to communicate with AI using the interface itself rather than lengthy textual descriptions.

Instead of describing the UI, developers simply point at it.

---

# Product Positioning

## Category

Visual Context Engine

---

## Positioning Statement

For developers using AI coding agents, Viskod provides accurate visual understanding of running applications.

Unlike IDEs, chatbots or browser developer tools, Viskod transforms rendered interfaces into structured machine-readable context that AI can immediately understand.

---

## One Sentence

> AI can read your code. Viskod lets it see your UI.

---

## Elevator Pitch

Viskod bridges the gap between the rendered interface and AI coding agents.

It captures what the developer is looking at—not just the source code—and provides structured context so coding agents can implement changes with significantly less ambiguity.

---

# Market Problem

Modern AI coding assistants understand repositories extremely well.

They do **not** understand the rendered application with the same reliability.

Developers therefore spend a surprising amount of time explaining:

* which component
* which screen
* which button
* which layout
* which responsive breakpoint
* which spacing issue
* which interaction

This creates several problems:

* ambiguous prompts
* repeated clarification
* incorrect edits
* unnecessary screenshots
* slower iteration
* lower confidence

Current tools optimise for code.

Developers work with interfaces.

There is a disconnect.

---

# Why Now

Several industry trends make Viskod possible.

## AI coding has become mainstream

Developers increasingly rely on AI to:

* build features
* debug
* refactor
* document
* review code

Visual understanding has become the missing capability.

---

## MCP is becoming a standard

Model Context Protocol provides a vendor-neutral interface for exposing structured context to AI systems.

Instead of building integrations for every coding assistant individually, Viskod can expose one standard interface.

---

## Browser automation has matured

Modern browser tooling enables reliable inspection of:

* DOM
* screenshots
* computed styles
* accessibility trees
* layout
* diagnostics

These technologies now make a Visual Context Engine practical.

---

# Why Viskod Exists

Current AI development looks like this:

```text
Developer

↓

Describe UI problem

↓

AI guesses

↓

Developer corrects

↓

AI guesses again
```

Viskod changes the workflow.

```text
Developer

↓

Select UI element

↓

Structured visual context

↓

AI understands immediately

↓

Implementation
```

The objective is not better prompts.

The objective is fewer prompts.

---

# Target Users (ICP)

## Primary

Frontend and product engineers who use AI coding agents on **local web apps**
and need a reliable loop from "this UI is broken" to "the rendered result is
fixed and verified".

Examples:

* Frontend engineers
* Product engineers
* Full-stack engineers
* Indie hackers
* Startup founders

The primary job Viskod completes for this ICP:

> Fix an existing UI defect and verify the rendered result.

---

## Secondary

Engineering teams adopting AI-assisted development.

---

## Future

* Design engineers
* QA automation teams
* Accessibility specialists
* Technical consultants
* Developer tooling companies

---

# Jobs-to-be-Done

Developers hire Viskod to:

* report a UI defect by pointing at the element instead of describing it
* hand the issue to a coding agent with enough context to fix it
* verify the rendered result after a fix
* show AI exactly which UI they mean
* reduce prompt ambiguity
* inspect responsive layouts
* provide visual evidence
* accelerate bug fixing
* validate UI changes
* improve AI accuracy
* reduce iteration cycles

The first complete workflow is **UI issue → agent handoff → verified fix**.

---

# Product Principles

## Visual First

Humans think visually.

The interface should be the primary communication medium.

---

## Local First

Projects remain on the developer's machine.

Cloud services are optional, never required.

---

## AI Agnostic

Viskod should improve every AI coding assistant.

No vendor lock-in.

---

## Framework Agnostic

Support should expand across frontend ecosystems without redesigning the architecture.

---

## Honest Results

When uncertain:

Return confidence.

Never invent certainty.

---

## Minimal Friction

The ideal workflow should require:

* open project
* start Viskod
* select UI
* ask AI

Nothing more.

---

# Product Constraints

Viskod intentionally avoids:

* code editing
* integrated chat
* autonomous agents
* Git hosting
* CI/CD
* deployment
* browser replacement
* design editing
* Figma authoring
* project management

These already exist elsewhere.

Viskod focuses exclusively on visual understanding.

---

# Core Workflow

The user-visible workflow in Phase 1:

```text
Developer

↓

Open local app in Studio

↓

Report UI issue (point at the problem)

↓

What is wrong? What should happen?

↓

Prepare agent handoff

↓

Coding agent fixes the code

↓

Verify fix (refresh + recapture)

↓

Accept fix / Issue persists / Needs follow-up
```

Underneath, Studio prepares the agent handoff from a visual selection and a
context packet; the MCP server exposes the handoff to the connected coding
agent. Selectors, packets, and IDs stay behind the scenes.

---

# User Stories

## Frontend Engineer

"I want AI to understand the exact component I'm looking at without describing it."

---

## Startup Founder

"I want to iterate on my product UI quickly using AI."

---

## Design Engineer

"I want implementation discussions to reference the rendered interface instead of screenshots."

---

## AI Coding Agent

"I want structured visual information instead of vague natural language."

---

# Phase Roadmap

## Phase 1

### UI Issue to Verified Fix

Deliver:

* Studio (Report → Prepare agent handoff → Verify fix)
* Browser Runtime
* Selection Overlay
* Screenshots
* DOM Context
* Computed Styles
* MCP Server
* Viewports
* Diagnostics

Goal:

A developer can report a UI defect by pointing at it, hand it to a coding
agent, and verify the rendered result. Capture, selection, and packets are
supporting infrastructure behind that user-visible outcome, not the product
outcome itself. The broader visual-context vision (below) remains the
long-term direction.

---

## Phase 2

### Visual Intelligence

Add:

* better source mapping
* visual diffs
* accessibility insights
* responsive comparison
* design-system awareness
* layout analysis
* issue detection
* confidence improvements

Goal:

Reason about interfaces.

Not just capture them.

---

## Phase 3

### Platform & Ecosystem

Expand into:

* plugin ecosystem
* enterprise workflows
* team collaboration
* cloud sync (optional)
* commercial APIs
* framework SDKs
* marketplace integrations

Goal:

Become the standard visual infrastructure for AI-assisted software development.

---

# Competitive Landscape

## Cursor

Strength:

Excellent AI editor.

Weakness:

Primarily code-centric.

---

## Claude Code

Strength:

Powerful repository reasoning.

Weakness:

Limited rendered interface understanding.

---

## OpenCode

Strength:

Excellent terminal-first workflow.

Weakness:

Needs richer visual context.

---

## Codex CLI

Strength:

Strong code execution.

Weakness:

Little visual awareness.

---

## Gemini CLI

Strength:

Large context.

Weakness:

Visual reasoning depends on supplied context.

---

## Chrome DevTools

Strength:

Industry-standard browser inspection.

Weakness:

Designed for humans rather than AI.

---

## Playwright

Strength:

Reliable browser automation.

Weakness:

Automation framework rather than developer communication layer.

---

## Figma Dev Mode

Strength:

Design-to-code handoff.

Weakness:

Represents intended designs rather than running applications.

---

# Competitive Advantages

Viskod is:

* AI-agnostic
* local-first
* MCP-first
* browser-native
* framework-aware
* focused exclusively on visual context

It complements existing tools instead of replacing them.

---

# Moat Analysis

The long-term moat is **not** the selection overlay.

The moat is accumulated visual intelligence.

Examples include:

* robust source mapping
* framework understanding
* responsive reasoning
* confidence scoring
* layout semantics
* design-system inference
* diagnostics
* ecosystem integrations

As these capabilities improve, the value of Viskod compounds.

---

# Success Metrics

## Phase 1

* Stable local workflow
* Fast startup
* Reliable element selection
* Accurate context packets
* Successful MCP integrations
* A developer can go from "report a UI issue" to "verified fix" without
  operating selectors, packets, or handoff IDs

---

## Phase 2

* Improved source hint accuracy
* Reduced prompt length
* Faster issue resolution
* Better AI implementation quality

---

## Phase 3

* Broad framework support
* Third-party integrations
* Enterprise adoption
* Ecosystem growth

---

# Future Opportunities

Potential expansion areas include:

* accessibility analysis
* visual regression intelligence
* design-system observability
* cross-browser comparisons
* component relationship graphs
* UI quality scoring
* performance diagnostics
* documentation generation
* test generation
* onboarding assistance

These opportunities should only be pursued if they reinforce Viskod's core mission.

---

# Long-term Vision

Viskod should become invisible infrastructure.

Developers should no longer think:

> "I need to explain the UI."

Instead they should simply select it.

In the long term, every AI coding workflow should assume visual context is available by default.

Just as Git became the standard for source control and MCP is becoming a standard for AI context, Viskod aims to become the standard for **visual understanding in AI-assisted software development**.

---

# Relationship to Other Documents

* [Design Principles](./design-principles.md) — engineering philosophy guiding product decisions
* [Architecture](./architecture.md) — technical architecture
* [Glossary](./glossary.md) — canonical terminology
* [Roadmap](./roadmap.md) — product evolution phases
* [Enterprise](./enterprise.md) — organisational adoption

---

# Product North Star

Every product decision should be evaluated against one question:

> **Does this make it easier for AI to accurately understand what the developer is seeing?**

If the answer is **yes**, it aligns with Viskod's mission.

If the answer is **no**, it probably belongs in another product.

---

# Closing Statement

Viskod is not trying to build a better coding agent.

Viskod is building the missing sense that today's coding agents lack.

**AI can read your code. Viskod lets it see your UI.**
