import { describe, expect, it } from 'vitest';
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
