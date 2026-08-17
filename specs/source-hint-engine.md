# Source Hint Engine

> **Specification ID:** SPEC-015
> **Version:** 1.0
> **Status:** Draft
> **Owner:** Platform Architecture
> **Last Updated:** 2026-07-28

---

## Architecture Sources

* `docs/source-hint-engine.md` — full subsystem specification: candidate discovery, evidence evaluation, confidence calculation, ranking pipeline, framework awareness, route correlation, component correlation, caching, explainability, failure policy
* `docs/architecture.md` §Source Hint Engine — estimates likely implementation files from DOM evidence, route information, and project metadata; produces evidence-backed probabilities with confidence scores and reasoning; probabilistic, never claims certainty
* `docs/architecture.md` §Confidence Model — confidence combines direct evidence, convention matches, structural similarity, route correlation, and naming consistency; confidence never exceeds available evidence
* `docs/ARCHITECTURE_BASELINE.md` §Runtime Boundaries — Source Hint Engine consumes project metadata and DOM evidence; never generates code, never modifies files; outputs ranked source hints with confidence
* `docs/ARCHITECTURE_BASELINE.md` §Prohibited Dependencies — Source Hint Engine must not depend on Browser Runtime; must not read source code or modify files
* `docs/glossary.md` §Source Hint Engine — the subsystem that estimates where a selected UI element is implemented within a project, narrowing the search space for AI coding agents

---

## Dependencies

| Specification | Status | Relationship |
|--------------|--------|-------------|
| SPEC-002 (shared-types) | Draft | Imports base types (`Identifier`, `Timestamp`, `Result`, `Maybe`), Zod schemas, error base types |
| SPEC-003 (error-model) | Draft | Imports `ViskodError`, `ErrorCategory`, `ErrorSeverity`; produces errors conforming to the error model |
| SPEC-012 (project-scanner) | Draft | Consumes `ProjectMetadata`, `RouteMap`, `ComponentIndex`, `FrameworkDetection` for candidate discovery |

---

## Consumers

| Specification | Status | Relationship |
|--------------|--------|-------------|
| SPEC-009 (visual-context-engine) | Draft | VCE consumes ranked `SourceHint[]` as part of Context Packet generation (sourceHints field) |
| SPEC-013 (framework-adapters) | Draft | Framework Adapters extend Source Hint Engine with framework-specific hint generation strategies |

---

## Purpose

Defines the Source Hint Engine subsystem: the component that estimates where a selected UI element is likely implemented within a project. It consumes DOM evidence (tag names, attributes, class names, route context) and project metadata (framework, routes, component index) to generate ranked, evidence-backed source file hints. Every hint includes a confidence score and explanation of the evidence that produced it. The engine answers "Where is this UI most likely implemented?" — not "Where is this UI implemented?" Certainty requires direct evidence; the engine communicates uncertainty explicitly.

---

## Scope

* Candidate discovery (identifying possible implementation files from DOM evidence)
* Evidence evaluation (scoring each piece of evidence for relevance and strength)
* Confidence calculation (combining evidence into a 0.0–1.0 confidence score)
* Ranking pipeline (ordering candidates by confidence, removing duplicates, preferring precision)
* Route correlation (mapping browser URL → route → file path)
* Component correlation (matching class names, component names, file names)
* Framework-aware hint generation (leveraging framework-specific conventions through adapters)
* Source hint model (file path, confidence, evidence, discovery method, framework)
* Caching of hint results (route + element signature → hints)
* Explainability (every hint must explain WHY it was selected)
* Error handling and graceful degradation (empty results are valid; no hint is better than a wrong hint)

---

## Non-Goals

* Reading or parsing source code files
* Static analysis, type-checking, or AST traversal
* File system scanning beyond what Project Scanner provides
* Browser automation, DOM inspection, or visual analysis
* Framework detection (Project Scanner owns this)
* Route discovery (Project Scanner owns this)
* Context Packet construction (VCE owns this)
* MCP protocol handling or tool registration
* Import graph or dependency analysis (future concern)
* Source map consumption (future concern)
* Guaranteeing correctness of hints — hints are probabilistic by design

---

## Terminology

| Term | Definition (this spec) |
|------|----------------------|
| **SourceHint** | A probabilistic estimate of where a UI element is implemented, containing file path, confidence score, evidence, discovery method, and framework context |
| **Candidate** | A potential implementation file discovered during candidate discovery; not yet scored or ranked |
| **Evidence** | An observable fact that supports a candidate: route match, class name match, file name match, framework convention match |
| **Confidence** | A score from 0.0 to 1.0 representing how likely a candidate is the actual implementation; never exceeds available evidence |
| **DiscoveryMethod** | The technique used to discover a candidate: 'route-correlation', 'component-naming', 'class-name-match', 'framework-convention', 'heuristic-match' |
| **HintInput** | The complete set of inputs consumed for hint generation: DOM snapshot, current URL, route, framework, project metadata |
| **EmptyResult** | A valid result indicating no hints could be generated with sufficient confidence; represented as an empty array |

All other terms reference `docs/glossary.md` for canonical definitions.

---

## Runtime Boundary

| Boundary | Value |
|----------|-------|
| Process | Main desktop process (same as VCE and Studio) |
| Imports allowed | `@viskod/shared` (types, schemas, utilities, errors), `@viskod/project-scanner` (types only — ProjectMetadata, RouteMap, ComponentIndex, FrameworkDetection) |
| Imports forbidden | `@viskod/browser-runtime`, `@viskod/visual-context-engine`, `@viskod/mcp-server`, `@viskod/selection-engine`, `@viskod/studio`, `@viskod/capture-pipeline`, `playwright`, `node:fs`, `node:path` |
| Network | No direct network access |
| File system | No file system access; all data comes from Project Scanner and DOM evidence |
| Secrets | Never accesses `.env` files, environment variables, or user credentials |

---

## Responsibilities

The Source Hint Engine owns:

* Generating source hints from DOM evidence and project metadata
* Evaluating evidence for each candidate (route match, class name match, file name match, convention match)
* Calculating confidence scores (weighted combination of evidence)
* Ranking candidates (by confidence, removing duplicates, preferring precision)
* Explaining every hint (evidence, discovery method, confidence breakdown)
* Caching hint results for repeated queries on the same route + element
* Providing empty results when evidence is insufficient
* Publishing hint generation events to the Event Bus

The Source Hint Engine must never:

* Read source code files (or any files on disk)
* Write to, modify, or create files
* Import browser automation libraries (Playwright, Puppeteer)
* Import Project Scanner implementation modules (only types)
* Generate Context Packets or visual analysis
* Communicate with Browser Runtime, Studio, or MCP Server directly
* Make claims of certainty — all output is probabilistic

---

## Interfaces

### Public API

| Signature | Purpose | Preconditions | Postconditions | Errors |
|-----------|---------|---------------|----------------|--------|
| `generateHints(input: HintInput): Promise<Result<SourceHint[]>>` | Generate ranked source hints for a selected element | Project metadata loaded; DOM evidence available (tag name, attributes, class names); current URL/route known | Returns ranked SourceHint[] with confidence and evidence; empty array if no hints found | `SH_NO_PROJECT_METADATA`, `SH_INSUFFICIENT_EVIDENCE` |
| `getHint(hintId: string): Promise<Result<SourceHint>>` | Retrieve a specific hint by ID | Hint ID exists in cache or was previously generated | Returns the SourceHint | `SH_HINT_NOT_FOUND` |
| `explainHint(hint: SourceHint): Promise<Result<string>>` | Generate a human-readable explanation of a hint | SourceHint has evidence populated | Returns markdown-formatted explanation with evidence breakdown | None (always produces explanation) |
| `rankCandidates(candidates: Candidate[], evidence: Evidence[]): Promise<Result<SourceHint[]>>` | Rank and score pre-discovered candidates | Candidates are valid file paths; evidence is structured | Returns ranked SourceHint[] with scores | `SH_NO_CANDIDATES` |
| `health(): HintEngineHealth` | Return current engine health | Any state | Returns health status synchronously | None (synchronous) |
| `clearCache(): Promise<Result<void>>` | Clear all cached hint results | Any state | Cache cleared; next query will regenerate | None |

### HintInput
```typescript
interface HintInput {
  domContext: DOMContext;         // DOM evidence from the selected element
  route: RouteContext;            // current URL and matched route
  project: ProjectContext;        // project metadata from Project Scanner
  framework?: FrameworkContext;   // framework-specific context
  captureId?: string;             // associated capture, for caching
}

interface DOMContext {
  tagName: string;                // e.g., 'button', 'div'
  id?: string;                    // element ID attribute
  className?: string;             // element class attribute (raw string)
  classList?: string[];           // parsed class names
  dataAttributes?: Record<string, string>; // data-* attributes
  role?: string;                  // ARIA role
  testId?: string;                // data-testid or similar
  parentTagName?: string;         // parent element tag for context
  text?: string;                  // text content, truncated
}

interface RouteContext {
  url: string;                    // current browser URL (hostname + path only)
  pathname: string;               // URL path segment, e.g., '/dashboard/settings'
  matchedRoute?: Route;           // matched route from RouteMap (if found)
}

interface ProjectContext {
  metadata: ProjectMetadata;      // from Project Scanner
  routeMap: RouteMap;             // discovered routes
  componentIndex: ComponentIndex; // component directories and patterns
  framework: FrameworkDetection;  // detected framework
}

interface FrameworkContext {
  framework: Framework;
  conventions: Record<string, string>; // framework-specific conventions, e.g., { pageComponent: 'app/{route}/page.tsx' }
}
```

### Events Published

| Event | Payload Schema | When Published |
|-------|---------------|----------------|
| `HintsGenerated` | `{ captureId: Identifier; hintCount: number; topConfidence: number; timestamp: Timestamp }` | After successful `generateHints()` |
| `HintsFailed` | `{ captureId: Identifier; error: ViskodError; timestamp: Timestamp }` | When hint generation fails |
| `HintCacheCleared` | `{ timestamp: Timestamp }` | After `clearCache()` |

### Events Subscribed

| Event | When Handled |
|-------|-------------|
| `ProjectScanned` | Invalidates cached hints (project structure may have changed) |
| `ProjectLoaded` | Updates internal reference to loaded project metadata |

---

## Data Models

### SourceHint
```typescript
interface SourceHint {
  hintId: string;                // deterministic hash of file path + element signature
  filePath: string;              // relative path from project root
  confidence: number;            // 0.0 to 1.0
  evidence: HintEvidence[];      // evidence supporting this hint
  discoveryMethod: DiscoveryMethod;
  framework?: Framework;
  isPrimary: boolean;            // true if this is the top-ranked hint
  timestamp: string;             // ISO 8601
  schemaVersion: string;         // '1.0.0'
}
```

### HintEvidence
```typescript
interface HintEvidence {
  type: EvidenceType;
  weight: number;                // 0.0 to 1.0; contribution to overall confidence
  detail: string;                // human-readable explanation
  confidence: number;            // individual evidence confidence
}

type EvidenceType = 'route-match' | 'component-name-match' | 'class-name-match' | 'id-match' | 'testid-match' | 'file-name-match' | 'framework-convention' | 'directory-convention' | 'data-attribute-match' | 'heuristic';
```

### Candidate
```typescript
interface Candidate {
  filePath: string;              // relative path from project root
  discoveryMethod: DiscoveryMethod;
  initialConfidence: number;     // pre-ranking confidence
}

type DiscoveryMethod = 'route-correlation' | 'component-naming' | 'class-name-match' | 'framework-convention' | 'heuristic-match';
```

### HintEngineHealth
```typescript
interface HintEngineHealth {
  status: 'healthy' | 'degraded' | 'unavailable';
  hintsGenerated: number;
  hintsFailed: number;
  cacheSize: number;
  averageProcessingTimeMs: number;
}
```

---

## State Model

```
Idle → Generating → Generated
  ↓        ↓
  └── GenerationFailed
```

| State | Description | Valid Operations |
|-------|-------------|-----------------|
| `Idle` | No hint generation in progress | `generateHints()`, `health()` |
| `Generating` | Hint generation is in progress | Cannot start new generation |
| `Generated` | Hints are available (may be empty) | `getHint()`, `explainHint()`, `health()`, `clearCache()` |
| `GenerationFailed` | Last generation failed | `generateHints()` (retry), `health()` |

---

## Ranking Pipeline

### Confidence Model

Confidence scores are calculated as a weighted combination of evidence:

| Evidence Type | Weight | Description |
|--------------|--------|-------------|
| `route-match` | 0.35 | Browser URL matches a known route; route path maps to a file |
| `component-name-match` | 0.20 | Element tag name, class name, or data attribute matches a known component |
| `class-name-match` | 0.15 | CSS class names correspond to framework/file conventions |
| `id-match` | 0.10 | Element ID matches a known pattern |
| `framework-convention` | 0.10 | File follows framework-specific naming/directory conventions |
| `directory-convention` | 0.05 | File is in a known component directory |
| `data-attribute-match` | 0.03 | data-testid, data-component, or similar attributes |
| `heuristic` | 0.02 | Weak structural similarity or naming heuristic |

### Confidence Levels

```
0.95–1.00   Almost Certain   — Multiple strong evidence sources agree; route match + component name + framework convention
0.80–0.94   Very Likely      — Route match + one other strong evidence source
0.60–0.79   Likely           — Strong route match or multiple moderate evidence sources
0.30–0.59   Possible         — Single moderate evidence source; convention-based discovery
0.00–0.29   Weak             — Heuristic or single weak evidence source; likely incorrect
```

### Ranking Rules

1. Sort by confidence descending
2. Remove duplicates (same `filePath` → keep highest confidence)
3. If confidence difference < 0.05 between adjacent candidates, preserve ordering by discovery method priority (route > component > convention > heuristic)
4. Mark top candidate as `isPrimary: true`
5. Return at most 10 hints (configurable)
6. Drop hints below `minConfidence` threshold (default 0.10)
7. Empty result is valid (no hints meet threshold)

---

## Command Flows

### Generate Hints

```
VCE → SourceHintEngine.generateHints(hintInput)
  → Validate project metadata is loaded (project.metadata exists)
  → Validate DOM context has minimum evidence (tagName present)
  → Check cache for matching (route.pathname + domContext.tagName + domContext.id/className)
  → If cache hit: return cached hints
  → Candidate Discovery:
    → Route Correlation:
      → Match route.pathname against routeMap.routes
      → For each matched route, map route.file as candidate
      → Evidence: route-match (weight 0.35)
    → Component Naming:
      → For each directory in componentIndex.directories
      → Search for files matching tag name or class names
      → Evidence: component-name-match (weight 0.20)
    → Class Name Matching:
      → Parse className into individual class names
      → Map to file naming conventions (PascalCase → kebab-case → snake_case)
      → Search component directories for matching files
      → Evidence: class-name-match (weight 0.15)
    → ID Matching:
      → If domContext.id is present, search for files matching the ID
      → Evidence: id-match (weight 0.10)
    → Framework Convention:
      → Apply framework-specific conventions (via framework context)
      → e.g., Next.js: app/{route}/page.tsx
      → e.g., SvelteKit: src/routes/{route}/+page.svelte
      → Evidence: framework-convention (weight 0.10)
    → Data Attribute Matching:
      → Check data-testid, data-component, data-cy attributes
      → Search for files matching these values
      → Evidence: data-attribute-match (weight 0.03)
  → Confidence Calculation:
    → For each candidate, aggregate evidence scores
    → confidence = sum(evidence.weight * evidence.confidence) / sum(evidence.weight)
    → Clamp to [0.0, 1.0]
  → Ranking:
    → Sort by confidence descending
    → Remove duplicates
    → Filter below minConfidence
    → Limit to maxHints (default 10)
    → Mark top as isPrimary
  → Cache results
  → Emit HintsGenerated event
  → Return SourceHint[]
```

### Empty Result

```
If no candidates found OR all candidates below minConfidence:
  → Return ok([]) (empty array, not an error)
  → Emit HintsGenerated with hintCount: 0
  → VCE sets sourceHints: [] in Context Packet
```

---

## Event Flows

```
SourceHintEngine.generateHints()
  → EventBus.publish(HintsGenerated { captureId, hintCount, topConfidence })

Hint generation failure
  → EventBus.publish(HintsFailed { captureId, error })

Cache cleared
  → EventBus.publish(HintCacheCleared)

--- Subscribed events ---

ProjectScanned
  → Invalidate all cached hints (new scan = new project structure)
  → Clear cache

ProjectLoaded
  → Update internal project reference
```

---

## Error Behaviour

| Condition | Error Code | Message | Recovery |
|-----------|-----------|---------|----------|
| No project metadata available (scanner not run) | `SH_NO_PROJECT_METADATA` | "Cannot generate source hints: project metadata not loaded" | Return error; caller must run Project Scanner first |
| DOM evidence is insufficient (tagName missing) | `SH_INSUFFICIENT_EVIDENCE` | "Cannot generate source hints: insufficient DOM evidence" | Return error; caller must provide at minimum tagName |
| Route not found in RouteMap | `SH_ROUTE_NOT_FOUND` | "Current route '{pathname}' not found in project route map" | Not an error — returned as empty hints with diagnostic; hint generation continues with other evidence |
| No candidates found for any evidence type | `SH_NO_CANDIDATES` | "No candidate files discovered for element" | Not an error — returned as empty array with diagnostic; unknown is a valid result |
| Hint generation timeout (configurable, default 500ms) | `SH_TIMEOUT` | "Hint generation timed out after {timeout}ms" | Return partial results accumulated before timeout; emit HintsFailed |
| Invalid hintId | `SH_HINT_NOT_FOUND` | "Source hint with ID '{hintId}' not found" | Return error; caller may regenerate hints |
| HintInput contains invalid data (null/undefined required fields) | `SH_INVALID_INPUT` | "Invalid hint input: {field} is required" | Return error; caller must provide valid input |

---

## Security Requirements

### Trust Boundaries

* All DOM evidence is untrusted (comes from the browser/inspected application) — validated before use in file path matching
* All project metadata is trusted (comes from Project Scanner which validates inputs)
* File paths in hints are relative to project root — no path traversal beyond project boundary
* The inspected application may contain malicious class names or IDs — these are treated as opaque strings; never used to construct file paths unsanitised

### Input Validation

* All `DOMContext` fields are sanitised: special characters in tagName, className, id are stripped or escaped
* `filePath` values in candidates are validated as relative paths within the project (no `../..` traversal)
* `route.url` is validated as hostname + path only (no query parameters, no credentials)
* Text content from DOMContext is truncated at 200 characters

---

## Privacy Requirements

| Data | Purpose | Retention |
|------|---------|-----------|
| DOM tag names, class names, IDs | Evidence for source file discovery | Transient; not persisted beyond hint generation |
| Route paths | Route-to-file correlation | Transient; not persisted beyond hint generation |
| Generated SourceHint[] | Output for Context Packet enrichment | Cached until project structure changes or cache cleared |

### Data NOT Collected

* Full DOM content or page text
* Source code file contents
* User-specific or session-specific data
* Form input values or sensitive field content
* Authentication tokens or credentials

---

## Performance Budget

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Candidate discovery | < 50 ms | Benchmark: HintInput → candidates list; p95 |
| Evidence scoring | < 25 ms | Benchmark: candidates → scored candidates; p95 |
| Ranking | < 10 ms | Benchmark: scored candidates → ranked SourceHint[]; p95 |
| Total hint generation (<100 routes, <50 components) | < 100 ms | Benchmark: generateHints() → SourceHint[]; p95 |
| Cache lookup | < 1 ms | Benchmark: cache hit; p95 |

---

## Caching

### Cache Strategy

* Hint results are cached with key: `{route.pathname}:{domContext.tagName}:{domContext.id}:{domContext.className}`
* Cache is invalidated when:
  - `ProjectScanned` event is received (project structure changed)
  - `clearCache()` is called
  - Cache exceeds `maxCacheSize` entries (LRU eviction, default 1000)
* Cache is NOT invalidated on:
  - Same element re-selected on the same route (cache hit)
  - Browser navigation within the same route
  - Viewport changes (don't affect source hints)

### Cache Eviction

* LRU (Least Recently Used) eviction when cache exceeds `maxCacheSize`
* `maxCacheSize` configurable via `sourceHint.cache.maxEntries` (default: 1000)

---

## Failure and Recovery

### Recoverable Failures

| Failure | Recovery Strategy |
|---------|-------------------|
| Route not found in RouteMap | Continue generation with other evidence types; emit diagnostic; route-match evidence omitted |
| Component index empty | Skip component-naming discovery; use framework conventions and route correlation instead |
| Single evidence type times out | Skip that evidence type; continue with others; emit diagnostic |
| Framework conventions not available (unknown framework) | Skip framework-convention evidence; use generic heuristics |

### Fatal Failures

| Failure | Recovery Strategy |
|---------|-------------------|
| No project metadata loaded | Return `SH_NO_PROJECT_METADATA`; hint generation impossible without project context |
| Insufficient DOM evidence (no tagName) | Return `SH_INSUFFICIENT_EVIDENCE`; at minimum, element tag name is required |

---

## Explainability

Every hint must answer:
- **Why was this file selected?** — List of evidence types and their contributions
- **What evidence supports it?** — Specific matches (route, class name, convention)
- **How confident is the engine?** — Numeric confidence score with level label
- **What assumptions were made?** — Any heuristic or convention-based inferences

Explainability is first-class — the `explainHint()` method produces a markdown-formatted explanation suitable for display in Studio and consumption by AI agents.

### Example Hint Explanation

```markdown
## Source Hint: `app/dashboard/settings/page.tsx`
**Confidence:** 0.85 (Very Likely)

### Evidence
- **Route Match (weight 0.35):** Current URL `/dashboard/settings` matches route `app/dashboard/settings/page.tsx`
- **Component Name Match (weight 0.20):** Class name `SettingsPanel` corresponds to file `settings/page.tsx`
- **Framework Convention (weight 0.10):** Next.js App Router convention: `app/{route}/page.tsx`

### Assumptions
- Next.js App Router file-system routing is being used
- Component naming follows PascalCase convention

### Discovery Method
route-correlation
```

---

## Compatibility

### Breaking Change Policy

* Any change to `SourceHint` schema is a breaking change
* Any change to `HintInput` schema is a breaking change
* Any change to event payload schemas is a breaking change
* Changes to evidence weight distribution are non-breaking but must be documented
* Adding new `DiscoveryMethod` or `EvidenceType` values is non-breaking

---

## Testing Requirements

### Unit Tests

* Verify `generateHints()` returns ranked hints when route matches a known route
* Verify `generateHints()` returns empty array when no evidence is sufficient
* Verify route-match evidence has highest weight in confidence calculation
* Verify duplicate file paths are removed (keep highest confidence)
* Verify hints are sorted by confidence descending
* Verify top hint is marked `isPrimary: true`
* Verify hints below `minConfidence` threshold are filtered out
* Verify `explainHint()` produces markdown with evidence breakdown
* Verify cache returns stale result for identical (route + tagName + id + className)
* Verify cache is invalidated on `ProjectScanned` event
* Verify `rankCandidates()` preserves ordering when confidence difference < 0.05
* Verify `generateHints()` returns `SH_NO_PROJECT_METADATA` when no project loaded
* Verify `generateHints()` returns `SH_INSUFFICIENT_EVIDENCE` when tagName is missing
* Verify engine NEVER imports `@viskod/browser-runtime` or `playwright`
* Verify engine NEVER accesses file system

### Integration Tests

* Generate hints for a Next.js page with known route; verify file path matches route convention
* Generate hints for a component with matching class name; verify component name match evidence is produced
* Generate hints for an element without sufficient evidence; verify empty result
* Generate hints after Project Scanner scans Viskod itself; verify hints can be produced
* Cache a hint result; rescan project; verify cache is invalidated
* Generate hints for a SvelteKit route; verify SvelteKit-specific convention is used
* Verify hint explanation includes all evidence types and confidence breakdown

### Contract Tests

* SourceHint schema matches the schema defined in this specification
* HintInput schema matches the schema defined in this specification
* All event payload schemas match the schemas defined in the Events tables
* All error codes conform to SPEC-003 error model

---

## Acceptance Criteria

- [ ] `generateHints()` accepts `HintInput` and returns ranked `SourceHint[]`
- [ ] Empty array returned when no hints meet minimum confidence threshold (not an error)
- [ ] Route-to-file correlation correctly maps browser URL to project file (Next.js, SvelteKit)
- [ ] Class name matching discovers candidates from component index directories
- [ ] Confidence scores accurately reflect evidence strength
- [ ] `explainHint()` produces readable markdown explanation
- [ ] Cache returns stale result for identical (route + tagName + id + className) queries
- [ ] Cache is invalidated on `ProjectScanned` event
- [ ] Confidence levels match the defined ranges (Almost Certain, Very Likely, Likely, Possible, Weak)
- [ ] Source Hint Engine NEVER imports `@viskod/browser-runtime` or `playwright`
- [ ] Source Hint Engine NEVER reads files from disk
- [ ] `HintsGenerated` event published on successful generation
- [ ] `HintsFailed` event published on failure
- [ ] Total hint generation completes within 100 ms (p95)
- [ ] All errors return structured `ViskodError` objects conforming to SPEC-003

---

## Open Implementation Decisions

| ID | Topic | Status |
|----|-------|--------|
| — | Source map integration for higher-confidence hints | Deferred to Phase 3+ (requires build tool integration) |
| — | Component metadata extraction (React/Vue/Svelte component names from compiled output) | Deferred to Phase 3+ |
| — | Language server protocol integration for symbol search | Deferred to Phase 3+ |
| — | Machine learning-based ranking (future, if heuristic ranking proves insufficient) | Deferred to Phase 3+ |
| — | Support for nested route parameter matching (`/dashboard/[id]/settings/[tab]`) | Included in Phase 2 via route Map patterns |
| — | Import graph traversal for transitive component discovery | Deferred to Phase 3+ |

---

## Implementation Sequence

1. Define all TypeScript interfaces (`packages/source-hint-engine/src/types.ts`)
2. Implement HintInput validation
3. Implement candidate discovery — route correlation
4. Implement candidate discovery — component naming
5. Implement candidate discovery — class name matching
6. Implement candidate discovery — ID matching
7. Implement candidate discovery — framework conventions
8. Implement candidate discovery — data attribute matching
9. Implement evidence scoring and weighting
10. Implement confidence calculation
11. Implement ranking pipeline (sort, deduplicate, threshold filter, limit, primary mark)
12. Implement caching (LRU, fingerprint-based invalidation)
13. Implement `explainHint()` with markdown output
14. Implement Event Dispatcher (publish HintsGenerated, HintsFailed, HintCacheCleared)
15. Implement event subscriptions (ProjectScanned → invalidate cache)
16. Implement error handling (all error codes)
17. Write unit tests (mocked project metadata, verified ranking logic)
18. Write integration tests (real project scans, verified hint accuracy)
19. Write contract tests (schema validation, error code conformance)
20. Integrate with Project Scanner (SPEC-012) — consume ProjectMetadata, RouteMap, ComponentIndex
21. Integrate with VCE (SPEC-009) — verify hints flow into Context Packet sourceHints field
22. Validate build tool enforces import restrictions

---

## Definition of Done

- [ ] All methods implemented with correct signatures, preconditions, postconditions, and error handling
- [ ] Ranking pipeline correctly scores, deduplicates, thresholds, and limits hints
- [ ] Confidence model applies correct evidence weights
- [ ] Empty results are valid (not errors) when evidence is insufficient
- [ ] `explainHint()` produces human-readable, evidence-backed explanations
- [ ] Cache works correctly with invalidation on ProjectScanned
- [ ] All event schemas defined and published to Event Bus at correct points
- [ ] All error codes conform to SPEC-003
- [ ] Unit tests pass (mocked project metadata, verified evidence evaluation)
- [ ] Integration tests pass (real project scans, verified hint accuracy)
- [ ] Contract tests pass (schema validation, error code conformance)
- [ ] Build tool verifies no forbidden imports
- [ ] Lint passes (`biome check`)
- [ ] TypeScript strict mode passes with zero errors
- [ ] Performance benchmarks recorded and within budget
- [ ] Hint files are always relative paths within project root (no path traversal)

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Route mapping fails for non-standard or nested router configurations | Medium | Medium | Route correlation is best-effort; engine degrades to other evidence types when routes don't match |
| Class name heuristics produce false positives (generic names like 'container', 'wrapper') | Medium | Low | Low weight for class-name-match (0.15); multiple evidence sources required for high confidence |
| Framework conventions change between major versions (e.g., Next.js Pages Router → App Router) | Low | Medium | Framework adapters are pluggable; each adapter handles its own convention detection |
| Large component indices cause candidate discovery slowdown | Low | Low | Limit candidate discovery iterations per evidence type; earliest termination on timeout |
| Empty results perceived as failures by users | Medium | Low | Empty results are explicitly valid; Studio displays "No source hints available — evidence is insufficient" rather than an error |
| Framework detection returns 'unknown' → no framework conventions available | Medium | Low | Engine works without framework context; uses generic heuristics; confidence will be lower but results are still produced |
