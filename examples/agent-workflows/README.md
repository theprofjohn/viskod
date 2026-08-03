# Agent Workflow Examples

This directory contains example configurations, prompt templates, and workflow manifests for using Viskod as an MCP server with AI coding agents.

## Contents

| File | Purpose |
|------|---------|
| `prompts/fix-visual-issue.md` | Agent prompt template for the fix → recapture loop |
| `viskod.workflow.json` | Machine-readable workflow manifest |

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
