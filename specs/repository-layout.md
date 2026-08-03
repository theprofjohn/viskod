# Repository Layout

> **Specification ID:** SPEC-001
> **Version:** 1.0
> **Status:** Draft
> **Owner:** Viskod Engineering
> **Last Updated:** 2026-07-28

---

## Architecture Sources

- `docs/architecture.md` — §Monorepo Architecture, §Repository Layout, §Package Responsibilities, §Dependency Rules, §Communication Rules
- `docs/packages.md` — package categories, dependency flow, allowed/forbidden dependencies, public API boundaries, build independence
- `docs/ARCHITECTURE_BASELINE.md` — §Canonical Subsystem Names, §Repository Layout, §Runtime Boundaries, §Canonical Dependency Model, §Prohibited Dependencies
- `docs/glossary.md` — canonical terminology for all subsystem names, architecture terms, and naming conventions

---

## Dependencies

None. This is the first specification and imposes no dependency on any other specification.

---

## Consumers

All 34 subsequent specifications depend on this specification for canonical package names, directory locations, naming conventions, and dependency direction rules.

| Specification | Status | Relationship |
|--------------|--------|-------------|
| SPEC-002 through SPEC-035 | Planned | Consume package names, directory paths, dependency rules |

---

## Purpose

This specification defines the monorepo directory structure, package categories, naming conventions, and dependency direction rules for the Viskod Visual Context Platform. It establishes the foundational layout against which all other specifications reference package locations, identify owners, and enforce architectural boundaries.

---

## Scope

- Root-level directory structure (`apps/`, `packages/`, `docs/`, `examples/`, `tests/`, `scripts/`)
- Package directory naming conventions
- Package categories and their responsibilities
- Workspace configuration (`pnpm-workspace.yaml`, root `package.json`)
- Package `package.json` conventions (name format, entry points)
- Public entry point requirements per package
- One-way dependency direction rules between package categories
- Automated enforcement mechanisms for dependency rules

---

## Non-Goals

- Build tooling configuration (TypeScript config, bundler, Vite, esbuild)
- CI/CD pipeline configuration
- Version management strategy for published packages
- Release workflow
- Package publishing to npm registries
- Lint rules for code style (beyond dependency enforcement)
- Testing framework configuration

---

## Terminology

Terms are defined canonically in `docs/glossary.md`. Terms specific to this specification:

| Term | Definition |
|------|-----------|
| Package | A directory under `apps/` or `packages/` containing a `package.json` with a `@viskod/` scoped name |
| Application package | A package under `apps/` providing an executable entry point |
| Platform package | A package under `packages/` implementing a major platform capability |
| Core package | A package under `packages/` providing reusable platform foundations |
| Shared package | A package under `packages/` providing presentation and infrastructure utilities |
| Cross-cutting package | A package whose concerns span multiple layers (e.g., diagnostics) |
| Public entry point | The single `src/index.ts` file through which consumers import a package |
| Internal module | Any file not reachable from the public entry point |
| Reverse dependency | A dependency that points from a lower layer to a higher layer |
| Circular dependency | A dependency chain where package A depends on B and B depends on A, directly or transitively |

---

## Interfaces

### Root Directory Structure

The repository root must contain the following directories and files:

```
viskod/
├── apps/                        # Application packages
├── packages/                    # Platform, Core, and Shared packages
├── docs/                        # Architecture and specification documents
├── examples/                    # Example usage projects
├── tests/                       # Cross-package integration and end-to-end tests
├── scripts/                     # Build, CI, and automation scripts
├── package.json                 # Root workspace package.json
├── pnpm-workspace.yaml          # pnpm workspace configuration
├── .gitignore                   # Git exclusion rules
└── README.md                    # Repository overview
```

### apps/ Directory

Contains application packages. Each application is a self-contained executable entry point.

```
apps/
└── studio/                      # Viskod Studio: the desktop graphical interface
```

Application package directory naming convention: `{name}` (no prefix).

### packages/ Directory

Contains Platform, Core, Shared, and Cross-cutting packages. Package directory naming convention: `{name}` (no prefix; the package.json `name` field encodes the scope, not the directory name).

```
packages/
├── browser-runtime/             # Platform: Browser automation via Playwright
├── cli/                         # Application: CLI entry point (housed under packages/)
├── context-engine/              # Platform: Visual Context Engine
├── capture-pipeline/            # Platform: Capture storage and management
├── project-scanner/             # Platform: Repository analysis and metadata
├── selection-engine/            # Platform: User selection processing
├── source-hint-engine/          # Platform: Probabilistic source identification
├── mcp-server/                  # Platform: MCP protocol exposure
├── shared/                      # Core: Shared types, schemas, utilities, constants
├── config/                      # Core: Configuration management
└── diagnostics/                 # Cross-cutting: Runtime health and error reporting
```

> **Note:** `framework-adapters` (defined in `docs/framework-adapters.md`) is a planned package that does not exist in `packages/` yet.

### Public Entry Points

Every package must expose a single public entry point:

| Package | Entry Point |
|---------|------------|
| `apps/studio` | `apps/studio/src/index.ts` |
| `packages/cli` | `packages/cli/src/index.ts` |
| `packages/browser-runtime` | `packages/browser-runtime/src/index.ts` |
| `packages/context-engine` | `packages/context-engine/src/index.ts` |
| `packages/capture-pipeline` | `packages/capture-pipeline/src/index.ts` |
| `packages/project-scanner` | `packages/project-scanner/src/index.ts` |
| `packages/selection-engine` | `packages/selection-engine/src/index.ts` |
| `packages/source-hint-engine` | `packages/source-hint-engine/src/index.ts` |
| `packages/mcp-server` | `packages/mcp-server/src/index.ts` |
| `packages/shared` | `packages/shared/src/index.ts` |
| `packages/config` | `packages/config/src/index.ts` |
| `packages/diagnostics` | `packages/diagnostics/src/index.ts` |

Consumers must import only from the public entry point. Imports of internal modules (e.g., `@viskod/browser-runtime/src/internal/foo`) are prohibited and must be rejected by automated validation.

### Root package.json

```jsonc
{
  "name": "viskod",
  "version": "0.2.0-alpha",
  "private": true,
  "scripts": {
    "viskod": "tsx packages/cli/src/index.ts",
    "build": "pnpm -r build",
    "test": "vitest run",
    "typecheck": "tsc -b",
    "check": "biome check . && tsc -b && vitest run",
    "lint": "biome check .",
    "format": "biome format --write .",
    "smoke:agent-workflow": "node scripts/smoke-phase18-agent-workflow.mjs",
    "release:check": "biome check . && tsc -b && vitest run && node scripts/smoke-phase18-agent-workflow.mjs"
  },
  "engines": {
    "node": ">=22.0.0",
    "pnpm": ">=9.0.0"
  },
  "packageManager": "pnpm@9.15.0"
}
```

### pnpm-workspace.yaml

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### Package package.json Format

Every package `package.json` must conform to:

```jsonc
{
  "name": "@viskod/{name}",           // @viskod/app-{name} for apps
  "version": "0.0.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build": "...",
    "test": "...",
    "lint": "...",
    "typecheck": "..."
  }
}
```

Naming rules:

- Platform, Core, Shared, and Cross-cutting packages: `@viskod/{name}` where `{name}` matches the directory name (e.g., `@viskod/browser-runtime`)
- Application packages: `@viskod/app-{name}` where `{name}` matches the directory name (e.g., `@viskod/app-studio`)
- The `cli` package lives under `packages/` but uses the `@viskod/cli` name (it is categorized as an application in the dependency model)

Mappings:

| Directory | Package Name |
|-----------|-------------|
| `apps/studio` | `@viskod/app-studio` |
| `packages/browser-runtime` | `@viskod/browser-runtime` |
| `packages/cli` | `@viskod/cli` |
| `packages/context-engine` | `@viskod/context-engine` |
| `packages/capture-pipeline` | `@viskod/capture-pipeline` |
| `packages/project-scanner` | `@viskod/project-scanner` |
| `packages/selection-engine` | `@viskod/selection-engine` |
| `packages/source-hint-engine` | `@viskod/source-hint-engine` |
| `packages/mcp-server` | `@viskod/mcp-server` |
| `packages/shared` | `@viskod/shared` |
| `packages/config` | `@viskod/config` |
| `packages/diagnostics` | `@viskod/diagnostics` |

---

## Data Models

### PackageCategory

```ts
type PackageCategory = 'app' | 'platform' | 'core' | 'shared' | 'cross-cutting';
```

### Package Category Assignment

Each package belongs to exactly one category:

| Package | Category |
|---------|----------|
| `studio` (`@viskod/app-studio`) | `app` |
| `cli` (`@viskod/cli`) | `app` |
| `browser-runtime` (`@viskod/browser-runtime`) | `platform` |
| `context-engine` (`@viskod/context-engine`) | `platform` |
| `capture-pipeline` (`@viskod/capture-pipeline`) | `platform` |
| `project-scanner` (`@viskod/project-scanner`) | `platform` |
| `selection-engine` (`@viskod/selection-engine`) | `platform` |
| `source-hint-engine` (`@viskod/source-hint-engine`) | `platform` |
| `mcp-server` (`@viskod/mcp-server`) | `platform` |
| `shared` (`@viskod/shared`) | `core` |
| `config` (`@viskod/config`) | `core` |
| `diagnostics` (`@viskod/diagnostics`) | `cross-cutting` |

### PackageDescriptor

```ts
interface PackageDescriptor {
  /** @viskod/ scoped name */
  name: string;

  /** Directory path relative to repository root */
  path: string;

  /** Package category */
  category: PackageCategory;

  /** Direct dependencies within the workspace */
  dependencies: string[];
}
```

### WorkspaceConfig

```ts
interface WorkspaceConfig {
  /** Root directory absolute path */
  root: string;

  /** All packages in the workspace */
  packages: PackageDescriptor[];

  /** Dependency adjacency list for validation */
  dependencyGraph: Record<string, string[]>;
}
```

---

## Dependency Rules

### Allowed Dependency Direction

Dependencies must point strictly downward. The allowed direction is:

```
Application  →  Platform  →  Core  →  Shared
```

Concretely:

| From (Category) | May Depend On | Must Not Depend On |
|-----------------|---------------|-------------------|
| `app` | `platform`, `core`, `shared`, `cross-cutting` | Other `app` packages, nothing above |
| `platform` | `core`, `shared`, `cross-cutting`, other `platform` packages | `app` |
| `core` | `shared`, other `core` packages | `app`, `platform` |
| `shared` | Nothing within the workspace | `app`, `platform`, `core`, `cross-cutting` |
| `cross-cutting` | `shared` | `app`, `platform`, `core` |

### Package-to-Package Dependency Matrix

```
                     May be imported by
                    ─────────────────────→
                    app  plat core shrd xcut
              ┌────┬────┬────┬────┬────┬────┐
              │app │  ✗ │  ✗ │  ✗ │  ✗ │  ✗ │
              ├────┼────┼────┼────┼────┼────┤
   Imports    │plat│  ✓ │  ✓ │  ✗ │  ✗ │  ✗ │
     ↓        ├────┼────┼────┼────┼────┼────┤
              │core│  ✓ │  ✓ │  ✓ │  ✗ │  ✗ │
              ├────┼────┼────┼────┼────┼────┤
              │shrd│  ✓ │  ✓ │  ✓ │  ✗ │  ✓ │
              ├────┼────┼────┼────┼────┼────┤
              │xcut│  ✓ │  ✓ │  ✗ │  ✗ │  ✗ │
              └────┴────┴────┴────┴────┴────┘

  ✓ = allowed   ✗ = prohibited
```

### Prohibited Patterns

The following import patterns are violations:

1. **Reverse dependency**: A lower-category package importing from a higher-category package (e.g., `@viskod/shared` importing from `@viskod/context-engine`)
2. **Circular dependency**: Package A depends on B and B depends on A, directly or transitively
3. **Cross-package internal import**: Importing a non-public module from another package (e.g., `import { foo } from '@viskod/browser-runtime/src/internal/bar'`)
4. **Shared importing from anything**: `@viskod/shared` has zero workspace dependencies

---

## Error Behaviour

Automated validation must produce the following error codes on violation:

| Condition | Error Code | Message | Recovery |
|-----------|-----------|---------|----------|
| Lower-category package imports from a higher-category package | `SPEC_VIOLATION/REVERSE_DEPENDENCY` | `Package {importer} (category: {importerCategory}) must not depend on {target} (category: {targetCategory}). Allowed direction: {importerCategory} may depend on {allowedCategories}.` | Move the shared logic to a lower-category package, or redesign the dependency to flow through events or a public contract in a lower layer. |
| Package A depends on B and B transitively depends on A | `SPEC_VIOLATION/CIRCULAR_DEPENDENCY` | `Circular dependency detected: {cycleString}.` | Extract shared logic into a lower-layer package (e.g., `@viskod/shared` or a new Core package), or introduce an interface contract to break the cycle. |
| Consumer imports an internal module from another package | `SPEC_VIOLATION/CROSS_PACKAGE_INTERNAL_IMPORT` | `Package {importer} imports internal module {importPath} from package {target}. Only the public entry point ({target}/src/index.ts) may be imported.` | Re-export the required symbol from the target's public entry point, or reconsider whether the import is architecturally valid. |
| `@viskod/shared` has any workspace dependency | `SPEC_VIOLATION/SHARED_DEPENDENCY` | `Package @viskod/shared must not depend on any workspace package. Found dependency: {dependency}.` | Remove the dependency. Shared packages must be self-contained with no dependency on other Viskod packages. |
| Workspace references an undefined package path | `SPEC_VIOLATION/MISSING_PACKAGE` | `Workspace configuration references {path} but no package.json exists at that location.` | Create the package directory with a valid package.json, or remove the entry from workspace configuration. |
| Package exists at a path not covered by the workspace | `SPEC_VIOLATION/ORPHANED_PACKAGE` | `Package at {path} is not included in pnpm-workspace.yaml.` | Add the package path to workspace configuration, or move the package under `apps/` or `packages/`. |
| Two packages declare the same `@viskod/` name | `SPEC_VIOLATION/DUPLICATE_PACKAGE_NAME` | `Duplicate package name {name} found at {pathA} and {pathB}.` | Rename one package to resolve the collision. |

---

## Security Requirements

### .gitignore

The root `.gitignore` must exclude at minimum:

```gitignore
node_modules/
.env
.env.*
*.log
dist/
.cache/
.turbo/
coverage/
*.tsbuildinfo
.viskod/
```

- `node_modules/` must never be committed
- `.env` and `.env.*` files must never be committed
- Build artefacts (`dist/`, `.cache/`, `.turbo/`, `coverage/`, `*.tsbuildinfo`) must never be committed
- The `.viskod/` runtime storage directory must never be committed

### Trust Boundaries

- The workspace root is the trust boundary for dependency validation
- All `package.json` files within `apps/` and `packages/` are within the trust boundary
- Packages defined in `package.json` `dependencies` fields are the sole source of truth for dependency declarations
- No implicit dependency resolution outside of `pnpm-workspace.yaml` is permitted

---

## Performance Budget

Not applicable. This specification defines static directory structure and naming conventions. Runtime performance measurements are defined in subsystem specifications.

---

## Observability

The package dependency graph must be deterministically generated from workspace configuration:

- Input: `pnpm-workspace.yaml` + all `package.json` files under `apps/` and `packages/`
- Output: A `DependencyGraph` structure with nodes (packages) and directed edges (dependencies)
- The graph must be reproducible; two runs over the same workspace must produce identical output
- Dependency direction (allowed/prohibited) must be derivable from the graph nodes' category assignments

---

## Testing Requirements

### Dependency Validation

An automated check must verify all dependency rules. This check must:

1. Parse `pnpm-workspace.yaml` to discover workspace packages
2. Read each package's `package.json` to extract workspace dependencies
3. Assign each package a category based on its directory and name
4. Validate that every dependency edge respects the allowed direction matrix
5. Detect and report circular dependencies
6. Detect and report imports of internal modules (via ESLint rule or TypeScript path checking)
7. Report violations using the error codes defined in §Error Behaviour
8. Exit with a non-zero code if any violation is found

The check must be runnable as:

```bash
pnpm run check:deps
```

> **Status:** Not yet implemented — no `check:deps` script exists in the root `package.json`; the current quality gate is `pnpm check` (biome + `tsc -b` + vitest), which does not validate the dependency matrix in §Dependency Rules.

---

## Acceptance Criteria

Before this specification can move to Approved:

- [ ] All package directories exist at the paths defined in §Interfaces (`apps/studio/`, `packages/browser-runtime/`, `packages/cli/`, `packages/context-engine/`, `packages/capture-pipeline/`, `packages/project-scanner/`, `packages/selection-engine/`, `packages/source-hint-engine/`, `packages/mcp-server/`, `packages/shared/`, `packages/config/`, `packages/diagnostics/`)
- [ ] Every package has a `package.json` with the correct `@viskod/` scoped name as defined in the mapping table
- [ ] `pnpm-workspace.yaml` exists at the repository root and correctly references `packages/*` and `apps/*`
- [ ] Root `package.json` exists with `private: true` and `engines` specifying node >= 22 and pnpm >= 9
- [ ] No circular dependency exists in the workspace (not currently verified by an automated script)
- [ ] Automated dependency check rejects cross-category reverse imports with the defined error codes (not yet implemented)
- [ ] Every package has a single public entry point at `src/index.ts`
- [ ] The `.gitignore` at the repository root excludes `node_modules/`, `.env`, `.env.*`, `dist/`, `.cache/`, `.turbo/`, `coverage/`, `*.tsbuildinfo`, and `.viskod/`

---

## Open Implementation Decisions

The following decisions are deferred to implementation decision records under `decisions/`:

| Decision | Status | Rationale |
|----------|--------|-----------|
| pnpm version floor (currently `>=9.0.0`, `packageManager: pnpm@9.15.0`) | Open — no decision record filed | Must verify compatibility with all toolchain integrations before locking |
| TypeScript version floor | Resolved in `decisions/DEC-001.md` (5.5+) | Depends on target Node.js version and feature requirements |
| Node.js version floor (currently `>=22.0.0`) | Resolved in `decisions/DEC-001.md` (22 LTS) | Must align with LTS schedule and downstream consumer requirements |
| ESLint dependency rule plugin (exact package, configuration) | Open — no decision record filed | Multiple plugins exist for enforcing dependency boundaries; evaluation needed |
| Whether `cli` should move from `packages/cli` to `apps/cli` | Open — no decision record filed | `cli` is an application entry point housed under `packages/` for historical convenience; future relocation may be warranted |

---

## Risks

- **Dependency drift**: Without automated enforcement, developers may inadvertently introduce reverse dependencies that degrade architecture over time. Mitigation: the `check:deps` script defined in §Testing Requirements, once implemented.
- **Category ambiguity**: The `cross-cutting` category (diagnostics) has relaxed rules compared to other categories, which could be exploited to bypass dependency rules. Mitigation: `cross-cutting` may only depend on `shared`; this is explicitly constrained.
- **Internal import leakage**: TypeScript path aliases or barrel re-exports could mask internal imports. Mitigation: the ESLint rule or build validation must trace actual file paths, not resolved module names.

---

## Implementation Sequence

1. Create all package directories under `apps/` and `packages/`
2. Create root `package.json` and `pnpm-workspace.yaml`
3. Create each package's `package.json` with correct `@viskod/` name and `main`/`exports` pointing to `src/index.ts`
4. Create each package's `src/index.ts` (stub)
5. Create root `.gitignore`
6. Run `pnpm install` to verify workspace resolution
7. Run `pnpm check` to verify the current quality gate
8. Validate acceptance criteria checklist

---

## Definition of Done

- [ ] All package directories created at defined paths
- [ ] All package.json files created with correct `@viskod/` names
- [ ] Root workspace configuration (`package.json`, `pnpm-workspace.yaml`) in place
- [ ] `.gitignore` created with required exclusion patterns
- [ ] `check:deps` script implemented and passing
- [ ] Zero circular dependencies confirmed
- [ ] All acceptance criteria verified
- [ ] All specifications referencing SPEC-001 have been notified of package names and paths
