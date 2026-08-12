# Agent Workflow Examples

This directory contains example configurations, prompt templates, and workflow manifests for using Viskod as an MCP server with AI coding agents.

## Contents

| File | Purpose |
|------|---------|
| `prompts/fix-visual-issue.md` | Agent prompt template for the fix → recapture loop |
| `viskod.workflow.json` | Machine-readable workflow manifest |

## Try it locally

Prerequisites:

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

Start the included fixture and Studio together:

```bash
pnpm demo
```

Then open `http://127.0.0.1:3001` in your browser, use the fixture at
`http://127.0.0.1:3000`, and choose `Report UI issue`. Select an element, then
fill in the problem and expected result.

## MCP path

Start the MCP server against the same fixture:

```bash
viskod serve --url http://127.0.0.1:3000
```

Call these tools first: `viskod_navigate`, `viskod_select_element`, and
`viskod_capture_context`. Continue with the
[visual issue prompt](prompts/fix-visual-issue.md).

The MCP selector path and the Studio point-and-click path are two entry paths
to the same evidence model.

## Workflow Overview

The standard Viskod agent workflow has three phases:

### Phase 1: Capture

```
agent → viskod_capture_context(selector)
      → receives packetId + selection + styles + source hints
      → inspects source hints
```

### Phase 2: Fix

```
agent → reads source file from hints
      → edits CSS/JSX
```

### Phase 3: Recapture

```
agent → create_visual_review(issueId)
      → recapture_visual_review(reviewId, reload: true, cacheBust: true)
      → get_visual_review(reviewId)
      → verifies comparison (changedPixelRatio, boundingBoxDelta, evidence deltas)
```

See `prompts/fix-visual-issue.md` for the full agent prompt template.
See `viskod.workflow.json` for the machine-readable schema.
