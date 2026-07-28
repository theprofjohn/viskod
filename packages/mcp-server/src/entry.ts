import { BrowserRuntime } from '@viskod/browser-runtime';
import { CapturePipeline } from '@viskod/capture-pipeline';
import { VisualContextEngine } from '@viskod/context-engine';
import type { SelectionTarget as VCESelectionTarget } from '@viskod/context-engine';
import { EventBus } from '@viskod/event-bus';
import { ProjectScanner } from '@viskod/project-scanner';
import { SelectionEngine } from '@viskod/selection-engine';
import type { SelectionTarget } from '@viskod/selection-engine';
import { SourceHintEngine } from '@viskod/source-hint-engine';
import { MCPServer } from './index';
import type { MCPToolDefinition } from './index';

const eventBus = new EventBus({ enableHistory: true, historySize: 100 });
const browserRuntime = new BrowserRuntime(eventBus);
const capturePipeline = new CapturePipeline();
const selectionEngine = new SelectionEngine(eventBus);
const projectScanner = new ProjectScanner(eventBus);
const sourceHintEngine = new SourceHintEngine(eventBus);

const vce = new VisualContextEngine({
  browserRuntime,
  eventBus,
  capturePipeline,
  selectionEngine,
});

let currentTarget: SelectionTarget | null = null;

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
        description: 'X coordinate of the element bounding box (viewport-relative)',
      },
      y: {
        type: 'number',
        description: 'Y coordinate of the element bounding box (viewport-relative)',
      },
      width: {
        type: 'number',
        description: 'Width of the element bounding box',
      },
      height: {
        type: 'number',
        description: 'Height of the element bounding box',
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
  const boundingBox = {
    x: (args.x as number) ?? 0,
    y: (args.y as number) ?? 0,
    width: (args.width as number) ?? 100,
    height: (args.height as number) ?? 100,
  };

  try {
    const resolved = await selectionEngine.resolveTarget({
      selector,
      boundingBox,
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

    const validated = await selectionEngine.validateSelection(resolved.value);

    if (!validated.ok) {
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
        boundingBox: { x: 0, y: 0, width: 100, height: 100 },
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

    const result = await vce.generatePacket(selection);

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
    const result = await projectScanner.scan();

    if (!result.ok) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ok: false, error: result.error.message }, null, 2),
          },
        ],
        isError: true,
      };
    }

    const scan = result.value;
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
    description: 'Information about the current project detected by Viskod (cached from last scan)',
    mimeType: 'application/json',
  },
  async (_uri) => {
    try {
      const result = await projectScanner.scan();
      return {
        uri: 'viskod://project/info',
        mimeType: 'application/json',
        text: JSON.stringify(
          result.ok ? result.value.metadata : { error: result.error.message },
          null,
          2,
        ),
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

void server.start();
