# PHASE 30 — SOURCE RESOLUTION CORRECTNESS & STUDIO INTEGRATION

**Status: PASS** (all gates executed and green — see §26)
**Date:** 2026-08-15
**Repositories affected:** `packages/source-hint-engine`, `packages/context-engine`, `packages/agent-handoff`, `packages/mcp-server`, `packages/cli`, `packages/project-scanner`, `apps/studio`, `examples/source-hint-ambiguity-app` (new fixture), `tests/e2e`, `docs`.

---

## 1. Executive summary

Viskod's visual-target → source-code guidance is now calibrated, explainable,
and available through the real Studio → handoff → fresh-agent workflow.

The confidence-inflation audit (VISKOD-AUDIT-008) is fixed at the evidence
model, not by nudging decimals: candidates are scored from explicit,
independently classified evidence signals with hard caps, so
text-only/generic-component-only matches can never reach `probable`/`exact`.
Equally plausible candidates are represented as `ambiguous`; no-evidence,
unknown-root, unsupported-layout, and budget-exhaustion conditions return
`unavailable` — never a fabricated path. Studio now composes ProjectScanner +
SourceHintEngine from an **explicit** `--project-root` (never a cwd-walk
guess), persists qualified repository-relative hints through the Phase 29
redaction boundary, and a fresh MCP process retrieves the bounded qualified
candidates from the durable capture without recomputation. Persisted
ambiguity survives the process boundary.

**Key rule honored: WRONG-BUT-CONFIDENT IS WORSE THAN UNAVAILABLE.**

## 2. Findings confirmed / not reproducible

| Finding | Status | Evidence |
|---|---|---|
| Usage-site candidates scored 0.90–0.99 from broad text matching | **Confirmed** | `findUsageSiteCandidates` used `confidence = 0.9 + matchRatio * 0.09`; usage-site was sort-tier 0 (highest). |
| Class-name file existence awarded 0.95 (exact) / 0.85 (case-insensitive) | **Confirmed** | `collectResolvedCandidates` hard-coded these. |
| Generic `div` inferred as `Card` component | **Confirmed** | `if (dc.role === 'card' \|\| dc.className?.includes('card') \|\| dc.tagName === 'div') componentNames.push('Card')`. |
| Studio composes no SourceHintEngine / no project context (VISKOD-AUDIT-002) | **Confirmed** | Studio bootstrap `new VisualContextEngine({...})` had no `sourceHintEngine`; `setProjectContext` never called; Studio captures reported `sourceHints: []`. |
| VCE never supplied `matchedRoute` to the hint engine | **Confirmed** | `hintInput.route` carried only `url`/`pathname`; route-ownership evidence never fired in real captures. |
| MCP `create_agent_handoff` / `get_project_info` guessed project via cwd-walk | **Confirmed** | `projectScanner.scan()` with no root walks up from `process.cwd()`. |
| Persisted handoff brief dropped hint metadata | **Confirmed** | `AgentIssueBriefSchema` allowed only `{displayName, confidence}` — `kind/score/reasons/warnings` were stripped on save (lossy); `qualification/resolution` would have been too. |
| Legacy `generated-non-existing` ghost candidates | **No longer applicable** | Removed by design: §8 forbids plausible-looking paths that do not exist. |

## 3. Source-resolution architecture before/after

**Before**

```
DOM context → 3 parallel matchers (class-exists / legacy evidence / usage-site text)
             → merge with hard-coded confidences (0.90–0.99 usage-site, 0.95 exact)
             → sort by matchType tier → SourceHint[]  (no qualification, no resolution)
```

**After**

```
DOM context + route context + project context (explicit root + route map)
  → evidence collection (route-ownership, import closure, usage-text w/ uniqueness,
    class-file/generic-class, stable-identifier, component-ref, style-adjacent)
  → scoreEvidence() (family bases + independent-family bonuses + calibration caps)
  → deterministic sort (qualification → confidence → strong-family count → path)
  → SourceHint[] with qualification + reasons
  → computeSourceResolution() → resolved | ambiguous | unavailable
  → packet (redacted) → persistence → projection (bounded candidates) → MCP
```

## 4. Previous confidence inflation reproduction

Before-state (code-read reproduction, `packages/source-hint-engine/src/index.ts`):

- `UsageSiteCandidate.confidence = 0.9 + matchRatio * 0.09` (max 0.95): any file
  containing the target's visible words scored ≥ 0.90 and ranked tier 0.
- `collectResolvedCandidates`: class `target-card` → `src/components/target-card.jsx`
  existing → `confidence 0.95` (`exact`) or `0.85` (case-insensitive).
- Generic `div` (tagName check) → component name `Card` → any file containing
  `Card` matched at 0.90+.
- Reasons were flat: `"Usage-site: file contains visible text X and references Card"`.

After-state (E2E, real phase12 fixture, §21/§22): candidate
`src/components/TargetCard.jsx`, `qualification: possible`, `confidence: 0.54`,
reason `visible text (this, card, target, …) found only in this file`. The same
target never reaches `probable`/`exact` without route/import/identifier
corroboration.

## 5. Final trust/qualification model

Every candidate carries a semantic qualification derived **from evidence**:

- `exact` — direct, stable, verifiable association (multiple independent strong
  signals agree on one file). Effectively rare under the calibration caps.
- `probable` — independent evidence corroborates one file (unique text + route
  ownership + import path, stable identifier + corroboration, …).
- `possible` — a single moderate signal (unique visible text, class-file
  existence) with no corroboration.
- `weak` — duplicate text, generic class, generic component reference. Never
  presented as ownership.

Overall result state: `resolved | ambiguous | unavailable`.

Numeric confidence (0–1, 4dp) is the evidence score and maps consistently to the
qualification bands: exact ≥ 0.90, probable ≥ 0.65, possible ≥ 0.35, weak ≥ 0.30,
below 0.30 filtered. Schema version of generated hints bumped to `2.0.0` so a
caller can never mistake a legacy inflated value for a calibrated one.

## 6. Evidence-strength classification

| Family | Strength | Notes |
|---|---|---|
| `route-ownership` | strong | current matched route file (route map from explicit scan) |
| `import-path` | strong | candidate in the route file's transitive local import closure |
| `stable-identifier` | strong | file literally defines the target's `id`/`data-testid` |
| `usage-text` | weak→moderate | unique text base 0.48; duplicate text base 0.34 |
| `class-file` | moderate | generated path from a SPECIFIC class token exists |
| `generic-class` | weak | token in the generic set (`card`, `button`, `flex`, …) |
| `component-ref` | weak | file references a component name from explicit `data-component`/`data-slot` (never from a bare `div`) |
| `style-adjacent` | weak | dependent on the class-file family — never an independent bonus |

Text variants (exact + normalized) are one family — two variants of the same
heuristic never corroborate each other.

## 7. Confidence combination rules

```
confidence = max(family bases, unique-text base 0.48) 
           + 0.1 per additional independent family (cap +0.2)
           + 0.06 unique-text bonus (text family present and unique)
           + 0.06 exact-route-file bonus (candidate IS the matched route file)
```

Hard caps (the calibration boundary — no formula bypasses them):

- without a strong family → ≤ 0.62 (never probable);
- text-only / generic-component-only → ≤ 0.60;
- single weak family (duplicate text / generic class / component-ref) → ≤ 0.42.

## 8. Ambiguity rule (deterministic)

```
no candidates                        → unavailable
top is exact                         → resolved
margin(top, second) < 0.02           → ambiguous (effectively tied)
same qualification && margin < 0.08  → ambiguous (equal-tier, too close)
top is weak (single)                 → unavailable (weak evidence ≠ claim)
otherwise                            → resolved
```

No random tie-breaking anywhere; ties resolve by stable relative path ordering.

## 9. Unavailable rule

`unavailable` is a first-class result for: unknown project root (no
`--project-root`), unsupported/invalid root (scan failure), no candidate ≥ 0.30,
scan budget exhaustion, or source hints disabled. Phase 29's evidence-status
model reports it truthfully (`state: unavailable` with a sanitized diagnostic
code — e.g. `SH_NO_ROOT_PATH`, `SH_BUDGET_EXCEEDED`) and never fabricates a path
to fill the field.

## 10. Candidate explanation schema

Persisted `SourceHintEntry` (and the agent projection):

```jsonc
{
  "filePath": "src/components/TargetCard.jsx",   // repository-relative
  "confidence": 0.54,
  "qualification": "possible",
  "reasons": ["visible text (this, card, target, …) found only in this file"],
  "evidence": "visible text (…) found only in this file",
  "matchType": "usage-site",
  "exists": true
}
```

Reasons distinguish observed evidence (`visible text …`, `file defines the
target's stable identifier …`, `current route /settings maps to this file`) from
weak/inferred evidence (`generic class 'card' — weak evidence`, `visible text …
also appears in other files — weak evidence`). Ambiguity is a result-level state,
never a per-candidate claim.

## 11. Deterministic ordering

Ordering key: qualification tier (`exact` > `probable` > `possible` > `weak`) →
confidence → strong-family count → repository-relative path (`localeCompare`).
Directory enumeration is explicitly sorted before walking, and the project-file
scan visits files in sorted order. Repeated-run tests prove identical output
(`calibration.test.ts` "deterministic candidate ordering").

## 12. Generic Card / text heuristic changes

- The `div → Card` inference is **removed**. Component names come only from
  explicit `data-component`/`data-slot`/`data-layer` attributes.
- Class tokens in the generic set (`card`, `button`, `flex`, `grid`, `status`, …)
  produce `generic-class` evidence (base 0.30, weak) — never domination.
- Text matching is word-boundary (`\b`), so the identifier `SaveButton` never
  matches the word `save`.
- Regression tests: `source-hint-engine.test.ts` "never generates a Card
  candidate from a generic div alone" and "a generic div with class card never
  yields high confidence for card.tsx"; calibration corpus C.

## 13. Calibration corpus / results

`packages/source-hint-engine/src/calibration.test.ts` — 11 tests, all green:

| Case | Expected | Result |
|---|---|---|
| A. Unique component (route + import + unique text) | one top candidate, probable, deterministic | `resolved`; `src/features/settings/SaveButton.tsx` `probable` 0.71; identical re-run |
| B. Duplicate visible text | no high/exact; ambiguous | `ambiguous`; both `weak`, reasons mention other files |
| C. Shared design-system Card vs feature page | no unjustified certainty | top < 0.90; qualifications `possible`/`weak`; never probable/exact when unresolved |
| D. Wrapper component | wrapper wins over shared primitive | `src/features/payments/Wrapper.tsx` `possible`; Button never probable/exact |
| E. Current-route corroboration | route candidate stronger than off-route text | `resolved`; route file `probable`, off-route `weak` |
| F. Repeated labels ("Save" ×3) | no high-confidence text-only source | all `weak`; status `ambiguous`/`low_confidence` |
| G. No evidence | unavailable, not fabricated | `unavailable`; empty topHints; no invented path |

## 14. Studio project-context composition

Studio bootstrap now constructs `ProjectScanner` + `SourceHintEngine` and passes
`sourceHintEngine` to `VisualContextEngine` (VISKOD-AUDIT-002 closed). The scan
populates `vce.setProjectContext(...)` including the route map, so
route-ownership and import-closure evidence work in Studio captures. No
duplicate construction: Studio reuses the exact `ProjectScanner`/`SourceHintEngine`
classes the CLI/MCP compose.

## 15. Project-root determination contract

Studio never guesses the target project from `process.cwd()`. The only trusted
sources are:

1. `--project-root <path>` CLI argument, or
2. `VISKOD_PROJECT_ROOT` environment variable,

both resolved and validated (must contain a `package.json`; the scan must
succeed). Status is exposed as `ready | invalid | unknown` in `/health`,
`/project/status`, and `/state` with a sanitized reason. Without a root, source
resolution reports `unavailable` with an actionable reason. The MCP server has
the identical contract via `viskod serve --project-root <dir>`.

## 16. Studio source-resolution UI/status

- `StudioWorkflowState.source` (`/workflow/state`): `{ resolution, status, count,
  candidates[{path, qualification, confidence, reasons}] }` — repository-relative
  paths only, bounded to 5 candidates.
- Compact status panel rendered in the `describe` and `handoff_ready` screens:
  "Source: probable source found" / "Source: ambiguous — multiple candidates" /
  "Source: unavailable". Ambiguity is presented as ambiguity; the first candidate
  is never displayed as confirmed (`data-source-resolution` attribute + distinct
  styling).
- `/source/status` endpoint mirrors the current packet's source status.

## 17. Persisted source-hint representation

The Phase 29 safe packet (`sourceHints: SourceHintEntry[]`) now persists
`qualification` and `reasons` alongside the calibrated `confidence` and the
repository-relative `displayPath`. `ContextPacket.sourceHintsResolution` is set
at capture time for in-memory consumers; the persisted candidates carry all data
needed to re-derive resolution deterministically after restart. `packet.json` is
schema-validated before write (sourceHints entries are opaque to
`PersistedPacketSchema`, so the additive fields round-trip).

## 18. Agent projection changes

`AgentProjectionSourceHints` (returned by `get_handoff_context`) is now:

```jsonc
{
  "status": "collected",
  "resolution": "resolved",          // derived from persisted evidence
  "count": 1,
  "candidates": [{
    "path": "src/components/TargetCard.jsx",   // repo-relative
    "qualification": "possible",
    "confidence": 0.54,
    "reasons": ["visible text (…) found only in this file"]
  }]
}
```

Bounded: ≤ 5 candidates (`maxSourceHints`), ≤ 3 reasons each, ≤ 120 chars per
reason. Absolute/escaping paths are rejected at projection time (regression
test). The projection never recomputes hints — resolution is derived from the
persisted candidate data with the same deterministic rule.

## 19. Privacy / path handling

- Source-hint fields pass through the mandatory packet-level redaction
  (`redactPacketForPersistence`) before persistence: reasons, evidence strings,
  and matched-text snippets are scrubbed by the shared rules
  (`packet-redaction.test.ts` "redacts secrets from source-hint evidence/reasons…").
- The engine emits repository-relative paths only; `isSafeRelativePath` rejects
  absolute, drive-letter, and `../`-escaping candidates; import resolution
  refuses specifiers that escape the root.
- E2E asserts no `C:\`, `/Users/`, `viskod/captures`, `sk_…` values anywhere in
  the agent context response.

## 20. Latency safety boundary

`SourceHintEngine` scans under a finite budget (default 3000 files / 2500 ms,
overridable per call). Exhaustion throws `ScanBudgetExceededError`, which maps to
an explicit `SH_BUDGET_EXCEEDED` → `evidence.sourceHints: unavailable` with a
sanitized diagnostic. The project-file walk and import-closure walk are both
budget-bounded; Studio capture/handoff remains usable. Regression:
`source-hint-engine.test.ts` "exhausted scan budget returns explicit
unavailable, not a hang". Full async/cache architecture is deferred to Phase 33.

## 21. Fresh-process source retrieval proof (E2E)

`tests/e2e/handoff-context-retrieval.test.ts` → "Phase 30 — Studio source hints
through the full boundary" (real Studio + Playwright + real stdio MCP):

1. Studio started with `--project-root examples/phase12-source-hint-app`;
   `/health` reports `project.status = ready`.
2. Target `.target-card-description` captured through the real overlay workflow;
   handoff prepared.
3. Workflow state: `source.resolution = resolved`, candidate
   `src/components/TargetCard.jsx` (possible, < 0.65).
4. Persisted `packet.json`: `evidence.sourceHints.state = collected`,
   `sourceHints[0]` = relative path + `qualification: possible` + reasons with
   "visible text" — no absolute paths.
5. Handoff brief: `sourceHints.resolution = resolved`, top hint with
   `qualification: possible`.
6. Studio killed; **fresh MCP process started without any project root**
   (`--url` only) — it cannot recompute hints.
7. `get_handoff_context(handoffId)` returns the identical candidate
   (`src/components/TargetCard.jsx`, possible, 0.54, reasons) — loaded from the
   persisted capture, no recomputation, no absolute paths, no secrets.

## 22. Fresh-process ambiguity proof (E2E)

New fixture `examples/source-hint-ambiguity-app/` (two source files with
identical visible text) + "Phase 30 — persisted ambiguity across restart":

1. Studio with `--project-root examples/source-hint-ambiguity-app` captures the
   duplicate-text target; workflow state `source.resolution = ambiguous` with
   both `StatusWidgetA/B.jsx` candidates (`weak`).
2. Studio killed; fresh MCP `get_handoff_context` reports
   `resolution: ambiguous`, both bounded candidates, `weak` qualifications,
   reasons mentioning other files — neither presented as confirmed/exact.

## 23. Phase 28B B-target / source-integrity proof

- Unit: `context-engine.test.ts` "Phase 28B: source hints derive from the
  resolved B evidence, never duplicate A" — the fake runtime's DOM snapshot
  carries B-only evidence; generated hints mention `CardB.jsx` and never
  `FIRST CARD`/`first`; all candidate paths relative.
- E2E: the existing identity flow ("trusted geometry resolves B and the
  PERSISTED packet describes B") continues to pass with the composed engine —
  persisted B context carries no A-specific text/attributes; source hints follow
  the same resolved-B evidence.

## 24. Files changed

- `packages/source-hint-engine/src/types.ts` — `SourceQualification`,
  `SourceResolution`, `HintEvidence.observed`, `SourceHint.qualification/reasons`,
  `UsageSiteSourceHint.qualification/reasons`, `RankingResult.resolution`.
- `packages/source-hint-engine/src/evidence.ts` — **new** evidence-scoring model.
- `packages/source-hint-engine/src/index.ts` — evidence-based candidate
  generation, budget guard, qualification/reasons, deterministic ordering.
- `packages/source-hint-engine/src/ranking.ts` — calibrated ranking + resolution.
- `packages/source-hint-engine/src/import-graph.ts` — local relative-import
  resolution + transitive closure + budget.
- `packages/source-hint-engine/src/classifier.ts` — `ImportGraphEntry.isLocal`.
- `packages/context-engine/src/index.ts` — route-map matchedRoute, hint input
  (testId/dataAttributes), qualified SourceHintEntry, `sourceHintsResolution`,
  unavailable-vs-failed mapping.
- `packages/context-engine/src/agent-projection.ts` — bounded candidates +
  resolution.
- `packages/context-engine/src/evidence-status.ts` — `unavailableStatus()`.
- `packages/agent-handoff/src/{types,brief,service,ux,schemas}.ts` —
  qualification/resolution passthrough; schema no longer strips hint metadata.
- `packages/mcp-server/src/entry.ts` — explicit `projectRootPath` startup scan
  (no cwd guess), `get_project_info`/resource use the established scan,
  qualified hints in `create_agent_handoff`.
- `packages/cli/src/index.ts` — `serve --project-root`, help text.
- `packages/project-scanner/src/index.ts` — export `ScanResult` etc.
- `apps/studio/src/index.ts` — ProjectScanner/SourceHintEngine composition,
  `--project-root`/`VISKOD_PROJECT_ROOT`, project status endpoints, source status.
- `apps/studio/src/workflow.ts` — `source` in workflow state, qualified brief
  input, truthful status/resolution.
- `apps/studio/src/ui.ts` — source-status panel.
- `apps/studio/{tsconfig.json,package.json}` — project refs + deps.
- `examples/source-hint-ambiguity-app/` — **new** E2E fixture.
- `tests/e2e/handoff-context-retrieval.test.ts` — Phase 30 source + ambiguity
  flows, stable Studio port-release waits.
- `docs/mcp.md`, `docs/cli.md`, `MEMORY.md` — synchronized.
- `PHASE30_SOURCE_RESOLUTION_STUDIO_REPORT.md` — this report.

## 25. Tests added / changed

| Test file | What |
|---|---|
| `packages/source-hint-engine/src/calibration.test.ts` (**new**) | Corpus A–G, determinism, resolution rule |
| `packages/source-hint-engine/src/source-hint-engine.test.ts` | Rewritten for calibrated contract; Card regressions; budget guard; cache |
| `packages/source-hint-engine/src/import-graph.test.ts` | Relative resolution, transitive closure, root-escape rejection |
| `packages/source-hint-engine/src/ranking.test.ts` / `safety.test.ts` | New-model fixtures |
| `packages/context-engine/src/context-engine.test.ts` | B-target → source-hint integrity |
| `packages/context-engine/src/agent-projection.test.ts` | Candidates, resolution, path rejection |
| `packages/context-engine/src/packet-redaction.test.ts` | Source-hint reason redaction (Phase 29 privacy regression) |
| `apps/studio/src/studio.test.ts` | Project status, `/project/status`, `getSourceStatus` |
| `apps/studio/src/ui.test.ts` | Source-status rendering (ambiguous/resolved/unavailable) |
| `packages/agent-handoff/src/agent-handoff.test.ts` | Brief qualification/resolution survival |
| `tests/e2e/handoff-context-retrieval.test.ts` | Fresh-process source retrieval (§21), ambiguity (§22), Phase 29 regressions intact |

## 26. Exact validation commands / results

| Command | Result |
|---|---|
| `npx vitest run packages/source-hint-engine` | 6 files / 85 tests passed |
| `npx vitest run packages/context-engine packages/agent-handoff apps/studio packages/mcp-server` | 130 + 57 + 78 + 161 tests passed |
| `pnpm typecheck` | passed |
| `pnpm test:ci` | 45 files / 875 tests passed |
| `pnpm test:e2e` (full suite) | 6 files / 41 tests passed |
| `pnpm test:e2e` handoff-context-retrieval ×4 | 16/16 passed each run (post stability fix) |
| `pnpm test:dogfood` | 7 files / 126 tests passed |
| `pnpm smoke:agent-workflow` | 26/26 passed |
| `pnpm build:cli && node scripts/verify-cli-artifact.mjs` | artifact verified OK |
| `pnpm lint` / `biome check .` | 0 errors |
| `pnpm release:check` | **All checks passed** |

Independent runs (§30): calibration corpus ✓; duplicate-text ambiguity ✓
(calibration B + E2E); Card heuristic regression ✓; deterministic ordering ✓;
Studio source-composition ✓ (unit + E2E `project.status = ready`); fresh-process
source retrieval E2E ✓; fresh-process ambiguity E2E ✓; Phase 28B B-target →
source-hint persistence regression ✓.

Post-E2E hygiene: Studio/fixture/MCP processes exited; ports 3000/3001/3221/3222/
3223/5173 verified released; `.viskod` test artifacts removed; no stray temp
files left in the repo root.

## 27. Regression results

- Phase 27 security boundary (origin checks, sanitized state) — green.
- Phase 28A/28B target identity (bare-selector fail-closed, resolved-B capture) — green.
- Phase 29 privacy/retrieval (no secrets in persisted artifacts/projection,
  screenshots omitted, fresh-process retrieval by opaque id) — green; privacy
  fixture now also exercises the composed engine returning truthfully
  `unavailable` when no project root matches the capture.
- `pnpm release:check` — All checks passed (one in-gate dogfood hook timeout
  under load flaked once; the identical dogfood suite passes standalone and in
  the final full gate run).

## 28. Known limitations

- `confidence.sourceMapping` remains `null`: no source-map provider exists in
  the product, and Phase 30 does not fabricate one.
- Route/import evidence requires an explicitly configured project root whose
  route map matches the current pathname; otherwise those strong families do
  not fire and candidates stay `possible`/`weak` — truthful by design.
- Monorepo/workspace layouts remain unsupported for source resolution (Phase
  33): `viskod serve`/Studio without a single explicit root report
  `unavailable`, never a conventional-root guess.
- The review screen's "Evidence details" no longer mislabels
  target-resolution confidence as "Source hints: high/medium/low" — Phase 30A
  replaced it with the truthful Phase 30 source status (§30A-6). The deeper
  visual-review panel architecture (before/after evidence, safe screenshot
  artifacts) remains owned by Phase 31 (visual review).
- Numeric confidence values from before Phase 30 are not comparable to
  calibrated values (schema `2.0.0` marks the boundary).

## 29. Deferred Phase 31+ work

- Phase 31: visual review safe screenshot artifacts and the deeper
  review-panel architecture. (The review screen's obsolete
  "Source hints: high/medium/low" label itself was fixed locally in Phase
  30A — see §30A-4/§30A-6 — without implementing Phase 31.)
- Phase 33: async scanning, scan caches/LRU, workspace/monorepo discovery,
  unbounded-repository performance redesign.
- `confidence.sourceMapping` filling once a source-map framework exists.
- Source-map based `exact` associations, per-file line/column locations from
  real evidence (Phase 30 intentionally does not invent line numbers).

## 30. Final verdict

**PASS.** All Phase 30 PASS criteria are met with direct evidence:

- text-only/common-label matching cannot produce exact/high confidence ✓
  (§4, §12, corpus B/F);
- generic `Card`/container heuristics cannot dominate ranking ✓ (§12, corpus C);
- candidate strength is based on explicit evidence ✓ (§6/§7);
- candidates expose concise reasons ✓ (§10);
- equally plausible candidates are represented as ambiguous ✓ (§8, §22);
- no-evidence conditions return unavailable rather than a fabricated source ✓ (§9, corpus G);
- candidate ordering is deterministic ✓ (§11);
- Studio composes source-resolution/project context ✓ (§14);
- project root is not guessed unsafely ✓ (§15);
- Studio capture persists calibrated source hints ✓ (§17, §21);
- qualified hints use repository-relative paths only ✓ (§19);
- Phase 29 packet redaction covers source-hint fields ✓ (§19);
- `get_handoff_context` returns bounded qualified source candidates ✓ (§18);
- a fresh MCP process retrieves the persisted result without recomputation ✓ (§21);
- ambiguous persisted results remain ambiguous after restart ✓ (§22);
- target B's source hints are derived from B evidence, never duplicate target A ✓ (§23);
- source-resolution failure does not destroy otherwise-valid context ✓ (SH_* mapped to unavailable/failed, packet stays usable);
- Studio cannot hang indefinitely on source resolution ✓ (§20);
- unsupported repository layouts are reported honestly ✓ (§15, §28);
- all Phase 27–29 regressions remain green ✓ (§27);
- `pnpm release:check` passes ✓ (§26).

---

# PHASE 30A — SOURCE SEMANTIC & PERSISTENCE CLOSURE

**Status: PASS** (all gates executed and green — see §30A-14)
**Date:** 2026-08-15
**Scope:** narrow corrective closure. No source-scoring/ranking calibration
changed (§30A-15 preserves Phase 30 evidence bases, thresholds, bands,
margins, generic-class handling, `div → Card` removal, route/import scoring,
scan budget, and the explicit project-root requirement). Phase 31 is not
started.

## 30A-1. UI mismatch reproduction (confirmed)

`apps/studio/src/ui.ts` `sourceStatusHtml` labeled **every** `resolved`
result `Source: probable source found` — the label was derived from
`source.resolution` alone, never from the top candidate's qualification. A
capture with `resolution = resolved`, top `qualification = possible`,
`confidence = 0.54` (real Phase 30 fixture `examples/phase12-source-hint-app`
→ `src/components/TargetCard.jsx`) therefore rendered:

```text
Source: probable source found
```

The same wrong label was duplicated in the client-side JS (`sourceStatus()`)
inside `renderStudioHtml()`. **Mismatch confirmed** — a `possible` candidate
was presented as probable. The Phase 30 E2E only asserted `state.source`
(fresh UI-state), not the rendered text, so the defect shipped undetected.

## 30A-2. Re-derived-resolution reproduction (confirmed)

`packages/context-engine/src/agent-projection.ts`:

- The persisted `packet.json` carried candidates
  (`filePath/confidence/qualification/reasons`) but **no**
  `sourceHintsResolution` — `PersistedPacketSchema.sourceHints` was
  `z.array(z.unknown())` and no resolution field existed in the schema, so
  the capture-time `ContextPacket.sourceHintsResolution` string was stripped
  on load (zod object schemas drop unknown keys).
- `buildAgentContextProjection()` called
  `computeSourceResolution(persistedCandidates)` on **every** retrieval —
  a future engine whose resolution rule changed would silently reinterpret
  historical captures.
- `extractSourceHintCandidate()` additionally re-derived a candidate's
  `qualification` from its numeric `confidence` when the field was missing —
  a second semantic reinterpretation path.

## 30A-3. Persisted-schema gap reproduction (confirmed)

`PersistedPacketSchema` (`packages/capture-pipeline/src/index.ts`):

```ts
diagnostics: z.array(z.unknown()).default([]),
sourceHints: z.array(z.unknown()).default([]),   // ← fully opaque
```

No validation of: repository-relative path safety, confidence finiteness or
0..1 bounds, recognized qualification, reasons shape/bounds, match type,
`exists` type. A corrupt/tampered capture containing an absolute path, an
invalid qualification, or confidence > 1 passed the persistence contract and
reached the projection (which silently dropped or re-derived it). The
projection's inline path check also missed `file:///tmp/x.ts` (URI scheme).

## 30A-4. Implementation changes

1. **Shared load-side path gate** — new `isSafeRelativeSourcePath()` in
   `packages/shared/src/paths.ts` (exported from `@viskod/shared`): rejects
   backslashes, POSIX-absolute, drive-letter, `file://` URI, and `..`
   traversal paths. Used by BOTH the persisted schema and the projection so
   generation, persistence, and load share one rule.
2. **Persisted source-hint candidate schema** — `PersistedSourceHintSchema`
   in `capture-pipeline`: validates `filePath` (safe relative, required),
   `displayPath` (safe relative, optional), `confidence`
   (`finite().min(0).max(1)`, required), `qualification`
   (`exact|probable|possible|weak`, required), `reasons` (string array,
   ≤10 × ≤500 chars), `matchType`/`exists` shapes, plus bounded legacy
   metadata (evidence/reason/kind/status/location/symbol/route/ranking/
   safety). `.passthrough()` tolerates additive fields while every semantic
   field is validated.
3. **Persisted resolution snapshot** — `PersistedSourceResolutionSchema`:
   `{ status: resolved|ambiguous|unavailable, modelVersion: <semver string>,
   topCandidate?: safe-relative path }`. Wired into `PersistedPacketSchema`
   as `sourceHintsResolution` (optional) and into
   `ContextPacket.sourceHintsResolution` as a structured snapshot (was a raw
   string). The capture-time flow
   (`packages/context-engine/src/index.ts`) now builds
   `{ status, modelVersion: SOURCE_HINT_SCHEMA_VERSION, topCandidate }` at
   packet assembly; `SOURCE_HINT_SCHEMA_VERSION = '2.0.0'` is exported from
   `@viskod/source-hint-engine`.
4. **Fresh retrieval uses the persisted conclusion** —
   `buildAgentContextProjection()` reports the persisted snapshot status
   verbatim when present (`resolutionSource: 'persisted'`, plus
   `modelVersion`); only snapshot-less legacy packets fall back to a
   deterministic derivation, marked `resolutionSource: 'derived'`.
   `extractSourceHintCandidate()` no longer re-derives qualification from
   confidence — unrecognized/missing qualification drops the candidate, and
   the persisted schema rejects such entries before load.
5. **Studio wording** — `sourceResolutionLabel()` derives the visible label
   from the top candidate's qualification for resolved results (server +
   client JS); the review screen's obsolete `Source hints: high/medium/low
   confidence` mapping (which displayed the TARGET-resolution confidence
   under source-hint semantics) is replaced by the Phase 30 source status
   from the captured packet.
6. **Consumers updated** — `apps/studio/src/workflow.ts`
   (`buildSourceStatus`/`sourceHintStatus`/`sourceResolution`),
   `apps/studio/src/index.ts` (`getSourceStatus`), and the
   `studio.test.ts` fixture now read the snapshot's `.status`.

## 30A-5. Resolution-vs-qualification contract

The two concepts remain distinct and both are truthful in the UI:

| Concept | Question | Values |
|---|---|---|
| Resolution | Can Viskod distinguish one candidate from alternatives? | `resolved | ambiguous | unavailable` |
| Qualification | How strong is the evidence for THIS candidate? | `exact | probable | possible | weak` |

`resolution: resolved` + `qualification: possible` is valid: one
best-supported candidate whose evidence strength is only possible. Nothing
in this closure converts `possible` to `probable` because resolution is
`resolved`; ranking thresholds are untouched.

## 30A-6. Final Studio wording

`sourceResolutionLabel()` (exported from `apps/studio/src/ui.ts`, mirrored
in the client JS):

| State | Label |
|---|---|
| resolved + exact | `Source: exact source identified` |
| resolved + probable | `Source: probable source` |
| resolved + possible | `Source: possible source` |
| resolved + weak | `Source: weak source evidence` (never promoted) |
| ambiguous | `Source: ambiguous — multiple candidates` |
| unavailable | `Source: unavailable` |

Candidate rows still show the real per-candidate qualification. The
`possible` regression proves `Source: probable` does NOT appear as the
status label (unit `apps/studio/src/ui.test.ts` + rendered-UI E2E
assertion).

## 30A-7. Persisted resolution schema

`packet.json` now persists (schema-validated at write and load):

```jsonc
{
  "sourceHints": [{
    "filePath": "src/components/TargetCard.jsx",   // safe relative
    "displayPath": "src/components/TargetCard.jsx",
    "confidence": 0.54,                            // finite, 0..1
    "qualification": "possible",                   // recognized enum
    "reasons": ["visible text (…) found only in this file"],
    "matchType": "usage-site", "exists": true
  }],
  "sourceHintsResolution": {
    "status": "resolved",
    "modelVersion": "2.0.0",
    "topCandidate": "src/components/TargetCard.jsx"
  }
}
```

Only the resolution state, the producing model version, and the top-candidate
reference are persisted — no scoring internals.

## 30A-8. Source model version behavior

`SOURCE_HINT_SCHEMA_VERSION = '2.0.0'` is exported and stamped into every
snapshot. `modelVersion` is schema-validated as a semver-shaped string; any
future version is ACCEPTED because a persisted snapshot is interpretable
using its own result. Historical scores are never silently upgraded: the
retrieval path reports the persisted `status` + `modelVersion` verbatim and
never reranks or re-qualifies persisted candidates.

## 30A-9. Fresh retrieval behavior

```text
capture → candidates → resolution → persist candidates + snapshot(2.0.0)
→ restart → fresh MCP loads persisted packet → projection reports
status verbatim (resolutionSource: 'persisted') + modelVersion
```

`get_handoff_context` (→ `resolveHandoffCaptureContexts` →
`loadPersistedPacket` → `buildAgentContextProjection`) never recomputes
resolution and never reranks. Presentation budgets (≤5 candidates, ≤3
reasons, 120-char truncation) still apply; qualification, confidence,
reasons, ordering, and resolution are the capture-time values.

## 30A-10. Legacy behavior

A safe packet that predates the snapshot but contains valid Phase 30
candidates (qualification present) loads normally; the projection derives
resolution with the current deterministic rule and marks it
`resolutionSource: 'derived'` — a clearly-marked compatibility result, never
presented as the original capture-time conclusion, and `modelVersion` is
absent. A packet whose candidates lack recognized Phase 30 fields (e.g.
pre-calibration inflated hints) fails persisted-schema validation →
`CP_PACKET_CORRUPT` → `HANDOFF_CAPTURE_CORRUPT` (re-capture required) — the
fail-safe chosen, consistent with Phase 29's stance that legacy packets are
not treated as current privacy-safe context.

## 30A-11. Corruption tests

`packages/capture-pipeline/src/capture-pipeline.test.ts` — 12 corruption
cases × (write-side `CP_PACKET_INVALID` + load-side `CP_PACKET_CORRUPT`):
invalid qualification; confidence > 1; confidence negative; non-numeric
confidence; POSIX-absolute path; Windows-absolute path; traversal path;
`file://` URI path; malformed reasons (non-array); non-string reason;
invalid resolution state; malformed model version. Plus: missing
qualification rejected (never re-derived), future `3.0.0` modelVersion loads
and stays interpretable, and a valid snapshot + candidates round-trip.
`packages/mcp-server/src/handoff-context.test.ts` — a tampered packet with
invalid qualification yields `HANDOFF_CAPTURE_CORRUPT`. `packages/shared`
— `isSafeRelativeSourcePath` unit cases. No malformed source data is ever
returned as normal agent context.

## 30A-12. Fresh-process stability proof

- **Unit** (`agent-projection.test.ts`): a packet whose persisted snapshot
  says `resolved` but whose candidates alone would derive `ambiguous` (two
  tied `possible` 0.54) projects as `resolved` +
  `resolutionSource: 'persisted'` with candidates preserved verbatim; the
  inverse (snapshot `ambiguous`, single `probable` 0.71 that would derive
  `resolved`) stays `ambiguous` — the resolver/ranker result is never
  consulted when a snapshot exists. Legacy (no snapshot) projects are marked
  `derived`.
- **E2E possible** (`tests/e2e/handoff-context-retrieval.test.ts`): Studio
  with `--project-root` captures `TargetCard.jsx` (`possible`, < 0.65);
  `packet.json` snapshot `{resolved, 2.0.0, TargetCard.jsx}`; rendered UI
  label asserts `Source: possible source` and NOT `Source: probable`;
  Studio killed; fresh MCP (no project root) returns
  `resolution: resolved`, `resolutionSource: 'persisted'`,
  `modelVersion: '2.0.0'`, `qualification: possible`, and confidence equal
  to the EXACT persisted value read from `packet.json`.
- **E2E ambiguity**: duplicate-text fixture persists
  `{ambiguous, 2.0.0}`; after restart the fresh MCP reports
  `resolution: ambiguous`, `resolutionSource: 'persisted'`, capture-time
  order `StatusWidgetA.jsx` then `StatusWidgetB.jsx` (no rerank), both
  `weak` qualifications unchanged, neither presented as confirmed.

## 30A-13. Files changed

- `packages/shared/src/paths.ts` — **new** `isSafeRelativeSourcePath`;
  `index.ts` exports it; `shared.test.ts` cases.
- `packages/source-hint-engine/src/index.ts` — export
  `SOURCE_HINT_SCHEMA_VERSION` (`2.0.0`).
- `packages/context-engine/src/index.ts` — snapshot-typed
  `sourceHintsResolution` built at capture time (status + modelVersion +
  topCandidate).
- `packages/context-engine/src/agent-projection.ts` — persisted-resolution
  reporting (`resolutionSource`, `modelVersion`), shared path gate, no
  qualification re-derivation.
- `packages/capture-pipeline/src/index.ts` — `PersistedSourceHintSchema`,
  `PersistedSourceResolutionSchema`, wired into `PersistedPacketSchema`.
- `apps/studio/src/ui.ts` — `sourceResolutionLabel()`, truthful panel label,
  review-screen wording (server + client JS).
- `apps/studio/src/workflow.ts`, `apps/studio/src/index.ts` — snapshot
  `.status` reads.
- Tests: `shared.test.ts`, `capture-pipeline.test.ts` (corruption matrix),
  `agent-projection.test.ts` (stability), `handoff-context.test.ts`
  (retrieval + corrupt source), `ui.test.ts` (wording matrix + review
  screen), `studio.test.ts` (fixture), `tests/e2e/handoff-context-retrieval
  .test.ts` (possible + ambiguity restart, rendered-UI label, persisted
  values).
- Docs: `docs/mcp.md` (handoff retrieval contract), `MEMORY.md`, and this
  report.

## 30A-14. Validation results

| Command | Result |
|---|---|
| focused unit suites (shared, projection, pipeline, handoff-context, studio) | 182 tests passed |
| full unit suites (source-hint-engine, context-engine, agent-handoff, mcp-server, cli) | 326 tests passed |
| `pnpm typecheck` | passed |
| `pnpm test:ci` | 45 files / 920 tests passed |
| `pnpm test:e2e` | 6 files / 41 tests passed (incl. handoff-context-retrieval 16/16) |
| `pnpm test:dogfood` | 7 files / 126 tests passed |
| `pnpm smoke:agent-workflow` | 26/26 passed |
| `pnpm build:cli && node scripts/verify-cli-artifact.mjs` | artifact verified OK |
| `pnpm lint` / `biome check .` | 0 errors |
| `pnpm release:check` | **All checks passed** |

Independent runs: source UI semantic tests ✓ (exact/probable/possible/weak/
ambiguous/unavailable + possible-never-probable); persisted source schema
tests ✓; corrupted persisted-source tests ✓ (12 cases × write/load +
retrieval); capture-time resolution stability ✓ (persisted snapshot wins
over present-day derivation, both directions); fresh-process
possible-candidate retrieval ✓; fresh-process ambiguity retrieval ✓.

## 30A-15. Calibration preserved

No change to: evidence family bases, confidence thresholds, qualification
bands, ambiguity margins (`0.02`/`0.08`), generic-class handling, `div →
Card` removal, route/import scoring, scan budget, or the explicit
project-root requirement. This closure only makes the UI truthful about
qualification and freezes capture-time conclusions in the persisted packet.

## 30A-16. Phase 31 not started

Visual-review image capture, screenshot masking, pixel diff, review redesign,
and the review screen's deeper visual-review architecture remain deferred to
Phase 31. The review screen terminology fix in 30A-4/30A-6 is a local,
truthful relabel — it does not implement any Phase 31 architecture.


