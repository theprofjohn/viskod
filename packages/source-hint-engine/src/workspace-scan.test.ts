import { describe, it, expect } from 'vitest';
import { resolveWorkspaceDirs } from './index';

describe('resolveWorkspaceDirs', () => {
  it('returns base dirs when no workspace', () => {
    const dirs = resolveWorkspaceDirs(['src/app'], undefined);
    expect(dirs).toContain('src/features');
    expect(dirs).toContain('src/pages');
    expect(dirs).toContain('src/routes');
    expect(dirs).toContain('src/app');
    expect(dirs).toContain('features');
    expect(dirs).toContain('pages');
    expect(dirs).toContain('routes');
    expect(dirs).toContain('app');
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

  it('returns only USAGE_SITE_DIRS for empty base dirs and no workspace', () => {
    const dirs = resolveWorkspaceDirs([], undefined);
    expect(dirs).toContain('src/features');
    expect(dirs).toContain('src/pages');
    expect(dirs).toContain('src/routes');
    expect(dirs).toContain('src/app');
    expect(dirs).toContain('features');
    expect(dirs).toContain('pages');
    expect(dirs).toContain('routes');
    expect(dirs).toContain('app');
    expect(dirs.length).toBe(8);
  });
});
