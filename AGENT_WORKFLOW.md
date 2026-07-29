# Agent Workflow: Visual Context Capture for Coding Agents

## What Viskod Provides to an Agent

Viskod exposes two main MCP tools that a coding agent can call:

| Tool | Purpose |
|------|---------|
| `capture_context` | Capture the current visual state of an element. Returns a brief with bounding box, DOM info, computed styles, source hints, and runtime evidence. |
| `recapture_context` | Re-capture the same element and compare against a previous capture. Returns the same brief plus a `comparisonSummary` that describes what changed. |

Both tools return:
- A human-readable markdown `brief` (or compact JSON if `format: "json"`)
- `packetPath` — path to the full packet JSON on disk
- `captureDir` — directory containing the packet and screenshots
- `sourceHintCount` — number of source files linked to this element
- `runtimeEvidenceSummary` — console and network entry counts
- `redactionSummary` — types of sensitive data that were redacted

## When to Use `capture_context`

Call `capture_context` when you need to understand a UI element before making changes:

- On first interaction with a UI element
- When investigating a layout or styling issue
- Before editing a component's CSS or JSX
- When the element's current state is unknown

### Example

```
capture_context(
  selector: ".target-card",
  url: "http://localhost:3000",
  profile: "debug"
)
```

## When to Use `recapture_context`

Call `recapture_context` after making a code or CSS change to verify the fix:

- After editing a component's source file
- After modifying CSS rules
- After changing layout or dimensions
- After fixing console errors or network issues

### Example

```
recapture_context(
  selector: ".target-card",
  url: "http://localhost:3000",
  profile: "default",
  previousPacketPath: "<packetPath from capture_context>",
  reload: true,
  cacheBust: true
)
```

## Recommended Profile Usage

| Profile | Console | Network | Screenshot | When to Use |
|---------|---------|---------|------------|-------------|
| `default` | Yes | No | No | Quick checks, layout verification |
| `debug` | Yes | Yes | Yes | Full investigation, before making changes |
| `audit` | Yes | Yes | No | Performance or network diagnostics |

- Use `debug` for the initial `capture_context` to get the most information.
- Use `default` for `recapture_context` after a fix — you mainly need the comparison.

## How `reload` / `cacheBust` Work After Local Changes

When you edit CSS or source files locally, the browser may still serve the old version from cache.

| Option | What It Does |
|--------|-------------|
| `reload: true` | Calls `page.reload()` — the browser reloads the current URL. Use when the URL hasn't changed but assets have. |
| `cacheBust: true` | Appends `?__viskod_cb=<timestamp>` to the URL, forcing the server to re-serve every resource. Use when `reload` alone isn't enough. |

**Recommended after any local code/CSS change:**

```
recapture_context(
  ...,
  reload: true,
  cacheBust: true
)
```

For `recapture_context`, `reload` defaults to `true` when `previousPacketPath` is provided, so you only need to explicitly set `cacheBust: true`.

## How to Interpret `comparisonSummary`

After a `recapture_context` call with `previousPacketPath`, the response includes a `comparisonSummary`:

```json
{
  "boundingBoxDelta": {
    "x": { "before": 320, "after": 320, "delta": 0 },
    "y": { "before": 99, "after": 99, "delta": 0 },
    "width": { "before": 640, "after": 640, "delta": 0 },
    "height": { "before": 112, "after": 147.5, "delta": 35.5 }
  },
  "areaDelta": {
    "beforeArea": 71680,
    "afterArea": 94400,
    "delta": 22720,
    "percentChange": 31.7
  },
  "evidenceDelta": {
    "console": { "before": 2, "after": 3, "delta": 1 },
    "network": { "before": 4, "after": 0, "delta": -4 },
    "sourceHints": { "before": 10, "after": 10, "delta": 0 },
    "screenshots": { "before": 1, "after": 1, "delta": 0 }
  },
  "changedFields": [
    "boundingBox.height",
    "evidence.console",
    "evidence.network"
  ],
  "verdict": "changed",
  "notes": "Fields changed: boundingBox.height, evidence.console, evidence.network; height delta: 35.5; width delta: 0"
}
```

### Field Guide

| Field | Meaning |
|-------|---------|
| `boundingBoxDelta` | Before/after/delta for x, y, width, height of the element's bounding rect. Positive `height` delta means the element grew taller. |
| `areaDelta` | Before/after/delta for the element's area (width x height). `percentChange` shows the relative change. |
| `evidenceDelta` | Count changes for console entries, network requests, source hints, and screenshots. |
| `changedFields` | Array of field names that meaningfully changed. Layout fields like `boundingBox.height` confirm a visual fix. |
| `verdict` | One of: `"improved"` (height↑ + width↓ pattern), `"changed"` (some fields changed), `"unchanged"`, `"regressed"`, `"unknown"`. |
| `notes` | Machine-readable explanation summarizing deltas. |

### Deciding Whether a Fix Worked

- If `changedFields` includes `boundingBox.height` or `boundingBox.width`, the layout changed.
- If `changedFields` is empty and `verdict` is `"unchanged"`, the code change did not affect the element's visual layout.
- If `verdict` is `"improved"` (height increased + width decreased), the fix matches the Phase 12/13 card layout pattern.
- If `evidenceDelta.console.delta` is negative, console errors were reduced.
- If `evidenceDelta.network.delta` is negative or zero, network issues did not get worse.

## Privacy / Redaction Expectations

Viskod redacts sensitive data by default:

- API keys and tokens (e.g., `sk_test_...`, `api_key=...`, `token=...`)
- Email addresses
- Credit card numbers
- Secrets in URL query parameters
- Base64-encoded tokens

Redacted values are replaced with `[REDACTED]` or `[TOKEN_REDACTED]`.
The `redactionSummary` field lists which redaction types were applied.

**Do not attempt to access raw unredacted values.** The redaction is applied before the agent receives the data. If a value appears redacted, assume the real value contains sensitive information.

## Known Limitations

1. `capture_context` requires a running browser session started by `viskod serve`. It cannot capture from a detached or external browser.
2. The element must be selectable by a CSS selector. Dynamic class names or shadow DOM may complicate selection.
3. Source hints are best-effort. The engine may not find exact source file matches for all elements.
4. Screenshots capture the element's current viewport state. Animations or transitions may not be fully rendered.
5. Network evidence is collected from the browser page context only, not from worker or extension network activity.
6. The MCP server listens on stdin/stdout only. It must be launched by the MCP client (OpenCode, Cursor, Claude Desktop).
