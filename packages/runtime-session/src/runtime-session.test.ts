import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DaemonClient } from './daemon-client';
import { DaemonServer } from './daemon-server';
import { RuntimeSession } from './runtime-session';

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

  it('writes and reads session file', () => {
    const tmpDir = join(tmpdir(), `viskod-test-session-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const session = new RuntimeSession(tmpDir);
    // Manually set info to simulate state for file writing
    (
      session as unknown as {
        _info: {
          sessionId: string;
          pid: number;
          port: number;
          status: string;
          startedAt: string;
          projectRoot: string;
        };
      }
    )._info = {
      sessionId: 'test-123',
      pid: 99999,
      port: 12345,
      status: 'running',
      startedAt: new Date().toISOString(),
      projectRoot: tmpDir,
    };
    session.writeSessionFile();

    const read = RuntimeSession.readSessionFile(tmpDir);
    expect(read).not.toBeNull();
    expect(read?.sessionId).toBe('test-123');
    expect(read?.pid).toBe(99999);
    expect(read?.status).toBe('running');

    RuntimeSession.clearSessionFile(tmpDir);
    const afterClear = RuntimeSession.readSessionFile(tmpDir);
    expect(afterClear).toBeNull();

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('readSessionFile returns null for missing file', () => {
    const result = RuntimeSession.readSessionFile('/nonexistent/path');
    expect(result).toBeNull();
  });
});

describe('DaemonServer + DaemonClient', () => {
  it('handles status request from client', async () => {
    const session = new RuntimeSession();
    (
      session as unknown as {
        _info: {
          sessionId: string;
          pid: number;
          port: number;
          status: string;
          startedAt: string;
          projectRoot: string;
        };
      }
    )._info = {
      sessionId: 'test-srv',
      pid: 1,
      port: 0,
      status: 'running',
      startedAt: new Date().toISOString(),
      projectRoot: process.cwd(),
    };

    const server = new DaemonServer(session);
    const port = await server.start();
    expect(port).toBeGreaterThan(0);

    const client = new DaemonClient(port);
    const result = await client.status();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sessionId).toBe('test-srv');
      expect(result.value.status).toBe('running');
    }

    await server.stop();
  });

  it('handles unknown method error', async () => {
    const session = new RuntimeSession();
    const server = new DaemonServer(session);
    const port = await server.start();

    const client = new DaemonClient(port);
    // @ts-expect-error testing error response
    const result = await client.request('nonexistent');
    // The raw request should fail via the normal request path
    await server.stop();
  });

  it('fails capture when session not started', async () => {
    const session = new RuntimeSession();
    const server = new DaemonServer(session);
    const port = await server.start();

    const client = new DaemonClient(port);
    const result = await client.capture('.foo');
    expect(result.ok).toBe(false);

    await server.stop();
  });

  it('client times out connecting to unused port', async () => {
    const client = new DaemonClient(1);
    const result = await client.status();
    expect(result.ok).toBe(false);
  });
});
