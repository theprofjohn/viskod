import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserRuntime, PROFILES } from '@viskod/browser-runtime';
import { EventBus } from '@viskod/event-bus';
import { SelectionEngine, type SelectionTarget } from '@viskod/selection-engine';
import { err, ok } from '@viskod/shared';
import { SourceHintEngine } from '@viskod/source-hint-engine';
import { describe, expect, it, vi } from 'vitest';
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

  it('normalizes scanner route files to project-relative paths', () => {
    const root = join(tmpdir(), `viskod-context-route-${Date.now()}`);
    mkdirSync(join(root, 'src', 'app', '(marketing)'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'app', '(marketing)', 'page.tsx'),
      'export default function Page() { return null; }',
    );
    const bus = new EventBus();
    const vce = new VisualContextEngine({ browserRuntime: new BrowserRuntime(bus), eventBus: bus });

    vce.setProjectContext({
      rootPath: root,
      projectId: 'route-project',
      name: 'route-project',
      directories: [],
      primaryFramework: 'nextjs',
      detectedFrameworks: ['nextjs'],
      frameworkConfidence: 1,
      routeMap: { routes: [{ path: '/', file: '/(marketing)/page.tsx', type: 'page' }] },
    });

    expect(vce.getProjectContext()?.routeMap?.routes[0]?.file).toBe('src/app/(marketing)/page.tsx');
    rmSync(root, { recursive: true, force: true });
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

  it('getLastPacket returns null before any capture', () => {
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

// ---------------------------------------------------------------------------
// Phase 27 — capture profile gating (VISKOD-AUDIT-010)
// Disabled profile fields must not perform browser work at all.
// ---------------------------------------------------------------------------

const GATING_SELECTION = {
  selector: '.foo',
  boundingBox: { x: 0, y: 0, width: 100, height: 100 },
  source: 'mcp' as const,
};

const FAKE_DOM_SNAPSHOT = {
  tagName: 'div',
  attributes: {},
  boundingBox: { x: 0, y: 0, width: 10, height: 10 },
  children: [],
  text: 'sample',
};

const FAKE_HIERARCHY = {
  selectedNode: { tagName: 'div', depth: 1 },
  parents: [],
  siblings: [],
  children: [],
};

const FAKE_STYLE_SNAPSHOT = {
  computed: { color: 'red' },
  layout: {
    display: 'block',
    position: 'static',
    width: 10,
    height: 10,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
  },
};

const FAKE_SCREENSHOT = {
  captureId: 'shot-1',
  path: '/tmp/shot.png',
  width: 100,
  height: 100,
  format: 'png' as const,
  buffer: Buffer.from('fake'),
  sizeBytes: 4,
};

/** Fake BrowserRuntime with spy fns; proves whether browser calls happen. */
function makeFakeBrowserRuntime() {
  const calls = {
    launch: vi.fn(),
    shutdown: vi.fn(),
    navigate: vi.fn(),
    reloadPage: vi.fn(),
    getDOMSnapshot: vi.fn(),
    getElementHierarchy: vi.fn(),
    getComputedStyles: vi.fn(),
    captureScreenshot: vi.fn(),
    captureConsoleLogs: vi.fn(),
    captureNetworkRequests: vi.fn(),
    getSelectedElementInfo: vi.fn(),
    pollOverlayEvent: vi.fn(),
    resolveElement: vi.fn(),
    releaseElement: vi.fn(),
    getPageUrl: vi.fn(),
    getViewport: vi.fn(),
    evaluate: vi.fn(),
  };
  calls.launch.mockResolvedValue(ok({ contextId: 'fake' }));
  calls.shutdown.mockResolvedValue(ok(undefined));
  calls.navigate.mockResolvedValue(ok(undefined));
  calls.reloadPage.mockResolvedValue(ok(undefined));
  calls.resolveElement.mockResolvedValue(
    ok({ status: 'resolved', matchCount: 1, selector: '.foo', element: {} as never }),
  );
  calls.releaseElement.mockResolvedValue(undefined);
  calls.getDOMSnapshot.mockResolvedValue(ok(FAKE_DOM_SNAPSHOT));
  calls.getElementHierarchy.mockResolvedValue(ok(FAKE_HIERARCHY));
  calls.getComputedStyles.mockResolvedValue(ok(FAKE_STYLE_SNAPSHOT));
  calls.captureScreenshot.mockResolvedValue(ok(FAKE_SCREENSHOT));
  calls.captureConsoleLogs.mockResolvedValue(ok([]));
  calls.captureNetworkRequests.mockResolvedValue(ok([]));
  calls.getSelectedElementInfo.mockResolvedValue(ok(null));
  calls.pollOverlayEvent.mockResolvedValue(ok(null));
  // Phase 29: actual browser observations replace synthetic defaults.
  calls.getPageUrl.mockResolvedValue('http://example.test/settings/');
  calls.getViewport.mockResolvedValue({
    width: 800,
    height: 600,
    deviceScaleFactor: 2,
    scrollX: 0,
    scrollY: 0,
  });
  calls.evaluate.mockResolvedValue('P29-Fake-Chromium/1.0');
  return {
    calls,
    runtime: calls as unknown as BrowserRuntime,
  };
}

describe('Phase 27 — capture profile gating', () => {
  it('never calls style or screenshot collection when the profile disables them', async () => {
    const { calls, runtime } = makeFakeBrowserRuntime();
    const vce = new VisualContextEngine({
      browserRuntime: runtime,
      eventBus: new EventBus(),
    });
    const started = await vce.start();
    expect(started.ok).toBe(true);

    const profile = { ...PROFILES.default, collectStyles: false, collectScreenshot: false };
    const result = await vce.generatePacket(GATING_SELECTION, profile);
    expect(result.ok).toBe(true);
    // The browser-call boundary gate: no collection work happens at all.
    expect(calls.getComputedStyles).not.toHaveBeenCalled();
    expect(calls.captureScreenshot).not.toHaveBeenCalled();
    // Other collection still runs — the gate is per-field, not global.
    expect(calls.getDOMSnapshot).toHaveBeenCalledTimes(1);
    expect(calls.captureConsoleLogs).toHaveBeenCalledTimes(1);
    if (result.ok) {
      expect(result.value.styles.computed).toEqual({});
      expect(result.value.screenshots).toEqual([]);
    }
    await vce.stopBrowser();
  });

  it('collects styles and screenshots when the profile enables them', async () => {
    const { calls, runtime } = makeFakeBrowserRuntime();
    const vce = new VisualContextEngine({
      browserRuntime: runtime,
      eventBus: new EventBus(),
    });
    await vce.start();

    const result = await vce.generatePacket(GATING_SELECTION);
    expect(result.ok).toBe(true);
    expect(calls.getComputedStyles).toHaveBeenCalledTimes(1);
    expect(calls.captureScreenshot).toHaveBeenCalledTimes(1);
    if (result.ok) {
      expect(result.value.styles.computed.color).toBe('red');
      expect(result.value.screenshots).toHaveLength(1);
    }
    await vce.stopBrowser();
  });

  it('honors the audit profile: screenshots off, styles on', async () => {
    const { calls, runtime } = makeFakeBrowserRuntime();
    const vce = new VisualContextEngine({
      browserRuntime: runtime,
      eventBus: new EventBus(),
    });
    await vce.start();

    const result = await vce.generatePacket(GATING_SELECTION, PROFILES.audit);
    expect(result.ok).toBe(true);
    expect(calls.captureScreenshot).not.toHaveBeenCalled();
    expect(calls.getComputedStyles).toHaveBeenCalledTimes(1);
    if (result.ok) expect(result.value.screenshots).toEqual([]);
    await vce.stopBrowser();
  });
});

// ---------------------------------------------------------------------------
// Phase 28 — fail-closed target validation (VISKOD-AUDIT-015)
// ---------------------------------------------------------------------------

describe('Phase 28 — fail-closed core target validation', () => {
  const CASES: Array<{ status: 'missing' | 'malformed' | 'ambiguous' | 'detached'; code: string }> =
    [
      { status: 'missing', code: 'SELECTOR_NO_MATCH' },
      { status: 'malformed', code: 'SELECTOR_MALFORMED' },
      { status: 'ambiguous', code: 'SELECTOR_AMBIGUOUS' },
      { status: 'detached', code: 'SELECTOR_DETACHED' },
    ];

  for (const { status, code } of CASES) {
    it(`fails with ${code} when the selector is ${status}`, async () => {
      const { calls, runtime } = makeFakeBrowserRuntime();
      calls.resolveElement.mockResolvedValue(
        ok({ status, matchCount: status === 'missing' ? 0 : 2, selector: '.foo' }),
      );
      const vce = new VisualContextEngine({ browserRuntime: runtime, eventBus: new EventBus() });
      await vce.start();

      const result = await vce.generatePacket(GATING_SELECTION);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(code);
        expect(result.error.message).toContain('.foo');
      }
      // No evidence collection happens for an unresolved core target.
      expect(calls.getDOMSnapshot).not.toHaveBeenCalled();
      expect(calls.captureConsoleLogs).not.toHaveBeenCalled();
      await vce.stopBrowser();
    });
  }

  it('fails when the selector resolution itself errors', async () => {
    const { calls, runtime } = makeFakeBrowserRuntime();
    calls.resolveElement.mockResolvedValue(
      err({
        code: 'BR_SELECTOR_RESOLUTION_FAILED',
        category: 'browser',
        severity: 'recoverable',
        message: 'resolution boom',
        correlationId: 'c',
        subsystem: 'browser-runtime',
        timestamp: new Date().toISOString(),
      }),
    );
    const vce = new VisualContextEngine({ browserRuntime: runtime, eventBus: new EventBus() });
    await vce.start();
    const result = await vce.generatePacket(GATING_SELECTION);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SELECTOR_RESOLUTION_FAILED');
    await vce.stopBrowser();
  });

  it('fails instead of fabricating an unknown packet when the DOM snapshot is missing', async () => {
    const { calls, runtime } = makeFakeBrowserRuntime();
    calls.getDOMSnapshot.mockResolvedValue(ok(null));
    const vce = new VisualContextEngine({ browserRuntime: runtime, eventBus: new EventBus() });
    await vce.start();
    const result = await vce.generatePacket(GATING_SELECTION);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SELECTOR_NO_MATCH');
      expect(result.error.message).not.toContain('unknown');
    }
    await vce.stopBrowser();
  });

  it('a resolved selector still produces a normal packet', async () => {
    const { calls, runtime } = makeFakeBrowserRuntime();
    const vce = new VisualContextEngine({ browserRuntime: runtime, eventBus: new EventBus() });
    await vce.start();
    const result = await vce.generatePacket(GATING_SELECTION);
    expect(result.ok).toBe(true);
    expect(calls.resolveElement).toHaveBeenCalledTimes(1);
    expect(calls.releaseElement).toHaveBeenCalledTimes(1);
    if (result.ok) {
      expect(result.value.selection.tagName).toBe('div');
    }
    await vce.stopBrowser();
  });
});

// ---------------------------------------------------------------------------
// Phase 28A — bare selectors carry no synthetic geometry (geometry trust
// contract). A bare selector must never be disambiguated by a fabricated
// default bounding box: multi-match → SELECTOR_AMBIGUOUS, always.
// ---------------------------------------------------------------------------

const BARE_SELECTION: SelectionTarget = {
  selector: '.foo',
  source: 'mcp',
};

const TRUSTED_BOX = { x: 10, y: 20, width: 120, height: 40 };

describe('Phase 28A — bare selector ambiguity closure', () => {
  it('a bare single-match selector resolves and passes NO box to resolveElement', async () => {
    const { calls, runtime } = makeFakeBrowserRuntime();
    const vce = new VisualContextEngine({ browserRuntime: runtime, eventBus: new EventBus() });
    await vce.start();
    const result = await vce.generatePacket(BARE_SELECTION);
    expect(result.ok).toBe(true);
    expect(calls.resolveElement).toHaveBeenCalledTimes(1);
    const [, selector, box] = calls.resolveElement.mock.calls[0] as [unknown, string, unknown];
    expect(selector).toBe('.foo');
    // No synthetic/default geometry may reach resolution.
    expect(box).toBeUndefined();
    await vce.stopBrowser();
  });

  it('a bare multi-match selector fails with SELECTOR_AMBIGUOUS (no geometry anchor)', async () => {
    const { calls, runtime } = makeFakeBrowserRuntime();
    calls.resolveElement.mockResolvedValue(
      ok({ status: 'ambiguous', matchCount: 2, selector: '.foo' }),
    );
    const vce = new VisualContextEngine({ browserRuntime: runtime, eventBus: new EventBus() });
    await vce.start();
    const result = await vce.generatePacket(BARE_SELECTION);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SELECTOR_AMBIGUOUS');
    expect(calls.getDOMSnapshot).not.toHaveBeenCalled();
    await vce.stopBrowser();
  });

  it('a bare missing selector fails with SELECTOR_NO_MATCH', async () => {
    const { calls, runtime } = makeFakeBrowserRuntime();
    calls.resolveElement.mockResolvedValue(
      ok({ status: 'missing', matchCount: 0, selector: '.foo' }),
    );
    const vce = new VisualContextEngine({ browserRuntime: runtime, eventBus: new EventBus() });
    await vce.start();
    const result = await vce.generatePacket(BARE_SELECTION);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SELECTOR_NO_MATCH');
    await vce.stopBrowser();
  });

  it('a bare malformed selector fails with SELECTOR_MALFORMED', async () => {
    const { calls, runtime } = makeFakeBrowserRuntime();
    calls.resolveElement.mockResolvedValue(
      ok({ status: 'malformed', matchCount: 0, selector: '.foo' }),
    );
    const vce = new VisualContextEngine({ browserRuntime: runtime, eventBus: new EventBus() });
    await vce.start();
    const result = await vce.generatePacket(BARE_SELECTION);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SELECTOR_MALFORMED');
    await vce.stopBrowser();
  });

  it('a bare detached selector fails with SELECTOR_DETACHED', async () => {
    const { calls, runtime } = makeFakeBrowserRuntime();
    calls.resolveElement.mockResolvedValue(
      ok({ status: 'detached', matchCount: 1, selector: '.foo' }),
    );
    const vce = new VisualContextEngine({ browserRuntime: runtime, eventBus: new EventBus() });
    await vce.start();
    const result = await vce.generatePacket(BARE_SELECTION);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SELECTOR_DETACHED');
    await vce.stopBrowser();
  });

  it('a trusted caller-provided box is forwarded to resolveElement', async () => {
    const { calls, runtime } = makeFakeBrowserRuntime();
    const vce = new VisualContextEngine({ browserRuntime: runtime, eventBus: new EventBus() });
    await vce.start();
    const trusted: SelectionTarget = {
      selector: '.multi',
      boundingBox: TRUSTED_BOX,
      source: 'mcp',
    };
    const result = await vce.generatePacket(trusted);
    expect(result.ok).toBe(true);
    const [, , box] = calls.resolveElement.mock.calls[0] as [unknown, string, unknown];
    expect(box).toEqual(TRUSTED_BOX);
    await vce.stopBrowser();
  });
});

// ---------------------------------------------------------------------------
// Phase 28B — RESOLVED TARGET = CAPTURED TARGET (resolved-element references)
// ---------------------------------------------------------------------------

describe('Phase 28B — resolved target evidence consistency', () => {
  it('uses a caller-provided resolved reference without re-resolving the selector', async () => {
    const { calls, runtime } = makeFakeBrowserRuntime();
    const vce = new VisualContextEngine({ browserRuntime: runtime, eventBus: new EventBus() });
    await vce.start();
    const parkedRef = {
      selector: '.duplicate-card',
      status: 'resolved' as const,
      matchCount: 2,
      boundingBox: TRUSTED_BOX,
      element: { __parked: true } as never,
    };
    const result = await vce.generatePacket(GATING_SELECTION, undefined, parkedRef);
    expect(result.ok).toBe(true);
    // No re-resolution: the parked element is the target.
    expect(calls.resolveElement).not.toHaveBeenCalled();
    // Evidence collectors receive the SAME reference object.
    const domArgs = calls.getDOMSnapshot.mock.calls[0] as unknown[];
    expect(domArgs[1]).toBe(parkedRef);
    const styleArgs = calls.getComputedStyles.mock.calls[0] as unknown[];
    expect(styleArgs[1]).toBe(parkedRef);
    const elArgs = calls.getSelectedElementInfo.mock.calls[0] as unknown[];
    expect(elArgs[1]).toBe(parkedRef);
    // The consumed reference is released exactly once by the engine.
    expect(calls.releaseElement).toHaveBeenCalledTimes(1);
    expect(calls.releaseElement).toHaveBeenCalledWith(parkedRef);
    await vce.stopBrowser();
  });

  it('releases an internally-resolved reference even when capture fails', async () => {
    const { calls, runtime } = makeFakeBrowserRuntime();
    calls.getDOMSnapshot.mockResolvedValue(ok(null));
    const vce = new VisualContextEngine({ browserRuntime: runtime, eventBus: new EventBus() });
    await vce.start();
    const result = await vce.generatePacket(GATING_SELECTION);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SELECTOR_NO_MATCH');
    expect(calls.resolveElement).toHaveBeenCalledTimes(1);
    expect(calls.releaseElement).toHaveBeenCalledTimes(1);
    await vce.stopBrowser();
  });

  it('maps a detached resolved element during capture to SELECTOR_DETACHED', async () => {
    const { calls, runtime } = makeFakeBrowserRuntime();
    calls.getDOMSnapshot.mockResolvedValue(
      err({
        code: 'BR_ELEMENT_DETACHED',
        category: 'browser',
        severity: 'recoverable',
        message: 'The resolved element is no longer attached to the DOM: .foo',
        correlationId: 'c',
        subsystem: 'browser-runtime',
        timestamp: new Date().toISOString(),
      }),
    );
    const vce = new VisualContextEngine({ browserRuntime: runtime, eventBus: new EventBus() });
    await vce.start();
    const result = await vce.generatePacket(GATING_SELECTION);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SELECTOR_DETACHED');
      expect(result.error.message).toContain('no longer attached');
    }
    // No further evidence collection after the core target detached.
    expect(calls.getElementHierarchy).not.toHaveBeenCalled();
    await vce.stopBrowser();
  });

  it('resolveTargetElement maps non-resolved statuses to typed errors', async () => {
    const { calls, runtime } = makeFakeBrowserRuntime();
    calls.resolveElement.mockResolvedValue(
      ok({ status: 'ambiguous', matchCount: 2, selector: '.foo' }),
    );
    const vce = new VisualContextEngine({ browserRuntime: runtime, eventBus: new EventBus() });
    await vce.start();
    const result = await vce.resolveTargetElement(GATING_SELECTION);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SELECTOR_AMBIGUOUS');
    await vce.stopBrowser();
  });

  it('resolveTargetElement returns the resolved reference for a resolved target', async () => {
    const { runtime } = makeFakeBrowserRuntime();
    const vce = new VisualContextEngine({ browserRuntime: runtime, eventBus: new EventBus() });
    await vce.start();
    const result = await vce.resolveTargetElement(GATING_SELECTION);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('resolved');
      expect(result.value.selector).toBe('.foo');
    }
    await vce.stopBrowser();
  });
});

// ---------------------------------------------------------------------------
// Phase 29 — actual runtime facts replace synthetic defaults (VISKOD-AUDIT-032)
// ---------------------------------------------------------------------------

describe('Phase 29 — truthful runtime metadata', () => {
  it('records the ACTUAL page url, viewport, and user agent', async () => {
    const { runtime } = makeFakeBrowserRuntime();
    const vce = new VisualContextEngine({ browserRuntime: runtime, eventBus: new EventBus() });
    await vce.start();
    const result = await vce.generatePacket(GATING_SELECTION);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.browser.url).toBe('http://example.test/settings/');
      expect(result.value.browser.viewport).toEqual({
        width: 800,
        height: 600,
        deviceScaleFactor: 2,
      });
      expect(result.value.browser.userAgent).toBe('P29-Fake-Chromium/1.0');
    }
    await vce.stopBrowser();
  });

  it('marks unavailable runtime facts unavailable instead of fabricating them', async () => {
    const { calls, runtime } = makeFakeBrowserRuntime();
    calls.getPageUrl.mockRejectedValue(new Error('page gone'));
    calls.getViewport.mockRejectedValue(new Error('page gone'));
    calls.evaluate.mockRejectedValue(new Error('page gone'));
    const vce = new VisualContextEngine({ browserRuntime: runtime, eventBus: new EventBus() });
    await vce.start();
    const result = await vce.generatePacket(GATING_SELECTION);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.browser.url).toBe('unavailable');
      expect(result.value.browser.userAgent).toBe('unavailable');
    }
    await vce.stopBrowser();
  });

  it('confidence is null when no provider computed it — never a fake number', async () => {
    const { runtime } = makeFakeBrowserRuntime();
    const vce = new VisualContextEngine({ browserRuntime: runtime, eventBus: new EventBus() });
    await vce.start();
    const result = await vce.generatePacket(GATING_SELECTION);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.confidence.sourceMapping).toBeNull();
      expect(result.value.confidence.semanticLabeling).toBeNull();
      expect(result.value.confidence.layoutAnalysis).toBeNull();
      // frameworkDetection reflects the real scan when present.
      expect(result.value.confidence.frameworkDetection).toBeNull();
    }
    await vce.stopBrowser();
  });

  it('framework confidence comes from the real project scan when available', async () => {
    const { runtime } = makeFakeBrowserRuntime();
    const vce = new VisualContextEngine({ browserRuntime: runtime, eventBus: new EventBus() });
    vce.setProjectContext({
      rootPath: '/test',
      projectId: 'proj-1',
      name: 'app',
      directories: ['src'],
      primaryFramework: 'react',
      detectedFrameworks: ['react'],
      frameworkConfidence: 0.91,
    });
    await vce.start();
    const result = await vce.generatePacket(GATING_SELECTION);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.confidence.frameworkDetection).toBe(0.91);
    await vce.stopBrowser();
  });

  it('layout is null — no layout-analysis provider ran', async () => {
    const { runtime } = makeFakeBrowserRuntime();
    const vce = new VisualContextEngine({ browserRuntime: runtime, eventBus: new EventBus() });
    await vce.start();
    const result = await vce.generatePacket(GATING_SELECTION);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.styles.layout).toBeNull();
    await vce.stopBrowser();
  });
});

// ---------------------------------------------------------------------------
// Phase 29 — partial evidence semantics (valid target + optional failure)
// ---------------------------------------------------------------------------

describe('Phase 29 — partial evidence semantics', () => {
  it('optional styles failure → partial capture with sanitized diagnostic', async () => {
    const { calls, runtime } = makeFakeBrowserRuntime();
    calls.getComputedStyles.mockResolvedValue(
      err({
        code: 'BR_STYLES_FAILED',
        category: 'browser',
        severity: 'recoverable',
        message: 'failed at C:\\Users\\dev\\app: boom',
        correlationId: 'c',
        subsystem: 'browser-runtime',
        timestamp: new Date().toISOString(),
      }),
    );
    const vce = new VisualContextEngine({ browserRuntime: runtime, eventBus: new EventBus() });
    await vce.start();
    const result = await vce.generatePacket(GATING_SELECTION);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.captureStatus).toBe('partial');
      expect(result.value.evidence.styles.state).toBe('failed');
      const diag = result.value.evidence.styles.diagnostic;
      expect(diag?.provider).toBe('styles');
      expect(diag?.code).toBe('BR_STYLES_FAILED');
      // Sanitized: no absolute path, no raw stack.
      expect(diag?.reason).not.toContain('C:\\Users');
      expect(diag?.reason).not.toContain('\n');
    }
    await vce.stopBrowser();
  });

  it('optional screenshot failure → partial with failed diagnostic', async () => {
    const { calls, runtime } = makeFakeBrowserRuntime();
    calls.captureScreenshot.mockResolvedValue(
      err({
        code: 'BR_SCREENSHOT_FAILED',
        category: 'browser',
        severity: 'recoverable',
        message: 'shot failed',
        correlationId: 'c',
        subsystem: 'browser-runtime',
        timestamp: new Date().toISOString(),
      }),
    );
    const vce = new VisualContextEngine({ browserRuntime: runtime, eventBus: new EventBus() });
    await vce.start();
    const result = await vce.generatePacket(GATING_SELECTION);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.captureStatus).toBe('partial');
      expect(result.value.evidence.screenshot.state).toBe('failed');
      expect(result.value.evidence.screenshot.diagnostic?.code).toBe('BR_SCREENSHOT_FAILED');
      expect(result.value.screenshots).toEqual([]);
    }
    await vce.stopBrowser();
  });

  it('optional runtime evidence failure → partial, core still usable', async () => {
    const { calls, runtime } = makeFakeBrowserRuntime();
    calls.captureConsoleLogs.mockResolvedValue(
      err({
        code: 'BR_CONSOLE_FAILED',
        category: 'browser',
        severity: 'recoverable',
        message: 'console failed',
        correlationId: 'c',
        subsystem: 'browser-runtime',
        timestamp: new Date().toISOString(),
      }),
    );
    const vce = new VisualContextEngine({ browserRuntime: runtime, eventBus: new EventBus() });
    await vce.start();
    const result = await vce.generatePacket(GATING_SELECTION);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.captureStatus).toBe('partial');
      expect(result.value.evidence.runtime.state).toBe('failed');
      expect(result.value.evidence.runtime.diagnostic?.code).toBe('BR_CONSOLE_FAILED');
      // Core target evidence still present.
      expect(result.value.selection.tagName).toBe('div');
      expect(result.value.dom.tagName).toBe('div');
    }
    await vce.stopBrowser();
  });

  it('source hints unavailable is explicit when no engine is composed', async () => {
    const { runtime } = makeFakeBrowserRuntime();
    const vce = new VisualContextEngine({ browserRuntime: runtime, eventBus: new EventBus() });
    await vce.start();
    const result = await vce.generatePacket(GATING_SELECTION);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.evidence.sourceHints.state).toBe('unavailable');
      expect(result.value.sourceHints).toEqual([]);
    }
    await vce.stopBrowser();
  });

  it('Phase 28B: source hints derive from the resolved B evidence, never duplicate A (Phase 30)', async () => {
    const { mkdirSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { SourceHintEngine } = await import('@viskod/source-hint-engine');

    const dir = join(tmpdir(), `viskod-p30-btarget-${Date.now()}`);
    const compDir = join(dir, 'src', 'components');
    mkdirSync(compDir, { recursive: true });
    writeFileSync(
      join(compDir, 'CardA.jsx'),
      'export function CardA() { return <div data-target="a" id="card-a">FIRST CARD duplicate target for A</div>; }',
    );
    writeFileSync(
      join(compDir, 'CardB.jsx'),
      'export function CardB() { return <div data-target="b" id="card-b">SECOND CARD duplicate target for B</div>; }',
    );

    const { calls, runtime } = makeFakeBrowserRuntime();
    // The resolved target is B: the DOM snapshot carries B-only evidence.
    calls.getDOMSnapshot.mockResolvedValue(
      ok({
        tagName: 'div',
        attributes: { class: 'card-b', id: 'card-b', 'data-target': 'b' },
        boundingBox: { x: 700, y: 300, width: 220, height: 120 },
        children: [],
        text: 'SECOND CARD duplicate target for B',
      }),
    );

    const bus = new EventBus();
    const she = new SourceHintEngine(bus);
    const vce = new VisualContextEngine({
      browserRuntime: runtime,
      eventBus: bus,
      sourceHintEngine: she,
    });
    vce.setProjectContext({
      rootPath: dir,
      projectId: 'p30-b',
      name: 'btarget-app',
      directories: ['src/components'],
      primaryFramework: 'react',
      detectedFrameworks: ['react'],
      frameworkConfidence: 0.9,
    });
    await vce.start();
    const result = await vce.generatePacket(GATING_SELECTION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evidence.sourceHints.state).toBe('collected');

    const hints = result.value.sourceHints;
    expect(hints.length).toBeGreaterThan(0);
    const hintsJson = JSON.stringify(hints);
    // B-derived evidence only: the 'second' word matches CardB.jsx; A's
    // 'first' text must never contaminate the source lookup.
    expect(hintsJson).toContain('CardB.jsx');
    expect(hintsJson).not.toContain('FIRST CARD');
    expect(hintsJson).not.toContain('first');
    // Every candidate is repository-relative.
    for (const h of hints) {
      expect(h.filePath).not.toContain('C:\\');
      expect(h.filePath.startsWith('src/')).toBe(true);
    }
    await vce.stopBrowser();
    rmSync(dir, { recursive: true, force: true });
  });

  it('core DOM failure still fails closed — never a partial success', async () => {
    const { calls, runtime } = makeFakeBrowserRuntime();
    calls.getDOMSnapshot.mockResolvedValue(
      err({
        code: 'BR_DOM_CORRUPT',
        category: 'browser',
        severity: 'recoverable',
        message: 'dom corrupt',
        correlationId: 'c',
        subsystem: 'browser-runtime',
        timestamp: new Date().toISOString(),
      }),
    );
    const vce = new VisualContextEngine({ browserRuntime: runtime, eventBus: new EventBus() });
    await vce.start();
    const result = await vce.generatePacket(GATING_SELECTION);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SELECTOR_NO_MATCH');
    await vce.stopBrowser();
  });

  it('a fully successful capture is complete', async () => {
    const { calls, runtime } = makeFakeBrowserRuntime();
    // Screenshot policy default omits pixels → screenshot omitted_sensitive
    // degrades to partial; use audit profile (screenshots disabled) for a
    // complete capture.
    const vce = new VisualContextEngine({ browserRuntime: runtime, eventBus: new EventBus() });
    await vce.start();
    const result = await vce.generatePacket(GATING_SELECTION, PROFILES.audit);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.captureStatus).toBe('complete');
      expect(result.value.evidence.screenshot.state).toBe('disabled');
    }
    expect(calls.captureScreenshot).not.toHaveBeenCalled();
    await vce.stopBrowser();
  });
});

// ---------------------------------------------------------------------------
// Phase 29 — screenshot privacy policy
// ---------------------------------------------------------------------------

describe('Phase 29 — screenshot privacy policy', () => {
  it('default agent-safe policy: screenshot metadata recorded, pixels never persisted', async () => {
    const { calls, runtime } = makeFakeBrowserRuntime();
    const vce = new VisualContextEngine({ browserRuntime: runtime, eventBus: new EventBus() });
    await vce.start();
    const result = await vce.generatePacket(GATING_SELECTION);
    expect(result.ok).toBe(true);
    expect(calls.captureScreenshot).toHaveBeenCalledTimes(1);
    if (result.ok) {
      expect(result.value.screenshots).toHaveLength(1);
      const shot = result.value.screenshots[0];
      expect(shot?.status).toBe('omitted_sensitive');
      expect(shot?.path).toBeNull();
      expect(shot?.sensitive).toBe(true);
      expect(result.value.metadata.capturePolicy?.screenshot).toBe('omitted_sensitive');
      expect(result.value.captureStatus).toBe('partial');
    }
    await vce.stopBrowser();
  });

  it('explicit persist-raw opt-in: artifact marked raw/sensitive, never redacted', async () => {
    const { runtime } = makeFakeBrowserRuntime();
    const vce = new VisualContextEngine({ browserRuntime: runtime, eventBus: new EventBus() });
    vce.setScreenshotPolicy({ mode: 'persist-raw', reason: 'explicit test opt-in' });
    await vce.start();
    const result = await vce.generatePacket(GATING_SELECTION);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const shot = result.value.screenshots[0];
      expect(shot?.status).toBe('collected');
      expect(shot?.path).toBe('selection.png');
      expect(shot?.sensitive).toBe(true);
      expect(result.value.metadata.capturePolicy?.screenshot).toBe('raw_sensitive');
    }
    await vce.stopBrowser();
  });
});
