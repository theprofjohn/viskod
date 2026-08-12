# Contributing to Viskod

Viskod is a local-first visual context engine for AI coding agents. Contributions should make the UI-to-agent workflow more reliable, safer, and easier to understand.

## Prerequisites

- Node.js 22 or newer
- pnpm 9.15.0
- Playwright Chromium (`pnpm exec playwright install chromium`)

## Local setup

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

Run the included fixture and Studio in separate terminals when following the manual workflow:

```bash
node examples/phase12-source-hint-app/server.cjs
pnpm exec tsx apps/studio/src/index.ts
```

## Validation

Run the narrowest relevant check, then the repository gates:

```bash
pnpm check
pnpm test:ci
pnpm smoke:agent-workflow
```

The deterministic smoke starts and cleans up its own fixture and Studio processes. `pnpm test:dogfood` is a local-fixture suite and may require the external dogfood application documented by its tests; report a missing prerequisite clearly instead of weakening or skipping assertions.

## Architecture and package boundaries

Keep the layering described in [`AGENTS.md`](AGENTS.md). Import cross-package APIs through `@viskod/*` public entrypoints; do not reach into another package's private source files. Use constructor injection, validate external inputs at boundaries, preserve `Result`/`ViskodError` contracts, and keep user-facing workflow output sanitized.

## Pull requests

- Explain the user-visible behavior and the affected workflow.
- Add or update tests for observable behavior and boundary conditions.
- Run the relevant validation commands and include their results.
- Keep documentation and public contracts synchronized.
- Avoid unrelated refactors or generated changes.

Pull requests must not weaken redaction, path/token safety, localhost binding, or the human review boundary. Viskod provides evidence; it must not silently accept a visual fix.

## Reporting problems

Use the repository issue forms for reproducible bugs and feature requests. Never paste tokens, cookies, `.env` contents, raw packet JSON, or screenshots containing secrets into an issue or pull request. Security vulnerabilities belong in the private reporting path described in [`SECURITY.md`](SECURITY.md).
