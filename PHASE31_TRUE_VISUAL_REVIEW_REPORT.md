# PHASE 31 — TRUE SAFE BEFORE/AFTER VISUAL REVIEW — REPORT

Status: PASS
Date: 2026-08-15

---

## 1. Executive Summary

Phase 31 turns Viskod's metadata-oriented "before/after review" into a real
human visual verification workflow. Review verification now:

- captures a local-sensitive target crop BEFORE the coding agent modifies the
  page (baseline tied durably to the issue);
- recaptures the exact same logical target through the Phase 28B exact-target
  pipeline;
- compares REAL pixels (PNG decode + per-pixel diff) on a deterministic
  common canvas and computes geometry separately;
- renders BEFORE / AFTER / DIFF images in Studio through protected opaque
  artifact endpoints;
- keeps raw images strictly LOCAL SENSITIVE — they never enter the agent-safe
  packet, `get_handoff_context`, or the Phase 29 screenshot boundary;
- closes VISKOD-AUDIT-005 (unchanged targets no longer report changed) and
  VISKOD-AUDIT-023 (decision notes persist).

The three audited findings (VISKOD-AUDIT-004/005/023) are reproduced,
addressed, and regression-tested.

## 2. Findings Confirmed / Not Reproducible

| Finding | Verdict | Evidence |
|---|---|---|
| VISKOD-AUDIT-004 — review does not persist/compare actual before screenshots | CONFIRMED | `ReviewServiceImpl.createReview` built a metadata-only before snapshot; `recaptureReview` called `computeComparison(before, after)` without any screenshot paths; the existing `compareScreenshots` byte-diff was never wired. Studio rendered only "Before: captured … / After: captured …" text. |
| VISKOD-AUDIT-005 — unchanged targets can report changed | CONFIRMED | `buildAfterSnapshot` set `targetSummary.label = recaptureResult.tagName`. `determineSameTargetLikely`/`determineComparisonStatus` compared that tagName label against the before human-readable label → any recapture flipped to `changed`. The pre-existing `studio-flow` E2E and the agent-workflow smoke relied on exactly this false positive ("changed" for a hidden→visible CSS swap). |
| VISKOD-AUDIT-023 — review UI lacks visual evidence + decision notes | CONFIRMED | No image rendering; the client always sent `note: ''` (`var note = '';` in `ui.ts`). |

## 3. Review Architecture Before / After

**Before (Phase 27–30):**
`createReview` → metadata before snapshot from the issue → `recaptureReview`
→ VCE packet → metadata after snapshot → `computeComparison` over
label/role/textPreview/cropRect-width/height → status `changed | unchanged |
missing_after | ambiguous_after | stale_before | capture_failed |
comparison_failed`. No pixels persisted or compared; no diff image; no note.

**After (Phase 31):**
```
selection accepted
  → issue created
  → handoff prepared
      → captureBaselineArtifact()                 # BEFORE crop, pre-change
          .viskod/reviews/baselines/<issueId>/before.png + manifest.json
  → coding agent modifies the page
  → verify start
      → createReview copies baseline → .viskod/reviews/<reviewId>/before.png
  → recapture
      → captureElementScreenshot() via Phase 28B resolveElement
          → after.png
      → compareElementImages(before, after)        # real pixels
          → diff.png + metrics
      → finalizeArtifactComparison(before, after, metrics)
          → changed | unchanged | incomparable | unavailable
      → review.comparison.visual.artifactComparison persisted
  → Studio renders BEFORE / AFTER / DIFF from /review/artifact/<opaqueId>
  → human decision + optional note persisted
```

## 4. Visual-Review Privacy Boundary

Documented in `packages/visual-review/src/artifact-types.ts`:

> Phase 29 established that the agent-safe persisted context packet NEVER
> carries raw screenshot pixels. Phase 31 introduces a SEPARATE artifact
> class — LOCAL SENSITIVE VISUAL REVIEW ARTIFACTS — that exists only so the
> developer can visually review a change in Studio: they are NEVER part of
> `get_handoff_context`, `AgentContextProjection`, or the normal safe
> `ContextPacket`; they are NOT claimed to be redacted; they are NOT sent to
> coding agents; they are marked `sensitive: true`/`localOnly: true` and
> served only through protected opaque Studio endpoints.

Regression test: `tests/e2e/visual-review-privacy.test.ts` (§24).

## 5. User Opt-In / Policy Behavior

- `ViskodSettings.visualReviewArtifacts: 'disabled' | 'local-sensitive-target-crop'`,
  default `disabled` (Phase 29 privacy stance).
- One-time consent banner in Studio (`policyBanner` in `ui.ts`, server + client)
  shown when the user has not answered; explains that screenshots may contain
  visible sensitive information, stay local, and are not included in agent
  handoff context.
- Preference persisted in `.viskod/settings.json`
  (`saveVisualReviewPolicy`/`loadVisualReviewPolicy` in Studio entry); the
  normal report flow never re-asks.
- Consent is never inferred from `collectScreenshot`.

## 6. Before-Artifact Capture Lifecycle

Captured in `StudioWorkflow` when the agent handoff is prepared
(`captureBaselineForIssue` → `Studio.captureBaselineArtifact` →
`BrowserRuntime.captureElementScreenshot` → `ReviewArtifactStore.saveBaseline`).
This is the last moment before the coding agent modifies the UI. If artifacts
are disabled or the target cannot be resolved (e.g. hidden at capture time),
no baseline is stored and the review truthfully reports "Visual comparison
unavailable" — never fabricated from the post-change page.

## 7. Local Review Artifact Schema / Storage

Layout:
```
.viskod/reviews/
  baselines/<issueId>/before.png + manifest.json
  <reviewId>/review.json          (ReviewPersistence)
  <reviewId>/before.png after.png diff.png
  <reviewId>/manifest.json        (durable pairing contract)
```
Manifest fields (`ReviewArtifactsManifest`, schemaVersion 1):
`schemaVersion, reviewId, issueId, sensitive: true, localOnly: true, policy,
artifacts[{artifactId, role, status, capturedAt, dimensions, crop{rect,
padding}, target{boundingBox, selector, targetId, stableAttributes}, viewport,
pageUrl, failureReason}], pairing{beforeArtifactId, afterArtifactId,
diffArtifactId}, comparison{status, changedPixelRatio, changedPixels,
totalPixels, comparisonDimensions, beforeDimensions, afterDimensions,
geometry, geometryChanged, viewportCompatible, pixelDiffConfigVersion,
reason}, updatedAt`.

Opaque artifact ids (`art_<32 hex>`); no user-supplied paths; no absolute
paths in Studio JSON responses.

## 8. Atomic Persistence Behavior

Every artifact write is temp-write → `assertValidPng` decode → atomic rename;
the manifest is written LAST as the commit marker, so a review directory with
images but no valid manifest is never treated as complete review evidence.
Failed writes leave no committed artifact and no temp residue
(`ARTIFACT_WRITE_FAILED`/`ARTIFACT_INVALID_IMAGE` typed errors). Verified by
`artifact-store.test.ts` (corrupt PNG, corrupt manifest, missing file,
temp-residue assertions).

## 9. Before/After Pairing Contract

No process-global "latest screenshot". The review manifest pairs
`beforeArtifactId` → `afterArtifactId` → `diffArtifactId` explicitly;
`readArtifact(reviewId, artifactId)` resolves only through that review's own
manifest (cross-lineage lookups fail). Pairing survives Studio restart
(verified in the changed-review UI E2E §26 and the service restart test).

## 10. Exact Target Identity Behavior

Both before and after crops use `BrowserRuntime.captureElementScreenshot`
→ `resolveElement(selector, trustedBoundingBox)` (Phase 28B pipeline); a
multi-match selector without trusted geometry fails closed as ambiguous; a
detached/missing element returns a typed resolution status. The after
snapshot records the resolved element's stable identity
(`identity.stableAttributes`, `targetId`); `determineSameTargetLikely`
compares identity when present, never labels/text. A replaced target
(identity mismatch) is `incomparable` — never silently diffed (§25H corpus +
unit test).

## 11. Pixel Comparison Implementation

`packages/visual-review/src/pixel-diff.ts` (rewritten): decodes PNGs with
`pngjs` (pure JS), compares RGBA per pixel with a per-channel tolerance
(default 24, absorbs antialiasing), alpha-aware (transparent regions compare
equal). Produces: `changedPixelRatio`, `changedPixels`, `totalPixels`,
comparison/before/after dimensions, `dimensionsMatch`, `tolerance`,
`configVersion` (1), and a highlight diff image (unchanged pixels subdued at
30% alpha of the before pixels; changed pixels solid red; size-delta regions
red). Undecodable input throws `ImageDecodeError` → typed comparison failure.

## 12. Image Normalization / Alignment Rule

Documented in `pixel-diff.ts` and applied in
`finalizeArtifactComparison`:
- target geometry is compared SEPARATELY (x/y/width/height deltas, 1px
  tolerance);
- both crops are placed into a deterministic common canvas
  (width = max, height = max, TOP-LEFT ALIGNED) WITHOUT scaling either
  image — resizing could hide real size/layout changes;
- pixels present in only one crop count as changed and are highlighted;
- dimensions and geometry deltas are recorded separately in the manifest.

## 13. Geometry Comparison Is Separate Evidence

`finalizeArtifactComparison` computes `geometry` (x/y/w/h deltas from the
trusted target rects) and `geometryChanged` (any |delta| > 1px). A
position-only move with identical crop pixels is `changed` via geometry
(§25F corpus + service unit test); a width/height change is `changed` via
geometry AND pixel evidence (§25E).

## 14. Final Review Result Semantics

`VisualComparisonStatus` extended with `incomparable` and
`visual_unavailable`; existing typed statuses retained:

- `unchanged` — identity valid + comparable artifacts + no meaningful pixel
  or geometry difference (pixel ratio < 0.005 and geometry within 1px);
- `changed` — identity valid + meaningful visual and/or geometry difference;
- `incomparable` — viewport/DPR mismatch, or identity evidence says the
  recaptured element is NOT the original target;
- `visual_unavailable` — policy enabled but before/after artifacts missing or
  uncomparable; the metadata-only legacy statuses still apply when the policy
  is disabled;
- `missing_after` / `ambiguous_after` / `stale_before` / `capture_failed` /
  `comparison_failed` — unchanged target-level conditions.

`incomparable`/`visual_unavailable` are never called "changed".

## 15. Unchanged False-Positive Root Cause / Fix

Root cause (VISKOD-AUDIT-005): `buildAfterSnapshot` used
`recaptureResult.tagName` as `targetSummary.label`; the comparison treated
the before human-readable label vs the after tagName as a changed target.
Fix: the after label is never derived from tagName; same-target
determination uses the Phase 28B stable-identity model; text/label remain
change evidence only. Real-Chromium regression (§27 + corpus A) proves an
unchanged target reports unchanged.

## 16. Viewport / DPR Mismatch Behavior

`viewportsCompatible(before, after)` compares viewport width/height
(2px tolerance) and devicePixelRatio; any mismatch → `incomparable` with an
explicit reason — no confident pixel result across incompatible rendering
conditions. The human can still view the images side-by-side (§25I).

## 17. Dynamic-Content Behavior

Viskod does not automatically classify dynamic visual differences
(timestamps, animations, random values) as success or failure — the diff
reports the evidence honestly and the human decision remains authoritative.
No dynamic-content stabilizer was built (out of scope); the limitation is
documented here and in the review UI wording ("evidence, not truth").

## 18. Diff Visualization

`compareElementImages` produces a diff PNG: unchanged pixels subdued
(30% alpha of the before pixels), changed pixels solid highlight red,
one-crop-only regions red. The diff corresponds exactly to the computed
comparison (same loop, same tolerance). Persisted as a local-sensitive
artifact and served through the protected endpoint.

## 19. Protected Artifact-Serving Endpoint

`GET /review/artifact/<opaqueId>`:
- id must match `art_[a-f0-9]{32}` (traversal/malformed rejected 404);
- the owner review is located by scanning only `<base>/<reviewId>/manifest.json`
  pairing fields (never arbitrary paths);
- `readArtifact` resolves the id through that review's own manifest to a
  fixed role filename (`before.png`/`after.png`/`diff.png`) — no user input
  becomes a path;
- correct `image/png` MIME, `Cache-Control: no-store`;
- missing/corrupt artifacts return controlled 404s;
- the Studio HTML never uses `file://`.

## 20. Studio Review UI

The review screen renders:
- comparison status (`comparisonMessage`);
- BEFORE / AFTER / DIFF images (`reviewVisualPanelHtml`, client mirror too);
- changed-pixel ratio, changed/total pixel counts, geometry deltas,
  viewport/DPR mismatch and incomparable reasons;
- evidence details (before/after timestamps, Phase 30A source status,
  confidence, summary);
- optional decision note textarea;
- Accept / Issue persists / Needs follow-up (human decision, never
  auto-derived from pixel metrics);
- "Visual comparison unavailable" wording when artifacts are disabled or
  missing — no false pixel-review claim.

## 21. Decision-Note Behavior

The review service already accepted an optional note; Studio now exposes a
textarea and sends its value (`note = noteEl.value.trim()` — no more
hard-coded `''`). The decision (decision/note/decidedAt) is persisted in
`review.json` and survives reload and Studio restart (verified in §26 UI E2E
and the service note test).

## 22. Visual-Review Privacy E2E

`tests/e2e/visual-review-privacy.test.ts` (2 tests, real processes):
1. With the policy explicitly enabled on the Phase 29 privacy fixture:
   baseline persisted + manifest `sensitive`/`localOnly`; review artifacts
   created; the persisted ContextPacket screenshots stay `omitted_sensitive`
   with `path: null`; the packet never references the artifact id or
   `reviews/`; Studio state carries no absolute paths; the image is served
   only via `/review/artifact/<id>` (200 image/png); traversal and malformed
   ids 404.
2. A FRESH MCP process (new CLI `serve`): `get_handoff_context` reports
   `screenshot.status: omitted_sensitive` and its JSON contains no `art_`,
   `reviews/`, `before.png`, or absolute paths; `tools/list` contains no
   artifact/image retrieval tool.

## 23. Visual Regression Corpus / Results

`tests/e2e/visual-regression-corpus.test.ts` — REAL Chromium, the production
`captureElementScreenshot` → `compareElementImages` →
`finalizeArtifactComparison` pipeline:

| Scenario | Fixture change | Expected | Result |
|---|---|---|---|
| A. UNCHANGED | none | unchanged | PASS |
| B. COLOR ONLY | background → red | changed (pixels) | PASS |
| C. TYPOGRAPHY | font-size/weight | changed | PASS |
| D. BORDER / SHADOW | border-width + shadow | changed | PASS |
| E. TARGET SIZE | width +80px | changed (geometry/pixels) | PASS |
| F. POSITION ONLY | margin-left +90px | changed (geometry) | PASS |
| G. TEXT CHANGE | new copy | changed | PASS |
| H. TARGET REPLACED | element removed | resolution `missing` → typed missing_after | PASS |
| I. VIEWPORT MISMATCH | 1280×720 → 800×600 | incomparable | PASS |
| J. MISSING BEFORE | no baseline | visual comparison unavailable | PASS |

## 24. Changed Studio E2E Proof

`tests/e2e/visual-review-ui.test.ts` — real Studio HTML driven by Playwright:
report → select → accept → describe → prepare handoff; asserts the baseline
manifest/PNG exist BEFORE the simulated change; mutates the fixture; clicks
Verify → recapture; asserts `.comparison-status` contains "changed", THREE
image cards (BEFORE/AFTER/DIFF) whose `src` matches
`/review/artifact/art_[a-f0-9]{32}` and whose images actually load
(naturalWidth > 0); enters a note; accepts; asserts the note renders on the
decided screen; reloads the page and reads the persisted note back; kills and
restarts Studio; asserts the review + artifact ids + `comparison.status:
changed` load from durable storage and the artifact endpoint still serves
PNGs; traversal/malformed artifact ids fail safely.

## 25. Unchanged Studio E2E Proof

Same file, separate journey: capture → NO fixture change → Verify →
`.comparison-status` contains "No measurable change detected"; review API
reports `unchanged`, `artifactComparison.changedPixelRatio < 0.005`, before +
after + diff artifacts present, artifacts comparison `unchanged`; the UI
shows "Visually unchanged" and NOT "Visual change detected". This closes the
original Terra dogfood failure (VISKOD-AUDIT-005) in real Chromium.

## 26. Restart Durability Proof

Changed-journey E2E: after decision, Studio is killed and restarted; the
review (with before/after/diff artifact ids and the persisted changed
comparison) is retrieved from durable storage — no in-memory before-image
buffer — and the protected artifact endpoint serves the persisted PNGs. The
service-level "artifacts survive a simulated restart" unit test repeats the
invariant with fresh service/store instances.

## 27. Corruption / Path Safety

`artifact-store.test.ts` covers: traversal/malformed artifact ids, foreign
(lineage-crossing) artifact ids, corrupt PNG write rejection with no
committed artifact or temp residue, corrupt manifest as a typed
`ARTIFACT_MANIFEST_INVALID`, manifest referencing a missing file as
`ARTIFACT_NOT_FOUND`, and restart re-reads. The UI E2E additionally asserts
HTTP-level 404s for traversal and malformed ids.

## 28. Files Changed

Packages:
- `packages/visual-review/src/pixel-diff.ts` — rewritten (real pixel engine)
- `packages/visual-review/src/artifact-types.ts` — new (manifest, policy, crop types)
- `packages/visual-review/src/artifact-store.ts` — new (durable artifact store)
- `packages/visual-review/src/comparison.ts` — identity-first same-target logic,
  `incomparable`/`visual_unavailable`, geometry/viewport evidence,
  `finalizeArtifactComparison`, thresholds exported
- `packages/visual-review/src/service.ts` — artifact wiring in create/recapture,
  after-snapshot label fix + identity, artifacts preview
- `packages/visual-review/src/types.ts` — statuses, snapshot identity,
  artifacts preview, `elementScreenshot` on RecaptureResult
- `packages/visual-review/src/schemas.ts` — new statuses, identity, artifacts schema
- `packages/visual-review/src/ux.ts` — preview artifacts + visual comparison
- `packages/visual-review/src/index.ts` — new exports
- `packages/visual-review/package.json` — `pngjs`, `@types/pngjs`
- `packages/browser-runtime/src/index.ts` — `captureElementScreenshot` (Phase 28B)
- `packages/mcp-server/src/entry.ts` — artifact store (disabled default),
  adapter element crop, review artifacts in output

Studio:
- `apps/studio/src/index.ts` — policy settings + persistence, artifact +
  review endpoints, baseline capture, recapture adapter, findArtifactOwner
- `apps/studio/src/workflow.ts` — baseline capture at handoff-prepare,
  policy state in workflow state
- `apps/studio/src/ui.ts` — BEFORE/AFTER/DIFF panel, note textarea, consent
  banner (server + client)

Fixtures / scripts / tests:
- `examples/visual-review-app/` — new deterministic fixture (server.cjs + state.json)
- `tests/e2e/visual-regression-corpus.test.ts` — new (10 scenarios)
- `tests/e2e/visual-review-ui.test.ts` — new (changed + unchanged journeys)
- `tests/e2e/visual-review-privacy.test.ts` — new (privacy boundary)
- `tests/e2e/studio-flow.test.ts` — fix becomes a real text change; policy
  explicitly disabled (hermetic)
- `scripts/smoke-phase18-agent-workflow.mjs` — same text-change conversion
- `packages/visual-review/src/visual-review.test.ts`, `pixel-diff.test.ts`,
  `artifact-store.test.ts` — Phase 31 unit tests

Docs:
- `docs/changelog.md`, `MEMORY.md` — Phase 31 entries
- `PHASE31_TRUE_VISUAL_REVIEW_REPORT.md` — this report

## 29. Tests Added / Changed

- `pixel-diff.test.ts` — rewritten: 10 tests (identical, color, tolerance,
  alpha, size-change, diff-image validity, highlight/subdue colors, decode
  errors, config version, position shift)
- `artifact-store.test.ts` — new: 14 tests
- `visual-review.test.ts` — +11 Phase 31 service tests (48 total in file)
- E2E: +14 tests (corpus 10, UI 2, privacy 2)
- `studio-flow.test.ts` — journey updated to a text-change fix

## 30. Exact Validation Commands / Results

| Command | Result |
|---|---|
| `pnpm typecheck` | PASS (0 errors) |
| `pnpm lint` (biome check .) | PASS (0 errors; 107 pre-existing warnings) |
| `pnpm test:ci` | PASS — 950 tests / 46 files |
| `pnpm test:e2e` | PASS — 55 tests / 9 files |
| `pnpm test:dogfood` | PASS — 126 tests / 7 files |
| `pnpm smoke:agent-workflow` | PASS — 26/26 |
| `pnpm build:cli && node scripts/verify-cli-artifact.mjs` | PASS — bundled + packed artifact verified |
| `pnpm release:check` | PASS — exit 0 (see §31A.10) |

## 31. Regression Results

- Phase 27–30 suites: all unit + CI + dogfood + smoke green (above).
- Phase 30A source semantics: unchanged — the review panel still uses
  `sourceResolutionLabel` (exact/probable/possible/weak + ambiguous/
  unavailable wording); no high/medium/low mapping anywhere
  (`ui.ts` server + client; covered by `ui.test.ts` and rendered UI E2E).
- Existing E2E files (`handoff-context-retrieval`, `selector-ambiguity`,
  `resolved-target-consistency`, `studio-ui`, `chat-workflow`, `studio-flow`)
  all green.

## 32. Known Limitations

- Element crops are clamped to the viewport; elements near the page edge get
  less padding context (recorded in the manifest crop rect).
- Box-shadows that extend beyond the bounded padding may be partially
  clipped; the padding is fixed at 24px (bounded 64px max).
- Dynamic content (timestamps/animations) shows as pixel differences and is
  reported honestly; no automatic dynamic-content classification.
- When the policy is disabled, the legacy metadata comparison still applies
  and reports truthfully only what metadata can observe.
- MCP-created reviews use the disabled policy by default (Studio-level
  opt-in); MCP review output includes artifact metadata but no image bytes.

## 33. Deferred Phase 32+ Work

- Retention/storage-management UX for review artifacts (cleanup UI).
- Dynamic-content stabilization and animation warnings.
- Deeper review workflow features (issue history desk, keyboard target
  navigation, Studio decomposition).

## 34. Final Verdict

**PASS.** Every PASS criterion in the Phase 31 objective is met and verified:
real before/after/diff rendering, exact-target recapture, no silent target
replacement, real pixel comparison, unchanged-stays-unchanged, color/
typography/border/size/position/text change detection, incomparable
viewport/DPR handling, persisted decision notes, human decision independent
of automatic status, explicit sensitive/local-only artifact marking, no
artifacts in the agent-safe boundary, opaque protected serving, no absolute
paths, corruption/traversal safety, restart durability, Phase 30A source
semantics preserved, all Phase 27–30 regressions green, and the full release
gate (`pnpm release:check`) passing.

---

# Phase 31A — Visual Review Durability & Consent Closure

Status: PASS
Date: 2026-08-15

Narrow verification/corrective closure for Phase 31. No visual-review
redesign was performed; three evidence gaps were closed with new tests and
three small repository-owned defects found by those tests were fixed (see
§31A.11). Phase 32 was not started.

## 31A.1 Pre-Verification Restart Durability (§1)

New E2E: `tests/e2e/visual-review-durability.test.ts` — "restart before
verification uses the exact original baseline (hash identity, no recapture)".

Real-process reproduction:

```
capture BEFORE (handoff prepared, policy enabled)
→ issueId / handoffId / baseline artifactId / baseline SHA-256 recorded
→ Studio exits (BEFORE any modification)
→ fixture mutated deterministically (background → red)
→ fresh Studio process boots (policy survives, baseline untouched)
→ fresh ReviewArtifactStore + ReviewServiceImpl on the same durable
  .viskod store + REAL Chromium recapture adapter (the Studio/MCP adapter
  contract)
→ createReview(issueId) → recaptureReview → comparison changed
→ review BEFORE is byte-identical to the original baseline
```

Recorded lineage: `issueId`, `handoffId`, `baseline artifact id`
(`art_<32hex>`), baseline SHA-256 and `capturedAt` were captured at
handoff-prepare, before the fixture mutation, and re-verified after restart.

## 31A.2 Baseline Identity Proof (§3)

Deterministic hash identity, proven end-to-end in the same E2E:

```text
beforeHashBeforeRestart  (SHA-256 of .viskod/reviews/baselines/<issueId>/before.png)
===
beforeHashUsedByReviewAfterRestart  (SHA-256 of the review's before.png)
```

Additionally proven:

- the review's `before` manifest entry keeps the ORIGINAL baseline
  `capturedAt` — the copy is not a recapture;
- after restart + verification the baseline dir still contains exactly
  `[before.png, manifest.json]` — no second baseline, no after/diff inside
  the baseline lineage, and the baseline manifest's pairing never grew an
  after/diff artifact;
- the review manifest pairs `afterArtifactId` and `diffArtifactId` to that
  exact original `beforeArtifactId`, and `comparison.status` is `changed`
  computed against it;
- the RESTARTED Studio process reads the review from durable storage and
  reports the same `before.artifactId` and `comparison.status: changed`.

Service-level identity unit tests repeat the byte-equality and timestamp
invariant with fresh store/service instances
(`visual-review.test.ts` "Phase 31A: review after restart uses the exact
original baseline bytes").

## 31A.3 Active-Workflow Restart Limitation (§2)

Determined: Studio does NOT restore an in-flight workflow after restart. The
`StudioWorkflow` state (selection, issueId, handoffId, reviewId) is
in-memory only; after a fresh process the workflow is `idle`, there is no
resume endpoint, and `/workflow/verify/start` for an old issue is rejected
("Create the issue first."). No UI-resume capability was fabricated.

Documented status:

- baseline persistence is durable (proven above);
- active Studio workflow restoration is NOT yet supported;
- user-facing resume/history belongs to the later issue-history phase
  (deferred, consistent with Phase 31 §33).

The strongest currently supported post-restart verification path is
service/persistence level with fresh `ReviewArtifactStore`/`ReviewService`
instances on the same `.viskod` store and a real Chromium recapture adapter
— exactly what the new E2E exercises.

## 31A.4 Missing/Corrupt Baseline After Restart (§4)

New E2E: "fails closed with typed artifact errors — never substitutes or
regenerates a baseline". Baseline captured via the real UI journey, Studio
stopped, then:

- `before.png` removed (manifest remains) → fresh service `createReview`
  fails with typed `ARTIFACT_NOT_FOUND`; no review dir is created; the
  baseline dir keeps `[manifest.json]` only; no post-change image is ever
  captured or substituted; the issue metadata remains retrievable;
- `before.png` corrupted (garbage bytes) → typed `ARTIFACT_INVALID_IMAGE`;
  no NEW review dir appears; no replacement baseline is generated.

"Never manufacture a replacement baseline after modification" holds: the
baseline is written only at handoff-prepare, never during verification.

Unit tests: `artifact-store.test.ts` (missing-file and corrupt-file typed
failures incl. `readBaselineBuffer`; no review dir; baseline dir untouched)
and `visual-review.test.ts` (createReview fail-closed for both cases).

## 31A.5 Default Policy Proof (§5)

New E2E: "fresh Viskod state defaults to disabled and persists no PNGs
without opt-in" (product-level, not a TypeScript default assertion):

- fresh `.viskod` (no settings.json) → `/state` reports
  `visualReviewArtifacts: 'disabled'`;
- the rendered UI shows the consent banner with "Enable local visual
  review" / "Keep disabled" actions — Studio communicates that visual
  comparison requires local-sensitive artifact enablement;
- a full report → handoff journey WITHOUT opt-in persists NO baseline
  directory and NO PNG anywhere under `.viskod/reviews`;
- Verify reports "Visual comparison unavailable — local visual review is
  disabled" — never fabricated pixels;
- workflow state contains no opaque artifact ids (`art_`).

Persistence-level unit test also exists (`artifact-store.test.ts`
"does not persist a baseline while the policy is disabled").

## 31A.6 Enable-Consent Persistence (§6/§9)

New E2E: "enabling via the consent UI persists across restart and keeps the
Phase 29 agent boundary". The REAL consent path is clicked in the rendered
UI (`policy-enable`), not an API shortcut:

1. fresh Studio shows the consent banner;
2. click "Enable local visual review" → banner disappears immediately
   (workflow state synced — see §31A.11 fix 3);
3. `.viskod/settings.json` contains `visualReviewArtifacts:
   'local-sensitive-target-crop'` (atomic write with Windows EBUSY retry —
   §31A.11 fix 2);
4. Studio stopped and restarted → policy remains enabled, `asked: true`;
5. the banner is NOT shown again;
6. a new report captures the baseline normally (PNG + manifest
   sensitive/localOnly) and verification produces a real changed review.

`collectScreenshot` is never treated as consent: consent is exclusively the
explicit policy answer (default `screenshots: true` coexists with
`visualReviewArtifacts: 'disabled'` in the default settings, and the
default-disabled E2E proves no baseline is stored despite screenshots being
enabled).

## 31A.7 Decline/Disable Persistence (§7)

New E2E: "declining keeps visual review disabled across restart with no
PNGs and no re-prompt". The real decline path is clicked
(`policy-disable`):

1. fresh settings → banner shown → decline;
2. settings.json persists `visualReviewArtifacts: 'disabled'`;
3. restart → policy remains disabled, `asked: true`, banner NOT re-shown
   (one-time answered contract: the banner keeps showing only until the
   user explicitly chooses enable or disable — never until an action);
4. report/handoff still works; NO visual-review PNGs are written;
5. Verify reports "Visual comparison unavailable — local visual review is
   disabled".

The important invariant — **never silently enable persistent
screenshots** — holds on both sides of the decision.

## 31A.8 Malformed Settings Fail Closed (§8)

New E2E: "an unexpected visualReviewArtifacts value (and corrupt JSON)
resolves to disabled — never fail open":

- `{"visualReviewArtifacts": "unexpected-value"}` → Studio boots with
  effective policy `disabled` (unknown values fall through to the safe
  default); the live workflow reports `disabled`; the report journey works
  and writes no PNGs; because a settings file exists, the one-time consent
  is not re-shown (safe: no opt-in is offered);
- corrupt non-JSON settings → restart → still `disabled`, never
  `local-sensitive-target-crop`.

No settings-migration framework was built.

## 31A.9 Privacy-Boundary Regression (§9)

Repeated after policy persistence/restart inside the §6 E2E (policy enabled
via consent, Studio restarted, new report + verification):

- review crop exists locally (before.png/after.png/diff.png committed);
- review manifest: `sensitive: true`, `localOnly: true`;
- the persisted agent-safe ContextPacket screenshots stay
  `omitted_sensitive` with `path: null` and never reference the artifact id
  or `reviews/`;
- a FRESH MCP process (`cli serve`) calling `get_handoff_context` with the
  post-restart handoff returns no `art_`, no `reviews/`, no `before.png`,
  no absolute paths, and `tools/list` contains no artifact/image retrieval
  tool.

Persisted consent does not change the Phase 29 agent-safe screenshot
policy. The existing `visual-review-privacy.test.ts` (2 tests) also passed
in the full E2E run.

## 31A.10 Release Gate Proof (§10)

Executed directly:

```text
pnpm release:check
PASS — exit 0
```

Full command: `biome check . && tsc -b && pnpm test:ci && pnpm
test:dogfood && pnpm smoke:agent-workflow && pnpm build:cli && node
scripts/verify-cli-artifact.mjs`

Sub-gate summaries from that execution:

| Step | Result |
|---|---|
| `biome check .` | PASS — 0 errors (107 pre-existing warnings) |
| `tsc -b` | PASS — 0 errors |
| `pnpm test:ci` | PASS — 956 tests / 46 files |
| `pnpm test:dogfood` | PASS — 126 tests / 7 files |
| `pnpm smoke:agent-workflow` | PASS — 26/26 |
| `pnpm build:cli` | PASS — bundled @viskod/cli |
| `node scripts/verify-cli-artifact.mjs` | PASS — artifact verified |

One note: a single release-gate execution observed a one-off flake in the
pre-existing Phase 22 dogfood test `DF22-14` (reopens archived issue;
unrelated to visual review). The same tree passed the full gate twice at
exit 0, and the dogfood suite passed standalone 126/126 both before and
after; no repository-owned failure was introduced by Phase 31A.

## 31A.11 Files Changed

Product fixes (found by the new tests; no redesign):

- `packages/visual-review/src/artifact-store.ts` — corrupt artifact FILE
  reads are now classified as the typed `ARTIFACT_INVALID_IMAGE` (the
  previous string-match check never matched `ImageDecodeError` messages, so
  corrupt files surfaced as the less precise `ARTIFACT_READ_FAILED`).
- `apps/studio/src/index.ts` — `saveVisualReviewPolicy` retries the atomic
  rename on transient Windows `EBUSY` (a consent answer could previously be
  silently dropped from persistence when the destination was transiently
  locked).
- `apps/studio/src/index.ts` + `apps/studio/src/workflow.ts` —
  `StudioWorkflow.setVisualReviewPolicy(policy, asked)` syncs an answered
  consent into the live workflow so the banner disappears immediately
  (previously the workflow snapshot stayed stale until the next
  navigation).
- `examples/visual-review-app/server.cjs` — fixture `writeState` retries on
  Windows `EBUSY` and writes a trailing newline (keeps the runtime-mutated
  state file formatter-clean). Test-fixture only.
- Removed 278 stale, gitignored compiled `src/*.js` (and map/d.ts) files
  left in package `src/` directories — they shadowed real source in vitest
  module resolution (`.js` precedes `.ts`), so tests could run against
  stale compiled code. The current build emits to `dist/` only.

## 31A.12 Tests Added

- `packages/visual-review/src/artifact-store.test.ts` — +3 tests:
  baseline byte/timestamp identity preserved on review copy (no second
  baseline); missing baseline file → typed `ARTIFACT_NOT_FOUND`, no review
  dir, no replacement; corrupt baseline file → typed
  `ARTIFACT_INVALID_IMAGE`.
- `packages/visual-review/src/visual-review.test.ts` — +3 tests:
  `createReview` fail-closed on missing baseline file (no review persisted,
  no fabricated before); fail-closed on corrupt baseline; fresh-instance
  restart review uses the exact original baseline bytes (SHA-256 equality)
  and pairs after/diff to it.
- `tests/e2e/visual-review-durability.test.ts` — NEW, 6 tests: (1)
  pre-verification restart durability + baseline hash identity; (2)
  missing/corrupt baseline fail-closed; (3) default-disabled policy
  product test (banner + no PNGs + verify unavailable); (4) enable-consent
  persistence + restart + privacy regression (incl. fresh-MCP
  `get_handoff_context`); (5) decline/disable persistence + restart; (6)
  malformed-settings fail-closed (unexpected value + corrupt JSON).

## 31A.13 Exact Validation Results

| Command | Result |
|---|---|
| `pnpm typecheck` | PASS — 0 errors |
| `pnpm exec biome check .` | PASS — 0 errors (107 pre-existing warnings) |
| `pnpm test:ci` | PASS — 956 tests / 46 files |
| `pnpm test:e2e` | PASS — 61 tests / 10 files (55 prior + 6 new) |
| `pnpm test:dogfood` | PASS — 126 tests / 7 files |
| `pnpm smoke:agent-workflow` | PASS — 26/26 |
| `pnpm build:cli && node scripts/verify-cli-artifact.mjs` | PASS — bundled + packed artifact verified |
| `pnpm release:check` | PASS — exit 0 |

Post-run environment checks (per objective §11): no orphan Studio/browser
processes; fixture ports 3000/3001/3222/3223/3224/5173 all released; no
`.tmp` residue in `.viskod`; default-disabled tests leave no PNG artifacts
(asserted in-test and via hermetic per-test review-storage cleanup).

## 31A.14 Phase 31A Verdict

**PASS.** Every Phase 31A closure criterion is met: a BEFORE baseline
created prior to modification survives Studio restart; verification after
restart uses that exact original baseline (SHA-256 identity, original
timestamp, no second baseline); missing/corrupt baselines fail closed with
typed errors and are never replaced or silently recaptured; the visual
review artifact policy defaults to disabled; enabling requires explicit
user action; both enable and decline persist across restart; malformed
settings fail closed; persistent consent does not alter the Phase 29
agent-safe screenshot policy; `get_handoff_context` still cannot expose
review artifacts; the report records an explicit successful `pnpm
release:check` (exit 0); and all Phase 27–31 regressions remain green.
