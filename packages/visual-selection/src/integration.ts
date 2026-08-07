import type { Result } from '@viskod/shared';
import { ok } from '@viskod/shared';
import { normalizeText } from './redaction';
import type { VisualSelectionService } from './service';
import type { PageInfo, Rect, VisualSelection, VisualSelectionTarget } from './types';

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
  getViewport(): Promise<{
    width: number;
    height: number;
    deviceScaleFactor: number;
    scrollX: number;
    scrollY: number;
  }>;
  getElementInfoAtPoint(x: number, y: number): Promise<Result<Record<string, unknown>>>;
  /** Evaluate arbitrary JS in the page context. Returns serializable result. */
  evaluate<T>(fn: (arg: unknown) => T, arg: unknown): Promise<T>;
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
  private browser: BrowserIntegration;
  private service: VisualSelectionService;
  private overlayScript: string;
  private active = false;
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options: OverlayIntegrationOptions) {
    this.pageId = options.pageId;
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

        const targets = this.selectedEventInfos(data)
          .map((info) => this.buildTargetFromEvent(info))
          .filter((target): target is VisualSelectionTarget => target !== null);
        if (targets.length === 0) return;

        const pageInfo = await this.buildPageInfo();
        if (targets.length === 1 && data.multi !== true) {
          this.service.createSingleSelection(
            this.pageId,
            targets[0]!,
            pageInfo,
            targets[0]!.geometry.viewportRect,
          );
        } else {
          this.service.createMultiSelection(
            this.pageId,
            targets,
            pageInfo,
            targets[0]!.geometry.viewportRect,
          );
        }
        break;
      }

      case 'overlay:element-deselected': {
        const data = event.data as Record<string, unknown> | undefined;
        if (!data) return;

        const targets = this.selectedEventInfos(data)
          .map((info) => this.buildTargetFromEvent(info))
          .filter((target): target is VisualSelectionTarget => target !== null);
        if (targets.length === 0) {
          await this.service.clearSelection(this.pageId);
          break;
        }

        const pageInfo = await this.buildPageInfo();
        this.service.createMultiSelection(
          this.pageId,
          targets,
          pageInfo,
          targets[0]!.geometry.viewportRect,
        );
        break;
      }

      case 'overlay:box-drag-completed': {
        const data = event.data as Record<string, unknown> | undefined;
        if (!data) return;

        const pageInfo = await this.buildPageInfo();
        const dragRect = data.viewportRect as Rect | undefined;
        if (!dragRect) return;

        const targets = await this.collectBoxTargets(dragRect);
        const selectionResult = this.service.createBoxSelection(
          this.pageId,
          targets,
          dragRect,
          pageInfo,
        );
        if (selectionResult.ok) {
          const overlayTargets = selectionResult.value.targets.map((target) => ({
            boundingBox: target.geometry.viewportRect,
            tagName: target.semantics.tagName,
            documentOrder: target.documentOrder,
            role: target.semantics.role,
            accessibleName: target.semantics.accessibleName,
            textPreview: target.semantics.textPreview,
          }));
          await this.browser.evaluate((rawTargets: unknown) => {
            window.postMessage(
              {
                source: '__viskod_browser',
                command: 'overlay:set-selection-targets',
                targets: rawTargets,
              },
              '*',
            );
            return undefined;
          }, overlayTargets);
        }
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

  private selectedEventInfos(data: Record<string, unknown>): Record<string, unknown>[] {
    const selected = data.selectedElements;
    if (!Array.isArray(selected)) return [data];
    return selected.filter(
      (value): value is Record<string, unknown> => typeof value === 'object' && value !== null,
    );
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
      // Internal recapture/capture locator produced in page context; never
      // fabricated here from transient class names.
      selector: (data.selector as string) || undefined,
      resolutionCandidates: [
        { strategy: 'runtime-node', value: 'live', confidence: 0.9 },
        { strategy: 'geometry', value: boundingBox, confidence: 0.7 },
      ],
    };
  }

  // real DOM query — finds all elements whose bounding rects intersect the drag rectangle
  private async collectBoxTargets(
    dragRect: Rect,
  ): Promise<import('./box-selection').BoxCandidate[]> {
    try {
      const elements = await this.browser.evaluate((rawRect: unknown) => {
        const rect = rawRect as Rect;
        const results: Array<import('./box-selection').BoxCandidate> = [];
        let order = 0;
        const walk = (node: Element, ancestorDepth = 0) => {
          const r = node.getBoundingClientRect();
          const intersects =
            r.width > 0 &&
            r.height > 0 &&
            r.left < rect.x + rect.width &&
            r.right > rect.x &&
            r.top < rect.y + rect.height &&
            r.bottom > rect.y;
          const isViskodOwned = Boolean(
            node.closest?.('[data-viskod-overlay]') || node.closest?.('#__viskod_overlay_root'),
          );
          const tagName = node.tagName.toLowerCase();
          const computed = window.getComputedStyle(node);
          const isHidden = computed.display === 'none' || computed.visibility === 'hidden';
          const isTechnical = ['script', 'style', 'noscript', 'template'].includes(tagName);
          const isInteractive =
            ['button', 'a', 'input', 'select', 'textarea'].includes(tagName) ||
            node.getAttribute('role') === 'button' ||
            (node as HTMLElement).tabIndex >= 0;

          if (intersects && !isViskodOwned) {
            const left = Math.max(r.left, rect.x);
            const right = Math.min(r.right, rect.x + rect.width);
            const top = Math.max(r.top, rect.y);
            const bottom = Math.min(r.bottom, rect.y + rect.height);
            const intersectionArea = Math.max(0, right - left) * Math.max(0, bottom - top);
            const area = r.width * r.height;
            const el = node as HTMLElement;
            results.push({
              tagName,
              boundingRect: { x: r.x, y: r.y, width: r.width, height: r.height },
              targetId: el.id || el.getAttribute('data-testid') || crypto.randomUUID(),
              documentOrder: order,
              ancestorDepth,
              isInteractive,
              isTechnical,
              isViskodOwned,
              isHidden,
              intersectionArea,
              visibleRatio: area > 0 ? intersectionArea / area : 0,
            });
          }

          order++;
          for (let i = 0; i < node.children.length; i++) {
            const child = node.children[i];
            if (child) walk(child, ancestorDepth + 1);
          }
        };
        walk(document.body);
        return results;
      }, dragRect);
      return elements;
    } catch {
      return [];
    }
  }
}
