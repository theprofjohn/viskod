import type { EventBus } from '@viskod/event-bus';
import {
  type BoundingBox,
  type Result,
  type Viewport,
  type ViskodError,
  createViskodError,
  err,
  ok,
} from '@viskod/shared';
import type { Browser, ElementHandle, Page } from 'playwright';
import type { ConsoleEntry, NetworkEntry, SelectedElementInfo } from './evidence';
import { collectConsoleEntries } from './evidence';
export type {
  ConsoleEntry,
  NetworkEntry,
  NetworkRequest,
  NetworkResponse,
  RuntimeEvidence,
  SelectedElementInfo,
  TruncationConfig,
  RedactionRule,
} from './evidence';
export {
  DEFAULT_TRUNCATION,
  applyRedaction,
  collectConsoleEntries,
  redactEvidence,
  truncateConsoleEntries,
  truncateNetworkEntries,
  truncateSelectedElement,
} from './evidence';
export type { CaptureProfile, ProfileConfig } from './profiles';
export { PROFILES, resolveProfile } from './profiles';

export interface BrowserHandle {
  contextId: string;
}
export interface PageHandle {
  contextId: string;
  pageId: string;
  url: string;
}
export interface DOMSnapshot {
  tagName: string;
  attributes: Record<string, string>;
  boundingBox: BoundingBox;
  children: DOMSnapshot[];
  text?: string;
}
export interface StyleSnapshot {
  computed: Record<string, string>;
}
export type SelectorResolutionStatus =
  | 'resolved'
  | 'missing'
  | 'malformed'
  | 'ambiguous'
  | 'detached';
export interface SelectorResolution {
  status: SelectorResolutionStatus;
  matchCount: number;
}
export interface ResolvedElementRefBase {
  readonly selector: string;
  readonly boundingBox?: BoundingBox;
  readonly matchCount: number;
}
/**
 * Internal capture-scoped reference to ONE specific resolved DOM element.
 *
 * Holds the live Playwright element handle that selector resolution actually
 * picked — including geometry-disambiguated multi-match candidates. Every
 * target-scoped evidence collector MUST be called with this reference, never
 * with a bare selector, so collected evidence always describes the resolved
 * element and can never silently re-query a different selector match
 * (Phase 28B: RESOLVED TARGET = CAPTURED TARGET).
 *
 * The reference is valid only for the current capture operation and is
 * NEVER serialized: it must not appear in persisted packets, MCP payloads, or
 * SDK contracts. Release it with `BrowserRuntime.releaseElement(ref)`.
 */
export interface ResolvedElementRef extends ResolvedElementRefBase {
  readonly status: 'resolved';
  readonly element: ElementHandle<Element>;
}
/** Outcome of resolving a selector against the live DOM. */
export type ElementResolution =
  | ResolvedElementRef
  | (ResolvedElementRefBase & {
      readonly status: 'missing' | 'malformed' | 'ambiguous' | 'detached';
    });
export interface Screenshot {
  captureId: string;
  path: string;
  format: string;
  width: number;
  height: number;
  sizeBytes: number;
  buffer: Buffer;
}

/** Phase 31B identity attributes resolved from the captured element. */
const ELEMENT_IDENTITY_ATTRS = [
  'data-testid',
  'data-test-id',
  'data-id',
  'id',
  'name',
  'aria-label',
  'data-cy',
  'data-test',
  'role',
] as const;

/**
 * Phase 31: local-sensitive target crop for visual review.
 *
 * The crop is captured through the Phase 28B exact-target pipeline
 * (`resolveElement` — never a bare `querySelector()[0]`), padded with a
 * conservative context margin, and clamped to the viewport. It exists ONLY
 * for local human review: it is never part of the agent-safe packet, is
 * marked sensitive/localOnly by the caller, and is served only through
 * protected opaque Studio endpoints.
 */
export interface ElementScreenshot {
  /** Raw PNG bytes of the target crop. */
  buffer?: Buffer;
  format: 'png';
  width: number;
  height: number;
  /** Exact resolved target box (trusted Phase 28B geometry), CSS px. */
  targetRect: BoundingBox;
  /** Actual cropped region (target + padding, clamped to viewport), CSS px. */
  cropRect: BoundingBox;
  /** Context padding applied around the target, CSS px. */
  padding: number;
  viewport: { width: number; height: number; deviceScaleFactor: number };
  url: string;
  capturedAt: string;
  resolutionStatus: 'resolved' | 'missing' | 'malformed' | 'ambiguous' | 'detached';
  matchCount: number;
  identity?: { targetId?: string; stableAttributes?: Record<string, string> };
  tagName?: string;
  text?: string;
}

export interface ElementScreenshotOptions {
  /** Conservative context padding around the target (CSS px). Default 24. */
  padding?: number;
  /** Upper bound for padding (CSS px). Default 64. */
  maxPadding?: number;
}
export interface ElementHierarchy {
  selectedNode: {
    tagName: string;
    depth: number;
    attributes?: Record<string, string>;
    childCount?: number;
    text?: string;
  };
  parents: Array<{
    tagName: string;
    depth: number;
    attributes?: Record<string, string>;
    childCount?: number;
    text?: string;
  }>;
  siblings: Array<{
    tagName: string;
    depth: number;
    attributes?: Record<string, string>;
    childCount?: number;
    text?: string;
  }>;
  children: Array<{
    tagName: string;
    depth: number;
    attributes?: Record<string, string>;
    childCount?: number;
    text?: string;
  }>;
  landmarks: Array<{ tagName: string; role?: string; label?: string; depth: number }>;
}
export interface BrowserDiagnostics {
  consoleErrors: Array<{ message: string; source: string; timestamp: string }>;
  pageErrors: Array<{ message: string; timestamp: string }>;
  memoryUsage: number;
  pageCount: number;
}
export interface BrowserHealth {
  status: 'healthy' | 'degraded' | 'unavailable' | 'starting';
  uptime: number;
  pageCount: number;
}
export interface BrowserConfig {
  headless: boolean;
  viewport: Viewport;
  timeout: {
    launch: number;
    navigate: number;
    screenshot: number;
  };
}

const DEFAULT_CONFIG: { browser: BrowserConfig } = {
  browser: {
    headless: true,
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    timeout: { launch: 30000, navigate: 30000, screenshot: 10000 },
  },
};

interface NetworkRecord {
  method: string;
  url: string;
  status: number;
  statusText: string;
  durationMs: number;
  sizeBytes: number;
  timestamp: string;
}

/**
 * Detect Playwright errors that mean the resolved element's live context is
 * gone (element detached, frame navigated away, or page closed). Callers map
 * these to the typed detached-element failure instead of a generic error.
 */
function isDetachedContextError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (/not attached to the DOM/i.test(error.message) ||
      /Execution context was destroyed/i.test(error.message) ||
      /Cannot find context/i.test(error.message) ||
      /Target closed/i.test(error.message))
  );
}

interface BrowserEntry {
  browser: Browser;
  page: Page;
  consoleErrors: Array<{ message: string; source: string; timestamp: string }>;
  networkEntries: NetworkRecord[];
}

export class BrowserRuntime {
  private eventBus: EventBus;
  private config: BrowserConfig;
  private startTime = 0;
  private handles = new Map<string, BrowserEntry>();

  constructor(eventBus: EventBus, config: BrowserConfig = DEFAULT_CONFIG.browser) {
    this.eventBus = eventBus;
    this.config = config;
  }

  async launch(): Promise<Result<BrowserHandle>> {
    this.startTime = Date.now();
    const contextId = crypto.randomUUID();

    try {
      // Lazy-load Playwright to avoid heavy import at module load time
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({
        headless: this.config.headless,
        timeout: this.config.timeout.launch,
      });

      const ctx = await browser.newContext({
        viewport: {
          width: this.config.viewport.width,
          height: this.config.viewport.height,
        },
        deviceScaleFactor: this.config.viewport.deviceScaleFactor,
      });

      const page = await ctx.newPage();

      const entry: BrowserEntry = {
        browser,
        page,
        consoleErrors: [],
        networkEntries: [],
      };

      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          entry.consoleErrors.push({
            message: msg.text().slice(0, 1000),
            source: 'console.error',
            timestamp: new Date().toISOString(),
          });
        }
      });

      page.on('pageerror', (error) => {
        entry.consoleErrors.push({
          message: error.message.slice(0, 1000),
          source: 'window.onerror',
          timestamp: new Date().toISOString(),
        });
      });

      page.on('request', (req) => {
        entry.networkEntries.push({
          method: req.method(),
          url: req.url(),
          status: 0,
          statusText: '',
          durationMs: 0,
          sizeBytes: 0,
          timestamp: new Date().toISOString(),
        });
      });

      page.on('requestfinished', async (req) => {
        const existing = entry.networkEntries.find((n) => n.url === req.url() && n.status === 0);
        if (existing) {
          const resp = await req.response();
          existing.status = resp?.status() ?? 0;
          existing.statusText = resp?.statusText() ?? '';
          existing.durationMs = Date.now() - new Date(existing.timestamp).getTime();
          const contentLen = resp?.headers()['content-length'];
          existing.sizeBytes = contentLen ? Number(contentLen) : 0;
        }
      });

      page.on('requestfailed', (req) => {
        const existing = entry.networkEntries.find((n) => n.url === req.url() && n.status === 0);
        if (existing) {
          existing.status = 0;
          existing.statusText = req.failure()?.errorText ?? 'Failed';
          existing.durationMs = Date.now() - new Date(existing.timestamp).getTime();
        }
      });

      this.handles.set(contextId, entry);

      this.eventBus.publish({
        eventId: crypto.randomUUID(),
        eventType: 'BR_EVENT:BROWSER_STARTED',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        source: 'browser-runtime',
        correlationId: contextId,
        payload: { browserContextId: contextId },
      });

      return ok({ contextId });
    } catch (error) {
      return err(this.brError('BR_LAUNCH_FAILED', `Failed to launch Chromium: ${String(error)}`));
    }
  }

  async shutdown(handle: BrowserHandle): Promise<Result<void>> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return err(this.brError('BR_HANDLE_INVALID', 'Browser handle not found'));

    try {
      await entry.browser.close();
    } catch {
      // Browser already closed
    }

    this.handles.delete(handle.contextId);

    this.eventBus.publish({
      eventId: crypto.randomUUID(),
      eventType: 'BR_EVENT:BROWSER_STOPPED',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      source: 'browser-runtime',
      correlationId: handle.contextId,
      payload: { browserContextId: handle.contextId, exitCode: 0 },
    });

    return ok(undefined);
  }

  async reloadPage(handle: BrowserHandle): Promise<Result<void>> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return err(this.brError('BR_HANDLE_INVALID', 'Browser handle not found'));

    try {
      await entry.page.reload({
        timeout: this.config.timeout.navigate,
        waitUntil: 'load',
      });
      return ok(undefined);
    } catch (error) {
      return err(this.brError('BR_RELOAD_FAILED', `Page reload failed: ${String(error)}`));
    }
  }

  async navigate(handle: BrowserHandle, url: string): Promise<Result<PageHandle>> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return err(this.brError('BR_HANDLE_INVALID', 'Browser handle not found'));

    try {
      await entry.page.goto(url, {
        timeout: this.config.timeout.navigate,
        waitUntil: 'load',
      });

      const pageId = crypto.randomUUID();

      this.eventBus.publish({
        eventId: crypto.randomUUID(),
        eventType: 'BR_EVENT:PAGE_LOADED',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        source: 'browser-runtime',
        correlationId: handle.contextId,
        payload: { browserContextId: handle.contextId, url, loadTimeMs: 0 },
      });

      return ok({ contextId: handle.contextId, pageId, url });
    } catch (error) {
      return err(
        this.brError('BR_NAVIGATION_FAILED', `Navigation to ${url} failed: ${String(error)}`),
      );
    }
  }

  async setViewport(handle: BrowserHandle, viewport: Viewport): Promise<Result<void>> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return err(this.brError('BR_HANDLE_INVALID', 'Handle not found'));

    try {
      await entry.page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
    } catch {
      // Viewport change failed — non-fatal
    }

    this.eventBus.publish({
      eventId: crypto.randomUUID(),
      eventType: 'BR_EVENT:VIEWPORT_CHANGED',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      source: 'browser-runtime',
      correlationId: handle.contextId,
      payload: { browserContextId: handle.contextId, ...viewport },
    });

    return ok(undefined);
  }

  async captureScreenshot(
    handle: BrowserHandle,
    type: 'viewport' | 'selection' | 'full-page',
  ): Promise<Result<Screenshot>> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return err(this.brError('BR_HANDLE_INVALID', 'Handle not found'));

    const captureId = crypto.randomUUID();

    try {
      const buffer = await entry.page.screenshot({
        type: 'png',
        fullPage: type === 'full-page',
        timeout: this.config.timeout.screenshot,
      });

      const screenshot: Screenshot = {
        captureId,
        path: `${captureId}.png`,
        format: 'png',
        width: this.config.viewport.width,
        height: this.config.viewport.height,
        sizeBytes: buffer.length,
        buffer,
      };

      this.eventBus.publish({
        eventId: crypto.randomUUID(),
        eventType: 'BR_EVENT:CAPTURE_COMPLETED',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        source: 'browser-runtime',
        correlationId: captureId,
        payload: {
          captureId,
          screenshotPath: screenshot.path,
          durationMs: 0,
        },
      });

      return ok(screenshot);
    } catch (error) {
      return err(this.brError('BR_CAPTURE_FAILED', `Screenshot capture failed: ${String(error)}`));
    }
  }

  /**
   * Phase 31: capture a local-sensitive target crop for visual review.
   *
   * The target is resolved through the Phase 28B exact-target pipeline
   * (`resolveElement`) so the crop always depicts the SAME logical element
   * the user selected — never a selector re-query that can switch
   * candidates. The crop is the trusted target box padded with a bounded
   * context margin (shadows/spacing/alignment), clamped to the viewport.
   *
   * Returns a typed `resolutionStatus` for missing/malformed/ambiguous/
   * detached targets; the caller must never compare against a different
   * element when the original cannot be confidently resolved.
   */
  async captureElementScreenshot(
    handle: BrowserHandle,
    selector: string,
    boundingBox?: BoundingBox,
    options: ElementScreenshotOptions = {},
  ): Promise<Result<ElementScreenshot>> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return err(this.brError('BR_HANDLE_INVALID', 'Handle not found'));

    const padding = Math.min(
      Math.max(0, Math.round(options.padding ?? 24)),
      Math.max(0, Math.round(options.maxPadding ?? 64)),
    );

    const resolution = await this.resolveElement(handle, selector, boundingBox);
    if (!resolution.ok) return err(resolution.error);
    const ref = resolution.value;

    const capturedAt = new Date().toISOString();
    const viewport = {
      width: entry.page.viewportSize()?.width ?? this.config.viewport.width,
      height: entry.page.viewportSize()?.height ?? this.config.viewport.height,
      deviceScaleFactor: await entry.page.evaluate(() => window.devicePixelRatio).catch(() => 1),
    };

    if (ref.status !== 'resolved') {
      return ok({
        format: 'png',
        width: 0,
        height: 0,
        targetRect: { x: 0, y: 0, width: 0, height: 0 },
        cropRect: { x: 0, y: 0, width: 0, height: 0 },
        padding,
        viewport,
        url: entry.page.url(),
        capturedAt,
        resolutionStatus: ref.status,
        matchCount: ref.matchCount,
      });
    }

    try {
      // Phase 28B identity: stable attributes of the ACTUAL resolved element.
      const identity = await ref.element.evaluate((el: Element, attrKeys: readonly string[]) => {
        const attrs: Record<string, string> = {};
        for (const key of attrKeys) {
          const value = el.getAttribute(key);
          if (value !== null) attrs[key] = value;
        }
        const text = el.textContent ?? '';
        return {
          stableAttributes: attrs,
          tagName: el.tagName.toLowerCase(),
          text: text.replace(/\s+/g, ' ').trim().slice(0, 500),
        };
      }, ELEMENT_IDENTITY_ATTRS);

      let targetRect = boundingBox;
      if (!targetRect || targetRect.width <= 0 || targetRect.height <= 0) {
        const box = await ref.element.boundingBox();
        if (box) targetRect = { x: box.x, y: box.y, width: box.width, height: box.height };
      }
      if (!targetRect || targetRect.width <= 0 || targetRect.height <= 0) {
        return ok({
          format: 'png',
          width: 0,
          height: 0,
          targetRect: { x: 0, y: 0, width: 0, height: 0 },
          cropRect: { x: 0, y: 0, width: 0, height: 0 },
          padding,
          viewport,
          url: entry.page.url(),
          capturedAt,
          resolutionStatus: 'missing',
          matchCount: ref.matchCount,
        });
      }

      // Conservative padded clip, clamped to the viewport.
      const left = Math.max(0, Math.round(targetRect.x - padding));
      const top = Math.max(0, Math.round(targetRect.y - padding));
      const right = Math.min(viewport.width, Math.round(targetRect.x + targetRect.width + padding));
      const bottom = Math.min(
        viewport.height,
        Math.round(targetRect.y + targetRect.height + padding),
      );
      const cropRect = {
        x: left,
        y: top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
      };

      const buffer = await entry.page.screenshot({
        type: 'png',
        clip: { x: cropRect.x, y: cropRect.y, width: cropRect.width, height: cropRect.height },
        timeout: this.config.timeout.screenshot,
      });

      return ok({
        buffer,
        format: 'png',
        width: cropRect.width,
        height: cropRect.height,
        targetRect,
        cropRect,
        padding,
        viewport,
        url: entry.page.url(),
        capturedAt,
        resolutionStatus: 'resolved',
        matchCount: ref.matchCount,
        identity: {
          stableAttributes: identity.stableAttributes,
        },
        tagName: identity.tagName,
        text: identity.text,
      });
    } catch (error) {
      return err(
        this.brError('BR_CAPTURE_FAILED', `Element screenshot capture failed: ${String(error)}`),
      );
    } finally {
      await this.releaseElement(ref).catch(() => undefined);
    }
  }

  /**
   * Browser-backed selector resolution (Phase 28, VISKOD-AUDIT-015;
   * Phase 28A geometry trust contract; Phase 28B resolved-target identity).
   *
   * Distinguishes malformed selectors, zero matches, detached elements, and
   * ambiguous multi-match selectors from a genuinely resolved target. Unlike
   * `resolveSelector`, the resolved outcome carries the ACTUAL resolved DOM
   * element (a live Playwright element handle) so every subsequent
   * target-scoped evidence collector can operate on the exact same element
   * instead of re-running the selector and silently picking another match.
   *
   * `boundingBox` — when supplied — is contractually TRUSTED target evidence
   * (overlay observation, persisted selection, or explicit caller-provided
   * coordinates). It MAY disambiguate a multi-match selector to the single
   * candidate whose rect contains the box center. When no bounding box is
   * supplied (bare selector) a multi-match selector is ALWAYS reported as
   * ambiguous rather than picking the first match or inventing geometry.
   * Callers must never pass synthetic/default rectangles here: provenance is
   * decided by the caller, never inferred from numeric values.
   */
  async resolveElement(
    handle: BrowserHandle,
    selector: string,
    boundingBox?: BoundingBox,
  ): Promise<Result<ElementResolution>> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return err(this.brError('BR_HANDLE_INVALID', 'Handle not found'));

    try {
      // Wait briefly for the element (handles SPA/React hydration timing),
      // then measure real match count against the live DOM. String-based
      // evaluation (consistent with the rest of this file) so tsx/esbuild
      // transpilation never leaks module helpers into the page context.
      await entry.page
        .waitForSelector(selector, { state: 'attached', timeout: 5000 })
        .catch(() => {});
      const pageFn = `(function(){
        var sel = ${JSON.stringify(selector)};
        var box = ${JSON.stringify(boundingBox ?? null)};
        function isViskodOverlay(el) {
          return !!(el.id === '__viskod_overlay_root' || (el.closest && el.closest('#__viskod_overlay_root')) || el.getAttribute('data-viskod-overlay') !== null);
        }
        var all = null;
        try { all = document.querySelectorAll(sel); } catch (e) { return { status: 'malformed', matchCount: 0 }; }
        var matches = [];
        for (var i = 0; i < all.length; i++) { if (!isViskodOverlay(all[i])) matches.push(all[i]); }
        if (matches.length === 0) return { status: 'missing', matchCount: all.length };
        if (matches.length === 1) {
          var single = matches[0];
          if (single.isConnected === false) return { status: 'detached', matchCount: all.length };
          return { status: 'resolved', matchCount: all.length, element: single };
        }
        if (box && typeof box.x === 'number') {
          var cx = box.x + box.width / 2;
          var cy = box.y + box.height / 2;
          var containing = 0;
          var best = null;
          var bestArea = -1;
          for (var j = 0; j < matches.length; j++) {
            var r = matches[j].getBoundingClientRect();
            if (r.left <= cx && cx <= r.right && r.top <= cy && cy <= r.bottom) {
              containing++;
              var area = r.width * r.height;
              if (area > bestArea) { bestArea = area; best = matches[j]; }
            }
          }
          if (containing === 1 && best && best.isConnected !== false) {
            return { status: 'resolved', matchCount: all.length, element: best };
          }
        }
        return { status: 'ambiguous', matchCount: all.length };
      })()`;
      const resolutionHandle = await entry.page.evaluateHandle(pageFn);
      try {
        const meta = await resolutionHandle.evaluate(
          (o: { status?: unknown; matchCount?: unknown }) => ({
            status: String(o?.status ?? ''),
            matchCount: Number(o?.matchCount ?? 0),
          }),
        );
        if (meta.status !== 'resolved') {
          return ok({
            selector,
            boundingBox,
            status: meta.status as 'missing' | 'malformed' | 'ambiguous' | 'detached',
            matchCount: meta.matchCount,
          });
        }
        // The resolved case embeds the DOM node; extract it as an
        // ElementHandle that stays valid (and stale-aware) for the capture.
        const elementHandle = await resolutionHandle.evaluateHandle(
          (o: { element?: Element }) => o.element,
        );
        const element = elementHandle.asElement();
        if (!element) {
          await elementHandle.dispose().catch(() => {});
          return err(
            this.brError(
              'BR_SELECTOR_RESOLUTION_FAILED',
              `Selector resolution failed: ${selector}`,
            ),
          );
        }
        return ok({
          selector,
          boundingBox,
          status: 'resolved',
          matchCount: meta.matchCount,
          element,
        });
      } finally {
        await resolutionHandle.dispose().catch(() => {});
      }
    } catch (error) {
      return err(
        this.brError(
          'BR_SELECTOR_RESOLUTION_FAILED',
          `Selector resolution failed: ${String(error)}`,
        ),
      );
    }
  }

  /**
   * Status-only selector resolution (backward-compatible validation API).
   *
   * Thin wrapper over `resolveElement`: reports the same status/matchCount
   * classification without retaining the resolved element. Capture paths
   * should prefer `resolveElement` so evidence stays bound to one element.
   */
  async resolveSelector(
    handle: BrowserHandle,
    selector: string,
    boundingBox?: BoundingBox,
  ): Promise<Result<SelectorResolution>> {
    const resolution = await this.resolveElement(handle, selector, boundingBox);
    if (!resolution.ok) return err(resolution.error);
    const ref = resolution.value;
    if (ref.status === 'resolved') {
      await this.releaseElement(ref);
    }
    return ok({ status: ref.status, matchCount: ref.matchCount });
  }

  /**
   * Release a resolved element reference after the capture operation
   * completes. Idempotent; safe to call even if the page already closed.
   */
  async releaseElement(ref: ResolvedElementRef): Promise<void> {
    await ref.element.dispose().catch(() => {});
  }

  async getDOMSnapshot(
    handle: BrowserHandle,
    ref: ResolvedElementRef,
  ): Promise<Result<DOMSnapshot>> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return err(this.brError('BR_HANDLE_INVALID', 'Handle not found'));

    try {
      // Operate on the RESOLVED element only (Phase 28B): never re-query the
      // selector, which could silently pick a different match. A detached
      // resolved element yields a typed failure — never a fallback.
      //
      // The page function body must stay free of named inner functions:
      // esbuild/tsx keepNames transforms wrap them with the module-scope
      // `__name` helper, which does not exist in the page context.
      const snapshot = await ref.element.evaluate((el) => {
        if (!el.isConnected) return { __viskodDetached: true } as const;
        const rootRect = el.getBoundingClientRect();
        const rootAttrs: Record<string, string> = {};
        for (let i = 0; i < el.attributes.length; i++) {
          const attr = el.attributes[i];
          if (attr) rootAttrs[attr.name] = attr.value;
        }
        const root = {
          tagName: el.tagName.toLowerCase(),
          attributes: rootAttrs,
          boundingBox: {
            x: rootRect.x,
            y: rootRect.y,
            width: rootRect.width,
            height: rootRect.height,
          },
          children: [] as unknown[],
          text: (el.textContent || '').slice(0, 500),
        };
        // Iterative depth-first walk (depth cap 20, same as before).
        const stack: Array<{ node: Element; target: { children: unknown[] }; depth: number }> = [
          { node: el, target: root, depth: 0 },
        ];
        while (stack.length > 0) {
          const frame = stack.pop();
          if (!frame || frame.depth >= 20) continue;
          const childNodes: unknown[] = [];
          frame.target.children = childNodes;
          for (let i = 0; i < frame.node.children.length; i++) {
            const ch = frame.node.children[i];
            if (!ch) continue;
            const rect = ch.getBoundingClientRect();
            const attrs: Record<string, string> = {};
            for (let j = 0; j < ch.attributes.length; j++) {
              const attr = ch.attributes[j];
              if (attr) attrs[attr.name] = attr.value;
            }
            const child = {
              tagName: ch.tagName.toLowerCase(),
              attributes: attrs,
              boundingBox: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
              },
              children: [] as unknown[],
              text: (ch.textContent || '').slice(0, 500),
            };
            childNodes.push(child);
            stack.push({ node: ch, target: child, depth: frame.depth + 1 });
          }
        }
        return root;
      });
      if (snapshot && (snapshot as { __viskodDetached?: boolean }).__viskodDetached) {
        return err(this.detachedElementError(ref.selector));
      }
      if (!snapshot) {
        return err(this.brError('BR_ELEMENT_NOT_FOUND', `Element not found: ${ref.selector}`));
      }

      return ok(snapshot as unknown as DOMSnapshot);
    } catch (error) {
      if (isDetachedContextError(error)) return err(this.detachedElementError(ref.selector));
      return err(this.brError('BR_DOM_SNAPSHOT_FAILED', `DOM snapshot failed: ${String(error)}`));
    }
  }

  async getComputedStyles(
    handle: BrowserHandle,
    ref: ResolvedElementRef,
  ): Promise<Result<StyleSnapshot>> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return err(this.brError('BR_HANDLE_INVALID', 'Handle not found'));

    try {
      const styles = await ref.element.evaluate((el) => {
        if (!el.isConnected) return { __viskodDetached: true } as const;
        const computed = window.getComputedStyle(el);
        const relevant = [
          'display',
          'position',
          'width',
          'height',
          'margin',
          'padding',
          'color',
          'backgroundColor',
          'fontSize',
          'fontFamily',
          'border',
          'borderRadius',
          'opacity',
          'zIndex',
          'overflow',
          'visibility',
          'flexDirection',
          'alignItems',
          'justifyContent',
          'gap',
        ];
        const result: Record<string, string> = {};
        for (const prop of relevant) {
          // getPropertyValue requires dash-case CSS names; camelCase keys
          // stay as the snapshot contract while the lookup is normalized.
          const cssProp = prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
          result[prop] = computed.getPropertyValue(cssProp);
        }
        return result;
      });
      if ((styles as { __viskodDetached?: boolean } | undefined)?.__viskodDetached) {
        return err(this.detachedElementError(ref.selector));
      }

      return ok({ computed: styles as Record<string, string> });
    } catch (error) {
      if (isDetachedContextError(error)) return err(this.detachedElementError(ref.selector));
      return err(
        this.brError('BR_STYLES_FAILED', `Computed styles retrieval failed: ${String(error)}`),
      );
    }
  }

  async injectOverlay(handle: BrowserHandle, overlayScript: string): Promise<Result<void>> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return err(this.brError('BR_HANDLE_INVALID', 'Handle not found'));

    try {
      await entry.page.evaluate(overlayScript);
      return ok(undefined);
    } catch (error) {
      return err(
        this.brError('BR_OVERLAY_INJECTION_FAILED', `Overlay injection failed: ${String(error)}`),
      );
    }
  }

  async removeOverlay(handle: BrowserHandle): Promise<Result<void>> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return err(this.brError('BR_HANDLE_INVALID', 'Handle not found'));

    try {
      await entry.page.evaluate(`
        (function() {
          var root = document.getElementById('__viskod_overlay_root');
          if (root) { root.remove(); }
        })();
      `);
      return ok(undefined);
    } catch {
      return ok(undefined);
    }
  }

  async highlightElement(
    handle: BrowserHandle,
    selector: string,
    label?: string,
  ): Promise<Result<void>> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return err(this.brError('BR_HANDLE_INVALID', 'Handle not found'));

    try {
      await entry.page.evaluate(
        ({ sel, lbl }) => {
          const el = document.querySelector(sel);
          if (!el) return;
          const rect = el.getBoundingClientRect();
          window.postMessage(
            {
              source: '__viskod_browser',
              command: 'overlay:highlight',
              selector: sel,
              label: lbl,
              x: rect.x + rect.width + 8,
              y: rect.y - 4,
            },
            '*',
          );
        },
        { sel: selector, lbl: label },
      );

      this.eventBus.publish({
        eventId: crypto.randomUUID(),
        eventType: 'BR_EVENT:SELECTION_CHANGED',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        source: 'browser-runtime',
        correlationId: handle.contextId,
        payload: { browserContextId: handle.contextId, selector },
      });

      return ok(undefined);
    } catch {
      return ok(undefined);
    }
  }

  async clearHighlight(handle: BrowserHandle): Promise<Result<void>> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return err(this.brError('BR_HANDLE_INVALID', 'Handle not found'));

    try {
      await entry.page.evaluate(`
        window.postMessage({ source: '__viskod_browser', command: 'overlay:clear' }, '*');
      `);

      this.eventBus.publish({
        eventId: crypto.randomUUID(),
        eventType: 'BR_EVENT:SELECTION_CHANGED',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        source: 'browser-runtime',
        correlationId: handle.contextId,
        payload: { browserContextId: handle.contextId, selector: null },
      });

      return ok(undefined);
    } catch {
      return ok(undefined);
    }
  }

  async showOverlaySelectionMode(
    handle: BrowserHandle,
    overlayScript: string,
  ): Promise<Result<void>> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return err(this.brError('BR_HANDLE_INVALID', 'Handle not found'));

    try {
      await entry.page.evaluate(overlayScript);
      await entry.page.evaluate(`
        window.postMessage({ source: '__viskod_browser', command: 'overlay:show', mode: 'selection' }, '*');
      `);
      return ok(undefined);
    } catch (error) {
      return err(
        this.brError(
          'BR_OVERLAY_SELECTION_FAILED',
          `Selection mode overlay failed: ${String(error)}`,
        ),
      );
    }
  }

  async hideOverlaySelectionMode(handle: BrowserHandle): Promise<Result<void>> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return err(this.brError('BR_HANDLE_INVALID', 'Handle not found'));

    try {
      await entry.page.evaluate(`
        window.postMessage({ source: '__viskod_browser', command: 'overlay:hide' }, '*');
      `);
      return ok(undefined);
    } catch {
      return ok(undefined);
    }
  }

  async setupOverlayMessageListener(
    handle: BrowserHandle,
    _eventBus: EventBus,
  ): Promise<Result<void>> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return err(this.brError('BR_HANDLE_INVALID', 'Handle not found'));

    try {
      await entry.page.evaluate(`
        if (!window.__viskod_listenerInstalled) {
          window.__viskod_listenerInstalled = true;
          window.addEventListener('message', function(event) {
            if (event.data && event.data.source === '__viskod_overlay') {
              window.__viskod_lastOverlayEvent = event.data;
            }
          });
        }
      `);
      return ok(undefined);
    } catch {
      return ok(undefined);
    }
  }

  async pollOverlayEvent(handle: BrowserHandle): Promise<Result<unknown>> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return err(this.brError('BR_HANDLE_INVALID', 'Handle not found'));

    try {
      const result = await entry.page.evaluate(`
        (function() {
          var evt = window.__viskod_lastOverlayEvent || null;
          window.__viskod_lastOverlayEvent = null;
          return evt;
        })()
      `);
      return ok(result);
    } catch {
      return ok(null);
    }
  }

  async getPageUrl(handle: BrowserHandle): Promise<string> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return '';
    try {
      return entry.page.url();
    } catch {
      return '';
    }
  }

  async getPageTitle(handle: BrowserHandle): Promise<string> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return '';
    try {
      return await entry.page.title();
    } catch {
      return '';
    }
  }

  async getViewport(handle: BrowserHandle): Promise<{
    width: number;
    height: number;
    deviceScaleFactor: number;
    scrollX: number;
    scrollY: number;
  }> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) {
      return { width: 0, height: 0, deviceScaleFactor: 1, scrollX: 0, scrollY: 0 };
    }
    try {
      const vp = entry.page.viewportSize();
      const scroll = await entry.page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
      return {
        width: vp?.width ?? 0,
        height: vp?.height ?? 0,
        deviceScaleFactor: this.config.viewport.deviceScaleFactor ?? 1,
        scrollX: scroll.x,
        scrollY: scroll.y,
      };
    } catch {
      return { width: 0, height: 0, deviceScaleFactor: 1, scrollX: 0, scrollY: 0 };
    }
  }

  /** Evaluate arbitrary JS in the page context. Returns the serializable result. */
  async evaluate<T>(handle: BrowserHandle, fn: (arg: unknown) => T, arg: unknown): Promise<T> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) {
      throw new Error('BR_HANDLE_INVALID: Handle not found');
    }
    return entry.page.evaluate(fn, arg) as Promise<T>;
  }

  async getElementInfoAtPoint(
    handle: BrowserHandle,
    x: number,
    y: number,
  ): Promise<Result<Record<string, unknown>>> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return err(this.brError('BR_HANDLE_INVALID', 'Handle not found'));

    try {
      const result = await entry.page.evaluate(
        ({ px, py }) => {
          const el = document.elementFromPoint(px, py);
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          const tagName = el.tagName.toLowerCase();
          const role = el.getAttribute('role') || undefined;
          const accessibleName = el.getAttribute('aria-label') || undefined;
          const textPreview =
            (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120) || undefined;
          const isInteractive =
            tagName === 'button' ||
            tagName === 'a' ||
            tagName === 'input' ||
            tagName === 'select' ||
            tagName === 'textarea' ||
            (el as HTMLElement).tabIndex >= 0;
          const stableKeys = [
            'data-testid',
            'data-test-id',
            'data-id',
            'data-cy',
            'data-test',
            'id',
            'name',
            'aria-label',
          ];
          const attrs: Record<string, string> = {};
          for (const key of stableKeys) {
            const v = el.getAttribute(key);
            if (v) attrs[key] = v;
          }
          return {
            tagName,
            boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            role,
            accessibleName,
            textPreview,
            isInteractive,
            stableAttributes: Object.keys(attrs).length > 0 ? attrs : undefined,
          };
        },
        { px: x, py: y },
      );
      return ok((result as Record<string, unknown>) ?? {});
    } catch (error) {
      return err(this.brError('BR_ELEMENT_INFO_FAILED', `Element info failed: ${String(error)}`));
    }
  }

  async getElementHierarchy(
    handle: BrowserHandle,
    ref: ResolvedElementRef,
  ): Promise<Result<ElementHierarchy>> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return err(this.brError('BR_HANDLE_INVALID', 'Handle not found'));

    try {
      // Operate on the RESOLVED element only (Phase 28B): never re-query the
      // selector, which could silently pick a different match.
      const result = await ref.element.evaluate((el) => {
        if (!el.isConnected) return { __viskodDetached: true } as const;
        const r = {
          selectedNode: null as unknown,
          parents: [] as unknown[],
          siblings: [] as unknown[],
          children: [] as unknown[],
          landmarks: [] as unknown[],
        };
        r.selectedNode = {
          tagName: el.tagName.toLowerCase(),
          depth: 0,
          text: (el.textContent || '').slice(0, 200),
        };
        let p = el.parentElement;
        let depth = 1;
        while (p && depth <= 10) {
          r.parents.push({
            tagName: p.tagName.toLowerCase(),
            depth,
            text: (p.textContent || '').slice(0, 200),
          });
          const role = p.getAttribute('role');
          if (
            role ||
            p.tagName.toLowerCase() === 'main' ||
            p.tagName.toLowerCase() === 'nav' ||
            p.tagName.toLowerCase() === 'header' ||
            p.tagName.toLowerCase() === 'footer' ||
            p.tagName.toLowerCase() === 'aside'
          ) {
            r.landmarks.push({
              tagName: p.tagName.toLowerCase(),
              role: role ?? undefined,
              label: p.getAttribute('aria-label') ?? undefined,
              depth,
            });
          }
          p = p.parentElement;
          depth += 1;
        }
        if (el.parentElement) {
          for (let i = 0; i < el.parentElement.children.length; i++) {
            const sib = el.parentElement.children[i];
            if (sib && sib !== el) {
              r.siblings.push({
                tagName: sib.tagName.toLowerCase(),
                depth: 1,
                text: (sib.textContent || '').slice(0, 200),
              });
            }
          }
        }
        for (let i = 0; i < el.children.length; i++) {
          const child = el.children[i];
          if (child) {
            r.children.push({
              tagName: child.tagName.toLowerCase(),
              depth: 1,
              text: (child.textContent || '').slice(0, 200),
            });
          }
        }
        return r;
      });
      if (result && (result as { __viskodDetached?: boolean }).__viskodDetached) {
        return err(this.detachedElementError(ref.selector));
      }
      if (!result) {
        return err(this.brError('BR_ELEMENT_NOT_FOUND', `Element not found: ${ref.selector}`));
      }

      return ok(result as unknown as ElementHierarchy);
    } catch (error) {
      if (isDetachedContextError(error)) return err(this.detachedElementError(ref.selector));
      return err(
        this.brError('BR_HIERARCHY_FAILED', `Hierarchy retrieval failed: ${String(error)}`),
      );
    }
  }

  async captureConsoleLogs(handle: BrowserHandle): Promise<Result<ConsoleEntry[]>> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return err(this.brError('BR_HANDLE_INVALID', 'Handle not found'));
    return ok(collectConsoleEntries(entry.consoleErrors));
  }

  async captureNetworkRequests(handle: BrowserHandle): Promise<Result<NetworkEntry[]>> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return err(this.brError('BR_HANDLE_INVALID', 'Handle not found'));
    const entries = entry.networkEntries.map((n) => ({
      request: { method: n.method, url: n.url },
      response: n.status > 0 ? { status: n.status, statusText: n.statusText } : undefined,
      durationMs: n.durationMs > 0 ? n.durationMs : undefined,
      sizeBytes: n.sizeBytes > 0 ? n.sizeBytes : undefined,
      timestamp: n.timestamp,
    }));
    return ok(entries);
  }

  async getSelectedElementInfo(
    handle: BrowserHandle,
    ref: ResolvedElementRef,
  ): Promise<Result<SelectedElementInfo>> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return err(this.brError('BR_HANDLE_INVALID', 'Handle not found'));

    try {
      const result = await ref.element.evaluate((el) => {
        if (!el.isConnected) return { __viskodDetached: true } as const;
        const r = el.getBoundingClientRect();
        const a: Record<string, string> = {};
        for (let i = 0; i < el.attributes.length; i++) {
          const attr = el.attributes[i];
          if (attr) a[attr.name] = attr.value;
        }
        return {
          tagName: el.tagName.toLowerCase(),
          text: (el.textContent || '').slice(0, 500),
          attributes: a,
          boundingBox: { x: r.x, y: r.y, width: r.width, height: r.height },
        };
      });
      if (result && (result as { __viskodDetached?: boolean }).__viskodDetached) {
        return err(this.detachedElementError(ref.selector));
      }
      if (!result) {
        return err(this.brError('BR_ELEMENT_NOT_FOUND', `Element not found: ${ref.selector}`));
      }
      return ok({
        selector: ref.selector,
        ...(result as Omit<SelectedElementInfo, 'selector'>),
      });
    } catch (error) {
      if (isDetachedContextError(error)) return err(this.detachedElementError(ref.selector));
      return err(this.brError('BR_ELEMENT_INFO_FAILED', `Element info failed: ${String(error)}`));
    }
  }

  async getDiagnostics(handle: BrowserHandle): Promise<Result<BrowserDiagnostics>> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return err(this.brError('BR_HANDLE_INVALID', 'Handle not found'));

    return ok({
      consoleErrors: entry.consoleErrors.slice(-100),
      pageErrors: [],
      memoryUsage: 0,
      pageCount: this.handles.size,
    });
  }

  health(handle: BrowserHandle): BrowserHealth {
    const entry = this.handles.get(handle.contextId);
    return {
      status: entry ? 'healthy' : 'unavailable',
      uptime: this.startTime === 0 ? 0 : Date.now() - this.startTime,
      pageCount: this.handles.size,
    };
  }

  /** Typed failure for a resolved element that detached during capture. */
  private detachedElementError(selector: string): ViskodError {
    return this.brError(
      'BR_ELEMENT_DETACHED',
      `The resolved element is no longer attached to the DOM: ${selector}`,
    );
  }

  private brError(code: string, message: string): ViskodError {
    return createViskodError({
      code,
      category: 'browser',
      severity: 'recoverable',
      message,
      subsystem: 'browser-runtime',
    });
  }
}
