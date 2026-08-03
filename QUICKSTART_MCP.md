# Quickstart: Viskod MCP Agent Workflow

This guide walks through the complete Viskod MCP workflow: capturing UI context, fixing a visual issue, and verifying the fix — all without restarting the MCP server.

## Prerequisites

- Node.js 22+
- pnpm 9+
- Git

## 1. Install Dependencies

```bash
cd <REPO_PATH>
pnpm install
```

The fixture server uses Node's built-in `http` module. No additional install is needed to run it.

## 2. Start the Fixture Server

```bash
node examples/phase12-source-hint-app/server.cjs
```

Leave this running in a terminal. It serves the test page at `http://localhost:3000`.

## 3. Start Viskod MCP Server

In a second terminal:

```bash
cd <REPO_PATH>
pnpm viskod serve --url http://localhost:3000
```

The server starts the browser, verifies the target URL, and waits for JSON-RPC messages on stdin.

> **Note:** `viskod serve` exits at startup if nothing is listening on the target URL (`ERR_CONNECTION_REFUSED`). Start the fixture (or your app) first.

## 4. Configure Your MCP Client

### OpenCode

Create or edit `~/.config/opencode/opencode.json`:

```json
{
  "mcpServers": {
    "viskod": {
      "command": "pnpm",
      "args": [
        "--dir", "<REPO_PATH>",
        "exec", "tsx",
        "packages/cli/src/index.ts",
        "serve",
        "--url", "http://localhost:3000"
      ],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

### Cursor

Create `.cursor/mcp.json` in your project root with the same structure (see `examples/mcp-configs/`).

### Claude Desktop

Add the server entry to your `claude_desktop_config.json`.

> **Windows PowerShell users:** If `pnpm` is not available globally, replace `pnpm` with the full path or use `npx tsx packages/cli/src/index.ts` from the repo directory.

## 5. Verify the Connection

The MCP client will send a `tools/list` request on startup. The response should include:

- `viskod_select_element`
- `viskod_capture_context`
- `viskod_navigate`

You can also verify manually by sending a JSON-RPC initialize:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
```

Expected response includes `protocolVersion: "2024-11-05"` and capabilities listing the tools.

## 6. Run Your First Capture

Ask your agent (or send a JSON-RPC request):

```
viskod_capture_context(
  selector: ".target-card"
)
```

The response includes:

| Field | What It Contains |
|-------|-----------------|
| `ok` | Whether the capture succeeded |
| `packetId` | Unique ID of the captured context packet |
| `selection` | Selector, tag name, bounding box, and text of the captured element |
| `dom` | Tag name, attributes, and child count |
| `styles` | Computed styles of the element |
| `screenshots` | Screenshot metadata (capture ID, type, format, dimensions) |
| `hierarchy` | Selected node, parents, sibling and child counts |
| `confidence` | Source mapping, semantic labeling, layout analysis, framework detection |
| `evidenceSources` | Which subsystems produced evidence |
| `processingTimeMs` | Capture duration |

For a page-level capture, use `viskod_select_element(selector)` first (after navigating with `viskod_navigate`), or pass an explicit `selector` to `viskod_capture_context`.

## 7. Fix a Visual Issue

Edit the CSS file identified in the source hints. For the fixture:

`examples/phase12-source-hint-app/src/components/TargetCard.css`

Make a change (e.g., add or remove a style rule) that affects the element's bounding box.

## 8. Re-Capture and Compare

Navigate back to the page and capture again:

```
viskod_navigate(
  url: "http://localhost:3000"
)

viskod_capture_context(
  selector: ".target-card"
)
```

Compare the `selection.boundingBox` and `styles` fields between the two captures to verify the fix.

**No server restart needed.** Use `viskod_navigate` (or the daemon capture protocol's `reload`/`cacheBust` options) to refresh the page between captures.

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `tools/list` returns empty | MCP server not running | Check the server terminal for errors |
| Server exits at startup | Target URL not listening | Start the app first, then `viskod serve` (`ERR_CONNECTION_REFUSED`) |
| `viskod_capture_context` hangs | Playwright browser launch issue | Ensure Playwright browsers are installed (`pnpm exec playwright install chromium`) |
| Source hints are empty | No project scan was run | Run `pnpm viskod scan` in the project, or use the CLI capture with `--project-path` |
| Element not found | Selector doesn't match | Use browser DevTools to verify the selector works |
