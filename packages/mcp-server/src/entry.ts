import path from 'node:path';
// Lazy-loaded: @viskod/setup is imported dynamically in tool handlers
import { fileURLToPath } from 'node:url';
import {
  type AgentHandoffStatus,
  HandoffPersistence,
  HandoffServiceImpl,
} from '@viskod/agent-handoff';
import { BrowserRuntime, type ResolvedElementRef, resolveProfile } from '@viskod/browser-runtime';
import { CapturePipeline } from '@viskod/capture-pipeline';
import { VisualContextEngine } from '@viskod/context-engine';
import type { SelectionTarget as VCESelectionTarget } from '@viskod/context-engine';
import { EventBus } from '@viskod/event-bus';
import { ProjectScanner } from '@viskod/project-scanner';
import type { ScanResult } from '@viskod/project-scanner';
import { SelectionEngine } from '@viskod/selection-engine';
import type { SelectionTarget } from '@viskod/selection-engine';
import { SourceHintEngine } from '@viskod/source-hint-engine';
import { IssuePersistence, IssueServiceImpl } from '@viskod/visual-issue';
import { ReviewArtifactStore, ReviewPersistence, ReviewServiceImpl } from '@viskod/visual-review';
import type { RecaptureAdapter, RecaptureResult } from '@viskod/visual-review';
import { resolveHandoffCaptureContexts } from './handoff-context';
import type { MCPToolDefinition } from './index';
import { MCPServer } from './server';

export interface BuildViskodServerOptions {
  targetUrl?: string;
  /**
   * Phase 30: EXPLICIT target project root. The MCP server never guesses the
   * project from `process.cwd()`. When omitted, source resolution is
   * truthfully unavailable (never a cwd-walk guess).
   */
  projectRootPath?: string;
}

export function buildViskodServer(options?: BuildViskodServerOptions) {
  const eventBus = new EventBus({ enableHistory: true, historySize: 100 });
  const browserRuntime = new BrowserRuntime(eventBus);
  const capturePipeline = new CapturePipeline();
  const selectionEngine = new SelectionEngine(eventBus, browserRuntime);
  const projectScanner = new ProjectScanner(eventBus);
  const sourceHintEngine = new SourceHintEngine(eventBus);
  const STUDIO_URL = 'http://localhost:3001';
  const configuredProjectRoot = options?.projectRootPath;

  const vce = new VisualContextEngine({
    browserRuntime,
    eventBus,
    capturePipeline,
    selectionEngine,
    sourceHintEngine,
  });

  /**
   * Phase 30: project scan established from the EXPLICIT root at startup.
   * `null` = not yet scanned; `{ ok: false }` = no trustworthy project
   * context (never guessed from cwd).
   */
  let currentScan: { ok: true; scan: ScanResult } | { ok: false } | null = null;

  async function ensureProjectScan(): Promise<void> {
    if (currentScan !== null) return;
    if (!configuredProjectRoot) {
      currentScan = { ok: false };
      return;
    }
    const result = await projectScanner.scan(configuredProjectRoot);
    if (!result.ok) {
      currentScan = { ok: false };
      return;
    }
    currentScan = { ok: true, scan: result.value };

    // Discover workspace metadata
    const workspaceResult =
      await projectScanner.discoverWorkspace(configuredProjectRoot);
    const workspace = workspaceResult.ok
      ? {
          isWorkspace: workspaceResult.value.isWorkspace,
          workspaceType:
            workspaceResult.value.workspaceType as import('@viskod/shared').WorkspaceMetadata['workspaceType'],
          packages: workspaceResult.value.packages,
          globs: workspaceResult.value.globs,
        }
      : undefined;

    vce.setProjectContext({
      rootPath: result.value.metadata.rootPath,
      projectId: result.value.metadata.projectId,
      name: result.value.metadata.name,
      directories: result.value.components.directories,
      primaryFramework: result.value.framework.primary,
      detectedFrameworks: result.value.framework.detected,
      frameworkConfidence: result.value.framework.confidence,
      routeMap: { routes: result.value.routes.routes },
      workspace,
    });
  }

  const issuePersistence = new IssuePersistence();
  const issueService = new IssueServiceImpl(eventBus, issuePersistence);
  const handoffPersistence = new HandoffPersistence();
  const handoffService = new HandoffServiceImpl(eventBus, issueService, handoffPersistence);
  const reviewPersistence = new ReviewPersistence();
  // Phase 31: MCP defaults to the disabled artifact policy (Phase 29 privacy
  // stance). Review artifacts are a Studio-level opt-in; even when enabled
  // they never enter the agent-safe packet or handoff context.
  const reviewArtifactStore = new ReviewArtifactStore();

  const mcpRecaptureAdapter: RecaptureAdapter = async (options) => {
    const selector = options.selector;
    if (!selector) return null;

    const url = options.url;
    if (!url) return null;

    const profile = resolveProfile('default');

    try {
      if (options.reload) {
        if (options.cacheBust) {
          const urlObj = new URL(url);
          urlObj.searchParams.set('__viskod_cb', String(Date.now()));
          await vce.navigate(urlObj.toString());
        } else {
          await vce.navigate(url);
        }
      }

      // Phase 28A: only caller-provided/persisted geometry is trusted. When
      // the review service has no observed bounding box, pass none — a
      // multi-match selector then fails closed as ambiguous.
      const selectionTarget: VCESelectionTarget = {
        selector,
        ...(options.boundingBox ? { boundingBox: options.boundingBox } : {}),
        source: 'mcp',
      };

      const packetResult = await vce.generatePacket(selectionTarget, profile);
      if (!packetResult.ok) return null;

      const packet = packetResult.value;

      // Phase 31: local-sensitive target crop through the Phase 28B exact
      // target pipeline. Persisted only when the artifact policy is enabled
      // (Studio opt-in); never part of the agent-safe packet.
      let elementScreenshot: RecaptureResult['elementScreenshot'];
      const handle = vce.getBrowserHandle();
      if (handle) {
        const shot = await vce
          .getBrowserRuntime()
          .captureElementScreenshot(handle, selector, options.boundingBox);
        if (shot.ok && shot.value.resolutionStatus === 'resolved') {
          const buffer = shot.value.buffer;
          if (buffer) {
            elementScreenshot = { ...shot.value, buffer };
          }
        }
      }

      return {
        packetId: packet.packetId,
        selector: packet.selection.selector,
        tagName: packet.selection.tagName,
        boundingBox: packet.selection.boundingBox,
        text: packet.selection.text,
        url: packet.browser.url,
        viewport: packet.browser.viewport,
        screenshotPath: packet.screenshots?.[0]?.path ?? undefined,
        elementScreenshot,
        sourceHints: packet.sourceHints?.map((h) => ({
          filePath: h.filePath,
          confidence: h.confidence,
          evidence: h.evidence,
        })),
        runtimeEvidence: packet.runtimeEvidence as Record<string, unknown> | undefined,
      };
    } catch {
      return null;
    }
  };

  const reviewService = new ReviewServiceImpl(
    eventBus,
    issueService,
    handoffService,
    reviewPersistence,
    mcpRecaptureAdapter,
    reviewArtifactStore,
  );

  let currentTarget: SelectionTarget | null = null;
  /**
   * Phase 28B: the resolved element reference for `currentTarget`, parked
   * between viskod_select_element and the next capture. `generatePacket`
   * consumes and releases it; replacing the selection (or an explicit-
   * selector capture) releases the previous one. Browser close also
   * auto-disposes any handle that was never captured.
   */
  let currentResolvedRef: ResolvedElementRef | null = null;

  const server = new MCPServer();

  const selectElementTool: MCPToolDefinition = {
    name: 'viskod_select_element',
    description:
      'Select a UI element in the running browser application by CSS selector. Returns structured selection context including hierarchy, geometry, visibility, and accessibility metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description:
            'CSS selector for the target element (e.g., ".my-button", "#header", "button.primary")',
        },
        x: {
          type: 'number',
          description:
            'Observed X coordinate of the intended element (viewport-relative). Supplying x/y/width/height together marks the box as trusted target evidence that may disambiguate a multi-match selector; omit them for a bare selector.',
        },
        y: {
          type: 'number',
          description:
            'Observed Y coordinate of the intended element (viewport-relative). Supplying x/y/width/height together marks the box as trusted target evidence; omit for a bare selector.',
        },
        width: {
          type: 'number',
          description:
            'Observed width of the intended element. Supplying x/y/width/height together marks the box as trusted target evidence; omit for a bare selector.',
        },
        height: {
          type: 'number',
          description:
            'Observed height of the intended element. Supplying x/y/width/height together marks the box as trusted target evidence; omit for a bare selector.',
        },
      },
      required: ['selector'],
    },
  };

  const captureContextTool: MCPToolDefinition = {
    name: 'viskod_capture_context',
    description:
      'Capture visual context from the currently selected element. Returns a context packet containing DOM snapshot, computed styles, screenshot metadata, hierarchy tree, and source code hints. Requires a prior viskod_select_element call or an explicit selector.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description:
            'CSS selector for the element to capture. Overrides the last selected element.',
        },
      },
    },
  };

  const getProjectInfoTool: MCPToolDefinition = {
    name: 'viskod_get_project_info',
    description:
      'Get information about the current project including framework detection, package manager, routes, component directories, configuration, and design system detection.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  };

  const getDiagnosticsTool: MCPToolDefinition = {
    name: 'viskod_get_diagnostics',
    description:
      'Get runtime diagnostics including subsystem health status for all Viskod components: browser runtime, selection engine, visual context engine, capture pipeline, project scanner, and source hint engine.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  };

  const navigateTool: MCPToolDefinition = {
    name: 'viskod_navigate',
    description:
      'Navigate the browser to a specified URL. Must be called before selecting elements or capturing context.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to (e.g., "http://localhost:3000/dashboard")',
        },
      },
      required: ['url'],
    },
  };

  server.registerTool(selectElementTool, async (args) => {
    const selector = (args.selector as string) ?? 'body';
    // Phase 28A: coordinates are treated as TRUSTED target evidence only when
    // the caller explicitly supplies the full box. A bare selector carries no
    // geometry, so multi-match selectors fail closed as ambiguous.
    const x = args.x as number | undefined;
    const y = args.y as number | undefined;
    const width = args.width as number | undefined;
    const height = args.height as number | undefined;
    const boundingBox =
      x !== undefined && y !== undefined && width !== undefined && height !== undefined
        ? { x, y, width, height }
        : undefined;

    // Phase 28B: resolve the actual DOM element once. Every element-scoped
    // evidence query (this validation and the later capture) uses this
    // exact element, so geometry-disambiguated candidates stay the target
    // and a detached element never silently falls back to another match.
    let resolvedRef: ResolvedElementRef | null = null;
    try {
      const resolved = await selectionEngine.resolveTarget({
        selector,
        ...(boundingBox ? { boundingBox } : {}),
        source: 'mcp',
        timestamp: new Date().toISOString(),
      });

      if (!resolved.ok) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ok: false, error: resolved.error.message }, null, 2),
            },
          ],
          isError: true,
        };
      }

      currentTarget = resolved.value;

      const browserHandle = vce.getBrowserHandle() ?? undefined;

      if (browserHandle) {
        const refResult = await vce.resolveTargetElement(resolved.value);
        if (!refResult.ok) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ ok: false, error: refResult.error.message }, null, 2),
              },
            ],
            isError: true,
          };
        }
        resolvedRef = refResult.value;
      }

      const validated = await selectionEngine.validateSelection(
        resolved.value,
        browserHandle,
        resolvedRef ?? undefined,
      );

      if (!validated.ok) {
        if (resolvedRef) await browserRuntime.releaseElement(resolvedRef);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ok: false, error: validated.error.message }, null, 2),
            },
          ],
          isError: true,
        };
      }

      // Park the resolved element for the next capture; replace any
      // previously parked reference (that one was never captured).
      if (currentResolvedRef && currentResolvedRef !== resolvedRef) {
        await browserRuntime.releaseElement(currentResolvedRef);
      }
      currentResolvedRef = resolvedRef;

      const snapshot = validated.value;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: true,
                selectionId: snapshot.selectionId,
                selector: snapshot.target.selector,
                tagName: snapshot.hierarchy.selectedNode.tagName,
                boundingBox: snapshot.geometry.boundingBox,
                visibility: snapshot.visibility,
                accessibility: snapshot.accessibility,
                hierarchy: {
                  parents: snapshot.hierarchy.parents.map((p) => p.tagName),
                  siblings: snapshot.hierarchy.siblings.length,
                  children: snapshot.hierarchy.children.length,
                  landmarks: snapshot.hierarchy.landmarks.map(
                    (l) => `${l.tagName}${l.role ? `[${l.role}]` : ''}`,
                  ),
                },
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      if (resolvedRef) {
        await browserRuntime.releaseElement(resolvedRef).catch(() => {});
      }
      return {
        content: [
          { type: 'text', text: JSON.stringify({ ok: false, error: String(error) }, null, 2) },
        ],
        isError: true,
      };
    }
  });

  server.registerTool(captureContextTool, async (args) => {
    const selector = args.selector as string | undefined;

    try {
      let selection: VCESelectionTarget;

      if (selector) {
        const resolved = await selectionEngine.resolveTarget({
          selector,
          source: 'mcp',
          timestamp: new Date().toISOString(),
        });

        if (!resolved.ok) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    ok: false,
                    error: `Element not found: ${selector}`,
                    details: resolved.error.message,
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }

        currentTarget = resolved.value;
        // An explicit-selector capture replaces the selection: the previously
        // parked resolved element is no longer the target — release it.
        if (currentResolvedRef) {
          await browserRuntime.releaseElement(currentResolvedRef);
          currentResolvedRef = null;
        }
        selection = {
          selector: resolved.value.selector,
          boundingBox: resolved.value.boundingBox,
          source: 'mcp',
        };
      } else if (currentTarget) {
        selection = {
          selector: currentTarget.selector,
          boundingBox: currentTarget.boundingBox,
          source: 'mcp',
        };
      } else {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ok: false,
                  error:
                    'No element selected. Call viskod_select_element first or provide a selector.',
                  hint: 'Use viskod_select_element to select an element before capturing context.',
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      // Phase 28B: capture through the resolved element reference parked by
      // viskod_select_element when it exists — never by re-running the
      // selector. generatePacket consumes and releases the reference.
      const captureRef = currentResolvedRef;
      currentResolvedRef = null;
      const result = await vce.generatePacket(selection, undefined, captureRef ?? undefined);

      if (!result.ok) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ok: false,
                  error: result.error.message,
                  hint: 'Ensure the browser is started and navigated to a URL. Use viskod_navigate first.',
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      const packet = result.value;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: true,
                packetId: packet.packetId,
                timestamp: packet.timestamp,
                selection: packet.selection,
                dom: {
                  tagName: packet.dom.tagName,
                  attributes: packet.dom.attributes,
                  childCount: packet.dom.childCount,
                },
                styles: packet.styles.computed,
                screenshots: packet.screenshots.map((s) => ({
                  captureId: s.captureId,
                  type: s.type,
                  format: s.format,
                  dimensions: `${s.width}x${s.height}`,
                })),
                hierarchy: {
                  selectedNode: packet.hierarchy.selectedNode,
                  parents: packet.hierarchy.parents.map((p) => p.tagName),
                  siblingCount: packet.hierarchy.siblings.length,
                  childrenCount: packet.hierarchy.children.length,
                },
                confidence: packet.confidence,
                evidenceSources: packet.metadata.evidenceSources,
                processingTimeMs: packet.metadata.processingTimeMs,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          { type: 'text', text: JSON.stringify({ ok: false, error: String(error) }, null, 2) },
        ],
        isError: true,
      };
    }
  });

  server.registerTool(getProjectInfoTool, async () => {
    try {
      await ensureProjectScan();
      if (!currentScan?.ok) {
        // Phase 30: never guess the project from cwd. Explicit unavailable.
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ok: false,
                  error:
                    'No project root configured. Start the server with --project-root <path> so source resolution can be established.',
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      const scan = currentScan.scan;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: true,
                project: {
                  name: scan.metadata.name,
                  rootPath: scan.metadata.rootPath,
                  packageManager: scan.metadata.packageManager,
                  workspaceType: scan.metadata.workspaceType,
                  language: scan.metadata.language,
                  runtime: scan.metadata.runtime,
                  nodeVersion: scan.metadata.nodeVersion,
                },
                framework: {
                  primary: scan.framework.primary,
                  detected: scan.framework.detected,
                  confidence: scan.framework.confidence,
                  evidence: scan.framework.evidence.map((e) => ({
                    framework: e.framework,
                    method: e.method,
                    detail: e.detail,
                  })),
                },
                routes: {
                  totalRoutes: scan.routes.totalRoutes,
                  layoutPattern: scan.routes.layoutPattern,
                  dynamicRoutePattern: scan.routes.dynamicRoutePattern,
                  sample: scan.routes.routes.slice(0, 10).map((r) => ({
                    path: r.path,
                    file: r.file,
                    type: r.type,
                    isDynamic: r.isDynamic,
                  })),
                },
                components: {
                  directories: scan.components.directories,
                  namingPatterns: scan.components.namingPatterns,
                  totalFiles: scan.components.totalFiles,
                },
                designSystem: {
                  cssFramework: scan.designSystem.cssFramework,
                  uiLibrary: scan.designSystem.uiLibrary,
                  evidence: scan.designSystem.evidence,
                },
                configuration: scan.configuration.map((c) => ({
                  file: c.file,
                  type: c.type,
                })),
                scanDurationMs: scan.scanDurationMs,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          { type: 'text', text: JSON.stringify({ ok: false, error: String(error) }, null, 2) },
        ],
        isError: true,
      };
    }
  });

  server.registerTool(getDiagnosticsTool, async () => {
    try {
      const browserHealth = browserRuntime.health({ contextId: 'bootstrap' });
      const vceHealth = vce.health();
      const seHealth = selectionEngine.health();
      const psHealth = projectScanner.health();
      const shHealth = sourceHintEngine.health();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: true,
                timestamp: new Date().toISOString(),
                subsystems: {
                  'browser-runtime': {
                    status: browserHealth.status,
                    uptime: browserHealth.uptime,
                    pageCount: browserHealth.pageCount,
                  },
                  'visual-context-engine': {
                    status: vceHealth.status,
                    packetsGenerated: vceHealth.packetsGenerated,
                    averageProcessingTimeMs: vceHealth.averageProcessingTimeMs,
                    failedCount: vceHealth.failedCount,
                  },
                  'selection-engine': {
                    status: seHealth.status,
                    activeSelection: seHealth.activeSelection,
                    selectionsProcessed: seHealth.selectionsProcessed,
                    selectionsFailed: seHealth.selectionsFailed,
                    averageProcessingTimeMs: seHealth.averageProcessingTimeMs,
                  },
                  'project-scanner': {
                    status: psHealth.status,
                    projectsScanned: psHealth.projectsScanned,
                    scansFailed: psHealth.scansFailed,
                    lastScanTimestamp: psHealth.lastScanTimestamp,
                    lastScanDurationMs: psHealth.lastScanDurationMs,
                  },
                  'source-hint-engine': {
                    status: shHealth.status,
                    hintsGenerated: shHealth.hintsGenerated,
                    hintsFailed: shHealth.hintsFailed,
                    cacheSize: shHealth.cacheSize,
                    averageProcessingTimeMs: shHealth.averageProcessingTimeMs,
                  },
                },
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          { type: 'text', text: JSON.stringify({ ok: false, error: String(error) }, null, 2) },
        ],
        isError: true,
      };
    }
  });

  server.registerTool(navigateTool, async (args) => {
    const url = args.url as string;
    if (!url) {
      return {
        content: [
          { type: 'text', text: JSON.stringify({ ok: false, error: 'URL is required' }, null, 2) },
        ],
        isError: true,
      };
    }

    try {
      const result = await vce.start();
      if (!result.ok) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { ok: false, error: `Browser start failed: ${result.error.message}` },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      const navResult = await vce.navigate(url);
      if (!navResult.ok) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ok: false, error: navResult.error.message }, null, 2),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: true,
                url,
                message: `Navigated to ${url}. Browser ready for element selection and context capture.`,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          { type: 'text', text: JSON.stringify({ ok: false, error: String(error) }, null, 2) },
        ],
        isError: true,
      };
    }
  });

  // =========================================================================
  // Phase 23: Agent Handoff Tools
  // =========================================================================

  const createAgentHandoffTool: MCPToolDefinition = {
    name: 'create_agent_handoff',
    description:
      'Create a local agent handoff from an existing VisualIssue. Returns an opaque handoff ID that a coding agent can use to retrieve the issue context.',
    inputSchema: {
      type: 'object',
      properties: {
        issueId: {
          type: 'string',
          description: 'The issue ID to create a handoff for',
        },
        userInstruction: {
          type: 'string',
          description: 'Optional instruction from the user to include in the agent brief',
        },
      },
      required: ['issueId'],
    },
  };

  const getAgentHandoffTool: MCPToolDefinition = {
    name: 'get_agent_handoff',
    description:
      'Retrieve the safe agent handoff brief and context for a coding agent. Marks the handoff as opened on first fetch.',
    inputSchema: {
      type: 'object',
      properties: {
        handoffId: {
          type: 'string',
          description: 'The handoff ID to retrieve',
        },
      },
      required: ['handoffId'],
    },
  };

  const listAgentHandoffsTool: MCPToolDefinition = {
    name: 'list_agent_handoffs',
    description:
      'List all local agent handoffs. Returns handoff IDs, titles, statuses, and timestamps.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  };

  const updateAgentHandoffStatusTool: MCPToolDefinition = {
    name: 'update_agent_handoff_status',
    description:
      'Update the status of an agent handoff. Allowed transitions: ready→opened, opened→in_progress, in_progress→completed/failed, any active→cancelled.',
    inputSchema: {
      type: 'object',
      properties: {
        handoffId: {
          type: 'string',
          description: 'The handoff ID to update',
        },
        status: {
          type: 'string',
          description: 'The new status',
          enum: ['opened', 'in_progress', 'completed', 'failed', 'cancelled'],
        },
      },
      required: ['handoffId', 'status'],
    },
  };

  const cancelAgentHandoffTool: MCPToolDefinition = {
    name: 'cancel_agent_handoff',
    description: 'Cancel an agent handoff that should no longer be used.',
    inputSchema: {
      type: 'object',
      properties: {
        handoffId: {
          type: 'string',
          description: 'The handoff ID to cancel',
        },
      },
      required: ['handoffId'],
    },
  };

  function mcpOk(data: unknown) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    };
  }

  function mcpError(message: string, details?: unknown) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            { ok: false, error: message, ...(details ? { details } : {}) },
            null,
            2,
          ),
        },
      ],
      isError: true as const,
    };
  }

  server.registerTool(createAgentHandoffTool, async (args) => {
    try {
      const issueId = args.issueId as string;
      if (!issueId) return mcpError('issueId is required');

      // Resolve usage-site source hints for the issue
      let sourceHints:
        | Array<{
            displayName: string;
            confidence?: number;
            kind?: string;
            score?: number;
            reasons?: string[];
            warnings?: string[];
          }>
        | undefined;
      let sourceHintStatus: 'ranked' | 'ambiguous' | 'low_confidence' | 'missing' | undefined;
      let sourceHintResolution: 'resolved' | 'ambiguous' | 'unavailable' | undefined;

      try {
        const issueResult = await issueService.getIssue(issueId);
        if (issueResult.ok) {
          const issue = issueResult.value;
          // Phase 30: use the EXPLICIT startup project scan — never guess the
          // project from cwd.
          await ensureProjectScan();
          const scan = currentScan?.ok ? currentScan.scan : null;

          const snapshot = issue.source.selectionSnapshot as Record<string, unknown> | undefined;
          const target = snapshot?.targets as Array<Record<string, unknown>> | undefined;
          const firstTarget = target?.[0] as Record<string, unknown> | undefined;
          const semantics = firstTarget?.semantics as Record<string, unknown> | undefined;
          const fingerprints = firstTarget?.fingerprints as Record<string, unknown> | undefined;
          const stableAttrs = fingerprints?.stableAttributes as Record<string, string> | undefined;

          const hintInput = {
            domContext: {
              tagName: (semantics?.tagName as string) ?? 'div',
              className: stableAttrs?.class ?? '',
              id: stableAttrs?.id ?? '',
              role: (semantics?.role as string) ?? undefined,
              testId: stableAttrs?.['data-testid'] ?? undefined,
              text: (semantics?.textPreview as string) ?? undefined,
              parentTagName: undefined as string | undefined,
            },
            route: { url: issue.page.url, pathname: new URL(issue.page.url).pathname },
            project: {
              metadata: {
                projectId: scan?.metadata.projectId ?? 'unknown',
                name: scan?.metadata.name ?? 'unknown',
                rootPath: scan?.metadata.rootPath ?? '',
                packageManager: scan?.metadata.packageManager ?? 'unknown',
                language: scan?.metadata.language ?? 'typescript',
              },
              componentIndex: scan?.components
                ? { directories: scan.components.directories }
                : undefined,
              framework: scan?.framework
                ? {
                    primary: scan.framework.primary,
                    detected: scan.framework.detected,
                    confidence: scan.framework.confidence,
                  }
                : undefined,
            },
            captureId: crypto.randomUUID(),
          };

          const hintResult = await sourceHintEngine.resolveUsageSiteHints(hintInput, 5);
          if (hintResult.ok) {
            sourceHintStatus = hintResult.value.status;
            sourceHintResolution = hintResult.value.resolution;
            sourceHints = hintResult.value.topHints.map((h) => ({
              displayName: h.file.displayPath,
              confidence: h.ranking.confidence,
              kind: h.kind,
              score: h.ranking.score,
              reasons: h.ranking.reasons,
              warnings: hintResult.value.warnings,
              qualification: h.qualification,
            }));
          }
        }
      } catch {
        // Source hints are best-effort
      }

      const result = await handoffService.createHandoff(
        {
          issueId,
          userInstruction: args.userInstruction as string | undefined,
          sourceHints,
          sourceHintStatus,
          sourceHintResolution,
        },
        'mcp-session',
        'mcp-page',
      );

      if (!result.ok) return mcpError(result.error.message);
      return mcpOk({ ok: true, ...result.value });
    } catch (error) {
      return mcpError(String(error));
    }
  });

  server.registerTool(getAgentHandoffTool, async (args) => {
    try {
      const handoffId = args.handoffId as string;
      if (!handoffId) return mcpError('handoffId is required');

      const result = await handoffService.getHandoff(handoffId);
      if (!result.ok) return mcpError(result.error.message);
      return mcpOk({ ok: true, ...result.value });
    } catch (error) {
      return mcpError(String(error));
    }
  });

  server.registerTool(listAgentHandoffsTool, async () => {
    try {
      const result = await handoffService.listHandoffs();
      if (!result.ok) return mcpError(result.error.message);
      return mcpOk({ ok: true, handoffs: result.value });
    } catch (error) {
      return mcpError(String(error));
    }
  });

  server.registerTool(updateAgentHandoffStatusTool, async (args) => {
    try {
      const handoffId = args.handoffId as string;
      const status = args.status as string;
      if (!handoffId) return mcpError('handoffId is required');
      if (!status) return mcpError('status is required');

      const result = await handoffService.updateHandoffStatus(
        handoffId,
        status as AgentHandoffStatus,
      );
      if (!result.ok) return mcpError(result.error.message);
      return mcpOk({ ok: true, handoffId: result.value.handoffId, status: result.value.status });
    } catch (error) {
      return mcpError(String(error));
    }
  });

  server.registerTool(cancelAgentHandoffTool, async (args) => {
    try {
      const handoffId = args.handoffId as string;
      if (!handoffId) return mcpError('handoffId is required');

      const result = await handoffService.cancelHandoff(handoffId);
      if (!result.ok) return mcpError(result.error.message);
      return mcpOk({ ok: true, handoffId: result.value.handoffId, status: result.value.status });
    } catch (error) {
      return mcpError(String(error));
    }
  });

  // =========================================================================
  // Phase 29: Handoff Context Retrieval
  // =========================================================================

  const getHandoffContextTool: MCPToolDefinition = {
    name: 'get_handoff_context',
    description:
      'Retrieve the compact agent-safe context for a handoff: the selected target of the persisted capture, page state, evidence, and statuses — resolved by opaque handoff ID from durable storage. Returns typed errors for missing/corrupt handoff or capture state. Never exposes raw packet JSON or local filesystem paths.',
    inputSchema: {
      type: 'object',
      properties: {
        handoffId: {
          type: 'string',
          description: 'The opaque handoff ID to retrieve context for',
        },
      },
      required: ['handoffId'],
    },
  };

  server.registerTool(getHandoffContextTool, async (args) => {
    try {
      const handoffId = args.handoffId as string;
      if (!handoffId) return mcpError('handoffId is required');
      // Opaque id validation: traversal/absolute-path shapes never reach the
      // persistence layer (also enforced inside HandoffPersistence).
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(handoffId)) {
        return mcpError(`Invalid handoff ID: ${handoffId}`);
      }

      const handoffResult = await handoffService.getHandoff(handoffId);
      if (!handoffResult.ok) {
        return mcpError(handoffResult.error.message);
      }
      const handoff = handoffResult.value;

      const contexts = await resolveHandoffCaptureContexts(handoff, capturePipeline);
      if (!contexts.ok) return mcpError(contexts.error.message);

      return mcpOk({ ok: true, handoffId, issueId: handoff.issueId, captures: contexts.value });
    } catch (error) {
      return mcpError(String(error));
    }
  });

  // =========================================================================
  // Phase 24: Visual Review Tools
  // =========================================================================

  const createVisualReviewTool: MCPToolDefinition = {
    name: 'create_visual_review',
    description:
      'Create a before/after visual review from an existing VisualIssue. Returns an opaque review ID.',
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'The issue ID to create a review for' },
        handoffId: {
          type: 'string',
          description: 'Optional handoff ID associated with this review',
        },
      },
      required: ['issueId'],
    },
  };

  const getVisualReviewTool: MCPToolDefinition = {
    name: 'get_visual_review',
    description:
      'Retrieve a visual review with before/after snapshots, comparison, and decision status.',
    inputSchema: {
      type: 'object',
      properties: {
        reviewId: { type: 'string', description: 'The review ID to retrieve' },
      },
      required: ['reviewId'],
    },
  };

  const listVisualReviewsTool: MCPToolDefinition = {
    name: 'list_visual_reviews',
    description: 'List all local visual reviews with IDs, statuses, and timestamps.',
    inputSchema: { type: 'object', properties: {} },
  };

  const recaptureVisualReviewTool: MCPToolDefinition = {
    name: 'recapture_visual_review',
    description:
      'Recapture the current browser state for a visual review. The target is automatically derived from the persisted VisualSelection snapshot — no selector needed.',
    inputSchema: {
      type: 'object',
      properties: {
        reviewId: { type: 'string', description: 'The review ID to recapture' },
        reload: {
          type: 'boolean',
          description: 'Reload the page before recapturing (default: false)',
        },
        cacheBust: {
          type: 'boolean',
          description: 'Append cache-busting query param before reloading (default: false)',
        },
      },
      required: ['reviewId'],
    },
  };

  const recordVisualReviewDecisionTool: MCPToolDefinition = {
    name: 'record_visual_review_decision',
    description: 'Record a human review decision: accept, reject, or needs_follow_up.',
    inputSchema: {
      type: 'object',
      properties: {
        reviewId: { type: 'string', description: 'The review ID to decide on' },
        decision: {
          type: 'string',
          description: 'The review decision',
          enum: ['accepted', 'rejected', 'needs_follow_up'],
        },
        note: { type: 'string', description: 'Optional note explaining the decision' },
      },
      required: ['reviewId', 'decision'],
    },
  };

  server.registerTool(createVisualReviewTool, async (args) => {
    try {
      const issueId = args.issueId as string;
      if (!issueId) return mcpError('issueId is required');

      const result = await reviewService.createReview(
        { issueId, handoffId: args.handoffId as string | undefined },
        'mcp-session',
        'mcp-page',
      );

      if (!result.ok) return mcpError(result.error.message);
      return mcpOk({ ok: true, ...result.value });
    } catch (error) {
      return mcpError(String(error));
    }
  });

  server.registerTool(getVisualReviewTool, async (args) => {
    try {
      const reviewId = args.reviewId as string;
      if (!reviewId) return mcpError('reviewId is required');

      const result = await reviewService.getReview(reviewId);
      if (!result.ok) return mcpError(result.error.message);
      return mcpOk({ ok: true, ...result.value });
    } catch (error) {
      return mcpError(String(error));
    }
  });

  server.registerTool(listVisualReviewsTool, async () => {
    try {
      const result = await reviewService.listReviews();
      if (!result.ok) return mcpError(result.error.message);
      return mcpOk({ ok: true, reviews: result.value });
    } catch (error) {
      return mcpError(String(error));
    }
  });

  server.registerTool(recaptureVisualReviewTool, async (args) => {
    try {
      const reviewId = args.reviewId as string;
      if (!reviewId) return mcpError('reviewId is required');

      const result = await reviewService.recaptureReview({
        reviewId,
        reload: args.reload as boolean | undefined,
        cacheBust: args.cacheBust as boolean | undefined,
      });

      if (!result.ok) return mcpError(result.error.message);
      return mcpOk({
        ok: true,
        reviewId: result.value.reviewId,
        status: result.value.status,
        comparisonStatus: result.value.comparison?.status,
        summary: result.value.comparison?.summary,
        beforeSnapshotId: result.value.before.snapshotId,
        afterSnapshotId: result.value.after?.snapshotId,
        warningCount: result.value.comparison?.warnings.length ?? 0,
      });
    } catch (error) {
      return mcpError(String(error));
    }
  });

  // =========================================================================
  // Phase 25: Usage-Site Source Hints
  // =========================================================================

  const resolveUsageSiteHintsTool: MCPToolDefinition = {
    name: 'resolve_usage_site_hints',
    description:
      'Resolve ranked usage-site source hints for a selected UI element. Identifies likely usage files, route owners, and supporting definitions with confidence scores.',
    inputSchema: {
      type: 'object',
      properties: {
        issueId: { type: 'string', description: 'Resolve hints for an existing VisualIssue' },
        handoffId: { type: 'string', description: 'Resolve hints for an existing AgentHandoff' },
        reviewId: { type: 'string', description: 'Resolve hints for an existing VisualReview' },
        selectionId: { type: 'string', description: 'Resolve hints for a specific selection' },
        maxHints: { type: 'number', description: 'Maximum number of hints to return (default: 5)' },
      },
    },
  };

  server.registerTool(resolveUsageSiteHintsTool, async (args) => {
    try {
      const issueId = args.issueId as string | undefined;
      const handoffId = args.handoffId as string | undefined;
      const reviewId = args.reviewId as string | undefined;
      const maxHints = (args.maxHints as number) ?? 5;

      // Resolve context from provided IDs
      let contextData: {
        domContext?: Record<string, unknown>;
        route?: { url: string; pathname: string };
        selectionSnapshot?: Record<string, unknown>;
        pageUrl?: string;
        pageTitle?: string;
      } = {};

      if (issueId) {
        const issueResult = await issueService.getIssue(issueId);
        if (!issueResult.ok) return mcpError(`Issue not found: ${issueResult.error.message}`);
        const issue = issueResult.value;
        contextData = {
          route: { url: issue.page.url, pathname: new URL(issue.page.url).pathname },
          selectionSnapshot: issue.source.selectionSnapshot as Record<string, unknown>,
          pageUrl: issue.page.url,
          pageTitle: issue.page.title,
        };
      } else if (handoffId) {
        const handoffResult = await handoffService.getHandoff(handoffId);
        if (!handoffResult.ok) return mcpError(`Handoff not found: ${handoffResult.error.message}`);
        const handoff = handoffResult.value;
        contextData = {
          route: handoff.brief.page.url
            ? { url: handoff.brief.page.url, pathname: new URL(handoff.brief.page.url).pathname }
            : undefined,
          pageUrl: handoff.brief.page.url,
          pageTitle: handoff.brief.page.title,
        };
      } else if (reviewId) {
        const reviewResult = await reviewService.getReview(reviewId);
        if (!reviewResult.ok) return mcpError(`Review not found: ${reviewResult.error.message}`);
        const review = reviewResult.value;
        contextData = {
          route: review.before.page.url
            ? { url: review.before.page.url, pathname: new URL(review.before.page.url).pathname }
            : undefined,
          pageUrl: review.before.page.url,
          pageTitle: review.before.page.title,
        };
      }

      // Build HintInput from context
      const snapshot = contextData.selectionSnapshot as Record<string, unknown> | undefined;
      const target = snapshot?.targets as Array<Record<string, unknown>> | undefined;
      const firstTarget = target?.[0] as Record<string, unknown> | undefined;
      const semantics = firstTarget?.semantics as Record<string, unknown> | undefined;
      const fingerprints = firstTarget?.fingerprints as Record<string, unknown> | undefined;
      const stableAttrs = fingerprints?.stableAttributes as Record<string, string> | undefined;

      const domContext = {
        tagName: (semantics?.tagName as string) ?? 'div',
        className: stableAttrs?.class ?? '',
        id: stableAttrs?.id ?? '',
        role: (semantics?.role as string) ?? undefined,
        testId: stableAttrs?.['data-testid'] ?? undefined,
        text: (semantics?.textPreview as string) ?? undefined,
        parentTagName: undefined as string | undefined,
      };

      const route = contextData.route ?? { url: 'http://localhost', pathname: '/' };

      // Use Studio's advanced setting when available; preserve graph analysis if Studio is offline.
      let useImportGraph = true;
      try {
        const settingsResponse = await fetch(`${STUDIO_URL}/settings`);
        if (settingsResponse.ok) {
          const settings = (await settingsResponse.json()) as { importGraph?: boolean };
          useImportGraph = settings.importGraph !== false;
        }
      } catch {
        // MCP can run without Studio; keep the historical default in that case.
      }

      // Run project scan if needed
      const scanResult = await projectScanner.scan();
      const scan = scanResult.ok ? scanResult.value : null;

      const hintInput = {
        domContext,
        route,
        project: {
          metadata: {
            projectId: scan?.metadata.projectId ?? 'unknown',
            name: scan?.metadata.name ?? 'unknown',
            rootPath: scan?.metadata.rootPath ?? '',
            packageManager: scan?.metadata.packageManager ?? 'unknown',
            language: scan?.metadata.language ?? 'typescript',
          },
          componentIndex: scan?.components
            ? { directories: scan.components.directories }
            : undefined,
          framework: scan?.framework
            ? {
                primary: scan.framework.primary,
                detected: scan.framework.detected,
                confidence: scan.framework.confidence,
              }
            : undefined,
        },
        captureId: crypto.randomUUID(),
      };

      const result = await sourceHintEngine.resolveUsageSiteHints(hintInput, maxHints, {
        useImportGraph,
      });

      if (!result.ok) {
        return mcpError(result.error.message);
      }

      const ranking = result.value;

      return mcpOk({
        ok: true,
        status: ranking.status,
        hints: ranking.topHints.map((h) => ({
          hintId: h.hintId,
          kind: h.kind,
          displayPath: h.file.displayPath,
          location: h.location,
          symbol: h.symbol,
          confidence: h.ranking.confidence,
          score: h.ranking.score,
          reasons: h.ranking.reasons,
          warnings: ranking.warnings,
        })),
      });
    } catch (error) {
      return mcpError(String(error));
    }
  });

  server.registerTool(recordVisualReviewDecisionTool, async (args) => {
    try {
      const reviewId = args.reviewId as string;
      const decision = args.decision as string;
      if (!reviewId) return mcpError('reviewId is required');
      if (!decision) return mcpError('decision is required');

      const result = await reviewService.recordDecision(reviewId, {
        decision: decision as 'accepted' | 'rejected' | 'needs_follow_up',
        note: args.note as string | undefined,
      });

      if (!result.ok) return mcpError(result.error.message);
      return mcpOk({
        ok: true,
        reviewId: result.value.reviewId,
        status: result.value.status,
        decision: result.value.decision,
      });
    } catch (error) {
      return mcpError(String(error));
    }
  });

  // =========================================================================
  // Phase 26: First-Run Setup Tools
  // =========================================================================

  const getSetupStateTool: MCPToolDefinition = {
    name: 'get_setup_state',
    description:
      'Get the current first-run setup state. Returns null if setup has not been completed.',
    inputSchema: {
      type: 'object',
      properties: {
        projectRoot: { type: 'string', description: 'Project root path (defaults to cwd)' },
      },
    },
  };

  const detectProjectTool: MCPToolDefinition = {
    name: 'detect_project',
    description: 'Detect the current project root, package manager, framework, and workspace type.',
    inputSchema: {
      type: 'object',
      properties: {
        projectRoot: {
          type: 'string',
          description: 'Explicit project root path (auto-detected if omitted)',
        },
      },
    },
  };

  const initializeWorkspaceTool: MCPToolDefinition = {
    name: 'initialize_workspace',
    description: 'Initialize the local .viskod workspace directories. Idempotent — safe to re-run.',
    inputSchema: {
      type: 'object',
      properties: {
        projectRoot: { type: 'string', description: 'Project root path' },
      },
      required: ['projectRoot'],
    },
  };

  const runSetupChecksTool: MCPToolDefinition = {
    name: 'run_setup_checks',
    description: 'Run environment and readiness checks for Viskod setup.',
    inputSchema: {
      type: 'object',
      properties: {
        projectRoot: { type: 'string', description: 'Project root path' },
        includeOptional: {
          type: 'boolean',
          description: 'Include optional checks (default: false)',
        },
        appUrl: {
          type: 'string',
          description: 'Local app URL to verify reachability (e.g., http://localhost:3000)',
        },
      },
      required: ['projectRoot'],
    },
  };

  const runSetupSmokeTool: MCPToolDefinition = {
    name: 'run_setup_smoke',
    description: 'Run a lightweight smoke test to verify basic Viskod functionality.',
    inputSchema: {
      type: 'object',
      properties: {
        projectRoot: { type: 'string', description: 'Project root path' },
        limitedMode: { type: 'boolean', description: 'Run in limited mode (skip browser checks)' },
      },
      required: ['projectRoot'],
    },
  };

  const completeSetupTool: MCPToolDefinition = {
    name: 'complete_setup',
    description:
      'Mark setup as complete and persist the setup state. Passing limitedMode: true is explicit user consent to complete setup in limited mode when required gates fail; limitedReasons documents why full setup cannot complete. Without explicit consent, failed required gates leave setup in the incomplete state.',
    inputSchema: {
      type: 'object',
      properties: {
        projectRoot: { type: 'string', description: 'Project root path' },
        limitedMode: {
          type: 'boolean',
          description:
            'Explicit user consent to complete setup in limited mode, bypassing failed required gates',
        },
        limitedReasons: {
          type: 'array',
          items: { type: 'string' },
          description: 'Reasons why the user consents to completing setup in limited mode',
        },
        appUrl: {
          type: 'string',
          description: 'Local app URL verified during setup (e.g., http://localhost:3000)',
        },
      },
      required: ['projectRoot'],
    },
  };

  const repairSetupTool: MCPToolDefinition = {
    name: 'repair_setup',
    description: 'Repair a failed setup check (e.g., re-initialize workspace).',
    inputSchema: {
      type: 'object',
      properties: {
        projectRoot: { type: 'string', description: 'Project root path' },
        actionId: { type: 'string', description: 'The remediation action ID to execute' },
      },
      required: ['projectRoot', 'actionId'],
    },
  };

  server.registerTool(getSetupStateTool, async (args) => {
    try {
      const { getSetupState } = await import('@viskod/setup');
      const projectRoot = (args.projectRoot as string) ?? process.cwd();
      const result = getSetupState(projectRoot);
      if (!result.ok) return mcpError(result.error.message);
      return mcpOk({ ok: true, state: result.value });
    } catch (error) {
      return mcpError(String(error));
    }
  });

  server.registerTool(detectProjectTool, async (args) => {
    try {
      const { detectAndConfigureProject } = await import('@viskod/setup');
      const projectRoot = args.projectRoot as string | undefined;
      const result = detectAndConfigureProject(projectRoot ? { projectRoot } : undefined);
      if (!result.ok) return mcpError(result.error.message);
      return mcpOk({ ok: true, project: result.value });
    } catch (error) {
      return mcpError(String(error));
    }
  });

  server.registerTool(initializeWorkspaceTool, async (args) => {
    try {
      const { initializeProjectWorkspace } = await import('@viskod/setup');
      const projectRoot = args.projectRoot as string;
      if (!projectRoot) return mcpError('projectRoot is required');
      const result = initializeProjectWorkspace({ projectRoot });
      if (!result.ok) return mcpError(result.error.message);
      return mcpOk({ ok: true, workspace: result.value });
    } catch (error) {
      return mcpError(String(error));
    }
  });

  server.registerTool(runSetupChecksTool, async (args) => {
    try {
      const { runAllChecks } = await import('@viskod/setup');
      const projectRoot = args.projectRoot as string;
      if (!projectRoot) return mcpError('projectRoot is required');
      const includeOptional = args.includeOptional as boolean | undefined;
      const appUrl = args.appUrl as string | undefined;
      const checks = await runAllChecks({ projectRoot, includeOptional, appUrl });
      return mcpOk({ ok: true, checks });
    } catch (error) {
      return mcpError(String(error));
    }
  });

  server.registerTool(runSetupSmokeTool, async (args) => {
    try {
      const { runSmoke } = await import('@viskod/setup');
      const projectRoot = args.projectRoot as string;
      if (!projectRoot) return mcpError('projectRoot is required');
      const limitedMode = args.limitedMode as boolean | undefined;
      const result = await runSmoke({ projectRoot, limitedMode });
      if (!result.ok) return mcpError(result.error.message);
      return mcpOk({ ok: true, smoke: result.value });
    } catch (error) {
      return mcpError(String(error));
    }
  });

  server.registerTool(completeSetupTool, async (args) => {
    try {
      const { detectAndConfigureProject, runAllChecks, completeSetup } = await import(
        '@viskod/setup'
      );
      const projectRoot = args.projectRoot as string;
      if (!projectRoot) return mcpError('projectRoot is required');

      const projectResult = detectAndConfigureProject({ projectRoot });
      if (!projectResult.ok) return mcpError(projectResult.error.message);

      const checks = await runAllChecks({ projectRoot, includeOptional: true });

      const result = completeSetup({
        projectRoot,
        project: projectResult.value,
        checks,
        limitedMode: args.limitedMode as boolean | undefined,
        limitedReasons: args.limitedReasons as string[] | undefined,
        appUrl: args.appUrl as string | undefined,
      });
      if (!result.ok) return mcpError(result.error.message);
      return mcpOk({ ok: true, state: result.value });
    } catch (error) {
      return mcpError(String(error));
    }
  });

  server.registerTool(repairSetupTool, async (args) => {
    try {
      const { repairSetup } = await import('@viskod/setup');
      const projectRoot = args.projectRoot as string;
      const actionId = args.actionId as string;
      if (!projectRoot) return mcpError('projectRoot is required');
      if (!actionId) return mcpError('actionId is required');

      const result = await repairSetup({ projectRoot, actionId });
      if (!result.ok) return mcpError(result.error.message);
      return mcpOk({ ok: true, checks: result.value });
    } catch (error) {
      return mcpError(String(error));
    }
  });

  const verifyMcpToolsTool: MCPToolDefinition = {
    name: 'verify_mcp_tools',
    description: 'Verify that all required MCP tools are available in the running server.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  };

  server.registerTool(verifyMcpToolsTool, async () => {
    try {
      const { verifyMcpTools } = await import('@viskod/setup');
      const verification = verifyMcpTools();
      return mcpOk({
        ok: true,
        serverReachable: verification.serverReachable,
        requiredToolsPresent: verification.requiredToolsPresent,
        toolsFound: verification.toolsFound,
        missingRequiredTools: verification.missingRequiredTools,
      });
    } catch (error) {
      return mcpError(String(error));
    }
  });

  const validateAppUrlTool: MCPToolDefinition = {
    name: 'validate_app_url',
    description: 'Validate a local development app URL for use with Viskod setup.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The app URL to validate (e.g., http://localhost:3000)',
        },
      },
      required: ['url'],
    },
  };

  server.registerTool(validateAppUrlTool, async (args) => {
    try {
      const { validateAppUrl } = await import('@viskod/setup');
      const url = args.url as string;
      if (!url) return mcpError('url is required');
      const result = validateAppUrl(url);
      return mcpOk({ ok: true, validation: result });
    } catch (error) {
      return mcpError(String(error));
    }
  });

  // chat tools — agent ↔ extension message passing via Studio HTTP API

  const getChatMessagesTool: MCPToolDefinition = {
    name: 'viskod_get_chat_messages',
    description:
      'Read pending chat messages from the Viskod Chrome extension. Call this to check if the user sent a message via the in-page chat panel.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  };

  server.registerTool(getChatMessagesTool, async (_args) => {
    try {
      const resp = await fetch(`${STUDIO_URL}/chat/messages`);
      const data = (await resp.json()) as {
        messages: Array<{ id: string; role: string; text: string; timestamp: string }>;
      };
      if (data.messages.some((message) => message.role === 'user')) {
        await fetch(`${STUDIO_URL}/chat/notify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'agent-status', status: 'working' }),
        });
      }
      return mcpOk({ ok: true, messages: data.messages });
    } catch (error) {
      return mcpError(`Chat unavailable: ${String(error)}`);
    }
  });

  const sendChatResponseTool: MCPToolDefinition = {
    name: 'viskod_send_chat_response',
    description:
      'Send a response to the user via the Viskod Chrome extension chat panel. Use this to reply to user messages or report fix results.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The response message to send to the user' },
      },
      required: ['text'],
    },
  };

  server.registerTool(sendChatResponseTool, async (args) => {
    try {
      const text = args.text as string;
      if (!text) return mcpError('text is required');
      const resp = await fetch(`${STUDIO_URL}/chat/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = (await resp.json()) as { ok: boolean; id?: string; error?: string };
      return mcpOk(data);
    } catch (error) {
      return mcpError(`Chat unavailable: ${String(error)}`);
    }
  });

  const notifyUiTool: MCPToolDefinition = {
    name: 'viskod_notify_ui',
    description:
      'Send a command to the Chrome extension: refresh the page, re-inject the overlay, or highlight an element. Use after making code fixes to trigger visual update.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['refresh', 'inject-overlay', 'highlight'],
          description: 'The UI action to trigger',
        },
        selector: { type: 'string', description: 'CSS selector (required for highlight action)' },
      },
      required: ['action'],
    },
  };

  server.registerTool(notifyUiTool, async (args) => {
    try {
      const action = args.action as string;
      if (!action) return mcpError('action is required');

      // 'refresh' uses Playwright reload + overlay re-injection
      // instead of extension location.reload() which destroys the overlay
      if (action === 'refresh') {
        const resp = await fetch(`${STUDIO_URL}/overlay/reload`, { method: 'POST' });
        const data = (await resp.json()) as { ok: boolean; reInjected?: boolean; error?: string };
        return mcpOk(data);
      }

      const resp = await fetch(`${STUDIO_URL}/chat/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, selector: args.selector }),
      });
      const data = (await resp.json()) as { ok: boolean; error?: string };
      return mcpOk(data);
    } catch (error) {
      return mcpError(`Notify unavailable: ${String(error)}`);
    }
  });

  // settings tools — agent reads/updates user toggle state
  const getSettingsTool: MCPToolDefinition = {
    name: 'viskod_get_settings',
    description:
      'Read the current Viskod feature toggle settings from the Studio (selection mode, diagnostics overlay, capture options).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  };

  server.registerTool(getSettingsTool, async () => {
    try {
      const resp = await fetch(`${STUDIO_URL}/settings`);
      const data = (await resp.json()) as Record<string, unknown>;
      return mcpOk({ ok: true, settings: data });
    } catch (error) {
      return mcpError(`Settings unavailable: ${String(error)}`);
    }
  });

  const updateSettingsTool: MCPToolDefinition = {
    name: 'viskod_update_settings',
    description:
      'Update Viskod feature toggle settings. Pass only the settings you want to change (e.g. { selectionMode: true } to enable element selection).',
    inputSchema: {
      type: 'object',
      properties: {
        settings: {
          type: 'object',
          description:
            'Settings to update: selectionMode, boxSelect, hoverHighlight, diagnosticsOverlay, spacingVisualization, screenshots, consoleLogs, networkRequests, computedStyles, autoRefresh, sourceHints, importGraph',
        },
      },
      required: ['settings'],
    },
  };

  server.registerTool(updateSettingsTool, async (args) => {
    try {
      const settings = args.settings as Record<string, unknown>;
      if (!settings) return mcpError('settings is required');
      const resp = await fetch(`${STUDIO_URL}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const data = (await resp.json()) as {
        ok: boolean;
        settings?: Record<string, unknown>;
        error?: string;
      };
      return mcpOk(data);
    } catch (error) {
      return mcpError(`Settings unavailable: ${String(error)}`);
    }
  });

  server.registerResource(
    {
      uri: 'viskod://captures/latest',
      name: 'Latest Context Packet',
      description: 'The most recent context packet captured by Viskod',
      mimeType: 'application/json',
    },
    async (_uri) => {
      const lastPacket = vce.getLastPacket();
      return {
        uri: 'viskod://captures/latest',
        mimeType: 'application/json',
        text: JSON.stringify(
          lastPacket ?? {
            available: false,
            message: 'No captures yet. Use viskod_select_element then viskod_capture_context.',
          },
          null,
          2,
        ),
      };
    },
  );

  server.registerResource(
    {
      uri: 'viskod://project/info',
      name: 'Project Information',
      description:
        'Information about the current project detected by Viskod (cached from last scan)',
      mimeType: 'application/json',
    },
    async (_uri) => {
      try {
        await ensureProjectScan();
        if (!currentScan?.ok) {
          return {
            uri: 'viskod://project/info',
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                available: false,
                error: 'No project root configured. Start the server with --project-root <path>.',
              },
              null,
              2,
            ),
          };
        }
        return {
          uri: 'viskod://project/info',
          mimeType: 'application/json',
          text: JSON.stringify(currentScan.scan.metadata, null, 2),
        };
      } catch {
        return {
          uri: 'viskod://project/info',
          mimeType: 'application/json',
          text: JSON.stringify({ error: 'Project scan failed' }),
        };
      }
    },
  );

  if (options?.targetUrl) {
    server.setStartup(async () => {
      await ensureProjectScan();
      const browser = await vce.start();
      if (!browser.ok) throw new Error(browser.error.message);
      const navigation = await vce.navigate(options.targetUrl as string);
      if (!navigation.ok) throw new Error(navigation.error.message);
    });
  } else {
    server.setStartup(async () => {
      await ensureProjectScan();
    });
  }

  return server;
}

// Standalone bootstrap — start the server when this file is run directly
// (the setup package spawns `tsx entry.ts` for live MCP verification).
// Guarded on the module name: inside the bundled CLI (dist/index.js) the
// CLI's `serve` command is the entry point, and starting here too would
// double-start the server and duplicate every JSON-RPC response.
if (
  process.argv[1] &&
  path.basename(fileURLToPath(import.meta.url)) === 'entry.ts' &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href
) {
  const server = buildViskodServer();
  void server.start();
}
