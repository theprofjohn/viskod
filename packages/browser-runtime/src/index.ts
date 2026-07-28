import type { Result, BoundingBox, Viewport } from '@viskod/shared';
import { ok, err, ErrorCategory, ErrorSeverity } from '@viskod/shared';
import type { ViskodError } from '@viskod/shared';
import type { EventBus } from '@viskod/event-bus';
import type { BrowserConfig } from '@viskod/config';
import { DEFAULT_CONFIG } from '@viskod/config';

// Stub: Playwright is imported lazily to avoid requiring it during tests
// In production: import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
type PlaywrightBrowser = unknown;
type PlaywrightPage = unknown;

export interface BrowserHandle {
  contextId: string;
}
export interface PageHandle {
  contextId: string;
  pageId: string;
  url: string;
}
export interface Screenshot {
  captureId: string;
  path: string;
  format: string;
  width: number;
  height: number;
  sizeBytes: number;
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
export type BrowserStatus = 'healthy' | 'degraded' | 'unavailable' | 'starting';
export interface BrowserHealth {
  status: BrowserStatus;
  uptime: number;
  pageCount: number;
}
export interface BrowserDiagnostics {
  consoleErrors: ConsoleError[];
  pageErrors: PageError[];
  memoryUsage: number;
}
export interface ConsoleError {
  message: string;
  source: string;
  line: number;
  timestamp: string;
}
export interface PageError {
  message: string;
  stack?: string;
  timestamp: string;
}
export interface ScreenshotOptions {
  format?: 'png' | 'jpeg';
  quality?: number;
  clip?: BoundingBox;
}

export class BrowserRuntime {
  private eventBus: EventBus;
  private config: BrowserConfig;
  private connected = false;
  private startTime = 0;
  private handles = new Map<string, { browser: PlaywrightBrowser; page: PlaywrightPage }>();

  constructor(eventBus: EventBus, config: BrowserConfig = DEFAULT_CONFIG.browser) {
    this.eventBus = eventBus;
    this.config = config;
    // BR NEVER imports VCE — this constructor proves it
  }

  async launch(): Promise<Result<BrowserHandle>> {
    this.startTime = Date.now();
    const contextId = crypto.randomUUID();

    // In P0: stub mode. Real Playwright integration in Phase 2.
    // Stub creates a "virtual" browser session for testing the vertical slice.
    this.connected = true;

    const handle: BrowserHandle = { contextId };
    this.handles.set(contextId, { browser: {} as PlaywrightBrowser, page: {} as PlaywrightPage });

    this.eventBus.publish({
      eventId: crypto.randomUUID(),
      eventType: 'BR_EVENT:BROWSER_STARTED',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      source: 'browser-runtime',
      correlationId: contextId,
      payload: { browserContextId: contextId },
    });

    return ok(handle);
  }

  async shutdown(handle: BrowserHandle): Promise<Result<void>> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return err(this.brError('BR_HANDLE_INVALID', 'Browser handle not found'));

    this.handles.delete(handle.contextId);
    this.connected = this.handles.size > 0;

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

  async navigate(handle: BrowserHandle, url: string): Promise<Result<PageHandle>> {
    const entry = this.handles.get(handle.contextId);
    if (!entry) return err(this.brError('BR_HANDLE_INVALID', 'Browser handle not found'));

    const pageId = crypto.randomUUID();
    const pageHandle: PageHandle = { contextId: handle.contextId, pageId, url };
    this.handles.set(handle.contextId, { ...entry, page: {} as PlaywrightPage });

    this.eventBus.publish({
      eventId: crypto.randomUUID(),
      eventType: 'BR_EVENT:PAGE_LOADED',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      source: 'browser-runtime',
      correlationId: handle.contextId,
      payload: { browserContextId: handle.contextId, url, loadTimeMs: 0 },
    });

    return ok(pageHandle);
  }

  async setViewport(handle: BrowserHandle, viewport: Viewport): Promise<Result<void>> {
    if (!this.handles.has(handle.contextId))
      return err(this.brError('BR_HANDLE_INVALID', 'Handle not found'));
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
    if (!this.handles.has(handle.contextId))
      return err(this.brError('BR_HANDLE_INVALID', 'Handle not found'));
    const captureId = crypto.randomUUID();

    this.eventBus.publish({
      eventId: crypto.randomUUID(),
      eventType: 'BR_EVENT:CAPTURE_COMPLETED',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      source: 'browser-runtime',
      correlationId: captureId,
      payload: { captureId, screenshotPath: `${captureId}.png`, durationMs: 0 },
    });

    return ok({
      captureId,
      path: `${captureId}.png`,
      format: 'png',
      width: this.config.viewport.width,
      height: this.config.viewport.height,
      sizeBytes: 0,
    });
  }

  async getDOMSnapshot(handle: BrowserHandle, selector: string): Promise<Result<DOMSnapshot>> {
    if (!this.handles.has(handle.contextId))
      return err(this.brError('BR_HANDLE_INVALID', 'Handle not found'));
    return ok({
      tagName: 'div',
      attributes: {},
      boundingBox: { x: 0, y: 0, width: 100, height: 100 },
      children: [],
    });
  }

  async getComputedStyles(handle: BrowserHandle, selector: string): Promise<Result<StyleSnapshot>> {
    if (!this.handles.has(handle.contextId))
      return err(this.brError('BR_HANDLE_INVALID', 'Handle not found'));
    return ok({
      computed: { display: 'block', position: 'static', width: '100px', height: '100px' },
    });
  }

  async getDiagnostics(handle: BrowserHandle): Promise<Result<BrowserDiagnostics>> {
    return ok({ consoleErrors: [], pageErrors: [], memoryUsage: 0 });
  }

  health(handle: BrowserHandle): BrowserHealth {
    const exists = this.handles.has(handle.contextId);
    return {
      status: exists ? 'healthy' : 'unavailable',
      uptime: Date.now() - this.startTime,
      pageCount: this.handles.size,
    };
  }

  // BR publishes events to EventBus — NEVER calls VCE directly
  // The EventBus handles subscriber delivery

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
