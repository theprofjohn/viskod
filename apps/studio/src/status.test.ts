import { BrowserRuntime } from '@viskod/browser-runtime';
import { VisualContextEngine } from '@viskod/context-engine';
import { EventBus } from '@viskod/event-bus';
import { describe, expect, it } from 'vitest';
import { Studio } from './index';

/**
 * Phase 33A — minimal safe Studio status surface.
 *
 * `/state` and `/health` expose ONLY:
 * - single-package vs workspace + workspace package count
 * - source scan ready / refreshing / unavailable
 * - budget exceeded when applicable
 * No absolute paths. No repository explorer.
 */
describe('Studio Phase 33A status', () => {
  async function withStatusServer(
    studio: Studio,
    run: (baseUrl: string) => Promise<void>,
  ): Promise<void> {
    const server = studio.createServer();
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    try {
      await run(`http://127.0.0.1:${port}`);
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  }

  it('exposes workspace/scan status with no absolute paths', async () => {
    const eventBus = new EventBus();
    const vce = new VisualContextEngine({ browserRuntime: new BrowserRuntime(eventBus), eventBus });
    const studio = new Studio(vce, eventBus);
    studio.setProjectStatus({
      status: 'ready',
      name: 'my-workspace',
      framework: 'react',
      routeCount: 4,
      scan: 'ready',
      workspace: { isWorkspace: true, packageCount: 3 },
      budgetExceeded: false,
    });

    await withStatusServer(studio, async (baseUrl) => {
      const state = (await (await fetch(`${baseUrl}/state`)).json()) as {
        project?: {
          status: string;
          name?: string;
          scan?: string;
          workspace?: { isWorkspace: boolean; packageCount: number } | null;
          budgetExceeded?: boolean;
        };
      };
      expect(state.project?.status).toBe('ready');
      expect(state.project?.scan).toBe('ready');
      expect(state.project?.workspace).toEqual({ isWorkspace: true, packageCount: 3 });
      expect(state.project?.budgetExceeded).toBe(false);

      const serialized = JSON.stringify(state);
      expect(serialized).not.toContain('C:\\');
      expect(serialized).not.toContain('/home/');
      expect(serialized).not.toContain('/tmp/');
      expect(serialized).not.toContain('packages/ui/src'); // no repo explorer
      expect(serialized).not.toContain('absolutePath');
      expect(serialized).not.toContain('captureDir');

      const health = (await (await fetch(`${baseUrl}/health`)).json()) as {
        project?: { status?: string; scan?: string; workspace?: { isWorkspace: boolean } };
      };
      expect(health.project?.scan).toBe('ready');
      expect(health.project?.workspace?.isWorkspace).toBe(true);
    });
  });

  it('single-package project reports isWorkspace false with zero packages', async () => {
    const eventBus = new EventBus();
    const vce = new VisualContextEngine({ browserRuntime: new BrowserRuntime(eventBus), eventBus });
    const studio = new Studio(vce, eventBus);
    studio.setProjectStatus({
      status: 'ready',
      name: 'single-app',
      scan: 'ready',
      workspace: { isWorkspace: false, packageCount: 0 },
    });
    expect(studio.getState().project.workspace).toEqual({ isWorkspace: false, packageCount: 0 });
  });

  it('no project root → scan unavailable, workspace null', async () => {
    const eventBus = new EventBus();
    const vce = new VisualContextEngine({ browserRuntime: new BrowserRuntime(eventBus), eventBus });
    const studio = new Studio(vce, eventBus);
    studio.setProjectStatus({
      status: 'unknown',
      scan: 'unavailable',
      reason: 'No project root configured.',
    });
    const project = studio.getState().project;
    expect(project.status).toBe('unknown');
    expect(project.scan).toBe('unavailable');
    expect(project.workspace).toBeUndefined();
  });
});
