import type { Result } from '@viskod/shared';
import { err, ok } from '@viskod/shared';
import type { VisualSelectionService } from './service';
import type { VisualSelection, VisualSelectionTarget, PageInfo, Rect } from './types';
import { normalizeText } from './redaction';

export interface OverlayEvent {
  type: string;
  data?: Record<string, unknown>;
}

export interface BrowserIntegration {
  showOverlaySelectionMode(overlayScript: string): Promise<Result<void>>;
  hideOverlaySelectionMode(): Promise<Result<void>>;
  injectOverlay(overlayScript: string): Promise<Result<void>>;
  removeOverlay(): Promise<Result<void>>;
  setupMessageListener(): Promise<Result<void>>;
  pollOverlayEvent(): Promise<Result<unknown>>;
  getPageUrl(): Promise<string>;
  getPageTitle(): Promise<string>;
  getViewport(): Promise<{ width: number; height: number; deviceScaleFactor: number; scrollX: number; scrollY: number }>;
  getElementInfoAtPoint(x: number, y: number): Promise<Result<Record<string, unknown>>>;
}

export interface OverlayIntegrationOptions {
  pageId: string;
  sessionId: string;
  browser: BrowserIntegration;
  service: VisualSelectionService;
  overlayScript: string;
}

export class SelectionOverlayController {
  private pageId: string;
  private sessionId: string;
  private browser: BrowserIntegration;
  private service: VisualSelectionService;
  private overlayScript: string;
  private active = false;
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options: OverlayIntegrationOptions) {
    this.pageId = options.pageId;
    this.sessionId = options.sessionId;
    this.browser = options.browser;
    this.service = options.service;
    this.overlayScript = options.overlayScript;
  }

  async enterSelectionMode(): Promise<Result<void>> {
    if (this.active) {
      return ok(undefined);
    }

    const modeResult = await this.service.enterSelectionMode(this.pageId);
    if (!modeResult.ok) return modeResult;

    const injectResult = await this.browser.showOverlaySelectionMode(this.overlayScript);
    if (!injectResult.ok) {
      await this.service.exitSelectionMode(this.pageId);
      return injectResult;
    }

    await this.browser.setupMessageListener();

    this.active = true;
    this.startPolling();

    return ok(undefined);
  }

  async exitSelectionMode(): Promise<Result<void>> {
    this.stopPolling();

    await this.browser.hideOverlaySelectionMode();
    await this.service.exitSelectionMode(this.pageId);

    this.active = false;
    return ok(undefined);
  }

  async clearSelection(): Promise<Result<void>> {
    return this.service.clearSelection(this.pageId);
  }

  getActiveSelection(): Promise<Result<VisualSelection | null>> {
    return this.service.getActiveSelection(this.pageId);
  }

  isActive(): boolean {
    return this.active;
  }

  private async handleOverlayEvent(event: OverlayEvent): Promise<void> {
    switch (event.type) {
      case 'overlay:element-clicked': {
        const data = event.data as Record<string, unknown> | undefined;
        if (!data) return;

        const pageInfo = await this.buildPageInfo();
        const target = this.buildTargetFromEvent(data);
        if (!target) return;

        this.service.createSingleSelection(this.pageId, target, pageInfo, target.geometry.viewportRect);
        break;
      }

      case 'overlay:box-drag-completed': {
        const data = event.data as Record<string, unknown> | undefined;
        if (!data) return;

        const pageInfo = await this.buildPageInfo();
        const dragRect = data.viewportRect as Rect | undefined;
        if (!dragRect) return;

        const targets = await this.collectBoxTargets(dragRect);
        this.service.createBoxSelection(this.pageId, targets, dragRect, pageInfo);
        break;
      }

      case 'overlay:exit-requested': {
        await this.exitSelectionMode();
        break;
      }

      case 'overlay:selection-cleared': {
        await this.service.clearSelection(this.pageId);
        break;
      }
    }
  }

  private startPolling(): void {
    this.pollInterval = setInterval(async () => {
      if (!this.active) return;

      const result = await this.browser.pollOverlayEvent();
      if (result.ok && result.value) {
        const event = result.value as OverlayEvent;
        await this.handleOverlayEvent(event);
      }
    }, 100);
  }

  private stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private async buildPageInfo(): Promise<PageInfo> {
    const url = await this.browser.getPageUrl();
    const title = await this.browser.getPageTitle();
    const viewport = await this.browser.getViewport();

    return {
      url,
      title: title || undefined,
      viewport,
    };
  }

  private buildTargetFromEvent(data: Record<string, unknown>): VisualSelectionTarget | null {
    const boundingBox = data.boundingBox as Rect | undefined;
    const tagName = data.tagName as string | undefined;
    if (!boundingBox || !tagName) return null;

    const textPreview = normalizeText((data.textPreview as string) || '', 120);

    return {
      targetId: crypto.randomUUID(),
      documentOrder: (data.documentOrder as number) ?? 0,
      geometry: {
        viewportRect: boundingBox,
      },
      semantics: {
        tagName,
        role: (data.role as string) || undefined,
        accessibleName: (data.accessibleName as string) || undefined,
        textPreview: textPreview || undefined,
        isInteractive: (data.isInteractive as boolean) ?? false,
      },
      fingerprints: {
        stableAttributes: (data.stableAttributes as Record<string, string>) || undefined,
        ancestorFingerprint: (data.ancestorTags as string[]) || undefined,
      },
      resolutionCandidates: [
        { strategy: 'runtime-node', value: 'live', confidence: 0.9 },
        { strategy: 'geometry', value: boundingBox, confidence: 0.7 },
      ],
    };
  }

  private async collectBoxTargets(dragRect: Rect): Promise<import('./box-selection').BoxCandidate[]> {
    return [];
  }
}
