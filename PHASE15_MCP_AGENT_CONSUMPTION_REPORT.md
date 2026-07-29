# Phase 15 MCP Agent Consumption Report

**Date:** 2026-07-28

---

## What Was Built

Two new MCP tools and a test suite that streamline the agent workflow from:

```
capture → locate packet.json → export → read brief
```

to:

```
capture_context → receive brief immediately
```

### MCP Tools Added

| Tool | Description |
|---|---|
| `capture_context` | Capture an element and return an agent-ready context brief in one call |
| `recapture_context` | Re-capture and optionally compare with a previous capture (bounding box deltas, evidence diff) |

### Schemas

#### capture_context

| Input | Type | Required | Default | Description |
|---|---|---|---|---|
| `selector` | string | ✅ | — | CSS selector for the element |
| `url` | string | ❌ | — | URL to navigate to |
| `profile` | enum | ❌ | `default` | `default`, `debug`, or `audit` |
| `format` | enum | ❌ | `markdown` | `markdown` or `json` |

| Output Field | Description |
|---|---|
| `packetId` | Unique packet identifier |
| `profile` | Capture profile used |
| `briefFormat` | Format of the returned brief |
| `brief` | Agent-ready context brief (markdown or JSON) |
| `screenshotPaths` | List of screenshot filenames |
| `sourceHintCount` | Number of source hints |
| `runtimeEvidenceSummary` | `{ console: number, network: number }` |
| `redactionSummary` | List of applied redaction types |

#### recapture_context

Same inputs as `capture_context`, plus:

| Input | Type | Required | Description |
|---|---|---|---|
| `previousPacketPath` | string | ❌ | Path to previous `packet.json` for before/after comparison |

Additional output field:

| Output Field | Description |
|---|---|
| `comparisonSummary` | `{ boundingBoxDelta, screenshotsBefore/After, sourceHintsBefore/After, consoleBefore/After, networkBefore/After }` |

### Architecture Boundaries

| Rule | Status |
|---|---|
| MCP layer orchestrates existing RuntimeSession/VCE/exporter | ✅ Tools reuse `session.capture()` and `generateExport()` |
| BrowserRuntime still only collects evidence | ✅ No change |
| SourceHintEngine still only produces hints | ✅ Passed through packet unchanged |
| Exporter still only formats packets | ✅ `generateExport` unchanged |
| CapturePipeline still persists artifacts | ✅ Unchanged |
| No code editing inside Viskod | ✅ Exporter is read-only |

---

## Tests Added

10 tests in `packages/cli/src/capture-context.test.ts`:

| Test | What it verifies |
|---|---|
| includes packetId, profile, and brief | Response structure matches expected shape |
| markdown brief includes source hints and bounding box | Brief contains selector, file hints, dimensions |
| json brief returns compact structured fields | JSON format works correctly |
| profile passes through correctly | Profile detection heuristic works |
| no daemon token in MCP output | Privacy — no token leaked |
| computes bounding box delta | Height delta = 100 when card grows |
| compares screenshot, source hint, and evidence counts | Before/after evidence diff |
| still works after adding capture_context | `generateExport` backward compatible |
| capture tool response shape is unchanged | Existing `capture` tool unaffected |
| invalid selector returns clear error | Graceful handling |

**Total: 215 tests** (up from 205; 10 new)

---

## Validation

| Check | Result |
|---|---|
| `tsc -b` (TypeScript strict) | ✅ 0 errors |
| `vitest run` | ✅ **215 tests**, 0 failed (20 files) |
| New capture-context tests | ✅ 10/10 pass |

---

## Dogfood

The Phase 12/13 source-hint fixture was used with the MCP workflow:

1. **Fixture reverted to broken CSS** — `padding: 10px 8px`, `width: 100%`, `color: #999`
2. **Simulated `capture_context` call** on `.target-card` with debug profile
3. **Brief returned**:
   - PRIMARY source hint: `src/components/TargetCard.jsx` (85%)
   - Style hint: `src/components/TargetCard.css` (80%)
   - Bounding box: `w=640 h=110.89` (tight padding)
   - Network evidence: `POST 500` to `/api/source-hint/submit`
   - Console evidence: 2 errors with redacted API key
4. **Agent used only the brief** to find `TargetCard.css` and apply the fix
5. **Re-capture** confirmed height increased from `110.89` → `147.50`

The agent no longer needs to:
- Manually find `packet.json` on disk
- Run a separate `export` command
- Parse raw full packet JSON

---

## Privacy Verification

| Check | Evidence |
|---|---|
| Daemon token in MCP output | ❌ Not found — verified by test |
| Redacted values preserved | ✅ Brief shows `[API_KEY_REDACTED]`, not raw values |
| Raw packet not returned | ✅ Only `brief` (generated via exporter) is returned |

---

## Backward Compatibility

- Existing `capture` MCP tool: **unchanged** — response shape identical
- Existing `export_context` MCP tool: **unchanged** — still works
- Existing `status`/`stop`/`health` tools: **unchanged**
- Existing CLI commands: **unchanged**

---

## Remaining Limitations

1. **No file-based persistence path returned** — The agent gets the brief inline but doesn't know where the packet was saved on disk. A future enhancement could add `packetPath` to the response.
2. **Session lifecycle** — The tools reuse the `serve` command's session. If the session times out or errors, a new `serve` must be started.
3. **No `projectPath` support in MCP** — Unlike the CLI `--project-path` flag, the MCP tools scan from CWD. Source hints may be empty if the CWD isn't the project root.
4. **Recapture comparison requires manual `previousPacketPath`** — The agent must still know the previous packet path on disk.

## Verdict

**PASS.** An MCP-capable agent can now call `capture_context` and immediately receive the agent-ready context brief without the manual `capture → locate → export` chain.
