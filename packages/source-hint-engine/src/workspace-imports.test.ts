import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { WorkspacePackageMetadata } from '@viskod/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildWorkspaceDependencyClosure, resolveWorkspaceImport } from './import-graph';

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
