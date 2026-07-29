#!/usr/bin/env node
import { BrowserRuntime } from '@viskod/browser-runtime';
import { CapturePipeline } from '@viskod/capture-pipeline';
import { VisualContextEngine } from '@viskod/context-engine';
import { EventBus } from '@viskod/event-bus';
import { MCPServer } from '@viskod/mcp-server';
import { ProjectScanner } from '@viskod/project-scanner';
import { DaemonClient, DaemonServer, RuntimeSession } from '@viskod/runtime-session';
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
    case 'status':
      await cmdStatus();
      break;
    case 'stop':
      await cmdStop();
      break;
    default:
      printHelp();
  }
}

async function cmdStart(subArgs: string[]): Promise<void> {
  const targetUrl = subArgs[0] ?? 'http://localhost:3000';

  console.log('Viskod v0.0.1');
  console.log('Starting persistent runtime session...');

  const session = new RuntimeSession();
  const startResult = await session.start(targetUrl);
  if (!startResult.ok) {
    console.error(`Failed to start session: ${startResult.error.message}`);
    process.exit(1);
  }

  // Start daemon server for cross-process access
  const daemon = new DaemonServer(session);
  const port = await daemon.start();
  const info = startResult.value;
  info.port = port;
  session.writeSessionFile();

  console.log(`Browser session active at ${targetUrl}`);
  console.log(`Daemon listening on 127.0.0.1:${port}`);
  console.log("Use 'viskod capture <selector>' from another terminal");
  console.log("Use 'viskod status' to check session");
  console.log("Use 'viskod stop' to shut down");
  console.log('Press Ctrl+C to stop.');

  const cleanup = async () => {
    console.log('\nShutting down...');
    await daemon.stop();
    await session.stop();
    RuntimeSession.clearSessionFile();
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
  const selector = subArgs[0];

  if (!selector) {
    console.error('Usage: viskod capture <selector> [--url <url>]');
    process.exit(1);
  }

  const urlIdx = subArgs.indexOf('--url');
  const targetUrl = urlIdx >= 0 ? (subArgs[urlIdx + 1] ?? 'http://localhost:3000') : undefined;

  // Try to use existing session
  const sessionInfo = RuntimeSession.readSessionFile();
  if (sessionInfo && sessionInfo.status === 'running') {
    const client = new DaemonClient(sessionInfo.port, sessionInfo.token);
    const result = await client.capture(selector, targetUrl);
    if (result.ok) {
      const packet = result.value;
      console.log(
        JSON.stringify(
          {
            packetId: packet.packetId,
            timestamp: packet.timestamp,
            selection: packet.selection,
            dom: { tagName: packet.dom.tagName, childCount: packet.dom.childCount },
            screenshots: packet.screenshots.length,
            confidence: packet.confidence,
            evidenceSources: packet.metadata.evidenceSources,
            processingTimeMs: packet.metadata.processingTimeMs,
            session: 'shared',
          },
          null,
          2,
        ),
      );
      return;
    }
    // Daemon unreachable or rejected — clean stale session file
    RuntimeSession.clearSessionFile();
  }

  // Fallback: standalone capture (legacy behavior)
  const runtime = createRuntime();

  console.log('Starting browser...');
  const startResult = await runtime.vce.start();
  if (!startResult.ok) {
    console.error(`Failed to start browser: ${startResult.error.message}`);
    process.exit(1);
  }

  const navUrl = targetUrl ?? 'http://localhost:3000';
  console.log(`Navigating to ${navUrl}...`);
  const navResult = await runtime.vce.navigate(navUrl);
  if (!navResult.ok) {
    console.error(`Failed to navigate: ${navResult.error.message}`);
    process.exit(1);
  }

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
        session: 'standalone',
      },
      null,
      2,
    ),
  );

  await runtime.vce.stopBrowser();
}

async function cmdServe(): Promise<void> {
  const targetUrlIdx = process.argv.indexOf('--url');
  const targetUrl = targetUrlIdx >= 0 ? process.argv[targetUrlIdx + 1] : undefined;

  if (targetUrl) {
    console.log(`Starting Viskod MCP server with browser (${targetUrl})...`);
  } else {
    console.log('Starting Viskod MCP server...');
  }

  const session = new RuntimeSession();
  const server = new MCPServer();

  server.registerTool(
    {
      name: 'capture',
      description: 'Capture context for an element using a shared browser session',
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector for the element' },
          url: { type: 'string', description: 'URL to navigate to' },
        },
        required: ['selector'],
      },
    },
    async (args) => {
      const selector = args.selector as string;
      const url = args.url as string | undefined;

      // Start session if not running
      if (!session.getStatus()) {
        const startResult = await session.start(url ?? 'http://localhost:3000');
        if (!startResult.ok) {
          return {
            content: [
              { type: 'text', text: `Failed to start session: ${startResult.error.message}` },
            ],
            isError: true,
          };
        }
      } else if (url && url !== session.getStatus()?.browserUrl) {
        // Navigate to new URL within existing session
      }

      const result = await session.capture(selector, url);
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

  server.registerTool(
    {
      name: 'status',
      description: 'Show session status',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    async () => {
      const info = session.getStatus();
      return {
        content: [
          { type: 'text', text: info ? JSON.stringify(info, null, 2) : 'No active session' },
        ],
      };
    },
  );

  server.registerTool(
    {
      name: 'stop',
      description: 'Stop the runtime session',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    async () => {
      await session.stop();
      return { content: [{ type: 'text', text: 'Session stopped' }] };
    },
  );

  await server.start();
}

async function cmdStatus(): Promise<void> {
  const sessionInfo = RuntimeSession.readSessionFile();
  if (!sessionInfo) {
    console.log('No active session found.');
    return;
  }

  if (sessionInfo.status !== 'running') {
    console.log('Session is not running.');
    RuntimeSession.clearSessionFile();
    return;
  }

  // Verify daemon is responsive
  const client = new DaemonClient(sessionInfo.port, sessionInfo.token);
  const result = await client.status();
  if (result.ok) {
    console.log(JSON.stringify(result.value, null, 2));
  } else {
    console.log(`Session file found but daemon not reachable: ${result.error?.message}`);
    RuntimeSession.clearSessionFile();
  }
}

async function cmdStop(): Promise<void> {
  const sessionInfo = RuntimeSession.readSessionFile();
  if (!sessionInfo) {
    console.log('No active session found.');
    return;
  }

  const client = new DaemonClient(sessionInfo.port, sessionInfo.token);
  const result = await client.stop();
  if (result.ok) {
    RuntimeSession.clearSessionFile();
    console.log('Session stopped.');
  } else {
    console.error(`Failed to stop session: ${result.error?.message}`);
  }
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
  viskod start [url]     Start persistent runtime session
  viskod capture <sel>   Capture context (reuses session if available)
  viskod serve [--url]   Start MCP server (with optional browser)
  viskod status          Show session status
  viskod stop            Stop the runtime session
  viskod scan [path]     Scan project for metadata
  viskod health          Show subsystem health

Examples:
  viskod start http://localhost:5173
  viskod capture ".dashboard-header"
  viskod capture "#my-button" --url http://localhost:5173
  viskod serve --url http://localhost:3000`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
