import type { BrowserHandle, BrowserRuntime } from '@viskod/browser-runtime';
import type { EventBus } from '@viskod/event-bus';
import type { Result, ViskodError } from '@viskod/shared';
import { ErrorCategory, ErrorSeverity, err, ok } from '@viskod/shared';
import type {
  AccessibilityInfo,
  HierarchyNode,
  HierarchyRoot,
  SelectionEngineHealth,
  SelectionGeometry,
  SelectionSnapshot,
  SelectionTarget,
  VisibilityReport,
} from './types';

export type { SelectionTarget, SelectionSnapshot, SelectionEngineHealth } from './types';

const SCHEMA_VERSION = '1.0.0';

export class SelectionEngine {
  private eventBus: EventBus;
  private browserRuntime?: BrowserRuntime;
  private selectionsProcessed = 0;
  private selectionsFailed = 0;
  private processingTimes: number[] = [];
  private activeSelection: SelectionTarget | null = null;

  constructor(eventBus: EventBus, browserRuntime?: BrowserRuntime) {
    this.eventBus = eventBus;
    this.browserRuntime = browserRuntime;
  }

  async resolveTarget(event: {
    selector: string;
    boundingBox: { x: number; y: number; width: number; height: number };
    source: string;
    timestamp: string;
  }): Promise<Result<SelectionTarget>> {
    const correlationId = crypto.randomUUID();

    this.eventBus.publish({
      eventId: crypto.randomUUID(),
      eventType: 'SE_EVENT:SELECTION_STARTED',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      source: 'selection-engine',
      correlationId,
      payload: { selector: event.selector },
    });

    const source = event.source as SelectionTarget['source'];
    if (!['studio', 'mcp', 'overlay', 'keyboard', 'automation'].includes(source)) {
      this.selectionsFailed++;
      const error = this.seError('SE_INVALID_SOURCE', `Unknown selection source: ${event.source}`);
      this.eventBus.publish({
        eventId: crypto.randomUUID(),
        eventType: 'SE_EVENT:SELECTION_FAILED',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        source: 'selection-engine',
        correlationId,
        payload: { error: error.message, source: event.source },
      });
      return err(error);
    }

    const target: SelectionTarget = {
      selector: event.selector,
      boundingBox: event.boundingBox,
      source,
    };

    this.activeSelection = target;

    return ok(target);
  }

  async validateSelection(
    target: SelectionTarget,
    browserHandle?: BrowserHandle,
  ): Promise<Result<SelectionSnapshot>> {
    const startTime = Date.now();
    const correlationId = crypto.randomUUID();

    try {
      const hierarchyResult = await this.buildHierarchy(target, browserHandle);
      if (!hierarchyResult.ok) {
        this.selectionsFailed++;
        this.processingTimes.push(Date.now() - startTime);
        return err(hierarchyResult.error);
      }

      const geometry = await this.computeGeometry(target, browserHandle);
      const visibility = await this.computeVisibility(target, browserHandle);
      const accessibility = await this.computeAccessibility(target, browserHandle);
      const selectionId = this.selectionId(target.selector, target.boundingBox);

      const snapshot: SelectionSnapshot = {
        selectionId,
        target,
        hierarchy: hierarchyResult.value,
        geometry,
        visibility,
        accessibility,
        timestamp: new Date().toISOString(),
        schemaVersion: SCHEMA_VERSION,
      };

      this.selectionsProcessed++;
      const procTime = Date.now() - startTime;
      this.processingTimes.push(procTime);

      this.eventBus.publish({
        eventId: crypto.randomUUID(),
        eventType: 'SE_EVENT:SELECTION_CHANGED',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        source: 'selection-engine',
        correlationId,
        payload: {
          selectionId,
          selector: target.selector,
          processingTimeMs: procTime,
        },
      });

      return ok(snapshot);
    } catch (error) {
      this.selectionsFailed++;
      this.processingTimes.push(Date.now() - startTime);

      const seError = this.seError('SE_VALIDATION_FAILED', `Validation failed: ${String(error)}`);
      this.eventBus.publish({
        eventId: crypto.randomUUID(),
        eventType: 'SE_EVENT:SELECTION_FAILED',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        source: 'selection-engine',
        correlationId,
        payload: { error: seError.message, selector: target.selector },
      });
      return err(seError);
    }
  }

  async buildHierarchy(
    target: SelectionTarget,
    handle?: BrowserHandle,
  ): Promise<Result<HierarchyRoot>> {
    // Use real browser hierarchy when available
    if (handle && this.browserRuntime) {
      try {
        const result = await this.browserRuntime.getElementHierarchy(handle, target.selector);
        if (result.ok && result.value) {
          const h = result.value;
          return ok({
            selectedNode: {
              tagName: h.selectedNode.tagName,
              depth: h.selectedNode.depth,
              attributes: h.selectedNode.attributes ?? {},
              childCount: h.selectedNode.childCount ?? 0,
              text: h.selectedNode.text,
            },
            parents: (h.parents ?? []).map((p) => ({
              tagName: p.tagName,
              depth: p.depth,
              attributes: p.attributes ?? {},
              childCount: p.childCount ?? 0,
              text: p.text,
            })),
            siblings: (h.siblings ?? []).map((s) => ({
              tagName: s.tagName,
              depth: s.depth,
              attributes: s.attributes ?? {},
              childCount: s.childCount ?? 0,
              text: s.text,
            })),
            children: (h.children ?? []).map((c) => ({
              tagName: c.tagName,
              depth: c.depth,
              attributes: c.attributes ?? {},
              childCount: c.childCount ?? 0,
              text: c.text,
            })),
            landmarks: h.landmarks ?? [],
          });
        }
      } catch {
        // Fall through to stub
      }
    }

    // Fallback stub
    try {
      const selectedNode: HierarchyNode = {
        tagName: 'element',
        depth: 0,
        attributes: { 'data-selector': target.selector },
        childCount: 0,
      };

      const parents: HierarchyNode[] = [
        {
          tagName: 'body',
          depth: 1,
          attributes: {},
          childCount: 1,
        },
      ];

      const root: HierarchyRoot = {
        selectedNode,
        parents,
        siblings: [],
        children: [],
        landmarks: [
          { tagName: 'main', role: 'main', depth: 2 },
          { tagName: 'nav', role: 'navigation', depth: 2 },
        ],
      };

      return ok(root);
    } catch (error) {
      return err(
        this.seError('SE_HIERARCHY_FAILED', `Failed to build hierarchy: ${String(error)}`),
      );
    }
  }

  async clearSelection(): Promise<Result<void>> {
    const correlationId = crypto.randomUUID();

    this.activeSelection = null;

    this.eventBus.publish({
      eventId: crypto.randomUUID(),
      eventType: 'SE_EVENT:SELECTION_CLEARED',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      source: 'selection-engine',
      correlationId,
      payload: {},
    });

    return ok(undefined);
  }

  health(): SelectionEngineHealth {
    const avg =
      this.processingTimes.length > 0
        ? this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length
        : 0;

    return {
      status: 'healthy',
      activeSelection: this.activeSelection !== null,
      selectionsProcessed: this.selectionsProcessed,
      selectionsFailed: this.selectionsFailed,
      averageProcessingTimeMs: avg,
    };
  }

  // ---- Private helpers ----

  // ponytail: real implementations using BrowserRuntime when available, fallback to stubs
  private async computeGeometry(
    target: SelectionTarget,
    handle?: BrowserHandle,
  ): Promise<SelectionGeometry> {
    if (!handle || !this.browserRuntime) {
      return {
        boundingBox: target.boundingBox,
        visibleRegion: target.boundingBox,
        clipState: 'visible',
        viewportIntersectionRatio: 1.0,
      };
    }

    try {
      const info = await this.browserRuntime.getElementInfoAtPoint(
        handle,
        target.boundingBox.x + target.boundingBox.width / 2,
        target.boundingBox.y + target.boundingBox.height / 2,
      );
      if (!info.ok || !info.value) {
        return {
          boundingBox: target.boundingBox,
          visibleRegion: target.boundingBox,
          clipState: 'visible',
          viewportIntersectionRatio: 1.0,
        };
      }

      const bb = info.value.boundingBox as
        | { x: number; y: number; width: number; height: number }
        | undefined;
      const box = bb ?? target.boundingBox;

      // Compute viewport intersection
      const viewport = { width: 1280, height: 720 }; // fallback, could be passed in
      const ix = Math.max(0, Math.min(box.x + box.width, viewport.width) - Math.max(box.x, 0));
      const iy = Math.max(0, Math.min(box.y + box.height, viewport.height) - Math.max(box.y, 0));
      const intersectionArea = ix * iy;
      const elementArea = box.width * box.height;
      const ratio = elementArea > 0 ? intersectionArea / elementArea : 0;

      let clipState: SelectionGeometry['clipState'] = 'visible';
      if (ratio < 0.01) clipState = 'fully-clipped';
      else if (ratio < 0.99) clipState = 'partially-clipped';

      return {
        boundingBox: box,
        visibleRegion: { x: Math.max(box.x, 0), y: Math.max(box.y, 0), width: ix, height: iy },
        clipState,
        viewportIntersectionRatio: Math.round(ratio * 100) / 100,
      };
    } catch {
      return {
        boundingBox: target.boundingBox,
        visibleRegion: target.boundingBox,
        clipState: 'visible',
        viewportIntersectionRatio: 1.0,
      };
    }
  }

  private async computeVisibility(
    target: SelectionTarget,
    handle?: BrowserHandle,
  ): Promise<VisibilityReport> {
    if (!handle || !this.browserRuntime) {
      return {
        display: 'block',
        visible: true,
        opacity: 1.0,
        isClipped: false,
        viewportVisible: true,
        stackingContext: 'root',
        reasons: [],
      };
    }

    try {
      const styles = await this.browserRuntime.getComputedStyles(handle, target.selector);
      if (!styles.ok) {
        return {
          display: 'block',
          visible: true,
          opacity: 1.0,
          isClipped: false,
          viewportVisible: true,
          stackingContext: 'root',
          reasons: [],
        };
      }

      const c = styles.value.computed;
      const display = c.display ?? 'block';
      const visibility = c.visibility ?? 'visible';
      const opacity = Number.parseFloat(c.opacity ?? '1');
      const overflow = c.overflow ?? 'visible';
      const position = c.position ?? 'static';
      const zIndex = c.zIndex ?? 'auto';

      const isVisible = display !== 'none' && visibility !== 'hidden' && opacity > 0;
      const isClipped = overflow === 'hidden' || overflow === 'scroll' || overflow === 'auto';
      const reasons: string[] = [];
      if (display === 'none') reasons.push('display:none');
      if (visibility === 'hidden') reasons.push('visibility:hidden');
      if (opacity === 0) reasons.push('opacity:0');
      if (isClipped) reasons.push(`overflow:${overflow}`);

      let stackingContext = 'root';
      if (position === 'fixed' || position === 'absolute') stackingContext = 'positioned';
      else if (zIndex !== 'auto') stackingContext = 'z-index';

      return {
        display,
        visible: isVisible,
        opacity,
        isClipped,
        viewportVisible: isVisible && !isClipped,
        stackingContext,
        reasons,
      };
    } catch {
      return {
        display: 'block',
        visible: true,
        opacity: 1.0,
        isClipped: false,
        viewportVisible: true,
        stackingContext: 'root',
        reasons: [],
      };
    }
  }

  private async computeAccessibility(
    target: SelectionTarget,
    handle?: BrowserHandle,
  ): Promise<AccessibilityInfo> {
    if (!handle || !this.browserRuntime) {
      return {
        role: null,
        name: null,
        landmark: null,
        headingLevel: null,
        hasFocus: false,
        tabIndex: null,
      };
    }

    try {
      const info = await this.browserRuntime.getElementInfoAtPoint(
        handle,
        target.boundingBox.x + target.boundingBox.width / 2,
        target.boundingBox.y + target.boundingBox.height / 2,
      );
      if (!info.ok || !info.value) {
        return {
          role: null,
          name: null,
          landmark: null,
          headingLevel: null,
          hasFocus: false,
          tabIndex: null,
        };
      }

      const role = (info.value.role as string) ?? null;
      const name = (info.value.accessibleName as string) ?? null;
      const tagName = (info.value.tagName as string) ?? '';
      const landmark = ['main', 'nav', 'header', 'footer', 'aside', 'section', 'article'].includes(
        tagName,
      )
        ? tagName
        : role === 'navigation'
          ? 'nav'
          : role === 'main'
            ? 'main'
            : role === 'banner'
              ? 'header'
              : role === 'contentinfo'
                ? 'footer'
                : null;
      const headingMatch = tagName.match(/^h([1-6])$/);
      const headingLevel = headingMatch ? Number.parseInt(headingMatch[1] ?? '', 10) : null;

      return {
        role,
        name,
        landmark,
        headingLevel,
        hasFocus: false,
        tabIndex: null,
      };
    } catch {
      return {
        role: null,
        name: null,
        landmark: null,
        headingLevel: null,
        hasFocus: false,
        tabIndex: null,
      };
    }
  }

  private selectionId(
    selector: string,
    boundingBox: { x: number; y: number; width: number; height: number },
  ): string {
    const raw = `${selector}|${boundingBox.x}|${boundingBox.y}|${boundingBox.width}|${boundingBox.height}`;
    return `${selector.slice(0, 20)}-${this.hashFnv(raw)}`;
  }

  private hashFnv(input: string): string {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
      hash = hash >>> 0;
    }
    return hash.toString(36);
  }

  private seError(code: string, message: string): ViskodError {
    return {
      code,
      category: ErrorCategory.RUNTIME,
      severity: ErrorSeverity.RECOVERABLE,
      message,
      correlationId: crypto.randomUUID(),
      subsystem: 'selection-engine',
      timestamp: new Date().toISOString(),
    };
  }
}
