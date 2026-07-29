# Graph Report - Viskod  (2026-07-30)

## Corpus Check
- 226 files · ~223,425 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 61 nodes · 81 edges · 6 communities (5 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d247b387`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- VisualContextEngine
- cli/src/index.ts
- Phase 15 MCP Agent Consumption Report
- context-engine/src/index.ts
- Dogfood
- What Was Built

## God Nodes (most connected - your core abstractions)
1. `VisualContextEngine` - 15 edges
2. `Phase 15 MCP Agent Consumption Report` - 11 edges
3. `main()` - 10 edges
4. `Dogfood` - 7 edges
5. `What Was Built` - 4 edges
6. `createRuntime()` - 4 edges
7. `Schemas` - 3 edges
8. `cmdScan()` - 3 edges
9. `cmdCapture()` - 3 edges
10. `cmdHealth()` - 3 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (6 total, 1 thin omitted)

### Community 1 - "cli/src/index.ts"
Cohesion: 0.31
Nodes (12): args, cmdCapture(), cmdExport(), cmdHealth(), cmdScan(), cmdServe(), cmdStart(), cmdStatus() (+4 more)

### Community 2 - "Phase 15 MCP Agent Consumption Report"
Cohesion: 0.18
Nodes (10): Backward Compatibility, capture_context → recapture_context Chain, Output Fields Added, Phase 15 MCP Agent Consumption Report, Privacy Verification, Tests Added, Tests Added, Validation (+2 more)

### Community 3 - "context-engine/src/index.ts"
Cohesion: 0.22
Nodes (7): ContextPacket, HierarchyNode, LayoutInfo, ScreenshotInfo, SourceHintEntry, VCECreationOptions, VCEHealth

### Community 4 - "Dogfood"
Cohesion: 0.29
Nodes (7): Chaining Verification, Dogfood, Dogfood Note, Setup, Step 1: capture_context (.target-card, debug, projectPath), Step 2: Fix applied using only the brief, Step 3: recapture_context (.target-card, default, previousPacketPath)

### Community 5 - "What Was Built"
Cohesion: 0.33
Nodes (6): Architecture Boundaries, capture_context, MCP Tools Added, recapture_context, Schemas, What Was Built

## Knowledge Gaps
- **25 isolated node(s):** `MCP Tools Added`, `capture_context`, `recapture_context`, `Architecture Boundaries`, `Tests Added` (+20 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `VisualContextEngine` connect `VisualContextEngine` to `cli/src/index.ts`, `context-engine/src/index.ts`?**
  _High betweenness centrality (0.206) - this node is a cross-community bridge._
- **Why does `Phase 15 MCP Agent Consumption Report` connect `Phase 15 MCP Agent Consumption Report` to `Dogfood`, `What Was Built`?**
  _High betweenness centrality (0.122) - this node is a cross-community bridge._
- **Why does `Dogfood` connect `Dogfood` to `Phase 15 MCP Agent Consumption Report`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **What connects `MCP Tools Added`, `capture_context`, `recapture_context` to the rest of the system?**
  _25 weakly-connected nodes found - possible documentation gaps or missing edges._