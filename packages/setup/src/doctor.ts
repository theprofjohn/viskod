import * as fs from 'node:fs';
import * as os from 'node:os';
import {
  type DiagnosticSummary,
  createDiagnosticSummary,
  sanitizeErrorDetail,
} from '@viskod/shared';

import { checkAgentConfigReadiness } from './agent-config';
import type { McpServeCommand } from './command-factory';
import { detectProject } from './detector';
import { verifyMcpToolsRuntime } from './mcp-runtime';
import { loadSetupState } from './persistence';
import type { AgentConfigInfo, FirstRunSetupState, SetupStateKind } from './types';

declare const __VISKOD_VERSION__: string | undefined;
const SETUP_VERSION = typeof __VISKOD_VERSION__ !== 'undefined' ? __VISKOD_VERSION__ : '0.0.0-dev';

const STUDIO_HOST = '127.0.0.1';
const STUDIO_PORT = 3001;
const REQUIRED_NODE_MAJOR = 22;

export type DoctorCheckSeverity = 'required' | 'recommended' | 'informational';

export interface DoctorCheck {
  id: string;
  severity: DoctorCheckSeverity;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  node: { version: string; ok: boolean };
  chromium: { verified: boolean; executablePath?: string; hint?: string };
  mcp: {
    ok: boolean;
    mode?: 'installed' | 'dev';
    toolsFound?: number;
    durationMs?: number;
    error?: string;
  };
  project: { rootPath?: string; ok: boolean; reason?: string };
  sourceResolution: 'ready' | 'unavailable' | 'invalid' | 'unknown';
  studio: { port: number; reachable: boolean };
  setupState: {
    exists: boolean;
    state?: SetupStateKind;
    limitedMode?: boolean;
    verifiedAt?: string;
    stale: boolean;
    staleReason?: string;
  };
  agentConfig: AgentConfigInfo | null;
}

/** Stable check classification used by CLI and Studio consumers. */
export function getDoctorChecks(report: DoctorReport): DoctorCheck[] {
  return [
    {
      id: 'node',
      severity: 'required',
      ok: report.node.ok,
      detail: `v${report.node.version}`,
    },
    {
      id: 'chromium',
      severity: 'required',
      ok: report.chromium.verified,
      detail: report.chromium.hint ?? (report.chromium.verified ? 'available' : 'not found'),
    },
    {
      id: 'mcp',
      severity: 'required',
      ok: report.mcp.ok,
      detail:
        report.mcp.error ??
        (report.mcp.mode ? `${report.mcp.mode} (${report.mcp.toolsFound ?? 0} tools)` : 'failed'),
    },
    {
      id: 'project',
      severity: 'required',
      ok: report.project.ok,
      detail: report.project.reason ?? (report.project.ok ? 'detected' : 'not configured'),
    },
    {
      id: 'source-resolution',
      severity: 'required',
      ok: report.sourceResolution === 'ready',
      detail: report.sourceResolution,
    },
    {
      id: 'studio',
      severity: 'recommended',
      ok: report.studio.reachable,
      detail: report.studio.reachable ? 'running' : 'not reachable',
    },
    {
      id: 'setup-state',
      severity: 'recommended',
      ok: !report.setupState.stale,
      detail: report.setupState.exists
        ? `${report.setupState.state ?? 'unknown'}${report.setupState.stale ? ' (stale)' : ''}`
        : 'never run',
    },
    {
      id: 'agent-config',
      severity: 'recommended',
      ok: report.agentConfig?.detected ?? false,
      detail: report.agentConfig?.detected ? 'detected' : 'not detected',
    },
    {
      id: 'diagnostic-safety',
      severity: 'informational',
      ok: true,
      detail: 'local-only, sanitized',
    },
  ];
}

export function hasDoctorRequiredFailure(report: DoctorReport): boolean {
  return getDoctorChecks(report).some((check) => check.severity === 'required' && !check.ok);
}

/** Allowlisted, path-free projection for report consumers. */
export interface DoctorDiagnosticProjection {
  checks: Array<{
    id: string;
    severity: DoctorCheckSeverity;
    ok: boolean;
    detail: string;
  }>;
  diagnostics: DiagnosticSummary;
  requiredFailures: number;
  recommendedAttention: number;
  status: 'healthy' | 'attention' | 'failed';
}

export function buildDoctorDiagnosticProjection(report: DoctorReport): DoctorDiagnosticProjection {
  const checks = getDoctorChecks(report).map((check) => ({
    id: check.id,
    severity: check.severity,
    ok: check.ok,
    // Shared redaction removes absolute paths, executable paths, and control
    // characters before this value crosses the diagnostic boundary.
    detail: sanitizeErrorDetail(check.detail, 200),
  }));
  const requiredFailures = checks.filter(
    (check) => check.severity === 'required' && !check.ok,
  ).length;
  const recommendedAttention = checks.filter(
    (check) => check.severity === 'recommended' && !check.ok,
  ).length;
  const diagnostics = createDiagnosticSummary({
    viskodVersion: SETUP_VERSION,
    platform: process.platform,
    architecture: process.arch,
    nodeVersion: report.node.version,
    setupState:
      report.setupState.state === 'complete'
        ? 'complete'
        : report.setupState.state === 'limited'
          ? 'limited'
          : report.setupState.state === 'incomplete'
            ? 'failed'
            : 'unknown',
    mcpRuntime: report.mcp.ok ? 'verified' : 'failed',
    browserRuntime: report.chromium.verified ? 'verified' : 'unavailable',
    projectMode: report.project.ok ? 'single-package' : 'unavailable',
    workspacePackageCount: 0,
    workflowStage: 'unknown',
    sourceResolutionStatus:
      report.sourceResolution === 'ready'
        ? 'resolved'
        : report.sourceResolution === 'invalid'
          ? 'failed'
          : report.sourceResolution,
    topSourceQualification: 'unavailable',
    visualReviewStatus: 'unknown',
    errorCodes: checks
      .filter((check) => !check.ok)
      .map((check) => check.id)
      .slice(0, 20),
    studioHealth: report.studio.reachable ? 'running' : 'unavailable',
  });
  return {
    checks,
    diagnostics,
    requiredFailures,
    recommendedAttention,
    status: requiredFailures > 0 ? 'failed' : recommendedAttention > 0 ? 'attention' : 'healthy',
  };
}

function checkNode(): DoctorReport['node'] {
  const version = process.version;
  const major = Number.parseInt(version.slice(1), 10);
  return { version, ok: major >= REQUIRED_NODE_MAJOR };
}

async function checkChromium(): Promise<DoctorReport['chromium']> {
  try {
    const { chromium } = (await import('playwright')) as {
      chromium: { executablePath: () => string };
    };
    const executablePath = chromium.executablePath();
    const verified = typeof executablePath === 'string' && fs.existsSync(executablePath);
    return {
      verified,
      executablePath: verified ? executablePath : undefined,
      hint: verified
        ? undefined
        : 'Chromium binary not found. Run `npx playwright install chromium`.',
    };
  } catch {
    return {
      verified: false,
      hint: 'Playwright is not installed. Run `npm install playwright && npx playwright install chromium`.',
    };
  }
}

async function checkMcp(
  projectRoot?: string,
  serveCommand?: McpServeCommand,
): Promise<DoctorReport['mcp']> {
  const result = await verifyMcpToolsRuntime(projectRoot, {
    ...(serveCommand ? { serveCommand } : {}),
  });
  if (!result.ok) {
    return { ok: false, error: result.error.message };
  }
  const verification = result.value;
  return {
    ok: verification.requiredToolsPresent,
    mode: verification.mode,
    toolsFound: verification.toolsFound.length,
    durationMs: verification.timing?.totalMs,
    error: verification.requiredToolsPresent
      ? undefined
      : `Missing required MCP tools: ${verification.missingRequiredTools.join(', ')}`,
  };
}

function checkProject(projectRoot?: string): {
  project: DoctorReport['project'];
  sourceResolution: DoctorReport['sourceResolution'];
} {
  const result = detectProject({ projectRoot });
  if (!result.ok) {
    return {
      project: { ok: false, reason: result.error.message },
      sourceResolution: projectRoot !== undefined ? 'invalid' : 'unavailable',
    };
  }

  const rootPath = result.value.rootPath;
  const rootExists = fs.existsSync(rootPath);
  return {
    project: { rootPath, ok: rootExists },
    sourceResolution: rootExists ? 'ready' : 'invalid',
  };
}

async function checkStudio(): Promise<DoctorReport['studio']> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      await fetch(`http://${STUDIO_HOST}:${STUDIO_PORT}`, {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'follow',
      });
      // Any HTTP response proves the studio process is listening.
      return { port: STUDIO_PORT, reachable: true };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { port: STUDIO_PORT, reachable: false };
  }
}

function checkSetupState(
  projectRoot: string | undefined,
  mcpOk: boolean,
  chromiumVerified: boolean,
): DoctorReport['setupState'] {
  let stored: FirstRunSetupState | null = null;
  if (projectRoot !== undefined) {
    const loaded = loadSetupState(projectRoot);
    if (loaded.ok) {
      stored = loaded.value;
    }
  }

  if (stored === null) {
    return { exists: false, stale: false };
  }

  const state = stored.state;
  const previouslyVerified = state === 'complete' || state === 'limited';
  const staleReasons: string[] = [];
  if (previouslyVerified && !mcpOk) staleReasons.push('live MCP verification failed');
  if (previouslyVerified && !chromiumVerified) staleReasons.push('chromium binary missing');
  const stale = staleReasons.length > 0;

  return {
    exists: true,
    state,
    limitedMode: stored.limitedMode,
    verifiedAt: stored.verifiedAt,
    stale,
    ...(staleReasons.length > 0 ? { staleReason: staleReasons.join('; ') } : {}),
  };
}

/**
 * Read-only environment diagnostic. Never launches a browser and never writes
 * state: chromium is verified via executablePath existence, MCP via a live
 * tools/list probe, studio via an HTTP HEAD on 127.0.0.1:3001.
 */
export async function runDoctor(input: {
  projectRoot?: string;
  appUrl?: string;
  serveCommand?: McpServeCommand;
}): Promise<DoctorReport> {
  const node = checkNode();
  const chromium = await checkChromium();
  const mcp = await checkMcp(input.projectRoot, input.serveCommand);
  const { project, sourceResolution } = checkProject(input.projectRoot);
  const studio = await checkStudio();
  const setupState = checkSetupState(
    project.rootPath ?? input.projectRoot,
    mcp.ok,
    chromium.verified,
  );
  const agentConfig = checkAgentConfigReadiness({
    cwd: project.rootPath,
    home: os.homedir(),
  });

  return {
    node,
    chromium,
    mcp,
    project,
    sourceResolution,
    studio,
    setupState,
    agentConfig,
  };
}
