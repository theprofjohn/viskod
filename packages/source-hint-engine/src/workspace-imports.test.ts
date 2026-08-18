import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventBus } from '@viskod/event-bus';
import type { WorkspacePackageMetadata } from '@viskod/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildWorkspaceDependencyClosure, resolveWorkspaceImport } from './import-graph';
import { SourceHintEngine } from './index';
import type { HintInput } from './types';

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
    const result = resolveWorkspaceImport(
      tmpDir,
      'packages/ui/src/App.tsx',
      '@acme/utils/format',
      packages,
    );
    expect(result).toBe('packages/utils/src/format.ts');
  });

  it('resolves workspace package import @acme/ui (package root)', () => {
    // Add an index.ts to the ui package
    fs.writeFileSync(
      path.join(tmpDir, 'packages/ui/src/index.ts'),
      'export { Button } from "./Button";',
    );
    const result = resolveWorkspaceImport(
      tmpDir,
      'packages/utils/src/format.ts',
      '@acme/ui',
      packages,
    );
    expect(result).toBe('packages/ui/src/index.ts');
  });

  it('returns null for unknown package', () => {
    const result = resolveWorkspaceImport(
      tmpDir,
      'packages/ui/src/App.tsx',
      '@unknown/pkg',
      packages,
    );
    expect(result).toBeNull();
  });

  it('returns null for bare specifier that is not a workspace package', () => {
    const result = resolveWorkspaceImport(tmpDir, 'packages/ui/src/App.tsx', 'react', packages);
    expect(result).toBeNull();
  });
});

describe('buildWorkspaceDependencyClosure', () => {
  it('follows workspace imports transitively', () => {
    const closure = buildWorkspaceDependencyClosure(tmpDir, 'packages/ui/src/App.tsx', packages);
    expect(closure).toContain('packages/ui/src/App.tsx');
    expect(closure).toContain('packages/ui/src/Button.tsx');
    expect(closure).toContain('packages/utils/src/format.ts');
  });
});

/**
 * Phase 33A — unknown external dependencies must NEVER become repository-owned
 * source. Import resolution goes through actual package.json names; an
 * external specifier that matches no workspace package resolves to nothing.
 */
describe('unknown external packages never become repository-owned source', () => {
  let root: string;
  let cleanupRoot: () => void;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'viskod-ext-'));
    fs.mkdirSync(path.join(root, 'packages/ui/src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"root","private":true}');
    fs.writeFileSync(
      path.join(root, 'packages/ui/package.json'),
      JSON.stringify({ name: '@acme/ui', version: '1.0.0' }),
    );
    fs.writeFileSync(
      path.join(root, 'packages/ui/src/Widget.tsx'),
      [
        "import { format } from 'unknown-external-pkg';",
        "import { thing } from '@unknown/pkg/subpath';",
        "import { Button } from './Button';",
        'export function Widget() {',
        '  return <div>Checkout summary status line</div>;',
        '}',
      ].join('\n'),
    );
    fs.writeFileSync(path.join(root, 'packages/ui/src/Button.tsx'), 'export const Button = 1;\n');
    cleanupRoot = () => fs.rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => cleanupRoot());

  it('resolves only package.json-backed specifiers; externals resolve to null', () => {
    expect(
      resolveWorkspaceImport(root, 'packages/ui/src/Widget.tsx', 'unknown-external-pkg', packages),
    ).toBeNull();
    expect(
      resolveWorkspaceImport(root, 'packages/ui/src/Widget.tsx', '@unknown/pkg/subpath', packages),
    ).toBeNull();
    expect(resolveWorkspaceImport(root, 'packages/ui/src/Widget.tsx', './Button', packages)).toBe(
      'packages/ui/src/Button.tsx',
    );
  });

  it('closures never contain external-package paths', () => {
    const closure = buildWorkspaceDependencyClosure(root, 'packages/ui/src/Widget.tsx', packages);
    expect(closure).toContain('packages/ui/src/Widget.tsx');
    expect(closure).toContain('packages/ui/src/Button.tsx');
    expect(closure).not.toContain('unknown-external-pkg');
    expect(closure).not.toContain('@unknown/pkg');
    expect(closure).not.toContain('node_modules');
  });

  it('engine hints are always existing repository files — never externals', async () => {
    const engine = new SourceHintEngine(new EventBus());
    const input: HintInput = {
      domContext: { tagName: 'div', text: 'Checkout summary status line' },
      route: { url: 'http://127.0.0.1/', pathname: '/' },
      project: {
        metadata: {
          projectId: 'ext-test',
          name: 'ext-test',
          rootPath: root,
          packageManager: 'pnpm',
          language: 'ts',
        },
        componentIndex: { directories: ['packages/ui/src'] },
        workspace: {
          isWorkspace: true,
          workspaceType: 'pnpm-workspace',
          packages,
          globs: ['packages/*'],
        },
      },
    };
    const result = await engine.resolveUsageSiteHints(input, 10, { useImportGraph: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.topHints.length).toBeGreaterThan(0);
    for (const hint of result.value.topHints) {
      const p = hint.file.displayPath;
      // Repository-relative, existing, and never an external/package name.
      expect(p.startsWith('..')).toBe(false);
      expect(path.posix.isAbsolute(p)).toBe(false);
      expect(fs.existsSync(path.join(root, p))).toBe(true);
      expect(p).not.toContain('node_modules');
    }
    const paths = result.value.topHints.map((h) => h.file.displayPath);
    expect(paths.some((p) => p.includes('unknown-external') || p.includes('@unknown'))).toBe(false);
  });
});
