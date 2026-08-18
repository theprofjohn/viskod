import * as path from 'node:path';
import type { WorkspacePackageMetadata } from '@viskod/shared';
import { describe, expect, it } from 'vitest';
import { buildWorkspaceDependencyClosure, resolveWorkspaceImport } from './import-graph';

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
