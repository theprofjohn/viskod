# Project Scanner

> **Specification ID:** SPEC-012
> **Version:** 1.0
> **Status:** Draft
> **Owner:** Platform Architecture
> **Last Updated:** 2026-07-28

---

## Architecture Sources

* `docs/project-scanner.md` — full subsystem specification: workspace discovery, framework detection, build system detection, package manager detection, monorepo detection, configuration discovery, route discovery, component discovery, source hint generation, confidence rules, caching, file watching, failure policy
* `docs/architecture.md` §Project Scanner — understands the repository: framework detection, package manager, routes, configuration, project metadata; never inspects the browser
* `docs/architecture.md` §Package Responsibilities — packages/project-scanner: responsible for understanding the repository; not responsible for browser automation, DOM inspection, visual analysis, code generation, semantic reasoning
* `docs/ARCHITECTURE_BASELINE.md` §Runtime Boundaries — Project Scanner owns repository understanding; forbidden access: browser, DOM, MCP, overlays
* `docs/ARCHITECTURE_BASELINE.md` §Prohibited Dependencies — Project Scanner must not depend on Browser Runtime; Project Scanner must not import browser automation libraries
* `docs/glossary.md` §Project Scanner — the subsystem that understands repository structure, framework conventions, and provides project metadata

---

## Dependencies

| Specification | Status | Relationship |
|--------------|--------|-------------|
| SPEC-002 (shared-types) | Draft | Imports base types (`Identifier`, `Timestamp`, `Result`, `Maybe`), Zod schemas, error base types |
| SPEC-003 (error-model) | Draft | Imports `ViskodError`, `ErrorCategory`, `ErrorSeverity`; produces errors conforming to the error model |
| SPEC-004 (configuration) | Draft | Reads `project.scanner.*` configuration keys for project root detection, exclusion patterns |
| SPEC-007 (event-bus) | Draft | Publishes `ProjectLoaded`, `ProjectScanned`, `ScannerDiagnostics` events |

---

## Consumers

| Specification | Status | Relationship |
|--------------|--------|-------------|
| SPEC-009 (visual-context-engine) | Draft | VCE consumes project metadata for Context Packet enrichment (framework, routes, package manager) |
| SPEC-011 (source-hint-engine) | Draft | Source Hint Engine consumes project metadata for candidate file discovery |
| SPEC-013 (framework-adapters) | Draft | Framework Adapters consume project metadata for framework-specific route/component detection |
| SPEC-016 (cli) | Draft | CLI triggers initial project scan on `viskod start` |

---

## Purpose

Defines the Project Scanner subsystem: the component that understands the structure of a software project without analysing its behaviour. The scanner collects project metadata that helps explain the running UI — framework detection, route discovery, package manager identification, configuration surface — and produces evidence-backed metadata that enriches Context Packets and feeds the Source Hint Engine. It answers "What project is this browser currently displaying?" — not "How does this application work?"

---

## Scope

* Workspace discovery (project root detection, package manager identification, workspace type)
* Repository metadata collection (project name, root path, language, runtime, package manager)
* Framework detection (React, Next.js, Vue, Nuxt, Svelte, SvelteKit, Angular, Solid, Astro, Remix, Qwik)
* Build system detection (Vite, Webpack, Rspack, Parcel, Rollup, Turbopack)
* Package manager detection (pnpm, npm, Yarn, Bun)
* Monorepo detection (pnpm Workspace, Turbo, Nx, Lerna, Rush)
* Configuration discovery (tsconfig, vite.config, next.config, tailwind.config, eslint.config, biome.json)
* Route discovery (file-system routes, config-based routes, dynamic routes, layouts, route groups)
* Component discovery (likely component directories and file naming conventions)
* Design system detection (Tailwind CSS, shadcn/ui, Material UI, Chakra UI, Ant Design)
* Source hint prerequisites (project structure, route map, component index — for Source Hint Engine consumption)
* Caching of scan results (invalidation on config file changes)
* Event publishing to Event Bus (project load, scan completion, diagnostics)
* Error handling and recovery (unreadable files, scan failures, partially-scannable projects)

---

## Non-Goals

* Reading or parsing source code bodies (only file structure and config files)
* Source code analysis, type-checking, or static analysis
* Browser automation, DOM inspection, or visual analysis
* Context Packet construction (VCE owns this)
* Source hint calculation (Source Hint Engine owns this)
* Code generation or modification
* Run-time application behaviour analysis
* Dependency graph generation (future concern)
* Import graph resolution (future concern)
* Design token extraction (future concern)

---

## Terminology

| Term | Definition (this spec) |
|------|----------------------|
| **ProjectRoot** | The root directory of the developer's project, detected by presence of `package.json`, `pnpm-workspace.yaml`, `bun.lock`, or git repository |
| **WorkspaceMetadata** | Structured description of the project: name, root path, package manager, workspace type, language, runtime |
| **FrameworkDetection** | Evidence-backed identification of the application framework (e.g., React detected via `react` in dependencies + `.tsx` files present) |
| **RouteMap** | A structured representation of application routes discovered via file-system conventions or configuration parsing |
| **ComponentIndex** | A lightweight index of likely component directories and file naming patterns |
| **ScanResult** | The complete output of a project scan: metadata, framework, routes, components, configuration |
| **Fingerprint** | A hash of the project's dependency and configuration state; used for cache invalidation |

All other terms reference `docs/glossary.md` for canonical definitions.

---

## Runtime Boundary

| Boundary | Value |
|----------|-------|
| Process | Main desktop process (same as VCE and Studio) |
| Imports allowed | `@viskod/shared` (types, schemas, utilities, errors), `@viskod/config` (configuration defaults), `node:fs`, `node:path`, `node:crypto` |
| Imports forbidden | `@viskod/browser-runtime`, `@viskod/visual-context-engine`, `@viskod/mcp-server`, `@viskod/selection-engine`, `@viskod/source-hint-engine`, `@viskod/studio`, `@viskod/capture-pipeline`, `playwright` |
| Network | No direct network access |
| File system | Read-only access to project files (package.json, config files, directory structure); never writes |
| Secrets | Never accesses `.env` files, environment variables beyond config keys, or user credentials |

---

## Responsibilities

The Project Scanner owns:

* Detecting the project root directory from current working directory upward
* Identifying the package manager in use (pnpm, npm, Yarn, Bun)
* Detecting the application framework(s) in use
* Detecting the build system(s) and bundler(s)
* Identifying monorepo structure and workspace topology
* Discovering application routes (file-system routes, config-based routes)
* Identifying likely component directories and file naming patterns
* Detecting design system and CSS framework usage
* Collecting project configuration (tsconfig, vite.config, biome.json, tailwind.config, etc.)
* Producing structured `ProjectMetadata` and `ScanResult` objects
* Caching scan results with fingerprint-based invalidation
* Publishing `ProjectLoaded` and `ProjectScanned` events to the Event Bus
* Reporting scanner diagnostics (undetected frameworks, scan errors, partial results)

The Project Scanner must never:

* Read source code file bodies (only file names, directory structure, and configuration files)
* Import or execute any file from the project being scanned
* Inspect the browser, DOM, or visual state
* Generate source hints (Source Hint Engine owns this)
* Modify any project files
* Communicate with Browser Runtime or Studio directly
* Expose MCP tools, resources, or prompts

---

## Interfaces

### Public API

| Signature | Purpose | Preconditions | Postconditions | Errors |
|-----------|---------|---------------|----------------|--------|
| `scan(rootPath?: string): Promise<Result<ScanResult>>` | Perform a full project scan from root directory | Root path exists and is a directory; project is a valid software project | Returns complete ScanResult; caches result; emits `ProjectScanned` event | `PS_NO_PROJECT_FOUND`, `PS_SCAN_FAILED`, `PS_UNREADABLE_DIR` |
| `detectFramework(rootPath: string): Promise<Result<FrameworkDetection>>` | Detect the application framework | Root path exists | Returns FrameworkDetection with evidence and confidence | `PS_NO_PROJECT_FOUND` |
| `discoverRoutes(rootPath: string): Promise<Result<RouteMap>>` | Discover application routes | Framework detected; project is scannable | Returns RouteMap with all discovered routes | `PS_NO_ROUTES_FOUND` |
| `getProjectMetadata(rootPath: string): Promise<Result<ProjectMetadata>>` | Get basic project metadata | Root path exists | Returns ProjectMetadata (name, package manager, workspace type) | `PS_NO_PROJECT_FOUND` |
| `getConfiguration(rootPath: string): Promise<Result<ProjectConfig[]>>` | Discover project configuration files | Root path exists | Returns array of discovered config files with parsed content | `PS_NO_PROJECT_FOUND` |
| `detectComponents(rootPath: string): Promise<Result<ComponentIndex>>` | Identify likely component locations | Project is scannable | Returns ComponentIndex with directory paths and naming patterns | None (returns empty index if none found) |
| `detectDesignSystem(rootPath: string): Promise<Result<DesignSystemDetection>>` | Detect CSS framework and design system | Root path exists | Returns DesignSystemDetection with evidence | None (returns unknown if none detected) |
| `health(): ScannerHealth` | Return current scanner health | Any state | Returns health status synchronously | None (synchronous) |
| `clearCache(): Promise<Result<void>>` | Clear all cached scan results | Any state | Cache cleared; next scan will re-detect everything | None |

### Events Published

| Event | Payload Schema | When Published |
|-------|---------------|----------------|
| `ProjectLoaded` | `{ projectId: Identifier; metadata: ProjectMetadata; timestamp: Timestamp }` | After successful `scan()` or `getProjectMetadata()` |
| `ProjectScanned` | `{ projectId: Identifier; scanResult: ScanResult; timestamp: Timestamp }` | After full scan completes successfully |
| `ScanFailed` | `{ projectId: Identifier; error: ViskodError; timestamp: Timestamp }` | When scan fails completely |
| `ScannerDiagnostics` | `{ projectId: Identifier; diagnostics: ScannerDiagnostic[]; timestamp: Timestamp }` | After scan completes (success or partial); includes warnings for undetected items |

### Events Subscribed

Project Scanner subscribes to no events. It is exclusively a publisher. Scans are triggered by CLI or VCE commands, not by events.

---

## Data Models

### ProjectMetadata
```typescript
interface ProjectMetadata {
  projectId: string;             // deterministic hash of project root path
  name: string;                  // from package.json name field
  rootPath: string;              // absolute path to project root
  packageManager: PackageManager; // 'pnpm' | 'npm' | 'yarn' | 'bun'
  workspaceType: WorkspaceType;  // 'single' | 'pnpm-workspace' | 'turbo' | 'nx' | 'lerna' | 'rush'
  language: 'typescript' | 'javascript' | 'mixed';
  runtime: string;               // e.g., 'node', 'bun', 'deno'
  nodeVersion?: string;          // from package.json engines or .nvmrc
}
```

### PackageManager
```typescript
type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';
```

### WorkspaceType
```typescript
type WorkspaceType = 'single' | 'pnpm-workspace' | 'turbo' | 'nx' | 'lerna' | 'rush' | 'unknown';
```

### ScanResult
```typescript
interface ScanResult {
  fingerprint: string;           // hash of dependency + config state; used for cache invalidation
  metadata: ProjectMetadata;     // base project metadata
  framework: FrameworkDetection; // detected framework(s)
  routes: RouteMap;              // discovered routes
  components: ComponentIndex;    // component locations
  designSystem: DesignSystemDetection; // CSS framework / design system
  configuration: ProjectConfig[]; // discovered configuration files
  diagnostics: ScannerDiagnostic[]; // warnings and non-fatal issues
  scanDurationMs: number;        // time taken for full scan
  timestamp: string;             // ISO 8601
}
```

### FrameworkDetection
```typescript
interface FrameworkDetection {
  primary: Framework | null;      // primary framework (e.g., 'nextjs', 'react')
  detected: Framework[];          // all detected frameworks
  evidence: FrameworkEvidence[];  // evidence for each detection
  confidence: number;             // 0.0 to 1.0
}

type Framework = 'react' | 'nextjs' | 'vue' | 'nuxt' | 'svelte' | 'sveltekit' | 'angular' | 'solid' | 'astro' | 'remix' | 'qwik' | 'unknown';

interface FrameworkEvidence {
  framework: Framework;
  method: 'dependency' | 'config-file' | 'file-pattern' | 'directory-convention';
  detail: string;                // e.g., 'next dependency found in package.json', 'next.config.ts exists'
  confidence: number;            // contribution to overall confidence
}
```

### RouteMap
```typescript
interface RouteMap {
  framework: Framework;
  routes: Route[];
  layoutPattern?: string;        // e.g., 'app/{route}/layout.tsx' for Next.js
  dynamicRoutePattern?: string;  // e.g., '[param]' for file-system dynamic routes
  totalRoutes: number;
}

interface Route {
  path: string;                  // URL path, e.g., '/dashboard/settings'
  file: string;                  // relative file path, e.g., 'app/dashboard/settings/page.tsx'
  type: 'page' | 'layout' | 'api' | 'middleware' | 'unknown';
  isDynamic: boolean;            // true if route contains dynamic segments
  params?: string[];             // dynamic parameter names, e.g., ['id', 'slug']
}
```

### ComponentIndex
```typescript
interface ComponentIndex {
  directories: string[];         // e.g., ['src/components/', 'app/', 'ui/']
  namingPatterns: string[];      // e.g., ['*.tsx', '*.svelte', '*.vue']
  frameworkComponents?: string[]; // framework-specific component locations
  totalFiles: number;
}
```

### DesignSystemDetection
```typescript
interface DesignSystemDetection {
  cssFramework: CssFramework | null;
  uiLibrary: UILibrary | null;
  evidence: string[];            // evidence for each detection
}

type CssFramework = 'tailwind' | 'unocss' | 'styled-components' | 'css-modules' | 'vanilla-extract' | 'unknown';
type UILibrary = 'shadcn-ui' | 'material-ui' | 'chakra-ui' | 'daisyui' | 'ant-design' | 'radix-ui' | 'unknown';
```

### ProjectConfig
```typescript
interface ProjectConfig {
  file: string;                  // relative path, e.g., 'tsconfig.json'
  type: 'typescript' | 'vite' | 'next' | 'tailwind' | 'eslint' | 'biome' | 'postcss' | 'other';
  exists: boolean;
  path: string;                  // absolute path
}
```

### ScannerDiagnostic
```typescript
interface ScannerDiagnostic {
  level: 'warning' | 'error';
  message: string;
  stage: 'workspace' | 'framework' | 'routes' | 'components' | 'design-system' | 'configuration';
  detail?: string;
}
```

### ScannerHealth
```typescript
interface ScannerHealth {
  status: 'healthy' | 'degraded' | 'unavailable';
  lastScanTimestamp: string | null;
  lastScanDurationMs: number;
  projectsScanned: number;
  scansFailed: number;
  cacheSize: number;
}
```

---

## State Model

### Scanner States

```
Idle → Scanning → Scanned
  ↓        ↓
  └── ScanFailed
```

| State | Description | Valid Operations |
|-------|-------------|-----------------|
| `Idle` | No scan in progress; no cached results | `scan()`, `health()` |
| `Scanning` | A scan is in progress | Cannot start new scan |
| `Scanned` | Scan completed successfully; results cached | All query operations; `scan()` (re-scan); `clearCache()` |
| `ScanFailed` | Last scan failed completely; partial results may be cached | `scan()` (retry); `health()` |

### Invariants

* Only one scan runs at a time (scans are not concurrent)
* Cached results are immutable until invalidated
* Cache invalidation uses fingerprint hashing of `package.json` + config files
* Partial results are preserved when individual stages fail (framework detection succeeds but route discovery fails)
* Project root detection is idempotent — same directory always returns same `projectId`

---

## Command Flows

### Full Scan

```
CLI → ProjectScanner.scan(rootPath?)
  → Workspace Discovery
    → Find project root (walk up from cwd looking for package.json, .git, pnpm-workspace.yaml)
    → Identify package manager (check for pnpm-lock.yaml, package-lock.json, yarn.lock, bun.lock)
    → Identify workspace type (check for pnpm-workspace.yaml, turbo.json, nx.json, lerna.json)
    → Read package.json name field → projectId
  → Framework Detection
    → Read package.json dependencies
    → Check for framework-specific config files (next.config.*, svelte.config.js, astro.config.*, etc.)
    → Check for framework-specific file patterns (app/ directory for Next.js, src/routes/ for SvelteKit)
    → Calculate confidence from evidence
  → Route Discovery
    → Identify framework-specific route conventions
    → Walk route directory (app/, pages/, src/routes/, etc.)
    → Discover static routes, dynamic routes, layouts, API routes
    → Build RouteMap
  → Component Discovery
    → Identify likely component directories (src/components/, ui/, app/ (Next.js), etc.)
    → Identify file naming patterns (.tsx, .svelte, .vue)
    → Build ComponentIndex
  → Design System Detection
    → Check for tailwind.config.*, postcss.config.*, uno.config.*
    → Check for UI library dependencies (shadcn-ui, @mui/material, @chakra-ui/react, daisyui, antd)
    → Build DesignSystemDetection
  → Configuration Discovery
    → Find all configuration files (tsconfig, vite.config, biome.json, eslint.config, etc.)
    → Read and parse relevant config files
    → Build ProjectConfig[]
  → Generate fingerprint hash
  → Cache result
  → Emit ProjectScanned event
  → Return ScanResult
```

### Framework-Specific Detection

```
ProjectScanner.detectFramework(rootPath)
  → Check package.json dependencies for known framework packages
    → react, react-dom → React
    → next → Next.js
    → vue → Vue
    → nuxt → Nuxt
    → svelte → Svelte
    → @sveltejs/kit → SvelteKit
    → @angular/core → Angular
    → solid-js → Solid
    → astro → Astro
    → @remix-run/react → Remix
    → @builder.io/qwik → Qwik
  → Check for framework-specific config files
    → next.config.{js,ts,mjs,mts} → Next.js
    → svelte.config.js → SvelteKit
    → astro.config.{js,ts,mjs,mts} → Astro
    → remix.config.{js,ts} → Remix
  → Check for framework-specific directory conventions
    → app/ with page.tsx → Next.js (App Router)
    → pages/ with _app.tsx → Next.js (Pages Router)
    → src/routes/ with +page.svelte → SvelteKit
  → Aggregate evidence
  → Calculate confidence (dependency = 0.8, config file = 1.0, directory convention = 0.7)
  → Return FrameworkDetection
```

---

## Event Flows

```
ProjectScanner.scan()
  → EventBus.publish(ProjectLoaded { projectId, metadata })
  → EventBus.publish(ProjectScanned { projectId, scanResult })

Scan failure
  → EventBus.publish(ScanFailed { projectId, error })

Partial scan (some stages fail)
  → EventBus.publish(ProjectScanned { projectId, scanResult }) // includes diagnostics
  → EventBus.publish(ScannerDiagnostics { projectId, diagnostics })
```

---

## Error Behaviour

| Condition | Error Code | Message | Recovery |
|-----------|-----------|---------|----------|
| No package.json found in any parent directory | `PS_NO_PROJECT_FOUND` | "No project found in {path} or parent directories" | Return error; caller may specify explicit root path |
| Directory is unreadable (permissions) | `PS_UNREADABLE_DIR` | "Cannot read directory {path}: permission denied" | Return error; scanner cannot proceed |
| package.json is malformed JSON | `PS_INVALID_PACKAGE_JSON` | "package.json at {path} contains invalid JSON" | Return error; scan cannot complete without valid package.json |
| No recognized framework detected | `PS_NO_FRAMEWORK_DETECTED` | "No recognized framework detected in project" | Return FrameworkDetection with framework: 'unknown'; scan continues |
| Route directory not found (unconventional project structure) | `PS_NO_ROUTES_FOUND` | "No route directory found using conventional patterns" | Return empty RouteMap; scan continues |
| Configuration file is unreadable | `PS_CONFIG_READ_ERROR` | "Cannot read configuration file {path}" | Emit diagnostic; skip that config file; scan continues |
| Framework detection is ambiguous (multiple frameworks) | `PS_AMBIGUOUS_FRAMEWORK` | "Multiple frameworks detected; cannot determine primary" | Report all detected frameworks; set primary to first detected with highest confidence |
| Scan timeout (configurable, default 10s) | `PS_SCAN_TIMEOUT` | "Project scan timed out after {timeout}ms" | Return partial results; stage that timed out is skipped |

---

## Security Requirements

### Trust Boundaries

* The scanned project is untrusted — all file paths and content are validated
* package.json content is untrusted — all fields are validated before use
* Configuration file content is untrusted — never execute code from config files; only parse known formats
* File system access is read-only — never write to the project directory

### Input Validation

* All file paths are validated as relative to project root; no path traversal
* package.json `name` field is sanitised (alphanumeric + hyphens + underscores only)
* All framework dependency names are validated against known list
* File extensions are validated before attempting to parse

---

## Privacy Requirements

| Data | Purpose | Retention |
|------|---------|-----------|
| Project name and metadata | Identifying the project for context enrichment | Cached until fingerprint changes |
| Framework detection results | Enriching Context Packets with framework context | Cached until fingerprint changes |
| Route map | Enabling route-based source hints | Cached until fingerprint changes |
| Component index | Enabling component-based source hints | Cached until fingerprint changes |
| Configuration surface | Understanding project tooling | Cached until fingerprint changes |

### Data NOT Collected

* Source code file contents (only file names and directory structure)
* Environment variable values
* Authentication tokens, API keys, or secrets from the project
* User-specific configuration values
* Git history or commit metadata
* Any file content beyond configuration files
* Dependency version ranges (only presence/absence is checked)

---

## Performance Budget

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Workspace discovery | < 200 ms | Benchmark: cwd → project root; p95 |
| Framework detection | < 100 ms | Benchmark: read package.json → FrameworkDetection; p95 |
| Full initial scan (small project, <100 files) | < 2000 ms | Benchmark: scan() → ScanResult; p95 |
| Full initial scan (large project, <10000 files) | < 5000 ms | Benchmark: scan() → ScanResult; p95 |
| Incremental rescan (no changes) | < 200 ms | Benchmark: re-scan returning cached result; p95 |
| Route discovery (<100 routes) | < 500 ms | Benchmark: discoverRoutes() → RouteMap; p95 |
| Configuration discovery | < 200 ms | Benchmark: getConfiguration() → ProjectConfig[]; p95 |

---

## Caching

### Cache Strategy

* Scan results are cached in memory with a fingerprint hash
* Fingerprint includes: package.json hash + hash of all detected config file paths and their modification times
* Cache is invalidated when:
  - `package.json` content changes (different hash)
  - Any detected configuration file is added, removed, or modified
  - Cache is manually cleared via `clearCache()`
* Cache is NOT invalidated on:
  - Source code file changes (too noisy; scheduled rescan handles these)
  - Node module changes (unless framework dependency changes)
  - File additions in non-config directories

### Cache Keys

| Cached Item | Key |
|-------------|-----|
| ScanResult | `scan:{fingerprint}` |
| FrameworkDetection | `framework:{fingerprint}` |
| RouteMap | `routes:{fingerprint}` |
| ComponentIndex | `components:{fingerprint}` |
| ProjectMetadata | `metadata:{rootPath}` (path-based, not fingerprint-based) |

---

## Failure and Recovery

### Recoverable Failures

| Failure | Recovery Strategy |
|---------|-------------------|
| Route directory not found | Return empty RouteMap; emit diagnostic warning; scan continues |
| No framework detected | Set framework to 'unknown'; scan continues with partial metadata |
| Configuration file read error | Skip that file; emit diagnostic; scan continues |
| Component directory not found | Return empty ComponentIndex; scan continues |

### Fatal Failures

| Failure | Recovery Strategy |
|---------|-------------------|
| No project found | Return `PS_NO_PROJECT_FOUND`; no partial results |
| Unreadable project directory | Return `PS_UNREADABLE_DIR`; no partial results |
| Malformed package.json | Return `PS_INVALID_PACKAGE_JSON`; no scan proceeds |
| Scan timeout | Return partial results accumulated before timeout; emit `ScanFailed` with stage info |

---

## Compatibility

### Breaking Change Policy

* Any change to `ScanResult` schema is a breaking change
* Any change to `ProjectMetadata` schema is a breaking change
* Any change to event payload schemas is a breaking change
* Adding new framework detection capabilities is non-breaking
* Adding new route discovery patterns is non-breaking

---

## Testing Requirements

### Unit Tests

* Verify project root detection walks up from cwd to find package.json
* Verify project root detection returns `PS_NO_PROJECT_FOUND` when no package.json exists
* Verify package manager detection: pnpm-lock.yaml → pnpm, package-lock.json → npm, yarn.lock → yarn, bun.lock → bun
* Verify framework detection from package.json dependencies
* Verify framework detection from config files (next.config.ts → Next.js)
* Verify framework detection from directory conventions (app/page.tsx → Next.js)
* Verify route discovery for file-system routes (Next.js App Router pattern)
* Verify route discovery for dynamic routes ([param]/page.tsx)
* Verify component directory detection for common patterns
* Verify design system detection (tailwind.config.ts → Tailwind)
* Verify fingerprint changes when package.json is modified
* Verify cache returns stale result when fingerprint matches
* Verify cache is invalidated when fingerprint changes
* Verify scanner NEVER imports `@viskod/browser-runtime` or `playwright`
* Verify scanner NEVER writes to project files

### Integration Tests

* Scan a real Next.js project; verify framework detected as 'nextjs'
* Scan a real Vite + React project; verify build system is 'vite', framework is 'react'
* Scan a pnpm monorepo; verify workspace type is 'pnpm-workspace'
* Scan a project with Tailwind; verify CSS framework is 'tailwind'
* Scan a project with shadcn-ui; verify UI library is 'shadcn-ui'
* Scan a project without conventional route directory; verify empty RouteMap is returned
* Scan a project with malformed package.json; verify `PS_INVALID_PACKAGE_JSON` error
* Verify scanner can scan the Viskod repository itself without errors

### Contract Tests

* ScanResult schema matches the schema defined in this specification
* All event payload schemas match the schemas defined in the Events tables
* All error codes conform to SPEC-003 error model

---

## Acceptance Criteria

- [ ] `scan()` discovers project root and returns `ProjectMetadata` with name, package manager, workspace type
- [ ] Framework detection identifies at minimum: React, Next.js, Vue, Svelte, Angular
- [ ] Framework detection returns evidence for each detection with confidence scores
- [ ] Route discovery finds routes for at minimum: Next.js App Router, Next.js Pages Router, SvelteKit
- [ ] Route discovery correctly identifies dynamic routes and layout routes
- [ ] Component index identifies common component directories (src/components/, app/, ui/, etc.)
- [ ] Design system detection identifies Tailwind CSS from tailwind.config.* presence
- [ ] Configuration discovery finds tsconfig.json, vite.config.*, biome.json
- [ ] Cache returns stale result when fingerprint is unchanged
- [ ] Cache is invalidated when package.json is modified
- [ ] Full scan completes within 2s for projects under 100 files (p95)
- [ ] `ProjectLoaded`, `ProjectScanned` events published to Event Bus
- [ ] Project Scanner NEVER imports `@viskod/browser-runtime` or `playwright`
- [ ] Project Scanner NEVER imports `@viskod/visual-context-engine`, `@viskod/mcp-server`, or `@viskod/studio`
- [ ] Project Scanner NEVER writes to project files (read-only)
- [ ] All errors return structured `ViskodError` objects conforming to SPEC-003
- [ ] `health()` returns correct status based on actual scanner state

---

## Open Implementation Decisions

| ID | Topic | Status |
|----|-------|--------|
| — | Route discovery depth for deeply nested routes (max directory depth) | To be determined during implementation (default: 10) |
| — | Support for config-based routers (React Router, TanStack Router) | Deferred to framework-adapters (SPEC-013) |
| — | File watching for automatic re-scan | Phase 2+ using chokidar |
| — | Design token extraction from Tailwind config | Deferred; Viskod doesn't replicate design tool functionality |
| — | Multi-framework project support (e.g., Astro + React) | Primary/secondary framework model; second framework reported but not analysed |

---

## Implementation Sequence

1. Define all TypeScript interfaces (`packages/project-scanner/src/types.ts`)
2. Implement workspace discovery (project root, package manager, workspace type)
3. Implement project metadata collection (name, root, package manager, language, runtime)
4. Implement framework detection (dependency check, config file check, directory pattern check)
5. Implement build system detection (Vite, Webpack, Turbopack, etc.)
6. Implement route discovery (Next.js App Router, Next.js Pages Router, SvelteKit)
7. Implement component directory discovery
8. Implement design system detection (Tailwind, shadcn-ui, etc.)
9. Implement configuration discovery (tsconfig, vite.config, biome.json, etc.)
10. Implement fingerprint calculation and caching
11. Implement Event Dispatcher (publish ProjectLoaded, ProjectScanned, ScannerDiagnostics)
12. Implement error handling and partial-scan recovery
13. Write unit tests (mock filesystem, verified event publishing)
14. Write integration tests (real project directories, verified detection accuracy)
15. Write contract tests (schema validation, error code conformance)
16. Integrate with Event Bus (SPEC-007) — verify events consumed by VCE (SPEC-009)
17. Integrate with Source Hint Engine (SPEC-011) — verify metadata flows correctly
18. Validate build tool enforces import restrictions

---

## Definition of Done

- [ ] All methods implemented with correct signatures, preconditions, postconditions, and error handling
- [ ] Framework detection correctly identifies all 11 frameworks listed in scope
- [ ] Route discovery works for Next.js App Router, Next.js Pages Router, and SvelteKit
- [ ] Cache system works correctly with fingerprint-based invalidation
- [ ] All event schemas defined and published to Event Bus at correct points
- [ ] All error codes conform to SPEC-003
- [ ] Unit tests pass (mocked filesystem, verified detection logic)
- [ ] Integration tests pass (real project directories)
- [ ] Contract tests pass (schema validation, error code conformance)
- [ ] Build tool verifies no forbidden imports
- [ ] Lint passes (`biome check`)
- [ ] TypeScript strict mode passes with zero errors
- [ ] Performance benchmarks recorded and within budget
- [ ] Scanner works on the Viskod repository itself as a test target

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Framework detection false positives (e.g., next dependency in a non-Next.js project) | Low | Medium | Require multiple evidence sources for high confidence; config file presence is strongest signal |
| Route discovery fails for non-standard project structures | Medium | Low | Route discovery is best-effort; empty RouteMap is valid; diagnostic warns about undetected routes |
| Large monorepos cause scan timeouts | Medium | Medium | Configurable scan timeout; incremental scanning; partial results returned on timeout |
| File system scanning permission errors on Windows | Low | Medium | Graceful handling of EACCES; skip unreadable directories; diagnostic emitted |
| Framework version changes break detection patterns | Low | Low | Detection based on config files and directory conventions, not internal APIs; version changes rarely change these |
