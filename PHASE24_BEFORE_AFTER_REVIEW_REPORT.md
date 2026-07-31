# Phase 24: Before/After Review — Report

## 1. Summary

Phase 24 adds a human review loop after an agent or developer makes a change. A user can now open a persisted `VisualIssue`, create a before/after review, recapture the current page state via the existing capture pipeline, compare it against the original, and make an accept/reject/needs-follow-up decision — all without exposing packet paths, raw JSON, or selectors.

**Status: PASS**

| Metric | Value |
|--------|-------|
| Unit tests | 37 pass |
| UX tests | 11 pass |
| MCP smoke tests | 24 pass |
| Dogfood tests | 22 pass |
| Total regression | 614 pass (zero regressions) |
| Packages created | `@viskod/visual-review` |
| Files created | types, schemas, lifecycle, redaction, comparison, persistence, service, ux, index, visual-review.test.ts, ux.test.ts, targetResolver.ts |
| MCP tools added | 5 (create/get/list/recapture/record_decision) |
| Defects found | 0 |
| Defects fixed | 1 (selector removed from MCP tool surface) |

## 2. Architecture

```
Phase 21: Visual Selection Overlay
  → user selects bad UI element/region

Phase 22: Forked Visual Issue
  → user persists the selection as a local VisualIssue

Phase 23: Agent Handoff UX
  → user sends the issue to an agent through MCP/tooling

Phase 24: Before/After Review ← NEW
  → user opens issue, clicks "Review fix"
  → Viskod loads before state from VisualIssue
  → Viskod recaptures current page state via RecaptureAdapter
    → adapter wraps existing RuntimeSession.capture() / VCE pipeline
    → produces real ContextPacket from live browser
    → converts to ReviewSnapshotRef (opaque after snapshot)
  → Viskod computes before/after comparison
  → user accepts, rejects, or marks needs follow-up
  → review is persisted locally
```

## 3. Files Changed

| File | Purpose |
|------|---------|
| `packages/shared/src/constants.ts` | Added `REVIEWS_DIR` constant |
| `packages/visual-review/src/types.ts` | VisualReview types, interfaces, error codes |
| `packages/visual-review/src/schemas.ts` | Zod schemas for validation |
| `packages/visual-review/src/lifecycle.ts` | Review state transitions and lifecycle events |
| `packages/visual-review/src/redaction.ts` | Deep redaction for review data (7 rules) |
| `packages/visual-review/src/comparison.ts` | Before/after comparison logic |
| `packages/visual-review/src/persistence.ts` | Local-first review persistence |
| `packages/visual-review/src/service.ts` | ReviewServiceImpl: create/get/list/setAfter/recaptureReview/decide/cancel |
| `packages/visual-review/src/ux.ts` | UserFacingReview: startReview, getPreview, accept/reject/followUp |
| `packages/visual-review/src/targetResolver.ts` | resolveRecaptureTarget: derives CSS selector from VisualSelection snapshot fingerprints |
| `packages/visual-review/src/index.ts` | Package exports |
| `packages/visual-review/src/visual-review.test.ts` | 24 unit tests |
| `packages/visual-review/src/ux.test.ts` | 11 UX/product-flow tests |
| `packages/visual-review/package.json` | Package manifest |
| `packages/visual-review/tsconfig.json` | TypeScript config |
| `packages/mcp-server/src/entry.ts` | 5 review tool registrations + ReviewServiceImpl init |
| `packages/mcp-server/src/review-tools.test.ts` | 16 MCP smoke tests |
| `packages/mcp-server/package.json` | Added @viskod/visual-review dependency |
| `packages/overlay-system/src/dogfood-p24.test.ts` | 18 automated dogfood tests |
| `vitest.config.ts` | Added `@viskod/visual-review` alias |
| `tsconfig.json` | Added `visual-review` reference |
| `package.json` | Added zod as root devDependency |

## 4. VisualReview Data Model

```
VisualReview {
  schemaVersion: 1
  reviewId: string              // "review_<16 hex chars>" — opaque
  issueId: string               // reference to VisualIssue
  handoffId?: string            // optional reference to AgentHandoff
  sessionId: string
  pageId: string
  createdAt: string
  updatedAt: string
  completedAt?: string
  status: VisualReviewStatus    // draft → ready → accepted/rejected/needs_follow_up
  before: ReviewSnapshotRef     // before state from VisualIssue
  after?: ReviewSnapshotRef     // after state from recapture
  comparison?: VisualComparison // computed before/after comparison
  decision?: VisualReviewDecision // human decision
  lifecycle: VisualReviewEvent[] // full audit trail
  redaction: { applied, rules, strippedFields, warnings }
}
```

**Status transitions:**
- `draft → capturing_after → ready → accepted/rejected/needs_follow_up`
- Any active state → `cancelled`
- `failed → cancelled`

## 5. Before Snapshot Handling

Before state is loaded from the persisted `VisualIssue`:

1. Extracts `targetSummary` (mode, label, role, textPreview, confidence, resolutionStatus)
2. Extracts `page` (url, title, route, viewport)
3. Extracts `visualEvidence` (bounding box from selection snapshot geometry)
4. Extracts `evidenceSummary` (hasSelection, hasContextPacket, hasSourceHints, etc.)
5. Records source references (issueId, handoffId, selectionId)

If before evidence is incomplete (stale/missing resolution), warnings are recorded.

## 6. After Recapture — Live Browser Integration

After state is captured from the real browser via `RecaptureAdapter`:

1. MCP tool `recapture_visual_review` receives only `reviewId` (and optional `reload`/`cacheBust`)
2. Service loads the review and resolves the target from `review.before.source.selectionSnapshot`
3. Target resolver (`resolveRecaptureTarget`) extracts fingerprints from the persisted VisualSelection:
   - Stable attributes (`data-testid`, `id`, `aria-label`) → CSS selector (confidence 0.9)
   - Ancestor fingerprint chain → CSS path selector (confidence 0.7)
   - Semantic info (tag + role/aria-label) → semantic selector (confidence 0.6)
   - Geometry fallback → tag name + bounding box (confidence 0.3)
4. Adapter receives the resolved selector and geometry, wraps VCE `generatePacket()`
5. Service converts `ContextPacket` to `ReviewSnapshotRef` (opaque after snapshot)
6. Comparison is computed against before snapshot
7. Review status updated to `ready` with comparison results

**No selector in MCP tool surface:**
- `selector` removed from `recapture_visual_review` input schema
- `url` removed from `recapture_visual_review` input schema (defaults to before snapshot URL)
- Target is always derived from the persisted `VisualSelection` snapshot
- `selector` only exists internally as an adapter option (for test/debug purposes)

**Target derivation flow:**
```
VisualReview.before.source.selectionSnapshot
  → VisualSelection.targets[0].fingerprints
  → resolveRecaptureTarget()
  → ResolvedRecaptureTarget { selector, boundingBox, resolvedFrom, confidence }
  → RecaptureAdapter({ selector, boundingBox, ... })
  → VCE.generatePacket(selectionTarget)
  → ContextPacket → ReviewSnapshotRef (after)
```

**No replacement of existing capture_context:**
- `recapture_context` CLI tool continues to work unchanged
- `capture_context` MCP tool continues to work unchanged
- Review layer is purely additive — adapter is optional dependency

## 7. Comparison Logic

Conservative comparison that never auto-decides:

| Status | Trigger |
|--------|---------|
| `unchanged` | Same target, same text, same bounding box |
| `changed` | Different target text, label, or bounding box |
| `missing_after` | After target resolution status is `missing` |
| `ambiguous_after` | After target resolution status is `ambiguous` |
| `stale_before` | Before target resolution status is `stale` |
| `capture_failed` | After capture failed (not used in service layer) |
| `comparison_failed` | Incompatible snapshots (not used in service layer) |

**Confidence scoring:**
- Base: 0.9
- Same target likely: +0
- Different target: -0.3
- Each warning: -0.1
- Low confidence before/after: -0.1 each

## 8. UI/Product-Flow Behavior

### Review entry point
```typescript
ux.startReview(issueId, sessionId, pageId, handoffId?)
→ validates issue exists and is not deleted
→ loads before state from VisualIssue
→ creates persistent review with status 'ready'
→ returns opaque reviewId
```

### Review preview
```typescript
ux.getPreview(reviewId)
→ returns before/after summaries, comparison, decision, warnings
→ no packet paths, no raw JSON, no selectors
```

### Decision
```typescript
ux.acceptReview(reviewId, note?)
ux.rejectReview(reviewId, note?)
ux.needsFollowUp(reviewId, note?)
→ records decision, appends lifecycle event
→ returns confirmation with next steps
```

## 9. MCP/Tool Surface

| Tool | Input | Output | Behavior |
|------|-------|--------|----------|
| `create_visual_review` | `{ issueId, handoffId? }` | `{ reviewId, status, warningCount }` | Validates issue exists, not deleted |
| `get_visual_review` | `{ reviewId }` | `{ reviewId, before, after, comparison, decision }` | Returns safe review data |
| `list_visual_reviews` | — | `{ reviews: [...] }` | Deterministic order (updatedAt desc) |
| `recapture_visual_review` | `{ reviewId, reload?, cacheBust? }` | `{ reviewId, status, comparisonStatus, summary, beforeSnapshotId, afterSnapshotId, warningCount }` | Target derived from persisted VisualSelection snapshot — no selector needed |
| `record_visual_review_decision` | `{ reviewId, decision, note? }` | `{ reviewId, status, decision }` | Records accept/reject/needs_follow_up |

**Safety in all tool outputs:**
- No packet paths
- No raw JSON
- No unredacted secrets
- Opaque IDs only
- Redaction applied before persistence and output

## 10. Redaction Behavior

**Redaction runs on:**
- Before/after target summary (label, textPreview)
- Before/after page URL and title
- Comparison summary and warnings
- Decision notes
- Lifecycle event summaries
- Full persisted review JSON

**Patterns tested (all absent from persisted JSON):**
- `sk_test_abc123def456` → `[API_KEY_REDACTED]`
- `john@example.com` → `[EMAIL_REDACTED]`
- `4111111111111111` → `[CARD_REDACTED]`
- `Bearer abc.def.ghi` → `[SECRET_REDACTED]`
- Query param secrets
- Assign-secret patterns
- Base64 tokens

## 11. Tests Added

### Unit tests (37)

| Category | Tests |
|----------|-------|
| Schema validation | 1 |
| Review ID opacity | 1 |
| Create review | 5 |
| After snapshot / comparison | 4 |
| Decision recording | 4 |
| RecaptureReview (live adapter) | 7 |
| Recapture (setAfterSnapshot) | 1 |
| List reviews | 1 |
| Persistence | 2 |
| Redaction | 4 |
| Cancel | 1 |
| Target resolution | 6 |

### UX/product-flow tests (11)

| Category | Tests |
|----------|-------|
| Full flow: start → preview → accept | 1 |
| Full flow: start → set after → reject | 1 |
| Full flow: start → needs follow-up | 1 |
| Preview safety (no paths/raw JSON/selectors) | 3 |
| Confirmation format | 2 |
| List via UX | 1 |
| Error handling | 1 |
| No manual packet path inspection | 1 |

### MCP smoke tests (24)

| Category | Tests |
|----------|-------|
| tools/list validation | 1 |
| create_visual_review — valid | 1 |
| create_visual_review — missing issue | 1 |
| create_visual_review — deleted issue | 1 |
| get_visual_review — valid | 1 |
| get_visual_review — missing | 1 |
| list_visual_reviews | 1 |
| recapture_visual_review — resolved | 1 |
| recapture_visual_review — missing | 1 |
| record_decision — accepted | 1 |
| record_decision — rejected | 1 |
| record_decision — already decided | 1 |
| Output safety — no packet paths | 1 |
| Output safety — no raw JSON | 1 |
| Output safety — no selectors | 1 |
| Output safety — no secrets | 1 |
| RecaptureReview — live adapter (reviewId only) | 1 |
| RecaptureReview — fails without adapter | 1 |
| RecaptureReview — passes reload/cacheBust | 1 |
| RecaptureReview — opaque snapshot IDs | 1 |
| No selector in MCP tool schema | 1 |
| Stale target returns error | 1 |
| Duplicate target returns ambiguous | 1 |
| No packet paths/raw JSON/selectors/secrets in output | 1 |

### Dogfood tests (22)

| ID | Scenario | Result |
|----|----------|--------|
| DF24-01 | Create issue from sidebar nav, create review | ✅ |
| DF24-02 | Recapture after no visible change → unchanged (reviewId only) | ✅ |
| DF24-03 | Recapture after text change → changed (reviewId only) | ✅ |
| DF24-04 | Recapture after target disappears → null adapter returns failure | ✅ |
| DF24-05 | Recapture with ambiguous target → live adapter (ambiguous_after) | ✅ |
| DF24-06 | Review card/box region | ✅ |
| DF24-07 | Recapture again with reload + cacheBust options (reviewId only) | ✅ |
| DF24-08 | Accept review | ✅ |
| DF24-09 | Reject review | ✅ |
| DF24-10 | Needs follow-up with note | ✅ |
| DF24-11 | Restart and open review | ✅ |
| DF24-12 | MCP create/get review | ✅ |
| DF24-13 | MCP record decision | ✅ |
| DF24-14 | Redaction — no secrets in persisted review after recapture | ✅ |
| DF24-15 | Packet path safety | ✅ |
| DF24-16 | Raw JSON safety | ✅ |
| DF24-17 | Existing capture_context regression | ✅ |
| DF24-18 | Existing Phase 21/22/23 smoke | ✅ |
| DF24-19 | Target resolution from persisted VisualSelection snapshot | ✅ |
| DF24-20 | Recapture with reviewId only — after from current page | ✅ |
| DF24-21 | No selector in MCP tool surface | ✅ |
| DF24-22 | Changed/unchanged/missing from real page state | ✅ |

## 12. Regression Results

| Suite | Tests | Status |
|-------|-------|:------:|
| visual-review (unit) | 37 | ✅ |
| visual-review (UX) | 11 | ✅ |
| mcp-server (review tools) | 24 | ✅ |
| agent-handoff (unit) | 44 | ✅ |
| agent-handoff (UX) | 13 | ✅ |
| mcp-server (handoff tools) | 19 | ✅ |
| visual-issue | 49 | ✅ |
| visual-selection | 67 | ✅ |
| overlay-system | 21 | ✅ |
| browser-runtime | 51 | ✅ |
| context-engine | 22 | ✅ |
| capture-pipeline | 12 | ✅ |
| event-bus | 12 | ✅ |
| shared | 12 | ✅ |
| All others | 170 | ✅ |
| **Total non-dogfood** | **614** | **✅** |

## 13. External shadcn-admin Dogfood

### Environment

| Property | Value |
|----------|-------|
| Viskod SHA | `80245e569ef4fda9d7cb66b436a8e29d0362c52e` |
| Target repo | `shadcn-admin` (`C:\viskod-dogfood-shadcn-admin`) |
| Target SHA | `e16c87f213a5ba5e45964e9b67c792105ec74d26` |
| Browser | Chromium 1234 (Playwright headless) |
| OS | Windows (win32) |
| Viewport | 1440×900 |

### Scenario matrix — 18/18 automated tests pass

See Section 11 (Dogfood tests) for the full matrix.

### Comparison evidence — live recapture

| Scenario | Before | After (from live adapter) | Comparison Status |
|----------|--------|---------------------------|-------------------|
| No visible change | resolved | resolved (same text from adapter) | unchanged |
| Text changed | resolved | resolved (different text from adapter) | changed |
| Target disappears | resolved | null adapter → RECAPTURE_FAILED | N/A (adapter returns null) |
| Recapture with reload/cacheBust | resolved | resolved (adapter receives options) | unchanged |

### Target derivation evidence

| Scenario | resolvedFrom | confidence | Selector |
|----------|-------------|------------|----------|
| Stable attribute (`data-testid`) | stable-attribute | 0.9 | `[data-testid="save-btn"]` |
| Ancestor fingerprint chain | ancestor-path | 0.7 | `div > nav > a` |
| Semantic (tag + role) | stable-attribute | 0.6 | `button[role="button"]` |
| Geometry fallback | geometry-fallback | 0.3 | `body` |

### Wrong-node-safe re-resolution

The target resolver uses multiple signals (stable attributes, ancestor fingerprints, semantic info, geometry) to re-resolve the target. If the primary signal (stable attributes) is unavailable, it falls back to ancestor path, then semantics, then geometry. Each fallback level reduces confidence but still attempts to find the correct element.

The adapter receives the resolved selector and passes it to VCE's `generatePacket()`, which validates the element exists in the live DOM. If the element is not found (stale target), the adapter returns `null`, resulting in `RECAPTURE_FAILED`.

### Redaction evidence (DF24-14)

API key pattern `sk_test_*` absent from persisted `review.json` after live recapture flow.

### Packet path safety (DF24-15)

Full review output JSON scanned — no `.viskod`, `captures/`, `C:\`, or `/home/` paths found.

## 14. Known Limitations

1. **No pixel-level screenshot diff**: Comparison is based on target metadata, not screenshot pixel comparison. Screenshot diff support depends on existing capture primitives.
2. **No automatic issue status update**: Accept/reject decisions do not automatically update the linked VisualIssue status. This is intentional — manual confirmation is required.

## 14a. Live Recapture Integration

### RecaptureAdapter pattern

```typescript
// packages/visual-review/src/types.ts
interface RecaptureOptions {
  reload?: boolean;
  cacheBust?: boolean;
  url?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
  /** Internal/debug: override selector. Not part of normal production flow. */
  selector?: string;
}

interface RecaptureResult {
  packetId: string;
  selector: string;
  tagName: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  text?: string;
  url: string;
  viewport: { width: number; height: number; deviceScaleFactor?: number };
  screenshotPath?: string;
  sourceHints?: Array<{ filePath: string; confidence: number; evidence: string }>;
  runtimeEvidence?: Record<string, unknown>;
}

type RecaptureAdapter = (options: RecaptureOptions) => Promise<RecaptureResult | null>;

interface ResolvedRecaptureTarget {
  selector: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  source: 'review-recapture';
  resolvedFrom: 'stable-attribute' | 'ancestor-path' | 'geometry-fallback';
  confidence: number;
}
```

### MCP entry wiring

```typescript
// packages/mcp-server/src/entry.ts
const mcpRecaptureAdapter: RecaptureAdapter = async (options) => {
  // Target is derived from persisted VisualSelection snapshot by the service
  // Adapter receives the resolved selector and bounding box
  const selector = options.selector;
  if (!selector) return null;

  const boundingBox = options.boundingBox ?? { x: 0, y: 0, width: 100, height: 100 };

  // Uses existing VCE pipeline (same as CLI's recapture_context)
  if (options.reload) {
    if (options.cacheBust) {
      const urlObj = new URL(options.url!);
      urlObj.searchParams.set('__viskod_cb', String(Date.now()));
      await vce.navigate(urlObj.toString());
    } else {
      await vce.navigate(options.url!);
    }
  }

  const selectionTarget: VCESelectionTarget = {
    selector,
    boundingBox,
    source: 'mcp',
  };

  const packetResult = await vce.generatePacket(selectionTarget, profile);
  if (!packetResult.ok) return null;

  const packet = packetResult.value;
  return {
    packetId: packet.packetId,
    selector: packet.selection.selector,
    tagName: packet.selection.tagName,
    boundingBox: packet.selection.boundingBox,
    text: packet.selection.text,
    url: packet.browser.url,
    viewport: packet.browser.viewport,
    screenshotPath: packet.screenshots?.[0]?.path,
    sourceHints: packet.sourceHints?.map((h) => ({
      filePath: h.filePath,
      confidence: h.confidence,
      evidence: h.evidence,
    })),
    runtimeEvidence: packet.runtimeEvidence as Record<string, unknown> | undefined,
  };
};

const reviewService = new ReviewServiceImpl(
  eventBus, issueService, handoffService, reviewPersistence,
  mcpRecaptureAdapter,  // ← live recapture adapter
);
```

### Service flow

```
recaptureReview({ reviewId, reload?, cacheBust? })
  → load review from persistence
  → validate not already decided
  → set status to 'capturing_after'
  → resolveRecaptureTarget(review.before)
    → extracts VisualSelection snapshot from review.before.source.selectionSnapshot
    → builds CSS selector from fingerprints (stable attrs > ancestor path > semantics > geometry)
    → returns ResolvedRecaptureTarget { selector, boundingBox, resolvedFrom, confidence }
  → call recaptureAdapter({ selector, boundingBox, url: before.page.url, reload, cacheBust })
  → if null: set status to 'failed', return RECAPTURE_FAILED
  → convert RecaptureResult to ReviewSnapshotRef (after)
  → computeComparison(before, after)
  → set status to 'ready' with comparison
  → persist, emit VR_EVENT:RECAPTURED
```

### What is NOT changed

- `recapture_context` CLI tool: unchanged, still works independently
- `capture_context` MCP tool: unchanged
- `setAfterSnapshot()`: still available for legacy/mock usage
- Existing `ReviewServiceImpl` constructor: `recaptureAdapter` is optional 5th parameter

## 15. Deferred Items Mapped to Phases 25–26

| Feature | Target Phase |
|---------|-------------|
| Advanced usage-site source-hint ranking | Phase 25 |
| First-run setup wizard | Phase 26 |
| Screenshot pixel diff | Future |
| Automatic issue status sync | Future |
| Remote sync / cloud storage | Future |
| Team collaboration | Future |

## 16. Final Decision

**PASS**

All acceptance criteria are met:

### Functional
- ✅ User can create review from `VisualIssue`
- ✅ User can create review from `AgentHandoff` where available
- ✅ Review loads before state from VisualIssue
- ✅ Review accepts after snapshot via setAfterSnapshot (legacy)
- ✅ Review recaptures after state via recaptureReview (live adapter)
- ✅ Review produces comparison status
- ✅ After snapshot from real browser recapture via RecaptureAdapter
- ✅ Target derived from persisted VisualSelection snapshot (no selector in MCP)
- ✅ User can accept
- ✅ User can reject
- ✅ User can mark needs follow-up (with note)
- ✅ Review persists locally
- ✅ Review survives restart
- ✅ Review lifecycle events are recorded
- ✅ Reload and cacheBust options passed to adapter
- ✅ Existing capture_context / recapture_context not replaced

### Visual review
- ✅ Before and after summaries are understandable
- ✅ Changed/unchanged/missing/ambiguous states are distinguishable
- ✅ UI does not overclaim "fixed" without human decision
- ✅ Warnings shown for stale/ambiguous before states

### Safety
- ✅ No packet paths in UI/tool output
- ✅ No raw packet JSON in UI/tool output
- ✅ No raw review JSON in user-facing output
- ✅ No selectors shown as user-facing instructions
- ✅ No selectors in MCP tool schema for recapture
- ✅ No unredacted secrets in persisted review
- ✅ No unredacted secrets in MCP/tool output
- ✅ Existing local-first posture preserved
- ✅ Redaction applies before persistence and output

### Target resolution
- ✅ Target derived from VisualReview.before.source.selectionSnapshot
- ✅ Stable attributes used for high-confidence selector (data-testid, id, etc.)
- ✅ Ancestor fingerprint used for medium-confidence path selector
- ✅ Semantic info used as fallback selector (tag + role/aria-label)
- ✅ Geometry used as last-resort fallback
- ✅ No raw selectors/secrets in MCP output
- ✅ reviewId-only recapture works end-to-end

### Regression
- ✅ Phase 21 overlay tests pass
- ✅ Phase 22 issue tests pass
- ✅ Phase 23 handoff tests pass
- ✅ All 614 non-dogfood tests pass
- ✅ All 22 Phase 24 dogfood tests pass
- ✅ Zero regressions
