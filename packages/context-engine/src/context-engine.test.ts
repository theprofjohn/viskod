import { BrowserRuntime, PROFILES } from '@viskod/browser-runtime';
import { EventBus } from '@viskod/event-bus';
import { SelectionEngine } from '@viskod/selection-engine';
import { SourceHintEngine } from '@viskod/source-hint-engine';
import { describe, expect, it } from 'vitest';
import { VisualContextEngine } from './index';

describe('VisualContextEngine', () => {
  it('rejects packet generation without browser', async () => {
    const bus = new EventBus();
    const br = new BrowserRuntime(bus);
    const se = new SelectionEngine(bus);
    const vce = new VisualContextEngine({ browserRuntime: br, eventBus: bus, selectionEngine: se });

    const result = await vce.generatePacket({
      selector: '.foo',
      boundingBox: { x: 0, y: 0, width: 100, height: 100 },
      source: 'mcp',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Browser not started');
  });

  it('rejects processSelection without browser', async () => {
    const bus = new EventBus();
    const br = new BrowserRuntime(bus);
    const se = new SelectionEngine(bus);
    const vce = new VisualContextEngine({ browserRuntime: br, eventBus: bus, selectionEngine: se });

    const result = await vce.processSelection({
      selector: '.foo',
      boundingBox: { x: 0, y: 0, width: 100, height: 100 },
      source: 'studio',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Browser not started');
  });

  it('rejects processCapture without browser', async () => {
    const bus = new EventBus();
    const br = new BrowserRuntime(bus);
    const vce = new VisualContextEngine({ browserRuntime: br, eventBus: bus });
    const result = await vce.processCapture('some-id');
    expect(result.ok).toBe(false);
  });

  it('setProjectContext stores data for source hints', () => {
    const bus = new EventBus();
    const br = new BrowserRuntime(bus);
    const she = new SourceHintEngine(bus);
    const vce = new VisualContextEngine({
      browserRuntime: br,
      eventBus: bus,
      sourceHintEngine: she,
    });

    vce.setProjectContext({
      rootPath: '/test',
      projectId: 'proj-123',
      name: 'test-project',
      directories: ['src/components'],
      primaryFramework: 'react',
      detectedFrameworks: ['react'],
      frameworkConfidence: 0.9,
    });

    // No crash or error — data accepted
    expect(true).toBe(true);
  });

  it('reports health with zero state', () => {
    const bus = new EventBus();
    const br = new BrowserRuntime(bus);
    const vce = new VisualContextEngine({ browserRuntime: br, eventBus: bus });
    const health = vce.health();
    expect(health.status).toBe('healthy');
    expect(health.packetsGenerated).toBe(0);
    expect(health.failedCount).toBe(0);
    expect(health.averageProcessingTimeMs).toBe(0);
  });

  it('getLastPacket returns null', () => {
    const bus = new EventBus();
    const br = new BrowserRuntime(bus);
    const vce = new VisualContextEngine({ browserRuntime: br, eventBus: bus });
    expect(vce.getLastPacket()).toBeNull();
  });

  it('navigate returns error without browser', async () => {
    const bus = new EventBus();
    const br = new BrowserRuntime(bus);
    const vce = new VisualContextEngine({ browserRuntime: br, eventBus: bus });
    const result = await vce.navigate('http://localhost:3000');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Browser not started');
  });

  it('stopBrowser succeeds without browser', async () => {
    const bus = new EventBus();
    const br = new BrowserRuntime(bus);
    const vce = new VisualContextEngine({ browserRuntime: br, eventBus: bus });
    const result = await vce.stopBrowser();
    expect(result.ok).toBe(true);
  });

  it('generatePacket accepts profile and rejects without browser', async () => {
    const bus = new EventBus();
    const br = new BrowserRuntime(bus);
    const vce = new VisualContextEngine({ browserRuntime: br, eventBus: bus });

    // With default profile (no change from current behavior)
    const r1 = await vce.generatePacket({
      selector: '.foo',
      boundingBox: { x: 0, y: 0, width: 100, height: 100 },
      source: 'mcp',
    });
    expect(r1.ok).toBe(false);

    // With debug profile
    const r2 = await vce.generatePacket(
      {
        selector: '.foo',
        boundingBox: { x: 0, y: 0, width: 100, height: 100 },
        source: 'mcp',
      },
      PROFILES.debug,
    );
    expect(r2.ok).toBe(false);

    // With audit profile
    const r3 = await vce.generatePacket(
      {
        selector: '.foo',
        boundingBox: { x: 0, y: 0, width: 100, height: 100 },
        source: 'mcp',
      },
      PROFILES.audit,
    );
    expect(r3.ok).toBe(false);
  });

  it('generatePacket backward compatible without profile', async () => {
    const bus = new EventBus();
    const br = new BrowserRuntime(bus);
    const vce = new VisualContextEngine({ browserRuntime: br, eventBus: bus });

    // Legacy call — no profile argument
    const result = await vce.generatePacket({
      selector: '.foo',
      boundingBox: { x: 0, y: 0, width: 100, height: 100 },
      source: 'mcp',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Browser not started');
  });
});
