# Agent Workflow: Visual Context Capture for Coding Agents

## What Viskod Provides to an Agent

Viskod exposes MCP tools that a coding agent can call. The core capture tools use the `viskod_` prefix; handoff, review, and setup tools use snake_case names:

| Tool | Purpose |
|------|---------|
| `viskod_navigate` | Navigate the browser to a URL. Must be called before selecting or capturing. |
| `viskod_select_element` | Select an element by selector (optionally with x/y coordinates). |
| `viskod_capture_context` | Capture the visual state of the selected element. Returns a context packet with DOM snapshot, computed styles, screenshot metadata, hierarchy, and confidence. |

The capture response includes:

- `ok` — whether the capture succeeded
- `packetId` — unique ID of the captured context packet
- `selection` — selector, tag name, bounding box, and text of the captured element
- `dom` — tag name, attributes, and child count
- `styles` — computed styles of the element
- `screenshots` — screenshot metadata (capture ID, type, format, dimensions)
- `hierarchy` — selected node, parents, sibling and child counts
- `confidence` — source mapping, semantic labeling, layout analysis, framework detection
- `evidenceSources` — which subsystems produced evidence
- `processingTimeMs` — capture duration

The daemon JSON-RPC protocol (`reload` / `cacheBust` capture options) and the MCP `recapture_visual_review` tool support page refresh. The CLI `capture` command and the `viskod_navigate` MCP tool do not expose these flags.

## When to Use `viskod_capture_context`

Call `viskod_capture_context` when you need to understand a UI element before making changes:

- On first interaction with a UI element
- When investigating a layout or styling issue
- Before editing a component's CSS or JSX
- When the element's current state is unknown

### Example

```
viskod_select_element(
  selector: ".target-card"
)

viskod_capture_context(
  selector: ".target-card"
)
```

## Recommended Profile Usage

The `--profile` option on the CLI/daemon capture controls evidence collection:

| Profile | Console | Network | Screenshot | When to Use |
|---------|---------|---------|------------|-------------|
| `default` | Yes | No | Yes | Quick checks, layout verification |
| `debug` | Yes | Yes | Yes | Full investigation, before making changes |
| `audit` | Yes | Yes | No | Performance or network diagnostics |

- Use `debug` for the initial capture to get the most information.
- Use `default` for a follow-up capture after a fix.

## How `reload` / `cacheBust` Work After Local Changes

When you edit CSS or source files locally, the browser may still serve the old version from cache. The daemon capture protocol and `recapture_visual_review` support:

| Option | What It Does |
|--------|-------------|
| `reload` | Reloads the current URL before recapturing. Use when the URL hasn't changed but assets have. |
| `cacheBust` | Appends `?__viskod_cb=<timestamp>` to the URL, forcing the server to re-serve every resource. Use when `reload` alone isn't enough. |

**Recommended after any local code/CSS change:** call `recapture_visual_review` with `reload: true, cacheBust: true`.

For MCP-based verification, call `viskod_navigate` to refresh the page, then `viskod_capture_context` again and compare the `selection.boundingBox` and `styles` fields between captures.

## Verifying a Fix

After a fix, re-capture the element and compare:

- If `selection.boundingBox` dimensions changed, the layout changed.
- If bounding box and styles are identical, the code change did not affect the element's visual layout.
- If console evidence counts decreased, console errors were reduced.

Automated before/after comparison is provided by the visual-review subsystem (`create_visual_review` / `recapture_visual_review` / `get_visual_review` MCP tools), which computes a pixel-change ratio, bounding-box deltas, and evidence deltas (console/network) with a comparison status.

## Privacy / Redaction Expectations

Viskod redacts sensitive data by default:

- API keys and tokens (e.g., `sk_test_...`, `api_key=...`, `token=...`)
- Email addresses
- Credit card numbers
- Secrets in URL query parameters
- Base64-encoded tokens

Redacted values are replaced with `[REDACTED]` or `[TOKEN_REDACTED]`.

**Do not attempt to access raw unredacted values.** The redaction is applied before the agent receives the data. If a value appears redacted, assume the real value contains sensitive information.

## Known Limitations

1. `viskod_capture_context` requires a running browser session started by `viskod serve`. It cannot capture from a detached or external browser.
2. The element must be selectable by a CSS selector. Dynamic class names or shadow DOM may complicate selection.
3. Source hints are best-effort. The engine may not find exact source file matches for all elements.
4. Screenshots capture the element's current viewport state. Animations or transitions may not be fully rendered.
5. Network evidence is collected from the browser page context only, not from worker or extension network activity.
6. The MCP server listens on stdin/stdout only. It must be launched by the MCP client (OpenCode, Cursor, Claude Desktop).
