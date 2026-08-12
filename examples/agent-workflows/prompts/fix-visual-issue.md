# Agent Prompt: Fix a Visual Issue Using Viskod

Use this prompt template when an agent needs to diagnose, fix, and verify a visual UI issue using Viskod's MCP tools.

---

## Instructions

You have access to the Viskod MCP server. Core tools: `viskod_navigate`, `viskod_select_element`, `viskod_capture_context`; review tools: `create_visual_review`, `recapture_visual_review`, `get_visual_review`.

Follow these steps in order:

### Step 1: Capture the Current State

Choose one entry path:

- **Studio:** open the target app in Studio, choose `Report UI issue`, click the
  element, accept the selection, and complete the problem/expected-result
  description. Studio captures the selected element and prepares the issue
  context for handoff.
- **MCP:** navigate to the target page, select the element with
  `viskod_select_element`, then call `viskod_capture_context` with the selector
  returned by your own inspection. Do not use the Studio point-and-click
  sequence and do not invent a selector when the target is not stable.

For the MCP path, make sure the browser is on the target page before calling:

```
viskod_capture_context(
  selector: "<CSS_SELECTOR>"
)
```

Wait for the preceding tool call to return its real `issueId` or capture
reference; never invent an issue ID or review ID.

Inspect the response carefully:
- **`selection`**: Contains the selector, tag name, bounding box, and text of the captured element.
- **`styles`**: Computed styles of the element.
- **`screenshots`**: Screenshot metadata (capture ID, type, format, dimensions).
- **`confidence`** and the source hints inside it: Lists files ranked by confidence. Start with the highest-confidence existing file.
- **`evidenceSources`**: Note which subsystems produced evidence (console errors, network failures).

### Step 2: Inspect Source Hints

The capture response includes a ranked table of source hints:

```
| # | File | Confidence | Exists | Match Type |
|---|------|-----------|--------|------------|
| 1 | src/components/TargetCard.jsx | 85% | Yes | case-insensitive |
| 2 | src/components/TargetCard.css | 80% | Yes | style-adjacent |
```

- Start with the highest-confidence file that `Exists` shows as `Yes`.
- Read the file and identify what might be causing the issue.
- Use the bounding box and computed styles from the capture to guide your analysis.

### Step 3: Design Audit (Before Editing)

Before making changes, run a quick audit against these four domains:

**Motion Gaps:**
- Does the element have `:hover` without a corresponding `transition` on the base selector?
- Are there conditional renders without enter/exit animations?
- Are list items missing stagger animations?

**Accessibility:**
- Does every `:hover` have a `:focus-visible` equivalent?
- Is `prefers-reduced-motion` handled for all animations?
- Are interactive elements keyboard-reachable with visible focus?
- Do form inputs have associated `<label>` elements?
- Is color used as the only differentiator for status?

**Performance:**
- Are `width`, `height`, `top`, `left` being animated (layout thrashing)?
- Are there excessive repaints from animated properties?

**Consistency:**
- Are durations consistent (3-5 distinct values max per project)?
- Is easing consistent (same type of interaction = same easing)?
- Are enter and exit symmetric or intentionally asymmetric?

### Step 4: Edit Only Relevant Source Files

### Step 5: Re-Capture and Verify

Create a visual review from the issue ID returned by the preceding issue or
handoff tool call, then re-capture using the review ID returned by
`create_visual_review`:

```
create_visual_review(
  issueId: "<ISSUE_ID_RETURNED_BY_PREVIOUS_CALL>"
)

recapture_visual_review(
  reviewId: "<REVIEW_ID_RETURNED_BY_CREATE_VISUAL_REVIEW>",
  reload: true,
  cacheBust: true
)
```

Never substitute a guessed issue ID or review ID. If the element's URL or
visual selection changed, call `viskod_navigate` to the target URL first so the
recapture targets the correct page.


### Step 6: Read the Comparison

Call `get_visual_review` to retrieve the full comparison, then interpret it:

```
get_visual_review(
  reviewId: "<REVIEW_ID_RETURNED_BY_CREATE_VISUAL_REVIEW>"
)
```

1. **Check `comparison.summary`:** Human-readable status of the before/after comparison.
2. **Check `comparison.visual.boundingBoxDelta`:** Look at the height and width deltas. Did the layout change as intended?
3. **Check `comparison.visual.changedPixelRatio`:** How much of the element's pixels changed?
4. **Check `comparison.evidence.consoleDelta` / `networkDelta`:** Did console errors decrease? Did network issues improve?
5. **Check `comparison.status`:** `accepted` / `needs_follow_up` style signal of whether the change resolved the issue. If the comparison shows an unexpected delta, iterate: edit, `recapture_visual_review`, compare again.

### Step 7: Report

Tell the developer:
- Which files you edited
- What the before/after bounding box shows (include the numbers)
- The `comparison.summary` and `comparison.status`
- Any remaining console errors or network issues
- Whether another recapture round is needed
- Any design audit findings that were fixed or remain open

---

## Safety Rules

1. **Never** output redacted values. If the capture shows `[REDACTED]`, the real value contains sensitive data.
2. **Never** modify `node_modules`, `.git`, or configuration files outside the project scope.
3. **Always** pass `reload: true` and `cacheBust: true` to `recapture_visual_review` after local file edits.
4. **Always** reuse the `reviewId` from `create_visual_review` for `recapture_visual_review` and `get_visual_review`.
