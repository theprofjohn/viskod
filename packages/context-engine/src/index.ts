import type {
  BrowserHandle,
  BrowserRuntime,
  DOMSnapshot,
  ElementHierarchy,
  ResolvedElementRef,
  RuntimeEvidence,
  Screenshot,
  StyleSnapshot,
} from '@viskod/browser-runtime';
import {
  type ProfileConfig,
  redactEvidence,
  resolveProfile,
  truncateConsoleEntries,
  truncateNetworkEntries,
  truncateSelectedElement,
} from '@viskod/browser-runtime';
import type { CapturePipeline } from '@viskod/capture-pipeline';
import type { EventBus } from '@viskod/event-bus';
import type { SelectionEngine, SelectionTarget } from '@viskod/selection-engine';
import type { BaseEvent, BoundingBox, Result, WorkspaceMetadata } from '@viskod/shared';
import { createViskodError, err, ok, sanitizeErrorDetail } from '@viskod/shared';
import type { ViskodError } from '@viskod/shared';
import type { SourceHintEngine } from '@viskod/source-hint-engine';
import { SOURCE_HINT_SCHEMA_VERSION, computeSourceResolution } from '@viskod/source-hint-engine';
import type { SourceQualification, SourceResolution } from '@viskod/source-hint-engine';
import {
  COLLECTED,
  DISABLED,
  UNAVAILABLE,
  deriveCaptureIntegrity,
  failedStatus,
  omittedSensitiveStatus,
  unavailableStatus,
} from './evidence-status';
import type { EvidenceMap, EvidenceStatus } from './evidence-status';
import { redactPacketForPersistence } from './packet-redaction';

export type { SelectionTarget } from '@viskod/selection-engine';
export { generateExport } from './agent-exporter';
export type { ExportFormat, ExportOptions, CompactPacket } from './agent-exporter';
export { buildAgentContextProjection } from './agent-projection';
export type {
  AgentContextProjection,
  ProjectionOptions,
  ProjectionPacketSource,
} from './agent-projection';
export {
  deriveCaptureIntegrity,
  failedStatus,
  omittedSensitiveStatus,
  unavailableStatus,
} from './evidence-status';
export type {
  CaptureIntegrity,
  EvidenceDiagnostic,
  EvidenceMap,
  EvidenceProvider,
  EvidenceState,
  EvidenceStatus,
} from './evidence-status';
export { redactPacketForPersistence } from './packet-redaction';

export interface ContextPacket {
  packetId: string;
  /** 1.1.0 — capture integrity/evidence status; persisted records are explicitly versioned. */
  schemaVersion: string;
  timestamp: string;
  /** Durable opaque capture id (persisted capture directory id). */
  captureId: string;
  /** Complete / partial. Failed captures never return a packet. */
  captureStatus: 'complete' | 'partial';
  /** Per-provider evidence availability. */
  evidence: EvidenceMap;
  browser: {
    url: string;
    viewport: { width: number; height: number; deviceScaleFactor: number };
    userAgent: string;
  };
  selection: { selector: string; tagName: string; boundingBox: BoundingBox; text?: string };
  dom: { tagName: string; attributes: Record<string, string>; childCount: number; depth: number };
  styles: { computed: Record<string, string>; layout: LayoutInfo | null };
  hierarchy: {
    selectedNode: HierarchyNode;
    parents: HierarchyNode[];
    siblings: HierarchyNode[];
    children: HierarchyNode[];
  };
  screenshots: ScreenshotInfo[];
  /**
   * Provider confidence. `null` = the provider never ran / no observation
   * exists — never a fabricated number that looks like a calculation.
   */
  confidence: {
    sourceMapping: number | null;
    semanticLabeling: number | null;
    layoutAnalysis: number | null;
    frameworkDetection: number | null;
  };
  metadata: {
    engineVersion: string;
    processingTimeMs: number;
    evidenceSources: string[];
    redactions: string[];
    capturePolicy?: { screenshot: 'omitted_sensitive' | 'raw_sensitive' };
  };
  project?: { name: string; root: string; framework?: string };
  diagnostics: { subsystem: string; status: string; errors: ViskodError[] }[];
  sourceHints: SourceHintEntry[];
  /**
   * Phase 30A: capture-time source-resolution SNAPSHOT.
   *
   * Persisted with the packet so a fresh process reports exactly what Viskod
   * concluded at capture time — resolution is never recomputed under future
   * ranking rules. `status` is the Phase 30 resolution
   * (resolved/ambiguous/unavailable), `modelVersion` is the source-hint
   * schema/model version that produced it, and `topCandidate` is the
   * repository-relative path of the top candidate (when one exists).
   */
  sourceHintsResolution?: {
    status: SourceResolution;
    modelVersion: string;
    topCandidate?: string;
  };
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
  /** Final persisted artifact reference (capture-relative) or null when the screenshot was not persisted. */
  path: string | null;
  width: number;
  height: number;
  format: string;
  sizeBytes: number;
  /** omitted_sensitive when privacy policy skipped raw pixels; collected when persisted raw. */
  status?: 'collected' | 'omitted_sensitive';
  /** True whenever the artifact carries raw (unmasked) pixels. */
  sensitive?: boolean;
}

interface SourceHintEntry {
  filePath: string;
  confidence: number;
  evidence: string;
  isPrimary?: boolean;
  exists?: boolean;
  matchType?: string;
  reason?: string;
  relatedSelector?: string;
  kind?: string;
  status?: string;
  displayPath?: string;
  location?: { line?: number; column?: number };
  symbol?: { componentName?: string; jsxTag?: string };
  route?: { routePath?: string; routeFile?: string; isCurrentRoute?: boolean };
  ranking?: {
    score: number;
    confidence: number;
    rank: number;
    reasons: string[];
    penalties: string[];
  };
  safety?: { redactionApplied: boolean; userVisible: boolean; containsAbsolutePath: boolean };
  /** Phase 30: semantic qualification derived from evidence. */
  qualification?: SourceQualification;
  /** Phase 30: concise evidence reasons (bounded). */
  reasons?: string[];
}

export interface VCEHealth {
  status: 'healthy' | 'degraded' | 'unavailable';
  packetsGenerated: number;
  lastProcessingTimeMs: number;
  averageProcessingTimeMs: number;
  failedCount: number;
}

/**
 * Screenshot privacy policy (Phase 29).
 *
 * - `agent-safe-omit` (default): raw screenshot pixels exist only transiently
 *   in memory during capture. The persisted safe capture records screenshot
 *   metadata with status `omitted_sensitive` and never writes the raw image.
 * - `persist-raw`: explicit opt-in. The raw image is persisted and every
 *   screenshot entry is marked `sensitive: true`; it is NEVER represented as
 *   redacted.
 */
export type ScreenshotPolicy =
  | { mode: 'agent-safe-omit' }
  | { mode: 'persist-raw'; reason: string };

export interface VCECreationOptions {
  browserRuntime: BrowserRuntime;
  eventBus: EventBus;
  capturePipeline?: CapturePipeline;
  selectionEngine?: SelectionEngine;
  sourceHintEngine?: SourceHintEngine;
  screenshotPolicy?: ScreenshotPolicy;
}

interface RouteMapRoute {
  path: string;
  file: string;
  type: string;
  isDynamic?: boolean;
}

/**
 * Deterministically match a pathname against the project route map.
 * Priority: exact path → dynamic route with the same segment count →
 * root route. Returns undefined when nothing matches (route unknown).
 */
function matchRouteFromMap(
  pathname: string,
  routes: RouteMapRoute[],
): { path: string; file: string; type: string; isDynamic: boolean } | undefined {
  if (routes.length === 0) return undefined;
  const normalized = pathname.replace(/\/+$/, '') || '/';

  const exact = routes.find((r) => r.path === normalized);
  if (exact) return { ...exact, isDynamic: exact.isDynamic ?? false };

  const segments = normalized.split('/').filter(Boolean);
  const dynamicMatches = routes
    .filter((r) => r.isDynamic)
    .map((r) => ({ route: r, count: r.path.split('/').filter(Boolean).length }))
    .filter((m) => m.count === segments.length)
    .sort((a, b) => a.route.path.localeCompare(b.route.path));
  const dynamic = dynamicMatches[0];
  if (dynamic) return { ...dynamic.route, isDynamic: true };

  const root = routes.find((r) => r.path === '/');
  if (root) return { ...root, isDynamic: false };
  return undefined;
}

export class VisualContextEngine {
  private browserRuntime: BrowserRuntime;
  private eventBus: EventBus;
  private capturePipeline?: CapturePipeline;
  private selectionEngine?: SelectionEngine;
  private sourceHintEngine?: SourceHintEngine;
  private captureProfile: ProfileConfig = resolveProfile('default');
  private currentHandle: BrowserHandle | null = null;
  private currentUrl = '';
  private packetsGenerated = 0;
  private failedCount = 0;
  private processingTimes: number[] = [];
  private isProcessingFromEvent = false;
  private isGeneratingPacket = false;
  private lastPacket: ContextPacket | null = null;
  private screenshotPolicy: ScreenshotPolicy = { mode: 'agent-safe-omit' };
  private overlayPollInterval: ReturnType<typeof setInterval> | null = null;
  /**
   * When true, overlay element events are consumed by the workflow's
   * SelectionOverlayController; the legacy auto-capture poller must not read
   * (and thereby clear) them.
   */
  private overlayEventsDelegated = false;
  private projectScan: {
    projectId: string;
    name: string;
    rootPath: string;
    directories: string[];
    primaryFramework: string | null;
    detectedFrameworks: string[];
    frameworkConfidence: number;
    routeMap?: {
      routes: Array<{ path: string; file: string; type: string; isDynamic?: boolean }>;
    };
    workspace?: WorkspaceMetadata;
  } | null = null;

  constructor(options: VCECreationOptions) {
    this.browserRuntime = options.browserRuntime;
    this.eventBus = options.eventBus;
    this.capturePipeline = options.capturePipeline;
    this.selectionEngine = options.selectionEngine;
    this.sourceHintEngine = options.sourceHintEngine;
    if (options.screenshotPolicy) this.screenshotPolicy = options.screenshotPolicy;

    this.eventBus.subscribe('SE_EVENT:SELECTION_CHANGED', async (event: BaseEvent) => {
      if (this.isProcessingFromEvent || this.isGeneratingPacket) return;
      this.isProcessingFromEvent = true;
      try {
        const payload = event.payload as { selectionId: string; selector: string };
        if (payload.selectionId) {
          // Phase 28A: the event carries no observed geometry — never
          // fabricate a box. A multi-match selector fails closed as ambiguous.
          await this.processSelection({
            selector: payload.selector ?? payload.selectionId,
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
      this.startOverlayPolling();
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

  async reloadPage(): Promise<Result<void>> {
    if (!this.currentHandle) {
      return err(this.vceError('VCE_NO_BROWSER', 'Browser not started'));
    }
    const result = await this.browserRuntime.reloadPage(this.currentHandle);
    if (!result.ok) return err(result.error);
    return ok(undefined);
  }

  async stopBrowser(): Promise<Result<void>> {
    this.stopOverlayPolling();
    if (!this.currentHandle) return ok(undefined);
    const result = await this.browserRuntime.shutdown(this.currentHandle);
    if (result.ok) this.currentHandle = null;
    return result;
  }

  async generatePacket(
    selection?: SelectionTarget,
    profile?: ProfileConfig,
    resolvedRef?: ResolvedElementRef,
  ): Promise<Result<ContextPacket>> {
    if (this.isGeneratingPacket) {
      return err(this.vceError('VCE_REENTRANT', 'generatePacket is not re-entrant'));
    }
    if (!this.currentHandle) {
      return err(this.vceError('VCE_NO_BROWSER', 'Browser not started'));
    }

    this.isGeneratingPacket = true;
    const startTime = Date.now();
    const packetId = crypto.randomUUID();
    // Durable opaque capture id: the persisted capture is the source of
    // truth after restart; this id links packet → capture.
    const captureId = crypto.randomUUID();
    const handle = this.currentHandle;

    try {
      const evidenceSources: string[] = ['browser-runtime'];
      const redactions: string[] = [];
      const evidence: EvidenceMap = {
        dom: DISABLED,
        hierarchy: DISABLED,
        styles: DISABLED,
        screenshot: DISABLED,
        runtime: DISABLED,
        sourceHints: DISABLED,
      };
      let runtimeCollected = false;
      let runtimeFailure: EvidenceStatus | null = null;

      // Phase 29: record ACTUAL browser/runtime observations. Synthetic
      // defaults (1280×720, 'Viskod/1.0', requested URL) are never emitted.
      let pageUrl = '';
      let viewportObs = { width: 0, height: 0, deviceScaleFactor: 1, scrollX: 0, scrollY: 0 };
      let userAgent = 'unavailable';
      try {
        pageUrl = await this.browserRuntime.getPageUrl(handle);
      } catch {
        /* page not reachable — 'unavailable' below */
      }
      try {
        viewportObs = await this.browserRuntime.getViewport(handle);
      } catch {
        /* viewport unavailable */
      }
      try {
        const ua = await this.browserRuntime.evaluate<string>(
          handle,
          () => navigator.userAgent,
          null,
        );
        userAgent = ua || 'unavailable';
      } catch {
        userAgent = 'unavailable';
      }

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

      const p = profile ?? this.captureProfile;
      if (selection) {
        // Fail closed on the core target (VISKOD-AUDIT-015): never fabricate
        // an "unknown" element because the selector did not resolve. Validate
        // against the live DOM before any evidence collection; invalid core
        // targets are typed errors, while optional evidence may still be
        // partial per existing contracts.
        //
        // Phase 28B: resolve the target ONCE to its actual DOM element and
        // collect every piece of target-scoped evidence through that exact
        // reference. Selector re-queries are never used for evidence, so a
        // geometry-disambiguated candidate can never be replaced by another
        // selector match mid-capture.
        let elementRef: ResolvedElementRef;
        if (resolvedRef) {
          elementRef = resolvedRef;
        } else {
          const resolution = await this.browserRuntime.resolveElement(
            handle,
            selection.selector,
            selection.boundingBox,
          );
          if (!resolution.ok) {
            return err(this.targetError('SELECTOR_RESOLUTION_FAILED', resolution.error.message));
          }
          if (resolution.value.status !== 'resolved') {
            return err(this.targetResolutionError(resolution.value.status, selection.selector));
          }
          elementRef = resolution.value;
        }

        try {
          // Use Selection Engine for hierarchy when available
          if (this.selectionEngine) {
            const selResult = await this.selectionEngine.validateSelection(
              selection,
              this.currentHandle ?? undefined,
              elementRef,
            );
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

          const domResult = await this.browserRuntime.getDOMSnapshot(handle, elementRef);
          if (domResult.ok) {
            domSnapshot = domResult.value;
            evidence.dom = COLLECTED;
          } else if (domResult.error.code === 'BR_ELEMENT_DETACHED') {
            // The resolved element detached during capture (Phase 28B): typed
            // failure — never silently fall back to another selector match.
            return err(this.targetResolutionError('detached', selection.selector));
          } else {
            // Core DOM evidence is required: fail closed, never fabricate.
            return err(
              this.targetError(
                'SELECTOR_NO_MATCH',
                `The selected element could not be captured: ${selection.selector}`,
              ),
            );
          }

          // Get real DOM hierarchy from the browser
          const hierarchyResult = await this.browserRuntime.getElementHierarchy(handle, elementRef);
          if (hierarchyResult.ok) {
            browserHierarchy = hierarchyResult.value;
            evidence.hierarchy = COLLECTED;
            evidenceSources.push('browser-runtime:hierarchy');
          }

          // Privacy/performance contract: disabled profile fields must not
          // perform browser work at all — gate before the browser call, not
          // after collecting and discarding the result.
          if (p.collectStyles) {
            const styleResult = await this.browserRuntime.getComputedStyles(handle, elementRef);
            if (styleResult.ok) {
              styleSnapshot = styleResult.value;
              evidence.styles = COLLECTED;
            } else {
              // Optional provider: record a sanitized failure, keep capture usable.
              evidence.styles = failedStatus(
                'styles',
                styleResult.error.code,
                sanitizeErrorDetail(styleResult.error.message),
              );
            }
          }

          if (p.collectScreenshot) {
            const captureResult = await this.browserRuntime.captureScreenshot(handle, 'selection');
            if (captureResult.ok) {
              captureScreenshot = captureResult.value;
              evidence.screenshot =
                this.screenshotPolicy.mode === 'agent-safe-omit'
                  ? omittedSensitiveStatus('screenshot')
                  : COLLECTED;
            } else {
              evidence.screenshot = failedStatus(
                'screenshot',
                captureResult.error.code,
                sanitizeErrorDetail(captureResult.error.message),
              );
            }
          }

          // Collect runtime evidence based on profile
          const rawEvidence: RuntimeEvidence = {};

          if (p.collectConsole) {
            const consoleResult = await this.browserRuntime.captureConsoleLogs(handle);
            if (consoleResult.ok) {
              rawEvidence.console = consoleResult.value;
              runtimeCollected = true;
            } else {
              runtimeFailure =
                runtimeFailure ??
                failedStatus(
                  'runtime',
                  consoleResult.error.code,
                  sanitizeErrorDetail(consoleResult.error.message),
                );
            }
          }
          if (p.collectNetwork) {
            const networkResult = await this.browserRuntime.captureNetworkRequests(handle);
            if (networkResult.ok) {
              rawEvidence.network = networkResult.value;
              runtimeCollected = true;
            } else {
              runtimeFailure =
                runtimeFailure ??
                failedStatus(
                  'runtime',
                  networkResult.error.code,
                  sanitizeErrorDetail(networkResult.error.message),
                );
            }
          }

          const elementResult = await this.browserRuntime.getSelectedElementInfo(
            handle,
            elementRef,
          );
          if (elementResult.ok && p.collectSelectedElement) {
            rawEvidence.selectedElement = elementResult.value;
            runtimeCollected = true;
          } else if (!elementResult.ok && p.collectSelectedElement) {
            runtimeFailure =
              runtimeFailure ??
              failedStatus(
                'runtime',
                elementResult.error.code,
                sanitizeErrorDetail(elementResult.error.message),
              );
          }

          // Aggregate runtime status: any sub-provider failure marks the
          // group failed with the first sanitized diagnostic; otherwise
          // collected when anything was collected, else disabled.
          evidence.runtime = runtimeFailure
            ? runtimeFailure
            : runtimeCollected
              ? COLLECTED
              : DISABLED;

          // Apply redaction (unless explicitly disabled with unsafe flag)
          const unsafe = p.enableRedaction === false;
          if (unsafe) {
            runtimeEvidence = rawEvidence;
          } else {
            const { evidence: redactedEvidence, redactions: evidenceRedactions } =
              redactEvidence(rawEvidence);
            for (const r of evidenceRedactions) {
              if (!redactions.includes(r)) redactions.push(r);
            }

            // Apply truncation
            const truncation = {
              maxConsoleEntries: p.maxConsoleEntries,
              maxNetworkEntries: p.maxNetworkEntries,
              maxMessageLength: p.maxMessageLength,
              maxUrlLength: 500,
              maxAttributeLength: 500,
            };
            runtimeEvidence = {};
            if (redactedEvidence.console)
              runtimeEvidence.console = truncateConsoleEntries(
                redactedEvidence.console,
                truncation,
              );
            if (redactedEvidence.network)
              runtimeEvidence.network = truncateNetworkEntries(
                redactedEvidence.network,
                truncation,
              );
            if (redactedEvidence.selectedElement)
              runtimeEvidence.selectedElement = truncateSelectedElement(
                redactedEvidence.selectedElement,
                truncation,
              );
          }

          evidenceSources.push('browser-runtime:evidence');
        } finally {
          // Release the consumed resolved-element reference (owned or
          // caller-provided): BrowserRuntime owns handle disposal. A parked
          // caller reference is consumed exactly once per capture.
          await this.browserRuntime.releaseElement(elementRef);
        }
      }

      if (selection && !domSnapshot) {
        // The selector resolved but the DOM snapshot could not be produced
        // (e.g. element detached between resolution and capture): fail closed
        // instead of emitting a fabricated "unknown" core target.
        return err(
          this.targetError(
            'SELECTOR_NO_MATCH',
            `The selected element could not be captured: ${selection.selector}`,
          ),
        );
      }

      if (!selection) {
        // No target: element-scoped providers have nothing to observe.
        // Explicitly unavailable rather than fabricated 'unknown' evidence.
        evidence.dom = UNAVAILABLE;
        evidence.hierarchy = UNAVAILABLE;
        evidence.styles = UNAVAILABLE;
        evidence.screenshot = UNAVAILABLE;
        evidence.sourceHints = UNAVAILABLE;
      } else if (evidence.hierarchy.state !== 'collected' && hierarchyFromSelection) {
        // Selection-engine hierarchy succeeded when the browser hierarchy did not.
        evidence.hierarchy = COLLECTED;
      } else if (evidence.hierarchy.state !== 'collected') {
        evidence.hierarchy = failedStatus(
          'hierarchy',
          'HIERARCHY_UNAVAILABLE',
          'Hierarchy collection failed',
        );
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
      let sourceHintsResolutionState: SourceResolution = 'unavailable';

      // Phase 29: source hints are reported as unavailable when no engine is
      // composed or no target exists — never silently omitted.
      if (!selection || !p.collectSourceHints) {
        evidence.sourceHints = p.collectSourceHints ? UNAVAILABLE : DISABLED;
        sourceHintsResolutionState = 'unavailable';
      } else if (!this.sourceHintEngine) {
        evidence.sourceHints = UNAVAILABLE;
        sourceHintsResolutionState = 'unavailable';
      }

      // Populate source hints via SourceHintEngine when available
      if (this.sourceHintEngine && selection && domSnapshot && p.collectSourceHints) {
        try {
          // Phase 30: derive the matched route from the established project
          // route map (never guessed) — exact path first, then dynamic
          // segment-shape matches, then the root route.
          let pathname = '/';
          try {
            pathname = new URL(pageUrl || this.currentUrl).pathname;
          } catch {
            pathname = '/';
          }
          const routes = this.projectScan?.routeMap?.routes ?? [];
          const matchedRoute = matchRouteFromMap(pathname, routes);

          const domAttributes = domSnapshot.attributes ?? {};
          const hintInput = {
            domContext: {
              tagName: domSnapshot.tagName,
              className: domAttributes.class,
              id: domAttributes.id,
              role: domAttributes.role,
              testId: domAttributes['data-testid'],
              dataAttributes: domAttributes,
              text: domSnapshot.text,
              parentTagName: hierarchy.parents[0]?.tagName,
            },
            route: {
              url: pageUrl || this.currentUrl,
              pathname,
              ...(matchedRoute ? { matchedRoute } : {}),
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
              workspace: this.projectScan?.workspace,
            },
            captureId: packetId,
          };
          const hintResult = await this.sourceHintEngine.generateHints(hintInput);
          if (hintResult.ok) {
            evidence.sourceHints = COLLECTED;
            const hints = hintResult.value;
            for (const hint of hints) {
              sourceHints.push({
                filePath: hint.filePath,
                confidence: hint.confidence,
                evidence: (hint.reasons ?? []).join('; ') || hint.reason,
                isPrimary: hint.isPrimary,
                exists: hint.exists,
                matchType: hint.matchType,
                reason: hint.reason,
                relatedSelector: hint.relatedSelector,
                kind: hint.kind,
                status: hint.status,
                displayPath: hint.filePath,
                location: hint.location,
                symbol: hint.symbol,
                route: hint.route,
                ranking: hint.ranking,
                safety: hint.safety,
                qualification: hint.qualification,
                reasons: (hint.reasons ?? []).slice(0, 3),
              });
            }
            sourceHintsResolutionState = computeSourceResolution(
              hints.map((h) => ({
                confidence: h.confidence,
                qualification: h.qualification,
                path: h.filePath,
              })),
            ).resolution;
          } else {
            // Phase 30: missing evidence / unknown root / budget exhaustion
            // are UNAVAILABLE (truthful), never fabricated or failed.
            // Phase 33A: cancellation is also typed unavailable, never failed.
            const code = hintResult.error.code;
            if (
              code === 'SH_INSUFFICIENT_EVIDENCE' ||
              code === 'SH_NO_PROJECT_METADATA' ||
              code === 'SH_NO_ROOT_PATH' ||
              code === 'SH_BUDGET_EXCEEDED' ||
              code === 'SH_SCAN_CANCELLED'
            ) {
              evidence.sourceHints = unavailableStatus(
                'sourceHints',
                code,
                sanitizeErrorDetail(hintResult.error.message),
              );
              sourceHintsResolutionState = 'unavailable';
            } else {
              evidence.sourceHints = failedStatus(
                'sourceHints',
                code,
                sanitizeErrorDetail(hintResult.error.message),
              );
              sourceHintsResolutionState = 'unavailable';
            }
          }
        } catch (error) {
          evidence.sourceHints = failedStatus(
            'sourceHints',
            'SOURCE_HINTS_FAILED',
            sanitizeErrorDetail(error instanceof Error ? error.message : String(error)),
          );
          sourceHintsResolutionState = 'unavailable';
        }
      } else if (!this.sourceHintEngine && selection && p.collectSourceHints) {
        sourceHintsResolutionState = 'unavailable';
      } else if (!selection || !p.collectSourceHints) {
        sourceHintsResolutionState = 'unavailable';
      }

      const confidence = {
        sourceMapping: null,
        semanticLabeling: null,
        layoutAnalysis: null,
        frameworkDetection: this.projectScan ? this.projectScan.frameworkConfidence : null,
      };

      const screenshotPolicyMode =
        this.screenshotPolicy.mode === 'agent-safe-omit' ? 'omitted_sensitive' : 'raw_sensitive';

      const packet: ContextPacket = {
        packetId,
        schemaVersion: '1.1.0',
        timestamp: new Date().toISOString(),
        captureId,
        captureStatus: deriveCaptureIntegrity(evidence),
        evidence,
        browser: {
          url: pageUrl || 'unavailable',
          viewport: {
            width: viewportObs.width,
            height: viewportObs.height,
            deviceScaleFactor: viewportObs.deviceScaleFactor,
          },
          userAgent,
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
          // No dedicated layout-analysis provider exists; null is explicit
          // "not observed", never fabricated default layout values.
          layout: null,
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
                // Final artifact reference decided BEFORE serialization:
                // null under the agent-safe policy (no file persisted),
                // 'selection.png' when raw persistence was explicitly opted in.
                path: this.screenshotPolicy.mode === 'agent-safe-omit' ? null : 'selection.png',
                width: captureScreenshot.width,
                height: captureScreenshot.height,
                format: captureScreenshot.format,
                sizeBytes:
                  this.screenshotPolicy.mode === 'agent-safe-omit'
                    ? 0
                    : captureScreenshot.sizeBytes,
                status:
                  this.screenshotPolicy.mode === 'agent-safe-omit'
                    ? 'omitted_sensitive'
                    : 'collected',
                sensitive: true,
              },
            ]
          : [],
        confidence,
        metadata: {
          engineVersion: '1.0.0',
          processingTimeMs: Date.now() - startTime,
          evidenceSources,
          redactions,
          capturePolicy: { screenshot: screenshotPolicyMode },
        },
        diagnostics: [],
        sourceHints,
        // Phase 30A: durable capture-time resolution snapshot — the fresh
        // agent process reports this exact conclusion, never a recomputation
        // under newer ranking rules.
        sourceHintsResolution: {
          status: sourceHintsResolutionState,
          modelVersion: SOURCE_HINT_SCHEMA_VERSION,
          ...(sourceHints[0]?.filePath ? { topCandidate: sourceHints[0].filePath } : {}),
        },
        runtimeEvidence,
      };

      // One mandatory packet-level privacy boundary: redact the WHOLE packet
      // (DOM text/attributes, hierarchy, styles, URLs, console/network, page
      // metadata, source hints) before it is persisted or returned. The
      // packet on disk is already safe — never "persist raw, redact on read".
      const redactedResult = redactPacketForPersistence(packet);
      const finalPacket = redactedResult.packet;
      for (const r of redactedResult.redactions) {
        if (!finalPacket.metadata.redactions.includes(r)) {
          finalPacket.metadata.redactions.push(r);
        }
      }

      // Persist via Capture Pipeline — required when a pipeline is composed.
      // A persistence failure is a FAILED capture, never a silent success.
      if (this.capturePipeline) {
        const screenshotsForPersist =
          this.screenshotPolicy.mode === 'persist-raw' && captureScreenshot
            ? [
                {
                  captureId: captureScreenshot.captureId,
                  type: 'selection' as const,
                  buffer: captureScreenshot.buffer,
                  format: captureScreenshot.format as 'png',
                  width: captureScreenshot.width,
                  height: captureScreenshot.height,
                },
              ]
            : [];

        const persistResult = await this.capturePipeline.persistCapture({
          captureId,
          packetJson: JSON.stringify(finalPacket, null, 2),
          screenshots: screenshotsForPersist,
        });
        if (!persistResult.ok) {
          this.failedCount++;
          this.eventBus.publish({
            eventId: crypto.randomUUID(),
            eventType: 'VCE_EVENT:PROCESSING_FAILED',
            timestamp: new Date().toISOString(),
            version: '1.0.0',
            source: 'visual-context-engine',
            correlationId: packetId,
            payload: { error: persistResult.error.code },
          });
          return err(
            this.vceError(
              'VCE_PERSIST_FAILED',
              `Capture persistence failed: ${sanitizeErrorDetail(persistResult.error.message)}`,
            ),
          );
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

      this.lastPacket = finalPacket;
      return ok(finalPacket);
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
    } finally {
      this.isGeneratingPacket = false;
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

  /**
   * Resolve a selection target to its actual DOM element (Phase 28B).
   *
   * The returned reference binds every subsequent target-scoped evidence
   * query to the exact element selector resolution picked — including
   * geometry-disambiguated candidates — so evidence can never silently come
   * from another selector match. Ownership: the caller must either pass the
   * reference to `generatePacket` (which releases it after capture) or call
   * `browserRuntime.releaseElement(ref)` directly.
   */
  async resolveTargetElement(selection: SelectionTarget): Promise<Result<ResolvedElementRef>> {
    if (!this.currentHandle) {
      return err(this.vceError('VCE_NO_BROWSER', 'Browser not started'));
    }
    const resolution = await this.browserRuntime.resolveElement(
      this.currentHandle,
      selection.selector,
      selection.boundingBox,
    );
    if (!resolution.ok) {
      return err(this.targetError('SELECTOR_RESOLUTION_FAILED', resolution.error.message));
    }
    if (resolution.value.status !== 'resolved') {
      return err(this.targetResolutionError(resolution.value.status, selection.selector));
    }
    return ok(resolution.value);
  }

  setCaptureProfile(profile: Partial<ProfileConfig>): void {
    this.captureProfile = { ...this.captureProfile, ...profile };
  }

  /** Explicit screenshot privacy policy; default is agent-safe-omit. */
  setScreenshotPolicy(policy: ScreenshotPolicy): void {
    this.screenshotPolicy = policy;
  }

  getLastPacket(): ContextPacket | null {
    return this.lastPacket;
  }

  setProjectContext(context: {
    rootPath: string;
    projectId: string;
    name: string;
    directories: string[];
    primaryFramework: string | null;
    detectedFrameworks: string[];
    frameworkConfidence: number;
    routeMap?: {
      routes: Array<{ path: string; file: string; type: string; isDynamic?: boolean }>;
    };
    workspace?: WorkspaceMetadata;
  }): void {
    this.projectScan = context;
  }

  /**
   * Current project context (established by the caller — Studio/CLI/MCP —
   * from an EXPLICIT project root, never guessed from cwd).
   */
  getProjectContext(): {
    projectId: string;
    name: string;
    rootPath: string;
    directories: string[];
    primaryFramework: string | null;
    detectedFrameworks: string[];
    frameworkConfidence: number;
    routeMap?: {
      routes: Array<{ path: string; file: string; type: string; isDynamic?: boolean }>;
    };
    workspace?: WorkspaceMetadata;
  } | null {
    return this.projectScan;
  }

  getBrowserHandle(): BrowserHandle | null {
    return this.currentHandle;
  }

  getBrowserRuntime(): BrowserRuntime {
    return this.browserRuntime;
  }

  // overlay event poller — connects overlay clicks to capture pipeline
  startOverlayPolling(): void {
    if (this.overlayPollInterval) return;
    this.overlayPollInterval = setInterval(async () => {
      if (!this.currentHandle || this.isGeneratingPacket) return;
      if (this.overlayEventsDelegated) return;
      try {
        const event = await this.browserRuntime.pollOverlayEvent(this.currentHandle);
        if (!event.ok || !event.value) return;
        const data = event.value as Record<string, unknown>;
        if (data.type === 'overlay:element-clicked' && data.data) {
          const info = data.data as Record<string, unknown>;
          // Prefer the overlay-produced stable selector; fall back to the
          // legacy tag+attribute construction for older extensions.
          const selector =
            (info.selector as string | undefined) ??
            (info.tagName
              ? `${info.tagName}${
                  info.stableAttributes
                    ? `[${Object.entries(info.stableAttributes as Record<string, string>)
                        .map(([k, v]) => `${k}="${v}"`)
                        .join(' & ')}]`
                    : ''
                }`
              : 'body');
          const boundingBox = info.boundingBox as
            | { x: number; y: number; width: number; height: number }
            | undefined;
          if (boundingBox) {
            await this.processSelection({
              selector,
              boundingBox,
              source: 'overlay',
            });
          }
        }
      } catch {
        // ignore poll errors
      }
    }, 200);
  }

  stopOverlayPolling(): void {
    if (this.overlayPollInterval) {
      clearInterval(this.overlayPollInterval);
      this.overlayPollInterval = null;
    }
  }

  /** Delegate overlay element events to a SelectionOverlayController. */
  setOverlayEventsDelegated(delegated: boolean): void {
    this.overlayEventsDelegated = delegated;
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
    return createViskodError({
      code,
      category: 'runtime',
      severity: 'recoverable',
      message,
      subsystem: 'visual-context-engine',
    });
  }

  /** Typed failure for an unresolved core target (fail-closed capture). */
  private targetResolutionError(
    status: 'resolved' | 'missing' | 'malformed' | 'ambiguous' | 'detached',
    selector: string,
  ): ViskodError {
    switch (status) {
      case 'malformed':
        return this.targetError('SELECTOR_MALFORMED', `The selector is not valid CSS: ${selector}`);
      case 'missing':
        return this.targetError(
          'SELECTOR_NO_MATCH',
          `No element matches the selector: ${selector}`,
        );
      case 'detached':
        return this.targetError(
          'SELECTOR_DETACHED',
          `The selected element is no longer attached to the page: ${selector}`,
        );
      case 'ambiguous':
        return this.targetError(
          'SELECTOR_AMBIGUOUS',
          `The selector matches multiple elements and no single target could be determined: ${selector}. Use a more specific selector or reselect the element.`,
        );
      default:
        return this.targetError('SELECTOR_RESOLUTION_FAILED', `Could not resolve: ${selector}`);
    }
  }

  private targetError(code: string, message: string): ViskodError {
    return createViskodError({
      code,
      category: 'runtime',
      severity: 'recoverable',
      message,
      subsystem: 'visual-context-engine',
    });
  }
}
