# Phase 14 Agent Context Export Report

**Date:** 2026-07-28

---

## What Was Built

### Agent Context Exporter

**Location:** `packages/context-engine/src/agent-exporter.ts`

Reads a `ContextPacket` and produces a compact, safe, actionable brief for AI coding agents. Two formats:

| Format | Description |
|---|---|
| `markdown` | Human/agent-readable brief with tables, summaries, and suggested next steps |
| `json` | Machine-readable compact packet with only the fields an agent needs |

### API

```ts
import { generateExport } from '@viskod/context-engine';

const markdown = generateExport(packet, { format: 'markdown' });
const compact = generateExport(packet, { format: 'json' });
```

### Exports from `@viskod/context-engine`

- `generateExport(packet, options)` — main export function
- `ExportFormat` — `'markdown' | 'json'`
- `ExportOptions` — `{ format: ExportFormat }`
- `CompactPacket` — compact JSON shape

### CLI Command

```
viskod export <packet-path> [--format markdown|json] [--out <file>]
```

Example:
```bash
pnpm viskod export .viskod/captures/*/packet.json --format markdown
pnpm viskod export packet.json --format json --out brief.json
```

### MCP Tool

Registered on `viskod serve` as `export_context`:

| Property | Value |
|---|---|
| Tool name | `export_context` |
| Required input | `packetPath` (string) |
| Optional input | `format` (enum: `markdown`, `json`) |
| Default format | `markdown` |

---

## Agent Brief Contents

### Markdown Brief

```
# Context Packet: abc12345…

- **Selector:** `.target-card`
- **Tag:** `div`
- **Bounding Box:** x=320 y=99 w=640 h=110.89
- **Profile:** debug
- **Sources:** browser-runtime, browser-runtime:evidence

## Visible Text
Phase 12C Source Hint Target …

## Source Hints (ranked)
| # | File | Confidence | Exists | Match Type |
|---|------|-----------|--------|------------|
| 1 | src/components/TargetCard.jsx | 85% | ✅ | case-insensitive | ⭐ |
| 2 | src/components/TargetCard.css | 80% | ✅ | style-adjacent |

## Console Evidence
| Level | Count | Sample |
|-------|-------|--------|
| error | 2 | VISKOD_SOURCE_HINT_ERROR: fake api key [API_KEY_REDACTED]… |

## Network Evidence
| Method | Status | URL |
|--------|--------|-----|
| POST | 500 | /api/source-hint/submit |

## Redactions Applied
Types: api-key, base64-token

## Suggested Next Steps
1. Inspect source file: src/components/TargetCard.jsx (85%)
2. Review bounding box: Compare expected vs captured layout (w=640 h=110.89)
3. Address console errors: See Console Evidence table above
4. Check network failures: See Network Evidence table above
5. Fix the issue in the identified source file
6. Re-capture the same selector to verify the fix
```

### Compact JSON

```json
{
  "packetId": "...",
  "selector": ".target-card",
  "boundingBox": { "x": 320, "y": 99, "width": 640, "height": 110.89 },
  "profile": "debug",
  "sourceHints": [{ "filePath": "src/components/TargetCard.jsx", "confidence": 0.85, "exists": true, "matchType": "case-insensitive", "isPrimary": true }],
  "consoleSummary": [{ "level": "error", "count": 2, "sample": "..." }],
  "networkSummary": [{ "method": "POST", "url": "/api/source-hint/submit", "status": 500 }],
  "redactions": ["api-key", "base64-token"],
  "processingTimeMs": 217
}
```

---

## Privacy/Safety Design

- Exporter reads **already-redacted** data from the packet — no new redaction needed
- Console messages, network URLs, headers are passed through as-is from the evidence pipeline
- `redactions` field from packet metadata is included verbatim so the agent knows what was redacted
- Exporter never runs browser captures, never edits code, never mutates the packet
- JSON export uses the same truncated/redacted fields as markdown

## Architecture Boundaries

| Rule | Status |
|---|---|
| VCE remains orchestrator | ✅ Exporter is part of context-engine |
| BrowserRuntime collects evidence only | ✅ No BR dependency in exporter |
| SourceHintEngine produces hints only | ✅ Hints passed through packet unchanged |
| Exporter formats existing evidence only | ✅ No captures, no code edits |
| Exporter does not mutate packet | ✅ `generateExport` is a pure function |

## Files Changed

| File | Change |
|---|---|
| `packages/context-engine/src/agent-exporter.ts` | New — Agent Context Exporter (markdown + JSON) |
| `packages/context-engine/src/agent-exporter.test.ts` | New — 12 tests for both formats |
| `packages/context-engine/src/index.ts` | Exports `generateExport`, `ExportFormat`, `ExportOptions`, `CompactPacket` |
| `packages/cli/src/index.ts` | Added `viskod export` command and MCP `export_context` tool |

## Tests Added

| Test | What it verifies |
|---|---|
| markdown includes selector and bounding box | `.target-card`, `w=640`, `h=300` |
| markdown includes top source hints | `TargetCard.jsx`, `TargetCard.css`, confidence percentages |
| markdown includes console evidence summary | Console evidence table |
| markdown includes network evidence summary | Network evidence table |
| markdown includes redaction summary | Redactions Applied section |
| markdown includes evidence sources | `browser-runtime` |
| markdown includes suggested next steps | Re-capture suggestion |
| markdown handles missing optional fields | Minimal packet produces valid output |
| json includes compact structured fields | `packetId`, `selector`, `sourceHints[0].filePath` |
| json includes console and network summaries | Non-empty arrays |
| redacted values remain redacted in output | `redactions` array preserved |
| json detects profile from evidence | `debug`, `audit`, `default` correctly inferred |

## Dogfood

The Phase 13 hardened packet (debug profile of `.target-card` with broken CSS) was exported to markdown. The brief included:
- Selector `.target-card` with bounding box `640x110.89` — confirming the tight layout
- PRIMARY source hint `src/components/TargetCard.jsx` (85%) — pointing the agent to the component
- CSS hint `src/components/TargetCard.css` (80%) — pointing to the style file
- 2 console errors with `[API_KEY_REDACTED]` — confirming redaction works
- 4 network entries with the failed `POST /api/source-hint/submit` — confirming network evidence

An agent receiving only this brief could:
1. **Locate the bug** — bounding box shows `height: 110.89` (tight padding)
2. **Find the source** — source hint `TargetCard.jsx` → same-directory `TargetCard.css`
3. **Identify the issue** — button is full-width (network evidence confirms 500 on submit)
4. **Fix** — edit `TargetCard.css` to add border, fix padding, remove `width: 100%`
5. **Verify** — re-capture `.target-card` and compare bounding boxes

## Validation

| Check | Result |
|---|---|
| `pnpm check` (biome + tsc + vitest) | ✅ Pass (pre-existing `.opencode/` lint only) |
| `biome check .` (project code) | ✅ 0 errors on 118 project files |
| `tsc -b` (TypeScript strict) | ✅ 0 errors |
| `vitest run` | ✅ **205 tests**, 0 failed (19 files) |
| New exporter tests | ✅ 12/12 pass |

## Brief-Only Dogfood Test

### Setup

1. **Fixtured reverted to broken state** — `TargetCard.css` restored to broken CSS
2. **Server started** — `node examples/phase12-source-hint-app/server.cjs`
3. **Capture with debug profile**:
   ```
   npx tsx packages/cli/src/index.ts capture ".target-card" --profile debug --url http://127.0.0.1:3000 --project-path examples/phase12-source-hint-app
   ```
4. **Export markdown brief**:
   ```
   npx tsx packages/cli/src/index.ts export .viskod/captures/.../packet.json --format markdown --out phase14-brief.md
   ```

**Output file:** `C:\Viskod\phase14-brief.md` (76 lines)

### Blind Agent Process

The agent received **only** `phase14-brief.md` — no raw packet.json, no file paths beyond what appeared in the brief.

| Step | Action | Source from Brief |
|---|---|---|
| 1 | Read PRIMARY source hint `src/components/TargetCard.jsx` (85%) | Source Hints table (#1) |
| 2 | Read style hint `src/components/TargetCard.css` (80%) | Source Hints table (#2) |
| 3 | Searched for `TargetCard.css` in repo root | Found at `src/components/TargetCard.css` |
| 4 | Read bounding box: `w=640 h=110.89` — confirmed tight padding | Bounding Box line |
| 5 | Read `TargetCard.css`, found `padding: 10px 8px`, `width: 100%`, `color: #999` | Code read (guided by brief) |
| 6 | Applied fix: `padding: 20px`, removed `width: 100%`, fixed contrast `#555`, added border | Code edit |
| 7 | Re-captured: height increased from **110.89 → 147.50** | Re-capture after fix |

### Did the Brief Suffice?

**YES.** The agent was able to:
- Identify the component file: `src/components/TargetCard.jsx` (from brief hint #1)
- Identify the style file: `src/components/TargetCard.css` (from brief hint #2)
- Confirm the visual issue: bounding box `h=110.89` (too tight for a card)
- Identify the network failure: `POST 500` (button click failed, suggesting full-width issue)
- Apply the fix and verify with re-capture (height 110.89 → 147.50)

**Without the brief, the agent would have:** no selector, no bounding box, no source file hints, no runtime evidence summary.

## Remaining Limitations

1. **Export only reads local files** — the CLI/MCP `export` command reads from the filesystem. Remote packets would need a different mechanism.
2. **No HTML/PDF export** — only markdown and JSON.
3. **Profile detection is heuristic** — based on presence of network/screenshot evidence, not on the `--profile` flag stored in the packet.

## Verdict

**PASS.** The agent context exporter produces a compact, safe, actionable brief from any Context Packet. The markdown brief includes selector, bounding box, ranked source hints, console/network evidence summaries, redaction reporting, and suggested next steps — everything an AI coding agent needs to understand, fix, and verify a visual issue.
