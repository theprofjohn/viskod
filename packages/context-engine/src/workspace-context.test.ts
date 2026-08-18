import { BrowserRuntime } from '@viskod/browser-runtime';
import { EventBus } from '@viskod/event-bus';
import { SourceHintEngine } from '@viskod/source-hint-engine';
import { describe, expect, it } from 'vitest';
import { VisualContextEngine } from './index';

describe('VisualContextEngine workspace context', () => {
  it('accepts workspace metadata in setProjectContext', () => {
    const bus = new EventBus();
    const vce = new VisualContextEngine({
      browserRuntime: new BrowserRuntime(bus),
      eventBus: bus,
      sourceHintEngine: new SourceHintEngine(bus),
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
    const bus = new EventBus();
    const vce = new VisualContextEngine({
      browserRuntime: new BrowserRuntime(bus),
      eventBus: bus,
      sourceHintEngine: new SourceHintEngine(bus),
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
