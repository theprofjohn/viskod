# PHASE 28 — Studio Core Workflow Closure — Report

Date: 2026-08-15
Phase: 28
Status: PASS

## 1. Executive summary

Phase 28 closed the real Studio user journey: **visual selection → accept
target → describe issue → prepare agent handoff → handoff ready** now works
through the actual rendered UI in a real browser, backed by one coordinated
workflow operation with service-level idempotency.

- VISKOD-AUDIT-001 **confirmed and fixed**: "Prepare agent handoff" only
  created an issue; the handoff required an undocumented second API call.
- VISKOD-AUDIT-013 **confirmed and fixed**: selection overlay stayed active
  after acceptance and used overlapping `setInterval(async …)` polling.
- VISKOD-AUDIT-014 **confirmed and fixed**: no recovery controls existed
  ("select again" text without an action); stale transient state could leak.
- VISKOD-AUDIT-015 **confirmed and fixed**: invalid selectors produced
  successful packets with a fabricated `tagName: "unknown"` core target.
- VISKOD-AUDIT-020 **confirmed and fixed**: E2E bypassed the UI with direct
  POSTs; a real browser-driven Studio journey test was added.
- Duplicate issue creation from repeated/retried submission **fixed** at the
  workflow boundary (in-flight promise merge + issue reuse + post-success
  no-op), not merely by disabling the button.

Phase 27 security/lifecycle baseline remained green (origin allowlist,
loopback binding, WS origin checks, EADDRINUSE control, idempotent shutdown,
self-contained E2E process ownership, release gate).

## 2. Findings confirmed / not reproducible

| Finding | Result | Evidence |
|---|---|---|
| VISKOD-AUDIT-001 — button does not prepare handoff | **Confirmed** | `ui.ts` submitted the form to `/workflow/issue` → `workflow.createIssue()` only; `prepareAgent()` was never reachable from the UI. |
| VISKOD-AUDIT-013 — overlay active + overlapping polls | **Confirmed** | `SelectionOverlayController.startPolling()` used `setInterval(async () => …)`; `acceptSelection()` never exited selection mode. |
| VISKOD-AUDIT-014 — missing recovery controls, stale state | **Confirmed** | UI rendered recovery *text* only; no Cancel/Reselect/Retry actions; `reset()` failed to clear `reviewId`. |
| VISKOD-AUDIT-015 — invalid targets → "unknown" packets | **Confirmed** | `generatePacket()` fabricated `domData = domSnapshot ?? {tagName:'unknown', …}`; `SelectionEngine.buildHierarchy` stubbed `data-selector` snapshots. |
| VISKOD-AUDIT-020 — E2E bypasses UI | **Confirmed** | `tests/e2e/studio-flow.test.ts` drove every workflow action via direct POSTs. |
| Duplicate issues on repeat submit | **Confirmed** | Each `/workflow/issue` POST created a new issue unconditionally. |

No finding was un-reproducible.

## 3. Workflow state machine before / after

Before (two-step, invisible second step):

```
idle → selecting → describe → [createIssue] → describe(issueId) → [handoff POST] → handoff_ready
                                     ↑ button only reached here; handoff required a separate
                                       undocumented POST that the UI never sent.
```

After (single rendered action + recovery transitions):

```
idle ──report-start──→ selecting ──accept──→ describe ──prepare──→ handoff_ready → verifying → review_ready → decided
 │                       │  ↑                  │   ↑  │                                                          │
 │  cancel (selecting)    │  └──reselect───────┘   │  └── retry (prepare again, reuses issue)                  │
 └────────────────────────┘                        └───── cancel → idle (persisted issue, if any, is kept)     └─ report-start (fresh report, stale state cleared)
```

Transitions are explicit; failed transitions retain stage and expose
actionable recovery text.

## 4. Root cause of VISKOD-AUDIT-001

The rendered button (label "Prepare agent handoff") was wired to the
*create-issue* action only: `ui.ts` submitted the describe form to
`/workflow/issue`, whose handler called `workflow.createIssue()` and stayed at
`describe`. `StudioWorkflow.prepareAgent()` existed but had no UI path — the
`/workflow/handoff` endpoint was the undocumented second API action. The UI
promised a handoff and delivered only an issue.

## 5. Final create-issue → prepare-handoff orchestration

New workflow operation `StudioWorkflow.prepareAgentHandoffFromDescription(input)`
(`apps/studio/src/workflow.ts`), exposed at `POST /workflow/prepare`:

1. validate description (problem + expected non-empty) and stage (`describe` + active selection);
2. create the issue **only if no issue exists for this report** (`IssueService.createIssue`);
3. prepare the handoff for that issue (`UserFacingHandoff.sendToAgent`);
4. fetch the handoff preview and transition to `handoff_ready` with `handoffId`.

The browser UI calls only this one action. `createIssue`/`prepareAgent` are
retained as lower-level operations for API-level tests; they are not exposed
as the primary UI path. No IssueService/HandoffService logic was duplicated
in the browser.

## 6. Duplicate / idempotency behavior

Protection lives at the workflow boundary (not button disabling):

- **In-flight merge**: concurrent submissions share one
  `this.preparing` promise → one issue, one handoff.
- **Issue reuse**: `issueId` is stored in workflow state; a retry after
  handoff failure re-creates the issue only if no issue exists.
- **Post-success no-op**: if `handoffId` exists, repeated submit returns the
  existing handoff-ready state without creating anything.
- **Epoch guard**: every transient reset bumps a generation counter; a
  submission that completes after a reset/replacement cannot commit stale
  state to the new workflow.
- **UI protection (UX only)**: submit disabled + "Preparing…" while in
  flight; re-enabled on failure; description preserved across re-renders.

Regression coverage: unit tests for concurrent double submit, repeated HTTP
submission after success, and failure→retry; E2E test fires two synchronous
clicks plus one concurrent HTTP request and asserts exactly one persisted
issue and one persisted handoff.

## 7. Partial-failure and retry behavior

- **Issue created, handoff failed**: issue ID stays in workflow state, stage
  remains `describe`, an actionable error is shown
  ("The handoff could not be prepared. … Try again."), the entered
  description is preserved in the UI, and retry reuses the same issue. No
  false transition to `handoff_ready`.
- **Issue creation failed**: no handoff is attempted; stage remains
  `describe` with an actionable error.
- No destructive rollback; no deletion of a successfully persisted issue
  (resumability over rollback — no safe transaction primitive exists).

## 8. Selection-overlay lifecycle before / after

Before: `acceptSelection()` read the selection but never exited selection
mode; the overlay kept intercepting the page and polling continued.

After: `acceptSelection()` calls `controller.exitSelectionMode()` before
committing the accepted state. Exit stops polling (generation bump +
timer clear), posts `overlay:hide` (overlay script sets mode `hidden`,
removing click interception and selection visuals), and exits the service
selection session. The accepted selection is frozen in workflow state;
later overlay/page events cannot replace it. Re-entering selection mode
(Reselect / new report) still works.

## 9. Poll serialization implementation

`SelectionOverlayController` (`packages/visual-selection/src/integration.ts`)
replaced `setInterval(async …)` with a serialized loop:

- `scheduleNextPoll()` schedules a 100 ms timeout only when active;
- `pollOnce()` awaits `pollOverlayEvent()` and `handleOverlayEvent()` fully,
  then schedules the next poll — executions can never overlap;
- exit bumps `generation` and clears the timer; a poll already in flight
  re-checks the generation before handling events and before scheduling;
- `handleOverlayEvent` re-checks `active`/generation after every await, so a
  late completion cannot mutate selection state after exit;
- restarting selection mode resumes the loop.

Tests: fake-timer unit tests assert no overlapping executions (max in-flight
= 1), late completion after exit does not create a selection, and
re-entering resumes polling.

## 10. Recovery controls and semantics

Rendered controls:

- **Cancel** (selecting + describe): exits selection mode, clears transient
  workflow state, returns to `idle`. If handoff preparation partially
  succeeded, the persisted issue is intentionally NOT deleted (documented in
  Decision 042 / code comment); only the active workflow is reset.
- **Reselect** (describe): exits selection mode, clears the obsolete
  selection/capture/issue/handoff state, re-enters selection mode; the new
  selection replaces the old deterministically; description text is
  preserved by the client across the round trip.
- **Retry handoff**: after a handoff failure the describe form is re-enabled
  with the description intact; re-submitting reuses the persisted issue.
- New-report flow from `idle`/`decided` clears all transient state.

## 11. New-report state reset behavior

`beginReport()`, `reselect()`, `cancel()`, and `reset()` share one transient
reset boundary (`clearTransientState()`): active selection, captured packet,
issue/handoff/review IDs, review preview, transient errors, and the in-flight
submission are cleared; persisted domain entities are untouched. `reset()`
now also clears `reviewId` (previously leaked). E2E proves: report A → cancel
→ report B → the selecting screen shows no stale target and the resulting
issue references B only.

## 12. Invalid-target validation contract

Core targets are validated against the live DOM before any capture work:

- `BrowserRuntime.resolveSelector()` (new) classifies
  `malformed | missing | detached | ambiguous | resolved` with real
  `querySelectorAll` counts; Viskod overlay elements are excluded.
- `VisualContextEngine.generatePacket(selection)` fails closed with typed
  errors (`SELECTOR_MALFORMED`, `SELECTOR_NO_MATCH`, `SELECTOR_DETACHED`,
  `SELECTOR_AMBIGUOUS`) and no evidence collection when the core target does
  not resolve; the `"unknown"` fabrication is removed for selection captures
  (kept only for selection-less whole-page captures, which have no target).
- `SelectionEngine.validateSelection` with a browser handle fails closed
  (stub snapshots removed for the browser-backed path).
- CLI no longer prints "Element resolved" before browser-backed resolution:
  the claim is made only after a successful capture.
- "Element resolved" is never reported for a selector the browser did not
  resolve.

VALID TARGET + OPTIONAL EVIDENCE FAILURE remains a partial-capture concern
(unchanged contract, Phase 29 scope).

## 13. Selector ambiguity behavior

A selector matching multiple elements is resolved only when the provided
bounding box disambiguates it (exactly one match whose rect contains the box
center); otherwise it returns `SELECTOR_AMBIGUOUS` instead of silently
picking the first match. Overlay-generated selectors (unique by
construction) and E2E fixture selectors resolve deterministically and are
unaffected. Covered by unit tests (VCE fake) and a real-DOM E2E assertion
(`div` → ambiguous, `.no-such-element` → missing, `div[` → malformed).

## 14. Real rendered-UI E2E proof

`tests/e2e/studio-ui.test.ts` (new, mandatory): drives the actual rendered
Studio UI in real Playwright Chromium from clean state.

1. fixture + Studio started from clean state (`.viskod/issues`,
   `.viskod/handoffs` cleared);
2. Studio opened in a real browser;
3. fixture opened through the UI (`#app-url` form → `/navigate`);
4. "Report UI issue" clicked → `selecting`;
5. target selected through the overlay event path (fixture dispatches the
   same `overlay:element-clicked` a real overlay click produces);
6. "Continue" clicked → `describe`;
7. description typed into the rendered form;
8. actual "Prepare agent handoff" control clicked;
9. handoff-ready UI observed with `Handoff ID:` rendered;
10. exactly one persisted issue verified on disk;
11. exactly one corresponding handoff verified on disk;
12. handoff references the intended issue/target (`issueId` link + selected
    target label);
13. overlay interaction stopped: after acceptance the fixture posts one more
    overlay event for a different element; the workflow selection stays
    stable for a bounded observation window.

All 5 journey/recovery E2E tests pass (see §15). The existing
`studio-flow.test.ts` API-level journey was retained as lower-level coverage.

## 15. Recovery / reselect / duplicate E2E proof

- **A. Reselect**: select A → describe → Reselect → select B → prepare →
  persisted issue's selection snapshot references B
  (`#phase12-source-submit-button`) and not A.
- **B. Duplicate protection**: two synchronous UI clicks + one concurrent
  HTTP `/workflow/prepare` request → exactly one persisted issue, one
  handoff, one handoff-ready UI state.
- **C. New report isolation**: report A → Cancel → new report → selecting
  screen renders no stale target summary; new issue references B only.
- **D. Handoff failure/retry**: covered at the workflow unit level
  (`FakeHandoffService.fail = true` → issue preserved → retry succeeds with
  the same `issueId`, one issue total), since the Studio composition has no
  DI seam to inject a transient service failure at the HTTP layer.
- Invalid/missing/ambiguous selectors fail closed against the live DOM.

## 16. Files changed

Implementation:

- `apps/studio/src/workflow.ts` — coordinated `prepareAgentHandoffFromDescription`, reselect/cancel, accept exits selection mode, transient reset boundary, epoch guard, in-flight merge.
- `apps/studio/src/index.ts` — `POST /workflow/prepare|reselect|cancel` routes + handlers (same origin/Zod boundary).
- `apps/studio/src/ui.ts` — rendered Reselect/Cancel controls, `prepare-handoff` action, pending state, description preservation.
- `packages/visual-selection/src/integration.ts` — serialized polling, generation guards, handleOverlayEvent staleness checks.
- `packages/browser-runtime/src/index.ts` — `resolveSelector()`; `getDOMSnapshot`/`getElementHierarchy` now fail on missing elements instead of returning `ok(null)`.
- `packages/context-engine/src/index.ts` — fail-closed core-target gate; no "unknown" fabrication for selection captures.
- `packages/selection-engine/src/index.ts` — browser-backed fail-closed validation; stub only without a browser.
- `packages/cli/src/index.ts` — "Element resolved" printed only after successful browser-backed capture.
- `examples/phase12-source-hint-app/src/main.js` — multi-target simulation, per-session dispatch, post-accept event, `viskodReset`.

Tests:

- `apps/studio/src/workflow.test.ts` — 11 new Phase 28 tests (prepare action, idempotency, failure/retry, reselect, cancel, reset hygiene).
- `apps/studio/src/ui.test.ts` — recovery controls + prepare action assertions.
- `apps/studio/src/studio.test.ts` — new route coverage + served-UI assertions.
- `packages/context-engine/src/context-engine.test.ts` — 6 fail-closed validation tests.
- `packages/browser-runtime/src/browser-runtime.test.ts` — resolveSelector invalid-handle test.
- `packages/visual-selection/src/integration.test.ts` — new file: 4 polling serialization tests.
- `tests/e2e/studio-ui.test.ts` — new file: 5 real-browser journey/recovery tests.

Docs: `MEMORY.md` — Decisions 042 (single prepare action + idempotency) and 043 (fail-closed target validation).

## 17. Tests added/changed

Added: 11 workflow unit tests, 4 overlay-polling unit tests, 6 VCE fail-closed tests, 1 browser-runtime test, 3 Studio route/UI tests, 5 real-UI E2E tests (≈30 new assertions beyond existing coverage). Existing tests updated only where interfaces grew (`SelectionController.exitSelectionMode` in the test fake) or where behavior intentionally changed (no assertion relaxed).

## 18. Exact validation commands / results

| Command | Result |
|---|---|
| `pnpm typecheck` | PASS (0 errors) |
| `pnpm test:ci` | PASS — 41 files, 784 tests |
| `pnpm test:e2e` | PASS — 3 files, 15 tests (5 new studio-ui + 4 studio-flow + 6 chat-workflow) |
| `pnpm test:dogfood` | PASS — 7 files, 126 tests |
| `pnpm smoke:agent-workflow` | PASS — 26/26 |
| `pnpm build:cli && node scripts/verify-cli-artifact.mjs` | PASS — bundle + artifact verified |
| `pnpm release:check` | PASS (see §19) |

Each new Phase 28 test file was also run independently:
`vitest run apps/studio/src/workflow.test.ts` (32/32),
`vitest run packages/visual-selection/src/integration.test.ts` (4/4),
`vitest run --config vitest.e2e.config.ts tests/e2e/studio-ui.test.ts` (5/5).

## 19. Regression results

- Phase 27 security boundary tests (origin allowlist, WS origin checks,
  loopback-only binding, EADDRINUSE control, idempotent shutdown) — PASS.
- Full `pnpm release:check` — PASS.
- After E2E: ports 3000/3001 verified free; no orphan Playwright Chromium
  process remained (one leaked fixture process from a debug reproduction was
  killed and confirmed released).

## 20. Known limitations

- The browser journey's "selection" flows through the product's overlay
  event path (fixture dispatches the same `overlay:element-clicked` message
  a real overlay click emits) because the app page lives inside Studio's own
  browser; the rendered Studio controls themselves are clicked for real.
- Handoff failure/retry (scenario D) is covered at the workflow unit layer;
  the Studio class has no DI seam for a transient service failure at the
  HTTP layer.
- ~~Ambiguity disambiguation with a default `{0,0,100,100}` bounding box
  (CLI/MCP bare selectors) is geometry-based; selectors whose matches all
  avoid the box center are ambiguous, otherwise the single containing match
  wins.~~ **Resolved in Phase 28A** — synthetic/default geometry no longer
  exists on bare-selector paths; see §23.
- ~~After geometry-disambiguated multi-match resolution, evidence collection
  (DOM snapshot, hierarchy, styles) still targets `querySelector`'s first
  match rather than the specific disambiguated candidate. Out of Phase 28A
  scope (does not affect which element is selected as resolved).~~
  **Resolved in Phase 28B** — resolution returns the actual resolved element
  and every target-scoped evidence collector operates on that exact element;
  see §24.

## 21. Deferred Phase 29+ findings

- Partial-capture semantics for VALID TARGET + OPTIONAL EVIDENCE FAILURE.
- Persisted compact agent context retrieval / AgentHandoff packet redesign.
- Packet-level DOM/screenshot redaction architecture.
- Studio SourceHintEngine integration and confidence calibration.
- Issue-history desk, fork semantics, keyboard target traversal.

## 22. Final PASS / PARTIAL / FAIL

**PASS**

Verified against every PASS criterion:

- [x] clicking the actual rendered "Prepare agent handoff" action reaches `handoff_ready` (E2E journey);
- [x] exactly one issue per logical submission (unit + E2E);
- [x] handoff failure retried without creating another issue (unit);
- [x] duplicate/rapid submits do not duplicate domain entities (unit + E2E);
- [x] selection overlay exited/frozen after acceptance (workflow unit + E2E stability window);
- [x] polling cannot overlap or mutate accepted state after exit (fake-timer unit tests);
- [x] Reselect works (unit + E2E);
- [x] stale selection does not leak into another report (unit + E2E);
- [x] invalid/missing core targets fail instead of returning successful "unknown" packets (unit + real-DOM E2E);
- [x] ambiguous selectors do not silently resolve to an arbitrary target (unit + real-DOM E2E);
- [x] a real browser-driven Studio E2E covers the critical user journey (studio-ui.test.ts);
- [x] Phase 27 security/lifecycle behavior intact (suite + release gate);
- [x] repository release validation green (`pnpm release:check`).

## 23. Phase 28A closure — bare selector ambiguity (synthetic geometry removed)

Date: 2026-08-15. Narrow corrective closure. Phase 29 not started.

### 23.1 Reproduction of the defect

Fixture: `examples/selector-ambiguity-app/server.cjs` (real DOM, port 3221)
with two `.multi-card` divs — card-a at `(0,0)-(100,100)`, card-b at
`(500,500)-(600,600)` — so the historical synthetic default box
`{0,0,100,100}` has center `(50,50)` inside exactly one match.

Command (pre-fix, real browser via Playwright):

```
pnpm viskod capture '.multi-card' --url http://127.0.0.1:3221
```

Result: `Element resolved: .multi-card (div)`, exit 0 — a full context
packet for a selector matching **two** elements. `SELECTOR_AMBIGUOUS` was
not raised. Reproduced the defect.

### 23.2 Root cause

- `packages/cli/src/index.ts` (`cmdCapture`) manufactured
  `boundingBox: {x:0,y:0,width:100,height:100}` for every bare selector.
- Identical literal defaults existed in `packages/mcp-server/src/entry.ts`
  (`viskod_select_element` x/y/width/height defaults, `viskod_capture_context`,
  review recapture adapter), `packages/runtime-session/src/runtime-session.ts`,
  `packages/sdk/src/index.ts`, `apps/studio/src/index.ts` (selection endpoints
  + recapture), `packages/context-engine/src/index.ts` (SE_EVENT handler used
  `{0,0,0,0}`), and `packages/visual-review/src/targetResolver.ts`
  (`?? {0,0,100,100}` fallbacks).
- `BrowserRuntime.resolveSelector()` (Phase 28) treats any supplied box as
  disambiguation evidence: 2 matches → box center (50,50) inside exactly one
  → `resolved`. The box's provenance was never checked, so synthetic geometry
  silently selected an arbitrary element.

### 23.3 Implementation change

Preferred model (smallest clean design): **`SelectionTarget.boundingBox` is
now OPTIONAL and contractually TRUSTED target evidence** — overlay-observed
rects, persisted selection geometry, or explicitly supplied caller
coordinates. No entry point manufactures a default/placeholder box; when no
observed geometry exists the field is omitted.

- `packages/selection-engine/src/types.ts` — optional `boundingBox` + trust
  contract doc.
- `packages/selection-engine/src/index.ts` — `resolveTarget` accepts optional
  box; `selectionId` hashes `selector|none` without one; `computeGeometry` /
  `computeAccessibility` derive the evidence anchor from the trusted box
  center, else from the resolved element's real rect
  (`getSelectedElementInfo`), else return "unavailable" (never fabricated).
- `packages/browser-runtime/src/index.ts` — `resolveSelector` trust contract
  documented; disambiguation logic unchanged (only reachable with a box, and
  no caller passes synthetic geometry).
- `packages/cli/src/index.ts`, `packages/mcp-server/src/entry.ts` (3 spots),
  `packages/runtime-session/src/runtime-session.ts`, `packages/sdk/src/index.ts`,
  `apps/studio/src/index.ts` (3 spots + type), `packages/context-engine/src/
  index.ts` (SE_EVENT handler), `packages/visual-review/src/targetResolver.ts`
  + `types.ts` — all default-box manufacturing removed.
- `.gitignore` — added `**/vite.config.ts.timestamp-*.mjs` (root-level; the
  nested dogfood gitignore alone is not honored by biome — VISKOD-AUDIT-018).
  A leftover Vite cache file from a dogfood run was breaking `biome check`.

### 23.4 Final geometry provenance / trust contract

- Trusted (may disambiguate a multi-match selector): overlay-selected
  element rect; persisted previous-selection geometry; explicit caller
  coordinates whose API contract identifies them as target evidence
  (`viskod_select_element` x/y/width/height — all four required).
- Untrusted (never supplied to resolution): `{0,0,100,100}` defaults,
  placeholder rects, fabricated fallbacks, schema-required boxes.
- Provenance is never inferred from numeric values — `{0,0,100,100}` from an
  overlay remains trusted.
- Invariant: MULTIPLE SELECTOR MATCHES + NO TRUSTED DISAMBIGUATION =
  SELECTOR_AMBIGUOUS.

### 23.5 CLI/MCP behavior before / after

| Path | Before | After |
|---|---|---|
| CLI `viskod capture '.multi-card'` | RESOLVED (default box) | SELECTOR_AMBIGUOUS, exit 1 |
| MCP `viskod_select_element` bare multi-match | RESOLVED (default box) | error, "matches multiple elements" |
| MCP `viskod_select_element` + full trusted box | disambiguates | disambiguates (unchanged contract, now explicit) |
| MCP `viskod_capture_context` bare multi-match | RESOLVED (default box) | error |
| Studio `/select/element` + `/selection/confirm` bare | RESOLVED (default box) | fail closed |
| Review recapture with persisted geometry | disambiguates | disambiguates (fallback default removed) |

### 23.6 Tests added

Unit (`packages/context-engine/src/context-engine.test.ts`, Phase 28A block,
6 tests):

1. bare selector, one match → resolved, and `resolveSelector` receives NO box;
2. bare multi-match → `SELECTOR_AMBIGUOUS`;
3. bare missing → `SELECTOR_NO_MATCH`;
4. bare malformed → `SELECTOR_MALFORMED`;
5. bare detached → `SELECTOR_DETACHED`;
6. trusted caller box is forwarded verbatim to `resolveSelector`.

Unit (`packages/selection-engine/src/selection-engine.test.ts`): bare
selector resolves with `boundingBox` undefined.

Real-DOM E2E (`tests/e2e/selector-ambiguity.test.ts`, new, 5 tests — real
Playwright Chromium, real stdio MCP server):

1. bare `#unique-target` → resolved; bare `.no-such-element-xyz` → no-match;
   bare `div[` → malformed; **bare `.multi-card` with one match containing
   (50,50) → STILL ambiguous** (the defect regression);
2. trusted `{0,0,100,100}` + `.multi-card` → resolved (Case E);
3. trusted `{0,0,100,100}` + `.overlap-card` (both contain center) →
   ambiguous (Case F);
4. `viskod_capture_context` respects the same contract;
5. overlay-originated non-unique selector `.legacy-twin` + persisted real
   geometry → accepted selection still resolves through the Studio workflow
   (Case E / Phase 21+28 overlay evidence preserved).

Phase 28 real-DOM tests preserved and green (studio-ui invalid/ambiguous
selector assertions, full journey).

### 23.7 Validation results

| Command | Result |
|---|---|
| `pnpm typecheck` | PASS (0 errors) |
| `pnpm test:ci` | PASS — 41 files, 791 tests (784 + 7 new) |
| `pnpm test:e2e` | PASS — 4 files, 20 tests (5 new selector-ambiguity; studio-ui/studio-flow/chat-workflow green) |
| `pnpm test:dogfood` | PASS — 7 files, 126 tests |
| `pnpm smoke:agent-workflow` | PASS — 26/26 |
| `pnpm build:cli && node scripts/verify-cli-artifact.mjs` | PASS — bundle + packed artifact verified |
| `pnpm release:check` | PASS — biome + tsc + test:ci + dogfood + smoke + build + artifact verify all green |

New selector-resolution tests run independently:
`vitest run packages/context-engine/src/context-engine.test.ts` (26/26),
`vitest run packages/selection-engine/src/selection-engine.test.ts` (7/7),
`vitest run --config vitest.e2e.config.ts tests/e2e/selector-ambiguity.test.ts` (5/5).

### 23.8 Phase 28 verdict

PASS, with the synthetic-geometry limitation (former §20 bullet) genuinely
fixed:

- [x] bare multi-match selectors always return `SELECTOR_AMBIGUOUS` without trusted target evidence;
- [x] synthetic/default geometry cannot disambiguate them (no entry point manufactures it);
- [x] genuine overlay/persisted/explicit geometry still disambiguates where appropriate (Case E, incl. non-unique overlay selector regression);
- [x] geometry covering multiple candidates stays ambiguous (Case F);
- [x] full release gate green.

## 24. Phase 28B closure — resolved target evidence consistency

Date: 2026-08-15. Final narrow correctness closure for Phase 28. Phase 29
not started.

Invariant guaranteed: **RESOLVED TARGET = CAPTURED TARGET.** Once Viskod
resolves a specific DOM candidate, every target-scoped evidence field
describes that exact candidate — never another selector match.

### 24.1 Reproduction of the defect

Fixture (`examples/selector-ambiguity-app/server.cjs`, extended, port 3221)
serves two same-selector candidates:

```
<section id="parent-a" data-marker="parent-a">  <div class="duplicate-card" id="card-a" data-target="a" data-testid="dup-a" style="background:#d8ecff;color:#003366;border:2px solid #003366">FIRST CARD</div>
<main    id="parent-b" data-marker="parent-b">  <div class="duplicate-card" id="card-b" data-target="b" data-testid="dup-b" style="background:#ffe9a8;color:#7a4a00;border:4px dashed #7a4a00">SECOND CARD</div>
```

`document.querySelector('.duplicate-card')` returns **card-a** (first in
document order). Trusted geometry `{x:700,y:300,width:220,height:120}`
uniquely identifies **card-b** (its rect contains the box center). Real
browser confirmed: `elementFromPoint(810,360)` → `#card-b`.

### 24.2 Exact wrong-target evidence observed before the fix

| Path (real browser, pre-fix) | Expected (B) | Observed (A) |
|---|---|---|
| MCP select + capture — `selection.text` | `SECOND CARD` | **`FIRST CARD`** |
| MCP capture — `dom.attributes` | `data-target: b`, `id: card-b` | `data-target: a`, `id: card-a` |
| MCP capture — `hierarchy.parents[0]` | `main` | `section` |
| MCP capture — `styles` | `rgb(255, 233, 168)` / `rgb(122, 74, 0)` | A's blue palette |
| MCP capture — `selection.boundingBox` | `(700,300)` | `(0,0)` |
| Direct VCE packet — `selection.text` | `SECOND CARD` | **`FIRST CARD`** |
| MCP: select B → B detached → capture | typed detached failure | **`ok: true` — succeeded with A evidence** |
| Studio recapture — `after.targetSummary.textPreview` | `SECOND CARD` | **`FIRST CARD`** |

The geometry in `viskod_select_element`'s response was B's box, while the
capture packet described A — resolution and evidence disagreed everywhere.

### 24.3 Root cause

`BrowserRuntime.resolveSelector()` classified the selector
(`malformed | missing | detached | ambiguous | resolved`) but never returned
WHICH element it resolved. Every element-scoped evidence collector then
re-ran the original selector independently:

- `getDOMSnapshot(handle, selector)` → `document.querySelector(selector)`
- `getElementHierarchy(handle, selector)` → `querySelector(selector)`
- `getComputedStyles(handle, selector)` → `page.$eval(selector, …)`
- `getSelectedElementInfo(handle, selector)` → `querySelector(selector)`
- SelectionEngine: `buildHierarchy`, `computeVisibility`, `observedCenter`
  used the same selector-based collectors.

`querySelector` returns the FIRST match (card-a), so after geometry
disambiguated card-b at resolution time, all subsequent evidence described
card-a. Detachment was worse: after B detached, the selector matched only A,
so a re-resolution silently "resolved" A.

### 24.4 Resolved-element architecture chosen

New capture-scoped primitive in `packages/browser-runtime/src/index.ts`:

```
resolveElement(handle, selector, boundingBox?) → Result<ElementResolution>
  ElementResolution =
    | ResolvedElementRef   { selector, boundingBox?, matchCount, status:'resolved', element: ElementHandle }
    | { … status: 'missing' | 'malformed' | 'ambiguous' | 'detached' }
```

`resolveElement` runs the unchanged Phase 28A resolution algorithm (real
`querySelectorAll` counts, overlay exclusion, trusted-geometry containment)
inside `page.evaluateHandle`, which retains the winning DOM node as a live
Playwright `ElementHandle`. The handle is the internal resolved-element
reference: selector re-queries are never used for evidence again. The handle
is never serialized — it cannot appear in persisted packets, MCP payloads,
or SDK contracts (all boundaries already pass plain data).

Collectors now take the reference (conceptual contract preserved):

```
getDOMSnapshot(handle, ref)
getElementHierarchy(handle, ref)
getComputedStyles(handle, ref)
getSelectedElementInfo(handle, ref)
```

`resolveSelector` remains as the status-only validation API, implemented as
a thin wrapper over `resolveElement` (disposes the handle it never returns).
`SelectionTarget.boundingBox` trust semantics are unchanged.

Implementation notes:

- Screenshot evidence (`captureScreenshot(handle, 'selection')`) is a
  viewport-scoped PNG, not an element crop — it is whole-page rather than
  element-scoped, so it is deliberately NOT routed through the resolved
  element reference. The bounding box in the packet (from the resolved
  element) lets consumers crop if needed; the raw screenshot itself is never
  substituted from another match.
- Each collector page function guards `el.isConnected` first and returns a
  `__viskodDetached` marker; a missing frame/context (navigation, closed
  page) is mapped via `isDetachedContextError` — both yield the typed
  `BR_ELEMENT_DETACHED` failure.
- Page-function bodies contain no named inner functions: esbuild/tsx
  `keepNames` transforms wrap them with the module-scope `__name` helper,
  which is undefined in the page context (caught by the real-browser E2E
  under the tsx MCP/Studio servers; vitest does not enable keepNames, which
  is why the defect surfaced only there). `getDOMSnapshot` uses an iterative
  stack walk instead of a recursive named `walk`.
- Latent fix included: `getComputedStyles` looked up
  `getPropertyValue('backgroundColor')` — `getPropertyValue` requires
  dash-case CSS names, so every multi-word computed style was always `''`.
  The lookup is now normalized to dash-case while snapshot keys stay
  camelCase (the existing packet contract).

### 24.5 Lifecycle / release of resolved references

- `BrowserRuntime.releaseElement(ref)` disposes the handle; idempotent and
  safe after page close.
- `VisualContextEngine.generatePacket(selection?, profile?, resolvedRef?)`
  releases the reference it consumed in a `finally` — whether it resolved it
  itself or received it from a caller. One owner per capture.
- `SelectionEngine.validateSelection(target, handle?, resolvedRef?)` uses a
  caller-provided reference without owning it; when it resolves its own, it
  releases it in a `finally`.
- MCP `viskod_select_element` resolves the element once via
  `vce.resolveTargetElement()`, validates through the same reference, and
  parks it in `currentResolvedRef`; `viskod_capture_context` hands the parked
  reference to `generatePacket` (consumed + released there). A new select or
  an explicit-selector capture releases the previously parked reference;
  browser close auto-disposes any handle never captured. Parked references
  are in-memory only and process-bound.
- CLI, SDK, RuntimeSession, Studio capture, and review recapture are
  single-operation flows: `generatePacket` resolves internally and releases
  in `finally` — no parking.

### 24.6 Behavior when the resolved target detaches

- Detached between resolution and collection (same capture): the collector's
  `isConnected` guard (or frame-loss mapping) returns `BR_ELEMENT_DETACHED`;
  `generatePacket` maps it to the typed `SELECTOR_DETACHED` failure and
  releases the reference. Optional collectors that never ran simply do not
  contribute; core DOM failure is never papered over.
- Detached between MCP select and capture (parked reference): capture fails
  typed (`SELECTOR_DETACHED`) instead of re-resolving the selector — after B
  detaches, `.duplicate-card` matches only A, and A must never become the
  captured target.
- No fallback, no silent re-resolution, no candidate substitution anywhere.

### 24.7 Unique-selector behavior

`#unique` → single match → `resolveElement` returns the handle for that
element → all evidence from it. Identical outcomes to the previous unique
path (no geometry needed, no ambiguity), now with the handle binding the
evidence. `resolveSelector('#unique')` still reports `resolved`.

### 24.8 Trusted-geometry multi-match behavior

- Bare `.duplicate-card` (no geometry) → `SELECTOR_AMBIGUOUS` (unchanged,
  Phase 28A).
- `.duplicate-card` + trusted B box → resolved to B; DOM, hierarchy, styles,
  geometry, selected-element evidence, and parent context all describe B.
- Trusted box covering multiple candidates → `SELECTOR_AMBIGUOUS`
  (unchanged).
- Trusted box matching none → the selection engine's geometry path reports
  unavailable and resolution stays typed per the contract.
- No synthetic geometry introduced anywhere.

### 24.9 Review / recapture behavior

The recapture path (Studio `recaptureViaVce` and the MCP review adapter →
`generatePacket({ selector, boundingBox })` with persisted snapshot
geometry) shares the single fixed pipeline, so recapture evidence is bound
to the geometry-resolved candidate. E2E proves: persisted non-unique
selector `.duplicate-card` + persisted B geometry → after snapshot
`textPreview = "SECOND CARD"`, `resolutionStatus = resolved` — B, not A.
Phase 31 visual comparison was not touched.

### 24.10 Real-browser evidence-consistency proof

`tests/e2e/resolved-target-consistency.test.ts` (5 tests, real Chromium —
MCP stdio server, direct VisualContextEngine, and the rendered Studio UI):

1. MCP select (B box) + capture: `selection.text = SECOND CARD`,
   `dom.attributes = { data-target: b, id: card-b, … }`,
   `hierarchy.parents = [main, body, html]` (no `section`), styles amber
   `rgb(255, 233, 168)` / `rgb(122, 74, 0)`, box `(700,300)`, and no A marker
   (`FIRST CARD`, `card-a`, `parent-a`, `data-target":"a"`) anywhere in the
   response.
2. Direct VCE over real Chromium: full packet from B — DOM text, attributes,
   geometry, hierarchy (parent tagName `main`, no `section`), computed
   styles, `runtimeEvidence.selectedElement` (text, `data-target: b`, box),
   no A markers; plus BrowserRuntime-level `getElementHierarchy` parent text
   contains `SECOND CARD` and not `FIRST CARD`.
3. Ref-level detachment: resolve B → `remove()` B → `getDOMSnapshot`,
   `getElementHierarchy`, `getComputedStyles`, `getSelectedElementInfo` all
   return `BR_ELEMENT_DETACHED`; nothing ever falls back to A.
4. MCP select B → B detached (fixture timer) → capture returns the typed
   detached failure instead of succeeding with A.
5. Studio review recapture: overlay event with non-unique selector +
   observed B rect → accept → describe → prepare → verify → recapture →
   after snapshot textPreview `SECOND CARD`.

### 24.11 Files changed

- `packages/browser-runtime/src/index.ts` — `ResolvedElementRef` /
  `ElementResolution` types, `resolveElement`, `releaseElement`,
  `resolveSelector` wrapper, ref-based `getDOMSnapshot` /
  `getElementHierarchy` / `getComputedStyles` / `getSelectedElementInfo`,
  `BR_ELEMENT_DETACHED` typed failure, `detachedElementError`,
  `isDetachedContextError`, dash-case computed-style lookup.
- `packages/context-engine/src/index.ts` — `generatePacket` third param
  `resolvedRef`; resolve-once/collect-through-ref; `BR_ELEMENT_DETACHED` →
  `SELECTOR_DETACHED` gate; release in `finally`; new `resolveTargetElement`.
- `packages/selection-engine/src/index.ts` — `validateSelection` /
  `buildHierarchy` / `computeVisibility` / `observedCenter` accept and use
  `ResolvedElementRef`; fail closed without a reference when a browser is
  present.
- `packages/mcp-server/src/entry.ts` — select resolves + parks the element
  reference; capture consumes it; replacement/explicit-selector releases the
  parked reference.
- `examples/selector-ambiguity-app/server.cjs` — `.duplicate-card` A/B
  fixture (text, attributes, styles, parent markers, geometry),
  `?viskodSimulate=dup` overlay event, `?viskodDetachDuplicateB` timer.
- `tests/e2e/resolved-target-consistency.test.ts` — new (5 tests).
- Tests updated for the new signatures: `packages/browser-runtime/src/
  browser-runtime.test.ts` (invalid-handle cases now pass a stub ref + new
  `resolveElement` case), `packages/context-engine/src/context-engine.test.ts`
  (fake runtime + Phase 28/28A cases use `resolveElement`).

### 24.12 Tests added

- `tests/e2e/resolved-target-consistency.test.ts` — 5 real-browser tests
  (§24.10).
- `packages/context-engine/src/context-engine.test.ts` — Phase 28B block, 5
  tests: parked ref used without re-resolution + released exactly once;
  internal ref released even when capture fails; detached core DOM →
  `SELECTOR_DETACHED`; `resolveTargetElement` maps ambiguous → typed error;
  `resolveTargetElement` returns the resolved ref.
- `packages/browser-runtime/src/browser-runtime.test.ts` — 4 tests:
  `resolveElement` invalid handle; `getComputedStyles` /
  `getSelectedElementInfo` invalid handle (ref signatures).

### 24.13 Exact validation results

| Command | Result |
|---|---|
| `pnpm typecheck` | PASS (0 errors) |
| `pnpm test:ci` | PASS — 41 files, 799 tests |
| `pnpm test:e2e` | PASS — 5 files, 25 tests (5 new resolved-target-consistency; Phase 28A selector-ambiguity, studio-ui, studio-flow, chat-workflow all green, assertions unchanged) |
| `pnpm test:dogfood` | PASS — 7 files, 126 tests |
| `pnpm smoke:agent-workflow` | PASS — 26/26 |
| `pnpm build:cli && node scripts/verify-cli-artifact.mjs` | PASS — bundle + packed artifact verified |
| `pnpm release:check` | PASS — biome + tsc + test:ci + dogfood + smoke + build + artifact verify all green (exit 0) |

Focused runs: `vitest run packages/browser-runtime/src/browser-runtime.test.ts`
(9/9), `vitest run packages/context-engine/src/context-engine.test.ts` (31/31),
`vitest run packages/selection-engine/src/selection-engine.test.ts` (7/7),
`vitest run --config vitest.e2e.config.ts tests/e2e/resolved-target-consistency.test.ts`
(5/5). After E2E: fixture port 3221, Studio port 3001, and fixture port 3000
verified free; no orphan Playwright Chromium/dev-server processes remained.

### 24.14 Phase 28B verdict

PASS against every criterion:

- [x] a candidate resolved as B produces DOM evidence from B;
- [x] hierarchy comes from B (parent `main`/marker text, never A's);
- [x] computed styles come from B (amber palette, real values);
- [x] selected-element runtime evidence comes from B;
- [x] geometry/accessibility information comes from B;
- [x] target-scoped evidence never silently comes from A (asserted across the
      whole packet/response JSON);
- [x] detachment of B never causes fallback to A (ref-level and MCP-level
      typed detached failures);
- [x] review recapture preserves the same invariant (after-snapshot evidence
      from B);
- [x] Phase 28A ambiguity behavior intact (bare multi-match ambiguous,
      trusted geometry disambiguates, overlapping geometry ambiguous,
      malformed/missing fail closed — E2E assertions unchanged and green);
- [x] all previous Phase 27/28 tests green;
- [x] `pnpm release:check` passes.

Phase 28 final status remains **PASS** with the resolved-target consistency
limitation removed (former §20 bullet).
