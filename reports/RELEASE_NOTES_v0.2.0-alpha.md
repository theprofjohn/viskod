# Viskod v0.2.0-alpha — MCP Agent Workflow

## What Viskod Is

Viskod is a **Visual Context Engine** for AI coding agents. It captures structured visual context from a running UI — bounding box, DOM, computed styles, console evidence, network requests, and source hints — and exposes it through Model Context Protocol (MCP) so agents can reason about visual issues without relying on ambiguous human descriptions.

## What Works

- **MCP server** with core capture tools `viskod_capture_context` and `viskod_navigate`, plus the agent-handoff, visual-review (`recapture_visual_review`), usage-site hint, and first-run setup tool families
- **`viskod_capture_context`**: Capture an element's visual state → receive a structured context packet with selection, DOM, styles, screenshots, source hints, console/network evidence, and confidence
- **`recapture_visual_review`**: Re-capture the same element after a fix → receive a comparison with pixel-change ratio, bounding-box deltas, and evidence deltas plus a comparison status
- **`reload` / `cacheBust`**: Force browser to pick up local CSS/code changes without restarting the MCP server (daemon capture protocol and `recapture_visual_review`)
- **Profile system**: `default` (lightweight), `debug` (full), `audit` (network-focused)
- **Privacy/redaction**: API keys, tokens, emails, and credit card numbers are redacted by default
- **Source hints**: Ranked file matches linking UI elements to source code

## MCP Tools Available

| Tool | Description |
|------|-------------|
| `viskod_capture_context` | Capture element context by CSS selector |
| `viskod_select_element` | Select an element to inspect |
| `viskod_navigate` | Navigate the browser to a URL |
| `create_agent_handoff` / `get_agent_handoff` | Create and retrieve agent handoffs |
| `create_visual_review` / `recapture_visual_review` / `get_visual_review` | Before/after visual review lifecycle |
| `resolve_usage_site_hints` | Ranked usage-site source hints |
| `get_setup_state` / `run_setup_checks` / `complete_setup` | First-run setup tools |

## Validated Workflow

```
viskod_navigate(url: "http://localhost:3000")
→ viskod_select_element(selector: ".target-card")
→ viskod_capture_context(selector: ".target-card")
  → receives packetId + selection + source hints
→ fix the issue in identified source file
→ create_visual_review(issueId)
→ recapture_visual_review(reviewId, reload: true, cacheBust: true)
  → receives comparison status + summary
→ get_visual_review(reviewId) → full comparison (pixel ratio, bounding box deltas)
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
