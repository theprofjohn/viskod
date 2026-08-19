import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Shared E2E process harness. Each test file owns its processes: it starts
 * what it needs, waits for real readiness (HTTP health checks, never fixed
 * sleeps), and kills the process tree on teardown so no ports or processes
 * leak after a pass or a failure.
 */

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export const ROOT = `${__dirname}../..`;
export const FIXTURE_URL = 'http://127.0.0.1:3000';
export const STUDIO_URL = 'http://127.0.0.1:3001';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

export function spawnProc(
  cmd: string,
  args: string[],
  options: { cwd?: string } = {},
): ChildProcess {
  return spawn(cmd, args, {
    cwd: options.cwd ?? ROOT,
    stdio: 'pipe',
    shell: true,
    // Detached on POSIX makes the child a process-group leader, so killTree
    // can terminate the whole npx → tsx → node tree. Without it, SIGTERM to
    // the shell-spawned leader orphans the real servers (they keep their
    // ports and collide with later test files).
    detached: process.platform !== 'win32',
  });
}

/**
 * Terminates the process tree this test spawned: the whole process group on
 * POSIX (SIGTERM, escalating to SIGKILL after a short grace), taskkill /T on
 * Windows. Never touches processes the test did not create.
 *
 * Some children (e.g. an MCP serve process after a Playwright browser
 * launch) install signal handlers that swallow SIGTERM; SIGKILL escalation
 * guarantees the tree dies and no port/process leaks into later files.
 */
export function killTree(proc: ChildProcess | null): void {
  if (!proc) return;
  const pid = proc.pid;
  if (pid === undefined) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      proc.kill('SIGTERM');
    } catch {
      return;
    }
  }

  // Do not return while an owned child can still hold the fixed E2E port.
  // This synchronous bounded wait prevents the next file from probing the
  // previous file's Studio during the SIGTERM grace window.
  const deadline = Date.now() + 2_000;
  const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() < deadline) {
    try {
      process.kill(-pid, 0);
      Atomics.wait(waitBuffer, 0, 0, 25);
    } catch {
      return;
    }
  }

  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      proc.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

export async function waitForHttp(url: string, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${label} at ${url}`);
}

/** Boot the phase12 fixture server (port 3000) and wait until it serves HTTP. */
export async function startFixture(): Promise<ChildProcess> {
  const proc = spawnProc('node', ['examples/phase12-source-hint-app/server.cjs']);
  await waitForHttp(`${FIXTURE_URL}/`, 20000, 'fixture server');
  return proc;
}

/** Boot the Studio entry (port 3001) and wait until /health responds. */
export async function startStudio(): Promise<ChildProcess> {
  const proc = spawnProc(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
    'tsx',
    'apps/studio/src/index.ts',
  ]);
  await waitForHttp(`${STUDIO_URL}/health`, 120000, 'Studio server');
  return proc;
}
