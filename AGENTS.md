# Viskod — Repository Guide

## MCP Server

The `gortex` MCP server is configured for this repo (`.omp/mcp.json`). It is a dev tool only — runtime must never depend on it.

## Commands

| Command | What it does |
|---------|-------------|
| `pnpm check` | **The gate**: `biome check . && tsc -b && vitest run` — run before claiming completion |
| `pnpm format` | `biome format --write .` — fixes formatting repo-wide |
| `pnpm viskod` | Run the CLI via tsx: `tsx packages/cli/src/index.ts` (start/scan/capture/serve/health/status/stop/export/install) |
| `pnpm smoke:agent-workflow` | `node scripts/smoke-phase18-agent-workflow.mjs` — MCP workflow smoke test |
| `pnpm release:check` | Full gate + smoke test, for release readiness |
| Single test | `pnpm exec vitest run packages/<pkg>/src/<file>.test.ts` |
| Single package | `pnpm --filter <pkg> test` / `--filter <pkg> build` |

There is **no `test:e2e` script** (vitest `include` only covers `packages/*/src` and `apps/*/src`). `tests/e2e/*.test.ts` are not wired into any script; the compiled `.js`/`.d.ts` files there are stale leftovers — do not treat them as runnable.

## Architecture

- pnpm monorepo: `packages/*` + `apps/studio` (see `pnpm-workspace.yaml`, root `tsconfig.json` references).
- Layered: Studio → Visual Context Engine → Browser Runtime → running app; MCP server → external agents. No layer bypasses another without justification.
- Each package has a single responsibility; never import private files across packages — import only the package's public `src/index.ts` (aliased as `@viskod/<pkg>`).
- `packages/cli/src/index.ts` wires the full runtime together (`createRuntime()`), then the `mcp-server` exposes `viskod_capture_context` and the handoff/review/setup tool families (including `recapture_visual_review`).
- **Gortex is a dev tool only. Runtime must never depend on Gortex.**
- `AGENTS.md` is the repo instruction file. `MEMORY.md` records decisions that shape the architecture. Docs are frozen at v1.0 baseline; architecture changes require an RFC (`docs/rfcs.md`).

## Conventions

- TypeScript strict + `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`; no `any` (biome enforces as error).
- Zod runtime validation at every package boundary; never trust unvalidated input.
- Biome: single quotes, trailing commas all, lineWidth 100, indent 2 spaces; `noNonNullAssertion` is warn.
- Errors must carry code + message + cause + recovery suggestion. Never log secrets/cookies/tokens.
- Implementation order: contracts → types → implementation → tests → documentation → optimisation.
- Keep docs in sync with implementation — stale docs are a defect (this file included).

## Quality Bar

- Git: small commits, meaningful commit messages, never commit unrelated work together.
- Anti-patterns to avoid: giant classes, giant React components, hidden state, circular dependencies, duplicated/copy-paste logic, premature optimisation, excessive abstraction, magic strings, magic numbers.
- Definition of done: implementation works, lint passes, typecheck passes, tests pass, documentation updated, no known regressions introduced.
- Agent workflow before implementing: read this file and `MEMORY.md`, understand existing architecture, search for similar implementations, avoid duplication, plan, implement incrementally, run validation, fix failures, update documentation. Never skip validation.

## Gotchas

- `viskod serve --url <URL>` **hard-crashes at startup** if nothing is listening on `<URL>` (`ERR_CONNECTION_REFUSED` at `MCPServer.startup`). Start the target app first, or the MCP server dies with `-32000: Connection closed`.
- Source hints are probabilistic — always include confidence + reasoning, never present guesses as facts.
- Phase 1 = local-first: no cloud services, telemetry, or hosted APIs. Bind to `127.0.0.1` only.
- Cross-package edits: verify callers before changing signatures.

## References

- `MEMORY.md` — architectural decisions
- `AGENT_WORKFLOW.md` / `QUICKSTART_MCP.md` — MCP tool usage (`viskod_capture_context` → fix → `recapture_visual_review` loop)
- `docs/ARCHITECTURE_BASELINE.md` — frozen canonical architecture
