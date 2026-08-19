# Viskod

> **AI can read your code. Viskod lets it see your UI.**

[Website](https://theprofjohn.github.io/viskod/) · [Install](https://www.npmjs.com/package/@viskod/cli) · [Documentation](QUICKSTART_MCP.md) · [License](LICENSE)

[![CI](https://github.com/theprofjohn/viskod/actions/workflows/ci.yml/badge.svg)](https://github.com/theprofjohn/viskod/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/@viskod/cli?include_prereleases)](https://www.npmjs.com/package/@viskod/cli) [![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Viskod is a **visual context engine** for AI coding agents, built for
frontend and product engineers who use MCP-compatible coding agents (Claude
Code, OpenCode, Cursor, ...).

Coding agents understand source code extremely well. What they cannot
reliably understand is the **running user interface** — which is why fixing
visual bugs usually starts with a prompt like:

> "The third button inside the card on the left doesn't align correctly."

Viskod removes that ambiguity. Point at an element in your running
application and Viskod captures structured visual context — screenshots,
DOM metadata, computed styles, diagnostics and best-effort source hints —
then exposes it through **Model Context Protocol (MCP)** so your coding
agent can reason about what you are actually seeing.

---

## Why Viskod

Visual bugs are difficult for coding agents to fix when the report describes only a symptom. Viskod captures the running element and its surrounding evidence, then gives your MCP-compatible agent a grounded handoff it can act on and you can verify.
## See Viskod in action

![Studio selection evidence](website/demo-selection.png)

![Studio review evidence](website/demo-review.png)

These images come from the included local fixture; run the [local workflow](examples/agent-workflows/README.md#try-it-locally) or visit the [marketing site](https://theprofjohn.github.io/viskod/) to learn more.


---

# The Workflow: UI Issue → Agent Handoff → Verified Fix

```mermaid
flowchart LR
    A[Point at the<br/>broken element] --> B[Describe what is<br/>wrong / expected]
    B --> C[Prepare agent<br/>handoff]
    C --> D[Coding agent<br/>implements fix]
    D --> E[Verify fix<br/>before/after evidence]
    E --> F{Human decides}
    F -->|Accept fix| G[Done]
    F -->|Issue persists /<br/>Needs follow-up| D
```

1. **Point at the problem.** In Studio, click `Report UI issue` and click the
   broken element in your app. You never write a CSS selector by hand.
2. **Describe it.** Fill in `What is wrong?` and `What should happen?`.
3. **Prepare agent handoff.** Studio shows `Handoff ready` with a copyable
   prompt for your coding agent.
4. **Verify the fix.** After the agent changes the code, click `Verify fix`,
   review the before/after evidence, and choose `Accept fix`, `Issue
   persists`, or `Needs follow-up`.

> A changed screenshot is **evidence, not truth**. Viskod never auto-accepts
> a fix based on pixels alone — the human decides.

---

# What Viskod Is

* A visual context engine
* A browser inspection system
* An MCP server
* A local-first developer tool
* A bridge between running applications and AI coding agents

# What Viskod Is Not

Viskod is **not**:

* an IDE
* a code editor
* a chatbot
* an AI coding assistant
* a browser replacement
* a Figma alternative
* an autonomous software engineer

Viskod observes and supplies context. External coding agents implement.

---

# Supported Technologies

* **Node.js 22+** (runtime requirement)
* **Chromium** via Playwright (installed automatically, see below)
* **React, Next.js, Vite** applications
* **MCP-compatible coding agents** — Claude Code, OpenCode, and Cursor have
  documented configuration examples; any MCP client can use the server

---

# Installation

> **Project status:** Alpha — interfaces may change. See [Current Alpha Limitations](#current-alpha-limitations) before adopting Viskod in a critical workflow.

## Published package (recommended for the CLI/MCP RC)

```bash
npm i -g @viskod/cli        # → puts `viskod` on your PATH
```

Also available with:

```bash
bun add -g @viskod/cli
npx @viskod/cli serve       # one-shot, no install
```

Package installation runs `playwright install chromium`, so the first install
downloads a browser. If you already manage Chromium yourself you can opt out
with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` — but then you must install
Chromium separately or `viskod` will not be able to launch a browser.

The `0.2.4-alpha` release is the **Viskod CLI/MCP RC**. It packages the CLI
and MCP server only; Studio is not part of the CLI tarball and cannot be
started by an installed `viskod` command without a Viskod source checkout.

## From source (required for Studio in this RC)

Studio is currently a repository application, not a separately installable
package. To use the Studio UI, clone the Viskod repository and run:

```bash
pnpm install
pnpm exec playwright install chromium
pnpm exec tsx apps/studio/src/index.ts --project-root <your-app-dir>
```

Studio serves its UI on `http://localhost:3001`.

The installed CLI/MCP RC remains usable without a source checkout for setup,
diagnostics, MCP configuration, and agent handoff retrieval. The full visual
Studio workflow still requires the checkout limitation above.

---

# First Run

After installing, run the first-run setup to verify your environment and
configure your coding agent:

```bash
viskod setup --project-root <your-app-dir>
```

This checks Node.js, Chromium, and the target app URL, then generates a
non-destructive MCP configuration for Claude Desktop, Cursor, or OpenCode.

Run `viskod doctor` at any time for read-only diagnostics against your
current state:

```bash
viskod doctor --project-root <your-app-dir>
```

For a detailed walkthrough see [docs/setup.md](docs/setup.md).

---

# Studio Quickstart

In `0.2.4-alpha`, Studio is source-checkout-only. Start it from a Viskod
checkout with the command in the installation section, then:

1. Start your local app and leave it running.
2. Open `http://localhost:3001`, enter your app URL, and click `Open app`.
3. Click `Report UI issue`, hover over the problem, and click it.
4. Describe the problem, click `Prepare agent handoff`, and copy the prompt
   for your coding agent.
5. After the agent changes the code, click `Verify fix` and make the human
   decision.

Full walkthrough: [QUICKSTART_MCP.md](QUICKSTART_MCP.md)

---

# MCP Quickstart

The MCP server speaks JSON-RPC over stdin/stdout and is started by your MCP
client. The target app must already be listening, or `viskod serve` exits at
startup with a connection error:

viskod serve --url http://localhost:3000 --project-root <your-app-dir>
```
## Choose a path

| Path | Start here |
|------|------------|
| Studio demo | [Try the included fixture locally](examples/agent-workflows/README.md#try-it-locally) |
| MCP client | [Use the MCP tool path](examples/agent-workflows/README.md#mcp-path) |
| Published CLI | [Install `@viskod/cli` from npm](https://www.npmjs.com/package/@viskod/cli) |


## Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "viskod": {
      "command": "viskod",
      "args": ["serve", "--url", "http://localhost:3000"]
    }
  }
}
```

## Cursor

Add `.cursor/mcp.json` in your project root with the same `mcpServers`
structure (see [examples/mcp-configs/](examples/mcp-configs/)).

## OpenCode

Add to `~/.config/opencode/opencode.json` or a project-level
`opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "viskod": {
      "type": "local",
      "command": ["viskod", "serve", "--url", "http://localhost:3000"],
      "enabled": true
    }
  }
}
```

Ready-made files for all three clients live in
[examples/mcp-configs/](examples/mcp-configs/).

## Available Commands

```text
viskod setup --project-root <dir>   # first-run verification
viskod doctor --project-root <dir>  # read-only diagnostics
viskod serve --url <APP_URL>        # start MCP server
viskod start                        # start daemon
viskod stop                         # stop daemon
viskod status                       # daemon status
viskod health                       # connectivity check
viskod install <client>             # install agent config
viskod scan                         # project scan
viskod capture <selector>           # capture a context packet
viskod export                       # export capture data
```

## What the agent can do

The MCP server registers **31 tools**. Key tools include
`viskod_capture_context`, `viskod_select_element`,
`create_agent_handoff`, `create_visual_review`,
`get_visual_review`, `recapture_visual_review`,
`resolve_usage_site_hints`, `get_setup_state`, `run_setup_checks`,
and `complete_setup`. A capture returns a structured context packet: DOM
snapshot, computed styles, screenshot metadata, hierarchy, evidence
sources, and a confidence rating.

Example agent prompt:
[examples/agent-workflows/prompts/fix-visual-issue.md](examples/agent-workflows/prompts/fix-visual-issue.md)

Technical reference: [AGENT_WORKFLOW.md](AGENT_WORKFLOW.md)

---

# Privacy & Security

Viskod is local-first and designed to keep development data on your machine:

* **Telemetry is disabled by default.**
* **Services bind to localhost/127.0.0.1 only** — no cloud accounts, no
  hosted APIs, no credentials required.
* **Sensitive values are redacted** before an agent ever sees them (API keys,
  tokens, emails, credit-card numbers, secrets in URLs).
* By default Viskod does **not** collect `.env` files, cookies, tokens,
  source code, screenshots, DOM data, or repository contents. Capture is
  explicit, on your machine, for the element you point at.

---

# Current Alpha Limitations

Viskod is an **alpha** release. Expect rough edges and change:

* The CLI and MCP tool set are alpha; interfaces may change.
* **Screenshots capture the viewport only** — content outside the current
  viewport is not captured.
* **Network evidence comes from the page context only** — worker or
  extension network activity is not captured.
* **Selection has explicit browser boundaries** — regular DOM targets use the
  normal resolution path. Application Shadow DOM and iframe contents are not
  traversed by the current document-root selector/overlay path; closed Shadow
  DOM and cross-origin iframes remain host/frame boundaries.
* **Source hints are best-effort** — every hint carries a confidence rating
  and reasoning; treat them as leads, not facts.
* Capture requires the browser session that `viskod serve` starts; it cannot
  capture from a detached or external browser.
* Target navigation is local-first: HTTP(S) loopback targets are accepted, URL
  credentials and non-HTTP(S) schemes are rejected, and remote hosts require an
  explicit trusted-host allowlist. Redirects are checked against the same policy.
* The MCP server is launched by your MCP client over stdin/stdout; it is not
  a standalone network service.

---

# Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `viskod serve` exits at startup | Target URL is not listening | Start your app first, then run `viskod serve --url <url>` |
| Studio exits at startup | Port 3001 already in use | Stop the other process on 3001 |
| Browser does not open | Playwright Chromium missing | `pnpm exec playwright install chromium` (or reinstall the CLI) |
| `Open app` fails | Target URL not listening | Start the app first, then open it in Studio |
| Fix verification looks stale | Browser cache | `Verify fix` always reloads with a cache-busting query parameter |

---

# Contributing & License

Viskod's local visual-context workflow is open source under the
[Apache License 2.0](LICENSE). See [TRADEMARKS.md](TRADEMARKS.md) for the
trademark policy. Contributions, issues, and pull requests are welcome.

Project links: [Website](https://theprofjohn.github.io/viskod/) · [Source](https://github.com/theprofjohn/viskod) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)
