# Repository Guidelines

## Project Overview

Viskod is a local-first Visual Context Engine for AI coding agents. It drives Playwright/Chromium against a running web app, captures structured visual evidence (DOM, styles, hierarchy, screenshots, console/network data, and confidence-scored source hints), persists captures under `.viskod/`, and exposes context through a stdio MCP server and the Studio UI. Viskod observes and prepares evidence; external agents edit code and humans verify the result.

## Architecture & Data Flow

- **Layering:** Studio and MCP/CLI entrypoints compose shared contracts, infrastructure, domain engines, and workflow services. Keep package boundaries intact; do not bypass a layer without a documented reason.
- **Composition:** `packages/cli/src/index.ts` (`createRuntime()`), `packages/mcp-server/src/entry.ts` (`buildViskodServer()`), `packages/sdk/src/index.ts`, Studio, and `RuntimeSession` use manual constructor dependency injection. There is no DI container.
- **Capture flow:** CLI, MCP, Studio, or an overlay supplies a selection target → `SelectionEngine` validates it → `VisualContextEngine.generatePacket()` orchestrates browser evidence, project context, and source hints → `BrowserRuntime` evaluates the page and captures evidence → `ContextPacket` is persisted by `CapturePipeline` and returned as MCP/CLI output or rendered in Studio.
- **Browser boundary:** `BrowserRuntime` owns Playwright/Chromium, page event listeners, redaction, screenshots, and injected overlay scripts. The MCP server uses newline-delimited JSON-RPC over stdin/stdout; it is not a network service. Studio serves HTTP/WebSocket UI state on `127.0.0.1:3001`.
- **Workflow:** visual selection feeds the UI issue → agent handoff → visual review/recapture flow. Studio exposes sanitized workflow state and preserves the human decision boundary: changed screenshots are evidence, not automatic truth.
- **Evidence:** source mapping is probabilistic. Preserve confidence, reason, existence, and match type; never present a ranked source hint as exact ownership.

## Key Directories

- `packages/shared/` — public contracts, Zod schemas, constants, `Result`, and canonical `ViskodError`.
- `packages/event-bus/` — synchronous in-process pub/sub used to connect subsystems.
- `packages/browser-runtime/` — Playwright lifecycle, page evaluation, browser evidence, profiles, and redaction.
- `packages/selection-engine/` — target validation and selection snapshots.
- `packages/context-engine/` — `ContextPacket` orchestration and evidence assembly.
- `packages/capture-pipeline/` — atomic `.viskod/captures/` persistence, retention, and storage checks.
- `packages/source-hint-engine/` — ranked DOM-to-source hints and import-graph analysis.
- `packages/runtime-session/` — daemon/session lifecycle, `127.0.0.1` TCP bridge, and token-authenticated reuse.
- `packages/mcp-server/` — stdio MCP transport and tool families for capture, handoff, review, setup, and UI integration.
- `packages/cli/` — `viskod` commands, runtime composition, and the publishable bundled distribution.
- `packages/visual-selection/`, `visual-issue/`, `agent-handoff/`, `visual-review/`, `overlay-system/` — user workflow, persistence, review comparison, and injected selection overlay.
- `packages/sdk/` — public programmatic API; `apps/studio/` — framework-free HTTP/WebSocket Studio and workflow UI.
- `scripts/` — CLI bundling and MCP workflow smoke tests; `docs/` — locked architecture, MCP/CLI contracts, and RFCs; `examples/` — fixture applications (not workspace members).

## Development Commands

Run commands from the repository root with Node 22+ and pnpm 9+:

```sh
pnpm install
pnpm check                         # biome check . && tsc -b && vitest run (local, incl. dogfood)
pnpm test:ci                       # CI-compatible gate: vitest run --exclude '**/dogfood*.test.ts'
pnpm test:dogfood                  # vitest run packages/overlay-system/src/dogfood-*.test.ts (external fixture required)
pnpm lint                          # biome check .
pnpm format                        # biome format --write .
pnpm typecheck                     # tsc -b
pnpm test                          # vitest run
pnpm test:watch                    # vitest watch mode
pnpm exec vitest run packages/<pkg>/src/<file>.test.ts
pnpm --filter <pkg> test
pnpm --filter <pkg> build
pnpm build                         # tsc -r across workspace packages
pnpm build:cli                     # bundle @viskod/cli for distribution
pnpm viskod                       # run CLI from source via tsx
pnpm test:e2e                      # opt-in tests/e2e using vitest.e2e.config.ts
pnpm smoke:agent-workflow          # MCP workflow smoke test
pnpm release:check                 # biome + tsc + test:ci + deterministic smoke + CLI bundle + packed-artifact verification
```

The `pnpm check` gate runs local dogfood tests. For a CI-equivalent run that avoids external dogfood fixtures, use `pnpm test:ci` (the exact script CI and `release:check` use). Dogfood tests (`pnpm test:dogfood`) require the external `C:\viskod-dogfood-shadcn-admin` fixture and fail with a clear message when it is missing. `pnpm test:e2e` is separate from the default gate; `tests/e2e/chat-workflow.test.ts` assumes Studio is already running on port 3001, while `studio-flow.test.ts` boots its own fixture/Studio servers.

## Code Conventions & Common Patterns

- TypeScript is strict with `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, composite builds, and `moduleResolution: 'bundler'`. Keep code free of `any`; Biome treats explicit `any` as an error.
- Format with 2-space indentation, single quotes, trailing commas, and 100-character lines. Avoid non-null assertions.
- Import cross-package APIs through the package name (`@viskod/<pkg>`) and its public `src/index.ts`; never import another package's private files. Add package aliases and project references when adding packages.
- Validate external, HTTP, MCP, and persistence inputs with Zod at the boundary. Do not trust selectors, paths, packet data, or agent input.
- Use constructor injection for services and adapters. Keep business logic out of `EventBus`; publish namespaced events and unsubscribe listeners. Event handlers may be asynchronous, but delivery is bounded and subscriber failures follow the configured error strategy.
- Internal services return `Result<T, ViskodError>` (`ok`/`err`); errors carry a code, category, severity, message, cause when available, recovery guidance, subsystem, timestamp, and correlation ID. SDK/CLI/MCP boundaries may throw or translate results.
- Persist workflow entities as validated JSON under `.viskod/`, using atomic writes and sanitized user-facing adapters. Never expose raw packet JSON, absolute paths, selectors, session tokens, daemon tokens, cookies, or secrets.
- Prefer explicit state machines and instance state over hidden globals. Studio workflow stages are `idle → selecting → describe → handoff_ready → verifying/review_ready → decided`; failed transitions retain state and expose recovery text.
- Use async/await for browser, filesystem, and network work. Preserve reentrancy guards, reload/cache-bust semantics for recapture, and cleanup of browser/server resources.

## Important Files

- `package.json` — workspace scripts, Node/pnpm engines, dependency policy, and package version.
- `pnpm-workspace.yaml` — workspace scope (`packages/*`, `apps/*`).
- `tsconfig.json` — solution-style project references and strict compiler settings.
- `biome.json` — formatter/linter rules.
- `vitest.config.ts` / `vitest.e2e.config.ts` — unit and opt-in E2E test discovery.
- `packages/cli/src/index.ts` — source CLI entry and canonical runtime composition.
- `packages/context-engine/src/index.ts` — `VisualContextEngine` and `ContextPacket` generation.
- `packages/mcp-server/src/entry.ts` / `server.ts` — MCP tool registration and JSON-RPC transport.
- `apps/studio/src/index.ts` / `workflow.ts` / `ui.ts` — Studio server, workflow state machine, and HTML UI.
- `scripts/build-cli.mjs` — esbuild output `packages/cli/dist/index.js`; Playwright remains external.
- `scripts/smoke-phase18-agent-workflow.mjs` — end-to-end MCP workflow smoke test.
- `docs/architecture.md` and `docs/ARCHITECTURE_BASELINE.md` — locked architecture; `docs/rfcs.md` — required process for architecture, subsystem-boundary, or public-API changes.
- `MEMORY.md` — append-only rationale and accepted decisions; read before implementation and add a decision when a durable architectural choice is made.

## Runtime/Tooling Preferences

- Use Node.js `>=22` and pnpm `9.15.0` (the repository declares `pnpm@9.15.0`). Use `tsx` for source CLI execution; use esbuild output for the distributed CLI.
- Playwright is the production browser runtime. Install Chromium through the CLI package lifecycle or run the appropriate Playwright install when developing browser workflows.
- Gortex is a development-time repository intelligence tool only. Viskod runtime code must never depend on it.
- Keep execution local-first: bind services to `127.0.0.1`, do not add telemetry/cloud dependencies, and redact sensitive values before they reach agents or persisted user-facing state.
- `@viskod/cli` is the publishable package. Its bundle targets Node 22 ESM and externalizes Playwright; other workspace packages are internal implementation packages.

## Testing & QA

- Unit/integration tests live beside source as `packages/<pkg>/src/*.test.ts` or `apps/studio/src/*.test.ts`; use Vitest in the Node environment. Test observable contracts with typed inline factories/fakes and real ephemeral HTTP servers where appropriate.
- Protect the recurring contracts: `Result`/error shapes, Zod validation, deterministic MCP tool schemas/order, redaction and path/token safety, event delivery behavior, capture retention/atomicity, source-hint confidence, and Studio workflow transitions.
- E2E tests live under `tests/e2e/` and run only with `pnpm test:e2e`; they are not part of CI. Dogfood tests under `packages/overlay-system/src/` are local-fixture tests and are excluded by CI.
- Coverage uses Vitest's v8 provider but has no enforced threshold. Do not invent coverage requirements.
- Before claiming a change is complete, run the narrowest relevant test, then `pnpm check` when the environment supports the external dogfood fixture. For CI-equivalent verification, exclude dogfood tests as above. For release changes, also run `pnpm release:check`.
- Keep docs synchronized with implementation. Stale commands, architecture claims, or test instructions are defects.
- Operational gotcha: `viskod serve --url <URL>` fails at startup if no process is listening at `<URL>` (`ERR_CONNECTION_REFUSED`). Start the target app first.
