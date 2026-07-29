# Phase 18: Agent Workflow Packaging

## Files Added/Changed

| File | Purpose |
|------|---------|
| `AGENT_WORKFLOW.md` | Comprehensive agent workflow documentation: tool usage, profile guidance, comparison field guide, privacy expectations, limitations |
| `QUICKSTART_MCP.md` | 8-step walkthrough from dependency install to verified fix through MCP |
| `examples/agent-workflows/README.md` | Directory overview with workflow phases |
| `examples/agent-workflows/prompts/fix-visual-issue.md` | Agent prompt template: step-by-step instructions for the capture → fix → recapture loop |
| `examples/agent-workflows/viskod.workflow.json` | Machine-readable workflow manifest with required tools, call sequence, input/output schemas, safety notes, validation checklist |
| `examples/mcp-configs/opencode.json` | MCP config template for OpenCode (valid JSON, no comments) |
| `examples/mcp-configs/cursor.mcp.json` | MCP config template for Cursor (valid JSON, no comments) |
| `examples/mcp-configs/claude_desktop_config.example.json` | MCP config template for Claude Desktop (valid JSON, no comments) |
| `scripts/smoke-phase18-agent-workflow.mjs` | Smoke test: validates tools/list, capture_context, recapture_context, comparisonSummary, no token leaks |
| `PHASE18_AGENT_WORKFLOW_PACKAGING_REPORT.md` | This report |

### Modified Files
| File | Change |
|------|--------|
| `package.json` | Added `smoke:agent-workflow` script |
| `README.md` | Added "MCP Agent Workflow" section linking to QUICKSTART, AGENT_WORKFLOW, config examples, and prompt template |
| `examples/phase12-source-hint-app/server.cjs` | Already patched in Phase 17 to strip query strings (`req.url.split('?')[0]`) for cacheBust compatibility |

## Config Examples Created

All three config examples use the same template with `<REPO_PATH>` placeholder:

```json
{
  "mcpServers": {
    "viskod": {
      "command": "pnpm",
      "args": [
        "--dir", "<REPO_PATH>",
        "exec", "tsx",
        "packages/cli/src/index.ts",
        "serve",
        "--url", "http://localhost:3000"
      ],
      "env": {}
    }
  }
}
```

- **opencode.json**: Includes `$schema`, `disabled`, and `autoApprove` fields specific to OpenCode format
- **cursor.mcp.json**: Minimal format for Cursor's `.cursor/mcp.json`
- **claude_desktop_config.example.json**: Minimal format for Claude Desktop

All examples are valid JSON (no comments, which JSON does not support). Windows PowerShell notes are included in QUICKSTART_MCP.md.

## Quickstart Summary

QUICKSTART_MCP.md covers 8 steps:

1. Install dependencies (`pnpm install`)
2. Start fixture server (`node examples/phase12-source-hint-app/server.cjs`)
3. Start Viskod MCP server (`pnpm viskod serve --url http://localhost:3000`)
4. Configure MCP client with config examples from `examples/mcp-configs/`
5. Verify connection with `tools/list`
6. Run first `capture_context`
7. Fix the CSS issue
8. Run `recapture_context` with `reload: true, cacheBust: true`

Includes a troubleshooting table covering common issues.

## Agent Prompt Template Summary

`fix-visual-issue.md` instructs an agent to:

1. **Capture** with `capture_context(selector, url, profile: "debug")` → inspect source hints, save `packetPath`
2. **Inspect** the highest-confidence existing source file
3. **Edit** only relevant files, never expose redacted values
4. **Re-capture** with `recapture_context(previousPacketPath, reload: true, cacheBust: true)`
5. **Verify** using `comparisonSummary`: check `changedFields`, `boundingBoxDelta`, `verdict`
6. **Report** which files were edited, before/after bounding box, verdict, remaining issues

Safety rules: no redacted value exposure, no modifying non-project files, always use reload + cacheBust.

## Smoke Script Command and Result

```
pnpm smoke:agent-workflow
```

### tools/list Result
Tools returned: `capture_context`, `recapture_context`, `capture`, `status`, `stop`, `export_context`

### capture_context Result Summary
- `packetPath`: non-empty ✓
- `captureDir`: non-empty ✓
- `brief`: non-empty, contains bounding box (h=112px, w=640px) ✓
- `sourceHintCount`: 10 ✓
- Source hints include `TargetCard.jsx` and `TargetCard.css` ✓
- No daemon/session token ✓

### recapture_context Result Summary
- `packetPath`: non-empty ✓
- `captureDir`: non-empty ✓
- Bounding box: before h=112 → after h=147.5 (delta +35.5px) ✓
- Width unchanged at 640px ✓
- `comparisonSummary` present with all fields ✓
- `boundingBoxDelta.height`: before=112, after=147.5, delta=35.5 ✓
- `areaDelta.percentChange`: 31.7 ✓
- `changedFields`: includes `boundingBox.height` ✓
- `verdict`: "changed" ✓
- `notes`: non-empty ✓
- No daemon/session token ✓

### Privacy/Token Check
No daemon token, session token, or sensitive data appeared in any output.

## Validation Results

### `pnpm check` (biome + tsc + vitest)

| Check | Result |
|-------|--------|
| `tsc -b` | 0 errors |
| `vitest run` | 239/239 PASS |

### `biome check .` (full repo)

The full-repo `biome check .` reports 54 diagnostics. **None are in Phase 18 files.** All diagnostics are pre-existing and fall into two categories:

| Category | File(s) | Count | Status |
|----------|---------|-------|--------|
| Capture artifacts (auto-generated) | `.viskod/captures/*/metadata.json`, `.viskod/captures/*/packet.json` | ~50 | Pre-existing; JSON outputs from prior smoke tests, not source code |
| Pre-existing opencode plugin | `.opencode/plugins/graphify.js` (missing `node:` protocol) | 2 | Pre-existing; not part of the Viskod package |
| Pre-existing opencode config | `.opencode/opencode.json` (formatting) | 1 | Pre-existing; not part of the Viskod package |
| **Phase 18 files** | (all new documentation, configs, and scripts) | **0** | **Clean** |

All new Phase 18 files pass biome checks with zero errors. The 54 pre-existing diagnostics are unrelated to Phase 18 and would require changes outside the scope (opencode plugin/config, transient capture artifacts).

### JSON Validation (explicit)

All 4 JSON files were parsed with `JSON.parse()` to confirm validity:

| File | Result |
|------|--------|
| `examples/mcp-configs/opencode.json` | PASS — valid JSON |
| `examples/mcp-configs/cursor.mcp.json` | PASS — valid JSON |
| `examples/mcp-configs/claude_desktop_config.example.json` | PASS — valid JSON |
| `examples/agent-workflows/viskod.workflow.json` | PASS — valid JSON |
| **All** | **4/4 PASS** |

### `pnpm smoke:agent-workflow`

| Check | Result |
|-------|--------|
| `initialize` response received | PASS |
| `tools/list` returns tool array | PASS |
| `capture_context` listed | PASS |
| `recapture_context` listed | PASS |
| `capture_context` response received | PASS |
| `capture_context` packetPath non-empty | PASS |
| `capture_context` captureDir non-empty | PASS |
| `capture_context` brief non-empty | PASS |
| `capture_context` sourceHintCount >= 0 | PASS |
| Before bounding box extractable from brief | PASS |
| Before card height = 112px | PASS |
| Before card width = 640px | PASS |
| No daemon/session token in capture output | PASS |
| Source hints include TargetCard.jsx | PASS |
| Source hints include TargetCard.css | PASS |
| `recapture_context` response received | PASS |
| `recapture_context` has content | PASS |
| `recapture_context` packetPath non-empty | PASS |
| `recapture_context` captureDir non-empty | PASS |
| After bounding box extractable from brief | PASS |
| Height delta = +35.5px (112 → 147.5) | PASS |
| Height delta > 0 | PASS |
| Width unchanged at 640px | PASS |
| `comparisonSummary` present | PASS |
| `boundingBoxDelta` present | PASS |
| `boundingBoxDelta.height` has before/after/delta | PASS |
| `areaDelta` present | PASS |
| `areaDelta.percentChange` = 31.7 (number) | PASS |
| `evidenceDelta` present | PASS |
| `changedFields` is array | PASS |
| `changedFields` includes `boundingBox.height` | PASS |
| `verdict` is valid ("changed") | PASS |
| `notes` non-empty string | PASS |
| No daemon/session token in comparisonSummary | PASS |
| Source hints TargetCard.jsx after recapture | PASS |
| Source hints TargetCard.css after recapture | PASS |
| No .tmp files in capture dir | PASS |
| **Overall** | **38/38 PASS** |

## Remaining Limitations

1. **The smoke script depends on `npx` finding `tsx`** — On Windows, `npx.cmd` must be on PATH. The script uses `npx.cmd` explicitly for Windows.
2. **MCP config examples use `pnpm exec tsx`** — This requires pnpm to be installed globally. Alternative: `npx tsx` with the repo path as cwd.
3. **No native MCP transport support** — The server uses stdin/stdout only. SSE or WebSocket transport is not implemented.
4. **Fixture-specific path** — The smoke script uses `examples/phase12-source-hint-app` as the fixture. Users should point `--url` at their own app.
5. **The prompt template assumes agent competency** — The agent must already understand MCP tool calling. The template provides structure but not hand-holding.

## Verdict: **PASS**

The Phase 18 objectives are met:

- [x] A new user can follow `QUICKSTART_MCP.md` to configure Viskod as an MCP server
- [x] MCP config examples exist for OpenCode, Cursor, and Claude Desktop — all valid JSON
- [x] Agent prompt template uses `capture_context` → fix → `recapture_context` correctly
- [x] Smoke script validates `tools/list`, `capture_context`, and `recapture_context` — 38/38 checks pass
- [x] No private paths, tokens, or secrets embedded anywhere
- [x] Existing Phase 17 functionality remains unchanged (all 239 unit tests pass)
- [x] External user path is clear: install/configure → start viskod serve → capture → fix → recapture → verify comparisonSummary
