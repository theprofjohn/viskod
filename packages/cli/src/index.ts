#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { BrowserRuntime, resolveProfile } from '@viskod/browser-runtime';
import { CapturePipeline } from '@viskod/capture-pipeline';
import { VisualContextEngine, generateExport } from '@viskod/context-engine';
import { EventBus } from '@viskod/event-bus';
import { buildViskodServer } from '@viskod/mcp-server';
import { ProjectScanner } from '@viskod/project-scanner';
import { DaemonClient, DaemonServer, RuntimeSession } from '@viskod/runtime-session';
import { SelectionEngine } from '@viskod/selection-engine';
import {
  buildDoctorDiagnosticProjection,
  completeSetup,
  detectAndConfigureProject,
  getMcpServeCommand,
  hasDoctorRequiredFailure,
  initializeProjectWorkspace,
  installAgentConfig,
  runAllChecks,
  runDoctor,
  runSmoke,
  verifyMcpToolsRuntime,
} from '@viskod/setup';
import { SourceHintEngine } from '@viskod/source-hint-engine';

// Injected at bundle time by scripts/build-cli.mjs from the publishable
// packages/cli/package.json version. Source runs (tsx) fall back to a dev
// marker; the published executable always reports the real package version.
declare const __VISKOD_VERSION__: string | undefined;
const VISKOD_VERSION = typeof __VISKOD_VERSION__ !== 'undefined' ? __VISKOD_VERSION__ : '0.0.0-dev';

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
  if (args[1] === '--help' || args[1] === '-h') {
    printCommandHelp(command);
    return;
  }

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
    case 'setup':
      await cmdSetup(args.slice(1));
      break;
    case 'doctor':
      await cmdDoctor(args.slice(1));
      break;
    case 'version':
    case '--version':
    case '-v':
      console.log(`Viskod v${VISKOD_VERSION}`);
      break;
    default:
      printHelp();
  }
}

async function cmdStart(subArgs: string[]): Promise<void> {
  const targetUrl = subArgs[0] ?? 'http://localhost:3000';

  console.log(`Viskod v${VISKOD_VERSION}`);
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
    // Discover workspace metadata
    const workspaceResult = await runtime.projectScanner.discoverWorkspace(
      projectPath ?? s.metadata.rootPath,
    );
    const workspace = workspaceResult.ok ? workspaceResult.value : undefined;

    runtime.vce.setProjectContext({
      rootPath: s.metadata.rootPath,
      projectId: s.metadata.projectId,
      name: s.metadata.name,
      directories: s.components.directories,
      primaryFramework: s.framework.primary,
      detectedFrameworks: s.framework.detected,
      frameworkConfidence: s.framework.confidence,
      workspace,
    });

    runtime.sourceHintEngine.invalidateCache(projectPath ?? s.metadata.rootPath);
  }

  console.log(`Selecting element: ${selector}...`);
  // Bare selector: no target geometry is available (Phase 28A). The box is
  // omitted entirely — multi-match selectors fail closed with
  // SELECTOR_AMBIGUOUS instead of being disambiguated by a synthetic default.
  const selection: {
    selector: string;
    source: 'mcp';
  } = {
    selector,
    source: 'mcp',
  };

  // "Element resolved" is only claimed after browser-backed capture succeeds
  // (VISKOD-AUDIT-015): generatePacket fails closed on malformed, missing,
  // detached, or ambiguous selectors instead of fabricating an "unknown" target.
  console.log('Capturing context...');
  const result = await runtime.vce.generatePacket(selection, profile);
  if (!result.ok) {
    console.error(`Capture failed: ${result.error.message}`);
    process.exit(1);
  }

  console.log(
    `Element resolved: ${result.value.selection.selector} (${result.value.selection.tagName})`,
  );

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

  // Phase 30: the MCP server establishes project context ONLY from this
  // explicit root — never by guessing from cwd.
  const projectRootIdx = process.argv.indexOf('--project-root');
  const projectRootPath = projectRootIdx >= 0 ? process.argv[projectRootIdx + 1] : undefined;

  if (targetUrl) {
    console.error(`Starting Viskod MCP server with browser (${targetUrl})...`);
  } else {
    console.error('Starting Viskod MCP server...');
  }
  if (projectRootPath) {
    console.error(`Project root: ${projectRootPath} (source resolution enabled)`);
  } else {
    console.error(
      'No --project-root provided: source resolution will report unavailable (never guessed).',
    );
  }

  // Use the full MCP tool set (30 tools) registered by @viskod/mcp-server
  const server = buildViskodServer({ targetUrl, projectRootPath });
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
  const ide = (subArgs[0] ?? 'opencode').toLowerCase();
  if (ide !== 'opencode' && ide !== 'cursor' && ide !== 'claude') {
    console.error(`Unknown IDE "${ide}". Use one of: opencode, cursor, claude`);
    process.exit(1);
  }

  const projectRoot = getFlagValue(subArgs, '--project-root');
  const useDevSource = hasFlag(subArgs, '--source');
  const serveCommand = useDevSource
    ? getMcpServeCommand({ mode: 'dev', projectRoot })
    : getMcpServeCommand({ projectRoot });

  const installed = installAgentConfig({
    kind: ide,
    serveCommand,
    home: homedir(),
    cwd: projectRoot ?? process.cwd(),
    projectRoot,
  });
  if (!installed.ok) {
    console.error(`Failed to install: ${installed.error.message}`);
    process.exit(1);
  }

  console.log(`✓ Installed Viskod MCP config for ${ide}`);
  console.log(`  → ${installed.value.path}`);
  if (installed.value.changed) {
    console.log(
      installed.value.previous !== undefined
        ? '  Updated existing entry (previous entry preserved).'
        : '  Added new entry.',
    );
  } else {
    console.log('  Config unchanged (entry already matches).');
  }
  console.log(
    `  serve: ${serveCommand.command} ${serveCommand.args.join(' ')} (${serveCommand.mode})`,
  );
  console.log('  Restart your IDE to pick up the MCP server.');
}

// --- CLI argument helpers ---

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx < 0 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

// --- viskod setup ---

async function cmdSetup(subArgs: string[]): Promise<void> {
  const projectRootArg = getFlagValue(subArgs, '--project-root');
  const appUrl = getFlagValue(subArgs, '--app-url');
  const installAgent = getFlagValue(subArgs, '--install');
  const forceLimited = hasFlag(subArgs, '--limited');
  const skipSmoke = hasFlag(subArgs, '--skip-smoke');

  // 1. Resolve project root
  let projectRoot: string | undefined;
  if (projectRootArg) {
    projectRoot = resolve(projectRootArg);
    if (!existsSync(projectRoot) || !existsSync(join(projectRoot, 'package.json'))) {
      console.error(`Project root does not exist or has no package.json: ${projectRoot}`);
      process.exit(1);
    }
  } else {
    const cwd = process.cwd();
    if (existsSync(join(cwd, 'package.json'))) {
      projectRoot = cwd;
      console.log(`Using current directory as project root: ${cwd}`);
    } else {
      console.error(
        'No --project-root provided and current directory has no package.json.\n' +
          'Usage: viskod setup --project-root <path>',
      );
      process.exit(1);
    }
  }

  console.log(`\nViskod setup — project root: ${projectRoot}\n`);

  // 2. Initialize workspace
  const initResult = initializeProjectWorkspace({ projectRoot });
  if (!initResult.ok) {
    console.error(`Workspace init failed: ${initResult.error.message}`);
    process.exit(1);
  }
  console.log('Workspace initialized.');

  // 3. Detect project
  const project = detectAndConfigureProject({ projectRoot });
  if (!project.ok) {
    console.error(`Project detection failed: ${project.error.message}`);
    process.exit(1);
  }
  console.log(`Project: ${project.value.name} (${project.value.framework ?? 'unknown framework'})`);

  // 4. Run checks
  console.log('\nRunning environment checks...');
  const checks = await runAllChecks({ projectRoot, includeOptional: true, appUrl });
  for (const check of checks) {
    const mark = check.status === 'pass' ? '✓' : check.status === 'fail' ? '✗' : '–';
    const extra = check.severity === 'required' ? ' (required)' : '';
    console.log(`  ${mark} ${check.name}${extra}: ${check.summary}`);
  }

  const criticalFailures = checks.filter(
    (c) =>
      c.severity === 'required' &&
      c.status === 'fail' &&
      c.checkId !== 'mcp-tools-runtime' &&
      c.checkId !== 'browser-runtime',
  );
  if (criticalFailures.length > 0) {
    console.error(
      `\n${criticalFailures.length} critical check(s) failed. Fix these before continuing.`,
    );
    process.exit(1);
  }

  // 5. MCP runtime verification
  console.log('\nVerifying MCP runtime...');
  let mcpOk = false;
  try {
    const mcpResult = await verifyMcpToolsRuntime(projectRoot);
    if (mcpResult.ok && mcpResult.value.requiredToolsPresent) {
      mcpOk = true;
      const timing = mcpResult.value.timing;
      console.log(`  MCP runtime verified (${mcpResult.value.mode}; ${timing?.totalMs ?? '?'}ms)`);
    } else {
      const msg = mcpResult.ok
        ? `Missing tools: ${mcpResult.value.missingRequiredTools.join(', ')}`
        : mcpResult.error.message;
      console.error(`  MCP runtime verification failed: ${msg}`);
    }
  } catch (e) {
    console.error(
      `  MCP runtime verification error: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // 6. Capture smoke
  let smokeResult: Awaited<ReturnType<typeof runSmoke>> | undefined;
  if (!skipSmoke) {
    console.log('\nRunning capture smoke...');
    smokeResult = await runSmoke({ projectRoot, url: appUrl });
    if (smokeResult.ok) {
      console.log(
        `  Smoke: ${smokeResult.value.status}${smokeResult.value.packetId ? ' (packet OK)' : ''}`,
      );
    } else {
      console.error(`  Smoke failed: ${smokeResult.error.message}`);
    }
  }

  // 7. Consent gate
  const browserCheck = checks.find((c) => c.checkId === 'browser-runtime');
  const browserVerified = browserCheck?.status === 'pass';
  const captureSmokePassed = smokeResult?.ok === true && !!smokeResult.value.packetId;
  const isFull = mcpOk && browserVerified && captureSmokePassed;

  let limitedMode = false;
  const limitedReasons: string[] = [];

  if (!isFull) {
    if (forceLimited) {
      limitedMode = true;
      if (!mcpOk) limitedReasons.push('MCP runtime verification failed');
      if (!browserVerified) limitedReasons.push('Browser runtime not verified');
      if (!captureSmokePassed) limitedReasons.push('Capture smoke did not produce a packet');
      console.log(`\nContinuing in limited mode: ${limitedReasons.join('; ')}`);
    } else if (process.stdin.isTTY) {
      // Interactive consent
      const readline = await import('node:readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((resolve) => {
        rl.question('\nSetup cannot complete all checks. Continue in limited mode? [y/N] ', (a) => {
          rl.close();
          resolve(a.trim().toLowerCase());
        });
      });
      if (answer === 'y' || answer === 'yes') {
        limitedMode = true;
        if (!mcpOk) limitedReasons.push('MCP runtime verification failed');
        if (!browserVerified) limitedReasons.push('Browser runtime not verified');
        if (!captureSmokePassed) limitedReasons.push('Capture smoke did not produce a packet');
        console.log(`Limited mode: ${limitedReasons.join('; ')}`);
      } else {
        console.error('\nSetup cancelled. Run viskod setup again when ready.');
        process.exit(1);
      }
    } else {
      console.error(
        '\nSetup incomplete. Re-run with --limited to continue in limited mode, or fix the issues above.',
      );
      process.exit(1);
    }
  }

  // 8. Complete setup
  const result = completeSetup({
    projectRoot,
    project: project.value,
    checks,
    smoke: smokeResult?.ok ? smokeResult.value : undefined,
    limitedMode,
    limitedReasons,
    appUrl,
  });

  if (!result.ok) {
    console.error(`Failed to persist setup state: ${result.error.message}`);
    process.exit(1);
  }

  const state = result.value;
  console.log(`\nSetup ${state.state}.`);
  if (state.sourceResolution) {
    console.log(`Source resolution: ${state.sourceResolution}`);
  }

  // 9. Agent config install
  if (installAgent) {
    const kind = installAgent as 'opencode' | 'cursor' | 'claude';
    const serveCmd = getMcpServeCommand({ projectRoot, url: appUrl ?? 'http://localhost:3000' });
    const install = installAgentConfig({
      kind,
      serveCommand: serveCmd,
      projectRoot,
      home: homedir(),
      cwd: process.cwd(),
    });
    if (install.ok) {
      console.log(
        `\nAgent config: ${install.value.path} (${install.value.changed ? 'updated' : 'unchanged'})`,
      );
    } else {
      console.error(`\nAgent config install failed: ${install.error.message}`);
    }
  }
}
async function cmdDoctor(subArgs: string[]): Promise<void> {
  const projectRoot =
    getFlagValue(subArgs, '--project-root') ??
    (existsSync(join(process.cwd(), 'package.json')) ? process.cwd() : undefined);
  const appUrl = getFlagValue(subArgs, '--app-url');
  const json = hasFlag(subArgs, '--json');
  const reportMode = hasFlag(subArgs, '--report');

  const report = await runDoctor({ projectRoot, appUrl });
  const projection = buildDoctorDiagnosticProjection(report);

  if (json || reportMode) {
    // Both machine-readable report modes intentionally emit the same
    // path-free allowlisted projection.
    console.log(JSON.stringify(projection, null, 2));
    process.exit(hasDoctorRequiredFailure(report) ? 1 : 0);
  }

  console.log('Viskod doctor — checking environment...\n');
  const line = (label: string, ok: boolean, detail: string) => {
    console.log(`  ${ok ? '✓' : '✗'} ${label}: ${detail}`);
  };

  line('Node.js', report.node.ok, `v${report.node.version}`);
  line(
    'Chromium',
    report.chromium.verified,
    report.chromium.executablePath ?? report.chromium.hint ?? 'not found',
  );
  line(
    'MCP runtime',
    report.mcp.ok,
    report.mcp.mode
      ? `${report.mcp.mode} (${report.mcp.durationMs ?? '?'}ms, ${report.mcp.toolsFound ?? 0} tools)`
      : (report.mcp.error ?? 'failed'),
  );
  line(
    'Project root',
    report.project.ok,
    report.project.rootPath
      ? `${report.project.rootPath} — ${report.project.reason ?? 'scanned'}`
      : (report.project.reason ?? 'not configured'),
  );
  line('Source resolution', report.sourceResolution === 'ready', report.sourceResolution);
  line(
    'Studio (3001)',
    report.studio.reachable,
    report.studio.reachable ? 'running' : 'not reachable',
  );
  line(
    'Setup state',
    !report.setupState.stale,
    report.setupState.exists
      ? `${report.setupState.state ?? 'unknown'}${report.setupState.stale ? ' (stale — re-run setup)' : ''}`
      : 'never run',
  );
  line(
    'Agent config',
    report.agentConfig?.detected ?? false,
    report.agentConfig?.detected
      ? `${report.agentConfig.kind} at ${report.agentConfig.configPath}`
      : 'not detected',
  );

  const requiredFailure = hasDoctorRequiredFailure(report);
  console.log(
    `\n${
      requiredFailure
        ? 'Required checks failed.'
        : projection.recommendedAttention > 0
          ? 'Required checks passed; recommendations need attention.'
          : 'All checks passed.'
    }`,
  );
  process.exit(requiredFailure ? 1 : 0);
}

function printCommandHelp(commandName: string): void {
  const help: Record<string, string> = {
    setup:
      'Usage: viskod setup --project-root <path> [--app-url <url>] [--install <opencode|cursor|claude>] [--limited] [--skip-smoke]',
    doctor: 'Usage: viskod doctor [--project-root <path>] [--app-url <url>] [--json|--report]',
    install: 'Usage: viskod install [opencode|cursor|claude] [--project-root <path>] [--source]',
    serve: 'Usage: viskod serve [--url <url>] [--project-root <path>]',
  };
  console.log(help[commandName] ?? 'Run viskod --help for available commands.');
}

function printHelp(): void {
  console.log(`Viskod — Visual Context Engine for AI-assisted software development

Usage:
  viskod start [url]     Start persistent runtime session
  viskod capture <sel>   Capture context (reuses session if available)
  viskod serve [--url] [--project-root <dir>]   Start MCP server (with optional browser + explicit project root)
  viskod install [ide]   Install Viskod MCP config into your IDE (opencode|cursor|claude)
  viskod doctor [--project-root] [--json|--report]
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
  viskod install opencode
  viskod setup --project-root ./my-app --install cursor
  viskod doctor --project-root ./my-app`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
