# Phase 38 — Release Candidate Preparation Report

## 1. Executive summary

RC preparation produced `@viskod/cli@0.2.4-alpha` and the exact local artifact `rc-artifacts/viskod-cli-0.2.4-alpha.tgz`. The packed artifact contains only `dist/index.js`, `package.json`, and `LICENSE`, installs outside the checkout, reports the RC version, passes the CI/regression, clean E2E, dogfood, workflow-smoke, build, and artifact gates, and exposes 31 MCP tools through the installed bundle.

Final verdict: **PASS with documented boundaries**. The required `pnpm test:e2e` gate passed from an isolated fresh `.viskod` state: 15 files and 90 tests passed. The installed clean-user journey, CLI surface, MCP probe, config preservation/idempotency, package privacy/content checks, release gate, and fresh OpenCode handoff retrieval through the installed RC bundle also passed. No npm publication was performed.

## 2. RC version and source identity

- RC version: `0.2.4-alpha`.
- Version policy evidence: repository tags increment alpha releases (`v0.2.0-alpha` through `v0.2.3-alpha`); the smallest next prerelease is `0.2.4-alpha`, not a new beta scheme.
- Source identity: `3d43dc0095535a6428510daf603168d859ada62d` (`close Phase 35A audit and product proof`).
- Working tree: intentionally dirty before this phase; scope is listed below.
- Publishable package: `@viskod/cli`; internal workspace packages are bundled and are not independently published by the RC artifact.
- Requirements: Node `>=22.0.0`; pnpm `>=9.0.0`; repository package manager `pnpm@9.15.0`.
- OS claim: Linux x64 exercised. No full Windows/macOS claim.
- Agent claim: OpenCode installed-artifact path exercised, including a fresh agent handoff retrieval. Cursor and Claude configuration paths remain structurally supported by existing tests; runtime execution was not claimed.
- Product boundaries: probabilistic source guidance, local-sensitive visual artifacts, Studio maintainability debt, Shadow DOM/iframe limits, no formal WCAG claim, bounded native OS verification, crash/interrupted-process fork limitations, and explicit-trust remote navigation.

## 3. Release scope / working-tree cleanup

Initial inventory: 26 modified and 9 untracked entries. Final inventory included 29 modified and 10 untracked entries after intentional RC changes and artifacts.

- Required product changes: Phase 36/37 changes under `apps/studio`, `packages/cli`, `packages/context-engine`, `packages/project-scanner`, `packages/setup`, `packages/shared`, `packages/source-hint-engine`, and `packages/visual-selection`; RC version fields; CLI per-command help; setup/diagnostic version propagation.
- Required tests: changed tests in Studio, context engine, project scanner, setup, source-hint engine, visual selection, shared feedback, and E2E feedback/harness files.
- Required documentation/reports: existing Phase 36/37 reports and scale/privacy/diagnostics documentation; this report and `RELEASE_NOTES_0.2.4-alpha.md`.
- Required fixture: `examples/phase36-feedback-privacy/`.
- Generated release artifact: `rc-artifacts/viskod-cli-0.2.4-alpha.tgz`.
- Generated build output under `packages/cli/dist` is packaging input and is not separately included in the source scope.
- Accidental selector artifact `packages/shared/tsconfig.json:raw:1-200` was removed. No unrelated developer-local file was identified from the inventory; historical phase reports were not rewritten.

## 4. Package/version consistency

- Root `package.json`: `0.2.4-alpha`.
- `packages/cli/package.json`: `0.2.4-alpha` and publish authority.
- Bundled CLI `--version`: `Viskod v0.2.4-alpha`.
- MCP `initialize.serverInfo.version`: `0.2.4-alpha`.
- Setup persisted state and doctor diagnostic projection: `0.2.4-alpha` in the installed bundle.
- Generated OpenCode configuration points to the installed `@viskod/cli/dist/index.js`; it does not point to the source checkout.
- Historical package versions and historical phase reports were left unchanged where they are not shipped release metadata.
- The CLI now implements the documented `setup --help`, `doctor --help`, `install --help`, and `serve --help` surfaces without executing those commands.

## 5. Tarball contents

`npm pack`/`pnpm pack` dry-run and actual inspection both reported:

```text
dist/index.js
package.json
LICENSE
```

Actual tarball file count: 3 (`package/dist/index.js`, `package/package.json`, and `package/LICENSE`). No source checkout paths, `.viskod`, tests, fixtures, `.env`, keys, credentials, logs, screenshots, ContextPackets, or phase reports were present. `node scripts/verify-cli-artifact.mjs` passed.

## 6. Installed CLI proof

The exact RC tarball was installed into `/tmp/viskod-rc-install`, with isolated HOME/XDG directories and project `/tmp/viskod-rc-project`. No CLI file was invoked from the checkout.

PASS:

- `viskod --version` → `Viskod v0.2.4-alpha`.
- `viskod --help`.
- `viskod setup --help`.
- `viskod doctor --help`.
- `viskod install --help`.
- `viskod serve --help`.
- Setup and doctor completed from the installed bundle.
- Browser verification and MCP runtime verification succeeded.

The npm install environment reported the existing Playwright postinstall approval warning; Chromium was already available in the isolated HOME from the earlier install and browser verification passed.

## 7. First-run setup

Installed journey:

`installed RC → setup --project-root /tmp/viskod-rc-project --install opencode → browser verification → project/source verification → agent config generation → doctor`.

The complete run passed browser launch/navigation/shutdown, project readability, workspace initialization, MCP initialize/tools-list verification, source resolution, persistence readiness, and capture smoke. Doctor reported zero required failures. One recommended check remained bounded because no Studio process was running during doctor.

Manual interventions: creation of the isolated project directory/package manifest; explicit `--project-root`; explicit `--install opencode`; initial limited-mode retry was used only to prove the documented recovery path after intentionally skipping smoke, then the complete non-limited setup was run successfully.

## 8. Agent configuration

OpenCode config: `/tmp/viskod-rc-home/.config/opencode/opencode.json`.

Observed command uses the installed RC path:

```text
/home/john/.local/node-v24.19.0-linux-x64/bin/node
/tmp/viskod-rc-install/node_modules/@viskod/cli/dist/index.js serve --project-root /tmp/viskod-rc-project
```

The config preserved an unrelated `other` MCP entry. Repeating installation with identical arguments produced identical file hashes and no duplicate Viskod entry. A fresh OpenCode agent, run from the project root with the installed RC command, called `get_handoff_context` and returned `RETRIEVED: The card description copy is stale`. Cursor/Claude runtime execution was not claimed in this RC journey.

## 9. MCP inventory

Direct JSON-RPC probe against the installed bundle:

- `initialize`: PASS.
- `tools/list`: PASS.
- Actual runtime tool count: **31**.
- Deprecated aliases: none observed in the installed inventory.
- Setup-required subset reported by setup: **8**.

Tool names:

`viskod_select_element`, `viskod_capture_context`, `viskod_get_project_info`, `viskod_get_diagnostics`, `viskod_navigate`, `create_agent_handoff`, `get_agent_handoff`, `list_agent_handoffs`, `update_agent_handoff_status`, `cancel_agent_handoff`, `get_handoff_context`, `create_visual_review`, `get_visual_review`, `list_visual_reviews`, `recapture_visual_review`, `resolve_usage_site_hints`, `record_visual_review_decision`, `get_setup_state`, `detect_project`, `initialize_workspace`, `run_setup_checks`, `run_setup_smoke`, `complete_setup`, `repair_setup`, `verify_mcp_tools`, `validate_app_url`, `viskod_get_chat_messages`, `viskod_send_chat_response`, `viskod_notify_ui`, `viskod_get_settings`, `viskod_update_settings`.

The existing setup subset is intentionally smaller than the full runtime inventory; docs must preserve that distinction.

## 10. Installed Studio journey

The source Studio was started on loopback and browser-opened successfully. Existing issue history was visible and an existing issue opened in the UI. The repository smoke independently completed the full report → handoff → mutation → BEFORE/AFTER/DIFF → human decision journey with **26/26** checks passed, including MCP initialize/tools/list and capture privacy checks.

The source Studio was started on loopback against the real fixture project while the generated OpenCode MCP command pointed to the installed RC dist. The browser navigated to the fixture, opened a persisted issue, entered the review surface, and showed the accepted review state; the installed RC MCP server then served the handoff retrieved by a fresh OpenCode agent. The repository's 26/26 smoke additionally proves mutation, BEFORE/AFTER/DIFF, human decision, feedback boundary, and restart behavior. Studio remains a separately developed repository application rather than an asset in the CLI tarball; this packaging boundary is documented, not a release failure.

## 11. Source-guidance regression

Phase 37 source-ranking acceptance behavior was not retuned. The repository's source-hint CI, dogfood, and route-relevance tests passed. Dogfood reported route-owner and usage-site rankings, ambiguity, missing-source behavior, and privacy-safe handoff hints. The external Godeck workspace was unavailable during this run, so the equivalent repository fixture/corpus was used.

## 12. Privacy audit

PASS for the packed artifact: forbidden package entries absent; bundle contained no checkout-local paths; no credentials, tokens, screenshots, raw packets, or test assets were packaged.

PASS for installed diagnostics: doctor projection was sanitized and showed `viskodVersion: 0.2.4-alpha`; it did not include absolute paths or raw packet data.

BOUNDED for generated agent configuration: an MCP command necessarily contains absolute paths to the installed Node executable, installed CLI dist, and selected project root. It contained no credentials or checkout source path. Visual review artifacts remain local-sensitive and were not included in handoff context.

## 13. Documentation sweep

Reviewed active README and docs surfaces for installation, setup, Node/browser requirements, project root, OpenCode, source confidence, route/import guidance, review privacy, feedback privacy, browser boundaries, remote URL policy, workspace formats, OS claims, issue/history/restart behavior, CLI/MCP references, setup, privacy, source hints, Studio, and troubleshooting. Historical phase reports were excluded from version rewriting. New user-facing release notes are in `RELEASE_NOTES_0.2.4-alpha.md`.

## 14. Release notes

Release notes cover Viskod's workflow, capabilities, local-first privacy model, probabilistic source guidance, feedback, proven environment, and known boundaries. They explicitly do not claim Cursor/Claude runtime execution or formal WCAG conformance.

## 15. Known limitations

The Phase 35 boundaries remain applicable: Studio maintainability debt; application Shadow DOM/iframe traversal limits; probabilistic source guidance; local-sensitive visual review artifacts; no formal WCAG claim; limited native OS verification; process-local fork idempotency limits across crashes; and explicit trust requirements for remote navigation.

## 16. Dependency / supply-chain review

`pnpm audit --prod --json` completed with exit code 0: 38 production dependencies, 0 info/low/moderate/high/critical vulnerabilities, and no advisories. `npm audit --omit=dev` could not run because the repository has no npm lockfile (`ENOLOCK`); this was recorded rather than hidden.

The CLI package declares Playwright and pngjs as runtime dependencies, bundles workspace code, externalizes Playwright/pngjs intentionally, and has a declared Playwright Chromium postinstall. No `file:/workspace` runtime dependency appeared in the packed metadata. No undeclared runtime module was observed by the build/artifact verifier.

## 17. Reproducibility

Two packs from the same source state produced identical sorted manifests and identical archive bytes.

- Manifest entries: 3.
- Pack A SHA-256: `b2ab02f83f6c0ff72592f02329f22a207bb0cce24baafd814f2bcf6ddcf053c3`.
- Pack B SHA-256: `b2ab02f83f6c0ff72592f02329f22a207bb0cce24baafd814f2bcf6ddcf053c3`.
- Manifest diff: none.

## 18. Existing-config preservation

PASS. An unrelated OpenCode MCP entry survived installation. Repeated identical `viskod install opencode --project-root ...` runs preserved the unrelated entry, avoided duplicate Viskod entries, and produced equal SHA-256 hashes.

## 19. Removal / recovery

No dedicated uninstall command exists. Current manual recovery is to remove only the generated `viskod` entry from the client configuration (`~/.config/opencode/opencode.json`, or the corresponding Cursor/Claude config path) and remove the project's `.viskod/` directory if local state is no longer wanted. Unrelated configuration entries must remain. `viskod stop` handles an active runtime session; it is not an agent-config uninstaller.

## 20. Process hygiene

Unit/integration lifecycle tests cover loopback binding, occupied ports, idempotent shutdown, browser release, MCP EOF/timeout cleanup, SIGTERM cleanup, and unknown-owner safety. The direct installed MCP probe exited cleanly on stdin EOF. The repository smoke passed repeated fixture/Studio start-stop and browser workflow checks. The first E2E run exposed persisted-state/process contamination in the current dirty checkout; after moving the prior generated `.viskod` state aside, the isolated rerun passed all 15 files and 90 tests. The prior workflow state was restored after validation.

## 21. Final artifact metadata

- Filename: `rc-artifacts/viskod-cli-0.2.4-alpha.tgz`.
- Package: `@viskod/cli`.
- Version: `0.2.4-alpha`.
- Tarball size: 149,406 bytes.
- Unpacked size: 755,571 bytes.
- File count: 3 files (`dist/index.js`, `package.json`, `LICENSE`).
- SHA-256: `b2ab02f83f6c0ff72592f02329f22a207bb0cce24baafd814f2bcf6ddcf053c3`.
- Publication: not performed.

## 22. Complete validation matrix

| Gate | Result | Evidence |
|---|---|---|
| `pnpm typecheck` | PASS | `tsc -b` completed |
| `pnpm lint` | PASS | 332 files checked |
| `pnpm test:ci` | PASS | 74 files, 1,100 tests |
| `pnpm test:e2e` | PASS | 15 files, 90 tests passed from isolated fresh state; initial contaminated run was not used as final evidence |
| `pnpm test:dogfood` | PASS | 7 files, 129 tests |
| `pnpm smoke:agent-workflow` | PASS | 26/26 checks |
| `pnpm build:cli` | PASS | bundled 0.2.4-alpha |
| `node scripts/verify-cli-artifact.mjs` | PASS | exact content/version/leak checks |
| `pnpm release:check` | PASS | lint/typecheck/CI/dogfood/smoke/build/artifact all passed |
| Installed CLI | PASS | exact tarball outside checkout |
| Installed setup/doctor | PASS | complete setup; zero required doctor failures |
| Installed MCP | PASS | initialize + 31-tool tools/list |
| Installed Studio external smoke | PASS | source Studio against real fixture + installed RC MCP/OpenCode retrieval; Studio is intentionally separate from CLI tarball |
| Privacy package audit | PASS/BOUNDED | package clean; config has necessary absolute runtime/project paths |
| Config preservation/idempotency | PASS | unrelated entry preserved; repeated hash equal |
| Reproducible manifests | PASS | 3 entries, no diff, byte-identical archives |
| Dependency audit | PASS/BOUNDED | pnpm audit clean; npm audit unavailable without npm lockfile |

## 23. RC checklist

- INSTALL — PASS
- SETUP — PASS
- CLI — PASS
- MCP — PASS
- STUDIO — PASS
- SOURCE — PASS (equivalent corpus; Godeck unavailable)
- HANDOFF — PASS in repository smoke/dogfood and fresh OpenCode retrieval through installed RC MCP
- REVIEW — PASS in repository smoke/dogfood and Studio review surface
- FEEDBACK — PASS in CI and isolated repository E2E coverage
- PRIVACY — PASS for package and projections; BOUNDED for necessary generated config paths/local-sensitive review artifacts
- DOCS — PASS for active docs sweep and RC notes
- PACKAGING — PASS
- PROCESS HYGIENE — PASS

## 24. Final verdict

**PASS with documented boundaries.** The artifact is reproducible, installable, versioned, privacy-audited, and all complete regression gates are green from isolated state. Installed CLI setup/doctor, MCP initialize/tools-list, generated OpenCode configuration, real Studio integration smoke, fresh OpenCode handoff retrieval, config preservation/idempotency, and exact artifact metadata are verified. Studio remains a separately developed repository application and Cursor/Claude runtime execution is not claimed. Do not publish this artifact without a separate explicit publication decision.

## 25. Phase 38A — RC Provenance & Studio Distribution Closure

### 25.1 Final source identity and freeze

- Final RC source commit for this closure: `5f0f3c6d64bed520dfb9d169adcc1318cb0ee667`.
- `git status --short`: clean after the release-test timeout stabilization.
- Intentional source inventory: Phase 36/37 product and tests, active
  installation docs, Phase 36/37/38 reports, the privacy fixture, and the
  release lockfile. Generated `rc-artifacts/` was removed from the source
  revision; release binaries are not tracked by repository policy.
- No `.viskod` state, review/feedback artifacts, local configs, secrets, temp
  directories, or generated build output was committed.

### 25.2 Clean-checkout reproduction

A detached worktree at the final commit was created at
`/tmp/viskod-rc-clean`, installed with `pnpm install --frozen-lockfile`, and
packed from a fresh `packages/cli` build. The package identity and manifest
were `@viskod/cli@0.2.4-alpha`; the unpacked package contained exactly three
files:

```text
dist/index.js
package.json
LICENSE
```

The authoritative clean pack from that final commit was
`viskod-cli-0.2.4-alpha.tgz`, 149,406 bytes, with 755,571 unpacked bytes and
SHA-256
`725b3c7123b4a6c298c2fdad1897e35b6e9aab69ab154290f4766659876a3dc8`.
The unpacked package contents and executable/license bytes matched across
repeated packs. pnpm rewrote devDependency key order in `package.json`, so
archive bytes were not deterministic; the checksum above is the authoritative
final artifact file. The earlier
`9668cc4095a3ea52ec67893c393c2e137ed7ce6e3d36364a878484a00d28c1cf` and
`b2ab02f83f6c0ff72592f02329f22a207bb0cce24baafd814f2bcf6ddcf053c3` checksums
are historical RC-preparation evidence.

### 25.3 Studio distribution decision

- **A:** Studio is not part of `@viskod/cli@0.2.4-alpha`.
- **B:** There is no separate installable Studio package/application.
- **C:** Studio is source-checkout-only in this RC.
- **D:** A user with only the published CLI can start MCP with
  `viskod serve --url <APP_URL> --project-root <PROJECT_ROOT>`. Starting the
  Studio UI requires the documented checkout command
  `pnpm exec tsx apps/studio/src/index.ts --project-root <PROJECT_ROOT>`.
- **E:** The installed Studio command cannot work with zero Viskod checkout.

Therefore this artifact is explicitly the **Viskod CLI/MCP RC**, not a
complete end-user Viskod distribution. No packaging-platform redesign or new
product feature was undertaken.

### 25.4 Installed-only journey and boundaries

The installed-only journey began with Node, the final CLI tarball, and an
external project outside the checkout. It passed installation, setup,
Chromium/MCP verification, persisted project state, OpenCode configuration,
installed MCP `initialize`/`tools/list`, fresh OpenCode handoff retrieval,
config preservation/idempotency, and clean MCP shutdown. It did not claim the
Studio selection/review UI because Studio is intentionally source-checkout-only.
The repository Studio smoke remains separate evidence for the workflow state
machine and covers selection, persisted issue, handoff, mutation,
BEFORE/AFTER/DIFF, human decision, feedback, and restart/reopen.

### 25.5 Leakage and documentation

The installed command/configuration used the installed CLI path and selected
project root only. No `packages/`, `apps/studio/src`, `packages/cli/src`, or
checkout `tsx` entrypoint occurred in installed runtime configuration. Active
`README.md` and `QUICKSTART_MCP.md` now distinguish the installable CLI/MCP RC
from the source-only Studio limitation and answer install, start, OpenCode,
project-root, local-state, and removal questions.

### 25.6 Final artifact and validation status

Authoritative final artifact metadata:

| Field | Value |
|---|---|
| Filename | `viskod-cli-0.2.4-alpha.tgz` |
| Package | `@viskod/cli` |
| Version | `0.2.4-alpha` |
| Files | 3 |
| Tarball size | 149,406 bytes |
| Unpacked size | 755,571 bytes |
| SHA-256 | `725b3c7123b4a6c298c2fdad1897e35b6e9aab69ab154290f4766659876a3dc8` |

The complete validation matrix was executed from the final clean source
worktree. `pnpm typecheck`, `pnpm lint`, `pnpm test:ci` (including the
import-graph cache bound with its existing 30-second test budget),
`pnpm test:dogfood`, `pnpm smoke:agent-workflow`, CLI build/artifact
verification, and `pnpm release:check` passed. The full `pnpm test:e2e`
suite passed 86/90 tests in the first clean run; four Studio UI tests
timed out under the browser runner, and the isolated rerun passed 10/12
with the same two timing-sensitive selection waits failing. This is recorded
as a validation limitation rather than a product regression claim.

Process hygiene remains PASS for loopback binding, shutdown, MCP EOF cleanup,
config preservation, and package privacy. The full-product external Studio
criterion is **PARTIAL** because the artifact is truthfully scoped CLI/MCP-only.

**Phase 38A verdict: PARTIAL — CLI/MCP RC PASS; full installed Studio
distribution is not yet available, and the E2E runner retains two
timing-sensitive failures.**

## 26. Phase 38B — RC E2E Determinism Closure

### 26.1 Failure reproduction and root cause

The first post-38A full-suite reproduction ran `pnpm test:e2e` with 15 files
and 90 tests. It produced 86 passing tests and four failures:

- `tests/e2e/studio-ui.test.ts` —
  `Phase 34 issue history supports edit archive reopen and fork through rendered controls`;
  the persisted issue-count assertion observed one issue instead of two.
- `tests/e2e/visual-review-ui.test.ts` —
  `Phase 34A Studio UI — restart resume through decision`;
  the bounded `waitForStage('handoff_ready')` wait expired after an owned Studio
  restart.
- `tests/e2e/visual-review-ui.test.ts` —
  `Phase 31 Studio UI — unchanged review journey`;
  the rendered report-start control did not become observable after the prior
  restart journey.
- `tests/e2e/port-ownership.test.ts` —
  the second smoke process did not exit successfully in that contaminated
  ordering.

The isolated Studio UI reproduction passed twice before the full run, while
the visual-review file reproduced the restart/navigation failure in isolation.
The failing transition was lifecycle readiness, not source selection or
source-ranking behavior: a test could begin the next navigation while its
owned Studio process, prior browser overlay teardown, or the prior rendered
workflow/WebSocket state was still settling. A pre-existing rendered
`#report-start` control could therefore be observed before the new `/navigate`
request had established the new idle workflow.

### 26.2 Bounded synchronization correction

The correction is test-harness-only:

- `tests/e2e/harness.ts` now has `waitForHttpUnavailable`, a bounded polling
  condition that returns only after the owned Studio health endpoint is down.
- `tests/e2e/visual-review-ui.test.ts` waits for owned Studio shutdown before
  spawning the replacement process and waits for the `/navigate` response.
- `tests/e2e/studio-ui.test.ts` waits for the server `/state` contract to show
  the requested URL and `idle` workflow before beginning a report. The helper
  then waits for the freshly rendered report control.

No arbitrary sleep, global timeout inflation, product lifecycle protocol,
selection semantics, source ranking, or shipped CLI/MCP runtime changed.
Existing bounded polling remains a failure bound around explicit HTTP/state
conditions. The focused lifecycle regressions cover repeated navigation,
selection restart/cancel/reselect, issue history, Studio restart/resume, and
visual review durability.

### 26.3 Cache and performance-budget audit

The import/cache test tolerance remains a test-runner budget only. Product
budgets were unchanged:

- `DEFAULT_SCAN_BUDGET`: `maxFiles=3000`, `maxTimeMs=2500`.
- Import-graph concurrency: `16`.
- Hint cache: 500 entries, 5-minute TTL.
- Import-graph cache: 50 entries, 10-minute TTL.
- Manifest cache: 20 entries, 10-minute TTL.
- Abort/cancellation, generation invalidation, and deadline enforcement remain
  unchanged.

The existing 30-second test allowance documents clean-release-load
variability; no product performance budget was raised and Phase 33
performance/cancellation coverage remained green.

### 26.4 Focused and authoritative validation

Focused validation after the correction:

- `tests/e2e/studio-ui.test.ts`: 12/12, including a repeated full-file run.
- `tests/e2e/visual-review-ui.test.ts`: 3/3, including restart/resume.
- `tests/e2e/visual-review-durability.test.ts`: 6/6.
- Visual-selection integration/contract tests: 72/72.
- Studio workflow/UI unit tests: 59/59.
- Port ownership: 1/1.

The authoritative single-command `pnpm test:e2e` run passed **15/15 files
and 90/90 tests**.

### 26.5 Final RC matrix

On the same corrected source state:

| Gate | Result |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS — 332 files |
| `pnpm test:ci` | PASS — 74 files, 1,100 tests |
| `pnpm test:e2e` | PASS — 15 files, 90 tests |
| `pnpm test:dogfood` | PASS — 7 files, 129 tests |
| `pnpm smoke:agent-workflow` | PASS — 26/26 |
| `pnpm build:cli` | PASS |
| `node scripts/verify-cli-artifact.mjs` | PASS |
| `pnpm release:check` | PASS — complete release gate |

### 26.6 Provenance, process hygiene, and verdict

The correction touches only E2E harness/test files. It does not affect the
packed CLI/MCP runtime, so the authoritative Phase 38A artifact source and
SHA remain unchanged: source commit
`5f0f3c6d64bed520dfb9d169adcc1318cb0ee667`, SHA-256
`725b3c7123b4a6c298c2fdad1897e35b6e9aab69ab154290f4766659876a3dc8`.
The post-fix packed artifact was independently rebuilt and verified; runtime
content is unchanged because no CLI/MCP source or package metadata changed.

All termination waits are scoped to processes created by the owning test.
Unknown external owners are never terminated. The final clean-source status
and final closure commit are recorded after `pnpm release:check`.

**Phase 38B status: PASS pending final closure commit and clean-status evidence.**
