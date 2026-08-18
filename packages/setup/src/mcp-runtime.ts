import { type ChildProcess, spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Result } from '@viskod/shared';
import { ErrorCategory, ErrorSeverity, err, ok } from '@viskod/shared';
import { type McpServeCommand, getMcpServeCommand } from './command-factory';
import type { LiveMcpVerification, McpToolVerification } from './types';

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

const DEFAULT_REQUEST_TIMEOUT_MS = 20000;
const KILL_GRACE_MS = 500;

function mcpError(code: string, message: string) {
  return {
    code,
    category: ErrorCategory.RUNTIME,
    severity: ErrorSeverity.RECOVERABLE,
    message,
    correlationId: crypto.randomUUID(),
    subsystem: 'setup-mcp',
    timestamp: new Date().toISOString(),
  };
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface ExitInfo {
  exited: true;
  code: number | null;
  signal: NodeJS.Signals | null;
}

/**
 * Windows: spawn never relies on shell interpretation. A bare command name
 * ('npx') must resolve to its .cmd shim; full paths (process.execPath) pass
 * through untouched.
 */
function resolveSpawnCommand(command: string): string {
  if (
    process.platform === 'win32' &&
    !command.includes('/') &&
    !command.includes('\\') &&
    !/\.(exe|cmd|bat)$/i.test(command)
  ) {
    return `${command}.cmd`;
  }
  return command;
}

function waitForExit(proc: ChildProcess): Promise<ExitInfo> {
  return new Promise((resolve) => {
    proc.once('exit', (code, signal) => resolve({ exited: true, code, signal }));
  });
}

function describeUnexpectedExit(exit: ExitInfo, stderr: string): string {
  const detail = stderr.trim();
  return `MCP server process exited before responding (code=${exit.code ?? 'null'}, signal=${exit.signal ?? 'null'})${detail ? `: ${detail}` : ''}`;
}

/**
 * Sends one JSON-RPC request and awaits the matching response. Rejects when
 * the per-request timeout elapses, or when the child exits first (with the
 * accumulated stderr in the error text).
 */
async function raceRequest(
  proc: ChildProcess,
  request: JsonRpcRequest,
  timeoutMs: number,
  getStderr: () => string,
): Promise<JsonRpcResponse> {
  const exitPromise = waitForExit(proc);
  const raced = await Promise.race([sendRequest(proc, request, timeoutMs), exitPromise]);
  if (raced !== null && typeof raced === 'object' && 'jsonrpc' in raced) {
    return raced as JsonRpcResponse;
  }
  throw new Error(describeUnexpectedExit(raced as ExitInfo, getStderr()));
}

function sendRequest(
  proc: ChildProcess,
  request: JsonRpcRequest,
  timeoutMs: number,
): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let onData: ((data: Buffer) => void) | null = null;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        if (onData) proc.stdout?.off('data', onData);
        reject(new Error(`MCP request '${request.method}' timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    onData = (data: Buffer) => {
      if (settled) return;
      const lines = data.toString('utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as JsonRpcResponse;
          if (parsed.id === request.id) {
            settled = true;
            clearTimeout(timer);
            if (onData) proc.stdout?.off('data', onData);
            resolve(parsed);
            return;
          }
        } catch {
          /* not JSON-RPC, ignore */
        }
      }
    };

    proc.stdout?.on('data', onData);
    proc.stdin?.write(`${JSON.stringify(request)}\n`);
  });
}

/**
 * Kills the process tree: SIGTERM to the whole group (the child is spawned
 * detached so npx → tsx → server die together), wait briefly, then SIGKILL.
 * Never leaves an orphan.
 */
function signalProcessTree(proc: ChildProcess, signal: NodeJS.Signals): void {
  const pid = proc.pid;
  if (pid !== undefined && process.platform !== 'win32') {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      /* group already gone — fall through to direct kill */
    }
  }
  try {
    proc.kill(signal);
  } catch {
    /* process already gone */
  }
}

async function killProcess(proc: ChildProcess | null): Promise<void> {
  if (!proc) return;
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  signalProcessTree(proc, 'SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, KILL_GRACE_MS));
  if (proc.exitCode === null && proc.signalCode === null) {
    signalProcessTree(proc, 'SIGKILL');
  }
}

/**
 * Live MCP runtime verification.
 *
 * Readiness is the `initialize` response — there is no fixed startup sleep.
 * Spawn, immediately send `initialize`, await the response, then `tools/list`
 * and assert REQUIRED_MCP_TOOLS. Every path (success, timeout, error, exit)
 * terminates the child: SIGTERM, 500ms grace, SIGKILL.
 */
export async function verifyMcpToolsRuntime(
  projectRoot?: string,
  opts?: { serveCommand?: McpServeCommand; timeoutMs?: number },
): Promise<Result<LiveMcpVerification>> {
  const serveCommand = opts?.serveCommand ?? getMcpServeCommand({ projectRoot });
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  let proc: ChildProcess | null = null;
  const timing: NonNullable<LiveMcpVerification['timing']> = {
    spawnMs: 0,
    initializeMs: 0,
    toolsListMs: 0,
    totalMs: 0,
  };
  const totalStart = performance.now();

  try {
    const spawnStart = performance.now();
    proc = spawn(resolveSpawnCommand(serveCommand.command), serveCommand.args, {
      cwd: projectRoot ?? process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      env: { ...process.env, NODE_ENV: 'test' },
    });

    let stderrOutput = '';
    proc.stderr?.on('data', (data: Buffer) => {
      stderrOutput += data.toString();
    });

    // Fail fast when the executable cannot be spawned (e.g. missing npx).
    const spawnError = await new Promise<Error | null>((resolve) => {
      const child = proc as ChildProcess;
      child.on('error', (e) => resolve(e));
      child.on('spawn', () => resolve(null));
    });
    if (spawnError) {
      throw new Error(
        `Failed to spawn MCP server (${serveCommand.command} ${serveCommand.args.join(' ')}): ${spawnError.message}`,
      );
    }
    timing.spawnMs = performance.now() - spawnStart;

    const missingRequiredTools: string[] = [];
    const toolsFound: McpToolVerification[] = [];

    // Readiness: the initialize response. No fixed sleep.
    const initializeStart = performance.now();
    const initializeResponse = await raceRequest(
      proc,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'viskod-setup', version: '0.0.0' },
        },
      },
      timeoutMs,
      () => stderrOutput,
    );
    timing.initializeMs = performance.now() - initializeStart;

    if (initializeResponse.error) {
      throw new Error(`initialize returned error: ${initializeResponse.error.message}`);
    }

    const toolsListStart = performance.now();
    const toolsListResponse = await raceRequest(
      proc,
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      timeoutMs,
      () => stderrOutput,
    );
    timing.toolsListMs = performance.now() - toolsListStart;

    if (toolsListResponse.error) {
      throw new Error(`tools/list returned error: ${toolsListResponse.error.message}`);
    }

    const result = toolsListResponse.result as { tools?: Array<{ name: string }> } | undefined;
    const tools = result?.tools ?? [];

    const toolNames = new Set(tools.map((t) => t.name));

    for (const toolName of REQUIRED_MCP_TOOLS) {
      const found = toolNames.has(toolName);
      toolsFound.push({ toolName, found, hasInputSchema: found });
      if (!found) missingRequiredTools.push(toolName);
    }

    // Optional runtime probe: tools/list already passed, so a failing probe
    // does not fail the verification.
    if (toolNames.has('get_setup_state')) {
      try {
        await raceRequest(
          proc,
          {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: { name: 'get_setup_state', arguments: {} },
          },
          timeoutMs,
          () => stderrOutput,
        );
      } catch {
        /* optional probe — tools/list verdict stands */
      }
    }

    timing.totalMs = performance.now() - totalStart;
    return ok({
      serverReachable: true,
      toolsFound,
      requiredToolsPresent: missingRequiredTools.length === 0,
      missingRequiredTools,
      mode: serveCommand.mode,
      timing,
    });
  } catch (e) {
    timing.totalMs = performance.now() - totalStart;
    return err(
      mcpError(
        'MCP_RUNTIME_VERIFY_FAILED',
        `MCP runtime verification failed: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  } finally {
    await killProcess(proc);
  }
}
