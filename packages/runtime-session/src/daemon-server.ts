import * as net from 'node:net';
import { resolveProfile } from '@viskod/browser-runtime';
import { RuntimeSession } from './runtime-session';
import type { DaemonRequest, DaemonResponse } from './types';

export class DaemonServer {
  private server: net.Server | null = null;
  private session: RuntimeSession;
  private _port = 0;

  constructor(session: RuntimeSession) {
    this.session = session;
  }

  get port(): number {
    return this._port;
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        let buffer = '';
        socket.setEncoding('utf-8');

        socket.on('data', async (chunk: string) => {
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const request = JSON.parse(line) as DaemonRequest;
              const response = await this.handleRequest(request);
              socket.write(`${JSON.stringify(response)}\n`);
            } catch {
              this.sendError(socket, 0, -32700, 'Parse error');
            }
          }
        });

        socket.on('error', () => {});
      });

      this.server.on('error', reject);

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server?.address();
        if (addr && typeof addr === 'object') {
          this._port = addr.port;
        }
        resolve(this._port);
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
        this.server = null;
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(request: DaemonRequest): Promise<DaemonResponse> {
    const info = this.session.getStatus();

    // Validate token for all methods when a session exists
    if (info && request.token !== info.token) {
      return { id: request.id, error: { code: -32001, message: 'Invalid session token' } };
    }

    switch (request.method) {
      case 'capture': {
        const selector = request.params?.selector as string | undefined;
        const url = request.params?.url as string | undefined;
        const profileName = request.params?.profile as string | undefined;
        const reload = request.params?.reload as boolean | undefined;
        const cacheBust = request.params?.cacheBust as boolean | undefined;
        if (!selector) {
          return { id: request.id, error: { code: -32602, message: 'Missing selector' } };
        }
        const profile = profileName ? resolveProfile(profileName) : undefined;
        const result = await this.session.capture(selector, url, profile, {
          reload: reload ?? false,
          cacheBust: cacheBust ?? false,
        });
        if (!result.ok) {
          return { id: request.id, error: { code: -32000, message: result.error.message } };
        }
        return { id: request.id, result: result.value };
      }

      case 'status': {
        const info = this.session.getStatus();
        return { id: request.id, result: info };
      }

      case 'stop': {
        await this.session.stop();
        RuntimeSession.clearSessionFile();
        return { id: request.id, result: { ok: true } };
      }

      default:
        return {
          id: request.id,
          error: { code: -32601, message: `Unknown method: ${request.method}` },
        };
    }
  }

  private sendError(socket: net.Socket, id: number, code: number, message: string): void {
    const response: DaemonResponse = { id, error: { code, message } };
    socket.write(`${JSON.stringify(response)}\n`);
  }
}
