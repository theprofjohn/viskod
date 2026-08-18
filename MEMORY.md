
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

None.

Supersedes:

None.

---

## Decision 015

Date:

2026-08-12

Status:

Accepted

Category:

Repository

Title:

Repo-contained dogfood fixture joins the release gate

Context:

Decision 013 kept the dogfood tests local-only because they depended on an
external `C:\viskod-dogfood-shadcn-admin` fixture. The plan's Future Review
called for folding dogfood coverage back into the gate once a repo-contained
fixture existed.

Decision:

`examples/dogfood-app` is a repo-contained shadcn-admin-style React/Vite
fixture (a workspace member so its deps install hermetically from the
lockfile). The dogfood tests target it; `test:dogfood` runs through
`vitest.dogfood.config.ts` (config glob — positional globs break on Windows
cmd), and `release:check` now runs `pnpm test:dogfood` after `test:ci`. The
root tsc project excludes the fixture (it typechecks standalone).

Two product defects surfaced by folding the fixture in were fixed rather than
worked around:

- `source-hint-engine` `buildCacheKey` omitted DOM text, so elements sharing
  route/tag/id/class but with different visible text collided in the cache
  and hint results depended on call order. The key now includes text, role,
  and testId.
- `agent-handoff` `AgentIssueBriefSchema.sourceHints` omitted `status`, so
  Zod stripped it on persistence and the handoff brief lost the hint status.

Alternatives Considered:

- Vendor the full shadcn-admin app: ~100 extra dependencies and a nested
  workspace; unnecessary — the tests use generic selectors.
- Keep dogfood local-only: leaves the release gate without the overlay
  workflow coverage.

Reason for Rejection:

The minimal fixture satisfies every dogfood scenario (125/125 pass) with a
small dependency footprint; keeping dogfood out of the gate preserves the
gap Decision 013's Future Review wanted closed.

Consequences:

Positive:

- The release gate now runs the full overlay/issue/handoff/review/setup
  dogfood coverage from a clean checkout.
- No developer-machine paths remain in the test suite.

Negative:

- `release:check` is heavier (dogfood suite ~3.5 minutes, needs Chromium,
  which the release workflow already installs).

Future Review:

None.

Supersedes:

Decision 013 (dogfood external-fixture portion).

---

## Decision 016

Date:

2026-08-12

Status:

Accepted

Category:

Security

Title:

Hard approval gate for releases

Context:

The release workflow's `publish` job runs against the `release` environment
with a required-reviewer rule. With a single owner and
`prevent_self_review: false`, the owner's own tag pushes self-approve, so the
"human approval" boundary was effectively transparent. A hard gate requires
that the person who triggers a release cannot also approve it.

Decision:

The `release` environment is configured with `can_admins_bypass: false` and
`prevent_self_review: true` (reviewer: the repo owner). A release run
triggered by the owner now waits for approval from a different reviewer and
will not publish until one exists and approves. Completing a release
therefore requires a second collaborator added to the environment's
reviewers list; until then, tag pushes create runs that pause at the
approval gate.

Alternatives Considered:

- Leave self-review permitted: not a hard gate.
- Add a wait timer only: adds delay, not approval.

Reason for Rejection:

Both alternatives preserve single-person release authority.

Consequences:

Positive:

- No single person can publish a release without a second approver.
- A failed gate or missing approval prevents npm publication by construction.

Negative:

- Releases are blocked until a second collaborator is added to the
  environment reviewers (owner cannot self-approve).

Future Review:

None.

Supersedes:

None.

---

## Decision 014

Date:

2026-08-12

Status:

Accepted

Category:

Repository

Title:

First gated alpha release is 0.2.3-alpha

Context:

The plan for the deterministic release gate targeted `0.2.2-alpha`, but that
version was already published on npm (2026-08-07, outside the 72-hour
unpublish window), so re-publishing it is impossible. A fresh gated publish
requires an unpublished version.

Decision:

`0.2.3-alpha` is the first release produced by the deterministic gate
(`v0.2.3-alpha` tag, commit `222594e`). The version contract
(`scripts/verify-release-version.mjs`) continues to require tag equals
`v<publishable CLI version>`; release versions must never reuse an npm
version that already exists. `latest` stays at `0.2.0-alpha`; alpha releases
publish under the `alpha` dist-tag only.

Alternatives Considered:

- Unpublish `0.2.2-alpha` and republish it: not available (72-hour window
  elapsed).
- Publish under a stale version: npm rejects same-version publishes.

Reason for Rejection:

The only viable path to a fresh gated publish is a new patch version.

Consequences:

Positive:

- The released alpha is fully gated and verified end to end.
- Dist-tags are unambiguous (`alpha` → `0.2.3-alpha`, `latest` unchanged).

Negative:

- The public npm history contains pre-gate `0.2.0/0.2.1/0.2.2-alpha`
  publishes that were not produced by the current gate.

Future Review:

None.

Supersedes:

None.

---

## Decision 017

Date:

2026-08-15

Status:

Accepted

Category:

Security

Title:

Studio local control boundary: loopback bind + origin allowlist

Context:

VISKOD-AUDIT-006 found Studio's HTTP/WebSocket server bound to all
interfaces, answered every request with `Access-Control-Allow-Origin: *`,
and accepted WebSocket connections from any origin — a LAN-reachable local
control channel with no boundary. The fix had to protect a local developer
tool without introducing a full authentication framework.

Decision:

Studio binds explicitly to `127.0.0.1` (port 3001 default) and enforces an
origin allowlist on both HTTP and WebSocket:

- no Origin header (CLI, tests, curl) → allowed; local processes already
  have machine access;
- loopback origins (`localhost`, `127.0.0.1`, `::1`) → allowed (Studio UI,
  extension content scripts on loopback app pages);
- `chrome-extension://` → allowed (extension sidepanel/background);
- anything else (remote web pages, DNS-rebinding hosts, LAN hosts) → HTTP
  403, WebSocket close 1008.

CORS is only echoed for allowed origins (`Vary: Origin`), never `*`. The
existing daemon token model in `runtime-session` is unchanged; Studio is a
loopback-only surface and does not need tokens.

Alternatives Considered:

- Session-token challenge for every request: heavier than needed for a
  loopback-bound tool; rejected.
- Keeping `Access-Control-Allow-Origin: *` with loopback bind: still lets
  arbitrary web pages drive Studio via simple (non-preflighted) requests;
  rejected.

Reason for Rejection:

Loopback binding alone does not stop a malicious web page in the user's
browser from POSTing to localhost; the origin allowlist closes that path
and DNS rebinding in one rule.

Consequences:

Positive:

- LAN hosts cannot reach Studio; foreign web origins cannot read or mutate
  Studio state; WebSocket control requires a local/extension origin.
- All legitimate flows (Studio UI, extension, tests, demo, smoke) keep
  working; the extension's manifest already restricts content scripts to
  loopback pages.

Negative:

- Studio is no longer reachable from other machines on the LAN; remote
  control of Studio would need an explicit, authenticated path later.

Future Review:

None.

Supersedes:

None.
---

## Decision 042

Date:

2026-08-15

Status:

Accepted

Category:

UI / Architecture

Title:

Single "Prepare agent handoff" action with workflow-level idempotency

Context:

Phase 28 (VISKOD-AUDIT-001) found the Studio's rendered "Prepare agent
handoff" button only created a VisualIssue; the AgentHandoff required an
undocumented second API call. Repeated clicks could also create duplicate
issues because issue creation was not idempotent at the workflow boundary.

Decision:

The StudioWorkflow owns a coordinated operation,
`prepareAgentHandoffFromDescription()`: create the issue if not already
created for the current report, prepare the handoff for that issue, then
transition to `handoff_ready`. Idempotency is enforced in the workflow
service (not by button disabling):

- repeated submit after success returns the existing handoff-ready state;
- concurrent submits share one in-flight promise;
- handoff failure keeps the persisted issue ID and retry reuses it;
- a workflow generation counter (epoch) prevents late async completions
  from mutating a reset/replaced workflow.

The UI disables the button and preserves the entered description across
re-renders as UX protection only; correctness comes from the workflow
boundary.

Alternatives Considered:

- Deleting the persisted issue on partial failure ("rollback").
- A generalized distributed idempotency framework.
- Keeping the two-step API and adding a second UI button.

Reason for Rejection:

Destructive rollback loses user data and there is no safe transaction
primitive; a general framework is overkill for one workflow; a second
button keeps the invisible step the audit flagged.

Consequences:

Positive:

- The rendered UI performs the full select → describe → prepare journey.
- Exactly one issue and one logical handoff per submission, including
  rapid double-clicks and retried HTTP requests.
- Partial failures are resumable: retry reuses the same issue.

Negative:

- Two workflow entry points exist (the coordinated prepare action and the
  lower-level createIssue/prepareAgent methods retained for API-level
  tests); the lower-level pair must not be re-exposed as the primary UI.

Future Review:

Phase 29+ may move orchestration into a dedicated service.

Supersedes:

None.

---

## Decision 043

Date:

2026-08-15

Status:

Accepted

Category:

Architecture / Security

Title:

Fail-closed browser-backed target validation for captures

Context:

Phase 28 (VISKOD-AUDIT-015) showed invalid/nonexistent selectors produced
successful context packets whose core target was fabricated as "unknown".
SelectionEngine also fabricated stub hierarchies when browser resolution
failed.

Decision:

Core targets are validated against the live DOM before any capture work:

- BrowserRuntime gains `resolveSelector()`, which distinguishes malformed,
  zero-match, detached, ambiguous (multi-match without a geometry anchor),
  and resolved selectors. Viskod's own overlay elements are excluded from
  ambiguity resolution.
- VisualContextEngine.generatePacket fails closed with typed errors
  (`SELECTOR_MALFORMED` / `SELECTOR_NO_MATCH` / `SELECTOR_DETACHED` /
  `SELECTOR_AMBIGUOUS`) when a provided selection does not resolve; the
  "unknown" fallback remains only for selection-less whole-page captures.
- SelectionEngine.validateSelection with a browser handle fails closed
  instead of returning stub snapshots; the stub remains only for
  no-browser contexts (unit tests).
- Ambiguity is resolved with the selection bounding box when exactly one
  match contains its center; otherwise the selector is reported ambiguous
  rather than silently picking the first match.

Alternatives Considered:

- Silently picking the first DOM match.
- Treating optional-evidence failures as core-target failures.

Reason for Rejection:

First-match selection can target the wrong element; the phase explicitly
separates INVALID CORE TARGET (fail) from VALID TARGET + OPTIONAL EVIDENCE
FAILURE (partial capture allowed in Phase 29).

Consequences:

Positive:

- CLI, MCP, and Studio capture paths fail closed on invalid targets.
- Ambiguity is detected and surfaced instead of silently resolved.

Negative:

- Captures of slow-hydrating SPA elements may fail earlier than before;
  resolveSelector waits for the element (5s, same as getDOMSnapshot) to
  preserve hydration tolerance.

Future Review:

Phase 29 may refine optional-evidence partial-capture semantics.

Supersedes:

None.

---

## Decision 044

Status: Accepted
Date: 2026-08-15
Context: Phase 28A — bare selector ambiguity closure.

Phase 28 introduced `BrowserRuntime.resolveSelector()` which disambiguates a
multi-match selector when a bounding box is supplied (the single match whose
rect contains the box center wins). CLI/MCP/SDK/RuntimeSession/Studio
entry points manufactured a default `{0,0,100,100}` box for bare selectors,
so a bare selector matching multiple elements could silently resolve to
whichever match contained `(50,50)` — synthetic geometry acting as if it were
observed target evidence.

Decision:

- `SelectionTarget.boundingBox` is OPTIONAL and contractually TRUSTED target
  evidence only: overlay-observed rects, persisted selection geometry, or
  explicitly supplied caller coordinates whose API contract says so.
- Bare-selector entry points (CLI capture, MCP select_element/capture_context,
  MCP review recapture, RuntimeSession.capture, SDK selectElement/capture,
  Studio selection endpoints, VCE SE_EVENT handler) no longer manufacture any
  default/placeholder box. When no trusted geometry exists the field is
  omitted entirely.
- Invariant: MULTIPLE SELECTOR MATCHES + NO TRUSTED DISAMBIGUATION =
  SELECTOR_AMBIGUOUS. resolveSelector still disambiguates ONLY when a box is
  passed; no caller passes a synthetic one.
- Review recapture (`resolveRecaptureTarget`) passes persisted observed
  geometry through unchanged and no longer falls back to `{0,0,100,100}`.
- Provenance is NEVER inferred from numeric values: `{0,0,100,100}` from an
  overlay or an explicit caller remains trusted.

Alternatives Considered:

- Adding an explicit `geometryTrust: 'observed' | 'synthetic'` provenance
  field to every target.
- Requiring selectors to always be unique.

Reason for Rejection:

Optionality removes the fabrication at the source (the preferred direction);
a provenance enum would keep manufacturing boxes just to label them
untrusted. Requiring unique selectors would break legitimate overlay
geometry disambiguation (Phase 21/28 selections).

Consequences:

Positive:

- Bare multi-match selectors always fail closed with SELECTOR_AMBIGUOUS.
- Genuine overlay/persisted/explicit geometry still disambiguates (Case E),
  stays ambiguous when covering multiple candidates (Case F), and never
  silently picks the first match.
- No large evidence-provenance framework was added.

Negative:

- Selection snapshots without geometry report a zero box in
  `SelectionGeometry` (metadata only — never used for disambiguation).
- `viskod_select_element` now requires all four coordinates to disambiguate;
  partial coordinate sets are ignored (bare-selector semantics).

Future Review:

- resolveSelector disambiguated evidence collection still uses
  `querySelector` (first match) for the DOM snapshot/hierarchy; collecting
  evidence from the specific disambiguated candidate is out of Phase 28A
  scope.

Supersedes:

The Phase 28 ambiguity note in Decision 043 that allowed geometry-based
disambiguation with a default `{0,0,100,100}` box.

## Decision 045

Status: Accepted
Date: 2026-08-15
Context: Phase 28B — resolved target evidence consistency.

After Phase 28A, selector resolution classified a target (resolved / missing /
malformed / ambiguous / detached) but never returned WHICH element it picked.
Every target-scoped evidence collector (DOM snapshot, hierarchy, computed
styles, selected-element info; SelectionEngine hierarchy/visibility/center)
re-ran the original selector via `querySelector`, which returns the FIRST
match. When trusted geometry disambiguated candidate B, resolution said "B"
but evidence described A. If B then detached, re-resolution silently picked A.

Decision:

- BrowserRuntime gains `resolveElement(handle, selector, boundingBox?)` which
  runs the unchanged Phase 28A resolution algorithm inside
  `page.evaluateHandle` and returns a `ResolvedElementRef` holding the live
  Playwright ElementHandle of the specific resolved candidate. Selector
  re-queries are never used for evidence again.
- All element-scoped evidence collectors take the resolved reference
  (`getDOMSnapshot(handle, ref)`, `getElementHierarchy(handle, ref)`,
  `getComputedStyles(handle, ref)`, `getSelectedElementInfo(handle, ref)`).
  `resolveSelector` remains as the status-only validation API (thin wrapper
  that disposes the handle it does not return).
- `VisualContextEngine.generatePacket(selection?, profile?, resolvedRef?)`
  resolves once per capture and collects through the reference; it releases
  the consumed reference (owned or caller-provided) in a `finally`.
  `SelectionEngine.validateSelection` accepts a caller reference (not owned);
  when it resolves its own it releases it.
- MCP `viskod_select_element` parks the resolved reference;
  `viskod_capture_context` consumes it, so a detached element between select
  and capture yields a typed `SELECTOR_DETACHED` failure instead of silently
  re-resolving to another match.
- Resolved references are internal, capture-scoped, and NEVER serialized:
  they cannot appear in persisted packets, MCP payloads, or SDK contracts.
  No generalized DOM identity framework; no candidate-ordinal identity.
- Detached resolved elements fail typed (`BR_ELEMENT_DETACHED` →
  `SELECTOR_DETACHED`); never fall back to another selector match.
- Page-function bodies must not contain named inner functions: esbuild/tsx
  keepNames transforms wrap them with the module-scope `__name` helper,
  which is undefined in the page context (vitest does not enable keepNames,
  so this only failed under the tsx-run MCP/Studio servers). Iterative code
  or inline arrows only.

Alternatives Considered:

- Tagging the resolved element with a unique attribute and re-selecting by
  it (mutation-based identity).
- Persisting `selector + candidateIndex` and re-running
  `querySelectorAll(selector)[index]`.
- String-based `elementHandle.evaluate` (Playwright evaluates strings as
  expressions; they cannot receive the element).

Reason for Rejection:

Attribute tagging mutates the page and still breaks if the node is replaced;
candidate ordinals are unstable under DOM mutation (the Phase explicitly
forbids them). ElementHandle references are the strongest existing stable
identity mechanism and fail typed on detachment, satisfying the atomic
capture contract with the smallest correct mechanism.

Consequences:

Positive:

- RESOLVED TARGET = CAPTURED TARGET: geometry-disambiguated candidates keep
  their identity through every evidence collector (real-browser E2E proves
  all packet fields describe B, none describe A).
- Detachment never falls back to another match (typed detached failure).
- Recapture (persisted selector + trusted geometry) inherits the guarantee
  through the shared pipeline.
- `getComputedStyles` now collects real values: `getPropertyValue` requires
  dash-case CSS names, so the old camelCase lookups returned '' for every
  multi-word property.

Negative:

- MCP select→capture holds one parked handle between calls (released on
  replacement or browser close; in-memory only).
- Callers that need element evidence must resolve once and thread the
  reference; the old selector-based collector signatures are gone.

Future Review:

- Phase 29 partial-capture semantics for VALID TARGET + OPTIONAL EVIDENCE
  FAILURE remain unchanged.

Supersedes:

The "Future Review" note in Decision 044 (evidence collection using
`querySelector`'s first match after geometry disambiguation).

## Decision 046

Status: Accepted
Date: 2026-08-15
Context: Phase 29 — context integrity, privacy and agent retrieval.

Audit confirmed four findings: (VISKOD-AUDIT-003) handoffs referenced an
in-memory `packetId` that no persisted store could resolve after restart;
(VISKOD-AUDIT-007) DOM text/attributes and screenshot pixels bypassed
packet-level privacy controls; (VISKOD-AUDIT-011) capture persistence created
the final directory first and could leave listable partial captures with
stale/transient screenshot paths; (VISKOD-AUDIT-032) packets fabricated
viewport/user-agent/confidence/layout values and silently swallowed optional
evidence failures.

Decision:

- One reusable redaction library in `@viskod/shared` (rules + deep-redact +
  sensitive-attribute default-deny). Browser-runtime evidence, agent-handoff,
  and the packet persistence boundary all build on it; no second regex
  engine.
- One mandatory packet-level redaction boundary (`redactPacketForPersistence`)
  applied BEFORE persistence: the persisted packet.json is the safe
  representation; agents can never recover a secret by reading disk files.
- Screenshot privacy policy: default `agent-safe-omit` (raw pixels exist only
  transiently in memory; persisted packet records `omitted_sensitive`);
  explicit `persist-raw` opt-in marks artifacts `sensitive: true` and is
  never represented as redacted.
- Capture integrity contract: `complete` / `partial` (optional provider
  failed or omitted for privacy, with sanitized per-provider diagnostics) /
  `failed` (typed error, never a packet). Evidence map per provider:
  collected | disabled | unavailable | failed | redacted | omitted_sensitive.
- Synthetic metadata removed: actual page URL, viewport and user agent are
  observed; confidence values are `null` when no provider computed them;
  styles.layout is `null` (no layout-analysis provider).
- Atomic persistence: sibling temp directory → validate persisted schema →
  write artifacts → atomically rename to the final opaque capture id.
  Failure-injection hooks prove no partial capture is ever listable.
  Persistence failure when a pipeline is composed is a FAILED capture, not a
  best-effort success.
- Handoffs reference the DURABLE capture by opaque `captureId` (issue
  evidence carries it); `get_handoff_context` MCP tool loads the persisted
  handoff, resolves captures through the pipeline (schema-validated), and
  returns a compact budgeted agent projection. Opaque id validation rejects
  traversal/absolute-path identifiers in both MCP tools and
  `HandoffPersistence`.
- Persisted packet schemaVersion is `1.1.0`; the schema/privacy version is
  unambiguous; corrupt or mismatched persisted packets return typed failures.

Alternatives Considered:

- Persist raw packet then redact at MCP read time (rejected: filesystem
  access would reveal secrets).
- Screenshot masking/OCR (rejected: Phase 31 visual review owns safe visual
  artifact strategy).
- A capture index file for packetId→capture lookup (rejected: deterministic
  scan over bounded capture dirs is simpler and survives partial writes).

Consequences:

Positive:

- Fresh MCP processes retrieve the exact persisted target context by opaque
  handoff id; Phase 28B identity (candidate B) survives persistence and
  retrieval; persisted artifacts and agent projections contain none of the
  synthetic test secrets; raw screenshots never silently cross the safe
  boundary; failed writes never become listable captures.

Negative:

- Legacy persisted packets (schemaVersion 1.0.0) are not treated as
  privacy-safe; consumers must re-capture. Screenshot-enabled captures under
  the default policy report `partial` (screenshot `omitted_sensitive`) by
  design.

Future Review:

- Phase 30 source-hint ranking can fill `confidence.sourceMapping` and
  qualified `sourceHints` in the projection; Phase 31 visual review owns
  safe screenshot/thumbnail artifacts.

Supersedes:

The "best-effort capture persistence" behavior (previous
`VisualContextEngine.generatePacket` caught and swallowed persistence
failures).

---

# Decision: Phase 30 — Source Resolution Correctness & Studio Integration

Date: 2026-08-15

Status: Accepted

## Context

VISKOD-AUDIT-008: usage-site candidates scored 0.90–0.99 from broad
text/component matching (a `0.9 + matchRatio * 0.09` formula on text-only
matches ranked in tier 0), class-name file-existence hit 0.95, and a generic
`div` was mapped to a `Card` component name. VISKOD-AUDIT-002: Studio never
composed SourceHintEngine or ProjectScanner, so Studio captures produced no
source hints.

## Decision

- **Evidence model over confidence inflation.** Source-hint candidates are
  scored from explicit evidence families (route-ownership, import-path,
  stable-identifier, usage-text, class-file, generic-class, component-ref,
  style-adjacent) with hard calibration caps: text-only or
  generic-component-only matches can never reach probable/exact; without a
  strong family a candidate can never reach probable. Numeric confidence is
  the evidence score and maps consistently to a semantic qualification
  (`exact | probable | possible | weak`).
- **Explicit result states.** Overall resolution is `resolved | ambiguous |
  unavailable`. Ambiguity is deterministic (tie margin < 0.02, or same-tier
  margin < 0.08); no-evidence/unknown-root/budget-exhaustion is `unavailable`,
  never a fabricated path.
- **Relative paths only.** Candidates crossing the persisted/agent boundary
  are repository-relative; escaping/absolute paths are rejected at the
  engine and projection boundaries.
- **Studio composes project context from an EXPLICIT root only.**
  `--project-root <dir>` (or `VISKOD_PROJECT_ROOT`); never a `process.cwd()`
  walk guess. Without a root, source resolution is truthfully unavailable
  with an actionable reason. Same contract for `viskod serve --project-root`.
- **Persisted qualified hints + bounded agent projection.** The Phase 29
  safe packet persists qualified candidates; `get_handoff_context` projects a
  bounded set (5) with qualification, calibrated confidence, and ≤3 reasons,
  deriving `resolution` deterministically from persisted evidence — the fresh
  process never recomputes hints.
- **Latency guard.** The scan has a finite budget (default 3000 files /
  2500 ms) returning explicit `unavailable` on exhaustion.
- **Handoff schema loss fix.** `AgentIssueBriefSchema` previously stripped
  `kind/score/reasons/warnings`; it now also carries `qualification` and
  `resolution`.

## Consequences

Positive:

- Text-only/common-label matching can no longer produce high confidence;
  duplicate text yields ambiguity; generic `Card`/tag heuristics are weak and
  never dominate; candidates expose concise reasons; ordering is
  deterministic; Studio captures persist calibrated relative source hints;
  a fresh MCP process retrieves persisted candidates without recomputation;
  persisted ambiguity stays ambiguous; target B's source hints derive from B
  evidence.

Negative:

- Usage-site confidence values are no longer comparable to pre-Phase-30
  numbers (schema version 2.0.0 for generated hints); route/import evidence
  only exists when the project root is explicitly configured and the
  scanner's route map matches.

Future Review:

- Phase 31 visual review owns safe screenshot artifacts; Phase 33 owns full
  async scanning/caching/workspace discovery; `confidence.sourceMapping`
  remains null (no source-map provider exists).

# Decision: Phase 30A — Source Semantic & Persistence Closure

## Decision

- **Resolution is a capture-time fact; qualification is candidate truth.**
  The persisted packet now carries a `sourceHintsResolution` snapshot
  (`status: resolved|ambiguous|unavailable`, `modelVersion: 2.0.0`,
  optional `topCandidate`), stamped with the exported
  `SOURCE_HINT_SCHEMA_VERSION`. `get_handoff_context` reports that snapshot
  verbatim (`resolutionSource: 'persisted'` + `modelVersion`); it never
  recomputes resolution or reranks/re-qualifies historical candidates.
- **Studio wording derives from the top candidate's qualification.** A
  resolved result is labeled `exact source identified` / `probable source` /
  `possible source` / `weak source evidence` (server + client JS); the
  review screen's obsolete `Source hints: high/medium/low confidence`
  mapping (which relabeled TARGET-resolution confidence as source-hint
  confidence) is replaced by the real Phase 30 source status.
- **Durable source-hint data is schema-validated.** `PersistedSourceHintSchema`
  requires safe repository-relative paths (shared
  `isSafeRelativeSourcePath`: rejects `\`, absolute, drive-letter, `file://`,
  `..`), finite 0..1 confidence, recognized qualification, bounded reasons,
  shaped matchType/exists. `PersistedSourceResolutionSchema` requires a
  recognized status and semver modelVersion (future versions accepted —
  persisted results stay interpretable).
- **Legacy compatibility is marked, not disguised.** Packets predating the
  snapshot derive resolution with the deterministic rule but expose
  `resolutionSource: 'derived'` (no modelVersion); pre-Phase-30 candidates
  (no recognized qualification) fail schema → `CP_PACKET_CORRUPT` →
  re-capture required. Historical scores are never silently upgraded.

## Consequences

Positive:

- A `possible` candidate is never labeled `probable` in Studio (unit +
  rendered-UI E2E regression); ambiguity/unavailable wording stays truthful.
- Fresh MCP retrieval reproduces the exact persisted conclusion (resolved +
  possible + 0.54, and ambiguous + StatusWidgetA/B order) with the model
  version that produced it — stable across engine changes.
- Corrupt/tampered persisted source data (bad qualification, confidence > 1,
  absolute/traversal/URI paths, malformed reasons/resolution/version) fails
  safely at write and load; never returned as normal agent context.

Negative:

- `get_handoff_context` adds `resolutionSource`/`modelVersion` fields to the
  agent projection (additive; consumers reading `resolution`/`candidates`
  are unaffected).
- Persisted packets written before 30A but after Phase 30 (candidates
  without a snapshot) retrieve with `resolutionSource: 'derived'` until
  re-captured.

Future Review:

- Phase 31 owns the review screen's deeper visual-review architecture; the
  30A review-panel label fix is a local truthful relabel, not Phase 31 work.


# Decision: Phase 31 — True Safe Before/After Visual Review

Date: 2026-08-15

Status: Accepted

Category: Architecture | Security | UI

Context:
VISKOD-AUDIT-004/005/023: the pre-Phase-31 review compared METADATA only
(no persisted screenshots), an unchanged target could report "changed" (the
after snapshot presented `tagName` as the target label, so a label-vs-tag
mismatch flipped the result — the exact false positive the audit flagged),
and Studio always sent an empty decision note.

Decision:
- **Local-sensitive visual review artifacts.** A separate artifact class
  under `.viskod/reviews/<reviewId>/{before,after,diff}.png` +
  `manifest.json`, plus issue-scoped baselines under
  `.viskod/reviews/baselines/<issueId>/`. Raw target crops are marked
  `sensitive: true` + `localOnly: true`, atomic (temp-write → validate →
  rename, manifest written last as the commit marker), and NEVER enter the
  agent-safe packet, `get_handoff_context`, or the Phase 29 screenshot
  boundary.
- **Explicit Studio policy, default disabled.** `visualReviewArtifacts:
  disabled | local-sensitive-target-crop` persisted in `.viskod/settings.json`
  (smallest settings mechanism). The UI asks once (banner) before enabling;
  default follows the Phase 29 privacy stance. Consent is never inferred
  from `collectScreenshot`.
- **Before baseline at handoff-prepare.** The pre-change crop is captured
  when the agent handoff is prepared (the last moment before the coding
  agent modifies the UI), tied durably to the issue; a missing baseline is
  reported truthfully as visual-unavailable — never fabricated from the
  post-change page.
- **Phase 28B exact-target pipeline.** Both before and after crops resolve
  through `resolveElement(selector, trustedBoundingBox)` — never a bare
  selector re-query. After recapture, same-target determination uses the
  stable-identity model (targetId/stable attributes); display labels are
  presentation only (VISKOD-AUDIT-005 closure).
- **Real pixel comparison.** PNG decode (pngjs) + per-pixel RGBA compare
  (tolerance 24/channel) on a deterministic common canvas (max dims,
  top-left aligned, no scaling); changed pixels are highlighted red in a
  persisted diff artifact; geometry (x/y/w/h deltas) is separate evidence
  (tolerance 1px); viewport/DPR mismatch → `incomparable`, never a confident
  pixel result; missing artifacts → `visual_unavailable`; target
  missing/ambiguous/identity-replaced keep typed statuses.
- **Protected serving.** Studio serves images only via
  `GET /review/artifact/<opaqueId>` (id pattern validated, manifest-bound,
  traversal rejected, `image/png`, no-store). MCP exposes no artifact tool.
- **Human decision independent.** Visual status is evidence, not truth:
  accept/reject stays an explicit human action with an optional persisted
  note (VISKOD-AUDIT-023 closure).

Alternatives Considered:
- Full-viewport screenshots — rejected: exposes unrelated page content;
  target crop + bounded padding is the minimal exposure contract.
- Resize one crop to the other's dimensions — rejected: hides real
  size/layout changes; the common-canvas rule preserves pixels and records
  dimensions/geometry separately.
- Reuse the byte-level `compareScreenshots` — rejected: raw-buffer compare
  can't produce metrics/diff images and misreports compression noise.

Consequences:
Positive:
- Real before/after/diff images render in Studio from opaque endpoints;
  unchanged targets stay unchanged (real Chromium regression); color,
  typography, border/shadow, size, position, and text changes are detected;
  replaced targets are never silently compared; viewport/DPR mismatches are
  incomparable; privacy boundary regression-tested (packet stays
  `omitted_sensitive`; MCP has no image access); artifacts + pairing survive
  Studio restart; note persists.
Negative:
- One extra screenshot capture per review when the policy is enabled; the
  legacy metadata comparison remains for disabled-policy flows and reports
  truthfully what metadata can see.
Future Review:
- Phase 32+ owns retention UX, dynamic-content stabilization, and deeper
  review workflows.

## Phase 31A — Visual Review Durability & Consent Closure (2026-08-15)

Decision: Close the Phase 31 durability/consent evidence gaps without a
redesign; record the pre-verification restart baseline invariant and the
opt-in policy contract as tested behavior.

Accepted decisions / invariants:
- **Pre-verification restart durability.** A BEFORE baseline captured at
  handoff-prepare survives Studio restart before any verification; the
  post-restart review reuses the EXACT original baseline (SHA-256 byte
  equality, original capturedAt, review manifest pairs after/diff to it).
  No second baseline is ever generated; the baseline dir stays
  `[before.png, manifest.json]`.
- **No active-workflow UI resume.** Studio workflow state (selection,
  issue/handoff/review ids) is in-memory only; after restart the workflow
  is idle and there is no resume endpoint. Post-restart verification is
  exercised at service/persistence level with fresh
  ReviewArtifactStore/ReviewServiceImpl instances on the same `.viskod`
  store. User-facing resume/history is deferred to the issue-history phase
  (Phase 32+); no fabricated resume capability.
- **Fail-closed baseline.** A manifest whose before.png is missing or
  corrupt fails review creation with typed `ARTIFACT_NOT_FOUND` /
  `ARTIFACT_INVALID_IMAGE`; no post-change image is substituted, no new
  baseline is manufactured, metadata evidence remains available.
- **Policy contract.** `visualReviewArtifacts` defaults `disabled`;
  enabling requires the explicit one-time consent answer (banner shows
  until enable OR disable is chosen); both choices persist in
  `.viskod/settings.json`; malformed values and corrupt JSON resolve to
  `disabled` (fail closed, no migration framework). `collectScreenshot` is
  never consent. Persisted consent never changes the Phase 29 agent-safe
  packet/handoff boundary.
- **Windows rename EBUSY.** The settings save and the visual-review
  fixture state write retry atomic renames on transient Windows
  `EBUSY` (antivirus/indexer lock window) so a consent answer is never
  silently dropped from persistence.
- **Corrupt artifact read classification.** `readArtifactFile` classifies
  undecodable PNGs as `ARTIFACT_INVALID_IMAGE` via `instanceof
  ImageDecodeError` (the old string match never fired, producing
  `ARTIFACT_READ_FAILED`).

Consequences:
Positive: restart-before-verification, default/decline/enable policy
persistence, malformed-settings fail-closed, missing/corrupt baseline, and
post-restart privacy are now product/persistence-level regression-tested
(6 new E2E + 6 new unit tests); `pnpm release:check` exit 0 recorded.
Negative: none known; stale gitignored `src/*.js` compiled leftovers were
removed so vitest resolves real `.ts` source (they shadowed `.ts` in
module resolution).
Future Review: issue-history desk / workflow resume (Phase 32+); retention
UX for review artifacts.

# Decision: Gortex no longer required during development (2026-08-17)

## Context

Decision 004 (2026-07-28) made Gortex MCP the required primary repository
intelligence tool during development. Developer environment migrated from
Windows to Linux Mint; Gortex adds little value there and is not installed.

## Decision

Gortex is optional. Development proceeds with the built-in repo tools
(grep/glob, ast-grep, LSP, subagent scouts) without Gortex MCP. Viskod
runtime never depends on Gortex (unchanged). Cleanup: the Gortex line in
AGENTS.md, the `.gortex*` gitignore entries, and leftover
`.gortex-batch-*` artifacts were removed (2026-08-17).

## Consequences

Positive: no Gortex setup/maintenance on Linux Mint; zero runtime impact.
Negative: Decision 004's repository-wide intelligence workflow no longer
applies; cross-package exploration relies on LSP/ast-grep/scouts.

---

# Compose Preferences

## Execution Style: Subagent

All compose plan executions use subagent mode (fresh subagent per task).
User preference set 2026-08-17.
Future Review: none; re-evaluate only if repo-wide code intelligence
becomes a bottleneck again.

---

# Phase 33A runtime/scale closure decisions

## Decision 006 (2026-08-18): bounded-concurrency scan primitives

`packages/source-hint-engine` gained `mapWithConcurrency` (bounded worker
pool, never unbounded `Promise.all`), `ScanCancelledError` + AbortSignal
threading, engine-scoped `FsActivity` read/parse counters, and a
manifest-validated fingerprint cache (`SourceFingerprintService`). The hint
and import-graph caches are keyed by the source fingerprint so one resolution
consumes one coherent repository generation; `invalidateCache` bumps the
generation so in-flight scans never commit stale results. Warm queries do
zero content reads/parses (stat-only manifest validation).

## Decision 007 (2026-08-18): e2e compiled artifacts shadow sources

Stale compiled `*.js`/`*.d.ts`/`*.map` output inside `tests/e2e/` shadowed the
`.ts` sources in vitest resolution (`.js` resolves before `.ts`), silently
reverting `harness.ts` changes. Deleted the artifacts; do not commit compiled
output under `tests/e2e/` (keep `tests/e2e` source-only).
