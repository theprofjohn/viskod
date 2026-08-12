import type {
  MCPRequest,
  MCPResourceDefinition,
  MCPResourceHandler,
  MCPResponse,
  MCPToolCallRequest,
  MCPToolDefinition,
  MCPToolHandler,
} from './types';

/**
 * Minimal stdio MCP server (JSON-RPC 2.0, newline-delimited).
 * Lives in its own module so `entry.ts` (tool registration) and `index.ts`
 * (public exports) do not form an import cycle.
 */
// Injected at bundle time by scripts/build-cli.mjs from the publishable
// packages/cli/package.json version; source runs (tsx/tests) fall back to a
// dev marker. The published executable reports the real package version.
declare const __VISKOD_VERSION__: string | undefined;
const VISKOD_SERVER_VERSION =
  typeof __VISKOD_VERSION__ !== 'undefined' ? __VISKOD_VERSION__ : '0.0.0-dev';

export class MCPServer {
  private tools = new Map<string, MCPToolDefinition>();
  private toolHandlers = new Map<string, MCPToolHandler>();
  private resources = new Map<string, MCPResourceDefinition>();
  private resourceHandlers = new Map<string, MCPResourceHandler>();
  private serverInfo = { name: 'viskod-mcp', version: VISKOD_SERVER_VERSION };
  private startup?: () => Promise<void>;

  registerTool(definition: MCPToolDefinition, handler: MCPToolHandler): void {
    this.tools.set(definition.name, definition);
    this.toolHandlers.set(definition.name, handler);
  }

  registerResource(definition: MCPResourceDefinition, handler: MCPResourceHandler): void {
    this.resources.set(definition.uri, definition);
    this.resourceHandlers.set(definition.uri, handler);
  }

  setStartup(startup: () => Promise<void>): void {
    this.startup = startup;
  }

  async start(): Promise<void> {
    if (this.startup) await this.startup();
    process.stdin.setEncoding('utf-8');

    let buffer = '';

    process.stdin.on('data', async (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const request = JSON.parse(line) as MCPRequest;
          await this.handleRequest(request);
        } catch {
          this.sendError(null, -32700, 'Parse error');
        }
      }
    });

    process.stdin.on('end', () => {});

    process.stderr.write('Viskod MCP Server started\n');
  }

  stop(): void {
    process.stdin.pause();
  }

  private async handleRequest(request: MCPRequest): Promise<void> {
    switch (request.method) {
      case 'initialize':
        return this.handleInitialize(request);
      case 'tools/list':
        return this.handleToolList(request);
      case 'tools/call':
        return this.handleToolCall(request);
      case 'resources/list':
        return this.handleResourceList(request);
      case 'resources/read':
        return this.handleResourceRead(request);
      default:
        this.sendError(request.id, -32601, `Method not found: ${request.method}`);
    }
  }

  private handleInitialize(request: MCPRequest): void {
    this.sendResponse(request.id, {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
        resources: {},
      },
      serverInfo: this.serverInfo,
    });
  }

  private handleToolList(request: MCPRequest): void {
    const toolList = Array.from(this.tools.values());
    this.sendResponse(request.id, { tools: toolList });
  }

  private async handleToolCall(request: MCPRequest): Promise<void> {
    const params = request.params as MCPToolCallRequest | undefined;
    if (!params?.name) {
      this.sendError(request.id, -32602, 'Invalid params: tool name required');
      return;
    }

    const handler = this.toolHandlers.get(params.name);
    if (!handler) {
      this.sendError(request.id, -32602, `Tool not found: ${params.name}`);
      return;
    }

    try {
      const result = await handler(params.arguments ?? {});
      this.sendResponse(request.id, result);
    } catch (error) {
      this.sendError(request.id, -32000, `Tool error: ${String(error)}`);
    }
  }

  private handleResourceList(request: MCPRequest): void {
    const resourceList = Array.from(this.resources.values());
    this.sendResponse(request.id, { resources: resourceList });
  }

  private async handleResourceRead(request: MCPRequest): Promise<void> {
    const params = request.params as { uri: string } | undefined;
    if (!params?.uri) {
      this.sendError(request.id, -32602, 'Invalid params: uri required');
      return;
    }

    const handler = this.resourceHandlers.get(params.uri);
    if (!handler) {
      this.sendError(request.id, -32002, `Resource not found: ${params.uri}`);
      return;
    }

    try {
      const content = await handler(params.uri);
      this.sendResponse(request.id, { contents: [content] });
    } catch (error) {
      this.sendError(request.id, -32000, `Resource error: ${String(error)}`);
    }
  }

  private sendResponse(id: number | string, result: unknown): void {
    const response: MCPResponse = { jsonrpc: '2.0', id, result };
    process.stdout.write(`${JSON.stringify(response)}\n`);
  }

  private sendError(id: number | string | null, code: number, message: string): void {
    const response: MCPResponse = {
      jsonrpc: '2.0',
      id: id ?? 0,
      error: { code, message },
    };
    process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}
