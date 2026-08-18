import { describe, expect, it } from 'vitest';
import type { HintInput, ProjectContext } from './types';

describe('workspace field in types', () => {
  it('ProjectContext accepts workspace field', () => {
    const ctx: ProjectContext = {
      metadata: {
        projectId: 'x',
        name: 'x',
        rootPath: '/r',
        packageManager: 'pnpm',
        language: 'ts',
      },
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
        metadata: {
          projectId: 'x',
          name: 'x',
          rootPath: '/r',
          packageManager: 'pnpm',
          language: 'ts',
        },
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

  it('ProjectContext works without workspace field', () => {
    const ctx: ProjectContext = {
      metadata: {
        projectId: 'x',
        name: 'x',
        rootPath: '/r',
        packageManager: 'pnpm',
        language: 'ts',
      },
    };
    expect(ctx.workspace).toBeUndefined();
  });
});
