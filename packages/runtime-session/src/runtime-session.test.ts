import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SESSION_FILE } from './constants';
import { DaemonClient } from './daemon-client';
import { DaemonServer } from './daemon-server';
import { RuntimeSession } from './runtime-session';

function makeMockInfo(
  overrides: Partial<{
    sessionId: string;
    pid: number;
    port: number;
    token: string;
    status: string;
    startedAt: string;
    projectRoot: string;
    browserUrl: string;
  }> = {},
) {
  return {
    sessionId: overrides.sessionId ?? 'test-session',
    pid: overrides.pid ?? 1,
    port: overrides.port ?? 0,
    token: overrides.token ?? 'test-token',
    status: overrides.status ?? 'running',
    startedAt: overrides.startedAt ?? new Date().toISOString(),
    projectRoot: overrides.projectRoot ?? process.cwd(),
    browserUrl: overrides.browserUrl ?? 'http://localhost:3000',
  };
}

describe('RuntimeSession', () => {
  it('starts with no active session', () => {
    const session = new RuntimeSession();
    expect(session.getStatus()).toBeNull();
    expect(session.info).toBeNull();
  });

  it('fails capture when not started', async () => {
    const session = new RuntimeSession();
    const result = await session.capture('.foo');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Session not running');
  });

  it('stop succeeds when not started', async () => {
    const session = new RuntimeSession();
    const result = await session.stop();
    expect(result.ok).toBe(true);
  });

  it('writes and reads session file with token', () => {
    const tmpDir = join(tmpdir(), `viskod-test-session-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const session = new RuntimeSession(tmpDir);
    (session as unknown as { _info: ReturnType<typeof makeMockInfo> })._info = makeMockInfo({
      sessionId: 'test-123',
      pid: 99999,
      port: 12345,
      token: 'secret-token-abc',
    });
    session.writeSessionFile();

    const read = RuntimeSession.readSessionFile(tmpDir);
    expect(read).not.toBeNull();
    expect(read?.sessionId).toBe('test-123');
    expect(read?.pid).toBe(99999);
    expect(read?.port).toBe(12345);
    expect(read?.token).toBe('secret-token-abc');
    expect(read?.status).toBe('running');

    RuntimeSession.clearSessionFile(tmpDir);
    expect(RuntimeSession.readSessionFile(tmpDir)).toBeNull();

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('readSessionFile returns null for missing file', () => {
    expect(RuntimeSession.readSessionFile('/nonexistent/path')).toBeNull();
  });

  it('readSessionFile returns null for corrupt file', () => {
    const tmpDir = join(tmpdir(), `viskod-test-corrupt-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const filePath = join(tmpDir, SESSION_FILE);
    // Write invalid JSON
    const { writeFileSync } = require('node:fs');
    writeFileSync(filePath, 'not-json', 'utf-8');
    expect(RuntimeSession.readSessionFile(tmpDir)).toBeNull();
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('DaemonServer + DaemonClient', () => {
  it('handles status request with valid token', async () => {
    const session = new RuntimeSession();
    (session as unknown as { _info: ReturnType<typeof makeMockInfo> })._info = makeMockInfo({
      sessionId: 'test-srv',
      token: 'valid-token',
    });

    const server = new DaemonServer(session);
    const port = await server.start();
    expect(port).toBeGreaterThan(0);

    const client = new DaemonClient(port, 'valid-token');
    const result = await client.status();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sessionId).toBe('test-srv');
      expect(result.value.status).toBe('running');
    }

    await server.stop();
  });

  it('rejects requests with wrong token', async () => {
    const session = new RuntimeSession();
    (session as unknown as { _info: ReturnType<typeof makeMockInfo> })._info = makeMockInfo({
      token: 'correct-token',
    });

    const server = new DaemonServer(session);
    const port = await server.start();

    const client = new DaemonClient(port, 'wrong-token');
    const result = await client.status();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Invalid session token');

    await server.stop();
  });

  it('rejects capture when session info is set with wrong token', async () => {
    const session = new RuntimeSession();
    (session as unknown as { _info: ReturnType<typeof makeMockInfo> })._info = makeMockInfo({
      token: 'correct-token',
    });

    const server = new DaemonServer(session);
    const port = await server.start();

    const client = new DaemonClient(port, 'wrong-token');
    const result = await client.capture('.foo');
    expect(result.ok).toBe(false);

    await server.stop();
  });

  it('rejects capture when session info is set with correct token but no browser', async () => {
    const session = new RuntimeSession();
    (session as unknown as { _info: ReturnType<typeof makeMockInfo> })._info = makeMockInfo({
      token: 'tok',
    });

    const server = new DaemonServer(session);
    const port = await server.start();

    const client = new DaemonClient(port, 'tok');
    const result = await client.capture('.foo');
    // Session is "running" in info but no real VCE browser — capture fails with session error
    expect(result.ok).toBe(false);

    await server.stop();
  });

  it('client times out connecting to unused port', async () => {
    const client = new DaemonClient(1, 'any-token');
    const result = await client.status();
    expect(result.ok).toBe(false);
  });
});
