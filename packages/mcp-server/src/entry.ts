import { MCPServer } from './index';
import type { MCPToolDefinition } from './index';

const server = new MCPServer();

const selectElementTool: MCPToolDefinition = {
  name: 'viskod_select_element',
  description:
    'Select a UI element in the running browser application. Returns structured context about the selected element including DOM hierarchy, computed styles, geometry, and accessibility metadata.',
  inputSchema: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector for the target element (e.g., ".my-button", "#header")',
      },
    },
    required: ['selector'],
  },
};

const captureContextTool: MCPToolDefinition = {
  name: 'viskod_capture_context',
  description:
    'Capture visual context from the currently selected element. Returns a context packet containing DOM snapshot, computed styles, screenshot metadata, hierarchy tree, and source code hints.',
  inputSchema: {
    type: 'object',
    properties: {
      include_screenshot: {
        type: 'boolean',
        description: 'Whether to include a screenshot in the context packet (default: true)',
      },
    },
  },
};

const getProjectInfoTool: MCPToolDefinition = {
  name: 'viskod_get_project_info',
  description:
    'Get information about the current project including framework detection, package manager, routes, and configuration.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

const getDiagnosticsTool: MCPToolDefinition = {
  name: 'viskod_get_diagnostics',
  description:
    'Get runtime diagnostics including browser console errors, page errors, memory usage, and subsystem health.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

server.registerTool(selectElementTool, async (args) => {
  const selector = (args.selector as string) ?? 'body';
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            selector,
            status: 'selected',
            message:
              'Element selection initiated. Use viskod_capture_context to capture visual context.',
            boundingBox: { x: 0, y: 0, width: 0, height: 0 },
            hint: 'Selection result is approximate. Run viskod_capture_context for full DOM + style evidence.',
          },
          null,
          2,
        ),
      },
    ],
  };
});

server.registerTool(captureContextTool, async (args) => {
  const includeScreenshot = args.include_screenshot !== false;
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            packetId: `ctx-${Date.now()}`,
            timestamp: new Date().toISOString(),
            selection: {
              selector: 'body',
              tagName: 'body',
              boundingBox: { x: 0, y: 0, width: 0, height: 0 },
            },
            dom: {
              tagName: 'body',
              attributes: {},
              childCount: 0,
              depth: 0,
            },
            styles: {
              computed: { display: 'block' },
            },
            screenshots: includeScreenshot
              ? [{ captureId: 'scr-1', type: 'viewport', format: 'png' }]
              : [],
            confidence: {
              sourceMapping: 0.0,
              semanticLabeling: 0.5,
              layoutAnalysis: 0.3,
              frameworkDetection: 0.0,
            },
            sourceHints: [],
            message: 'Context packet captured. Wire to VisualContextEngine for real data.',
          },
          null,
          2,
        ),
      },
    ],
  };
});

server.registerTool(getProjectInfoTool, async () => {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            name: 'viskod',
            rootPath: process.cwd(),
            packageManager: 'pnpm',
            workspaceType: 'pnpm-workspace',
            language: 'typescript',
            runtime: 'node',
            message: 'Project info from local workspace. Wire to ProjectScanner for real data.',
          },
          null,
          2,
        ),
      },
    ],
  };
});

server.registerTool(getDiagnosticsTool, async () => {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            subsystems: {
              'browser-runtime': { status: 'healthy' },
              'visual-context-engine': { status: 'healthy' },
              'selection-engine': { status: 'healthy' },
              'capture-pipeline': { status: 'healthy' },
              'project-scanner': { status: 'healthy' },
              'source-hint-engine': { status: 'healthy' },
            },
            message: 'Diagnostics snapshot. Wire to actual subsystems for real data.',
          },
          null,
          2,
        ),
      },
    ],
  };
});

server.registerResource(
  {
    uri: 'viskod://captures/latest',
    name: 'Latest Context Packet',
    description: 'The most recent context packet captured by Viskod',
    mimeType: 'application/json',
  },
  async (_uri) => ({
    uri: 'viskod://captures/latest',
    mimeType: 'application/json',
    text: JSON.stringify(
      {
        packetId: 'latest',
        timestamp: new Date().toISOString(),
        selection: { selector: 'body', tagName: 'body' },
        message: 'Latest capture resource. Wire to VCE for real data.',
      },
      null,
      2,
    ),
  }),
);

server.registerResource(
  {
    uri: 'viskod://project/info',
    name: 'Project Information',
    description: 'Information about the current project detected by Viskod',
    mimeType: 'application/json',
  },
  async (_uri) => ({
    uri: 'viskod://project/info',
    mimeType: 'application/json',
    text: JSON.stringify(
      {
        name: 'viskod',
        packageManager: 'pnpm',
        language: 'typescript',
        message: 'Project info resource. Wire to ProjectScanner for real data.',
      },
      null,
      2,
    ),
  }),
);

void server.start();
