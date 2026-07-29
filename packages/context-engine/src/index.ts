import * as path from 'node:path';
import type {
  BrowserHandle,
  BrowserRuntime,
  DOMSnapshot,
  ElementHierarchy,
  RuntimeEvidence,
  Screenshot,
  StyleSnapshot,
} from '@viskod/browser-runtime';
import {
  DEFAULT_TRUNCATION,
  redactEvidence,
  truncateConsoleEntries,
  truncateNetworkEntries,
  truncateSelectedElement,
} from '@viskod/browser-runtime';
import type { CapturePipeline } from '@viskod/capture-pipeline';
import type { EventBus } from '@viskod/event-bus';
import type { SelectionEngine, SelectionTarget } from '@viskod/selection-engine';
import type { BaseEvent, BoundingBox, Result } from '@viskod/shared';
import { ErrorCategory, ErrorSeverity, err, ok } from '@viskod/shared';
import type { ViskodError } from '@viskod/shared';
import type { SourceHintEngine } from '@viskod/source-hint-engine';

export type { SelectionTarget } from '@viskod/selection-engine';

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
  sourceHints: SourceHintEntry[];
  runtimeEvidence?: RuntimeEvidence;
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
  captureDir?: string;
  absoluteCaptureDir?: string;
}

interface SourceHintEntry {
  filePath: string;
  confidence: number;
  evidence: string;
  isPrimary?: boolean;
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
  selectionEngine?: SelectionEngine;
  sourceHintEngine?: SourceHintEngine;
}

export class VisualContextEngine {
  private browserRuntime: BrowserRuntime;
  private eventBus: EventBus;
  private capturePipeline?: CapturePipeline;
  private selectionEngine?: SelectionEngine;
  private sourceHintEngine?: SourceHintEngine;
  private currentHandle: BrowserHandle | null = null;
  private currentUrl = '';
  private packetsGenerated = 0;
  private failedCount = 0;
  private processingTimes: number[] = [];
  private isProcessingFromEvent = false;
  private projectScan: {
    projectId: string;
    name: string;
    rootPath: string;
    directories: string[];
    primaryFramework: string | null;
    detectedFrameworks: string[];
    frameworkConfidence: number;
  } | null = null;

  constructor(options: VCECreationOptions) {
    this.browserRuntime = options.browserRuntime;
    this.eventBus = options.eventBus;
    this.capturePipeline = options.capturePipeline;
    this.selectionEngine = options.selectionEngine;
    this.sourceHintEngine = options.sourceHintEngine;

    this.eventBus.subscribe('BR_EVENT:CAPTURE_COMPLETED', async (_event: BaseEvent) => {
      // Process capture when BR completes
    });

    this.eventBus.subscribe('SE_EVENT:SELECTION_CHANGED', async (event: BaseEvent) => {
      if (this.isProcessingFromEvent) return;
      this.isProcessingFromEvent = true;
      try {
        const payload = event.payload as { selectionId: string; selector: string };
        if (payload.selectionId) {
          await this.processSelection({
            selector: payload.selector ?? payload.selectionId,
            boundingBox: { x: 0, y: 0, width: 0, height: 0 },
            source: 'overlay' as const,
          });
        }
      } finally {
        this.isProcessingFromEvent = false;
      }
    });
  }

  async start(): Promise<Result<BrowserHandle>> {
    return this.startBrowser();
  }

  async startBrowser(): Promise<Result<BrowserHandle>> {
    const result = await this.browserRuntime.launch();
    if (result.ok) {
      this.currentHandle = result.value;
    }
    return result;
  }

  async navigate(url: string): Promise<Result<void>> {
    if (!this.currentHandle) {
      return err(this.vceError('VCE_NO_BROWSER', 'Browser not started'));
    }
    this.currentUrl = url;
    const result = await this.browserRuntime.navigate(this.currentHandle, url);
    if (!result.ok) return err(result.error);
    return ok(undefined);
  }

  async stopBrowser(): Promise<Result<void>> {
    if (!this.currentHandle) return ok(undefined);
    const result = await this.browserRuntime.shutdown(this.currentHandle);
    if (result.ok) this.currentHandle = null;
    return result;
  }

  async generatePacket(selection?: SelectionTarget): Promise<Result<ContextPacket>> {
    if (!this.currentHandle) {
      return err(this.vceError('VCE_NO_BROWSER', 'Browser not started'));
    }

    const startTime = Date.now();
    const packetId = crypto.randomUUID();
    const handle = this.currentHandle;

    try {
      const evidenceSources: string[] = ['browser-runtime'];
      const redactions: string[] = [];

      let domSnapshot: DOMSnapshot | undefined;
      let styleSnapshot: StyleSnapshot | undefined;
      let captureScreenshot: Screenshot | undefined;
      let runtimeEvidence: RuntimeEvidence | undefined;
      let hierarchyFromSelection:
        | {
            selectedNode: { tagName: string; depth: number };
            parents: HierarchyNode[];
            siblings: HierarchyNode[];
            children: HierarchyNode[];
          }
        | undefined;
      let browserHierarchy: ElementHierarchy | undefined;

      if (selection) {
        // Use Selection Engine for hierarchy when available
        if (this.selectionEngine) {
          const selResult = await this.selectionEngine.validateSelection(selection);
          if (selResult.ok) {
            const snapshot = selResult.value;
            hierarchyFromSelection = {
              selectedNode: {
                tagName: snapshot.hierarchy.selectedNode.tagName,
                depth: snapshot.hierarchy.selectedNode.depth,
              },
              parents: snapshot.hierarchy.parents.map((p) => ({
                tagName: p.tagName,
                depth: p.depth,
              })),
              siblings: snapshot.hierarchy.siblings.map((s) => ({
                tagName: s.tagName,
                depth: s.depth,
              })),
              children: snapshot.hierarchy.children.map((c) => ({
                tagName: c.tagName,
                depth: c.depth,
              })),
            };
            evidenceSources.push('selection-engine');
          }
        }

        const domResult = await this.browserRuntime.getDOMSnapshot(handle, selection.selector);
        if (domResult.ok) domSnapshot = domResult.value;

        // Get real DOM hierarchy from the browser
        const hierarchyResult = await this.browserRuntime.getElementHierarchy(
          handle,
          selection.selector,
        );
        if (hierarchyResult.ok) {
          browserHierarchy = hierarchyResult.value;
          evidenceSources.push('browser-runtime:hierarchy');
        }

        const styleResult = await this.browserRuntime.getComputedStyles(handle, selection.selector);
        if (styleResult.ok) styleSnapshot = styleResult.value;

        const captureResult = await this.browserRuntime.captureScreenshot(handle, 'selection');
        if (captureResult.ok) captureScreenshot = captureResult.value;

        // Collect runtime evidence
        const consoleResult = await this.browserRuntime.captureConsoleLogs(handle);
        const networkResult = await this.browserRuntime.captureNetworkRequests(handle);
        const elementResult = await this.browserRuntime.getSelectedElementInfo(
          handle,
          selection.selector,
        );

        const rawEvidence: RuntimeEvidence = {};
        if (consoleResult.ok) rawEvidence.console = consoleResult.value;
        if (networkResult.ok) rawEvidence.network = networkResult.value;
        if (elementResult.ok) rawEvidence.selectedElement = elementResult.value;

        // Apply redaction
        const { evidence: redactedEvidence, redactions: evidenceRedactions } =
          redactEvidence(rawEvidence);
        for (const r of evidenceRedactions) {
          if (!redactions.includes(r)) redactions.push(r);
        }

        // Apply truncation
        const truncation = DEFAULT_TRUNCATION;
        runtimeEvidence = {};
        if (redactedEvidence.console)
          runtimeEvidence.console = truncateConsoleEntries(redactedEvidence.console, truncation);
        if (redactedEvidence.network)
          runtimeEvidence.network = truncateNetworkEntries(redactedEvidence.network, truncation);
        if (redactedEvidence.selectedElement)
          runtimeEvidence.selectedElement = truncateSelectedElement(
            redactedEvidence.selectedElement,
            truncation,
          );

        evidenceSources.push('browser-runtime:evidence');
      }

      const domData = domSnapshot ?? {
        tagName: 'unknown',
        attributes: {} as Record<string, string>,
        boundingBox: { x: 0, y: 0, width: 0, height: 0 },
        children: [] as DOMSnapshot[],
      };

      const hierarchy = browserHierarchy
        ? {
            selectedNode: {
              tagName: browserHierarchy.selectedNode.tagName,
              depth: browserHierarchy.selectedNode.depth,
            },
            parents: browserHierarchy.parents.map((p) => ({ tagName: p.tagName, depth: p.depth })),
            siblings: browserHierarchy.siblings.map((s) => ({
              tagName: s.tagName,
              depth: s.depth,
            })),
            children: browserHierarchy.children.map((c) => ({
              tagName: c.tagName,
              depth: c.depth,
            })),
          }
        : (hierarchyFromSelection ?? this.buildHierarchy(domData, selection));

      const sourceHints: SourceHintEntry[] = [];

      // Populate source hints via SourceHintEngine when available
      if (this.sourceHintEngine && selection && domSnapshot) {
        try {
          const hintInput = {
            domContext: {
              tagName: domSnapshot.tagName,
              className: domSnapshot.attributes.class,
              id: domSnapshot.attributes.id,
              role: domSnapshot.attributes.role,
              text: domSnapshot.text,
              parentTagName: hierarchy.parents[0]?.tagName,
            },
            route: {
              url: this.currentUrl,
              pathname: new URL(this.currentUrl).pathname,
            },
            project: {
              metadata: {
                projectId: this.projectScan?.projectId ?? 'unknown',
                name: this.projectScan?.name ?? 'unknown',
                rootPath: this.projectScan?.rootPath ?? '',
                packageManager: 'unknown',
                language: 'typescript',
              },
              componentIndex: this.projectScan
                ? { directories: this.projectScan.directories }
                : undefined,
              framework: this.projectScan
                ? {
                    primary: this.projectScan.primaryFramework,
                    detected: this.projectScan.detectedFrameworks,
                    confidence: this.projectScan.frameworkConfidence,
                  }
                : undefined,
            },
            captureId: packetId,
          };
          const hintResult = await this.sourceHintEngine.generateHints(hintInput);
          if (hintResult.ok) {
            for (const hint of hintResult.value) {
              sourceHints.push({
                filePath: hint.filePath,
                confidence: hint.confidence,
                evidence: hint.evidence.map((e) => e.detail).join('; '),
                isPrimary: hint.isPrimary,
              });
            }
          }
        } catch {
          // Hint generation is best-effort
        }
      }

      const confidence = {
        sourceMapping: 0.0,
        semanticLabeling: 0.5,
        layoutAnalysis: styleSnapshot ? 0.8 : 0.3,
        frameworkDetection: 0.0,
      };

      const packet: ContextPacket = {
        packetId,
        schemaVersion: '1.0.0',
        timestamp: new Date().toISOString(),
        captureId: captureScreenshot?.captureId ?? packetId,
        browser: {
          url: this.currentUrl,
          viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
          userAgent: 'Viskod/1.0',
        },
        selection: selection
          ? {
              selector: selection.selector,
              tagName: domData.tagName,
              boundingBox: domData.boundingBox,
              text: domData.text?.slice(0, 500),
            }
          : { selector: '', tagName: '', boundingBox: { x: 0, y: 0, width: 0, height: 0 } },
        dom: {
          tagName: domData.tagName,
          attributes: domData.attributes,
          childCount: domData.children.length,
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
        screenshots: captureScreenshot
          ? [
              {
                captureId: captureScreenshot.captureId,
                type: 'selection',
                path: captureScreenshot.path,
                width: captureScreenshot.width,
                height: captureScreenshot.height,
                format: captureScreenshot.format,
                sizeBytes: captureScreenshot.sizeBytes,
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
        sourceHints,
        runtimeEvidence,
      };

      // Persist via Capture Pipeline
      if (this.capturePipeline && captureScreenshot) {
        try {
          const persistResult = await this.capturePipeline.persistCapture(
            { packetId: packet.packetId },
            [
              {
                captureId: captureScreenshot.captureId,
                type: 'selection' as const,
                buffer: captureScreenshot.buffer,
                format: captureScreenshot.format as 'png',
                width: captureScreenshot.width,
                height: captureScreenshot.height,
              },
            ],
            packet.browser.url,
            packet.browser.viewport,
          );
          if (persistResult.ok) {
            const absoluteDir = persistResult.value.captureDir;
            const projectRoot = this.projectScan?.rootPath;
            const relativeDir = projectRoot ? path.relative(projectRoot, absoluteDir) : absoluteDir;
            packet.screenshots = packet.screenshots.map((s) => ({
              ...s,
              captureDir: relativeDir,
              absoluteCaptureDir: absoluteDir,
              path: `${s.type}.${s.format}`,
            }));
          }
        } catch {
          // Capture persistence is best-effort
        }
      }

      this.packetsGenerated++;
      const procTime = Date.now() - startTime;
      this.processingTimes.push(procTime);

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

  async processCapture(_captureId: string): Promise<Result<ContextPacket>> {
    if (!this.currentHandle) {
      return err(this.vceError('VCE_NO_BROWSER', 'Browser not started'));
    }
    return this.generatePacket();
  }

  async processSelection(selection: SelectionTarget): Promise<Result<ContextPacket>> {
    return this.generatePacket(selection);
  }

  getLastPacket(): ContextPacket | null {
    return null;
  }

  setProjectContext(context: {
    rootPath: string;
    projectId: string;
    name: string;
    directories: string[];
    primaryFramework: string | null;
    detectedFrameworks: string[];
    frameworkConfidence: number;
  }): void {
    this.projectScan = context;
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

  private buildHierarchy(dom: { tagName: string }, _selection?: SelectionTarget) {
    return {
      selectedNode: { tagName: dom.tagName, depth: 0 },
      parents: [] as HierarchyNode[],
      siblings: [] as HierarchyNode[],
      children: [] as HierarchyNode[],
    };
  }

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
