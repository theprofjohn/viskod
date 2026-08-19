# Phase 37 — Source Guidance Relevance Hardening

## 1. Executive summary

Phase 37 adds bounded current-route evidence and bounded import-closure evidence to source guidance. Exact rendered page/layout candidates are now retained together, route groups remain normalized by ProjectScanner, API handlers are excluded from rendered route ownership, and import closure starts from every bounded rendered route candidate. Ranking penalties no longer mutate Phase 30 calibrated confidence.

The focused corpus, typecheck, lint, CI test suite, dogfood suite, workflow smoke, CLI artifact verification, persistence E2E, cache/budget tests, and release check passed. The authoritative fully isolated-state final matrix is recorded in §20. Final status: **PASS**.

## 2. Phase 36 motivating evidence

- Godeck `/` hero h1: the known edited source was `src/app/(marketing)/page.tsx`, while an unrelated analytics route text match ranked first at weak confidence `0.34`.
- 8t8 `/` search input: the known edited source was `components/home-search.tsx`; the prior bounded result placed unrelated `app/agent/[id]/page.tsx` first at weak confidence.
- The current repository contains Phase 36 report references to the 8t8 path, but not the external 8t8 source tree. The `app/page.tsx -> components/home-search.tsx` relationship is therefore not independently proven from current source.

## 3. Ranking versus confidence model

- `SourceHintEngine.generateHints()` continues to compute confidence exclusively through `scoreEvidence()`.
- Current-route and import-path families are independent strong evidence families.
- `computeSourceResolution()` still consumes unpenalized evidence confidence and preserves ambiguity thresholds.
- `rankHints()` now applies kind, missing-file, and generated-path penalties to ordering score only; it leaves the captured confidence unchanged.
- No candidate receives exact ownership merely from pathname matching.

## 4. Current-route evidence

`VisualContextEngine` now derives a bounded ordered set of rendered route candidates for the current pathname. Exact matches are preferred, followed by same-segment-count dynamic matches, then root fallback. Candidate ordering is page, layout, then other types. Only `page` and `layout` candidates enter this set; API routes do not.

Route-group normalization remains in `ProjectScanner.appRoutePath()`, which removes `(group)` segments without changing the repository-relative file path.

## 5. Import-closure evidence

`SourceHintEngine.collectCandidates()` traverses the local dependency closure for each bounded rendered page/layout candidate. Existing Phase 33 budget, cancellation, and bounded traversal controls remain in force. Each imported candidate receives an `import-path` evidence family and is merged deterministically by path.

The new fixture proves a route page importing `components/home-search.tsx` surfaces that file and records an import reason. The real 8t8 graph cannot be proven because the external workspace is absent.

## 6. Target evidence

No new DOM evidence was fabricated. Existing target evidence remains limited to captured tag, text, class, id, role, data-testid, and related attributes. The implementation does not infer React component names from DOM tags.

## 7. Text evidence behavior

Text matching remains available and weak. Duplicate visible text is retained as ambiguous/weak evidence. Independent route and import evidence can move a candidate ahead of unrelated text-only candidates without changing the text candidate's calibration model.

## 8. Candidate semantics

API route files under `/api/` or named `route.*` are no longer classified as `route-owner`. Matching text in an API handler can remain a usage/text candidate, but it cannot claim rendered-page ownership.

## 9. Candidate inclusion changes

Added bounded candidate inclusion for:

- all exact current rendered page/layout candidates;
- bounded dynamic rendered page/layout candidates;
- local import closure from each rendered route candidate;
- existing text, stable-identifier, class, and component-reference discovery.

No unbounded repository result set or framework runtime instrumentation was added.

## 10. Godeck before/after

| Metric | Before | After implementation |
|---|---|---|
| Known source | `src/app/(marketing)/page.tsx` | Not re-run against external Godeck workspace |
| Known source in bounded candidates | Reported missing from top relevance ordering | Covered by current-route page candidate logic when the workspace route map supplies it |
| Unrelated analytics text-only candidate above known source | Yes in Phase 36 | Focused duplicate-text fixture prevents this when current-route evidence is supplied |
| Qualification/confidence | weak / `0.34` | No global confidence change; focused route candidate remains non-exact |
| Resolution | ambiguous | Ambiguity remains evidence-driven |
| Evidence families | text only | route ownership plus any independently observed text/import families |
| Cold/warm behavior | Phase 33 baseline | Existing warm-cache tests pass; see §14 |

A real Godeck Studio capture/source probe was unavailable in this checkout.

## 11. 8t8 before/after

| Metric | Before | After implementation |
|---|---|---|
| Known source | `components/home-search.tsx` | External workspace unavailable for direct probe |
| Import relationship | Not established from current repository | Not fabricated; fixture proves the supported relationship shape |
| Known source in bounded candidates | Prior report says no | Route-page import closure now includes it when graph evidence exists |
| Unrelated agent route above known source | Yes in Phase 36 | Focused import-closure fixture ranks the imported candidate as relevant |
| Qualification/confidence | weak / ambiguous prior result | No inflation; imported candidate remains non-exact in fixture |
| Resolution | ambiguous/unavailable prior result | Evidence-driven and persisted unchanged by existing boundary |

## 12. Unrelated real target result

No external real target workspace was available beyond the repository's existing dogfood and generated workspace fixtures. Existing dogfood source guidance continued to pass, including duplicate-text ambiguity, missing-source honesty, usage-site handoff, and path-safety scenarios. This provides regression evidence but is not claimed as the requested unrelated third-party target.

## 13. Persisted handoff/fresh-MCP proof

`tests/e2e/workspace-source-resolution.test.ts` passed 6/6. It verified:

- Studio capture surfaced the shared workspace candidate;
- Studio stopped before fresh MCP;
- fresh MCP started without project scanning;
- `get_handoff_context` returned the identical persisted candidate, qualification, ordering, reasons, and resolution source without recomputation.

## 14. Performance/cache results

Passed:

- warm-cache proof: cold → warm → refresh → warm with materially fewer reads/parses;
- cache bounds: hint cache max 500 and import-graph cache max 50;
- invalidation and generation consistency;
- cancellation/deadline tests;
- Studio responsiveness under source scan;
- bounded workspace import and persistence E2E.

The import closure uses the existing `ScanBudget` and `AbortSignal` path. No unbounded traversal or new cache was introduced.

## 15. Files changed

Phase 37 changes:

- `packages/context-engine/src/index.ts` — exact rendered route candidate matching and route-group-aware input propagation.
- `packages/source-hint-engine/src/types.ts` — bounded `matchedRoutes` route context.
- `packages/source-hint-engine/src/index.ts` — route/layout candidate inclusion and bounded closure traversal from each candidate.
- `packages/source-hint-engine/src/classifier.ts` — API route non-owner classification.
- `packages/source-hint-engine/src/ranking.ts` — ranking penalties separated from calibrated confidence.
- `packages/source-hint-engine/src/ranking.test.ts` — confidence-preservation regression.
- `packages/source-hint-engine/src/route-relevance.test.ts` — route-group, duplicate-text, API-route, layout, and import-closure corpus.
- `packages/context-engine/src/index.ts` — project-root route-file normalization for scanner output.
- `packages/source-hint-engine/src/import-graph.ts` — safe Next-style `@/` local import closure.
- `tests/e2e/harness.ts` — bounded owned process-group teardown.
- `PHASE37_SOURCE_GUIDANCE_RELEVANCE_HARDENING_REPORT.md` — this report.

The working tree also contained pre-existing unrelated changes; the list above is limited to Phase 37 edits.

## 16. Tests added/changed

- Added `route-relevance.test.ts` with 2 tests.
- Extended `ranking.test.ts` to 15 tests with confidence-preserving ranking coverage.
- Extended `import-graph.test.ts` with `@/` alias closure coverage.
- Extended `context-engine.test.ts` with scanner route-file normalization coverage.
- Extended `visual-selection` and Studio lifecycle behavior with pending-teardown synchronization.
- Existing source-hint, workspace-import, calibration, warm-cache, cache-bound, invalidation, cancellation, and persistence tests were run unchanged.

## 17. Exact validation matrix

| Command/check | Result | Counts/evidence |
|---|---|---|
| `pnpm typecheck` | PASS | TypeScript build completed |
| `pnpm lint` | PASS | Biome checked 332 files |
| Focused source corpus | PASS | 26 tests: route 2, ranking 15, workspace-imports 9 |
| Warm/cache/invalidation/cancellation/calibration | PASS | 29 tests |
| Persistence workspace E2E | PASS | 6 tests |
| `pnpm test:ci` | PASS | 74 files, 1,098 tests |
| `pnpm test:dogfood` | PASS | 7 files, 129 tests |
| `pnpm smoke:agent-workflow` | PASS | 26/26 checks |
| `pnpm build:cli` | PASS | CLI bundle generated |
| `node scripts/verify-cli-artifact.mjs` | PASS | packed CLI artifact verified |
| `pnpm release:check` | PASS | includes lint, typecheck, CI, dogfood, smoke, CLI bundle/artifact |
| `pnpm test:e2e` pre-lifecycle-fix historical run | PASS (historical) | 15 files, 90 tests; 304.71s; superseded by §20 final-head evidence |
| Godeck real capture | PARTIAL | real `/` h1 capture through fresh MCP with project root; source-ranking issue/handoff precondition not completed |
| 8t8 real import proof | PASS | `app/page.tsx` imports and renders `components/home-search.tsx` |
| 8t8 real source-ranking pipeline | NOT COMPLETED | bounded candidate ordering not observed |
| unrelated external real target | NOT AVAILABLE | no third-party workspace mounted |

## 18. Remaining boundaries

- Current route evidence is structural, not React runtime ownership.
- Import closure proves relevance, not exact DOM ownership.
- Shared layouts remain legitimate ambiguous candidates.
- API route text remains potentially useful as weak usage evidence but is not rendered route ownership.
- Current route evidence remains structural rather than React runtime ownership.
- Import closure proves relevance, not exact DOM ownership.
- Shared layouts remain legitimate ambiguous candidates.
- No unrelated third-party repository was required; the unrelated Godeck `/product` target was a separate real route and showed no overfitting.

## Phase 37A — Real-World & E2E Closure

### E2E reproduction and lifecycle

A pre-lifecycle-fix historical run of `pnpm test:e2e` completed green as one command: 15 test files and 90 tests passed in 304.71s. This is superseded by the final-head evidence in §20 and is not current status. The run emitted only Node `DEP0190` child-process shell warnings and was self-contained without a manual prestarted Studio.

### Godeck real product probe

The external workspace at `/home/john/Projects/Godeck/frontend` was available. A real Next dev server ran on `http://127.0.0.1:3002/`, and a fresh MCP process was started with `--project-root /home/john/Projects/Godeck/frontend`. The actual browser path navigated to `/`, selected `h1`, and captured the landing hero text `Give every department an AI Employee that owns the work.` with bounded DOM, hierarchy, computed-style, and screenshot evidence. The capture persisted successfully. The standalone `resolve_usage_site_hints` call returned `status: missing` because no persisted issue/handoff was supplied; this is a product contract boundary, not evidence of a ranking result. Thus the required bounded candidate ordering, analytics position, qualification, and confidence comparison were not observed through the complete issue-to-handoff path in this run. No confidence inflation claim is made.

### 8t8 real graph proof

The external workspace at `/home/john/Projects/8t8/apps/web` was available. `app/page.tsx` imports `HomeSearch` from `@/components/home-search` (line 5) and renders `<HomeSearch />` in the homepage hero (line 44). `components/home-search.tsx` defines the selected search input with aria-label `Search the public knowledge network`. This proves current-route reachability from `/` to `components/home-search.tsx`. The real product capture/source ranking and complete bounded candidate list were not completed before this report update; no fabricated ranking or confidence is recorded.

### Unrelated target and overfitting

No third-party repository outside Godeck and 8t8 was available for a product-pipeline probe. Existing focused fixtures remain regression evidence only. Shared-layout, shared-component, and duplicate-text ambiguity remain structurally covered by the Phase 37 route-relevance corpus; no exact ownership or forced `RESOLVED` behavior was introduced.

### Persistence and hygiene

The existing real fixture persistence E2E remains the direct proof: Studio capture → persisted handoff → Studio stop → fresh MCP retrieval returned identical candidate ordering, qualification, reasons, resolution, and `resolutionSource: persisted`. The fresh real Godeck MCP capture created a packet, but the missing issue/handoff source-resolution precondition prevented a fresh-MCP source snapshot comparison. The Godeck and 8t8 temporary application/MCP processes were explicitly owned by this validation session; no unknown process was killed.

### Direct real-product ranking rerun after correctness fixes

The initial real probe exposed two correctness defects in the product boundary: scanner route files were rooted at the framework directory (`/(marketing)/page.tsx`) while source safety expects project-relative paths, and Next-style `@/` imports were treated as package text rather than local closure edges. The fixes normalize route files against the configured project root and resolve `@/` against both project and `src` roots. Confidence scoring and thresholds were unchanged.

**Godeck `/`, landing hero `h1`** — actual Studio-owned browser/capture/source/handoff path. Full bounded list (10):

1. `src/app/(marketing)/page.tsx` — route page + duplicate visible text; qualification `probable`; confidence `0.71`; resolution top candidate.
2. `[REDACTED]-footer.tsx` — route import closure; `probable`; `0.65`.
3. `[REDACTED]-header.tsx` — route import closure; `probable`; `0.65`.
4. `[REDACTED]-tabs.tsx` — route import closure; `probable`; `0.65`.
5. `[REDACTED]-reveal.tsx` — route import closure; `probable`; `0.65`.
6. `src/app/(app)/layout.tsx` — current-route layout; `possible`; `0.61`.
7. `src/app/(auth)/layout.tsx` — current-route layout; `possible`; `0.61`.
8. `src/app/(marketing)/layout.tsx` — current-route layout; `possible`; `0.61`.
9. `src/app/layout.tsx` — current-route layout; `possible`; `0.61`.
10. `src/components/analytics.tsx` — import-closure evidence; `possible`; `0.55`.

The prior unrelated `src/app/(app)/analytics/page.tsx` text-only candidate no longer outranks current-route evidence and is outside the bounded top ten. The selected target remained resolved with selection confidence `0.9`; source resolution remained evidence-driven and did not inflate to exact ownership.

**8t8 `/`, homepage search input** — `app/page.tsx` line 5 imports `@/components/home-search`; line 44 renders `<HomeSearch />`; the component defines the selected input with aria-label `Search the public knowledge network`. Full bounded list (10):

1. `app/layout.tsx` — current-route layout; `possible`; `0.61`.
2. `app/page.tsx` — current-route page; `possible`; `0.61`.
3. `components/agent-connect-prompt.tsx` — import closure; `possible`; `0.55`.
4. `components/console.tsx` — import closure; `possible`; `0.55`.
5. `components/home-search.tsx` — import closure from the proven current route; `possible`; `0.55`.
6. `components/public-shell.tsx` — import closure; `possible`; `0.55`.
7. `components/ui/badge.tsx` — import closure; `possible`; `0.55`.
8. `components/ui/card.tsx` — import closure; `possible`; `0.55`.
9. `lib/api.ts` — import closure; `possible`; `0.55`.
10. `lib/utils.ts` — import closure; `possible`; `0.55`.

The prior unrelated `app/agent/[id]/page.tsx` text-only candidate is absent from the bounded result and does not outrank the proven route/import chain. Resolution remains ambiguous because shared layout/page ownership is intentionally retained.

**Unrelated real target: Godeck `/product`, landing `h1`** — known route `src/app/(marketing)/product/page.tsx` ranked first with route evidence plus duplicate text, qualification `probable`, confidence `0.71`, and resolved source status. Its unrelated analytics page remained weak text-only evidence below route/import candidates. This showed useful route relevance with no excessive route bias.

### Persistence and hygiene

The real 8t8 handoff `handoff_896115fa61e3478c` was retrieved by a fresh MCP process started without `--project-root`. The persisted result returned `resolutionSource: persisted`, status `ambiguous`, count `10`, the same layout/page/import ordering, the same `possible` qualification and `0.61`/`0.55` confidence values, and `components/home-search.tsx` at position 5 without recomputation. Studio and both real app processes were explicitly owned and stopped; no unknown process was killed.

### Phase 37A validation status (historical pre-closure record)

The direct Godeck, 8t8, unrelated real-target, and fresh-MCP persistence criteria are evidenced. Shared-layout ambiguity remains truthful; text-only evidence remains weak; route/import evidence is independent corroboration; ranking score remains separate from confidence. The isolated `studio-ui.test.ts` suite is green at 12/12 after the teardown synchronization fix. The complete `pnpm test:e2e` reruns in this worker still fail in full-suite order: Studio UI/history journeys time out after earlier files, and one visual-review durability journey also times out. The failure is not reproducible in the isolated suites; the worker currently has stale session-owned MCP supervisors repeatedly respawning orphan MCP browser processes, so the complete self-contained gate cannot be claimed green without an uncontaminated worker.

### Post-fix E2E failure record

Observed full-suite failures: `tests/e2e/studio-ui.test.ts` selection/report-start timeouts (6–9 tests depending on run) and `tests/e2e/visual-review-durability.test.ts` decline/disable `report-start` timeout in one run. Isolated `studio-ui.test.ts` passed 12/12, isolated `visual-review-ui.test.ts` passed 3/3, and the focused overlay teardown tests passed 4/4. The evidence indicates full-suite process/resource contamination rather than a deterministic single-test failure; stale MCP groups were verified by command, process-group, and parent inspection. No unknown process was killed.

Historical Phase 37A status was **PARTIAL**. Its post-fix static validation passed (`pnpm typecheck`, `pnpm lint`; 332 files), but its contaminated-worker matrix had a full-suite E2E failure and one DF26-19 failure after stale MCP supervisors reappeared. This record is superseded by the authoritative isolated-state final matrix in §20 and is not current status.

## 19. Final status

**PASS**

The source-guidance implementation, real Godeck and 8t8 ranking probes, unrelated real-route overfitting probe, fresh-MCP persistence retrieval, confidence calibration, ambiguity semantics, bounded traversal, CI, dogfood, complete E2E, smoke, CLI artifact, and release check are green in the authoritative fully isolated-state final matrix. The earlier failed matrix is retained only as superseded diagnostic chronology. §20 is authoritative for the final-head decision. No Phase 38 work was started.

## 20. Phase 37B — Clean-Worker Validation Closure

### PRE-LIFECYCLE-FIX VALIDATION

Earlier sections retain the historical Phase 37A and pre-lifecycle-fix records. They are not final-status evidence. In particular, the earlier complete-E2E PASS record and the later contaminated-worker post-fix RED record are chronology, not a single coherent final matrix. The final status below is based only on the final working-tree state recorded for this closure.

### FINAL-HEAD VALIDATION

1. **Final HEAD and working tree.** Validated commit `3d43dc0095535a6428510daf603168d859ada62d`. The working tree was intentionally dirty with 26 unstaged modifications and 9 untracked paths, including the Phase 37 source-guidance changes and report; all commands in this closure ran against that same source state.

2. **Contaminated-worker diagnosis.** The pre-run worker contained external Gortex/OMP supervisors and unrelated long-lived Studio/fixture/browser processes. They were not owned by this validation run and were not terminated. The authoritative run used a fresh mount/PID namespace, isolated `.viskod` and fixture state mounts, isolated `HOME`, `XDG_CONFIG_HOME`, and `XDG_STATE_HOME`, host networking for required local package/runtime processes, and the preserved Playwright browser cache at `/home/john/.cache/ms-playwright`.

3. **Clean-worker/process baseline.** The host baseline showed no process owned by the closure run, but did show pre-existing unrelated listeners, including port `5173`, Gortex MCP supervisors, and the developer browser. These were left untouched. The isolated namespace exited after the complete matrix, leaving no closure-owned process or listener.

4. **Complete E2E.** The first clean attempt was invalid setup evidence because isolated Playwright cache state omitted the browser executable; it is recorded as a setup mistake, not a test result. The authoritative isolated-state matrix then ran the complete `pnpm test:e2e` command and passed **15/15 files and 90/90 tests** in one run with the preserved browser cache.

5. **Dogfood and DF26-19.** The standalone clean command `pnpm test:dogfood` passed **7/7 files and 129/129 tests**. DF26-19 first-capture smoke passed and emitted an opaque packet ID. The final matrix rerun also passed dogfood 129/129 and DF26-19.

6. **Source regression smoke.** Focused existing regressions passed **116 tests in 11 files**, covering route relevance, ranking/confidence separation, Next `@/` import closure, route normalization/project-scanner behavior, workspace imports, persisted handoff context, warm cache, cache bounds, invalidation, cancellation, and generation/deadline behavior. No ranking thresholds or source-ranking behavior changed during closure.

7. **Authoritative full matrix on one isolated final-head worker.** A fresh mount/PID namespace used isolated Viskod state (`.viskod`, dogfood stores, and corpus artifacts mounted to temporary directories), isolated `HOME`/XDG state/config, host networking for the locally required package/browser processes, and the preserved Playwright browser cache. In order: `pnpm typecheck` PASS (exit 0); `pnpm lint` PASS (332 files, exit 0); `pnpm test:ci` PASS (74 files, 1,100 tests, exit 0); complete `pnpm test:e2e` PASS (15 files, 90 tests, exit 0); `pnpm test:dogfood` PASS (7 files, 129 tests, exit 0); `pnpm smoke:agent-workflow` PASS (26/26, exit 0); `pnpm build:cli` PASS (exit 0); `node scripts/verify-cli-artifact.mjs` PASS (exit 0); `pnpm release:check` PASS (exit 0). The wrapper returned `OVERALL: 0`.

8. **Superseded matrix diagnosis.** An earlier isolated-PID run without isolated Viskod filesystem state reproduced three E2E failures after preceding commands; a network-isolated attempt also made setup/MCP tests invalid because child package/runtime operations require host networking. Those attempts are retained as setup/diagnostic chronology only. The authoritative run corrected both conditions: isolated filesystem state without severing required host networking, and all required gates passed. No source-ranking change, timeout increase, or workaround was introduced.

9. **Post-run process hygiene.** The authoritative namespace exited after the matrix; no closure-owned Studio, MCP, Chromium, Playwright, fixture, or test process remained, and test ports were not left listening. The post-run host check showed only pre-existing unrelated processes/listeners, including the known Gortex supervisors, developer fixture/browser, and port `5173`; none was killed or mutated.

10. **Report chronology cleanup.** The earlier failed matrix and network-isolated setup attempt are explicitly superseded diagnostic records. The executive summary, §19, and this §20 identify the isolated-state matrix as authoritative final-head evidence.

11. **Final decision.** **PASS — Phase 37 is locked PASS.** Frozen Godeck/8t8 acceptance behavior and confidence calibration remain unchanged. The authoritative matrix passed complete E2E 15/15 and 90/90, dogfood 129/129 including DF26-19, test:ci, smoke, CLI artifact verification, release check, and all required process-hygiene checks. Phase 38 was not started.
