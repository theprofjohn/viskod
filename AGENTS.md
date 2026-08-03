# context-mode — MANDATORY routing rules

context-mode MCP tools available. Rules protect context window from flooding. One unrouted command dumps 56 KB into context.

## Think in Code — MANDATORY

Analyze/count/filter/compare/search/parse/transform data: **write code** via `context-mode_ctx_execute(language, code)`, `console.log()` only the answer. Do NOT read raw data into context. PROGRAM the analysis, not COMPUTE it. Pure JavaScript — Node.js built-ins only (`fs`, `path`, `child_process`). `try/catch`, handle `null`/`undefined`. One script replaces ten tool calls.

## BLOCKED — do NOT attempt

### curl / wget — BLOCKED
Shell `curl`/`wget` intercepted and blocked. Do NOT retry.
Use: `context-mode_ctx_fetch_and_index(url, source)` or `context-mode_ctx_execute(language: "javascript", code: "const r = await fetch(...)")`

### Inline HTTP — BLOCKED
`fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, `http.request(` — intercepted. Do NOT retry.
Use: `context-mode_ctx_execute(language, code)` — only stdout enters context

### Direct web fetching — BLOCKED
Use: `context-mode_ctx_fetch_and_index(url, source)` then `context-mode_ctx_search(queries)`

## REDIRECTED — use sandbox

### Shell (>20 lines output)
Shell ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`.
Otherwise: `context-mode_ctx_batch_execute(commands, queries)` or `context-mode_ctx_execute(language: "javascript", code: "...")`. Use `language: "shell"` only when code matches the host shell.

### File reading (for analysis)
Reading to **edit** → reading correct. Reading to **analyze/explore/summarize** → `context-mode_ctx_execute_file(path, language, code)`.

### grep / search (large results)
Use `context-mode_ctx_execute(language: "javascript", code: "...")` in sandbox for portable filtering/counting.

## Tool selection

0. **MEMORY**: `context-mode_ctx_search(sort: "timeline")` — after resume, check prior context before asking user.
1. **GATHER**: `context-mode_ctx_batch_execute(commands, queries)` — runs all commands, auto-indexes, returns search. ONE call replaces 30+. Each command: `{label: "header", command: "..."}`.
2. **FOLLOW-UP**: `context-mode_ctx_search(queries: ["q1", "q2", ...])` — all questions as array, ONE call (default relevance mode).
3. **PROCESSING**: `context-mode_ctx_execute(language, code)` | `context-mode_ctx_execute_file(path, language, code)` — sandbox, only stdout enters context.
4. **WEB**: `context-mode_ctx_fetch_and_index(url, source)` then `context-mode_ctx_search(queries)` — raw HTML never enters context.
5. **INDEX**: `context-mode_ctx_index(content, source)` — store in FTS5 for later search.

## Parallel I/O batches

For multi-URL fetches or multi-API calls, **always** include `concurrency: N` (1-8):

- `context-mode_ctx_batch_execute(commands: [3+ network commands], concurrency: 5)` — gh, curl, dig, docker inspect, multi-region cloud queries
- `context-mode_ctx_fetch_and_index(requests: [{url, source}, ...], concurrency: 5)` — multi-URL batch fetch

**Use concurrency 4-8** for I/O-bound work (network calls, API queries). **Keep concurrency 1** for CPU-bound (npm test, build, lint) or commands sharing state (ports, lock files, same-repo writes).

GitHub API rate-limit: cap at 4 for `gh` calls.

## Output

Write artifacts to FILES — never inline. Return: file path + 1-line description.
Descriptive source labels for `search(source: "label")`.

## Session Continuity

Skills, roles, and decisions persist for the entire session. Do not abandon them as the conversation grows.

## Memory

Session history is persistent and searchable. On resume, search BEFORE asking the user:

| Need | Command |
|------|---------|
| What did we decide? | `context-mode_ctx_search(queries: ["decision"], source: "decision", sort: "timeline")` |
| What constraints exist? | `context-mode_ctx_search(queries: ["constraint"], source: "constraint")` |

DO NOT ask "what were we working on?" — SEARCH FIRST.
If search returns 0 results, proceed as a fresh session.

## ctx commands

| Command | Action |
|---------|--------|
| `ctx stats` | Call `stats` MCP tool, display full output verbatim |
| `ctx doctor` | Call `doctor` MCP tool, run returned shell command, display as checklist |
| `ctx upgrade` | Call `upgrade` MCP tool, run returned shell command, display as checklist |
| `ctx purge` | Call `purge` MCP tool with confirm: true. Warns before wiping knowledge base. |

After /clear or /compact: knowledge base and session stats preserved. Use `ctx purge` to start fresh.

---

# Viskod — Repository Guide

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
