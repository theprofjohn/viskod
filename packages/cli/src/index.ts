#!/usr/bin/env node
import { BrowserRuntime, resolveProfile } from '@viskod/browser-runtime';
import { CapturePipeline } from '@viskod/capture-pipeline';
import { VisualContextEngine, generateExport } from '@viskod/context-engine';
import { EventBus } from '@viskod/event-bus';
import { buildViskodServer } from '@viskod/mcp-server';
import { ProjectScanner } from '@viskod/project-scanner';
import { DaemonClient, DaemonServer, RuntimeSession } from '@viskod/runtime-session';
import { SelectionEngine } from '@viskod/selection-engine';
import { SourceHintEngine } from '@viskod/source-hint-engine';

function createRuntime() {
  const eventBus = new EventBus({ enableHistory: true, historySize: 100 });
  const browserRuntime = new BrowserRuntime(eventBus);
  const capturePipeline = new CapturePipeline();
  const selectionEngine = new SelectionEngine(eventBus, browserRuntime);
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
    case 'install':
      await cmdInstall(args.slice(1));
      break;
    default:
      printHelp();
  }
}

async function cmdStart(subArgs: string[]): Promise<void> {
  const targetUrl = subArgs[0] ?? 'http://localhost:3000';

  console.log('Viskod v0.2.0-alpha');
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

  // Use the full MCP tool set (30 tools) registered by @viskod/mcp-server
  const server = buildViskodServer({ targetUrl });
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

async function cmdInstall(subArgs: string[]): Promise<void> {
  const { existsSync, readFileSync, writeFileSync, mkdirSync } = await import('node:fs');
  const { join, dirname, resolve } = await import('node:path');
  const { homedir } = await import('node:os');
  const { fileURLToPath } = await import('node:url');

  const ide = (subArgs[0] ?? 'opencode').toLowerCase();
  const cwd = process.cwd();
  const home = homedir();

  // Resolve the Viskod repo root from THIS file's location, not process.cwd().
  // The CLI runs as <repo>/packages/cli/src/index.ts (or built dist), so walk up
  // until we find a package.json with "packages/cli" present.
  const thisFile = fileURLToPath(import.meta.url);
  let repoRoot = resolve(dirname(thisFile)); // start at src/ or dist/
  for (let i = 0; i < 6; i++) {
    if (
      existsSync(join(repoRoot, 'packages', 'cli')) &&
      existsSync(join(repoRoot, 'package.json'))
    ) {
      break;
    }
    const parent = dirname(repoRoot);
    if (parent === repoRoot) break;
    repoRoot = parent;
  }

  // Path to Viskod CLI entry (this repo)
  const viskodEntry = join(repoRoot, 'packages', 'cli', 'src', 'index.ts');
  const entryExists = existsSync(viskodEntry);
  if (!entryExists) {
    console.error(`Could not locate the Viskod CLI entry. Repo root resolved to: ${repoRoot}`);
    process.exit(1);
  }

  interface McpConfigFile {
    path: string;
    key: string; // top-level key holding mcp servers
    serverKey: string;
  }

  const targets: Record<string, McpConfigFile> = {
    opencode: {
      path: join(home, '.config', 'opencode', 'opencode.json'),
      key: 'mcp',
      serverKey: 'viskod',
    },
    cursor: {
      path: join(cwd, '.cursor', 'mcp.json'),
      key: 'mcpServers',
      serverKey: 'viskod',
    },
    claude: {
      path: join(home, '.claude.json'),
      key: 'mcpServers',
      serverKey: 'viskod',
    },
  };

  const target = targets[ide];
  if (!target) {
    console.error(`Unknown IDE "${ide}". Use one of: opencode, cursor, claude`);
    process.exit(1);
  }

  try {
    let config: Record<string, unknown> = {};
    if (existsSync(target.path)) {
      config = JSON.parse(readFileSync(target.path, 'utf-8'));
    }

    // Ensure nested structure exists
    if (!config[target.key] || typeof config[target.key] !== 'object') {
      config[target.key] = {};
    }

    if (ide === 'opencode') {
      // opencode uses: mcp: { name: { type: "local", command: [..], enabled: true } }
      (config[target.key] as Record<string, unknown>)[target.serverKey] = {
        type: 'local',
        command: ['npx', 'tsx', viskodEntry, 'serve', '--url', 'http://localhost:3000'],
        enabled: true,
      };
    } else {
      // cursor/claude use mcpServers: { name: { command, args, ... } }
      (config[target.key] as Record<string, unknown>)[target.serverKey] = {
        command: 'npx',
        args: ['tsx', viskodEntry, 'serve', '--url', 'http://localhost:3000'],
        env: {},
        disabled: false,
        autoApprove: [],
      };
    }

    mkdirSync(target.path.split('/').slice(0, -1).join('/') || '.', { recursive: true });
    writeFileSync(target.path, JSON.stringify(config, null, 2), 'utf-8');
    console.log(`✓ Installed Viskod MCP config for ${ide}`);
    console.log(`  → ${target.path}`);
    console.log('  Restart your IDE to pick up the MCP server.');
  } catch (error) {
    console.error(`Failed to install: ${String(error)}`);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`Viskod — Visual Context Engine for AI-assisted software development

Usage:
  viskod start [url]     Start persistent runtime session
  viskod capture <sel>   Capture context (reuses session if available)
  viskod serve [--url]   Start MCP server (with optional browser)
  viskod install [ide]   Install Viskod MCP config into your IDE (opencode|cursor|claude)
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
  viskod serve --url http://localhost:3000
  viskod install opencode`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
