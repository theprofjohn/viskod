# Phase 19: Release Readiness and Repo Hygiene

## Files Changed

| File | Change | Category |
|------|--------|----------|
| `.gitignore` | Added `.opencode/`, `opencode.json`, `.viskod/`, `dist/`, `coverage/`, graphify-out generated files, `.viskod` sub-rules | Ignore rules |
| `package.json` | Added `version: "0.2.0-alpha"`, added `check:types`, `check:test`, `check:biome`, `release:check` scripts | Version + scripts |
| `opencode.json` | Removed from git index (`git rm --cached`) — local developer config with hardcoded user path | Artifact cleanup |
| `.opencode/` (directory) | Removed from git index — local OpenCode tooling, not part of Viskod source | Artifact cleanup |
| All 20 workspace packages | Versions updated to `0.2.0-alpha` for consistency | Version sanity |
| `examples/phase12-source-hint-app/src/components/TargetCard.css` | Biome-formatted (multi-line) | Biome hygiene |
| `scripts/smoke-phase18-agent-workflow.mjs` | Fixed CSS replacement regex for multi-line format | Smoke fix |
| `RELEASE_CHECKLIST.md` | New — release validation checklist with tag/rollback notes | New document |
| `RELEASE_NOTES_v0.2.0-alpha.md` | New — alpha release notes | New document |
| `PHASE19_RELEASE_READINESS_REPORT.md` | New — this report | New document |

## Git Hygiene Findings

### Tracked Artifact Audit

| Artifact | Tracked? | Action |
|----------|----------|--------|
| `.viskod/captures/*` | No | Already gitignored (now explicitly added) |
| `.viskod/session.json` | No | Now gitignored |
| `packet.json`, `metadata.json`, `selection.png` | No | Confirmed not tracked |
| `.opencode/` (directory) | **YES** | Removed from index (`git rm --cached`) |
| `opencode.json` (root) | **YES** | Removed from index (`git rm --cached`) — contained `C:\Users\Acer\...` path |
| `dist/`, `coverage/` | No | Now gitignored |
| `graphify-out/*.json`, `graphify-out/*.md`, `graphify-out/*.html` | **YES** | Added to `.gitignore` — auto-generated graph database |
| `.graphify_labels.json`, `.graphify_labels.json.sig`, `.graphify_root` | **YES** | Added to `.gitignore` |

### `.opencode` Decision

**Verdict**: Personal/local tooling. Removed from git index. Added to `.gitignore`.

The `.opencode/` directory contained:
- `.opencode/opencode.json` — Local OpenCode configuration with MCP server entries
- `.opencode/plugins/graphify.js` — Graphify plugin for OpenCode

These are developer machine-specific files, not Viskod source. The root `opencode.json` also contained a hardcoded `C:\Users\Acer\.local\bin\graphify-mcp.exe` path.

## Ignore / Config Changes

`.gitignore` now includes:
- `.opencode/` — local OpenCode tooling
- `opencode.json` — root-level local OpenCode config
- `.viskod/` — runtime capture artifacts
- `.viskod/captures/`, `.viskod/session.json`, `.viskod/*.tmp`, `.viskod/logs/` — specific sub-patterns
- `**/dist`, `**/coverage` — build/test output
- `graphify-out/graph.json`, `graphify-out/manifest.json`, `graphify-out/graph.html`, `graphify-out/GRAPH_REPORT.md`, `graphify-out/.graphify_labels.json`, `graphify-out/.graphify_labels.json.sig`, `graphify-out/.graphify_root` — auto-generated graph database files
- `graphify-out/2026-*/` — dated graph export directories

Biome already used `vcs.useIgnoreFile: true`, so `.gitignore` changes automatically exclude these from Biome checks.

## Release Scripts Added

| Script | Command | Description |
|--------|---------|-------------|
| `check:types` | `tsc -b` | TypeScript compilation check |
| `check:test` | `vitest run` | Unit tests |
| `check:biome` | `biome check .` | Lint + format check |
| `release:check` | `biome check . && tsc -b && vitest run && node scripts/smoke-phase18-agent-workflow.mjs` | Full release gate |

Existing scripts retained: `check` (biome + tsc + vitest), `smoke:agent-workflow`.

## Release Checklist Summary

`RELEASE_CHECKLIST.md` includes:
- Prerequisites (Node.js, pnpm, Playwright, clean tree)
- Required validation commands
- MCP smoke check items (tools/list, capture_context, recapture_context)
- Privacy/token check items
- Artifact cleanup checks
- Tag command: `git tag -a v0.2.0-alpha -m "..." && git push origin v0.2.0-alpha`
- Rollback notes (remove tag, fix, re-check, re-tag)
- Known alpha limitations (7 items)

## Release Notes Summary

`RELEASE_NOTES_v0.2.0-alpha.md` includes:
- What Viskod is (Visual Context Engine for AI coding agents)
- What works (MCP server with capture_context/recapture_context, reload/cacheBust, profiles, redaction, source hints)
- MCP tools available (6 tools)
- Validated workflow (capture → fix → recapture → compare)
- Known limitations (7 items)
- Setup notes
- Validation summary table
- Security/privacy notes
- Upgrade/migration instructions

## Secret / Local Path Scan Results

| Pattern | Found? | Location | Verdict |
|---------|--------|----------|---------|
| `daemon-token` | Yes | Phase reports, test assertions, workflow manifest | Documentation — not actual tokens |
| `sessionToken` | Yes | Phase reports, test assertions, workflow manifest | Documentation — not actual tokens |
| `sk_test_` | Yes | AGENT_WORKFLOW.md, Phase 12 reports | Documentation of redaction rules |
| `secret-token` | Yes | Phase 12/13 reports | Documentation of redaction rules |
| `test@example.com` | Yes | Phase 12/13 reports | Documentation of redaction rules |
| `C:\Users\...` | No in tracked files | N/A | Clean (removed `opencode.json` from index) |
| `C:\Viskod` | Yes | `DOGFOOD_REPORT.md`, `PHASE14_*_REPORT.md` | Internal phase reports documenting test setup — not user-facing |
| `.viskod/captures` | No in tracked files | N/A | Clean — all captures are local-only |

**Fixed**: `opencode.json` (root) contained `C:\Users\Acer\.local\bin\graphify-mcp.exe` — removed from git index.

## Validation Results

| Check | Result |
|-------|--------|
| `biome check .` | 119 files, **0 errors** |
| `tsc -b` | **0 errors** |
| `vitest run` | **239/239 PASS** |
| `pnpm smoke:agent-workflow` | **38/38 PASS** |
| `pnpm release:check` (full gate) | **PASS** (biome + tsc + vitest + smoke) |

## Version Consistency

All 21 packages (root + 20 workspace packages) set to `0.2.0-alpha`:
- Root: `viskod@0.2.0-alpha` (private: true — no accidental publish)
- 19 workspace packages: `@viskod/*@0.2.0-alpha`
- 1 app package: `@viskod/app-studio@0.2.0-alpha`
- No `publishConfig` found in any package

## Remaining Alpha Limitations

1. MCP server uses stdin/stdout only. SSE/WebSocket transport not implemented.
2. Element selection requires valid CSS selector. Shadow DOM / dynamic class names may complicate this.
3. Source hints are best-effort. Exact file matches depend on project structure.
4. Screenshots capture current viewport state. Animations/transitions may not be fully rendered.
5. Network evidence from page context only — not from workers or extensions.
6. Playwright Chromium browser must be installed separately (`pnpm exec playwright install chromium`).
7. The fixture CSS file (TargetCard.css) was Biome-formatted. The smoke script handles both single-line and multi-line formats.

## Recommended Tag

```
v0.2.0-alpha
```

## Verdict: **PASS**

All PASS criteria met:

- [x] No generated `.viskod` capture artifacts tracked — `.viskod/` is gitignored
- [x] No session/token artifacts tracked — confirmed by audit
- [x] Full `biome check .` is clean — 119 files, 0 errors
- [x] `release:check` passes — biome + tsc + vitest + smoke = all green
- [x] `smoke:agent-workflow` passes — 38/38
- [x] Release checklist exists (`RELEASE_CHECKLIST.md`)
- [x] Release notes exist (`RELEASE_NOTES_v0.2.0-alpha.md`)
- [x] No private paths/secrets in committed release files — hardcoded user path in `opencode.json` removed from index
- [x] Repo is ready for an internal `v0.2.0-alpha` tag

The repository is ready for a `v0.2.0-alpha` tag.
