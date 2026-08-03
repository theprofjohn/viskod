# Agent Prompt: Design Review Using Viskod

Use this prompt template when an agent needs to perform a comprehensive design review of a UI element or page using Viskod's visual context.

---

## Instructions

You have access to the Viskod MCP server. Follow this structured design review process.

### Step 1: Capture the Full Page Context

```
capture_context(
  selector: "body",
  url: "<APPLICATION_URL>",
  profile: "design-review",
  projectPath: "<PROJECT_PATH>"
)
```

### Step 2: Run Design Audit (4 Domains)

Analyze the captured context against these domains. For each finding, assign a severity: **Critical** (blocks users), **Important** (degrades experience), **Nice-to-have** (polish).

#### A. Motion Gap Analysis

| Check | What to look for |
|-------|-----------------|
| Hover without transition | Any `:hover` visual change without a `transition` on the base selector |
| Conditional render without animation | Elements that appear/disappear without enter/exit animation |
| List without stagger | Repeated items (cards, rows) that appear simultaneously |
| Missing reduced-motion | Animated elements without `prefers-reduced-motion` handling |
| Animating layout properties | `transition` or `animation` on `width`, `height`, `top`, `left`, `margin`, `padding` |

**Motion rules (from motion-principles):**
- Hover feedback: 100-150ms ease-out
- UI transitions: 200-300ms ease-out
- Page transitions: 300-500ms ease-out
- Never animate layout properties — use `transform` + `opacity`
- Never use `transition: all` — specify properties
- Exit is always shorter/more subtle than enter

#### B. Accessibility Audit

| Check | WCAG Reference |
|-------|---------------|
| Missing `<label>` on form inputs | 1.3.1 Info and Relationships |
| No visible focus indicator | 2.4.7 Focus Visible |
| Color-only status indicators | 1.4.1 Use of Color |
| Missing `alt` text on informative images | 1.1.1 Non-text Content |
| Contrast ratio below 4.5:1 (normal text) | 1.4.3 Contrast (Minimum) |
| Contrast ratio below 3:1 (large text/UI) | 1.4.3 Contrast (Minimum) |
| Missing skip-to-content link | 2.4.1 Bypass Blocks |
| No `aria-live` for dynamic content updates | 4.1.3 Status Messages |
| Interactive elements not keyboard reachable | 2.1.1 Keyboard |

#### C. Performance Audit

| Check | Impact |
|-------|--------|
| Animating `width`/`height`/`top`/`left` | Layout thrashing, forced reflow |
| Animating `box-shadow` | Excessive paint |
| Using `setInterval` for animation | Jank, not synced to frame rate |
| Large DOM depth | Slow selector matching |
| Unbounded list rendering | Memory growth |

#### D. Consistency Audit

| Check | Target |
|-------|--------|
| Distinct duration values | 3-5 max per project |
| Easing consistency | Same interaction type = same easing |
| Enter/exit symmetry | Intentional asymmetry or symmetric |
| Color token usage | Semantic tokens, not raw hex |
| Spacing consistency | 8px grid adherence |

### Step 3: Generate Findings Report

For each finding:

```
### [Severity] — [Domain] — [Short description]

**Element:** `<tag> selector`
**Issue:** What's wrong
**Rule:** Which design principle or WCAG criterion
**Fix:** Specific CSS/code change needed
**Impact:** Who is affected and how
```

### Step 4: Prioritize Fixes

Group findings into:
1. **Fix now** — Critical + Important, low effort
2. **Fix soon** — Critical + Important, medium effort
3. **Backlog** — Nice-to-have or high effort

### Step 5: Apply Fixes (If Requested)

If the developer asks you to fix issues:
- Fix one domain at a time (accessibility first, then motion, then consistency)
- Re-capture after each domain to verify
- Use `recapture_context` with `reload: true, cacheBust: true`

---

## Severity Definitions

- **Critical:** Blocks users from completing tasks, legal compliance risk, data loss risk
- **Important:** Degrades experience for a significant user group, noticeable quality gap
- **Nice-to-have:** Polish item, affects aesthetics or micro-interaction quality

---

## Safety Rules

1. Never expose redacted values from capture output.
2. Never modify files outside the project scope.
3. Always save `packetPath` for recapture workflows.
4. Distinguish between design preferences (subjective) and design violations (objective).
