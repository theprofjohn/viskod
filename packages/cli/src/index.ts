#!/usr/bin/env node
import { BrowserRuntime } from '@viskod/browser-runtime';
import { CapturePipeline } from '@viskod/capture-pipeline';
import { type SelectionTarget, VisualContextEngine } from '@viskod/context-engine';
import { EventBus } from '@viskod/event-bus';
import { MCPServer } from '@viskod/mcp-server';
import { ProjectScanner } from '@viskod/project-scanner';
import { SelectionEngine } from '@viskod/selection-engine';
import { SourceHintEngine } from '@viskod/source-hint-engine';

function createRuntime() {
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
    sourceHintEngine,
  });
  return {
    eventBus,
    browserRuntime,
    capturePipeline,
    selectionEngine,
    projectScanner,
    sourceHintEngine,
    vce,
  };
}

const args = process.argv.slice(2);
const command = args[0] ?? 'help';

async function main(): Promise<void> {
  switch (command) {
    case 'start':
      await cmdStart(args.slice(1));
      break;
    case 'scan':
      await cmdScan(args.slice(1));
      break;
    case 'capture':
      await cmdCapture(args.slice(1));
      break;
    case 'serve':
      await cmdServe();
      break;
    case 'health':
      await cmdHealth();
      break;
    default:
      printHelp();
  }
}

async function cmdStart(subArgs: string[]): Promise<void> {
  const runtime = createRuntime();
  const targetUrl = subArgs[0] ?? 'http://localhost:3000';

  console.log('Viskod v0.0.1');
  console.log('Starting browser...');

  const startResult = await runtime.vce.start();
  if (!startResult.ok) {
    console.error(`Failed to start browser: ${startResult.error.message}`);
    process.exit(1);
  }

  console.log(`Navigating to ${targetUrl}...`);
  const navResult = await runtime.vce.navigate(targetUrl);
  if (!navResult.ok) {
    console.error(`Failed to navigate: ${navResult.error.message}`);
    process.exit(1);
  }

  // Scan project and set context for source hints
  const scanResult = await runtime.projectScanner.scan();
  if (scanResult.ok) {
    const s = scanResult.value;
    runtime.vce.setProjectContext({
      rootPath: s.metadata.rootPath,
      projectId: s.metadata.projectId,
      name: s.metadata.name,
      directories: s.components.directories,
      primaryFramework: s.framework.primary,
      detectedFrameworks: s.framework.detected,
      frameworkConfidence: s.framework.confidence,
    });
  }

  console.log(`Ready. Browser session active at ${targetUrl}.`);
  console.log(`Use 'viskod capture <selector>' to capture an element.`);
  console.log(`Use 'viskod health' to check subsystem status.`);
  console.log('Press Ctrl+C to stop.');

  const cleanup = async () => {
    console.log('\nShutting down...');
    await runtime.vce.stopBrowser();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

async function cmdScan(subArgs: string[]): Promise<void> {
  const runtime = createRuntime();
  const rootPath = subArgs[0];
  console.log('Scanning project...');

  const result = await runtime.projectScanner.scan(rootPath);
  if (!result.ok) {
    console.error(`Scan failed: ${result.error.message}`);
    process.exit(1);
  }

  const scan = result.value;
  console.log(
    JSON.stringify(
      {
        project: {
          name: scan.metadata.name,
          rootPath: scan.metadata.rootPath,
          packageManager: scan.metadata.packageManager,
          workspaceType: scan.metadata.workspaceType,
          language: scan.metadata.language,
          runtime: scan.metadata.runtime,
        },
        framework: {
          primary: scan.framework.primary,
          detected: scan.framework.detected,
          confidence: scan.framework.confidence,
        },
        routes: {
          total: scan.routes.totalRoutes,
          sample: scan.routes.routes.slice(0, 5).map((r) => r.path),
        },
        components: {
          directories: scan.components.directories,
          totalFiles: scan.components.totalFiles,
        },
        designSystem: {
          cssFramework: scan.designSystem.cssFramework,
          uiLibrary: scan.designSystem.uiLibrary,
        },
        configuration: scan.configuration
          .filter((c) => c.exists)
          .map((c) => `${c.file} (${c.type})`),
        scanDurationMs: scan.scanDurationMs,
      },
      null,
      2,
    ),
  );
}

async function cmdCapture(subArgs: string[]): Promise<void> {
  const runtime = createRuntime();
  const selector = subArgs[0];

  if (!selector) {
    console.error('Usage: viskod capture <selector> [--url <url>]');
    process.exit(1);
  }

  const urlIdx = subArgs.indexOf('--url');
  const targetUrl =
    urlIdx >= 0 ? (subArgs[urlIdx + 1] ?? 'http://localhost:3000') : 'http://localhost:3000';

  console.log('Starting browser...');
  const startResult = await runtime.vce.start();
  if (!startResult.ok) {
    console.error(`Failed to start browser: ${startResult.error.message}`);
    process.exit(1);
  }

  console.log(`Navigating to ${targetUrl}...`);
  const navResult = await runtime.vce.navigate(targetUrl);
  if (!navResult.ok) {
    console.error(`Failed to navigate: ${navResult.error.message}`);
    process.exit(1);
  }

  // Scan project and set context for source hints
  const scanResult = await runtime.projectScanner.scan();
  if (scanResult.ok) {
    const s = scanResult.value;
    runtime.vce.setProjectContext({
      rootPath: s.metadata.rootPath,
      projectId: s.metadata.projectId,
      name: s.metadata.name,
      directories: s.components.directories,
      primaryFramework: s.framework.primary,
      detectedFrameworks: s.framework.detected,
      frameworkConfidence: s.framework.confidence,
    });
  }

  console.log(`Selecting element: ${selector}...`);
  const selection: {
    selector: string;
    boundingBox: { x: number; y: number; width: number; height: number };
    source: 'mcp';
  } = {
    selector,
    boundingBox: { x: 0, y: 0, width: 100, height: 100 },
    source: 'mcp',
  };

  if (runtime.selectionEngine) {
    const resolved = await runtime.selectionEngine.resolveTarget({
      ...selection,
      boundingBox: selection.boundingBox,
      source: 'mcp',
      timestamp: new Date().toISOString(),
    });
    if (resolved.ok) {
      console.log(`Element resolved: ${resolved.value.selector}`);
    }
  }

  console.log('Capturing context...');
  const result = await runtime.vce.generatePacket(selection);
  if (!result.ok) {
    console.error(`Capture failed: ${result.error.message}`);
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        packetId: result.value.packetId,
        timestamp: result.value.timestamp,
        selection: result.value.selection,
        dom: { tagName: result.value.dom.tagName, childCount: result.value.dom.childCount },
        screenshots: result.value.screenshots.length,
        confidence: result.value.confidence,
        evidenceSources: result.value.metadata.evidenceSources,
        processingTimeMs: result.value.metadata.processingTimeMs,
      },
      null,
      2,
    ),
  );

  await runtime.vce.stopBrowser();
}

async function cmdServe(): Promise<void> {
  const runtime = createRuntime();

  const server = new MCPServer();

  server.registerTool(
    {
      name: 'health',
      description: 'Check subsystem health status',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    async () => {
      const browserHealth = runtime.browserRuntime.health({ contextId: 'cli' });
      const result = {
        'browser-runtime': { status: browserHealth.status, pageCount: browserHealth.pageCount },
        'visual-context-engine': runtime.vce.health(),
        'selection-engine': runtime.selectionEngine.health(),
        'project-scanner': runtime.projectScanner.health(),
        'source-hint-engine': runtime.sourceHintEngine.health(),
      };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    {
      name: 'scan',
      description: 'Scan a project directory for metadata',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to project root (defaults to current dir)' },
        },
        required: [],
      },
    },
    async (args) => {
      const rootPath = (args.path as string | undefined) ?? process.cwd();
      const result = await runtime.projectScanner.scan(rootPath);
      if (!result.ok) {
        return {
          content: [{ type: 'text', text: `Scan failed: ${result.error.message}` }],
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
                project: {
                  name: scan.metadata.name,
                  rootPath: scan.metadata.rootPath,
                  packageManager: scan.metadata.packageManager,
                  workspaceType: scan.metadata.workspaceType,
                  language: scan.metadata.language,
                  runtime: scan.metadata.runtime,
                },
                framework: {
                  primary: scan.framework.primary,
                  detected: scan.framework.detected,
                  confidence: scan.framework.confidence,
                },
                routes: { total: scan.routes.totalRoutes },
                components: {
                  directories: scan.components.directories,
                  totalFiles: scan.components.totalFiles,
                },
                designSystem: {
                  cssFramework: scan.designSystem.cssFramework,
                  uiLibrary: scan.designSystem.uiLibrary,
                },
                scanDurationMs: scan.scanDurationMs,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    {
      name: 'capture',
      description: 'Navigate to a URL, select an element, and capture a Context Packet',
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector for the element to capture' },
          url: {
            type: 'string',
            description: 'URL to navigate to (defaults to http://localhost:3000)',
          },
        },
        required: ['selector'],
      },
    },
    async (args) => {
      const selector = args.selector as string;
      const targetUrl = (args.url as string | undefined) ?? 'http://localhost:3000';

      const startResult = await runtime.vce.start();
      if (!startResult.ok) {
        return {
          content: [
            { type: 'text', text: `Failed to start browser: ${startResult.error.message}` },
          ],
          isError: true,
        };
      }

      const navResult = await runtime.vce.navigate(targetUrl);
      if (!navResult.ok) {
        await runtime.vce.stopBrowser();
        return {
          content: [{ type: 'text', text: `Failed to navigate: ${navResult.error.message}` }],
          isError: true,
        };
      }

      // Scan project and set context for source hints
      const scanResult = await runtime.projectScanner.scan();
      if (scanResult.ok) {
        const s = scanResult.value;
        runtime.vce.setProjectContext({
          rootPath: s.metadata.rootPath,
          projectId: s.metadata.projectId,
          name: s.metadata.name,
          directories: s.components.directories,
          primaryFramework: s.framework.primary,
          detectedFrameworks: s.framework.detected,
          frameworkConfidence: s.framework.confidence,
        });
      }

      const selection: SelectionTarget = {
        selector,
        boundingBox: { x: 0, y: 0, width: 100, height: 100 },
        source: 'mcp',
      };

      const result = await runtime.vce.generatePacket(selection);
      await runtime.vce.stopBrowser();

      if (!result.ok) {
        return {
          content: [{ type: 'text', text: `Capture failed: ${result.error.message}` }],
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
                packetId: packet.packetId,
                timestamp: packet.timestamp,
                selection: packet.selection,
                dom: { tagName: packet.dom.tagName, childCount: packet.dom.childCount },
                screenshots: packet.screenshots.length,
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
    },
  );

  await server.start();
}

async function cmdHealth(): Promise<void> {
  const runtime = createRuntime();
  console.log(
    JSON.stringify(
      {
        'browser-runtime': runtime.browserRuntime.health({ contextId: 'cli' }),
        'visual-context-engine': runtime.vce.health(),
        'selection-engine': runtime.selectionEngine.health(),
        'project-scanner': runtime.projectScanner.health(),
        'source-hint-engine': runtime.sourceHintEngine.health(),
      },
      null,
      2,
    ),
  );
}

function printHelp(): void {
  console.log(`Viskod — Visual Context Engine for AI-assisted software development

Usage:
  viskod start [url]     Start browser and navigate to URL
  viskod scan [path]     Scan project for metadata
  viskod capture <sel>   Select element and capture context
  viskod serve           Start MCP server on stdio
  viskod health          Show subsystem health

Examples:
  viskod start http://localhost:3000
  viskod scan
  viskod capture ".dashboard-header"
  viskod capture "#my-button" --url http://localhost:5173`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
