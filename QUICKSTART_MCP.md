# Quickstart: From UI Issue to Verified Fix

The recommended Viskod workflow runs through **Studio**: report a UI defect by
pointing at it, prepare an agent handoff, then verify the rendered fix.

## Prerequisites

- Node.js 22+
- pnpm 9+
- Git
- Playwright Chromium (`pnpm exec playwright install chromium`)

## 1. Install Dependencies

```bash
cd <REPO_PATH>
pnpm install
```

The fixture server uses Node's built-in `http` module. No additional install
is needed to run it.

## 2. Open a Local App

Start your local app (or the included fixture):

```bash
node examples/phase12-source-hint-app/server.cjs
```

Leave this running in a terminal. It serves the test page at
`http://localhost:3000`.

## 3. Start Studio

In a second terminal:

```bash
cd <REPO_PATH>
pnpm exec tsx apps/studio/src/index.ts
```

Studio starts a browser, serves its UI on `http://localhost:3001`, and waits
for you to open an app.

## 4. Report a UI Issue

Open `http://localhost:3001` in your browser:

1. Enter your app URL and click `Open app`.
2. Click `Report UI issue`.
3. **Hover over the problem and click it.** Studio shows a plain-language
   summary of the selected element — you never need to write a CSS selector.
4. Fill in `What is wrong?` and `What should happen?`, then click
   `Prepare agent handoff`.
5. Studio shows `Handoff ready` with a copyable prompt/ID. Give it to your
   coding agent (Claude Code, OpenCode, Cursor, ...).

## 5. Verify the Fix

After the agent changes the code:

1. Click `Verify fix`. Studio reloads the page (cache-bust) and recaptures
   the same element.
2. Review the before/after evidence and choose `Accept fix`, `Issue persists`,
   or `Needs follow-up`.

> A changed screenshot is **evidence, not truth**. "The rendered result
> changed" means review whether it matches the expected result — Studio never
> auto-accepts a fix based on pixels alone.

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Studio exits at startup | Port 3001 already in use | Stop the other process on 3001 |
| Browser does not open | Playwright browsers missing | `pnpm exec playwright install chromium` |
| `Open app` fails | Target URL not listening | Start the app first, then open it in Studio |
| Handoff/verification fails after the agent edits files | Browser cache | `Verify fix` always reloads with a cache-busting query parameter |

---

# Advanced: MCP Agent Integration

For agent integrations and advanced users, Viskod also exposes an MCP server.
This section documents the exact machine-facing call order.

## Start the MCP Server

```bash
cd <REPO_PATH>
pnpm viskod serve --url http://localhost:3000
```

The server starts the browser, verifies the target URL, and waits for JSON-RPC
messages on stdin.

> **Note:** `viskod serve` exits at startup if nothing is listening on the
> target URL (`ERR_CONNECTION_REFUSED`). Start the fixture (or your app) first.

## Configure Your MCP Client

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

Create `.cursor/mcp.json` in your project root with the same structure (see
`examples/mcp-configs/`).

### Claude Desktop

Add the server entry to your `claude_desktop_config.json`.

> **Windows PowerShell users:** If `pnpm` is not available globally, replace
> `pnpm` with the full path or use `npx tsx packages/cli/src/index.ts` from
> the repo directory.

## Verify the Connection

The MCP client will send a `tools/list` request on startup. The response
should include:

- `viskod_select_element`
- `viskod_capture_context`
- `viskod_navigate`
- `create_agent_handoff`
- `create_visual_review`
- `recapture_visual_review`
- `get_visual_review`

## MCP Capture

Ask your agent (or send a JSON-RPC request):

```
viskod_navigate(url: "http://localhost:3000")
viskod_capture_context(selector: ".target-card")
```

The response includes `packetId`, `selection`, `dom`, `styles`,
`screenshots`, `hierarchy`, `confidence`, and `evidenceSources`.

## MCP Handoff and Review Sequence

1. `create_agent_handoff(issueId: "<issue_id>")` — prepare a handoff for the
   connected agent.
2. `create_visual_review(issueId: "<issue_id>")` — create a before/after
   review.
3. `recapture_visual_review(reviewId: "<review_id>", reload: true,
   cacheBust: true)` — re-capture after a fix.
4. `get_visual_review(reviewId: "<review_id>")` — retrieve the comparison.

**Recommended after any local code/CSS change:** pass `reload: true` and
`cacheBust: true` to `recapture_visual_review`.
