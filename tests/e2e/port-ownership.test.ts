import { type ChildProcess, spawn } from 'node:child_process';
import http from 'node:http';
import { type AddressInfo, type Socket, connect } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { ROOT, sleep } from './harness';

/**
 * Phase 32B — port-ownership regression (smoke must never kill an unknown
 * process).
 *
 * A sentinel HTTP server owns smoke port 3000. The smoke startup path must
 * fail with a controlled PORT_IN_USE error and must NOT terminate the
 * sentinel. After the test terminates the sentinel, the same smoke succeeds.
 *
 * The smoke only kills processes it spawned (its own fixture/Studio/MCP
 * trees); the sentinel here is an unrelated owner and must survive step 3.
 *
 * Real wall-clock waits are required: the assertions poll real child
 * processes and a real TCP socket that the smoke script owns. Deterministic
 * fake timers cannot drive an external `node scripts/...` process.
 */

const SMOKE_SCRIPT = 'scripts/smoke-phase18-agent-workflow.mjs';
const SMOKE_PORT = 3000;

let sentinel: http.Server | null = null;
let sentinelAddress: AddressInfo | null = null;

function startSentinel(): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('sentinel-alive');
    });
    server.once('error', reject);
    server.listen(SMOKE_PORT, '127.0.0.1', () => {
      sentinel = server;
      sentinelAddress = server.address() as AddressInfo;
      resolve();
    });
  });
}

function stopSentinel(): Promise<void> {
  return new Promise((resolve) => {
    if (!sentinel) return resolve();
    const server = sentinel;
    sentinel = null;
    server.close(() => resolve());
    // Close idle keep-alive sockets that could hold the port open.
    server.closeAllConnections?.();
  });
}

function probeSentinel(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!sentinelAddress) return resolve(false);
    const req = http.get({ host: '127.0.0.1', port: sentinelAddress.port, path: '/' }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function probeRawPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket: Socket = connect(port, '127.0.0.1');
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function runSmoke(): Promise<{ exitCode: number | null; output: string }> {
  return new Promise((resolve) => {
    const proc: ChildProcess = spawn(process.execPath, [SMOKE_SCRIPT], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    proc.stdout?.on('data', (d: Buffer) => {
      output += d.toString();
    });
    proc.stderr?.on('data', (d: Buffer) => {
      output += d.toString();
    });
    proc.on('close', (code) => resolve({ exitCode: code, output }));
  });
}

async function waitForPortFree(port: number, timeoutMs: number): Promise<void> {
  // Polling real socket state: the port is released asynchronously by the OS
  // after the sentinel closes; a fixed sleep would guess at that latency.
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const raw = await probeRawPort(port);
    if (!raw) return;
    await sleep(500);
  }
  throw new Error(`port ${port} did not become free within ${timeoutMs}ms`);
}

afterAll(async () => {
  await stopSentinel();
});

describe('Phase 32B — smoke port ownership (unknown owner survives)', () => {
  it('smoke fails with PORT_IN_USE, sentinel survives, then smoke succeeds after sentinel termination', async () => {
    // 1. Sentinel owns smoke port 3000.
    await startSentinel();
    expect(sentinel).not.toBeNull();
    expect(await probeSentinel()).toBe(true);

    // 2. Run the smoke startup path against the occupied port.
    const first = await runSmoke();

    // 3. Smoke must fail safely with a controlled PORT_IN_USE error.
    expect(first.exitCode).not.toBe(0);
    expect(first.output).toMatch(/PORT_IN_USE/);
    expect(first.output).toMatch(/3000/);

    // 4. The sentinel (an unrelated process) is STILL ALIVE.
    expect(await probeSentinel()).toBe(true);

    // 5. Terminate the sentinel explicitly from the test.
    await stopSentinel();
    await waitForPortFree(SMOKE_PORT, 10000);
    expect(await probeSentinel()).toBe(false);

    // 6. Rerun the smoke — port is free, so it must succeed.
    const second = await runSmoke();

    // 7. Normal success.
    expect(second.exitCode).toBe(0);
    expect(second.output).toMatch(/PASS/);
  }, 600_000);
});
