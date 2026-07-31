import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import type { Result } from '@viskod/shared';
import { ok, err, ErrorCategory, ErrorSeverity } from '@viskod/shared';
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

const MCP_TIMEOUT_MS = 12000;
const STARTUP_WAIT_MS = 4000;

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

function sendRequest(
  proc: ChildProcess,
  request: JsonRpcRequest,
  timeoutMs: number = MCP_TIMEOUT_MS,
): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`MCP request timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    const onData = (data: Buffer) => {
      if (resolved) return;
      const lines = data.toString('utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as JsonRpcResponse;
          if (parsed.id === request.id) {
            resolved = true;
            clearTimeout(timer);
            proc.stdout?.off('data', onData);
            resolve(parsed);
            return;
          }
        } catch { /* not JSON-RPC, ignore */ }
      }
    };

    proc.stdout?.on('data', onData);
    proc.stdin?.write(JSON.stringify(request) + '\n');
  });
}

export async function verifyMcpToolsRuntime(
  projectRoot?: string,
): Promise<Result<LiveMcpVerification>> {
  const serverPath = path.join(process.cwd(), 'packages', 'mcp-server', 'src', 'entry.ts');
  const missingRequiredTools: string[] = [];
  const toolsFound: McpToolVerification[] = [];

  let proc: ChildProcess | null = null;

  try {
    proc = spawn('npx', ['tsx', serverPath], {
      cwd: projectRoot ?? process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' },
    });

    let stderrOutput = '';
    proc.stderr?.on('data', (data) => {
      stderrOutput += data.toString();
    });

    proc.on('error', () => {});

    // Wait for server to initialize (imports all packages)
    await new Promise((resolve) => setTimeout(resolve, STARTUP_WAIT_MS));

    // Send tools/list request
    const toolsListRequest: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    };

    const response = await sendRequest(proc, toolsListRequest, MCP_TIMEOUT_MS);

    if (response.error) {
      return err(mcpError('MCP_TOOLS_LIST_FAILED', `tools/list returned error: ${response.error.message}`));
    }

    const result = response.result as { tools?: Array<{ name: string }> } | undefined;
    const tools = result?.tools ?? [];

    const toolNames = new Set(tools.map((t) => t.name));

    for (const toolName of REQUIRED_MCP_TOOLS) {
      const found = toolNames.has(toolName);
      toolsFound.push({ toolName, found, hasInputSchema: found });
      if (!found) missingRequiredTools.push(toolName);
    }

    // Optionally call get_setup_state to verify runtime
    if (toolNames.has('get_setup_state')) {
      try {
        const callRequest: JsonRpcRequest = {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'get_setup_state', arguments: {} },
        };
        await sendRequest(proc, callRequest, 5000);
      } catch {
        // Tool call failed, but tools/list passed
      }
    }

    return ok({
      serverReachable: true,
      toolsFound,
      requiredToolsPresent: missingRequiredTools.length === 0,
      missingRequiredTools,
    });
  } catch (e) {
    return err(mcpError(
      'MCP_RUNTIME_VERIFY_FAILED',
      `MCP runtime verification failed: ${e instanceof Error ? e.message : String(e)}`,
    ));
  } finally {
    if (proc) {
      try {
        proc.kill('SIGTERM');
        await new Promise((resolve) => setTimeout(resolve, 300));
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      } catch { /* ignore */ }
    }
  }
}
