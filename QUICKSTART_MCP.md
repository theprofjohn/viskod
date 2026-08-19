# Quickstart: From UI Issue to Verified Fix

The `0.2.4-alpha` artifact is the **Viskod CLI/MCP RC**. Studio is not
included in the CLI package and is not separately installable yet. The
installed-only path covers setup, MCP, handoff retrieval, and agent
integration; the visual Studio workflow requires a Viskod source checkout.

## Prerequisites

- Node.js 22+
- A normal external project with a running app
- Playwright Chromium (installed by the CLI package)

For the Studio workflow only, also use a Viskod source checkout with pnpm 9+
and Git.

## 1. Install the CLI/MCP RC

```bash
npm i -g @viskod/cli
viskod setup --project-root <your-app-dir> --install opencode
viskod doctor --project-root <your-app-dir>
```

The installed CLI can start the MCP server without a Viskod checkout:

```bash
viskod serve --url http://localhost:3000 --project-root <your-app-dir>
```

## 2. Start Studio (source-checkout limitation)

Studio is currently a repository application. Clone Viskod, then run:

```bash
cd <REPO_PATH>
pnpm install
pnpm exec playwright install chromium
pnpm exec tsx apps/studio/src/index.ts --project-root <your-app-dir>
```

Studio serves its UI on `http://localhost:3001`. This source checkout is
required only for the Studio UI in this RC; it is not needed by the installed
CLI/MCP command.

## 3. Open a Local App

Start your normal local app and leave it running. The fixture command below
is available only from a Viskod checkout:

```bash
node examples/phase12-source-hint-app/server.cjs
```

It serves the test page at `http://localhost:3000`.


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

### Option A: Installed CLI (recommended)

```bash
viskod setup --project-root ./your-app --install opencode
viskod doctor --project-root ./your-app
viskod serve --url http://localhost:3000 --project-root ./your-app
```

### Option B: From Source

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

Create or edit `~/.config/opencode/opencode.json` (or a project-level
`opencode.json`). OpenCode's current config format uses an `mcp` key with an
array `command`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "viskod": {
      "type": "local",
      "command": [
        "pnpm", "--dir", "<REPO_PATH>",
        "exec", "tsx",
        "packages/cli/src/index.ts",
        "serve",
        "--url", "http://localhost:3000"
      ],
      "enabled": true
    }
  }
}
```

If you installed the published CLI (`npm i -g @viskod/cli`), use
`["viskod", "serve", "--url", "http://localhost:3000"]` as the command. See
`examples/mcp-configs/opencode.json` for that variant.

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
should include **31 tools**. Key tools:

- `viskod_navigate`, `viskod_select_element`, `viskod_capture_context`
- `create_agent_handoff`, `get_agent_handoff`, `list_agent_handoffs`
- `create_visual_review`, `get_visual_review`, `recapture_visual_review`
- `resolve_usage_site_hints`
- `get_setup_state`, `run_setup_checks`, `complete_setup`

See [docs/mcp.md](docs/mcp.md) for the full tool list.

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
