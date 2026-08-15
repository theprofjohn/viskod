# PHASE 29 — CONTEXT INTEGRITY, PRIVACY & AGENT RETRIEVAL REPORT

Date: 2026-08-15
Status: PASS

---

## 1. Executive Summary

Phase 29 makes a Viskod capture a **durable, truthful, privacy-safe,
retrievable unit of agent context**. All four audited findings
(VISKOD-AUDIT-003, -007, -011, -032) plus the Phase 28 deferred
partial-capture item were confirmed against the live codebase and fixed.

Implemented:

- **One packet-level redaction boundary** (`@viskod/shared` redaction library
  + `redactPacketForPersistence`) applied **before** persistence — the
  packet on disk is already safe.
- **Sensitive-attribute default-deny policy** — `value`, `password`,
  `token`, `secret`, `data-secret`, `authorization`, `--*-token`, … values
  are replaced wholesale regardless of format.
- **Screenshot privacy policy** — default `agent-safe-omit`: raw pixels exist
  only transiently in memory; persisted captures record
  `omitted_sensitive`. Explicit `persist-raw` opt-in marks artifacts
  `sensitive: true` and is never represented as redacted.
- **Truthful runtime metadata** — actual page URL (post-redirect),
  viewport, and user agent are observed; `confidence` values are `null`
  when no provider computed them; fabricated layout defaults removed.
- **Complete / partial / failed capture contract** with a per-provider
  evidence-status map and sanitized diagnostics.
- **Atomic capture persistence** — sibling temp directory + atomic rename;
  failed writes never become listable captures (deterministic
  failure-injection tests at every write stage).
- **Durable lookup** — capture by opaque `captureId`, resolution from
  `packetId`, schema-validated loads, typed corruption/mismatch failures.
- **Handoff → durable capture link** — issues and handoffs reference the
  persisted capture by opaque `captureId`.
- **`get_handoff_context` MCP tool** — fresh-process retrieval of a compact,
  budgeted, agent-safe context projection using only the opaque handoff ID.
- **Fresh-process Studio → MCP retrieval E2E** (real stdio MCP transport)
  and a **Phase 28B identity-through-persistence regression** (candidate B
  stays B).

Validation: `pnpm typecheck`, `pnpm test:ci` (852), `pnpm test:e2e` (35),
`pnpm test:dogfood` (126), `pnpm smoke:agent-workflow` (26/26),
`pnpm build:cli` + `scripts/verify-cli-artifact.mjs`, and
`pnpm release:check` all pass.

---

## 2. Audit Findings Confirmed / Not Reproducible

All four audited findings were **confirmed** against the current code before
any change:

| Finding | Confirmed | Evidence |
|---|---|---|
| VISKOD-AUDIT-003 — handoff references packets the agent cannot retrieve | ✅ | `HandoffServiceImpl.createHandoff` (`packages/agent-handoff/src/service.ts`) builds `packetRefs` from `issue.evidence.contextPacketId` (in-memory `packetId`); no persisted `packetId → capture` lookup existed anywhere. |
| VISKOD-AUDIT-007 — DOM/screenshot content bypass packet-level privacy | ✅ | `VisualContextEngine.generatePacket` redacted only `RuntimeEvidence` (`redactEvidence`); `selection.text`, `dom.attributes`, hierarchy text, `browser.url`, source-hint text, and screenshot pixels were persisted unredacted (see persisted `.viskod/captures/*/packet.json` before-state). |
| VISKOD-AUDIT-011 — partial persistence + stale paths | ✅ | `CapturePipeline.persistCapture` created the **final** directory first, wrote artifacts incrementally; crash between writes left a listable capture. Persisted `packet.json` referenced the transient screenshot path `"<uuid>.png"` while the real file was `selection.png` — the packet was serialized **before** final references were attached. |
| VISKOD-AUDIT-032 — synthetic/stale metadata + swallowed failures | ✅ | Persisted packets contained `viewport: {1280,720}`, `userAgent: "Viskod/1.0"`, `confidence: {0, 0.5, 0.8, 0}`, fabricated `styles.layout`, `dom.depth: 0`; optional styles/screenshot/console/network failures and persistence failures were silently swallowed (`if (result.ok)` / `catch { best-effort }`). |
| Phase 28 deferred — valid target + optional failure needs partial semantics | ✅ | Before-state: optional provider failures were invisible; only fail-closed core behavior existed. |

No finding required manufacturing — every behavior above was observed in the
running system and in persisted artifacts.

---

## 3. Context Lifecycle Before / After

**Before**

```
raw capture → (runtime-evidence-only redaction) → persist raw packet
→ attach final paths AFTER serialization → MCP reads in-memory lastPacket
→ handoff references in-memory packetId → agent cannot retrieve after restart
```

**After**

```
capture raw ephemeral evidence (in memory)
→ build packet with ACTUAL runtime facts + evidence statuses
→ packet-level redaction boundary (deep, all text/attributes/URLs)
→ screenshot privacy policy applied (default: pixels omitted)
→ validate persisted-safe schema (envelope)
→ write final artifacts to sibling temp dir (never listable)
→ serialize packet with FINAL references → validate → fsync
→ atomic rename to opaque capture dir
→ persisted safe packet = source of truth
→ handoff references opaque captureId
→ fresh MCP: get_handoff_context → load persisted handoff → schema-validate
  capture → compact budgeted projection
```

---

## 4. Complete / Partial / Failed Semantics

Defined in `packages/context-engine/src/evidence-status.ts`:

- **Complete** — every enabled evidence provider required by the capture
  profile succeeded; nothing missing, nothing deliberately omitted.
- **Partial** — core target valid and core evidence collected, but one or
  more OPTIONAL enabled providers failed or were deliberately omitted for
  privacy. The packet remains usable and its `evidence` map states exactly
  what is missing and why (provider + typed code + sanitized reason).
- **Failed** — unresolved target, detached resolved target, corrupt core DOM
  evidence, required persistence failure, or invalid packet schema.
  `generatePacket` fails closed with a typed error; a failed capture never
  returns a successful packet.

Packet-level `captureStatus` carries `'complete' | 'partial'`; `failed` is
expressed by the error result. Phase 28 selector/target-resolution failures
remain fail-closed (unchanged).

---

## 5. Evidence-Status Schema

`packages/context-engine/src/evidence-status.ts`:

```ts
type EvidenceState =
  | 'collected' | 'disabled' | 'unavailable'
  | 'failed' | 'redacted' | 'omitted_sensitive';

interface EvidenceDiagnostic { provider: string; code: string; reason: string }

interface EvidenceStatus { state: EvidenceState; diagnostic?: EvidenceDiagnostic }

interface EvidenceMap {
  dom; hierarchy; styles; screenshot; runtime; sourceHints: EvidenceStatus;
}
```

`deriveCaptureIntegrity(evidence)` → `complete` | `partial` (any `failed` or
`omitted_sensitive` ⇒ partial; `disabled`/`unavailable` do not degrade).
Diagnostics are sanitized via `sanitizeErrorDetail` (absolute paths and
multi-line stacks stripped, 200-char cap) — never secrets, stacks, or paths.

---

## 6. Synthetic Metadata Removed

`packages/context-engine/src/index.ts` (`generatePacket`):

| Field | Before (fabricated) | After |
|---|---|---|
| `browser.url` | `this.currentUrl` (requested URL) | `getPageUrl(handle)` — actual navigated URL; `'unavailable'` when unobservable |
| `browser.viewport` | `{1280, 720, 1}` | `getViewport(handle)` real values |
| `browser.userAgent` | `'Viskod/1.0'` | `navigator.userAgent` observed via page evaluate |
| `confidence.sourceMapping` | `0.0` | `null` (no provider) |
| `confidence.semanticLabeling` | `0.5` | `null` (no provider) |
| `confidence.layoutAnalysis` | `0.8`/`0.3` | `null` (no provider) |
| `confidence.frameworkDetection` | `0.0` | `projectScan.frameworkConfidence` when a real scan exists, else `null` |
| `styles.layout` | default block/static/zero box | `null` (no layout-analysis provider) |
| `dom.depth` | `0` | kept structural (depth of the snapshot root; not a fabricated observation — see Known Limitations) |

Tests: `context-engine.test.ts` "Phase 29 — truthful runtime metadata"
asserts actual values and null confidence.

---

## 7. Packet-Level Redaction Architecture

- `packages/shared/src/redaction.ts` — the single reusable redaction
  library: `RedactionRule`, `DEFAULT_REDACTION_RULES`, `applyRedaction`,
  `isSensitiveAttributeName` (conservative `-`/`_`-segment matching),
  `deepRedactValue` (recursive, key-based default-deny), `sanitizeErrorDetail`.
- `packages/context-engine/src/packet-redaction.ts` —
  `redactPacketForPersistence(packet)` deep-walks the entire packet before
  persistence; the returned packet IS the persisted representation.
- `packages/browser-runtime/src/evidence.ts` now re-exports/uses the shared
  primitives (its public API is unchanged); `redactRecord` gained
  key-based default-deny for headers/attributes.
- `packages/agent-handoff/src/redaction.ts` builds on the shared rules and
  `deepRedactValue`; no independent regex engine remains.

One boundary, one engine. Redaction is idempotent (tested).

---

## 8. Structured Fields Covered by Redaction

Deep walk covers **all** string leaves of the persisted packet, including:

- DOM text (`selection.text`, `dom` text fields), DOM attributes (key-deny +
  regex)
- hierarchy node text/attributes (via structural types)
- computed styles (values; `--*-token` keys default-denied)
- URLs and query parameters (`browser.url`, network request URLs,
  `sourceHints` evidence)
- console messages and stacks
- network headers (`authorization`, `cookie`, … default-denied)
- page metadata and source-hint text
- issue-derived fields that travel inside the packet

Regression fixture: `packages/context-engine/src/packet-redaction.test.ts`
with synthetic secrets across every surface + persisted-artifact scan
(`packet.json`, `metadata.json`).

---

## 9. Screenshot Privacy Policy

- Default `{ mode: 'agent-safe-omit' }` (constructor default):
  - raw screenshot pixels exist only transiently in memory during capture;
  - the persisted capture contains **no** image file;
  - `packet.screenshots[].status = 'omitted_sensitive'`, `path = null`,
    `sensitive = true`;
  - `packet.metadata.capturePolicy.screenshot = 'omitted_sensitive'`;
  - the agent-safe retrieval API never returns an unredacted screenshot.
- Explicit opt-in `{ mode: 'persist-raw', reason }` (`setScreenshotPolicy`):
  - the raw image is persisted with final name `selection.png`;
  - every entry is marked `status: 'collected'`, `sensitive: true`;
  - `capturePolicy.screenshot = 'raw_sensitive'` — never represented as
    redacted.
- No OCR or image-processing dependency was added (Phase 31 owns safe
  visual-review artifacts). There is no screenshot-mask primitive in the
  current architecture, so omission is the chosen safe policy.
- Consent is never inferred from the historical `collectScreenshot` profile
  flag; the policy is an explicit, separately-named decision.

---

## 10. Ephemeral Raw vs Persisted Safe vs Agent Projection

| Boundary | Contents | Guarantees |
|---|---|---|
| Ephemeral raw capture | buffers, raw DOM, raw URLs (in memory during `generatePacket`) | never persisted/exported; consumed transiently |
| Persisted safe capture | redacted, schema-validated packet + metadata (+ raw screenshot only under explicit opt-in, marked sensitive) | atomic commit; schema/privacy version unambiguous (`schemaVersion 1.1.0`); source of truth after restart |
| Agent projection | compact budgeted slice (see §15) | no raw internals, no absolute paths, no secrets, bounded sizes |

Documented in code (`packet-redaction.ts`, `agent-projection.ts`,
`capture-pipeline/src/index.ts` contracts) and in `docs/capture-pipeline.md`.

---

## 11. Atomic Capture Persistence

`packages/capture-pipeline/src/index.ts` `persistCapture`:

1. validate `captureId` (UUID) + storage space;
2. **validate the FINAL packet against `PersistedPacketSchema` before any
   write** (including `captureId` cross-check);
3. create a sibling temp directory `"<captureId>.tmp-<ts>-<rand>"` (never a
   valid capture id → never listable);
4. write artifacts (screenshots under opt-in), metadata.json (derived from
   the packet envelope — single source of truth), packet.json (temp +
   fsync + rename);
5. atomic `renameSync(tempDir, finalDir)` — the capture appears only
   complete and schema-valid;
6. any failure: best-effort temp cleanup, typed `CP_PERSIST_FAILED` error.

Windows-safe: directory rename of a fresh UUID target; no Unix-only
semantics. `listCaptures`/`getCapture`/retention/stats ignore non-UUID
directories by construction.

---

## 12. Failure-Injection Results

Deterministic hooks (`PersistenceTestHooks.failOn`) injected at:

- `before-metadata`, `after-artifact`, `before-packet`, `during-packet`,
  `before-commit`.

For **every** stage (`capture-pipeline.test.ts`):

- `persistCapture` returns a typed `CP_PERSIST_FAILED` error;
- `listCaptures()` exposes nothing;
- `getCapture(id)` returns `CP_CAPTURE_NOT_FOUND`;
- `loadPersistedPacket(id)` returns not-found;
- no final committed directory exists;
- one failed capture does not corrupt another committed capture;
- temp residue is never treated as a capture.

---

## 13. Packet Normalization / Final-Reference Behavior

- `generatePacket` generates the durable `captureId` **upfront** and builds
  the packet with final screenshot references (`null` under agent-safe
  policy, `'selection.png'` under raw opt-in) **before** `JSON.stringify`.
- The persisted `packet.json` contains final durable references — the
  transient `<uuid>.png` path leak is gone (verified in before/after
  persisted packets).
- The packet returned to callers is the same redacted, finalized packet that
  was persisted.
- `ContextPacket.captureDir` / `absoluteCaptureDir` were **removed** from the
  public type; absolute paths never reach agent/user-facing surfaces.
- Persistence failure (when a pipeline is composed) is a typed
  `VCE_PERSIST_FAILED` failure — never a silent success.

---

## 14. Capture Lookup by Opaque ID

`CapturePipeline`:

- `getCapture(captureId)` — validates metadata.captureId === requested id;
- `getPacketCapture(packetId)` — deterministic scan of persisted metadata;
- `loadPersistedPacket(captureId)` — JSON parse → `PersistedPacketSchema` →
  captureId/packetId cross-checks; `CP_PACKET_CORRUPT` /
  `CP_PACKET_MISMATCH` / `CP_METADATA_CORRUPT` typed failures.

Tests: restart-survival (fresh pipeline instance), packetId→capture
resolution, missing capture, corrupt JSON, schema-invalid packet, mismatch
(§18).

---

## 15. Agent-Safe Projection Schema

`packages/context-engine/src/agent-projection.ts` — `AgentContextProjection`:

```ts
{
  schemaVersion: '1.0.0', projectionVersion: 1,
  captureId, packetId, captureStatus, timestamp,
  handoffId?, issueId?,
  problem?: { title, summary, userNote }, expectedResult?,
  target: { selector, tagName, boundingBox, text, attributes, fingerprint? },
  page: { url (redacted), title?, viewport },
  hierarchy: { selectedNode, parents (capped) },
  styles: { computed (budgeted), status },
  evidence: EvidenceMap,
  runtime: { status, consoleSummary?, networkSummary?, selectedElement? },
  sourceHints: { status, count },          // 'unavailable' when no engine — never fabricated
  screenshot: { status, count, sensitive, items },
  redactions: string[],
}
```

No source hints are added artificially: Studio (no engine composed) reports
`sourceHints: unavailable`; MCP reports collected/failed/unavailable
truthfully.

**Budgets** (`DEFAULT_PROJECTION_BUDGET`): target text 500, attributes 20 ×
200, parents 8, style entries 40 × 200, console 10 (sample 200), network 10
(url 200), source hints 5.

---

## 16. Handoff → Persisted Capture Relationship

- `IssueEvidenceSummary` gains `captureId` (durable); Studio workflow
  `buildEvidenceSummary` records `packet.captureId`.
- `AgentHandoffContext.packetRefs[].captureId` — handoffs reference the
  persisted capture by opaque id; `packetId` retained for compatibility.
- Survives Studio restart, MCP restart, fresh agent connection — no module
  globals, no `latestCapture`, no paths.
- `get_agent_handoff` remains the metadata/brief primitive; the new
  `get_handoff_context` is the dedicated retrieval primitive.

---

## 17. New MCP Context Retrieval API

`get_handoff_context(handoffId)` (`packages/mcp-server/src/entry.ts` +
`handoff-context.ts`):

1. validate `handoffId` (`/^[A-Za-z0-9_-]{1,64}$/` — traversal/absolute-path
   shapes rejected before any lookup);
2. load the persisted handoff (schema-validated, marks opened);
3. resolve each `packetRefs[].captureId` through `CapturePipeline` (opaque
   id only);
4. schema-validate and load the safe packet;
5. build the compact agent-safe projection (with issue intent + target
   fingerprint from the brief);
6. typed errors: `HANDOFF_NO_PERSISTED_CAPTURE`, `HANDOFF_CAPTURE_MISSING`,
   `HANDOFF_CAPTURE_CORRUPT`, `HANDOFF_CAPTURE_MISMATCH` — no raw packet
   paths, no unsanitized persistence errors.

`HandoffPersistence` itself rejects malicious ids (`INVALID_HANDOFF_ID`),
protecting `get_agent_handoff` too.

---

## 18. Fresh-Process Studio → MCP Retrieval Proof

`tests/e2e/handoff-context-retrieval.test.ts` (real stdio MCP transport,
real Chromium):

1. Studio + privacy fixture: real capture/issue/handoff flow via the
   rendered UI; only the opaque `handoffId` recorded.
2. Studio process stopped.
3. Fresh MCP server process started.
4. `get_agent_handoff(handoffId)` → brief with correct title.
5. `get_handoff_context(handoffId)` → projection with:
   - exact persisted selected target (`#privacy-card`), useful DOM text
     (`Credentials`, `Save changes`);
   - issue intent (`problem.title`);
   - evidence statuses (`dom: collected`, `screenshot: omitted_sensitive`,
     `sourceHints: unavailable`);
   - redaction (none of the 9 synthetic secrets anywhere);
   - no absolute path (`C:\`, `/Users/`, `captureDir`, `packet.json`,
     `viskod/captures`);
   - credential query parameter redacted (`token=[REDACTED]`);
   - no raw screenshot (status `omitted_sensitive`, `sensitive: true`).
6. Malicious ids (`../`, `..\..\secret`, `C:\Users\victim`, `/etc/passwd`)
   fail safely on both tools.

All 10 tests in the file pass.

---

## 19. Redaction E2E Proof

`examples/privacy-app/server.cjs` (fixture with password input, API-key
text, bearer token, credential query param, email, card, base64 token,
`data-secret` attribute, useful neighboring text) captured through the real
browser path. Assertions on persisted `packet.json`, `metadata.json`,
`handoff.json`, and the agent-safe retrieval response: **none** of the
synthetic secrets appear; `data-secret` → `[REDACTED]`; session token →
`[SECRET_REDACTED]`; card → `[CARD_REDACTED]`; query token → `[REDACTED]`;
useful text preserved. Raw screenshots are not persisted under the default
policy (no image files in the capture dir).

---

## 20. Partial Evidence Failure Proof

`context-engine.test.ts` "Phase 29 — partial evidence semantics":

- styles failure → `captureStatus: partial`, `evidence.styles.state:
  failed`, sanitized diagnostic (no absolute path, no stack), core still
  usable;
- screenshot failure → partial with `BR_SCREENSHOT_FAILED` diagnostic,
  `screenshots: []`;
- runtime (console) failure → partial, `evidence.runtime.state: failed`,
  diagnostic names the provider, DOM/selection intact;
- source hints unavailable is explicit (`unavailable`, not silently absent);
- core DOM failure → capture **fails** (`SELECTOR_NO_MATCH`) — never a
  partial success;
- fully successful audit-profile capture → `complete`.

---

## 21. Phase 28B Target-Identity Persistence Proof

`tests/e2e/handoff-context-retrieval.test.ts`:

- Studio + duplicate-target fixture, trusted geometry resolves B:
  - **persisted** `packet.json` describes B (`data-target=b`, `id=card-b`,
    parent `main`, text `SECOND CARD`; no `FIRST CARD`/`card-a`/`parent-a`);
  - fresh MCP `get_handoff_context` projection describes B and only B;
  - the RESOLVED TARGET = CAPTURED TARGET invariant survives persistence and
    agent retrieval.

---

## 22. Files Changed

**New**
- `packages/shared/src/redaction.ts`
- `packages/context-engine/src/evidence-status.ts`
- `packages/context-engine/src/packet-redaction.ts`
- `packages/context-engine/src/agent-projection.ts`
- `packages/mcp-server/src/handoff-context.ts`
- `tests/e2e/handoff-context-retrieval.test.ts`
- `examples/privacy-app/server.cjs`
- `PHASE29_CONTEXT_INTEGRITY_AGENT_RETRIEVAL_REPORT.md`

**Modified**
- `packages/shared/src/index.ts`
- `packages/browser-runtime/src/evidence.ts`
- `packages/agent-handoff/src/{redaction,persistence,schemas,service,types}.ts`
- `packages/context-engine/src/{index,agent-exporter}.ts`
- `packages/capture-pipeline/src/index.ts`
- `packages/mcp-server/src/{entry,handoff-tools.test}.ts`
- `packages/visual-issue/src/{schemas,types}.ts`
- `apps/studio/src/{workflow,index}.ts`
- `packages/cli/src/capture-context.test.ts`
- `docs/mcp.md`, `docs/capture-pipeline.md`
- `MEMORY.md` (Decision 046)

## 23. Tests Added / Changed

**New**
- `packages/capture-pipeline/src/capture-pipeline.test.ts` (rewritten: 33
  tests — atomic commit, failure injection ×5 stages, opaque lookup,
  corruption/mismatch, restart survival, traversal rejection)
- `packages/context-engine/src/packet-redaction.test.ts` (8 — synthetic
  secrets, default-deny, URL/header redaction, useful-context preservation,
  idempotency, persisted-artifact scan)
- `packages/context-engine/src/agent-projection.test.ts` (5 — budgets,
  identity/statuses, screenshot marking, no fabricated hints, no paths)
- `packages/mcp-server/src/handoff-context.test.ts` (7 — resolution,
  no-ref, missing, corrupt, mismatch, traversal, persistence hardening)
- `tests/e2e/handoff-context-retrieval.test.ts` (10 — fresh-process
  retrieval, privacy E2E, Phase 28B identity through persistence, malicious
  ids)

**Extended**
- `packages/context-engine/src/context-engine.test.ts` (Phase 29: truthful
  runtime facts, unavailable facts, null confidence, framework confidence
  from real scan, null layout, partial evidence ×6, screenshot policy ×2)
- `packages/mcp-server/src/handoff-tools.test.ts` (tool count 5→6)
- `packages/context-engine/src/agent-exporter.test.ts`,
  `packages/cli/src/capture-context.test.ts` (new packet shape; absolute-path
  removal assertions)

---

## 24. Exact Validation Commands / Results

| Command | Result |
|---|---|
| `npx tsc -b` | ✅ no errors |
| `npx biome check` (changed files) | ✅ clean |
| `pnpm test:ci` | ✅ 852 tests, 44 files |
| `pnpm test:e2e` | ✅ 35 tests, 6 files |
| `pnpm test:dogfood` | ✅ 126 tests, 7 files |
| `pnpm smoke:agent-workflow` | ✅ 26/26 |
| `pnpm build:cli && node scripts/verify-cli-artifact.mjs` | ✅ artifact verified |
| `pnpm release:check` | ✅ full gate (biome + tsc + test:ci + dogfood + smoke + bundle + artifact) |

Independent runs: atomic persistence failure injection (5 stages), persisted
packet redaction scan, partial evidence tests, fresh-process MCP retrieval
E2E, Phase 28B identity → persistence → fresh retrieval.

## 25. Regression Results

- Phase 27/28 suites green: `selector-ambiguity.test.ts`,
  `resolved-target-consistency.test.ts` (all 5 tests), `studio-flow`,
  `studio-ui`, `chat-workflow`, dogfood Phase 26/27/28, MCP handoff/review/
  setup tools.
- Redaction behavior preserved for browser-runtime evidence (28 tests) and
  agent-handoff (44 tests).
- No orphan Chromium/dev-server/MCP processes; ports 3000/3001/3221/3222
  released; no temporary failed-capture directories remain
  (`.viskod/captures` contains 0 `*.tmp` entries).

## 26. Known Limitations

- Legacy persisted packets (`schemaVersion 1.0.0`) are not treated as
  privacy-safe; consumers must re-capture (documented — no silent
  migration).
- `packet.dom.depth` remains structural (`0`); a real depth observation is
  not collected by the browser snapshot — no fabrication was introduced,
  but the field stays as-is for schema compatibility.
- Screenshot-enabled captures under the default policy report
  `captureStatus: partial` (screenshot `omitted_sensitive`) by design — the
  status map makes the reason explicit.
- Regex redaction cannot classify every possible free-text secret; the
  default-deny attribute policy is the format-agnostic guarantee, and
  keyword-adjacent free text is covered by the shared rules.

## 27. Deferred Phase 30+ Work

- Phase 30: source-hint ranking/confidence; `confidence.sourceMapping` and
  qualified `sourceHints` in the projection.
- Phase 31: safe visual-review artifact strategy (screenshot masking /
  thumbnails / pixel diff); review side-by-side UI.
- Studio SourceHintEngine composition, monorepo workspace discovery,
  before/after persistence architecture beyond the Phase 29 screenshot
  policy, OCR, cloud, telemetry — all out of scope (non-goals honored).

## 28. Final Verdict

**PASS**

All PASS criteria verified:

- persisted structured capture redacted before disk write ✅
- raw screenshots never silently cross the safe boundary; policy explicit
  and tested ✅
- directory-atomic commit; failed writes never listable ✅
- persisted packet holds final durable references (no transient/stale
  paths) ✅
- actual URL/viewport/user-agent replace synthetic defaults; unavailable =
  unavailable ✅
- optional evidence failures → explicit partial + sanitized diagnostics ✅
- required core failure still fails closed ✅
- capture loadable by opaque id after restart ✅
- handoff references the durable capture ✅
- fresh MCP process retrieves handoff context by opaque handoff id ✅
- returned agent context compact, useful, no absolute paths, no synthetic
  secrets ✅
- path traversal identifiers fail safely ✅
- Phase 28B candidate B remains B after persistence and fresh-process
  retrieval ✅
- Phase 27/28 regression suites green; `pnpm release:check` passes ✅
