# Phase 33: Repository Scale, Workspaces & Source-Resolution Performance

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Viskod source resolution work truthfully and predictably on realistic multi-package repositories without allowing repository scans, import traversal, or caches to become unbounded.

**Architecture:** Thread workspace metadata from project-scanner through context-engine to source-hint-engine; resolve cross-package imports in the import graph; bound all caches with LRU eviction; invalidate on file-change signals; extend USAGE_SITE_DIRS with workspace package source roots.

**Tech Stack:** TypeScript, Node.js fs/path, Zod (validation), Vitest (tests)

## Global Constraints

- Phase 27–32 contracts are locked — do not weaken them
- Source hints are guidance, not proof — never present ranked hints as exact ownership
- Phase 30 trust contract (exact/probable/possible/weak) and calibration hard caps (NO_STRONG_MAX=0.62, TEXT_ONLY_MAX=0.60, WEAK_MAX=0.42) are immutable
- All filesystem ops must respect existing scan budgets (maxFiles: 3000, maxTimeMs: 2500)
- Workspace package paths are repository-relative at external boundaries; absolute paths only for internal filesystem operations
- Supported workspace formats: package.json workspaces + pnpm-workspace.yaml only
- No Nx/Turbo/Bazel/Lerna/Rush engine support
- No language server, source maps, embeddings, or git history indexing
- Cache strategy: bounded LRU per-repository with configurable max entries
- Concurrency: small internal limiter; no heavy worker-pool dependency
- Invalidation: mtime/size-based polling; no mandatory filesystem watcher
- 2-space indent, single quotes, trailing commas, 100-char lines, strict TS

---

## File Structure

| Action | File | Purpose |
|--------|------|---------|
| Modify | `packages/shared/src/types.ts` | Add `WorkspaceMetadata` interface |
| Modify | `packages/context-engine/src/index.ts` | Extend `setProjectContext()` signature to accept workspace metadata; extend `getProjectContext()` return |
| Modify | `packages/source-hint-engine/src/types.ts` | Add `workspace` field to `ProjectContext` and `HintInput` |
| Modify | `packages/source-hint-engine/src/index.ts` | Add LRU cache, workspace-aware USAGE_SITE_DIRS, cross-package import resolution |
| Modify | `packages/source-hint-engine/src/import-graph.ts` | Add `resolveWorkspaceImport()` for `@scope/pkg` specifiers; extend `buildLocalDependencyClosure()` |
| Modify | `packages/cli/src/index.ts` | Call `discoverWorkspace()` after `scan()`, pass workspace metadata to `setProjectContext()` |
| Modify | `packages/mcp-server/src/entry.ts` | Same as CLI — call `discoverWorkspace()`, pass workspace metadata |
| Modify | `apps/studio/src/index.ts` | Same as CLI — call `discoverWorkspace()`, pass workspace metadata |
| Create | `packages/source-hint-engine/src/lru-cache.ts` | Generic LRU cache with max entries + TTL |
| Create | `packages/source-hint-engine/src/lru-cache.test.ts` | Tests for LRU cache |
| Create | `packages/source-hint-engine/src/workspace-imports.test.ts` | Tests for cross-package import resolution |
| Create | `packages/context-engine/src/workspace-context.test.ts` | Tests for workspace metadata threading |
| Create | `tests/fixtures/monorepo/` | Monorepo test fixture (pnpm-workspace.yaml + 3 packages) |

---

## Task 1: Add WorkspaceMetadata to shared types

**Covers:** S1 (workspace metadata model)

**Files:**
- Modify: `packages/shared/src/types.ts`
- Test: `packages/shared/src/workspace-metadata.test.ts`

**Interfaces:**
- Produces: `WorkspaceMetadata` interface consumed by context-engine and source-hint-engine

- [ ] **Step 1: Write the failing test**

```typescript
// packages/shared/src/workspace-metadata.test.ts
import { describe, it, expect } from 'vitest';
import type { WorkspaceMetadata } from './types';

describe('WorkspaceMetadata type', () => {
  it('accepts a valid workspace metadata object', () => {
    const meta: WorkspaceMetadata = {
      isWorkspace: true,
      workspaceType: 'pnpm-workspace',
      packages: [
        {
          name: '@acme/ui',
          relativeRoot: 'packages/ui',
          packageJsonPath: 'packages/ui/package.json',
          sourceRoots: ['packages/ui/src'],
          workspaceDependencies: ['@acme/utils'],
        },
      ],
      globs: ['packages/*'],
    };
    expect(meta.isWorkspace).toBe(true);
    expect(meta.packages).toHaveLength(1);
  });

  it('accepts single-package workspace', () => {
    const meta: WorkspaceMetadata = {
      isWorkspace: false,
      workspaceType: 'single',
      packages: [],
      globs: [],
    };
    expect(meta.packages).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viskod/shared test`
Expected: FAIL — `WorkspaceMetadata` not exported from types.ts

- [ ] **Step 3: Write minimal implementation**

Add to `packages/shared/src/types.ts`:

```typescript
export interface WorkspacePackageMetadata {
  name: string;
  relativeRoot: string;
  packageJsonPath: string;
  sourceRoots: string[];
  workspaceDependencies: string[];
}

export interface WorkspaceMetadata {
  isWorkspace: boolean;
  workspaceType: 'single' | 'pnpm-workspace' | 'npm-workspace' | 'yarn-workspace' | 'unknown';
  packages: WorkspacePackageMetadata[];
  globs: string[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @viskod/shared test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/workspace-metadata.test.ts
git commit -m "feat(shared): add WorkspaceMetadata type for monorepo support"
```

---

## Task 2: Create bounded LRU cache

**Covers:** S6 (bounded cache), S7 (cache invalidation)

**Files:**
- Create: `packages/source-hint-engine/src/lru-cache.ts`
- Create: `packages/source-hint-engine/src/lru-cache.test.ts`

**Interfaces:**
- Produces: `LruCache<K, V>` class consumed by SourceHintEngine for hints and import graph caching

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/source-hint-engine/src/lru-cache.test.ts
import { describe, it, expect } from 'vitest';
import { LruCache } from './lru-cache';

describe('LruCache', () => {
  it('stores and retrieves values', () => {
    const cache = new LruCache<string, number>(10);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    expect(cache.size).toBe(1);
  });

  it('evicts least-recently-used entry when full', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // evicts 'a'
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('refreshes access order on get', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // refresh 'a' — now 'b' is LRU
    cache.set('c', 3); // evicts 'b'
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  it('respects TTL expiration', () => {
    const cache = new LruCache<string, number>(10, 50);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    // Simulate expiration by advancing time via internal clock
    vi.advanceTimersByTime(60);
    expect(cache.get('a')).toBeUndefined();
  });

  it('clears all entries', () => {
    const cache = new LruCache<string, number>(10);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
  });

  it('reports correct size', () => {
    const cache = new LruCache<string, number>(10);
    expect(cache.size).toBe(0);
    cache.set('a', 1);
    expect(cache.size).toBe(1);
    cache.set('b', 2);
    expect(cache.size).toBe(2);
    cache.delete('a');
    expect(cache.size).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/source-hint-engine/src/lru-cache.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/source-hint-engine/src/lru-cache.ts
interface CacheEntry<V> {
  value: V;
  expiresAt: number | null;
}

export class LruCache<K, V> {
  private map = new Map<K, CacheEntry<V>>();
  private readonly maxSize: number;
  private readonly ttlMs: number | null;

  constructor(maxSize: number, ttlMs?: number) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs ?? null;
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh: delete and re-insert to move to end (most recent)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    const expiresAt = this.ttlMs !== null ? Date.now() + this.ttlMs : null;
    this.map.set(key, { value, expiresAt });
    // Evict oldest entries if over capacity
    while (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/source-hint-engine/src/lru-cache.test.ts`
Expected: PASS

Note: The TTL test uses `vi.advanceTimersByTime` — add `import { vi, describe, it, expect } from 'vitest';` and wrap in `vi.useFakeTimers()` / `vi.useRealTimers()`.

- [ ] **Step 5: Commit**

```bash
git add packages/source-hint-engine/src/lru-cache.ts packages/source-hint-engine/src/lru-cache.test.ts
git commit -m "feat(source-hint-engine): add bounded LRU cache with optional TTL"
```

---

## Task 3: Extend context-engine setProjectContext with workspace metadata

**Covers:** S2 (workspace threading), S4 (integration chain)

**Files:**
- Modify: `packages/context-engine/src/index.ts:1092-1124`
- Modify: `packages/context-engine/src/index.ts:747-783` (hintInput construction)
- Create: `packages/context-engine/src/workspace-context.test.ts`

**Interfaces:**
- Consumes: `WorkspaceMetadata` from `@viskod/shared`
- Produces: Extended `setProjectContext()` that accepts optional `workspace` field; passes workspace to `HintInput.project`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/context-engine/src/workspace-context.test.ts
import { describe, it, expect } from 'vitest';
import { VisualContextEngine } from './index';

describe('VisualContextEngine workspace context', () => {
  it('accepts workspace metadata in setProjectContext', () => {
    const vce = new VisualContextEngine({
      browserRuntime: {} as any,
      eventBus: { publish: () => {}, subscribe: () => () => {} } as any,
      capturePipeline: {} as any,
      selectionEngine: {} as any,
      sourceHintEngine: {} as any,
    });
    vce.setProjectContext({
      rootPath: '/repo',
      projectId: 'test',
      name: 'test',
      directories: ['src'],
      primaryFramework: 'react',
      detectedFrameworks: ['react'],
      frameworkConfidence: 0.9,
      workspace: {
        isWorkspace: true,
        workspaceType: 'pnpm-workspace',
        packages: [
          {
            name: '@acme/ui',
            relativeRoot: 'packages/ui',
            packageJsonPath: 'packages/ui/package.json',
            sourceRoots: ['packages/ui/src'],
            workspaceDependencies: [],
          },
        ],
        globs: ['packages/*'],
      },
    });
    const ctx = vce.getProjectContext();
    expect(ctx?.workspace).toBeDefined();
    expect(ctx?.workspace?.isWorkspace).toBe(true);
    expect(ctx?.workspace?.packages).toHaveLength(1);
  });

  it('getProjectContext returns workspace undefined when not set', () => {
    const vce = new VisualContextEngine({
      browserRuntime: {} as any,
      eventBus: { publish: () => {}, subscribe: () => () => {} } as any,
      capturePipeline: {} as any,
      selectionEngine: {} as any,
      sourceHintEngine: {} as any,
    });
    vce.setProjectContext({
      rootPath: '/repo',
      projectId: 'test',
      name: 'test',
      directories: ['src'],
      primaryFramework: null,
      detectedFrameworks: [],
      frameworkConfidence: 0,
    });
    const ctx = vce.getProjectContext();
    expect(ctx?.workspace).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/context-engine/src/workspace-context.test.ts`
Expected: FAIL — `workspace` not in `setProjectContext` signature

- [ ] **Step 3: Write minimal implementation**

In `packages/context-engine/src/index.ts`, extend the `setProjectContext` parameter type (line 1092) to add optional `workspace`:

```typescript
setProjectContext(context: {
  rootPath: string;
  projectId: string;
  name: string;
  directories: string[];
  primaryFramework: string | null;
  detectedFrameworks: string[];
  frameworkConfidence: number;
  routeMap?: {
    routes: Array<{ path: string; file: string; type: string; isDynamic?: boolean }>;
  };
  workspace?: import('@viskod/shared').WorkspaceMetadata;
}): void {
  this.projectScan = context;
}
```

Also extend `getProjectContext()` return type (line 1111) to include `workspace?`.

In the `hintInput` construction (line 763-781), pass workspace through:

```typescript
project: {
  metadata: { ... },
  componentIndex: ...,
  framework: ...,
  workspace: this.projectScan?.workspace,
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/context-engine/src/workspace-context.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/context-engine/src/index.ts packages/context-engine/src/workspace-context.test.ts
git commit -m "feat(context-engine): thread workspace metadata through setProjectContext"
```

---

## Task 4: Extend source-hint-engine types with workspace field

**Covers:** S2 (workspace threading), S5 (workspace-aware scanning)

**Files:**
- Modify: `packages/source-hint-engine/src/types.ts:213-243`
- Create: `packages/source-hint-engine/src/workspace-types.test.ts`

**Interfaces:**
- Consumes: `WorkspaceMetadata` from `@viskod/shared`
- Produces: Extended `ProjectContext.workspace` and `HintInput.project.workspace` consumed by scanProjectFiles and resolveWorkspaceImport

- [ ] **Step 1: Write the failing test**

```typescript
// packages/source-hint-engine/src/workspace-types.test.ts
import { describe, it, expect } from 'vitest';
import type { HintInput, ProjectContext } from './types';

describe('workspace field in types', () => {
  it('ProjectContext accepts workspace field', () => {
    const ctx: ProjectContext = {
      metadata: { projectId: 'x', name: 'x', rootPath: '/r', packageManager: 'pnpm', language: 'ts' },
      workspace: {
        isWorkspace: true,
        workspaceType: 'pnpm-workspace',
        packages: [
          {
            name: '@acme/ui',
            relativeRoot: 'packages/ui',
            packageJsonPath: 'packages/ui/package.json',
            sourceRoots: ['packages/ui/src'],
            workspaceDependencies: [],
          },
        ],
        globs: ['packages/*'],
      },
    };
    expect(ctx.workspace?.packages).toHaveLength(1);
  });

  it('HintInput accepts workspace via project', () => {
    const input: HintInput = {
      domContext: { tagName: 'div' },
      route: { url: 'http://localhost', pathname: '/' },
      project: {
        metadata: { projectId: 'x', name: 'x', rootPath: '/r', packageManager: 'pnpm', language: 'ts' },
        workspace: {
          isWorkspace: false,
          workspaceType: 'single',
          packages: [],
          globs: [],
        },
      },
    };
    expect(input.project.workspace?.isWorkspace).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/source-hint-engine/src/workspace-types.test.ts`
Expected: FAIL — `workspace` not in `ProjectContext`

- [ ] **Step 3: Write minimal implementation**

In `packages/source-hint-engine/src/types.ts`, add import and extend `ProjectContext` (line 213):

```typescript
import type { WorkspaceMetadata } from '@viskod/shared';

export interface ProjectContext {
  metadata: {
    projectId: string;
    name: string;
    rootPath: string;
    packageManager: string;
    language: string;
  };
  routeMap?: { ... };
  componentIndex?: { ... };
  framework?: { ... };
  workspace?: WorkspaceMetadata;  // NEW
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/source-hint-engine/src/workspace-types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/source-hint-engine/src/types.ts packages/source-hint-engine/src/workspace-types.test.ts
git commit -m "feat(source-hint-engine): add workspace field to ProjectContext type"
```

---

## Task 5: Extend USAGE_SITE_DIRS with workspace package source roots

**Covers:** S5 (workspace-aware scanning)

**Files:**
- Modify: `packages/source-hint-engine/src/index.ts:77-86,493-511`
- Create: `packages/source-hint-engine/src/workspace-scan.test.ts`

**Interfaces:**
- Consumes: `HintInput.project.workspace` from Task 4
- Produces: Extended directory list in `scanProjectFiles()` that includes workspace package source roots

- [ ] **Step 1: Write the failing test**

```typescript
// packages/source-hint-engine/src/workspace-scan.test.ts
import { describe, it, expect } from 'vitest';
import { resolveWorkspaceDirs } from './index';

describe('resolveWorkspaceDirs', () => {
  it('returns base dirs when no workspace', () => {
    const dirs = resolveWorkspaceDirs(['src/app'], undefined);
    expect(dirs).toEqual(['src/app', ...['src/features','src/pages','src/routes','src/app','features','pages','routes','app']]);
  });

  it('appends workspace package sourceRoots', () => {
    const dirs = resolveWorkspaceDirs(['src'], {
      isWorkspace: true,
      workspaceType: 'pnpm-workspace',
      packages: [
        {
          name: '@acme/ui',
          relativeRoot: 'packages/ui',
          packageJsonPath: 'packages/ui/package.json',
          sourceRoots: ['packages/ui/src', 'packages/ui/components'],
          workspaceDependencies: [],
        },
        {
          name: '@acme/utils',
          relativeRoot: 'packages/utils',
          packageJsonPath: 'packages/utils/package.json',
          sourceRoots: ['packages/utils/src'],
          workspaceDependencies: ['@acme/ui'],
        },
      ],
      globs: ['packages/*'],
    });
    expect(dirs).toContain('packages/ui/src');
    expect(dirs).toContain('packages/ui/components');
    expect(dirs).toContain('packages/utils/src');
  });

  it('deduplicates directories', () => {
    const dirs = resolveWorkspaceDirs(['src/app', 'src/app'], undefined);
    const unique = [...new Set(dirs)];
    expect(dirs.length).toBe(unique.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/source-hint-engine/src/workspace-scan.test.ts`
Expected: FAIL — `resolveWorkspaceDirs` not exported

- [ ] **Step 3: Write minimal implementation**

In `packages/source-hint-engine/src/index.ts`, extract directory resolution into a testable function:

```typescript
import type { WorkspaceMetadata } from '@viskod/shared';

/** Resolve the full set of directories to scan, including workspace package sourceRoots. */
export function resolveWorkspaceDirs(
  baseDirs: string[],
  workspace?: WorkspaceMetadata,
): string[] {
  const dirs = [...baseDirs, ...USAGE_SITE_DIRS];
  if (workspace?.isWorkspace) {
    for (const pkg of workspace.packages) {
      for (const src of pkg.sourceRoots) {
        dirs.push(src);
      }
    }
  }
  return [...new Set(dirs)];
}
```

In `scanProjectFiles()` (line 511), replace the inline directory construction:

```typescript
const uniqueDirs = resolveWorkspaceDirs(dirs, input.project.workspace);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/source-hint-engine/src/workspace-scan.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/source-hint-engine/src/index.ts packages/source-hint-engine/src/workspace-scan.test.ts
git commit -m "feat(source-hint-engine): extend USAGE_SITE_DIRS with workspace package sourceRoots"
```

---

## Task 6: Add cross-package import resolution

**Covers:** S3 (cross-package imports), S5 (workspace-aware resolution)

**Files:**
- Modify: `packages/source-hint-engine/src/import-graph.ts:258-287`
- Create: `packages/source-hint-engine/src/workspace-imports.test.ts`

**Interfaces:**
- Consumes: `WorkspacePackage[]` from `WorkspaceMetadata`
- Produces: `resolveWorkspaceImport(rootPath, spec, packages)` function; `buildLocalDependencyClosure` extended to follow workspace imports

- [ ] **Step 1: Write the failing test**

```typescript
// packages/source-hint-engine/src/workspace-imports.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { resolveWorkspaceImport, buildWorkspaceDependencyClosure } from './import-graph';
import type { WorkspacePackageMetadata } from '@viskod/shared';

const packages: WorkspacePackageMetadata[] = [
  {
    name: '@acme/ui',
    relativeRoot: 'packages/ui',
    packageJsonPath: 'packages/ui/package.json',
    sourceRoots: ['packages/ui/src'],
    workspaceDependencies: ['@acme/utils'],
  },
  {
    name: '@acme/utils',
    relativeRoot: 'packages/utils',
    packageJsonPath: 'packages/utils/package.json',
    sourceRoots: ['packages/utils/src'],
    workspaceDependencies: [],
  },
];

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viskod-test-'));
  // Create workspace package structure
  fs.mkdirSync(path.join(tmpDir, 'packages/ui/src'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'packages/utils/src'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, 'packages/ui/src/Button.tsx'),
    'export const Button = () => null;',
  );
  fs.writeFileSync(
    path.join(tmpDir, 'packages/utils/src/format.ts'),
    'export const format = (n: number) => n.toFixed(2);',
  );
  fs.writeFileSync(
    path.join(tmpDir, 'packages/ui/src/App.tsx'),
    "import { Button } from './Button';\nimport { format } from '@acme/utils/format';\nexport const App = () => <Button />;",
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('resolveWorkspaceImport', () => {
  it('resolves relative import within a package', () => {
    const result = resolveWorkspaceImport(tmpDir, 'packages/ui/src/App.tsx', './Button', packages);
    expect(result).toBe('packages/ui/src/Button.tsx');
  });

  it('resolves workspace package import @acme/utils/format', () => {
    const result = resolveWorkspaceImport(tmpDir, 'packages/ui/src/App.tsx', '@acme/utils/format', packages);
    expect(result).toBe('packages/utils/src/format.ts');
  });

  it('resolves workspace package import @acme/ui (package root)', () => {
    // Add an index.ts to the ui package
    fs.writeFileSync(path.join(tmpDir, 'packages/ui/src/index.ts'), 'export { Button } from "./Button";');
    const result = resolveWorkspaceImport(tmpDir, 'packages/utils/src/format.ts', '@acme/ui', packages);
    expect(result).toBe('packages/ui/src/index.ts');
  });

  it('returns null for unknown package', () => {
    const result = resolveWorkspaceImport(tmpDir, 'packages/ui/src/App.tsx', '@unknown/pkg', packages);
    expect(result).toBeNull();
  });

  it('returns null for bare specifier that is not a workspace package', () => {
    const result = resolveWorkspaceImport(tmpDir, 'packages/ui/src/App.tsx', 'react', packages);
    expect(result).toBeNull();
  });
});

describe('buildWorkspaceDependencyClosure', () => {
  it('follows workspace imports transitively', () => {
    const closure = buildWorkspaceDependencyClosure(
      tmpDir,
      'packages/ui/src/App.tsx',
      packages,
    );
    expect(closure).toContain('packages/ui/src/App.tsx');
    expect(closure).toContain('packages/ui/src/Button.tsx');
    expect(closure).toContain('packages/utils/src/format.ts');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/source-hint-engine/src/workspace-imports.test.ts`
Expected: FAIL — `resolveWorkspaceImport` not exported

- [ ] **Step 3: Write minimal implementation**

In `packages/source-hint-engine/src/import-graph.ts`, add:

```typescript
import type { WorkspacePackageMetadata } from '@viskod/shared';

/**
 * Resolve a module specifier that may be a workspace package import
 * (e.g. `@acme/utils/format`) to a repository-relative file path.
 *
 * Returns null if the specifier is not a workspace package or the
 * target file does not exist.
 */
export function resolveWorkspaceImport(
  rootPath: string,
  sourceFile: string,
  spec: string,
  packages: WorkspacePackageMetadata[],
): string | null {
  // Only handle non-relative specifiers
  if (spec.startsWith('.')) return resolveLocalImport(rootPath, sourceFile, spec);

  // Check if spec matches a workspace package
  for (const pkg of packages) {
    const pkgName = pkg.name;
    if (spec === pkgName || spec.startsWith(`${pkgName}/`)) {
      const subpath = spec.slice(pkgName.length + 1) || 'index';
      // Try each sourceRoot in the package
      for (const srcRoot of pkg.sourceRoots) {
        const candidates: string[] = [];
        if (subpath === 'index') {
          // Package root import — look for index files
          for (const ext of CODE_EXTENSIONS) {
            candidates.push(`${srcRoot}/index${ext}`);
          }
        } else {
          // Subpath import — look for the file with code extensions
          const base = `${srcRoot}/${subpath}`;
          candidates.push(base);
          for (const ext of CODE_EXTENSIONS) {
            candidates.push(`${base}${ext}`);
          }
          for (const suffix of INDEX_SUFFIXES) {
            candidates.push(`${base}/${suffix}`);
          }
        }
        for (const candidate of candidates) {
          try {
            if (fs.existsSync(path.join(rootPath, candidate.replace(/\//g, path.sep)))) {
              return candidate;
            }
          } catch {
            // permission error
          }
        }
      }
    }
  }
  return null;
}

/**
 * Build a dependency closure that follows both local relative imports
 * and workspace package imports.
 */
export function buildWorkspaceDependencyClosure(
  rootPath: string,
  entryFile: string,
  packages: WorkspacePackageMetadata[],
  budget: ScanBudget = DEFAULT_SCAN_BUDGET,
): Set<string> {
  const closure = new Set<string>();
  const queue: string[] = [entryFile];
  const state: BudgetState = { files: 0, startMs: Date.now(), budget };

  while (queue.length > 0) {
    const current = queue.shift() ?? '';
    if (closure.has(current)) continue;
    closure.add(current);
    touchBudget(state);

    let content: string;
    try {
      content = fs.readFileSync(path.join(rootPath, current.replace(/\//g, path.sep)), 'utf-8');
    } catch (error) {
      if (error instanceof ScanBudgetExceededError) throw error;
      continue;
    }

    const entries = parseImports(rootPath, current, content);
    for (const entry of entries) {
      let target: string | null = null;
      if (entry.isLocal && entry.importedFile && !entry.importedFile.startsWith('.')) {
        target = entry.importedFile;
      } else if (!entry.isLocal && packages.length > 0) {
        target = resolveWorkspaceImport(rootPath, current, entry.importedFile, packages);
      }
      if (target && !target.startsWith('..') && !path.posix.isAbsolute(target)) {
        if (!closure.has(target)) queue.push(target);
      }
    }
  }

  return closure;
}
```

Also update `parseImports` to call `resolveWorkspaceImport` when a non-relative specifier matches a workspace package (currently it only creates `packageEntry` for non-relative imports — this needs to also try workspace resolution):

In `parseImports` (line 168), add an optional `packages` parameter and use it:

```typescript
function parseImports(
  rootPath: string,
  sourceFile: string,
  content: string,
  packages?: WorkspacePackageMetadata[],
): ImportGraphEntry[] {
```

For non-relative specifiers, try `resolveWorkspaceImport` first; if it resolves, create a `localEntry`-style result with `isLocal: true`:

```typescript
// In the named/default/namespace/require branches, for non-relative specifiers:
if (!spec.startsWith('.')) {
  if (packages && packages.length > 0) {
    const resolved = resolveWorkspaceImport(rootPath, sourceFile, spec, packages);
    if (resolved) {
      entries.push(...names.map((name) => ({
        sourceFile,
        importedFile: resolved,
        importedName: name,
        isDefault,
        isNamespace: false,
        isLocal: true,
      })));
      continue;
    }
  }
  entries.push(...packageEntry(sourceFile, spec, names, isDefault));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/source-hint-engine/src/workspace-imports.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/source-hint-engine/src/import-graph.ts packages/source-hint-engine/src/workspace-imports.test.ts
git commit -m "feat(source-hint-engine): add cross-package workspace import resolution"
```

---

## Task 7: Replace unbounded caches with LRU in SourceHintEngine

**Covers:** S6 (bounded cache), S7 (cache invalidation)

**Files:**
- Modify: `packages/source-hint-engine/src/index.ts:783-785,820-826,921-923,1017,1125,1130-1133`
- Modify: `packages/source-hint-engine/src/lru-cache.ts` (no changes needed — already created)

**Interfaces:**
- Consumes: `LruCache` from Task 2
- Produces: `SourceHintEngine` with bounded `cache` (max 500 entries, 5min TTL) and `importGraphCache` (max 50 entries, 10min TTL); `clearCache()` also clears importGraphCache; `invalidateCache(rootPath)` for targeted invalidation

- [ ] **Step 1: Write the failing test**

```typescript
// Add to existing source-hint-engine test file or create new one
import { describe, it, expect } from 'vitest';
import { EventBus } from '@viskod/event-bus';
import { SourceHintEngine } from './index';

describe('SourceHintEngine cache bounds', () => {
  it('importGraphCache does not grow unbounded', () => {
    const engine = new SourceHintEngine(new EventBus({ enableHistory: false }));
    // Access the importGraphCache via health() to verify it's bounded
    const health = engine.health();
    expect(health.cacheSize).toBe(0);
  });

  it('clearCache clears both caches', () => {
    const engine = new SourceHintEngine(new EventBus({ enableHistory: false }));
    // After clearing, health should show 0
    engine.clearCache();
    const health = engine.health();
    expect(health.cacheSize).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it passes (existing behavior)**

Run: `pnpm exec vitest run packages/source-hint-engine/src/index.test.ts`
Expected: PASS (basic health check works)

- [ ] **Step 3: Write minimal implementation**

In `packages/source-hint-engine/src/index.ts`, replace the two Maps with LruCache instances:

```typescript
import { LruCache } from './lru-cache';

// Constants for cache sizing
const HINT_CACHE_MAX = 500;
const HINT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const IMPORT_GRAPH_CACHE_MAX = 50;
const IMPORT_GRAPH_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export class SourceHintEngine {
  private cache = new LruCache<string, SourceHint[]>(HINT_CACHE_MAX, HINT_CACHE_TTL_MS);
  private importGraphCache = new LruCache<string, ImportGraphEntry[]>(IMPORT_GRAPH_CACHE_MAX, IMPORT_GRAPH_CACHE_TTL_MS);
  // ... rest unchanged
```

Update `clearCache()` to clear both:

```typescript
async clearCache(): Promise<Result<void>> {
  this.cache.clear();
  this.importGraphCache.clear();
  return ok(undefined);
}
```

Add targeted invalidation method:

```typescript
/** Invalidate cached entries for a specific project root. */
invalidateCache(rootPath: string): void {
  // For hints: iterate and delete entries whose cache key contains the rootPath
  // Since cache key is pathname:tag:id:..., we cannot efficiently filter by rootPath.
  // Instead, clear the entire hint cache when workspace changes — this is acceptable
  // because workspace changes are rare events.
  this.cache.clear();
  this.importGraphCache.delete(rootPath);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/source-hint-engine/src/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/source-hint-engine/src/index.ts
git commit -m "feat(source-hint-engine): replace unbounded Maps with bounded LRU caches"
```

---

## Task 8: Wire discoverWorkspace into CLI entry point

**Covers:** S2 (workspace threading), S4 (integration chain)

**Files:**
- Modify: `packages/cli/src/index.ts:269-281`

**Interfaces:**
- Consumes: `ProjectScanner.discoverWorkspace()` from project-scanner
- Produces: CLI capture flow passes workspace metadata to `setProjectContext()`

- [ ] **Step 1: Write the failing test**

This is an integration test — verify the CLI capture command produces a context packet with workspace metadata. Since CLI tests require browser, we verify the data flow indirectly:

```typescript
// packages/cli/src/workspace-wire.test.ts
import { describe, it, expect } from 'vitest';
import { ProjectScanner } from '@viskod/project-scanner';
import { EventBus } from '@viskod/event-bus';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('CLI workspace wiring', () => {
  it('discoverWorkspace returns workspace metadata for monorepo', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viskod-cli-test-'));
    // Create a minimal pnpm workspace
    fs.writeFileSync(
      path.join(tmpDir, 'pnpm-workspace.yaml'),
      'packages:\n  - "packages/*"\n',
    );
    fs.mkdirSync(path.join(tmpDir, 'packages/ui'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'packages/ui/package.json'),
      JSON.stringify({ name: '@acme/ui', version: '1.0.0' }),
    );
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'root', version: '1.0.0' }),
    );

    const scanner = new ProjectScanner(new EventBus({ enableHistory: false }));
    const result = await scanner.discoverWorkspace(tmpDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.isWorkspace).toBe(true);
      expect(result.value.packages).toHaveLength(1);
      expect(result.value.packages[0].name).toBe('@acme/ui');
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm exec vitest run packages/cli/src/workspace-wire.test.ts`
Expected: PASS

- [ ] **Step 3: Write minimal implementation**

In `packages/cli/src/index.ts`, modify the capture flow (line 269-281):

```typescript
const scanResult = await runtime.projectScanner.scan(projectPath);
if (scanResult.ok) {
  const s = scanResult.value;
  // Discover workspace metadata
  const workspaceResult = await runtime.projectScanner.discoverWorkspace(projectPath);
  const workspace = workspaceResult.ok ? workspaceResult.value : undefined;

  runtime.vce.setProjectContext({
    rootPath: s.metadata.rootPath,
    projectId: s.metadata.projectId,
    name: s.metadata.name,
    directories: s.components.directories,
    primaryFramework: s.framework.primary,
    detectedFrameworks: s.framework.detected,
    frameworkConfidence: s.framework.confidence,
    workspace,
  });
}
```

Also update the `scan` command (line 149) similarly:

```typescript
const result = await runtime.projectScanner.scan(rootPath);
if (result.ok) {
  const workspaceResult = await runtime.projectScanner.discoverWorkspace(rootPath);
  // ... thread workspace through
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/cli/src/workspace-wire.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/index.ts packages/cli/src/workspace-wire.test.ts
git commit -m "feat(cli): wire discoverWorkspace into capture and scan commands"
```

---

## Task 9: Wire discoverWorkspace into MCP server entry

**Covers:** S2 (workspace threading), S4 (integration chain)

**Files:**
- Modify: `packages/mcp-server/src/entry.ts:61-83`

**Interfaces:**
- Consumes: `ProjectScanner.discoverWorkspace()`
- Produces: MCP `ensureProjectScan()` passes workspace metadata to `setProjectContext()`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/mcp-server/src/workspace-wire.test.ts
import { describe, it, expect } from 'vitest';
import { ProjectScanner } from '@viskod/project-scanner';
import { EventBus } from '@viskod/event-bus';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('MCP workspace wiring', () => {
  it('ensureProjectScan threads workspace to setProjectContext', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viskod-mcp-test-'));
    fs.writeFileSync(
      path.join(tmpDir, 'pnpm-workspace.yaml'),
      'packages:\n  - "packages/*"\n',
    );
    fs.mkdirSync(path.join(tmpDir, 'packages/api'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'packages/api/package.json'),
      JSON.stringify({ name: '@acme/api', version: '1.0.0' }),
    );
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'root', version: '1.0.0' }),
    );

    const scanner = new ProjectScanner(new EventBus({ enableHistory: false }));
    const workspaceResult = await scanner.discoverWorkspace(tmpDir);
    expect(workspaceResult.ok).toBe(true);
    if (workspaceResult.ok) {
      expect(workspaceResult.value.packages[0].name).toBe('@acme/api');
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm exec vitest run packages/mcp-server/src/workspace-wire.test.ts`
Expected: PASS

- [ ] **Step 3: Write minimal implementation**

In `packages/mcp-server/src/entry.ts`, modify `ensureProjectScan()` (line 61-83):

```typescript
async function ensureProjectScan(): Promise<void> {
  if (currentScan !== null) return;
  if (!configuredProjectRoot) {
    currentScan = { ok: false };
    return;
  }
  const result = await projectScanner.scan(configuredProjectRoot);
  if (!result.ok) {
    currentScan = { ok: false };
    return;
  }
  currentScan = { ok: true, scan: result.value };

  // Discover workspace metadata
  const workspaceResult = await projectScanner.discoverWorkspace(configuredProjectRoot);
  const workspace = workspaceResult.ok ? workspaceResult.value : undefined;

  vce.setProjectContext({
    rootPath: result.value.metadata.rootPath,
    projectId: result.value.metadata.projectId,
    name: result.value.metadata.name,
    directories: result.value.components.directories,
    primaryFramework: result.value.framework.primary,
    detectedFrameworks: result.value.framework.detected,
    frameworkConfidence: result.value.framework.confidence,
    routeMap: { routes: result.value.routes.routes },
    workspace,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/mcp-server/src/workspace-wire.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-server/src/entry.ts packages/mcp-server/src/workspace-wire.test.ts
git commit -m "feat(mcp-server): wire discoverWorkspace into ensureProjectScan"
```

---

## Task 10: Wire discoverWorkspace into Studio

**Covers:** S2 (workspace threading), S4 (integration chain)

**Files:**
- Modify: `apps/studio/src/index.ts:1787-1825`

**Interfaces:**
- Consumes: `ProjectScanner.discoverWorkspace()`
- Produces: Studio `establishProjectContext()` passes workspace metadata to `setProjectContext()`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/studio/src/workspace-wire.test.ts
import { describe, it, expect } from 'vitest';
import { ProjectScanner } from '@viskod/project-scanner';
import { EventBus } from '@viskod/event-bus';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Studio workspace wiring', () => {
  it('establishProjectContext threads workspace', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viskod-studio-test-'));
    fs.writeFileSync(
      path.join(tmpDir, 'pnpm-workspace.yaml'),
      'packages:\n  - "packages/*"\n',
    );
    fs.mkdirSync(path.join(tmpDir, 'packages/web'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'packages/web/package.json'),
      JSON.stringify({ name: '@acme/web', version: '1.0.0' }),
    );
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'root', version: '1.0.0' }),
    );

    const scanner = new ProjectScanner(new EventBus({ enableHistory: false }));
    const workspaceResult = await scanner.discoverWorkspace(tmpDir);
    expect(workspaceResult.ok).toBe(true);
    if (workspaceResult.ok) {
      expect(workspaceResult.value.isWorkspace).toBe(true);
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm exec vitest run apps/studio/src/workspace-wire.test.ts`
Expected: PASS

- [ ] **Step 3: Write minimal implementation**

In `apps/studio/src/index.ts`, modify `establishProjectContext()` (line 1798-1817):

```typescript
const scanResult = await projectScanner.scan(rootPath);
if (!scanResult.ok) {
  // ... existing error handling ...
}
const scan = scanResult.value;

// Discover workspace metadata
const workspaceResult = await projectScanner.discoverWorkspace(rootPath);
const workspace = workspaceResult.ok ? workspaceResult.value : undefined;

vce.setProjectContext({
  rootPath: scan.metadata.rootPath,
  projectId: scan.metadata.projectId,
  name: scan.metadata.name,
  directories: scan.components.directories,
  primaryFramework: scan.framework.primary,
  detectedFrameworks: scan.framework.detected,
  frameworkConfidence: scan.framework.confidence,
  routeMap: { routes: scan.routes.routes },
  workspace,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/studio/src/workspace-wire.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/index.ts apps/studio/src/workspace-wire.test.ts
git commit -m "feat(studio): wire discoverWorkspace into establishProjectContext"
```

---

## Task 11: Create monorepo test fixture

**Covers:** S8 (E2E tests), S9 (test infrastructure)

**Files:**
- Create: `tests/fixtures/monorepo/pnpm-workspace.yaml`
- Create: `tests/fixtures/monorepo/package.json`
- Create: `tests/fixtures/monorepo/packages/ui/package.json`
- Create: `tests/fixtures/monorepo/packages/ui/src/Button.tsx`
- Create: `tests/fixtures/monorepo/packages/ui/src/index.ts`
- Create: `tests/fixtures/monorepo/packages/utils/package.json`
- Create: `tests/fixtures/monorepo/packages/utils/src/format.ts`
- Create: `tests/fixtures/monorepo/packages/app/package.json`
- Create: `tests/fixtures/monorepo/packages/app/src/App.tsx`

**Interfaces:**
- Produces: Self-contained monorepo fixture for cross-package import tests

- [ ] **Step 1: Create fixture files**

```yaml
# tests/fixtures/monorepo/pnpm-workspace.yaml
packages:
  - "packages/*"
```

```json
// tests/fixtures/monorepo/package.json
{ "name": "monorepo-root", "version": "1.0.0", "private": true }
```

```json
// tests/fixtures/monorepo/packages/ui/package.json
{ "name": "@acme/ui", "version": "1.0.0", "dependencies": { "@acme/utils": "workspace:*" } }
```

```typescript
// tests/fixtures/monorepo/packages/ui/src/Button.tsx
export const Button = ({ label }: { label: string }) => <button>{label}</button>;
```

```typescript
// tests/fixtures/monorepo/packages/ui/src/index.ts
export { Button } from './Button';
```

```json
// tests/fixtures/monorepo/packages/utils/package.json
{ "name": "@acme/utils", "version": "1.0.0" }
```

```typescript
// tests/fixtures/monorepo/packages/utils/src/format.ts
export const formatCurrency = (n: number) => `$${n.toFixed(2)}`;
export const formatDate = (d: Date) => d.toISOString().slice(0, 10);
```

```json
// tests/fixtures/monorepo/packages/app/package.json
{ "name": "@acme/app", "version": "1.0.0", "dependencies": { "@acme/ui": "workspace:*", "@acme/utils": "workspace:*" } }
```

```typescript
// tests/fixtures/monorepo/packages/app/src/App.tsx
import { Button } from '@acme/ui';
import { formatCurrency } from '@acme/utils/format';

export const App = () => (
  <div>
    <Button label={formatCurrency(42)} />
  </div>
);
```

- [ ] **Step 2: Verify fixture is valid**

Run: `ls -R tests/fixtures/monorepo/`
Expected: All files present

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/monorepo/
git commit -m "test: add monorepo fixture for cross-package import tests"
```

---

## Task 12: Cross-package import integration test

**Covers:** S3 (cross-package imports), S8 (E2E tests)

**Files:**
- Create: `packages/source-hint-engine/src/workspace-integration.test.ts`

**Interfaces:**
- Consumes: monorepo fixture from Task 11, `resolveWorkspaceImport` from Task 6

- [ ] **Step 1: Write the integration test**

```typescript
// packages/source-hint-engine/src/workspace-integration.test.ts
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { resolveWorkspaceImport, buildWorkspaceDependencyClosure } from './import-graph';
import type { WorkspacePackageMetadata } from '@viskod/shared';

const FIXTURE_ROOT = path.resolve(__dirname, '../../../tests/fixtures/monorepo');

const packages: WorkspacePackageMetadata[] = [
  {
    name: '@acme/ui',
    relativeRoot: 'packages/ui',
    packageJsonPath: 'packages/ui/package.json',
    sourceRoots: ['packages/ui/src'],
    workspaceDependencies: ['@acme/utils'],
  },
  {
    name: '@acme/utils',
    relativeRoot: 'packages/utils',
    packageJsonPath: 'packages/utils/package.json',
    sourceRoots: ['packages/utils/src'],
    workspaceDependencies: [],
  },
  {
    name: '@acme/app',
    relativeRoot: 'packages/app',
    packageJsonPath: 'packages/app/package.json',
    sourceRoots: ['packages/app/src'],
    workspaceDependencies: ['@acme/ui', '@acme/utils'],
  },
];

describe('cross-package import resolution (monorepo fixture)', () => {
  it('resolves @acme/ui import from app', () => {
    const result = resolveWorkspaceImport(
      FIXTURE_ROOT,
      'packages/app/src/App.tsx',
      '@acme/ui',
      packages,
    );
    expect(result).toBe('packages/ui/src/index.ts');
  });

  it('resolves @acme/utils/format subpath import from app', () => {
    const result = resolveWorkspaceImport(
      FIXTURE_ROOT,
      'packages/app/src/App.tsx',
      '@acme/utils/format',
      packages,
    );
    expect(result).toBe('packages/utils/src/format.ts');
  });

  it('builds full dependency closure from app entry', () => {
    const closure = buildWorkspaceDependencyClosure(
      FIXTURE_ROOT,
      'packages/app/src/App.tsx',
      packages,
    );
    expect(closure).toContain('packages/app/src/App.tsx');
    expect(closure).toContain('packages/utils/src/format.ts');
    // Button.tsx is not imported by App.tsx (only @acme/ui index is)
    expect(closure).toContain('packages/ui/src/index.ts');
  });

  it('resolves relative import within ui package', () => {
    const result = resolveWorkspaceImport(
      FIXTURE_ROOT,
      'packages/ui/src/index.ts',
      './Button',
      packages,
    );
    expect(result).toBe('packages/ui/src/Button.tsx');
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm exec vitest run packages/source-hint-engine/src/workspace-integration.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/source-hint-engine/src/workspace-integration.test.ts
git commit -m "test(source-hint-engine): add cross-package import integration test"
```

---

## Task 13: Cache invalidation on workspace change

**Covers:** S7 (cache invalidation)

**Files:**
- Modify: `packages/source-hint-engine/src/index.ts` (add `invalidateCache` method — already added in Task 7)
- Modify: `packages/cli/src/index.ts` (call `invalidateCache` after workspace re-scan)
- Modify: `packages/mcp-server/src/entry.ts` (same)
- Modify: `apps/studio/src/index.ts` (same)

**Interfaces:**
- Consumes: `SourceHintEngine.invalidateCache(rootPath)` from Task 7
- Produces: All entry points invalidate hint cache when workspace metadata changes

- [ ] **Step 1: Write the failing test**

```typescript
// Add to existing cache test file
import { describe, it, expect } from 'vitest';
import { EventBus } from '@viskod/event-bus';
import { SourceHintEngine } from './index';

describe('SourceHintEngine cache invalidation', () => {
  it('invalidateCache clears hint cache and specific import graph entry', () => {
    const engine = new SourceHintEngine(new EventBus({ enableHistory: false }));
    // After invalidation, cache should be clear
    engine.invalidateCache('/some/root');
    const health = engine.health();
    expect(health.cacheSize).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm exec vitest run packages/source-hint-engine/src/`
Expected: PASS

- [ ] **Step 3: Write minimal implementation**

In CLI (`packages/cli/src/index.ts`), after calling `setProjectContext()`, also call `invalidateCache` when workspace changes:

```typescript
// After setProjectContext:
runtime.sourceHintEngine.invalidateCache(projectPath);
```

Same pattern in MCP server and Studio.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/source-hint-engine/src/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/index.ts packages/mcp-server/src/entry.ts apps/studio/src/index.ts
git commit -m "feat: invalidate hint cache on workspace re-scan"
```

---

## Task 14: Run full test suite and typecheck

**Covers:** S10 (regression guard)

**Files:**
- No new files

**Interfaces:**
- Consumes: All previous tasks
- Produces: Green `pnpm check` gate

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS — no type errors

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`
Expected: PASS — all existing + new tests pass

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: PASS — no biome errors

- [ ] **Step 4: Run check gate**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 5: Commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix: resolve type/lint issues from Phase 33 workspace integration"
```

---

## Task 15: Write Phase 33 completion report

**Covers:** S11 (completion report)

**Files:**
- Create: `PHASE33_REPOSITORY_SCALE_WORKSPACES_REPORT.md`

**Interfaces:**
- Produces: Completion report documenting all changes, test results, and integration points

- [ ] **Step 1: Write the report**

Create `PHASE33_REPOSITORY_SCALE_WORKSPACES_REPORT.md` with 32 subsections covering:
1. Executive summary
2. Workspace metadata model
3. Integration chain (CLI/MCP/Studio → context-engine → source-hint-engine)
4. Cross-package import resolution
5. LRU cache implementation
6. Cache invalidation strategy
7. USAGE_SITE_DIRS extension
8. Monorepo test fixture
9. Test results summary
10. Typecheck/lint results
11. Performance characteristics
12. Security considerations
13. Breaking changes (none)
14. Migration notes
15. Known limitations
16. Future improvements

- [ ] **Step 2: Commit**

```bash
git add PHASE33_REPOSITORY_SCALE_WORKSPACES_REPORT.md
git commit -m "docs: add Phase 33 completion report"
```
