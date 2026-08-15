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

export function spawnProc(cmd: string, args: string[]): ChildProcess {
  return spawn(cmd, args, { cwd: ROOT, stdio: 'pipe', shell: true });
}

export function killTree(proc: ChildProcess | null): void {
  if (!proc || proc.killed || proc.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      proc.kill('SIGTERM');
    }
  } catch {
    /* already gone */
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
