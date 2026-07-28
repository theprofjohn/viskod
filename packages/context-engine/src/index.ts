import type { Result, BoundingBox } from '@viskod/shared';
import { ok, err, ErrorCategory, ErrorSeverity } from '@viskod/shared';
import type { ViskodError } from '@viskod/shared';
import type { EventBus } from '@viskod/event-bus';
import type { BrowserRuntime, BrowserHandle } from '@viskod/browser-runtime';
import type { CapturePipeline } from '@viskod/capture-pipeline';

// ---- Selection Target (P0 — when selection-engine P1, this enriches) ----
export interface SelectionTarget {
  selector: string;
  boundingBox: BoundingBox;
}

// ---- Context Packet (from SPEC-006) ----
export interface ContextPacket {
  packetId: string;
  schemaVersion: string;
  timestamp: string;
  captureId: string;
  browser: {
    url: string;
    viewport: { width: number; height: number; deviceScaleFactor: number };
    userAgent: string;
  };
  selection: { selector: string; tagName: string; boundingBox: BoundingBox; text?: string };
  dom: { tagName: string; attributes: Record<string, string>; childCount: number; depth: number };
  styles: { computed: Record<string, string>; layout: LayoutInfo };
  hierarchy: {
    selectedNode: HierarchyNode;
    parents: HierarchyNode[];
    siblings: HierarchyNode[];
    children: HierarchyNode[];
  };
  screenshots: ScreenshotInfo[];
  confidence: {
    sourceMapping: number;
    semanticLabeling: number;
    layoutAnalysis: number;
    frameworkDetection: number;
  };
  metadata: {
    engineVersion: string;
    processingTimeMs: number;
    evidenceSources: string[];
    redactions: string[];
  };
  project?: { name: string; root: string; framework?: string };
  diagnostics: { subsystem: string; status: string; errors: ViskodError[] }[];
  sourceHints: SourceHint[];
}

interface LayoutInfo {
  display: string;
  position: string;
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
  padding: { top: number; right: number; bottom: number; left: number };
}
interface HierarchyNode {
  tagName: string;
  depth: number;
  text?: string;
}
interface ScreenshotInfo {
  captureId: string;
  type: string;
  path: string;
  width: number;
  height: number;
  format: string;
  sizeBytes: number;
}
interface SourceHint {
  filePath: string;
  confidence: number;
  evidence: string;
}

export interface VCEHealth {
  status: 'healthy' | 'degraded' | 'unavailable';
  packetsGenerated: number;
  lastProcessingTimeMs: number;
  averageProcessingTimeMs: number;
  failedCount: number;
}

export interface VCECreationOptions {
  browserRuntime: BrowserRuntime;
  eventBus: EventBus;
  capturePipeline?: CapturePipeline;
  projectScanner?: unknown; // P1: optional
}

// ---- Visual Context Engine ----
export class VisualContextEngine {
  private browserRuntime: BrowserRuntime;
  private eventBus: EventBus;
  private capturePipeline?: CapturePipeline;
  private packetsGenerated = 0;
  private failedCount = 0;
  private processingTimes: number[] = [];

  constructor(options: VCECreationOptions) {
    this.browserRuntime = options.browserRuntime;
    this.eventBus = options.eventBus;
    this.capturePipeline = options.capturePipeline;

    // VCE subscribes to BR events through Event Bus (event flow)
    // NEVER receives direct callbacks from BR
    this.eventBus.subscribe('BR_EVENT:CAPTURE_COMPLETED', async (event) => {
      const payload = event.payload as { captureId: string };
      // Process capture when BR completes — but do NOT import BR internals
    });
  }

  async generatePacket(
    handle: BrowserHandle,
    selection?: SelectionTarget,
  ): Promise<Result<ContextPacket>> {
    const startTime = Date.now();
    const packetId = crypto.randomUUID();

    try {
      // Stage 1: Collection — gather evidence from BR (command flow: VCE → BR)
      const evidenceSources: string[] = ['browser-runtime'];
      const redactions: string[] = [];

      let domSnapshot;
      let styleSnapshot;
      let screenshot;

      if (selection) {
        const domResult = await this.browserRuntime.getDOMSnapshot(handle, selection.selector);
        if (domResult.ok) domSnapshot = domResult.value;
        else return err(domResult.error);

        const styleResult = await this.browserRuntime.getComputedStyles(handle, selection.selector);
        if (styleResult.ok) styleSnapshot = styleResult.value;

        const captureResult = await this.browserRuntime.captureScreenshot(handle, 'selection');
        if (captureResult.ok) screenshot = captureResult.value;
      }

      // Stage 2: Validation — ensure required evidence present
      if (!domSnapshot) {
        return err(this.vceError('VCE_MISSING_BROWSER_EVIDENCE', 'No DOM evidence available'));
      }

      // Stage 3: Normalisation — canonical representations (simplified P0)
      // Stage 4: Structural Analysis — parent-child, siblings, depth
      const hierarchy = this.buildHierarchy(domSnapshot, selection);

      // Stage 5: Visual Analysis — layout, alignment (simplified P0)
      // Stage 6: Semantic Analysis — labels (stub for P0)
      // Stage 7: Confidence Evaluation
      const confidence = {
        sourceMapping: 0.0, // P1: source-hint-engine
        semanticLabeling: 0.5, // stub
        layoutAnalysis: 0.8, // basic layout available
        frameworkDetection: 0.0, // P1: project-scanner
      };

      // Stage 8: Packet Assembly — combine everything
      const packet: ContextPacket = {
        packetId,
        schemaVersion: '1.0.0',
        timestamp: new Date().toISOString(),
        captureId: screenshot?.captureId ?? packetId,
        browser: {
          url: '',
          viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
          userAgent: 'Viskod/1.0',
        },
        selection: selection
          ? {
              selector: selection.selector,
              tagName: domSnapshot.tagName,
              boundingBox: selection.boundingBox,
              text: domSnapshot.text?.slice(0, 500),
            }
          : { selector: '', tagName: '', boundingBox: { x: 0, y: 0, width: 0, height: 0 } },
        dom: {
          tagName: domSnapshot.tagName,
          attributes: domSnapshot.attributes,
          childCount: domSnapshot.children.length,
          depth: 0,
        },
        styles: {
          computed: styleSnapshot?.computed ?? {},
          layout: {
            display: 'block',
            position: 'static',
            width: 0,
            height: 0,
            margin: { top: 0, right: 0, bottom: 0, left: 0 },
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
          },
        },
        hierarchy: {
          selectedNode: hierarchy.selectedNode,
          parents: hierarchy.parents,
          siblings: hierarchy.siblings,
          children: hierarchy.children,
        },
        screenshots: screenshot
          ? [
              {
                captureId: screenshot.captureId,
                type: 'selection',
                path: screenshot.path,
                width: screenshot.width,
                height: screenshot.height,
                format: screenshot.format,
                sizeBytes: screenshot.sizeBytes,
              },
            ]
          : [],
        confidence,
        metadata: {
          engineVersion: '1.0.0',
          processingTimeMs: Date.now() - startTime,
          evidenceSources,
          redactions,
        },
        diagnostics: [],
        sourceHints: [],
      };

      // Persist via Capture Pipeline (if available, P1 optional)
      if (this.capturePipeline && screenshot) {
        await this.capturePipeline.persistCapture(
          { packetId: packet.packetId },
          [
            {
              captureId: screenshot.captureId,
              type: 'selection' as const,
              buffer: Buffer.alloc(0),
              format: screenshot.format as 'png',
              width: screenshot.width,
              height: screenshot.height,
            },
          ],
          packet.browser.url,
          packet.browser.viewport,
        );
      }

      this.packetsGenerated++;
      const procTime = Date.now() - startTime;
      this.processingTimes.push(procTime);

      // Publish ContextPacketGenerated event
      this.eventBus.publish({
        eventId: crypto.randomUUID(),
        eventType: 'VCE_EVENT:CONTEXT_PACKET_GENERATED',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        source: 'visual-context-engine',
        correlationId: packetId,
        payload: { packetId, processingTimeMs: procTime },
      });

      return ok(packet);
    } catch (error) {
      this.failedCount++;
      this.eventBus.publish({
        eventId: crypto.randomUUID(),
        eventType: 'VCE_EVENT:PROCESSING_FAILED',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        source: 'visual-context-engine',
        correlationId: packetId,
        payload: { error: String(error) },
      });
      return err(this.vceError('VCE_ASSEMBLY_FAILED', 'Unexpected error during packet generation'));
    }
  }

  async processCapture(captureId: string, handle: BrowserHandle): Promise<Result<ContextPacket>> {
    return this.generatePacket(handle);
  }

  async processSelection(
    handle: BrowserHandle,
    selection: SelectionTarget,
  ): Promise<Result<ContextPacket>> {
    return this.generatePacket(handle, selection);
  }

  health(): VCEHealth {
    const avg =
      this.processingTimes.length > 0
        ? this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length
        : 0;
    return {
      status: 'healthy',
      packetsGenerated: this.packetsGenerated,
      lastProcessingTimeMs: this.processingTimes[this.processingTimes.length - 1] ?? 0,
      averageProcessingTimeMs: avg,
      failedCount: this.failedCount,
    };
  }

  private buildHierarchy(dom: { tagName: string }, selection?: SelectionTarget) {
    return {
      selectedNode: { tagName: dom.tagName, depth: 0 },
      parents: [] as HierarchyNode[],
      siblings: [] as HierarchyNode[],
      children: [] as HierarchyNode[],
    };
  }

  // VCE NEVER imports Playwright or Chromium
  private vceError(code: string, message: string): ViskodError {
    return {
      code,
      category: ErrorCategory.RUNTIME,
      severity: ErrorSeverity.RECOVERABLE,
      message,
      correlationId: crypto.randomUUID(),
      subsystem: 'visual-context-engine',
      timestamp: new Date().toISOString(),
    };
  }
}
