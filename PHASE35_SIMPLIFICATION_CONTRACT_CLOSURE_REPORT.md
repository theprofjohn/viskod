# Phase 35 — Simplification, Security & Contract Closure Report

## 1. Executive summary

Phase 35 current-head work tightened Studio input handling, bounded duplicate
expensive operations, centralized target URL validation, rejected credentialed
and unsafe navigation, checked redirect destinations, extracted Studio request
security helpers, and corrected active documentation. Existing Phase 27–34
contracts were re-run through the release gate.

This report is evidence-backed. It does **not** claim unsupported Shadow DOM /
iframe traversal. Phase 35A completed the dedicated real-browser special-DOM
matrix, the integrated rendered journey, and the current-head hermetic
installed-mode proof. Final status is **PASS**, with AUDIT-019 retained as a
bounded product limitation because renderer consolidation is incomplete.

## 2. Initial 001–032 audit reconciliation

The initial matrix was reconciled from the Phase 27–34 reports, current source,
and current tests before implementation. No prior phase name was treated as
proof by itself. The complete matrix is in §30.

## 3. Remaining findings reproduced

Current reproductions found two new Phase 35 gaps: `readBody()` previously
buffered arbitrary request data, and browser/setup smoke used `data:` fallback
navigation that conflicts with the local target policy. Both implementation
defects were corrected. The requested special-DOM browser matrix remains a
verification gap, not silently marked fixed.

## 4. Studio decomposition

`apps/studio/src/index.ts` remains the composition root and workflow service
owner. Request security lives in `apps/studio/src/request-security.ts`, and
the HTTP route dispatch body now lives in `Studio.routeHttpRequest()`. The
bootstrap method owns only listener/origin/CORS/body-limit setup before
delegating route contracts. This preserves every endpoint while separating
server/bootstrap, request security, and route dispatch responsibilities.

The main file was approximately 80 KiB before this phase; the route dispatcher
is now a separately named responsibility and the security helper is an
independently testable module. No framework or endpoint contract changed.

## 5. Request-body limits

All Studio HTTP body consumers pass through the bounded parser. JSON requests
are limited to 256 KiB. A declared oversized body receives HTTP 413 before
route handling. Chunked bodies stop accumulating after the same limit and are
turned into a controlled validation failure. WebSocket payloads use the same
256 KiB `maxPayload` bound. Existing issue/description schemas remain the
business-level limits (80/4000 characters where defined).

Evidence: `apps/studio/src/studio.test.ts` body-limit test; focused Studio suite
28 tests passed; malformed JSON remains a controlled 400 path.

## 6. Expensive-operation concurrency bounds

Studio now merges duplicate navigation and capture requests through one in-flight
promise each. Visual-review recapture rejects a duplicate while one recapture is
active instead of creating an unbounded queue. Existing workflow preparation
already merges repeated submissions (`StudioWorkflow.preparing`).

Evidence: `apps/studio/src/index.ts`; Studio workflow and responsiveness tests;
full CI passed 1,089 tests. No distributed queue was introduced.

## 7. Target URL policy

`packages/shared/src/target-url.ts` is the canonical policy. Accepted targets
are HTTP(S) loopback (`localhost`, IPv4 loopback, IPv6 loopback). `file:`,
`data:`, `javascript:`, `about:`, `chrome:`, FTP, malformed URLs, and URL
credentials are rejected. Remote HTTP(S) hosts remain rejected unless both an
explicit allow-remote flag and a matching trusted-host allowlist are supplied;
no current product flow silently enables that mode.

## 8. Redirect policy

Browser navigation validates the initial URL and validates `page.url()` after
Playwright follows redirects. A disallowed final target causes a typed failure
and clears the page to `about:blank` without exposing the rejected URL. Setup
reachability applies the same final-response policy and returns a client-safe
failure. Query strings and fragments are preserved; credentials are rejected.
## 9. Shadow DOM / iframe support matrix

`tests/e2e/special-dom-boundaries.test.ts` now exercises real Chromium through
the Viskod overlay script and records the emitted boundary target:

| Case | Actual Viskod selection outcome | Resolution/capture contract |
|---|---|---|
| Regular DOM | Normal overlay selection and keyboard identity | Supported; selected identity remains the target |
| Open Shadow DOM | Overlay selects the document-visible host (`[id="open-host"]`), never `#open-button` | Host boundary; inner shadow content is not traversed |
| Same-origin iframe | Overlay cannot emit an inner-frame target; the frame remains a document boundary | Unavailable or frame host only; no silent inner capture |
| Cross-origin iframe | Overlay cannot emit cross-origin inner content; the frame remains a browser boundary | Unavailable or frame host only; no silent inner capture |
| Closed Shadow DOM | Overlay selects the visible host (`[id="closed-host"]`), never `#closed-button` | Host boundary; closed root is unsupported |

The test also clears selection, reselects after teardown, and asserts the
overlay root is removed. Resolution is never rerun against a different inner
element. Active docs state the document-root limitation rather than claiming
application Shadow DOM or iframe traversal.


## 10. Special-DOM target identity

Existing Phase 28B real-Chromium tests prove the invariant for regular DOM and
trusted duplicate-like geometry: selected = resolved = captured, including
replacement/detachment fail-closed behavior. No separate capture path was
introduced. Special-DOM identity is not claimed beyond the §9 evidence boundary.

## 11. Synthetic-metadata audit

Current Phase 29/30 packet and source contracts remain authoritative: observed
browser values originate from the browser; source qualifications/confidence are
derived from classified evidence; user intent is user-provided; unavailable
providers are represented as unavailable/omitted states. Existing provider
fault and redaction suites passed. The Phase 29 report documents the historical
fabricated viewport/user-agent/confidence/layout defect and its closure.

## 12. Provider-failure semantics

Current tests cover capture, source-hint, cancellation, screenshot/privacy, and
recapture failures. Failures become typed failed/unavailable/omitted evidence or
fail closed; they do not become verified empty defaults. `pnpm test:ci` passed
72 files / 1,089 tests.

## 13. Stale-evidence proof

Source generation invalidation and cancellation tests passed. Phase 30 fresh-MCP
E2E tests retrieve persisted capture-time source conclusions without recompute;
Phase 31 restart tests reuse only the durable original baseline. Studio workflow
reset clears transient selection/review state. No new stale cache path was
introduced.

## 14. Scaffolding removed/retained

`packages/plugin-system`, `packages/permissions`, and `packages/audit` have no
runtime consumers and remain private workspace packages with bounded unit
contracts. They are retained as explicitly internal/speculative scaffolding in
this narrow closure because deleting workspace projects would be a compatibility
and build-graph change. No plugin loading, marketplace, RBAC, telemetry, or
cloud audit service was added. Active product docs do not advertise them.

## 15. Permission boundary

Visual-review artifacts remain disabled by default and require explicit local
consent. Project-root access requires explicit `--project-root` or
`VISKOD_PROJECT_ROOT`; Studio does not infer a root from cwd. Agent config
installation is explicit, non-destructive, atomic, and idempotent. Remote URL
trust is not silently persisted or broadened.

## 16. Public error/privacy audit

Studio body-limit errors are typed HTTP 413 JSON. Browser URL rejection errors
avoid credentials and raw navigation targets. Existing Studio projections omit
selectors, packets, screenshots, absolute paths, tokens, and stack traces.
Setup reachability summaries no longer echo the final URL after redirect.

## 17. Documentation corrections

Updated `README.md`, `AGENT_WORKFLOW.md`, and `docs/setup.md` for local target
policy, credential/scheme rejection, redirect checks, and browser-boundary
language. MCP documentation already states 31 tools and remains consistent with
the source registration inventory.

## 18. MCP contract/tool inventory

The built CLI artifact contains 31 `server.registerTool` registrations, matching
`docs/mcp.md`, `README.md`, `QUICKSTART_MCP.md`, and `AGENT_WORKFLOW.md`. Setup's
required subset remains intentionally smaller (the dogfood static/runtime
setup check reports 8 required tools). `tools/list` was exercised by the agent
workflow smoke and packed-artifact verification. No duplicate alias was added.

## 19. Persisted-schema review

Existing VisualIssue, AgentHandoff, VisualReview, capture/context safe projection,
source-resolution snapshot, review manifest, and setup state schemas remained
validated. Setup state is schema version 2; malformed state fails closed.
Existing persistence suites and MCP setup corruption/restart tests passed. No
storage rewrite was performed.

## 20. Atomicity/crash-safety

Existing atomic persistence contracts were re-run through CI, E2E, dogfood, and
release checks: capture directories, issue/handoff/review manifests, setup state,
and config writes use their existing temp/rename or validated persistence paths.
Fork request-id dedup remains process-local; the exact documented boundary is a
crash between accepted request and retry. No durable idempotency record was
added in this closure.

## 21. Studio bounded state

Generic `/state` and WebSocket state remain sanitized and bounded. Issue history,
detail, packets, and review artifacts stay on dedicated endpoints. Phase 34
history caps and lifecycle truncation remain in place. Existing Studio status,
wire, responsiveness, and E2E suites passed.

## 22. Startup/shutdown regression

`pnpm test:e2e` passed 14 files / 87 tests, including the actual special-DOM
overlay matrix, port ownership, and Studio restart journeys.
`pnpm smoke:agent-workflow` passed 26/26. Existing EADDRINUSE, SIGTERM,
repeated shutdown, MCP timeout escalation, and owned-process tests passed in
CI/release validation.

## 23. Performance regression

Phase 33 warm-cache and scale measurements passed in CI: warm unchanged queries
reuse cache without content reads, refresh invalidates correctly, bounded cache
capacity remains enforced, and Studio health remains responsive during scans.
No optimization project was started.

## 24. Packed CLI final proof

The current-head hermetic installed-mode proof rebuilt and packed
`@viskod/cli@0.2.3-alpha`, installed it in an isolated temporary environment
outside the checkout, and ran the installed `viskod --help` and
`viskod setup --project-root` commands with isolated HOME/config/state/project
directories. Setup completed with live installed-mode MCP and Chromium checks.
The generated Cursor config launched the exact installed command; MCP
`initialize` returned protocol `2024-11-05`, `tools/list` returned 31 tools
(all 8 required setup tools present), and stdin shutdown left no matching
process. The config contained no `packages/cli/src/index.ts`, checkout path,
or `C:/Viskod`; the real user config was untouched.

## 25. Final real-user journey

The new rendered journey in `tests/e2e/studio-ui.test.ts` passes as one
scenario: an isolated temporary setup prelude, rendered selection → description
→ handoff, fresh MCP retrieval, fixture mutation through rendered recapture,
human decision, Studio process restart, and durable issue reopen. Setup smoke
and cleanup are asserted for the temporary project; the target fixture remains
the repository-owned rendered app used by the existing E2E harness.

## 26. Files changed

- `apps/studio/src/index.ts`
- `apps/studio/src/request-security.ts` (new)
- `apps/studio/src/studio.test.ts`
- `packages/shared/src/index.ts`
- `packages/shared/src/target-url.ts` (new)
- `packages/setup/src/checks.ts`
- `packages/setup/src/browser-smoke.ts`
- `packages/browser-runtime/src/index.ts`
- `tests/e2e/special-dom-boundaries.test.ts`
- `docs/selection-engine.md`
- `README.md`
- `AGENT_WORKFLOW.md`
- `PHASE35_SIMPLIFICATION_CONTRACT_CLOSURE_REPORT.md`

## 27. Tests added/changed

Added centralized URL-policy matrix (13 tests), Studio exact-under/over body
limit coverage, a 5-test real-browser Viskod special-DOM boundary matrix, and
the single rendered final integrated journey with fresh MCP retrieval,
mutation, decision, restart, and reopen. Updated setup smoke/dogfood to remove
the unsafe `data:` fallback. Existing Studio, setup, browser-runtime, CI, E2E,
dogfood, smoke, and release suites were rerun.

## 28. Exact validation results

| Command | Result |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS; 327 files |
| `pnpm test:ci` | PASS; 72 files / 1,089 tests |
| `pnpm test:e2e` | PASS; 14 files / 87 tests |
| `pnpm test:dogfood` | PASS; 7 files / 129 tests |
| `pnpm smoke:agent-workflow` | PASS; 26/26 |
| `pnpm build:cli && node scripts/verify-cli-artifact.mjs` | PASS |
| `pnpm release:check` | PASS; CI 1,089 + dogfood 129 + smoke 26/26 + artifact |

Focused Phase 35A tests: special-DOM overlay matrix 5 passed; setup,
timeout, and command-factory suites 75 passed. The installed-mode browser
check was corrected to recognize bundled Playwright without requiring it in
the user's project.


## Phase 35A — Final Audit Ledger & Product-Proof Closure

### AUDIT-019 architecture disposition

Current `apps/studio/src/index.ts` is 2,295 lines and 82,332 bytes. Route
dispatch remains physically in `Studio.routeHttpRequest()` in that file.
`index.ts` still owns composition-root dependency construction, Studio state,
HTTP/WebSocket listener setup, route dispatch, workflow/domain endpoint
handlers, browser/overlay lifecycle, setup status, source-status projection,
MCP config generation, and shutdown. `request-security.ts` is extracted, but
the route/transport boundary is not a separate module.

Duplicated Studio rendering still exists: there are two production renderer
implementations, the server-side `ui.ts` renderer (`screenHtml` /
`renderScreen`) and the inline browser JavaScript `render()` function embedded
by `renderStudioHtml()`. Therefore AUDIT-019 is **BOUNDED PRODUCT LIMITATION**,
not FIXED. The remaining debt is consolidation of those two render paths and
extraction of route dispatch without changing endpoint/state contracts.
Current regression coverage includes Studio route/state, UI renderer, rendered
workflow, and E2E lifecycle suites.

### Special-DOM actual Viskod boundary proof

The real Chromium test `tests/e2e/special-dom-boundaries.test.ts` now injects
the production Viskod overlay script, enters its selection mode, clicks each
boundary, checks emitted target identity where available, rejects any inner
target substitution, clears/reselects, and tears down the overlay. Open
Shadow DOM resolves only the host; same-origin and cross-origin iframe content
is unavailable to the top-document selection path; closed Shadow DOM resolves
only the host. No traversal support is claimed.

### Audit ledger source and disposition rule

Rows 001–032 below retain one ID per original Terra finding. The exact
original wording supplied for 016, 019, 022, 024, and 026 is preserved
verbatim; no finding is renumbered or reclassified as
`VERIFIED NOT REPRODUCIBLE` when later phases confirmed and fixed it.

### Current validation evidence

`tests/e2e/special-dom-boundaries.test.ts` passed 5/5 after the Viskod overlay
path was added. The setup browser-check correction was typechecked and the
focused setup/timeout/command-factory suites passed 75/75. The full required
validation matrix in §28 and the release gate are green.

## 29. Process/temp hygiene

After validation, targeted process and listener checks found no Viskod Studio,
MCP, Chromium, or test-owned port-3000/3001 process. The hermetic installed
environment and temporary project remained outside the checkout; their exact
paths are local test evidence only and are not part of active product docs.
Unknown processes were never terminated.

## 30. Final VISKOD-AUDIT-001..032 matrix

| ID | Original finding | Final disposition | Fix phase | Current evidence | Remaining boundary |
|---|---|---|---|---|---|
| 001 | Studio handoff button only created issue | FIXED | 28 | Rendered Studio + smoke 26/26 | Human still controls handoff |
| 002 | Studio lacked project/source composition | FIXED | 30 | Source-resolution Studio E2E | Explicit project root required |
| 003 | Handoff packet references unavailable after restart | FIXED | 29 | Fresh-process handoff retrieval E2E | Only persisted safe context is retrievable |
| 004 | Review did not persist/compare real before screenshot | FIXED | 31 | Visual-review UI/E2E and artifact tests | Artifacts remain local-sensitive |
| 005 | Unchanged target reported changed | FIXED | 31 | Real Chromium unchanged review E2E | Human decision remains authoritative |
| 006 | Studio broad bind/CORS wildcard/WS origin gap | FIXED | 27 | Studio origin/listener tests | Loopback-only service |
| 007 | DOM/screenshot content bypassed privacy boundary | FIXED | 29 | Privacy E2E and packet redaction tests | Local-sensitive crops are not agent-safe |
| 008 | Confidence inflation and generic component guesses | FIXED | 30 | Calibration/ranking tests and source E2E | Source hints remain probabilistic |
| 009 | Failed MCP verification implied limited completion | FIXED | 32 | Setup timeout/capability tests | Limited mode requires explicit consent |
| 010 | Disabled capture profile still performed browser work | FIXED | 27 | Capture profile gating tests | Enabled capture still needs browser |
| 011 | Capture persistence left partial/stale paths | FIXED | 29 | Capture persistence/E2E tests | Crash boundary is filesystem atomicity |
| 012 | Element document order always -1 | FIXED | 27 | Real Chromium dogfood | Browser ordering is document-local |
| 013 | Overlay remained active and async polling overlapped | FIXED | 28 | Overlay lifecycle dogfood | One overlay per page |
| 014 | Recovery controls absent and stale state leaked | FIXED | 28 | Rendered recovery/reselect E2E | Recovery cannot restore a detached target |
| 015 | Invalid selector generated synthetic unknown target | FIXED | 28 | Invalid/ambiguous live-DOM E2E | Invalid targets fail closed |
| 016 | Project discovery is insufficient for realistic monorepos. | FIXED | 33 / 33A | Declared workspace discovery, cross-package source resolution, explicit repository-root boundary, async bounded traversal, cache bounds/invalidation, and real workspace Studio/fresh-MCP E2E | Explicit project root remains required |
| 017 | E2E required manually started Studio | FIXED | 27/32B | 14-file self-contained E2E pass (87 tests) | Existing external apps remain caller-owned |
| 018 | Release check failed from repo-owned drift | FIXED | 27/32A | `pnpm release:check` PASS | Toolchain warnings are non-blocking |
| 019 | Studio centralizes unrelated responsibilities and duplicated renderer logic exists. | BOUNDED PRODUCT LIMITATION | 35 / 35A | `request-security.ts` and `routeHttpRequest()` extraction; route/state regression coverage; current architecture audit | Two production render paths remain (`ui.ts` server HTML/state renderer and inline browser `render()`); route dispatch is still physically in `apps/studio/src/index.ts` |
| 020 | E2E bypassed rendered product workflow | FIXED | 28 | Rendered Studio E2E | Lower-level API tests remain intentionally direct |
| 021 | Studio request bodies/expensive work unbounded | FIXED | 35 | 256 KiB tests, in-flight guards, CI/E2E | Limits are per process, not distributed |
| 022 | Source-hint resolution blocks synchronously and caches without bounds/invalidation. | FIXED | 33 / 33A | Async traversal, bounded concurrency, bounded LRU, scan generations, edit/add/delete/config invalidation, warm query zero content reads/parses, and Studio responsiveness during scan | Explicit project root and bounded scan budgets remain |
| 023 | Review UI lacked visual evidence and notes | FIXED | 31 | Visual-review rendered E2E | Human decision is not automated truth |
| 024 | Visual selection is not keyboard-accessible. | FIXED | 34 / 34A / 34B | Keyboard candidate navigation, rendered keyboard Studio flow, duplicate-target B identity, cancel/reselect, focus/live/error/reduced-motion regressions | Formal WCAG conformance is not claimed |
| 025 | Shadow DOM/iframe support claim conflicted | BOUNDED PRODUCT LIMITATION | 35 | Real Chromium browser-boundary matrix; truthful docs | Current Viskod document-root path does not traverse application Shadow DOM/iframe contents |
| 026 | Persisted issue/review/handoff history and usable lifecycle/fork workflow are not surfaced through Studio. | FIXED | 34 / 34A / 34B | Durable issue history/detail, restart/resume, edit/archive/reopen, parent-child fork lineage, bounded history, and rendered restart/fork E2E | History/detail remain bounded dedicated endpoints |
| 027 | Checkout-specific setup/config behavior | FIXED | 32 | Packed CLI and config tests | Dev mode necessarily references source checkout |
| 028 | Active docs overstated behavior | FIXED | 35 | Docs sweep and corrected URL/DOM language | Historical reports intentionally retain old claims |
| 029 | Startup collision/shutdown lifecycle unsafe | FIXED | 27/32B | EADDRINUSE, timeout, ownership, E2E tests | Unknown owners are never terminated |
| 030 | Arbitrary remote/dangerous target URLs accepted | FIXED | 35 | URL matrix, browser validation, setup redirect check | Remote hosts require explicit allowlist; no current remote opt-in UX |
| 031 | Plugin/permission/audit/workspace scaffolding implied product support | BOUNDED PRODUCT LIMITATION | 35 | No runtime consumers; private package tests; docs audit | Internal packages retained for graph compatibility |
| 032 | Synthetic/stale metadata and swallowed provider failures | FIXED | 29/30/35 | Fault, invalidation, redaction, and E2E suites | Unavailable optional evidence is explicit |

## 31. Known product boundaries

- Local-first navigation rejects remote hosts by default.
- Closed Shadow DOM and cross-origin iframe contents are browser boundaries.
- Source ownership is probabilistic, not exact ownership.
- Visual review artifacts are local-sensitive and human-reviewed.
- Studio state is bounded; history/detail are separate endpoints.
- Formal WCAG conformance is not claimed.
- Windows/macOS native execution was not performed in this Linux run.
- Fork request-id dedup is process-local across crashes.

## 32. Final PASS / PARTIAL / FAIL

**PASS.** All 32 audit findings have explicit dispositions. Studio bootstrap
responsibilities, request bounds, expensive-work concurrency, URL/redirect
policy, truthful browser-boundary documentation, provider/stale-evidence
contracts, persistence safety, bounded state, process ownership, cache
invariants, packed CLI, the hermetic integrated journey, and required release
gates are green. Unsupported application Shadow DOM/iframe contents are
documented as bounded browser/product limitations rather than claimed as
supported.
