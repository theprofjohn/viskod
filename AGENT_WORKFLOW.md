# Agent Workflow: From UI Issue to Verified Fix

## The Human Flow (recommended)

Viskod's primary user path runs through Studio. You do **not** need selectors,
packet IDs, or handoff IDs to use it.

1. **Open your app** — start your local app, then open Studio
   (`http://localhost:3001`), enter the app URL, and click `Open app`.
2. **Point at the problem** — click `Report UI issue`, hover over the broken
   element, and click it. Studio shows a plain-language summary of what you
   selected.
3. **What is wrong?** — describe the problem in the `What is wrong?` field.
4. **What should happen?** — describe the expected result in the
   `What should happen?` field.
5. **Prepare agent handoff** — click `Prepare agent handoff`. Studio creates
   an issue and a handoff, and shows `Handoff ready` with a copyable agent
   prompt/ID. Give that handoff to your coding agent (Claude Code, OpenCode,
   Cursor, ...). Studio does not invoke the agent itself.
6. **Verify fix** — after the agent changes the code, click `Verify fix`.
   Studio refreshes the page (reload + cache-bust) and recaptures the same
   element.
7. **Decide** — review the before/after evidence and choose `Accept fix`,
   `Issue persists`, or `Needs follow-up`.

Important: a changed screenshot is **evidence, not truth**. "The rendered
result changed" means you should review whether it matches the expected
result — Studio never auto-accepts a fix based on pixels alone.

---

# Technical Section: MCP Tools for Coding Agents

This section is for agent integrations and advanced users. The exact
machine-facing call order lives here.

## What Viskod Provides to an Agent

Viskod exposes MCP tools that a coding agent can call. The core capture tools
use the `viskod_` prefix; handoff, review, and setup tools use snake_case
names:

| Tool | Purpose |
|------|---------|
| `viskod_navigate` | Navigate the browser to a URL. Must be called before selecting or capturing. |
| `viskod_select_element` | Select an element by selector (optionally with x/y coordinates). |
| `viskod_capture_context` | Capture the visual state of the selected element. Returns a context packet with DOM snapshot, computed styles, screenshot metadata, hierarchy, and confidence. |
| `create_agent_handoff` | Create a handoff from an issue; the connected agent can fetch its context. |
| `create_visual_review` | Create a before/after visual review from an issue. |
| `recapture_visual_review` | Re-capture the same element after a fix and compare against the before snapshot. |
| `get_visual_review` | Retrieve the full comparison for a review. |

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

The daemon JSON-RPC protocol (`reload` / `cacheBust` capture options) and the
MCP `recapture_visual_review` tool support page refresh. The CLI `capture`
command and the `viskod_navigate` MCP tool do not expose these flags.

## When to Use `viskod_capture_context`

Call `viskod_capture_context` when you need to understand a UI element before
making changes:

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

When you edit CSS or source files locally, the browser may still serve the old
version from cache. The daemon capture protocol and `recapture_visual_review`
support:

| Option | What It Does |
|--------|-------------|
| `reload` | Reloads the current URL before recapturing. Use when the URL hasn't changed but assets have. |
| `cacheBust` | Appends `?__viskod_cb=<timestamp>` to the URL, forcing the server to re-serve every resource. Use when `reload` alone isn't enough. |

**Recommended after any local code/CSS change:** call `recapture_visual_review`
with `reload: true, cacheBust: true`.

For MCP-based verification, call `viskod_navigate` to refresh the page, then
`viskod_capture_context` again and compare the `selection.boundingBox` and
`styles` fields between captures.

## Verifying a Fix (Agent Sequence)

After a fix, re-capture the element and compare:

- If `selection.boundingBox` dimensions changed, the layout changed.
- If bounding box and styles are identical, the code change did not affect the
  element's visual layout.
- If console evidence counts decreased, console errors were reduced.

Automated before/after comparison is provided by the visual-review subsystem
(`create_visual_review` / `recapture_visual_review` / `get_visual_review` MCP
tools), which computes a pixel-change ratio, bounding-box deltas, and evidence
deltas (console/network) with a comparison status.

## Privacy / Redaction Expectations

Viskod redacts sensitive data by default:

- API keys and tokens (e.g., `sk_test_...`, `api_key=...`, `token=...`)
- Email addresses
- Credit card numbers
- Secrets in URL query parameters
- Base64-encoded tokens

Redacted values are replaced with `[REDACTED]` or `[TOKEN_REDACTED]`.

**Do not attempt to access raw unredacted values.** The redaction is applied
before the agent receives the data. If a value appears redacted, assume the
real value contains sensitive information.

## Known Limitations

1. `viskod_capture_context` requires a running browser session started by
   `viskod serve`. It cannot capture from a detached or external browser.
2. The element must be selectable by a CSS selector. Dynamic class names or
   shadow DOM may complicate selection.
3. Source hints are best-effort. The engine may not find exact source file
   matches for all elements.
4. Screenshots capture the element's current viewport state. Animations or
   transitions may not be fully rendered.
5. Network evidence is collected from the browser page context only, not from
   worker or extension network activity.
6. The MCP server listens on stdin/stdout only. It must be launched by the MCP
   client (OpenCode, Cursor, Claude Desktop).
7. In the Studio workflow, a target that cannot be safely re-captured keeps
   the workflow at the current stage with a recovery message ("Select the
   element again" / "Refresh the page and select it again"); no partial issue
   is created.
