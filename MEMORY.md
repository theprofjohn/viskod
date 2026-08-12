
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

Unlike the repository instruction files (`AGENTS.md`, `README.md`), which define current engineering conventions, this file records **why important decisions were made**.

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

## Decision 009

Date:

2026-08-05

Status:

Accepted

Category:

Product

Title:

UI Issue to Verified Fix is the first product workflow

Context:

Viskod had a technically capable capture/MCP workflow but no understandable
human surface: Studio was a JSON/WebSocket inspection backend, and the docs
taught selectors, packets, handoff IDs, and recapture flags as the normal
path. The reusable user-facing services (VisualSelectionServiceImpl +
SelectionOverlayController, IssueServiceImpl, UserFacingHandoff,
UserFacingReview) were not wired together.

Decision:

The first complete product workflow is: open a local app → report a UI issue
by pointing at the element → describe the problem and expected result →
prepare an agent handoff → refresh and verify the fix → accept, reject, or
request follow-up. Studio exposes three stages (Report, Prepare for agent,
Verify); capture, selection, and packets become supporting infrastructure.
A changed screenshot is evidence, not truth — the human always decides.
Studio prepares handoffs; it never claims to invoke an external coding agent
(the MCP integration only makes the handoff available to the connected
agent).

Alternatives Considered:

- Generic browser inspection as the product promise — rejected: inspection
  panels do not complete a user job.
- In-Studio agent invocation — rejected for this phase: duplicates existing
  coding agents and exceeds the current MCP integration (Decision 001).
- Selector-first workflow with a VisualIssue schema migration — rejected:
  expected result persists in `description` as
  `Problem:\n<problem>\n\nExpected result:\n<expected>`; no migration.

Reason for Rejection:

See alternatives.

Consequences:

Positive:

- One understandable end-user path (RFC-0001)
- Selectors/packets/IDs stay behind the scenes
- Human review boundary preserved

Negative:

- Studio UI work required (framework-free HTML, workflow orchestrator,
  WebSocket state broadcast)

Future Review:

Automatic agent-launch integration behind a separately verified API.

Supersedes:

None.

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

## Decision 010

Date:

2026-08-05

Status:

Accepted

Category:

Repository

Title:

Distribute Viskod as a single bundled npm package

Context:

Viskod had no distribution mechanism: the monorepo is private, nothing is
published, and the MCP server is spawned from a checkout via `npx tsx`. End
users cannot install via npm, bun, curl, brew, mise, or any package manager.
The compiled tsc output cannot run on plain Node: source uses
`moduleResolution: "bundler"` with extensionless relative imports (133 in
dist), which Node ESM rejects. A bundle is therefore the only minimal path.

Decision:

Publish a single `@viskod/cli` npm package containing an esbuild bundle of
the CLI plus all `@viskod/*` workspace dependencies and zod. Playwright
stays an external runtime dependency (native driver + browser downloads);
`postinstall` runs `playwright install chromium` (opt out via
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`). A tag-pushed GitHub Actions workflow
(`v*`) runs the gate, publishes with an `alpha`/`latest` tag derived from
the version, verifies the published binary over MCP stdio, and creates a
GitHub release. The tsx-from-source dev flow is unchanged.

Supporting changes: `MCPServer` extracted from `mcp-server/index.ts` into
`server.ts` (broke an entry.ts ↔ index.ts import cycle that esbuild cannot
flatten); the standalone bootstrap in `entry.ts` now fires only when the
module is literally `entry.ts` (the setup package spawns it directly);
`cmdInstall` gained an installed-mode branch that points MCP clients at the
bundled entry with the current Node binary; `serve` logs its banner to
stderr so stdout stays pure JSON-RPC.

Alternatives Considered:

- Publish all 22 packages individually
- No publishing (status quo)

Reason for Rejection:

The 22-package path requires a repo-wide module-resolution migration (TS
5.7 `rewriteRelativeImportExtensions` + NodeNext) plus 22× manifest churn;
worth it only when SDK consumers exist. Status quo blocks every installer.

Consequences:

Positive:

- `npm i -g`, `bun add -g`, `npx`, and `curl <registry tarball>` work
- MCP client config no longer requires a repo checkout
- Single artifact, single version to verify

Negative:

- Bundle ships zod and all workspace packages in one file (no granular
  installs; fine for a dev tool)
- Consumers accept a Chromium download on install
- The `@viskod/*` package graph stays unpublished for SDK consumers

Future Review:

When third-party SDK consumers appear, evaluate the NodeNext migration for
per-package publishing.

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

The repository instruction files (`AGENTS.md`, `README.md`) define how to build.

`MEMORY.md` explains why those decisions exist.

Together they provide the permanent engineering knowledge required for long-term development.

---

## Decision 011

Date:

2026-08-08

Status:

Accepted

Category:

Product

Title:

Open-core product with paid Team and Enterprise layers

Context:

Viskod needs an adoption and revenue model that preserves its local-first
privacy promise and complements existing AI coding agents. Charging for
basic capture or making the local workflow cloud-dependent would weaken the
product boundary. A fully open-source project without a commercial path would
leave team collaboration, governance, and support unmonetized.

Decision:

Viskod will use an open-core model. The complete local visual-context workflow
will be open source under Apache-2.0, including the CLI, Studio, browser
runtime, MCP server, selection and capture, basic UI issue-to-verified-fix
workflow, SDK, and framework adapters.

Paid Team and Enterprise offerings will provide optional collaboration, shared
workspaces, CI and visual regression workflows, integrations, governance,
SSO/RBAC, self-hosting, premium support, and SLA capabilities. Local capture
will remain usable without cloud dependency. Commercial code may depend on the
public core; the public core must never depend on commercial services.

The repository will remain private until the license, source boundary,
history/secrets audit, and commercial-repository split are ready. The public
core will be published before a user-facing README rewrite and marketing
website.

Alternatives Considered:

- Closed product with an open SDK
- Fully open source with only a future hosted service
- Metered pricing for screenshots, MCP calls, or visual captures

Reason for Rejection:

A closed core would reduce adoption and trust. A future-only hosted service
delays revenue validation. Metering the core workflow conflicts with the
local-first product promise and makes adoption harder.

Consequences:

Positive:

- Solo developers receive a useful, complete, zero-cloud product
- The open core can build trust and an integration ecosystem
- Revenue is tied to team coordination, governance, and support value
- Commercial services remain optional and architecturally separate

Negative:

- Commercial collaboration and governance capabilities still need to be built
- Apache-2.0 permits competitors to use the open core
- Public release requires a history and secrets audit

Future Review:

Validate the Team and Enterprise feature boundary with design partners before
building cloud infrastructure or committing to final pricing.

Supersedes:

None.

---

## Decision 012

Date:

2026-08-08

Status:

Accepted

Category:

Repository

Title:

Staged public core repository

Context:

The open-core decision requires a public home for the open-source product,
but publishing the current repository immediately could expose unfinished
internal material, private history, credentials, or future commercial code.

Decision:

Keep the current repository private while the license, open-source boundary,
Git history, secrets, private URLs, and internal-only material are audited.
After preparation, publish the open-source core in a public repository. Keep
Team and Enterprise services in a separate private repository.

The public core should be published before rewriting the user-facing README.
The marketing website remains a later step, after installation and product
workflow evidence exist.

Alternatives Considered:

- Publish the current repository immediately
- Keep the entire product private indefinitely

Reason for Rejection:

Immediate publication creates avoidable disclosure risk. Permanent privacy
contradicts the adoption strategy for the open-source core.

Consequences:

Positive:

- Public release has a deliberate license and clean source boundary
- Commercial implementation details remain private
- README and website work are sequenced after the product foundation

Negative:

- Public launch is delayed until the audit is complete
- Repository split and history review require deliberate work

Future Review:

Review the boundary after design-partner feedback and before adding the first
commercial service.

Supersedes:

None.

---

## Decision 013

Date:

2026-08-12

Status:

Accepted

Category:

Repository

Title:

Deterministic alpha release gate

Context:

The phase-24/25 dogfood tests require an external shadcn-admin fixture on
`localhost:5173` that a clean checkout does not provide, so the old
`release:check` (plain `vitest run`) failed a release from a clean
environment with connection-refused errors. A tagged alpha release must be
reproducible from a clean checkout with no developer-machine paths.

Decision:

- The CI/release test suite is `test:ci` (`vitest run --config
  vitest.ci.config.ts`), which excludes `**/dogfood*.test.ts` via a dedicated
  vitest config instead of shell globs (single quotes in npm scripts break on
  Windows cmd; shell quoting is not a release-gate mechanism).
- Dogfood tests remain local-only under `test:dogfood` and fail with a clear
  message when the external fixture directory is missing.
- `release:check` is deterministic: `biome check . && tsc -b && pnpm test:ci
  && pnpm smoke:agent-workflow && pnpm build:cli && node
  scripts/verify-cli-artifact.mjs`. The smoke is the end-to-end proof (it
  starts its own fixture and Studio) and is never skipped.
- `packages/cli/package.json` is the publishable version authority; the root
  version mirrors it. `scripts/verify-release-version.mjs` refuses any tag
  that is not `v<cli version>`; the release workflow runs it before the gate.
- `scripts/verify-cli-artifact.mjs` packs `@viskod/cli` and fails unless the
  tarball is `@viskod/cli` at the expected version with only the declared
  `dist/index.js` entrypoint and no repository source, `.viskod` data, test
  files, or secret-looking files.
- The release workflow requires a GitHub `release` environment (human
  approval), publishes the exact verified tarball, and creates the GitHub
  release only after post-publish verification of the installed package.
- The bundled CLI reports its version (`viskod --version`); the version is
  injected at bundle time by `scripts/build-cli.mjs` from the publishable
  package version.

Alternatives Considered:

- Keep the inline `--exclude '**/dogfood*.test.ts'` argument in npm scripts:
  single quotes are passed literally through pnpm's cmd-based script runner on
  Windows, so dogfood tests ran anyway.
- Use `pnpm --filter @viskod/cli pack`: pnpm rejects `--filter` with `pack`
  (recursive-mode option parse error); `pnpm --dir packages/cli pack` is used
  instead.

Reason for Rejection:

The inline-exclude alternative was observed to fail on Windows; the
`--filter` pack variant fails on every platform.

Consequences:

Positive:

- A tagged release is reproducible from a clean checkout on Linux CI and
  Windows locally.
- The published artifact is exactly the verified tarball; no second build.
- Version/tag mismatch, failed gates, or missing approval prevent publication.

Negative:

- `pnpm check` still runs dogfood tests locally, so a local full check needs
  the external fixture.

Future Review:

Replace the external dogfood fixture with a repository-contained fixture to
fold dogfood coverage back into the release gate.

Supersedes:

None.
