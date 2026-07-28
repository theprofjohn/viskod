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

const SCHEMA_VERSION = '1.0.0';

export type { SelectionTarget, SelectionSnapshot, SelectionEngineHealth } from './types';

export class SelectionEngine {
  private eventBus: EventBus;
  private selectionsProcessed = 0;
  private selectionsFailed = 0;
  private processingTimes: number[] = [];
  private activeSelection: SelectionTarget | null = null;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
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

  async validateSelection(target: SelectionTarget): Promise<Result<SelectionSnapshot>> {
    const startTime = Date.now();
    const correlationId = crypto.randomUUID();

    try {
      const hierarchyResult = await this.buildHierarchy(target);
      if (!hierarchyResult.ok) {
        this.selectionsFailed++;
        this.processingTimes.push(Date.now() - startTime);
        return err(hierarchyResult.error);
      }

      const geometry = this.computeGeometry(target);
      const visibility = this.computeVisibility();
      const accessibility = this.computeAccessibility();
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

  async buildHierarchy(target: SelectionTarget): Promise<Result<HierarchyRoot>> {
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

  private computeGeometry(target: SelectionTarget): SelectionGeometry {
    return {
      boundingBox: target.boundingBox,
      visibleRegion: target.boundingBox,
      clipState: 'visible',
      viewportIntersectionRatio: 1.0,
    };
  }

  private computeVisibility(): VisibilityReport {
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

  private computeAccessibility(): AccessibilityInfo {
    return {
      role: null,
      name: null,
      landmark: null,
      headingLevel: null,
      hasFocus: false,
      tabIndex: null,
    };
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
