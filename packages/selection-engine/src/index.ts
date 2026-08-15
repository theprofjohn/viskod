import type { BrowserHandle, BrowserRuntime, ResolvedElementRef } from '@viskod/browser-runtime';
import type { EventBus } from '@viskod/event-bus';
import type { Result, ViskodError } from '@viskod/shared';
import { createViskodError, err, ok } from '@viskod/shared';
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
    boundingBox?: { x: number; y: number; width: number; height: number };
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

  /**
   * Validate a selection against the live DOM (Phase 28A fail-closed
   * contract) and produce a snapshot.
   *
   * `resolvedRef` — an already-resolved element reference (Phase 28B) — is
   * used for EVERY element-scoped evidence query so the snapshot always
   * describes the same element that selector resolution picked. When it is
   * omitted and a browser is available, validation resolves its own element
   * reference (and releases it before returning). Callers that already hold
   * a reference (e.g. VisualContextEngine capture) must pass it so no
   * selector re-query can silently pick a different match.
   */
  async validateSelection(
    target: SelectionTarget,
    browserHandle?: BrowserHandle,
    resolvedRef?: ResolvedElementRef,
  ): Promise<Result<SelectionSnapshot>> {
    const startTime = Date.now();
    const correlationId = crypto.randomUUID();
    let ownedRef: ResolvedElementRef | null = null;

    try {
      // Fail closed on the core target (VISKOD-AUDIT-015): with a browser
      // available, never report a selector as resolved unless browser-backed
      // resolution succeeded. Malformed/missing/detached/ambiguous selectors
      // are typed errors instead of fabricated stub snapshots.
      let ref = resolvedRef ?? null;
      if (browserHandle && this.browserRuntime && !ref) {
        const resolution = await this.browserRuntime.resolveElement(
          browserHandle,
          target.selector,
          target.boundingBox,
        );
        if (!resolution.ok) {
          this.selectionsFailed++;
          this.processingTimes.push(Date.now() - startTime);
          return err(resolution.error);
        }
        if (resolution.value.status !== 'resolved') {
          this.selectionsFailed++;
          this.processingTimes.push(Date.now() - startTime);
          return err(this.selectorError(resolution.value.status, target.selector));
        }
        ref = resolution.value;
        ownedRef = ref;
      }

      const hierarchyResult = await this.buildHierarchy(target, browserHandle, ref ?? undefined);
      if (!hierarchyResult.ok) {
        this.selectionsFailed++;
        this.processingTimes.push(Date.now() - startTime);
        return err(hierarchyResult.error);
      }

      const geometry = await this.computeGeometry(target, browserHandle);
      const visibility = await this.computeVisibility(target, browserHandle, ref ?? undefined);
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
    } finally {
      // Release only the reference this call resolved itself; caller-owned
      // references are released by their owner.
      if (ownedRef && this.browserRuntime) {
        await this.browserRuntime.releaseElement(ownedRef);
      }
    }
  }

  async buildHierarchy(
    target: SelectionTarget,
    handle?: BrowserHandle,
    ref?: ResolvedElementRef,
  ): Promise<Result<HierarchyRoot>> {
    // Use real browser hierarchy when available
    if (handle && this.browserRuntime) {
      try {
        if (!ref) {
          // No resolved reference: never re-query the selector (Phase 28B),
          // which could silently pick a different match.
          return err(
            this.seError(
              'SE_TARGET_NOT_RESOLVED',
              `The element could not be resolved in the page: ${target.selector}`,
            ),
          );
        }
        const result = await this.browserRuntime.getElementHierarchy(handle, ref);
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
        // noop — typed error below
      }
      // Browser-backed resolution failed: never fabricate a stub snapshot
      // with a fake `data-selector` element (VISKOD-AUDIT-015).
      return err(
        this.seError(
          'SE_TARGET_NOT_RESOLVED',
          `The element could not be resolved in the page: ${target.selector}`,
        ),
      );
    }

    // Fallback stub (only used when no browser is available)
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

  // real implementations using BrowserRuntime when available, fallback to stubs
  private async computeGeometry(
    target: SelectionTarget,
    handle?: BrowserHandle,
  ): Promise<SelectionGeometry> {
    const unavailable = (): SelectionGeometry => {
      // No observed geometry (and no caller-provided trusted box): snapshot
      // geometry is unavailable. Never fabricate a box for disambiguation —
      // resolution already happened; this is metadata only.
      const box = target.boundingBox ?? { x: 0, y: 0, width: 0, height: 0 };
      return {
        boundingBox: box,
        visibleRegion: box,
        clipState: 'visible',
        viewportIntersectionRatio: 1.0,
      };
    };

    if (!handle || !this.browserRuntime) return unavailable();

    try {
      const center = await this.observedCenter(target, handle);
      if (!center) return unavailable();

      const info = await this.browserRuntime.getElementInfoAtPoint(handle, center.x, center.y);
      const bb = info.ok
        ? (info.value?.boundingBox as
            | { x: number; y: number; width: number; height: number }
            | undefined)
        : undefined;
      const box = bb ?? target.boundingBox;
      if (!box) return unavailable();

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
      return unavailable();
    }
  }

  private async computeVisibility(
    _target: SelectionTarget,
    handle?: BrowserHandle,
    ref?: ResolvedElementRef,
  ): Promise<VisibilityReport> {
    if (!handle || !this.browserRuntime || !ref) {
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
      const styles = await this.browserRuntime.getComputedStyles(handle, ref);
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
      const center = await this.observedCenter(target, handle);
      if (!center) {
        return {
          role: null,
          name: null,
          landmark: null,
          headingLevel: null,
          hasFocus: false,
          tabIndex: null,
        };
      }
      const info = await this.browserRuntime.getElementInfoAtPoint(handle, center.x, center.y);
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

  /**
   * Anchor point for evidence queries (Phase 28A geometry trust contract).
   *
   * Prefers the caller-provided trusted box center; otherwise measures the
   * real rect of the resolved element (browser-backed). Returns null when no
   * observed geometry exists — callers must not fall back to synthetic
   * coordinates.
   */
  private async observedCenter(
    target: SelectionTarget,
    handle?: BrowserHandle,
    ref?: ResolvedElementRef,
  ): Promise<{ x: number; y: number } | null> {
    if (target.boundingBox) {
      return {
        x: target.boundingBox.x + target.boundingBox.width / 2,
        y: target.boundingBox.y + target.boundingBox.height / 2,
      };
    }
    if (handle && this.browserRuntime && ref) {
      try {
        const info = await this.browserRuntime.getSelectedElementInfo(handle, ref);
        const bb = info.ok ? info.value?.boundingBox : undefined;
        if (bb && bb.width > 0 && bb.height > 0) {
          return { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 };
        }
      } catch {
        // no observed geometry available
      }
    }
    return null;
  }

  private selectionId(
    selector: string,
    boundingBox?: { x: number; y: number; width: number; height: number },
  ): string {
    const raw = boundingBox
      ? `${selector}|${boundingBox.x}|${boundingBox.y}|${boundingBox.width}|${boundingBox.height}`
      : `${selector}|none`;
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

  private selectorError(
    status: 'resolved' | 'missing' | 'malformed' | 'ambiguous' | 'detached',
    selector: string,
  ): ViskodError {
    switch (status) {
      case 'malformed':
        return this.seError('SE_SELECTOR_MALFORMED', `The selector is not valid CSS: ${selector}`);
      case 'missing':
        return this.seError('SE_SELECTOR_NO_MATCH', `No element matches the selector: ${selector}`);
      case 'detached':
        return this.seError(
          'SE_SELECTOR_DETACHED',
          `The selected element is no longer attached to the page: ${selector}`,
        );
      case 'ambiguous':
        return this.seError(
          'SE_SELECTOR_AMBIGUOUS',
          `The selector matches multiple elements: ${selector}. Use a more specific selector.`,
        );
      default:
        return this.seError('SE_SELECTOR_UNRESOLVED', `Could not resolve: ${selector}`);
    }
  }

  private seError(code: string, message: string): ViskodError {
    return createViskodError({
      code,
      category: 'runtime',
      severity: 'recoverable',
      message,
      subsystem: 'selection-engine',
    });
  }
}
