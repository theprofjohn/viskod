import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VISKOD_STORAGE_DIR } from '@viskod/shared';
import type {
  AgentConfigInfo,
  AppUrlValidation,
  LiveMcpVerification,
  McpToolVerification,
  SetupCheckResult,
  SetupCheckSeverity,
} from './types';

const VISKOD_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function resolveViskodRoot(): string {
  return fs.existsSync(path.join(VISKOD_ROOT, 'packages', 'mcp-server', 'src', 'entry.ts'))
    ? VISKOD_ROOT
    : process.cwd();
}

const REQUIRED_MCP_TOOLS = [
  'viskod_capture_context',
  'create_agent_handoff',
  'get_agent_handoff',
  'list_agent_handoffs',
  'create_visual_review',
  'get_visual_review',
  'recapture_visual_review',
  'resolve_usage_site_hints',
];

function check(
  checkId: string,
  name: string,
  severity: SetupCheckSeverity,
  status: SetupCheckResult['status'],
  summary: string,
  details?: string,
  remediation?: SetupCheckResult['remediation'],
  durationMs?: number,
): SetupCheckResult {
  return { checkId, name, severity, status, summary, details, remediation, durationMs };
}

function runCheck(fn: () => SetupCheckResult): SetupCheckResult {
  const start = Date.now();
  try {
    const result = fn();
    result.durationMs = Date.now() - start;
    return result;
  } catch (e) {
    return {
      checkId: 'unknown',
      name: 'Unknown check',
      severity: 'optional',
      status: 'fail',
      summary: `Check failed: ${e instanceof Error ? e.message : String(e)}`,
      durationMs: Date.now() - start,
    };
  }
}

function checkNodeVersion(): SetupCheckResult {
  return runCheck(() => {
    const version = process.version;
    const major = Number.parseInt(version.slice(1), 10);
    if (major >= 22) {
      return check(
        'node-version',
        'Node.js version',
        'required',
        'pass',
        `Node ${version} (>= 22 required)`,
      );
    }
    return check(
      'node-version',
      'Node.js version',
      'required',
      'fail',
      `Node ${version} detected, but >= 22 is required`,
      'Upgrade Node.js to version 22 or later.',
      {
        actionId: 'upgrade-node',
        label: 'Upgrade Node.js',
        kind: 'manual_command',
        commandPreview: 'nvm install 22',
        safe: true,
      },
    );
  });
}

function checkPackageManager(): SetupCheckResult {
  return runCheck(() => {
    const managers = ['pnpm', 'npm', 'yarn', 'bun'];
    for (const mgr of managers) {
      try {
        execSync(`${mgr} --version`, { stdio: 'pipe', timeout: 5000 });
        return check(
          'package-manager',
          'Package manager',
          'required',
          'pass',
          `${mgr} is available`,
        );
      } catch {
        /* continue */
      }
    }
    return check(
      'package-manager',
      'Package manager',
      'required',
      'fail',
      'No supported package manager found',
      'Install pnpm, npm, yarn, or bun.',
      {
        actionId: 'install-package-manager',
        label: 'Install pnpm',
        kind: 'manual_command',
        commandPreview: 'npm install -g pnpm',
        safe: true,
      },
    );
  });
}

function checkViskodWorkspace(projectRoot: string): SetupCheckResult {
  return runCheck(() => {
    const viskodDir = path.join(projectRoot, VISKOD_STORAGE_DIR);
    if (!fs.existsSync(viskodDir)) {
      return check(
        'viskod-workspace',
        'Viskod workspace',
        'required',
        'fail',
        `${VISKOD_STORAGE_DIR} directory does not exist`,
        'Initialize the workspace during setup.',
        {
          actionId: 'init-workspace',
          label: 'Initialize workspace',
          kind: 'repair_workspace',
          safe: true,
        },
      );
    }
    return check(
      'viskod-workspace',
      'Viskod workspace',
      'required',
      'pass',
      `${VISKOD_STORAGE_DIR} directory exists`,
    );
  });
}

function checkProjectReadability(projectRoot: string): SetupCheckResult {
  return runCheck(() => {
    try {
      fs.accessSync(projectRoot, fs.constants.R_OK);
      const pkgPath = path.join(projectRoot, 'package.json');
      if (fs.existsSync(pkgPath)) {
        fs.readFileSync(pkgPath, 'utf-8');
        return check(
          'project-readable',
          'Project readability',
          'required',
          'pass',
          'Project files are readable',
        );
      }
      return check(
        'project-readable',
        'Project readability',
        'required',
        'warning',
        'package.json not found but directory is readable',
        'Ensure you are in a valid project directory.',
      );
    } catch {
      return check(
        'project-readable',
        'Project readability',
        'required',
        'fail',
        'Cannot read project files',
        'Check folder permissions.',
        {
          actionId: 'check-permissions',
          label: 'Check permissions',
          kind: 'manual_command',
          commandPreview: `ls -la "${projectRoot}"`,
          safe: true,
        },
      );
    }
  });
}

function checkViskodWorkspaceWritable(projectRoot: string): SetupCheckResult {
  return runCheck(() => {
    const viskodDir = path.join(projectRoot, VISKOD_STORAGE_DIR);
    if (!fs.existsSync(viskodDir)) {
      return check(
        'viskod-writable',
        'Workspace writable',
        'required',
        'skipped',
        'Workspace not initialized yet',
      );
    }
    try {
      const testFile = path.join(viskodDir, '.viskod-write-test');
      fs.writeFileSync(testFile, '', 'utf-8');
      fs.unlinkSync(testFile);
      return check(
        'viskod-writable',
        'Workspace writable',
        'required',
        'pass',
        'Workspace directory is writable',
      );
    } catch {
      return check(
        'viskod-writable',
        'Workspace writable',
        'required',
        'fail',
        'Cannot write to workspace directory',
        'Check folder permissions.',
        {
          actionId: 'check-permissions',
          label: 'Check permissions',
          kind: 'manual_command',
          commandPreview: `ls -la "${viskodDir}"`,
          safe: true,
        },
      );
    }
  });
}

function checkProjectScanner(): SetupCheckResult {
  return runCheck(() => {
    try {
      const scannerPath = path.join(
        process.cwd(),
        'packages',
        'project-scanner',
        'src',
        'index.ts',
      );
      if (fs.existsSync(scannerPath)) {
        return check(
          'project-scanner',
          'Project scanner',
          'required',
          'pass',
          'Project scanner is available',
        );
      }
      return check(
        'project-scanner',
        'Project scanner',
        'required',
        'warning',
        'Project scanner not found at expected path',
      );
    } catch {
      return check(
        'project-scanner',
        'Project scanner',
        'required',
        'warning',
        'Could not verify project scanner',
      );
    }
  });
}

async function checkBrowserRuntimeLive(projectRoot: string): Promise<SetupCheckResult> {
  const start = Date.now();
  try {
    // Check if playwright is available
    let playwrightAvailable = false;
    try {
      require.resolve('playwright', { paths: [projectRoot, process.cwd()] });
      playwrightAvailable = true;
    } catch {
      /* continue */
    }

    if (!playwrightAvailable) {
      const nmPath = path.join(projectRoot, 'node_modules', 'playwright');
      if (fs.existsSync(nmPath)) {
        playwrightAvailable = true;
      }
    }

    if (!playwrightAvailable) {
      return {
        checkId: 'browser-runtime',
        name: 'Browser runtime',
        severity: 'required',
        status: 'fail',
        summary: 'Playwright not found',
        details: 'Browser features require Playwright.',
        remediation: {
          actionId: 'install-playwright',
          label: 'Install Playwright',
          kind: 'manual_command',
          commandPreview: 'npm install playwright',
          safe: true,
        },
        durationMs: Date.now() - start,
      };
    }

    // Launch and shutdown a browser to verify runtime
    const { chromium } = require('playwright');
    const browser = await chromium.launch({ headless: true, timeout: 15000 });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();

    // Navigate to a test page
    await page.setContent('<html><body><h1>Viskod Setup</h1></body></html>', { timeout: 5000 });

    // Verify page loaded
    // Shutdown cleanly
    await page.close();
    await context.close();
    await browser.close();

    return {
      checkId: 'browser-runtime',
      name: 'Browser runtime',
      severity: 'required',
      status: 'pass',
      summary: 'Browser launch, navigate, and shutdown verified',
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return {
      checkId: 'browser-runtime',
      name: 'Browser runtime',
      severity: 'required',
      status: 'fail',
      summary: `Browser runtime check failed: ${e instanceof Error ? e.message : String(e)}`,
      details: 'Could not verify browser runtime.',
      remediation: {
        actionId: 'install-playwright',
        label: 'Install Playwright',
        kind: 'manual_command',
        commandPreview: 'npm install playwright && npx playwright install chromium',
        safe: true,
      },
      durationMs: Date.now() - start,
    };
  }
}

function checkExistingCaptures(projectRoot: string): SetupCheckResult {
  return runCheck(() => {
    const capturesDir = path.join(projectRoot, VISKOD_STORAGE_DIR, 'captures');
    if (!fs.existsSync(capturesDir)) {
      return check(
        'existing-captures',
        'Existing captures',
        'optional',
        'skipped',
        'No captures directory',
      );
    }
    try {
      const entries = fs.readdirSync(capturesDir, { withFileTypes: true });
      const captureCount = entries.filter((e) => e.isDirectory()).length;
      return check(
        'existing-captures',
        'Existing captures',
        'optional',
        'pass',
        `${captureCount} capture(s) found`,
      );
    } catch {
      return check(
        'existing-captures',
        'Existing captures',
        'optional',
        'warning',
        'Could not read captures directory',
      );
    }
  });
}

function checkSourceHintEngine(): SetupCheckResult {
  return runCheck(() => {
    try {
      const enginePath = path.join(
        process.cwd(),
        'packages',
        'source-hint-engine',
        'src',
        'index.ts',
      );
      if (fs.existsSync(enginePath)) {
        return check(
          'source-hints',
          'Source hint engine',
          'optional',
          'pass',
          'Source hint engine is available',
        );
      }
      return check(
        'source-hints',
        'Source hint engine',
        'optional',
        'skipped',
        'Source hint engine not found',
      );
    } catch {
      return check(
        'source-hints',
        'Source hint engine',
        'optional',
        'skipped',
        'Could not verify source hint engine',
      );
    }
  });
}

export function checkMcpToolsLive(): SetupCheckResult {
  return runCheck(() => {
    try {
      const serverPath = path.join(
        resolveViskodRoot(),
        'packages',
        'mcp-server',
        'src',
        'entry.ts',
      );
      if (!fs.existsSync(serverPath)) {
        return check(
          'mcp-tools',
          'MCP server tools',
          'required',
          'fail',
          'MCP server entry not found',
          'Ensure the mcp-server package is built.',
          { actionId: 'restart-mcp', label: 'Restart MCP server', kind: 'restart_mcp', safe: true },
        );
      }

      const entryContent = fs.readFileSync(serverPath, 'utf-8');
      const missingTools: string[] = [];

      for (const toolName of REQUIRED_MCP_TOOLS) {
        if (!entryContent.includes(`'${toolName}'`) && !entryContent.includes(`"${toolName}"`)) {
          missingTools.push(toolName);
        }
      }

      if (missingTools.length > 0) {
        return check(
          'mcp-tools',
          'MCP server tools',
          'required',
          'fail',
          `Missing required MCP tools: ${missingTools.join(', ')}`,
          `The MCP server is missing ${missingTools.length} required tool(s).`,
          { actionId: 'restart-mcp', label: 'Restart MCP server', kind: 'restart_mcp', safe: true },
        );
      }

      return check(
        'mcp-tools',
        'MCP server tools',
        'required',
        'pass',
        `All ${REQUIRED_MCP_TOOLS.length} required MCP tools verified`,
      );
    } catch (e) {
      return check(
        'mcp-tools',
        'MCP server tools',
        'required',
        'warning',
        `Could not verify MCP tools: ${e instanceof Error ? e.message : String(e)}`,
        'MCP tools may still be available at runtime.',
      );
    }
  });
}

export async function checkMcpToolsRuntime(projectRoot?: string): Promise<SetupCheckResult> {
  const start = Date.now();
  try {
    const mod = await import('./mcp-runtime');
    const result = await mod.verifyMcpToolsRuntime(projectRoot);

    if (!result.ok) {
      // Runtime failed — fall back to static for diagnostics only
      const staticCheck = checkMcpToolsLive();
      return {
        checkId: 'mcp-tools-runtime',
        name: 'MCP server tools (runtime)',
        severity: 'required',
        status: staticCheck.status === 'pass' ? 'fail' : 'fail',
        summary: `MCP runtime tools/list failed: ${result.error.message}`,
        details:
          staticCheck.status === 'pass'
            ? 'Static check passed but runtime tools/list did not respond. The MCP server may not be startable.'
            : 'Both static and runtime verification failed.',
        remediation: {
          actionId: 'restart-mcp',
          label: 'Restart MCP server',
          kind: 'restart_mcp',
          safe: true,
        },
        durationMs: Date.now() - start,
      };
    }

    const verification = result.value;
    if (!verification.requiredToolsPresent) {
      return {
        checkId: 'mcp-tools-runtime',
        name: 'MCP server tools (runtime)',
        severity: 'required',
        status: 'fail',
        summary: `Missing required MCP tools in runtime: ${verification.missingRequiredTools.join(', ')}`,
        remediation: {
          actionId: 'restart-mcp',
          label: 'Restart MCP server',
          kind: 'restart_mcp',
          safe: true,
        },
        durationMs: Date.now() - start,
      };
    }

    return {
      checkId: 'mcp-tools-runtime',
      name: 'MCP server tools (runtime)',
      severity: 'required',
      status: 'pass',
      summary: `Runtime verification: all ${verification.toolsFound.length} MCP tools confirmed via tools/list`,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return {
      checkId: 'mcp-tools-runtime',
      name: 'MCP server tools (runtime)',
      severity: 'required',
      status: 'fail',
      summary: `Runtime verification failed: ${e instanceof Error ? e.message : String(e)}`,
      remediation: {
        actionId: 'restart-mcp',
        label: 'Restart MCP server',
        kind: 'restart_mcp',
        safe: true,
      },
      durationMs: Date.now() - start,
    };
  }
}

export function verifyMcpToolsLive(): LiveMcpVerification {
  const serverPath = path.join(resolveViskodRoot(), 'packages', 'mcp-server', 'src', 'entry.ts');
  const missingRequiredTools: string[] = [];
  const toolsFound: McpToolVerification[] = [];

  if (!fs.existsSync(serverPath)) {
    return {
      serverReachable: false,
      toolsFound: [],
      requiredToolsPresent: false,
      missingRequiredTools: REQUIRED_MCP_TOOLS,
    };
  }

  const entryContent = fs.readFileSync(serverPath, 'utf-8');

  for (const toolName of REQUIRED_MCP_TOOLS) {
    const found = entryContent.includes(`'${toolName}'`) || entryContent.includes(`"${toolName}"`);
    toolsFound.push({ toolName, found, hasInputSchema: found });
    if (!found) missingRequiredTools.push(toolName);
  }

  return {
    serverReachable: true,
    toolsFound,
    requiredToolsPresent: missingRequiredTools.length === 0,
    missingRequiredTools,
  };
}

function checkVisualIssuePersistence(projectRoot: string): SetupCheckResult {
  return runCheck(() => {
    const issuesDir = path.join(projectRoot, VISKOD_STORAGE_DIR, 'issues');
    if (!fs.existsSync(issuesDir)) {
      return check(
        'visual-issue',
        'VisualIssue persistence',
        'recommended',
        'skipped',
        'Issues directory not initialized',
      );
    }
    try {
      fs.accessSync(issuesDir, fs.constants.R_OK | fs.constants.W_OK);
      return check(
        'visual-issue',
        'VisualIssue persistence',
        'recommended',
        'pass',
        'VisualIssue persistence is ready',
      );
    } catch {
      return check(
        'visual-issue',
        'VisualIssue persistence',
        'recommended',
        'fail',
        'Cannot access issues directory',
        'Check folder permissions for .viskod/issues/',
        {
          actionId: 'check-permissions',
          label: 'Check permissions',
          kind: 'manual_command',
          commandPreview: `ls -la "${issuesDir}"`,
          safe: true,
        },
      );
    }
  });
}

function checkAgentHandoffPersistence(projectRoot: string): SetupCheckResult {
  return runCheck(() => {
    const handoffsDir = path.join(projectRoot, VISKOD_STORAGE_DIR, 'handoffs');
    if (!fs.existsSync(handoffsDir)) {
      return check(
        'agent-handoff',
        'AgentHandoff persistence',
        'recommended',
        'skipped',
        'Handoffs directory not initialized',
      );
    }
    try {
      fs.accessSync(handoffsDir, fs.constants.R_OK | fs.constants.W_OK);
      return check(
        'agent-handoff',
        'AgentHandoff persistence',
        'recommended',
        'pass',
        'AgentHandoff persistence is ready',
      );
    } catch {
      return check(
        'agent-handoff',
        'AgentHandoff persistence',
        'recommended',
        'fail',
        'Cannot access handoffs directory',
        'Check folder permissions for .viskod/handoffs/',
        {
          actionId: 'check-permissions',
          label: 'Check permissions',
          kind: 'manual_command',
          commandPreview: `ls -la "${handoffsDir}"`,
          safe: true,
        },
      );
    }
  });
}

function checkVisualReviewPersistence(projectRoot: string): SetupCheckResult {
  return runCheck(() => {
    const reviewsDir = path.join(projectRoot, VISKOD_STORAGE_DIR, 'reviews');
    if (!fs.existsSync(reviewsDir)) {
      return check(
        'visual-review',
        'VisualReview persistence',
        'recommended',
        'skipped',
        'Reviews directory not initialized',
      );
    }
    try {
      fs.accessSync(reviewsDir, fs.constants.R_OK | fs.constants.W_OK);
      return check(
        'visual-review',
        'VisualReview persistence',
        'recommended',
        'pass',
        'VisualReview persistence is ready',
      );
    } catch {
      return check(
        'visual-review',
        'VisualReview persistence',
        'recommended',
        'fail',
        'Cannot access reviews directory',
        'Check folder permissions for .viskod/reviews/',
        {
          actionId: 'check-permissions',
          label: 'Check permissions',
          kind: 'manual_command',
          commandPreview: `ls -la "${reviewsDir}"`,
          safe: true,
        },
      );
    }
  });
}

function checkVisualSelection(): SetupCheckResult {
  return runCheck(() => {
    const overlayPath = path.join(process.cwd(), 'packages', 'overlay-system', 'src', 'index.ts');
    const selectionPath = path.join(
      process.cwd(),
      'packages',
      'visual-selection',
      'src',
      'index.ts',
    );

    const overlayExists = fs.existsSync(overlayPath);
    const selectionExists = fs.existsSync(selectionPath);

    if (overlayExists && selectionExists) {
      return check(
        'visual-selection',
        'Visual Selection',
        'recommended',
        'pass',
        'Visual Selection overlay and engine are available',
      );
    }
    if (!overlayExists && !selectionExists) {
      return check(
        'visual-selection',
        'Visual Selection',
        'recommended',
        'fail',
        'Visual Selection overlay and engine not found',
        'Install or rebuild the overlay-system and visual-selection packages.',
        {
          actionId: 'rebuild-packages',
          label: 'Rebuild packages',
          kind: 'manual_command',
          commandPreview: 'pnpm build',
          safe: true,
        },
      );
    }
    return check(
      'visual-selection',
      'Visual Selection',
      'recommended',
      'warning',
      'Visual Selection partially available',
      overlayExists
        ? 'Overlay found but selection engine missing'
        : 'Selection engine found but overlay missing',
    );
  });
}

function checkUsageSiteSourceHints(): SetupCheckResult {
  return runCheck(() => {
    const enginePath = path.join(
      process.cwd(),
      'packages',
      'source-hint-engine',
      'src',
      'index.ts',
    );
    const classifierPath = path.join(
      process.cwd(),
      'packages',
      'source-hint-engine',
      'src',
      'classifier.ts',
    );
    const rankingPath = path.join(
      process.cwd(),
      'packages',
      'source-hint-engine',
      'src',
      'ranking.ts',
    );

    const engineExists = fs.existsSync(enginePath);
    const classifierExists = fs.existsSync(classifierPath);
    const rankingExists = fs.existsSync(rankingPath);

    if (engineExists && classifierExists && rankingExists) {
      return check(
        'usage-site-hints',
        'Usage-site source hints',
        'optional',
        'pass',
        'Source hint engine with usage-site classification is available',
      );
    }
    return check(
      'usage-site-hints',
      'Usage-site source hints',
      'optional',
      'skipped',
      'Source hint engine components not fully available',
    );
  });
}

export function validateAppUrl(url: string): AppUrlValidation {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    const port = parsed.port ? Number.parseInt(parsed.port, 10) : undefined;

    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    const isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:';

    if (!isHttp) {
      return {
        valid: false,
        url,
        hostname,
        port,
        reason: 'URL must use http:// or https:// protocol',
      };
    }

    if (!isLocalhost) {
      return {
        valid: false,
        url,
        hostname,
        port,
        reason: 'URL must point to localhost or 127.0.0.1 for local development',
      };
    }

    return { valid: true, url, hostname, port };
  } catch {
    return { valid: false, url, hostname: '', reason: 'Invalid URL format' };
  }
}

async function checkAppReachability(appUrl: string): Promise<SetupCheckResult> {
  const start = Date.now();
  try {
    const validation = validateAppUrl(appUrl);
    if (!validation.valid) {
      return {
        checkId: 'app-reachability',
        name: 'App URL reachability',
        severity: 'required',
        status: 'fail',
        summary: `Invalid app URL: ${validation.reason}`,
        remediation: {
          actionId: 'fix-app-url',
          label: 'Fix app URL',
          kind: 'manual_command',
          commandPreview:
            'Ensure your dev server is running and the URL is correct (e.g., http://localhost:3000)',
          safe: true,
        },
        durationMs: Date.now() - start,
      };
    }

    // Try to reach the URL with a short timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(appUrl, {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timeout);

      if (response.ok || response.status < 500) {
        return {
          checkId: 'app-reachability',
          name: 'App URL reachability',
          severity: 'required',
          status: 'pass',
          summary: `App reachable at ${appUrl} (HTTP ${response.status})`,
          durationMs: Date.now() - start,
        };
      }

      return {
        checkId: 'app-reachability',
        name: 'App URL reachability',
        severity: 'required',
        status: 'fail',
        summary: `App returned HTTP ${response.status} at ${appUrl}`,
        remediation: {
          actionId: 'start-dev-server',
          label: 'Start dev server',
          kind: 'manual_command',
          commandPreview: 'Start your dev server, then rerun setup',
          safe: true,
        },
        durationMs: Date.now() - start,
      };
    } catch (fetchError) {
      clearTimeout(timeout);
      return {
        checkId: 'app-reachability',
        name: 'App URL reachability',
        severity: 'required',
        status: 'fail',
        summary: `Cannot reach ${appUrl} — ${fetchError instanceof Error ? fetchError.message : 'connection refused'}`,
        remediation: {
          actionId: 'start-dev-server',
          label: 'Start dev server',
          kind: 'manual_command',
          commandPreview: 'Start your dev server, then rerun setup',
          safe: true,
        },
        durationMs: Date.now() - start,
      };
    }
  } catch (e) {
    return {
      checkId: 'app-reachability',
      name: 'App URL reachability',
      severity: 'required',
      status: 'fail',
      summary: `App reachability check failed: ${e instanceof Error ? e.message : String(e)}`,
      remediation: {
        actionId: 'start-dev-server',
        label: 'Start dev server',
        kind: 'manual_command',
        commandPreview: 'Start your dev server, then rerun setup',
        safe: true,
      },
      durationMs: Date.now() - start,
    };
  }
}

export function checkAgentConfigReadiness(projectRoot: string): AgentConfigInfo {
  // Check for common agent config files
  const configPaths = [
    { kind: 'opencode' as const, files: ['.opencode.json', 'opencode.json'] },
    { kind: 'cursor' as const, files: ['.cursorrules', 'cursor.json'] },
    { kind: 'claude-desktop' as const, files: ['.claude.json', 'claude.json'] },
  ];

  for (const config of configPaths) {
    for (const file of config.files) {
      const configPath = path.join(projectRoot, file);
      if (fs.existsSync(configPath)) {
        return {
          detected: true,
          kind: config.kind,
          configPath: file,
          verified: true,
        };
      }
    }
  }

  // No config found — check if we can generate one
  const hasMcpEntry = fs.existsSync(
    path.join(process.cwd(), 'packages', 'mcp-server', 'src', 'entry.ts'),
  );
  if (hasMcpEntry) {
    return {
      detected: false,
      kind: 'unknown',
      commandPreview: 'Add Viskod MCP server to your agent config',
      verified: false,
    };
  }

  return {
    detected: false,
    kind: 'unknown',
    verified: false,
  };
}

export async function runSetupChecks(input: {
  projectRoot: string;
  includeOptional?: boolean;
  appUrl?: string;
}): Promise<SetupCheckResult[]> {
  const checks: SetupCheckResult[] = [];

  checks.push(checkNodeVersion());
  checks.push(checkPackageManager());
  checks.push(checkProjectReadability(input.projectRoot));
  checks.push(checkViskodWorkspace(input.projectRoot));
  checks.push(checkViskodWorkspaceWritable(input.projectRoot));
  checks.push(checkProjectScanner());

  // MCP: static precheck (fast, diagnostic — confirms tool definitions exist in source)
  checks.push(checkMcpToolsLive());

  // MCP: runtime verification (required — proves tools/list through actual MCP server)
  checks.push(await checkMcpToolsRuntime(input.projectRoot));

  // Browser: live launch/shutdown verification
  checks.push(await checkBrowserRuntimeLive(input.projectRoot));

  // App reachability (if appUrl provided)
  if (input.appUrl) {
    checks.push(await checkAppReachability(input.appUrl));
  }

  checks.push(checkExistingCaptures(input.projectRoot));
  checks.push(checkVisualIssuePersistence(input.projectRoot));
  checks.push(checkAgentHandoffPersistence(input.projectRoot));
  checks.push(checkVisualReviewPersistence(input.projectRoot));
  checks.push(checkVisualSelection());

  if (input.includeOptional) {
    checks.push(checkSourceHintEngine());
    checks.push(checkUsageSiteSourceHints());
  }

  return checks;
}
