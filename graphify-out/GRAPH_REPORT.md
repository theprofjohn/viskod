# Graph Report - Viskod  (2026-07-30)

## Corpus Check
- 224 files · ~220,406 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 23 nodes · 22 edges · 4 communities
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ea628f8d`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Phase 14 Agent Context Export Report
- What Was Built
- Brief-Only Dogfood Test
- Agent Brief Contents

## God Nodes (most connected - your core abstractions)
1. `Phase 14 Agent Context Export Report` - 12 edges
2. `What Was Built` - 6 edges
3. `Brief-Only Dogfood Test` - 4 edges
4. `Agent Brief Contents` - 3 edges
5. `Agent Context Exporter` - 1 edges
6. `API` - 1 edges
7. `Exports from `@viskod/context-engine`` - 1 edges
8. `CLI Command` - 1 edges
9. `MCP Tool` - 1 edges
10. `Markdown Brief` - 1 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Communities (4 total, 0 thin omitted)

### Community 0 - "Phase 14 Agent Context Export Report"
Cohesion: 0.20
Nodes (9): Architecture Boundaries, Dogfood, Files Changed, Phase 14 Agent Context Export Report, Privacy/Safety Design, Remaining Limitations, Tests Added, Validation (+1 more)

### Community 1 - "What Was Built"
Cohesion: 0.33
Nodes (6): Agent Context Exporter, API, CLI Command, Exports from `@viskod/context-engine`, MCP Tool, What Was Built

### Community 2 - "Brief-Only Dogfood Test"
Cohesion: 0.50
Nodes (4): Blind Agent Process, Brief-Only Dogfood Test, Did the Brief Suffice?, Setup

### Community 3 - "Agent Brief Contents"
Cohesion: 0.67
Nodes (3): Agent Brief Contents, Compact JSON, Markdown Brief

## Knowledge Gaps
- **18 isolated node(s):** `Agent Context Exporter`, `API`, `Exports from `@viskod/context-engine``, `CLI Command`, `MCP Tool` (+13 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Phase 14 Agent Context Export Report` connect `Phase 14 Agent Context Export Report` to `What Was Built`, `Brief-Only Dogfood Test`, `Agent Brief Contents`?**
  _High betweenness centrality (0.896) - this node is a cross-community bridge._
- **Why does `What Was Built` connect `What Was Built` to `Phase 14 Agent Context Export Report`?**
  _High betweenness centrality (0.411) - this node is a cross-community bridge._
- **Why does `Brief-Only Dogfood Test` connect `Brief-Only Dogfood Test` to `Phase 14 Agent Context Export Report`?**
  _High betweenness centrality (0.260) - this node is a cross-community bridge._
- **What connects `Agent Context Exporter`, `API`, `Exports from `@viskod/context-engine`` to the rest of the system?**
  _18 weakly-connected nodes found - possible documentation gaps or missing edges._