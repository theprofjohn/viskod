import * as fs from 'node:fs';

import * as os from 'node:os';
import { checkAgentConfigReadiness } from './agent-config';
import type { McpServeCommand } from './command-factory';
import { detectProject } from './detector';
import { verifyMcpToolsRuntime } from './mcp-runtime';
import { loadSetupState } from './persistence';
import type { AgentConfigInfo, FirstRunSetupState, SetupStateKind } from './types';

const STUDIO_HOST = '127.0.0.1';
const STUDIO_PORT = 3001;
const REQUIRED_NODE_MAJOR = 22;

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
