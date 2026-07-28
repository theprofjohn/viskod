import http from 'node:http';
import { describe, expect, it } from 'vitest';

async function get(url: string): Promise<unknown> {
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

describe('Studio E2E', () => {
  it('responds to /state endpoint', async () => {
    const state = (await get('http://localhost:3001/state')) as {
      activePanel: string;
      browserConnected: boolean;
      isSelecting: boolean;
    };
    expect(state.activePanel).toBeDefined();
    expect(state.browserConnected).toBeDefined();
    expect(state.isSelecting).toBeDefined();
  });

  it('responds to /health endpoint', async () => {
    const health = (await get('http://localhost:3001/health')) as {
      studio: { status: string; panel: string };
      vce: unknown;
      selectionEngine: unknown;
    };
    expect(health.studio.status).toBe('running');
    expect(health.vce).toBeDefined();
    expect(health.selectionEngine).toBeDefined();
  });

  it('responds to /packet/latest when no packet exists', async () => {
    const packet = await get('http://localhost:3001/packet/latest');
    expect(packet).toBeNull();
  });

  it('responds to /select/start', async () => {
    const result = (await get('http://localhost:3001/select/start')) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it('responds to /select/clear', async () => {
    const result = (await get('http://localhost:3001/select/clear')) as { ok: boolean };
    expect(result.ok).toBe(true);
  });

  it('handles /capture without browser', async () => {
    const result = (await get('http://localhost:3001/capture')) as { ok?: boolean; error?: string };
    expect(result.ok ?? result.error).toBeDefined();
  });

  it('returns 404 for unknown endpoints', async () => {
    const result = (await get('http://localhost:3001/nonexistent')) as { error: string };
    expect(result.error).toBe('Not found');
  });
});
