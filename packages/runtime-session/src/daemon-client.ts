import * as net from 'node:net';
import type { ContextPacket } from '@viskod/context-engine';
import { type Result, err, ok } from '@viskod/shared';
import type { ViskodError } from '@viskod/shared';
import { ErrorCategory, ErrorSeverity } from '@viskod/shared';
import type { DaemonResponse, SessionInfo } from './types';

export class DaemonClient {
  private port: number;
  private nextId = 1;

  constructor(port: number) {
    this.port = port;
  }

  async capture(selector: string, url?: string): Promise<Result<ContextPacket>> {
    const response = await this.request('capture', { selector, url });
    if (!response) {
      return err(this.clientError('DAEMON_NO_RESPONSE', 'No response from daemon'));
    }
    if (response.error) {
      return err(this.clientError('DAEMON_ERROR', response.error.message));
    }
    return ok(response.result as ContextPacket);
  }

  async status(): Promise<Result<SessionInfo>> {
    const response = await this.request('status');
    if (!response) {
      return err(this.clientError('DAEMON_NO_RESPONSE', 'No response from daemon'));
    }
    if (response.error) {
      return err(this.clientError('DAEMON_ERROR', response.error.message));
    }
    return ok(response.result as SessionInfo);
  }

  async stop(): Promise<Result<void>> {
    const response = await this.request('stop');
    if (!response) {
      return err(this.clientError('DAEMON_NO_RESPONSE', 'No response from daemon'));
    }
    if (response.error) {
      return err(this.clientError('DAEMON_ERROR', response.error.message));
    }
    return ok(undefined);
  }

  private request(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<DaemonResponse | null> {
    return new Promise((resolve) => {
      const id = this.nextId++;
      const client = new net.Socket();

      const timeout = setTimeout(() => {
        client.destroy();
        resolve(null);
      }, 10000);

      client.connect(this.port, '127.0.0.1', () => {
        const req = `${JSON.stringify({ id, method, params: params ?? {} })}\n`;
        client.write(req);
      });

      let buffer = '';
      client.on('data', (data: Buffer) => {
        buffer += data.toString('utf-8');
        const lines = buffer.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const response = JSON.parse(line) as DaemonResponse;
            if (response.id === id) {
              clearTimeout(timeout);
              client.destroy();
              resolve(response);
              return;
            }
          } catch {
            // partial line
          }
        }
        buffer = lines.pop() ?? '';
      });

      client.on('error', () => {
        clearTimeout(timeout);
        client.destroy();
        resolve(null);
      });
    });
  }

  private clientError(code: string, message: string): ViskodError {
    return {
      code,
      category: ErrorCategory.NETWORK,
      severity: ErrorSeverity.RECOVERABLE,
      message,
      correlationId: crypto.randomUUID(),
      subsystem: 'daemon-client',
      timestamp: new Date().toISOString(),
    };
  }
}
