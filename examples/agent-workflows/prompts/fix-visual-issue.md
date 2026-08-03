# Agent Prompt: Fix a Visual Issue Using Viskod

Use this prompt template when an agent needs to diagnose, fix, and verify a visual UI issue using Viskod's MCP tools.

---

## Instructions

You have access to the Viskod MCP server. Core tools: `viskod_navigate`, `viskod_select_element`, `viskod_capture_context`; review tools: `create_visual_review`, `recapture_visual_review`, `get_visual_review`.

Follow these steps in order:

### Step 1: Capture the Current State

Make sure the browser is on the target page, then call `viskod_capture_context` to understand the element:

```
viskod_capture_context(
  selector: "<CSS_SELECTOR>"
)
```

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

- Make minimal, targeted edits.
- Do NOT modify files that are not related to the identified issue.
- Do NOT expose or log values that appear redacted in the capture output.
- If a value appears as `[REDACTED]` or `[TOKEN_REDACTED]`, treat it as sensitive — do not attempt to reconstruct or leak it.

**When editing animations, follow these rules:**
- Never animate `width`, `height`, `top`, `left` — use `transform` and `opacity` only.
- Never use `transition: all` — always specify properties.
- Hover feedback: 100-150ms ease-out.
- UI transitions (selection, state change): 200-300ms ease-out.
- Page-level transitions: 300-500ms ease-out.
- Exit is always more subtle than enter (shorter duration, opacity-only).
- Always provide `prefers-reduced-motion` fallback.

### Step 5: Re-Capture and Verify

Create a visual review from the captured issue, then re-capture after your edits:

```
create_visual_review(
  issueId: "<ISSUE_ID>"
)

recapture_visual_review(
  reviewId: "<REVIEW_ID>",
  reload: true,
  cacheBust: true
)
```

If the element's URL or visual selection changed, `viskod_navigate` to the target URL first so the recapture targets the correct page.

### Step 6: Read the Comparison

Call `get_visual_review` to retrieve the full comparison, then interpret it:

```
get_visual_review(
  reviewId: "<REVIEW_ID>"
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
