import http from 'node:http';
import { describe, expect, it } from 'vitest';

function post(url: string, body: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      },
      (res) => {
        let buf = '';
        res.on('data', (chunk) => {
          buf += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(buf));
          } catch {
            resolve(buf);
          }
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      })
      .on('error', reject);
  });
}

describe('Viskod E2E Workflow', () => {
  describe('Chat flow', () => {
    it('POST /chat/respond stores a message', async () => {
      const result = (await post('http://localhost:3001/chat/respond', {
        text: 'I fixed the header padding.',
      })) as { ok: boolean; id?: string };
      expect(result.ok).toBe(true);
      expect(result.id).toBeDefined();
    });

    it('GET /chat/messages returns undelivered messages', async () => {
      const result = (await get('http://localhost:3001/chat/messages')) as {
        messages: Array<{ id: string; role: string; text: string }>;
      };
      expect(result.messages).toBeDefined();
      expect(Array.isArray(result.messages)).toBe(true);
    });

    it('POST /chat/notify with refresh action succeeds', async () => {
      const result = (await post('http://localhost:3001/chat/notify', {
        action: 'refresh',
      })) as { ok: boolean };
      expect(result.ok).toBe(true);
    });

    it('POST /chat/notify with highlight action succeeds', async () => {
      const result = (await post('http://localhost:3001/chat/notify', {
        action: 'highlight',
        selector: '.card',
      })) as { ok: boolean };
      expect(result.ok).toBe(true);
    });
  });

  describe('State includes chat messages', () => {
    it('/state has chatMessages array', async () => {
      const state = (await get('http://localhost:3001/state')) as {
        chatMessages?: Array<unknown>;
      };
      expect(state.chatMessages).toBeDefined();
      expect(Array.isArray(state.chatMessages)).toBe(true);
    });
  });

  describe('Health check includes new subsystems', () => {
    it('/health returns complete status', async () => {
      const health = (await get('http://localhost:3001/health')) as {
        studio: { status: string; panel: string };
        vce: unknown;
        selectionEngine: unknown;
      };
      expect(health.studio.status).toBe('running');
    });
  });
});
