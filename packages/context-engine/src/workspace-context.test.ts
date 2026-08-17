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
