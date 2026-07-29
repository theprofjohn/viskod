# Agent Prompt: Fix a Visual Issue Using Viskod

Use this prompt template when an agent needs to diagnose, fix, and verify a visual UI issue using Viskod's MCP tools.

---

## Instructions

You have access to the Viskod MCP server, which provides two tools: `capture_context` and `recapture_context`.

Follow these steps in order:

### Step 1: Capture the Current State

Call `capture_context` to understand the element:

```
capture_context(
  selector: "<CSS_SELECTOR>",
  url: "<APPLICATION_URL>",
  profile: "debug",
  projectPath: "<PROJECT_PATH>"
)
```

Inspect the response carefully:
- **`brief`**: Contains the bounding box, computed styles, visible text, source hints, console errors, and network requests.
- **`sourceHintCount`** and the source hints table: Lists files ranked by confidence. Start with the highest-confidence existing file.
- **`packetPath`**: Save this value — you will need it for `recapture_context`.
- **`runtimeEvidenceSummary`**: Note console errors and network failures.

### Step 2: Inspect Source Hints

The brief includes a ranked table of source hints:

```
| # | File | Confidence | Exists | Match Type |
|---|------|-----------|--------|------------|
| 1 | src/components/TargetCard.jsx | 85% | Yes | case-insensitive |
| 2 | src/components/TargetCard.css | 80% | Yes | style-adjacent |
```

- Start with the highest-confidence file that `Exists` shows as `Yes`.
- Read the file and identify what might be causing the issue.
- Use the bounding box and computed styles from the brief to guide your analysis.

### Step 3: Edit Only Relevant Source Files

- Make minimal, targeted edits.
- Do NOT modify files that are not related to the identified issue.
- Do NOT expose or log values that appear redacted in the capture output.
- If a value appears as `[REDACTED]` or `[TOKEN_REDACTED]`, treat it as sensitive — do not attempt to reconstruct or leak it.

### Step 4: Re-Capture and Verify

After making changes, call `recapture_context`:

```
recapture_context(
  selector: "<CSS_SELECTOR>",
  url: "<APPLICATION_URL>",
  profile: "default",
  projectPath: "<PROJECT_PATH>",
  previousPacketPath: "<packetPath_from_capture_context>",
  reload: true,
  cacheBust: true
)
```

### Step 5: Read the Comparison Summary

The `comparisonSummary` tells you whether the fix worked:

1. **Check `changedFields`:** Does it include `boundingBox.height` or `boundingBox.width`? If yes, the layout changed.
2. **Check `boundingBoxDelta`:** Look at the height and width deltas. Positive height + negative width is the "improved" pattern.
3. **Check `areaDelta.percentChange`:** How much did the element's area change?
4. **Check `evidenceDelta`:** Did console errors decrease? Did network issues improve?
5. **Check `verdict`:**
   - `"improved"` — The fix matches the expected layout pattern.
   - `"changed"` — Something changed but it's not the full improvement pattern.
   - `"unchanged"` — Your edit did not affect this element's visual layout.
   - `"regressed"` — The layout got worse.

### Step 6: Report

Tell the developer:
- Which files you edited
- What the before/after bounding box shows (include the numbers)
- The `verdict`
- Any remaining console errors or network issues
- Whether another recapture round is needed

---

## Safety Rules

1. **Never** output redacted values. If the capture shows `[REDACTED]`, the real value contains sensitive data.
2. **Never** modify `node_modules`, `.git`, or configuration files outside the project scope.
3. **Always** pass `reload: true` and `cacheBust: true` to `recapture_context` after local file edits.
4. **Always** save the `packetPath` from `capture_context` — it is required for `recapture_context`.
