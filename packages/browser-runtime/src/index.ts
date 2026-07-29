import type { EventBus } from '@viskod/event-bus';
import {
  type BoundingBox,
  ErrorCategory,
  ErrorSeverity,
  type Result,
  type Viewport,
  type ViskodError,
  err,
  ok,
} from '@viskod/shared';
import { type Browser, type Page, chromium } from 'playwright';
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
export interface Screenshot {
  captureId: string;
  path: string;
  format: string;
  width: number;
  height: number;
  sizeBytes: number;
  buffer: Buffer;
}
export interface ElementHierarchy {
  selectedNode: { tagName: string; depth: number; text?: string };
  parents: Array<{ tagName: string; depth: number; text?: string }>;
  siblings: Array<{ tagName: string; depth: number; text?: string }>;
  children: Array<{ tagName: string; depth: number; text?: string }>;
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

  async getDOMSnapshot(handle: BrowserHandle, selector: string): Promise<Result<DOMSnapshot>> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return err(this.brError('BR_HANDLE_INVALID', 'Handle not found'));

    try {
      const escaped = selector.replace(/[\\"]/g, '\\$&');
      const snapshot = await entry.page.evaluate(
        `(function(){var el = document.querySelector("${escaped}");if (!el) return null;var walk = function(n, d){if (d > 20) return null;var r = n.getBoundingClientRect();var a = {};for (var i = 0; i < n.attributes.length; i++) a[n.attributes[i].name] = n.attributes[i].value;var c = [];for (var i = 0; i < n.children.length; i++){var ch = n.children[i];if (ch) { var w = walk(ch, d + 1); if (w) c.push(w); }}return {tagName: n.tagName.toLowerCase(), attributes: a, boundingBox: {x: r.x, y: r.y, width: r.width, height: r.height}, children: c, text: (n.textContent || "").slice(0, 500)};};return walk(el, 0);})()`,
      );

      return ok(snapshot as unknown as DOMSnapshot);
    } catch (error) {
      return err(this.brError('BR_DOM_SNAPSHOT_FAILED', `DOM snapshot failed: ${String(error)}`));
    }
  }

  async getComputedStyles(handle: BrowserHandle, selector: string): Promise<Result<StyleSnapshot>> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return err(this.brError('BR_HANDLE_INVALID', 'Handle not found'));

    try {
      const styles = await entry.page.$eval(selector, (el) => {
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
          result[prop] = computed.getPropertyValue(prop);
        }
        return result;
      });

      return ok({ computed: styles });
    } catch (error) {
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

  async getElementHierarchy(
    handle: BrowserHandle,
    selector: string,
  ): Promise<Result<ElementHierarchy>> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return err(this.brError('BR_HANDLE_INVALID', 'Handle not found'));

    try {
      const escaped = selector.replace(/[\\"]/g, '\\$&');
      const result = await entry.page.evaluate(
        `(function(){var el = document.querySelector("${escaped}");if (!el) return null;var result = { selectedNode: null, parents: [], siblings: [], children: [], landmarks: [] };result.selectedNode = { tagName: el.tagName.toLowerCase(), depth: 0, text: (el.textContent || "").slice(0, 200) };var p = el.parentElement;var depth = 1;while (p && depth <= 10) {result.parents.push({ tagName: p.tagName.toLowerCase(), depth: depth, text: (p.textContent || "").slice(0, 200) });var role = p.getAttribute("role");if (role || p.tagName.toLowerCase() === "main" || p.tagName.toLowerCase() === "nav" || p.tagName.toLowerCase() === "header" || p.tagName.toLowerCase() === "footer" || p.tagName.toLowerCase() === "aside") {result.landmarks.push({ tagName: p.tagName.toLowerCase(), role: role || undefined, label: p.getAttribute("aria-label") || undefined, depth: depth });}p = p.parentElement;depth++;}if (el.parentElement) {for (var i = 0; i < el.parentElement.children.length; i++) {var sib = el.parentElement.children[i];if (sib !== el) result.siblings.push({ tagName: sib.tagName.toLowerCase(), depth: 1, text: (sib.textContent || "").slice(0, 200) });}}for (var i = 0; i < el.children.length; i++) {var child = el.children[i];result.children.push({ tagName: child.tagName.toLowerCase(), depth: 1, text: (child.textContent || "").slice(0, 200) });}return result;})()`,
      );

      return ok(result as unknown as ElementHierarchy);
    } catch (error) {
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
    selector: string,
  ): Promise<Result<SelectedElementInfo>> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return err(this.brError('BR_HANDLE_INVALID', 'Handle not found'));

    try {
      const escaped = selector.replace(/[\\"]/g, '\\$&');
      const result = await entry.page.evaluate(
        `(function(){var el = document.querySelector("${escaped}");if (!el) return null;var r = el.getBoundingClientRect();var a = {};for (var i = 0; i < el.attributes.length; i++) a[el.attributes[i].name] = el.attributes[i].value;return {tagName: el.tagName.toLowerCase(), text: (el.textContent || "").slice(0, 500), attributes: a, boundingBox: {x: r.x, y: r.y, width: r.width, height: r.height}};})()`,
      );
      if (!result) {
        return err(this.brError('BR_ELEMENT_NOT_FOUND', `Element not found: ${selector}`));
      }
      return ok({
        selector,
        ...(result as Omit<SelectedElementInfo, 'selector'>),
      });
    } catch (error) {
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

  private brError(code: string, message: string): ViskodError {
    return {
      code,
      category: ErrorCategory.BROWSER,
      severity: ErrorSeverity.RECOVERABLE,
      message,
      correlationId: crypto.randomUUID(),
      subsystem: 'browser-runtime',
      timestamp: new Date().toISOString(),
    };
  }
}
