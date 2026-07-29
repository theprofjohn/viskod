# Viskod v0.2.0-alpha — MCP Agent Workflow

## What Viskod Is

Viskod is a **Visual Context Engine** for AI coding agents. It captures structured visual context from a running UI — bounding box, DOM, computed styles, console evidence, network requests, and source hints — and exposes it through Model Context Protocol (MCP) so agents can reason about visual issues without relying on ambiguous human descriptions.

## What Works

- **MCP server** with two primary tools: `capture_context` and `recapture_context`
- **`capture_context`**: Capture an element's visual state → receive markdown brief with bounding box, DOM, styles, source hints, console/network evidence
- **`recapture_context`**: Re-capture the same element after a fix → receive `comparisonSummary` with `boundingBoxDelta`, `areaDelta`, `evidenceDelta`, `changedFields`, `verdict`
- **`reload` / `cacheBust`**: Force browser to pick up local CSS/code changes without restarting the MCP server
- **Profile system**: `default` (lightweight), `debug` (full), `audit` (network-focused)
- **Privacy/redaction**: API keys, tokens, emails, and credit card numbers are redacted by default
- **Source hints**: Ranked file matches linking UI elements to source code

## MCP Tools Available

| Tool | Description |
|------|-------------|
| `capture_context` | Capture element context with selector, URL, profile, project path |
| `recapture_context` | Re-capture and compare with previous packet |
| `capture` | Simple capture (legacy) |
| `export_context` | Export a packet to markdown or JSON |
| `status` | Session health |
| `stop` | Stop the runtime session |

## Validated Workflow

```
capture_context(selector, url, profile: "debug")
  → receives packetPath + brief + source hints
→ fix the issue in identified source file
→ recapture_context(previousPacketPath, reload: true, cacheBust: true)
  → receives comparisonSummary with boundingBoxDelta, verdict
```

This flow works through true MCP JSON-RPC without restarting the server.

## Known Limitations

- **stdin/stdout transport only**: No SSE or WebSocket support yet.
- **CSS selector dependent**: Shadow DOM or dynamic class names may complicate element selection.
- **Source hints are best-effort**: Exact file matches depend on project structure and naming conventions.
- **Playwright required**: Chromium browser binary must be installed separately (`pnpm exec playwright install chromium`).
- **Windows PowerShell notes**: Some commands use `npx.cmd` for Windows compatibility.
- **Not production-ready**: This is an alpha release. API may change. Do not use in production environments.

## Setup Notes

```bash
# Install dependencies
pnpm install

# Install Playwright browser
pnpm exec playwright install chromium

# Start development server (or your own app)
node examples/phase12-source-hint-app/server.cjs

# Start MCP server
pnpm viskod serve --url http://localhost:3000
```

Configure your MCP client (OpenCode, Cursor, Claude Desktop) using the templates in `examples/mcp-configs/`.

Full quickstart: `QUICKSTART_MCP.md`
Agent workflow guide: `AGENT_WORKFLOW.md`

## Validation Summary

| Check | Result |
|-------|--------|
| TypeScript compilation (`tsc -b`) | 0 errors |
| Unit tests (`vitest run`) | 239/239 PASS |
| Biome lint + format | 0 errors (Phase 19 files); pre-existing diagnostics in `.opencode/` excluded |
| JSON config validation (4 files) | 4/4 PASS |
| MCP E2E smoke (`pnpm smoke:agent-workflow`) | 38/38 PASS |
| No tracked generated artifacts | Verified (`.viskod/`, `.opencode/` gitignored) |
| No private paths/secrets | Verified |

## Security / Privacy

- Root `package.json` is `"private": true` — no accidental npm publish.
- Sensitive data redaction is enabled by default (profile `enableRedaction` defaults to `true`).
- The MCP server listens on stdin/stdout only — no network exposure.
- Generated captures are gitignored and local-only.

## Upgrade / Migration

This is the first tagged release. Upgrade from earlier snapshots:

```bash
git checkout v0.2.0-alpha
pnpm install
pnpm exec playwright install chromium
```
