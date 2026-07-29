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

The server prints `Viskod MCP Server started` and waits for JSON-RPC messages on stdin.

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

- `capture_context`
- `recapture_context`

You can also verify manually by sending a JSON-RPC initialize:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
```

Expected response includes `protocolVersion: "2024-11-05"` and capabilities listing both tools.

## 6. Run Your First Capture

Ask your agent (or send a JSON-RPC request):

```
capture_context(
  selector: ".target-card",
  url: "http://localhost:3000",
  profile: "debug",
  projectPath: "examples/phase12-source-hint-app"
)
```

The response includes:

| Field | What It Contains |
|-------|-----------------|
| `packetPath` | Path to the full packet JSON (for `previousPacketPath` in recapture) |
| `captureDir` | Directory with packet.json and screenshots |
| `brief` | Markdown summary: bounding box, DOM, styles, source hints, evidence |
| `sourceHintCount` | How many source files were linked |
| `runtimeEvidenceSummary` | Console and network counts |

## 7. Fix a Visual Issue

Edit the CSS file identified in the source hints. For the fixture:

`examples/phase12-source-hint-app/src/components/TargetCard.css`

Make a change (e.g., add or remove a style rule) that affects the element's bounding box.

## 8. Re-Capture and Compare

Call `recapture_context` with:

```
recapture_context(
  selector: ".target-card",
  url: "http://localhost:3000",
  profile: "default",
  projectPath: "examples/phase12-source-hint-app",
  previousPacketPath: "<packetPath from capture_context>",
  reload: true,
  cacheBust: true
)
```

The response includes a `comparisonSummary` with:

| Field | What It Shows |
|-------|--------------|
| `boundingBoxDelta` | Before/after/delta for x, y, width, height |
| `areaDelta` | Area change with percentChange |
| `evidenceDelta` | Console, network, source hint, screenshot count changes |
| `changedFields` | Which fields changed meaningfully |
| `verdict` | `"changed"`, `"improved"`, or `"unchanged"` |
| `notes` | Machine-readable explanation |

**No server restart needed.** The browser reloads via `reload: true` and bypasses cache with `cacheBust: true`.

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `tools/list` returns empty | MCP server not running | Check the server terminal for errors |
| `capture_context` hangs | Playwright browser launch issue | Ensure Playwright browsers are installed (`pnpm exec playwright install chromium`) |
| `recapture_context` returns 404 | Server doesn't handle query params | The fixture server was patched to strip query strings. For your own server, ensure routes ignore `__viskod_cb` |
| Source hints are empty | No project scan was run | Pass `projectPath` to point at the scanned project |
| Element not found | Selector doesn't match | Use browser DevTools to verify the selector works |
