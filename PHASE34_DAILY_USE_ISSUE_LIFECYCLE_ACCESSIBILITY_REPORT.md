# Phase 34 — Daily-Use Issue Lifecycle, Resume & Accessibility Report

## 1. Executive summary

Phase 34 adds a durable Studio issue-history surface, persisted issue detail and intent editing, archive/reopen controls, explicit parent-child forks, restart resume projection, keyboard target navigation, focus restoration, bounded live announcements, and rendered lifecycle coverage. Existing Phase 27–33 security, identity, privacy, review, setup, workspace, and process-ownership contracts remain covered by the regression gates.

## 2. Audit findings reproduced

Before implementation, the audit found that VisualIssue CRUD existed on disk but Studio exposed no history/detail/edit/archive/reopen/fork surface. Navigation recreated an idle transient workflow and discarded issue/handoff/review identifiers. Studio had no focus restoration or live status region. The overlay handled Escape but had no candidate keyboard navigation or keyboard acceptance. Existing review artifacts were durable and correctly issue-scoped.

## 3. Daily-use architecture before/after

Before: linear, in-memory StudioWorkflow with durable entities unreachable from rendered Studio. After: `/issues` summary history and `/issues/:id` sanitized detail endpoints compose durable issue, handoff, review, and baseline relations; `/issues/:id/open` queues or restores resumable workflow state; rendered controls perform lifecycle actions.

## 4. Durable issue-history model

Issue history is sourced from `IssueServiceImpl.listIssues(includeArchived, limit)`, ordered by `updatedAt` descending and stable `issueId` ascending, capped at 500 in the service and 100 at the Studio boundary. History returns summaries, not capture packets or review images.

## 5. Issue summary/detail endpoints

`GET /issues?limit=&archived=true` returns bounded summaries with handoff and latest-review status. `GET /issues/:id` returns sanitized intent, target summary, opaque evidence references, bounded lifecycle entries, handoff/review summaries, lineage, and `baselineAvailable`. `POST /issues/:id/edit`, `/archive`, `/reopen`, `/fork`, and `/open` provide the rendered lifecycle surface.

## 6. Restart/resume model

Opening an issue without a live browser stores a pending opaque issue id. The next rendered navigation creates the normal page workflow and derives handoff/review ids from persistence before restoring resumable state. No transient workflow object is serialized and no new baseline is captured during resume.

## 7. Resume-state derivation

`StudioWorkflow.resumeIssue()` derives stage and opaque relations from VisualIssue, handoff list, review list, and review preview. It restores `handoff_ready`, `verifying`, `review_ready`, or `decided` based on persisted entities. Capture packets and sensitive image bytes remain owned by their existing stores.

## 8. Intent-editing contract

Title, description/user note, and `expectedResult` are editable. `source`, target identity, page evidence, capture references, and review artifacts are not editable through Studio. Intent text is redacted before persistence and detail rendering.

## 9. Archive/reopen behavior

Archive is an explicit button action; archived issues remain durable and visible through the archived filter. Reopen restores `open` without creating a capture. Existing handoff, capture, review, baseline, and lineage references remain unchanged.

## 10. Delete decision

Studio does not expose delete. Existing deletion remains outside the primary UI because safe cascading semantics for linked captures, handoffs, reviews, and sensitive artifacts are not a Studio issue-management concern.

## 11. Fork semantics

`IssueServiceImpl.forkIssue()` creates a new child id and persists it independently. Parent state is not reopened or mutated. A request id deduplicates concurrent retries for one accepted fork action; the rendered client also guards in-flight double-clicks.

## 12. Fork inheritance contract

A child copies the parent’s redacted target identity/reference, source snapshot, page context, safe evidence references, tags, and user intent as starting context. It receives fresh timestamps and `open` status. Review decision, after artifact, diff result, and resolved lifecycle status are not copied as new truth. Sensitive image files are not duplicated.

## 13. Fork lineage

`parentIssueId`, `rootIssueId`, and `forkedAt` are persisted and validated by the VisualIssue schema. Studio displays minimal lineage through detail/history context and exposes a direct Fork action; it does not recursively load a graph.

## 14. Activity/history behavior

Existing bounded lifecycle events are retained. Fork adds a structured `forked` event with opaque parent/child ids. Intent changes append bounded `updated` events. Studio detail returns only the latest 20 lifecycle entries.

## 15. Privacy boundary

History/detail excludes raw packet JSON, screenshot pixels, absolute paths, selectors, session tokens, and arbitrary logs. Review artifacts remain local-sensitive and are referenced only through existing opaque artifact routes. `expectedResult` follows the issue redaction path.

## 16. Keyboard-selection model

Selection mode exposes a bounded candidate model. Arrow keys and Tab cycle meaningful visible interactive/heading candidates in deterministic document order. Enter/Space accepts the highlighted DOM node; Escape preserves the existing drag-clear-exit behavior.

## 17. Candidate ordering

Candidates are collected synchronously from the document and sorted using existing document-order logic. The model does not make every application node tabbable and does not alter host tabindex attributes. Existing shadow/iframe and cross-origin boundaries remain governed by the existing overlay/runtime path.

## 18. Phase 28 keyboard identity proof

Keyboard acceptance calls the same `handleElementClick` event path as pointer selection and emits `overlay:element-clicked`. The existing SelectionOverlayController and selection-resolution pipeline therefore receive the same target identity contract. Real Chromium dogfood `DF34-KB` passed without pointer input.

## 19. Overlay accessibility semantics

The overlay retains its polite selection indicator, confirmation semantics, Escape control, and reduced-motion behavior. Keyboard candidate status is announced through the bounded overlay status channel. Teardown does not modify host tabindex attributes.

## 20. Focus-management contract

Focus moves to a stage’s primary control only on a meaningful transition or explicit lifecycle action. Routine same-stage WebSocket/state renders preserve the currently focused control when it still exists. Issue history and lifecycle actions are native buttons and remain keyboard reachable.

## 21. aria-live behavior

Studio adds one visually hidden `role=status` / `aria-live=polite` region. It announces stage changes, durable issue actions, history availability, and errors without announcing hover movement. Overlay announcements remain bounded and polite.

## 22. Error accessibility

Errors remain typed internally. The client announces concise recovery text through the live region and keeps retry/cancel controls in the rendered stage. No stack traces or absolute paths are rendered.

## 23. Reduced-motion behavior

Studio introduces no essential animation. Existing overlay transitions continue to use `prefers-reduced-motion: reduce` and disable non-essential transitions when requested.

## 24. Keyboard-selection E2E

`packages/overlay-system/src/dogfood-actual.test.ts` adds `DF34-KB` and `DF34-KB-B`, using Playwright keyboard APIs: ArrowDown navigation and Enter acceptance, including a non-first duplicate-selector candidate. The final dogfood run passed 128 tests.

## 25. Restart/history/verification E2E

`tests/e2e/studio-ui.test.ts` adds a rendered fresh-process journey: create and handoff, terminate only the test-owned Studio process, restart it, open durable history, then navigate the app and assert the restored handoff-ready issue id. Existing visual-review durability E2E proves the original persisted BEFORE baseline remains exact across restart.

## 26. Edit/archive/reopen E2E

The rendered Studio journey edits user intent, verifies the persisted detail endpoint, archives, shows archived history, reopens, and retains the issue’s immutable capture context.

## 27. Fork E2E

The rendered journey forks from history and double-clicks the Fork control. Persisted issue count increases by exactly one, proving client in-flight protection plus durable child creation. The service test verifies distinct child id, parent id, root id, open lifecycle, and restart-loadability.

## 28. Issue-history scale bound

History requests are capped at 100 at the Studio boundary and issue service results at 500. Summaries load bounded handoff/review list projections; full issue packets, review payloads, and images are not placed in `/state` or history rows.

## 29. Studio state boundary

The generic workflow/WebSocket state remains sanitized and does not contain issue history, raw capture packets, or review images. Issue history and detail use dedicated endpoints.

## 30. Files changed

- `apps/studio/src/index.ts`
- `apps/studio/src/ui.ts`
- `apps/studio/src/workflow.ts`
- `packages/visual-issue/src/types.ts`
- `packages/visual-issue/src/schemas.ts`
- `packages/visual-issue/src/service.ts`
- `packages/visual-issue/src/lifecycle.ts`
- `packages/visual-issue/src/redaction.ts`
- `packages/visual-issue/src/index.ts`
- `packages/visual-issue/src/visual-issue.test.ts`
- `packages/overlay-system/src/index.ts`
- `packages/overlay-system/src/dogfood-actual.test.ts`
- `tests/e2e/studio-ui.test.ts`
- `docs/overlay-system.md`
- `PHASE34_DAILY_USE_ISSUE_LIFECYCLE_ACCESSIBILITY_REPORT.md`

## 31. Tests added/changed

Added VisualIssue fork-lineage coverage, real Chromium keyboard-selection dogfood, rendered Studio edit/archive/reopen/fork coverage, and rendered Studio fresh-process history resume coverage. Existing focused suites and regression suites remain green.

## 32. Exact validation results

- `pnpm typecheck`: PASS.
- `pnpm lint`: PASS.
- `pnpm test:ci`: PASS, 71 files / 1,075 tests.
- `pnpm test:e2e`: PASS, 13 files / 78 tests.
- `pnpm smoke:agent-workflow`: PASS, 26/26 checks with owned free ports.
- `pnpm build:cli && node scripts/verify-cli-artifact.mjs`: PASS; packed CLI artifact verified.
- `pnpm release:check`: PASS; 71 CI files / 1,075 tests, 7 dogfood files /
  128 tests, 26/26 smoke checks, and packed-artifact verification.

## 33. Regression results

Phase 27 security/process ownership, Phase 28 exact target identity, Phase 29 persistence/privacy, Phase 30 source calibration, Phase 31 local-sensitive review, Phase 32 setup/runtime, and Phase 33 workspace/cache tests passed in the required gates. No unknown process owners were terminated by the new E2E journey.

## 34. Known limitations

Formal WCAG conformance was not claimed. Full DOM-wide keyboard navigation remains intentionally out of scope; candidate navigation is bounded to meaningful visible controls/headings. Studio still requires the target application to be opened before browser-dependent verification can execute after a process restart; the durable issue and pending resume state are loaded before that navigation.

## 35. Deferred Phase 35 work

No Phase 35 work was started. Future work may consider richer activity filtering, review-aware pagination, stronger persisted fork request idempotency across process crashes, and formal accessibility auditing.

## Final status

**PASS** — required Phase 34 issue discoverability, durable lifecycle, fork lineage, bounded state, keyboard selection, accessibility status/focus, privacy, restart resume, rendered E2E, and release gates are implemented and verified.

## Phase 34A — Rendered Keyboard, Resume & Focus Closure

### Implemented closure

- **Transition-aware focus:** Studio now records the focused control before each
  render. A meaningful stage transition focuses that stage’s primary control;
  same-stage WebSocket/state renders restore the existing control by `id` or
  `data-action`, preserving text-entry and keyboard navigation focus.
- **Error accessibility:** workflow errors render as concise `role="alert"`
  messages with `tabindex="-1"`. Error renders receive focus and are announced
  through the bounded polite status region. No stack traces, absolute paths,
  packets, selectors, session tokens, or image bytes are added to Studio state.
- **Issue-history keyboard surface:** history, archive/reopen, fork, edit, and
  native detail controls remain keyboard activatable. Detail opens focus the
  keyboard-focusable primary heading. Forked child detail visibly exposes an
  “Open parent” action; parent navigation uses the existing detail endpoint.
- **Duplicate-target keyboard identity:** `DF34-KB-B` uses a real Chromium page
  containing two `.duplicate-card` candidates, navigates with ArrowDown twice,
  accepts with Enter, and asserts candidate B text plus the generated
  `button:nth-of-type(2)` selector resolves to candidate B. No pointer action or
  internal overlay event dispatch is used.
- **Cancel/reselect and resume semantics:** existing overlay Escape teardown,
  Studio cancel/reselect flow, Phase 31A exact-baseline persistence, and
  missing/corrupt-baseline fail-closed service contracts remain the exercised
  paths; no replacement baseline is captured by resume.
- **Reduced motion/live status:** the existing overlay reduced-motion rule and
  single bounded Studio `role=status` region are preserved. Hover movement does
  not call the Studio announcement path.

### Direct verification recorded in this closure

- `tests/e2e/studio-ui.test.ts`: final self-contained run PASS, 8 tests,
  including keyboard activation of rendered selection acceptance and
  prepare-handoff controls, keyboard issue-history lifecycle actions, and
  routine-render focus preservation.
- `tests/e2e/visual-review-ui.test.ts`: final self-contained run PASS, 3
  tests, including the combined restart → resume → mutate → verify →
  decision journey, exact BEFORE hash reuse, rendered fork lineage, and
  persisted decision.
- `tests/e2e/visual-review-durability.test.ts`: PASS, including exact
  pre-restart baseline identity and missing/corrupt baseline fail-closed cases.
- `pnpm typecheck`: PASS.
- `pnpm lint`: PASS.
- `pnpm test:ci`: PASS, 71 files / 1,075 tests.
- `pnpm test:e2e`: PASS, 13 files / 78 tests.
- `pnpm test:dogfood`: PASS, 7 files / 128 tests.
- `pnpm smoke:agent-workflow`: PASS, 26/26 checks.
- `pnpm build:cli && node scripts/verify-cli-artifact.mjs`: PASS.
- `pnpm release:check`: PASS; all included gates passed.
- One unrelated infrastructure test was transiently flaky during an earlier
  release attempt (`mcp-runtime.test.ts` received incomplete evidence); the
  isolated test and subsequent complete release gate both passed.

### Hygiene and scope

No Phase 35 work was started. The existing bounded history/detail endpoints,
local-sensitive artifact ownership, sanitized generic state, and process
ownership rules are unchanged.

## Phase 34B — Keyboard Identity & Accessibility Evidence Closure

### Direct rendered and browser evidence

- **Duplicate-target identity:** `tests/e2e/studio-ui.test.ts` now drives the
  rendered workflow with keyboard-only acceptance (`Space`/`Enter`), then reads
  the persisted issue and handoff. Candidate B is distinguished by its `Submit`
  text and `#phase12-source-submit-button` identity; the persisted selection
  target, issue evidence, and handoff contain B and not candidate A.
  `packages/overlay-system/src/dogfood-actual.test.ts` independently drives a
  real Chromium page containing two duplicate-selector candidates with
  `ArrowDown` navigation and `Enter`; it asserts the second candidate's text
  and generated selector resolve to B.
- **Cancel/reselect:** rendered Studio `Escape` cancellation returns to idle,
  restores focus to `#report-start`, leaves workflow selection null, and a new
  keyboard-activated report persists B only. No pointer target selection or
  internal overlay-event dispatch is used by the rendered test.
- **Focus preservation:** the rendered benign-render test retains focus in the
  active description field; the Escape regression waits for and asserts the
  restored report control.
- **Live status:** the rendered test observes the actual `#status-live`
  `role=status`/`aria-live=polite` region. It asserts bounded text for target
  selection, handoff readiness, and typed error handling. Pointer movement does
  not change the live text. Stage announcements now remain stable across
  same-stage renders rather than being cleared by routine updates.
- **Typed error:** the rendered test submits selection acceptance without a
  target and asserts a focused `role=alert` with concise text, no stack trace,
  absolute path, packet data, or selector leakage; the cancel control remains
  present and keyboard reachable.
- **Reduced motion:** `DF34-MOTION` uses Chromium
  `emulateMedia({ reducedMotion: 'reduce' })`, injects the real overlay, and
  asserts the rendered overlay transition custom property is `none`. This is
  a browser behavior assertion, not a CSS source-text check.

### Regression and exact validation

- Restart → history → resume → original BEFORE → AFTER → comparison → decision
  remains green in `tests/e2e/visual-review-ui.test.ts`; exact persisted BEFORE
  identity and missing/corrupt-baseline fail-closed cases remain green in
  `tests/e2e/visual-review-durability.test.ts`.
- `pnpm typecheck`: PASS.
- `pnpm lint`: PASS.
- `pnpm test:ci`: PASS, 71 files / 1,075 tests.
- `pnpm test:e2e`: PASS, 13 files / 81 tests; self-contained startup and
  teardown retained.
- `pnpm test:dogfood`: PASS, 7 files / 129 tests, including `DF34-KB-B` and
  `DF34-MOTION`.
- `pnpm smoke:agent-workflow`: PASS, 26/26 checks.
- `pnpm build:cli && node scripts/verify-cli-artifact.mjs`: PASS; packed CLI
  artifact verified.
- `pnpm release:check`: PASS; all included typecheck, lint, CI, dogfood,
  workflow-smoke, CLI-build, and packed-artifact gates passed.

### Process and port hygiene

The final post-validation observation recorded `studio=0`, `mcp=0`, and no
listeners on ports 3000 or 3001. The only listener among the inspected target
ports was an existing non-test-owned dogfood Vite process on 127.0.0.1:5173
(PID 862159); it was not terminated. The process snapshot contained 15
Chromium processes and 5 Node/tsx/vite matches, all attributable to the
pre-existing OMP browser daemon or that unknown Vite owner rather than an
owned Studio/MCP child. Test-owned children were terminated by their existing
process-group harness; unknown owners were preserved.
### Phase 34B status

**PASS** — the rendered keyboard, cancel/reselect, focus, live-region, typed
error, reduced-motion, restart/resume, process-ownership, and required release
gate evidence is green. Phase 35 was not started.
