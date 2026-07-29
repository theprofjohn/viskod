#!/usr/bin/env node
import { BrowserRuntime, resolveProfile } from '@viskod/browser-runtime';
import { CapturePipeline } from '@viskod/capture-pipeline';
import { VisualContextEngine, generateExport } from '@viskod/context-engine';
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
    case 'export':
      await cmdExport(args.slice(1));
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
    console.error(
      'Usage: viskod capture <selector> [--url <url>] [--profile <default|debug|audit>]',
    );
    process.exit(1);
  }

  const urlIdx = subArgs.indexOf('--url');
  const targetUrl = urlIdx >= 0 ? (subArgs[urlIdx + 1] ?? 'http://localhost:3000') : undefined;

  const profileIdx = subArgs.indexOf('--profile');
  const profileName = profileIdx >= 0 ? (subArgs[profileIdx + 1] ?? 'default') : undefined;
  const profile = profileName ? resolveProfile(profileName) : undefined;

  if (profileName && !['default', 'debug', 'audit'].includes(profileName)) {
    console.error(`Unknown profile "${profileName}". Valid values: default, debug, audit`);
    process.exit(1);
  }

  const projectPathIdx = subArgs.indexOf('--project-path');
  const projectPath = projectPathIdx >= 0 ? subArgs[projectPathIdx + 1] : undefined;

  // Try to use existing session
  const sessionInfo = RuntimeSession.readSessionFile();
  if (sessionInfo && sessionInfo.status === 'running') {
    const client = new DaemonClient(sessionInfo.port, sessionInfo.token);
    const result = await client.capture(selector, targetUrl, profileName);
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
            profile: profileName ?? 'default',
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

  const scanResult = await runtime.projectScanner.scan(projectPath);
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
  const result = await runtime.vce.generatePacket(selection, profile);
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
          profile: {
            type: 'string',
            description: 'Capture profile: default, debug, or audit (default: default)',
            enum: ['default', 'debug', 'audit'],
          },
        },
        required: ['selector'],
      },
    },
    async (args) => {
      const selector = args.selector as string;
      const url = args.url as string | undefined;
      const profileName = (args.profile as string | undefined) ?? 'default';
      const profile = resolveProfile(profileName);

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
      }

      const result = await session.capture(selector, url, profile);
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
                profile: profileName,
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

  server.registerTool(
    {
      name: 'export_context',
      description: 'Export a Context Packet to an agent-friendly brief (markdown or compact JSON)',
      inputSchema: {
        type: 'object',
        properties: {
          packetPath: { type: 'string', description: 'Path to packet.json file' },
          format: {
            type: 'string',
            description: 'Output format: markdown or json (default: markdown)',
            enum: ['markdown', 'json'],
          },
        },
        required: ['packetPath'],
      },
    },
    async (args) => {
      const packetPath = args.packetPath as string;
      const format = (args.format as string | undefined) ?? 'markdown';

      if (format !== 'markdown' && format !== 'json') {
        return {
          content: [{ type: 'text', text: 'Format must be "markdown" or "json"' }],
          isError: true,
        };
      }

      let raw: string;
      try {
        const { readFileSync } = await import('node:fs');
        raw = readFileSync(packetPath, 'utf-8');
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to read packet: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }

      let packet: Record<string, unknown>;
      try {
        packet = JSON.parse(raw);
      } catch {
        return {
          content: [{ type: 'text', text: 'Failed to parse packet: not valid JSON' }],
          isError: true,
        };
      }

      try {
        const output = generateExport(packet as unknown as Parameters<typeof generateExport>[0], {
          format: format as 'markdown' | 'json',
        });
        return { content: [{ type: 'text', text: output }] };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Export failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    {
      name: 'capture_context',
      description: 'Capture an element and return an agent-ready context brief in one step',
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector for the element' },
          url: { type: 'string', description: 'URL to navigate to' },
          profile: {
            type: 'string',
            description: 'Capture profile: default, debug, or audit',
            enum: ['default', 'debug', 'audit'],
          },
          projectPath: {
            type: 'string',
            description: 'Project root path for source scanning (default: auto-discover)',
          },
          format: {
            type: 'string',
            description: 'Brief format: markdown or json (default: markdown)',
            enum: ['markdown', 'json'],
          },
        },
        required: ['selector'],
      },
    },
    async (args) => {
      const selector = args.selector as string;
      const url = args.url as string | undefined;
      const profileName = (args.profile as string | undefined) ?? 'default';
      const projectPath = args.projectPath as string | undefined;
      const format = (args.format as string | undefined) ?? 'markdown';

      const profile = resolveProfile(profileName);

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
      }

      // Set project context if specified
      if (projectPath && session.getStatus()) {
        const scanResult = await session.getProjectScanner().scan(projectPath);
        if (scanResult.ok) {
          const s = scanResult.value;
          session.getVCE().setProjectContext({
            rootPath: s.metadata.rootPath,
            projectId: s.metadata.projectId,
            name: s.metadata.name,
            directories: s.components.directories,
            primaryFramework: s.framework.primary,
            detectedFrameworks: s.framework.detected,
            frameworkConfidence: s.framework.confidence,
          });
        }
      }

      const result = await session.capture(selector, url, profile);
      if (!result.ok) {
        return {
          content: [{ type: 'text', text: `Capture failed: ${result.error.message}` }],
          isError: true,
        };
      }

      const packet = result.value;
      const brief = generateExport(packet, { format: format as 'markdown' | 'json' });

      const captureDir = packet.captureDir ?? '';
      const packetPath = captureDir ? `${captureDir.replace(/\\/g, '/')}/packet.json` : '';
      const screenshotPaths = (packet.screenshots ?? []).map((s) => s.path);
      const sourceHintCount = (packet.sourceHints ?? []).length;
      const consoleCount = (packet.runtimeEvidence?.console ?? []).length;
      const networkCount = (packet.runtimeEvidence?.network ?? []).length;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                packetId: packet.packetId,
                packetPath,
                captureDir,
                profile: profileName,
                briefFormat: format,
                brief,
                screenshotPaths,
                sourceHintCount,
                runtimeEvidenceSummary: { console: consoleCount, network: networkCount },
                redactionSummary: packet.metadata?.redactions ?? [],
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
      name: 'recapture_context',
      description: 'Re-capture an element and optionally compare with a previous capture',
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector for the element' },
          url: { type: 'string', description: 'URL to navigate to' },
          profile: {
            type: 'string',
            description: 'Capture profile',
            enum: ['default', 'debug', 'audit'],
          },
          projectPath: {
            type: 'string',
            description: 'Project root path for source scanning (default: auto-discover)',
          },
          previousPacketPath: {
            type: 'string',
            description: 'Path to previous packet.json for comparison',
          },
          format: { type: 'string', description: 'Brief format', enum: ['markdown', 'json'] },
        },
        required: ['selector'],
      },
    },
    async (args) => {
      const selector = args.selector as string;
      const url = args.url as string | undefined;
      const profileName = (args.profile as string | undefined) ?? 'default';
      const projectPath = args.projectPath as string | undefined;
      const prevPath = args.previousPacketPath as string | undefined;
      const format = (args.format as string | undefined) ?? 'markdown';

      const profile = resolveProfile(profileName);

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
      }

      // Set project context if specified
      if (projectPath && session.getStatus()) {
        const scanResult = await session.getProjectScanner().scan(projectPath);
        if (scanResult.ok) {
          const s = scanResult.value;
          session.getVCE().setProjectContext({
            rootPath: s.metadata.rootPath,
            projectId: s.metadata.projectId,
            name: s.metadata.name,
            directories: s.components.directories,
            primaryFramework: s.framework.primary,
            detectedFrameworks: s.framework.detected,
            frameworkConfidence: s.framework.confidence,
          });
        }
      }

      const result = await session.capture(selector, url, profile);
      if (!result.ok) {
        return {
          content: [{ type: 'text', text: `Capture failed: ${result.error.message}` }],
          isError: true,
        };
      }

      const packet = result.value;
      const brief = generateExport(packet, { format: format as 'markdown' | 'json' });

      let comparisonSummary: Record<string, unknown> | undefined;
      if (prevPath) {
        try {
          const { readFileSync } = await import('node:fs');
          const raw = readFileSync(prevPath, 'utf-8');
          const prev: Record<string, unknown> = JSON.parse(raw);
          const prevSelection = (prev as any).selection ?? {};
          const curSelection = packet.selection ?? {};
          const prevBox = prevSelection.boundingBox ?? {};
          const curBox = curSelection.boundingBox ?? {};

          comparisonSummary = {
            boundingBoxDelta: {
              x:
                curBox.x !== undefined && prevBox.x !== undefined
                  ? curBox.x - prevBox.x
                  : undefined,
              y:
                curBox.y !== undefined && prevBox.y !== undefined
                  ? curBox.y - prevBox.y
                  : undefined,
              width:
                curBox.width !== undefined && prevBox.width !== undefined
                  ? curBox.width - prevBox.width
                  : undefined,
              height:
                curBox.height !== undefined && prevBox.height !== undefined
                  ? Math.round((curBox.height - prevBox.height) * 100) / 100
                  : undefined,
            },
            screenshotsBefore: (prev as any).screenshots?.length ?? 0,
            screenshotsAfter: (packet.screenshots ?? []).length,
            sourceHintsBefore: (prev as any).sourceHints?.length ?? 0,
            sourceHintsAfter: (packet.sourceHints ?? []).length,
            consoleBefore: (prev as any).runtimeEvidence?.console?.length ?? 0,
            consoleAfter: (packet.runtimeEvidence?.console ?? []).length,
            networkBefore: (prev as any).runtimeEvidence?.network?.length ?? 0,
            networkAfter: (packet.runtimeEvidence?.network ?? []).length,
          };
        } catch {
          comparisonSummary = { error: 'Failed to read previous packet for comparison' };
        }
      }

      const screenshotPaths = (packet.screenshots ?? []).map((s) => s.path);
      const sourceHintCount = (packet.sourceHints ?? []).length;
      const consoleCount = (packet.runtimeEvidence?.console ?? []).length;
      const networkCount = (packet.runtimeEvidence?.network ?? []).length;

      const captureDir = packet.captureDir ?? '';
      const packetPathOut = captureDir ? `${captureDir.replace(/\\/g, '/')}/packet.json` : '';

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                packetId: packet.packetId,
                packetPath: packetPathOut,
                captureDir,
                profile: profileName,
                briefFormat: format,
                brief,
                screenshotPaths,
                sourceHintCount,
                runtimeEvidenceSummary: { console: consoleCount, network: networkCount },
                redactionSummary: packet.metadata?.redactions ?? [],
                comparisonSummary,
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
    console.log(JSON.stringify({ ...result.value, token: '[REDACTED]' }, null, 2));
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

async function cmdExport(subArgs: string[]): Promise<void> {
  const packetPath = subArgs[0];
  if (!packetPath) {
    console.error('Usage: viskod export <packet-path> [--format markdown|json] [--out <file>]');
    process.exit(1);
  }

  const formatIdx = subArgs.indexOf('--format');
  const format = formatIdx >= 0 ? (subArgs[formatIdx + 1] ?? 'markdown') : 'markdown';

  const outIdx = subArgs.indexOf('--out');
  const outPath = outIdx >= 0 ? subArgs[outIdx + 1] : undefined;

  if (format !== 'markdown' && format !== 'json') {
    console.error('Usage: --format must be "markdown" or "json"');
    process.exit(1);
  }

  let raw: string;
  try {
    const { readFileSync } = await import('node:fs');
    raw = readFileSync(packetPath, 'utf-8');
  } catch (err) {
    console.error(`Failed to read packet: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  let packet: Record<string, unknown>;
  try {
    packet = JSON.parse(raw);
  } catch {
    console.error('Failed to parse packet: not valid JSON');
    process.exit(1);
  }

  const output = generateExport(packet as unknown as Parameters<typeof generateExport>[0], {
    format: format as 'markdown' | 'json',
  });

  if (outPath) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(outPath, output, 'utf-8');
    console.log(`Exported to ${outPath}`);
  } else {
    console.log(output);
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
  viskod export <path>   Export Context Packet to agent brief (--format markdown|json, --out <file>)
  viskod scan [path]     Scan project for metadata
  viskod health          Show subsystem health

Examples:
  viskod start http://localhost:5173
  viskod capture ".dashboard-header"
  viskod capture "#my-button" --url http://localhost:5173
  viskod capture ".card" --project-path ./my-app
  viskod serve --url http://localhost:3000`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
