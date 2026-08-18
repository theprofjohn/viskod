import { BrowserRuntime } from '@viskod/browser-runtime';
import { VisualContextEngine } from '@viskod/context-engine';
import { EventBus } from '@viskod/event-bus';
import { ProjectScanner } from '@viskod/project-scanner';
import { SourceHintEngine } from '@viskod/source-hint-engine';
import { afterEach, describe, expect, it } from 'vitest';
import { Studio } from './index';
import { createLargeWorkspaceFixture } from './large-workspace-fixture';
import type { LargeWorkspaceFixture } from './large-workspace-fixture';

/**
 * Phase 33A — event-loop responsiveness (task 3).
 *
 * Generates a deterministic 1500-file workspace fixture at test runtime,
 * starts a REAL large source scan (ProjectScanner + SourceHintEngine against
 * real filesystem), and while that scan is active requests Studio `/health`.
 *
 * - readiness is never a fixed sleep: the test polls the engine's real fs
 *   activity counters until the scan is demonstrably mid-flight
 * - the scan is proven still active DURING the measurement window (read
 *   counters keep increasing between the first and last request)
 * - every lightweight request answers within a generous deterministic CI
 *   threshold (1000 ms; observed latency is a few ms)
 */
describe('Studio event-loop responsiveness', () => {
  let fixture: LargeWorkspaceFixture | null = null;
  afterEach(() => {
    fixture?.cleanup();
    fixture = null;
  });

  async function waitForScanActivity(engine: SourceHintEngine, timeoutMs: number): Promise<void> {
    // Condition-based readiness: poll the real fs-activity counter until the
    // scan is mid-flight — never a fixed sleep.
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (engine.fsActivity().contentReads > 0) return;
      await new Promise((r) => setTimeout(r, 1));
    }
    throw new Error('large source scan never became active');
  }

  it('serves /health within threshold while a large source scan is active', async () => {
    fixture = createLargeWorkspaceFixture(1500);
    const eventBus = new EventBus();
    const browserRuntime = new BrowserRuntime(eventBus);
    const vce = new VisualContextEngine({ browserRuntime, eventBus });
    const studio = new Studio(vce, eventBus);
    const server = studio.createServer();
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // The real scan pipeline: project scan + workspace discovery, then the
      // heavy source-resolution scan (hints + import graph) — all against
      // the 1500-file workspace.
      const scanner = new ProjectScanner(eventBus);
      const scanResult = await scanner.scan(fixture.root);
      expect(scanResult.ok).toBe(true);
      const workspaceResult = await scanner.discoverWorkspace(fixture.root);
      expect(workspaceResult.ok).toBe(true);

      const engine = new SourceHintEngine(eventBus);
      const input = {
        domContext: { tagName: 'div', text: 'Order summary checkout widget status' },
        route: { url: 'http://127.0.0.1:3000/', pathname: '/' },
        project: {
          metadata: {
            projectId: scanResult.ok ? scanResult.value.metadata.projectId : 'scale',
            name: 'scale',
            rootPath: fixture.root,
            packageManager: 'pnpm',
            language: 'ts',
          },
          componentIndex: { directories: fixture.appDirs },
          workspace: workspaceResult.ok ? workspaceResult.value : fixture.workspace,
        },
      };

      // Start the real scan WITHOUT awaiting; it runs on the same event loop
      // as the Studio HTTP server.
      const scanPromise = engine.resolveUsageSiteHints(input, 10, { useImportGraph: true });
      await waitForScanActivity(engine, 15000);

      // Measure /health while the scan is provably active.
      const latencies: number[] = [];
      const readsBefore = engine.fsActivity().contentReads;
      for (let i = 0; i < 10; i++) {
        const t0 = performance.now();
        const res = await fetch(`${baseUrl}/health`);
        expect(res.ok).toBe(true);
        await res.json();
        latencies.push(performance.now() - t0);
      }
      const readsAfter = engine.fsActivity().contentReads;
      // The scan kept making progress during the measurement window.
      expect(readsAfter).toBeGreaterThan(readsBefore);

      for (const latency of latencies) {
        expect(latency).toBeLessThan(1000); // generous deterministic CI threshold
      }

      const result = await scanPromise;
      expect(result.ok).toBe(true);
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });
});
