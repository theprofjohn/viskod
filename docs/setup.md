# First-Run Setup

This guide walks through Viskod's first-run setup: verifying your
environment, configuring your coding agent, and checking health.

## Prerequisites

- Node.js 22+
- Chromium (installed automatically by the CLI via Playwright)
- A running local application to test against

### Skipping Chromium Download

If you manage Chromium yourself (e.g. system-installed or CI image), skip
the bundled download:

```bash
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i -g @viskod/cli
```

You must then install Chromium separately or `viskod` will not be able to
launch a browser.

---

## Project Root

Every setup and serve command requires an explicit project directory:

```bash
viskod setup --project-root /path/to/your/app
viskod doctor --project-root /path/to/your/app
viskod serve --url http://localhost:3000 --project-root /path/to/your/app
```

Viskod never guesses the project root from the current working directory.
Use `--project-root` or set `VISKOD_PROJECT_ROOT`.

---

## viskod setup

`viskod setup` is the first-run orchestrator. It:

1. **Checks prerequisites** — Node.js version, Chromium availability, and
   that the target application URL is reachable.
2. **Reports state** — each check produces pass/fail with a short reason.
3. **Configures your agent** — generates a non-destructive MCP configuration
   for Claude Desktop, Cursor, or OpenCode. Existing configuration keys are
   preserved; only the Viskod entry is added or updated.

### Options

```text
--project-root <dir>    Required. Path to your application.
--install <client>      Install MCP config for a specific client
                        (claude, cursor, opencode).
--limited               Allow partial setup when a non-critical check
                        fails. Requires explicit consent (flag or TTY
                        prompt).
```

### Flow

```text
1.  viskod setup --project-root ./my-app
    ↓
2.  Checks: Node.js ✓  Chromium ✓  Target URL ✓
    ↓
3.  State: complete
    ↓
4.  (if --install) Agent config written to ~/.claude.json / .cursor/mcp.json
```

### Limited Mode

If a non-critical check fails (e.g. Chromium is present but the target
app is not yet running), `viskod setup` reports an **incomplete** state and
stops. To proceed anyway:

- Interactive terminal: the setup prompts for consent.
- Non-interactive / CI: pass `--limited` explicitly. Without this flag,
  non-TTY environments abort with `SETUP_LIMITED_CONSENT_REQUIRED`.

When limited mode is accepted, the state is recorded as **limited** with
the reasons saved for later inspection.

### State Model

| State | Meaning |
|-------|---------|
| `complete` | All checks passed and verification succeeded. |
| `limited` | User consented to proceed despite a failed check. The reasons are recorded. |
| `incomplete` | Verification failed and the user did not consent to limited mode. Setup is not marked as completed. |

`viskod setup` is idempotent: running it again re-checks and updates the
stored state.

---

## viskod doctor

`viskod doctor` is a read-only diagnostic command. It runs the same
prerequisite checks as `viskod setup` but never writes state or modifies
configuration.

```bash
viskod doctor --project-root ./my-app
```

Use `viskod doctor` to confirm a previously completed setup is still valid
or to diagnose why `viskod serve` is not working.

---

## viskod serve

After setup completes, start the MCP server:

```bash
viskod serve --url http://localhost:3000 --project-root ./my-app
```

The server starts the browser, verifies the target URL, and waits for
JSON-RPC messages on stdin (launched by your MCP client).

If the target URL is not listening, `viskod serve` exits at startup with
a connection error. Start your app first.

### Target URL policy

Target URLs must use `http://` or `https://`, must not contain credentials,
and must resolve to `localhost`, IPv4 loopback, or IPv6 loopback. Remote hosts
are rejected by default; there is no implicit remote-navigation permission.
Navigation also validates the final URL after redirects, so a local URL cannot
redirect into a disallowed scheme or host.

---

## Agent Configuration

When `viskod setup --install <client>` is used, Viskod writes an MCP
server entry to the client's configuration file:

| Client | Config File |
|--------|-------------|
| Claude Desktop | `~/.claude.json` |
| Cursor | `.cursor/mcp.json` |
| OpenCode | `~/.config/opencode/opencode.json` |

Configuration writes are **non-destructive**: existing keys in the file
are preserved. Only the Viskod entry is added or updated.

You can also install manually with `viskod install <client>`.

---

## Generated Artifacts

All setup artifacts are local:

- **Setup state** is persisted in `.viskod/` inside the project root.
- **Browser data** is stored locally by Playwright.
- **Captures and screenshots** stay on your machine.
- **No data leaves your machine** unless you explicitly configure external
  services.

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `SETUP_LIMITED_CONSENT_REQUIRED` | Non-TTY without `--limited` | Add `--limited` flag or run in an interactive terminal |
| Setup stays `incomplete` | A required check failed | Run `viskod doctor` to see which check failed and why |
| `viskod serve` exits at startup | Target URL not listening | Start your app first, then run serve |
| Chromium not found | Browser download was skipped | Reinstall with `playwright install chromium` or re-run setup |
