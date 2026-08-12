import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const FIXTURE_URL = 'http://127.0.0.1:3000';
const STUDIO_URL = 'http://127.0.0.1:3001';

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function spawnProc(command, args) {
  const child = spawn(command, args, {
    cwd: ROOT,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (data) => {
    stdout += data.toString();
  });
  child.stderr.on('data', (data) => {
    stderr += data.toString();
  });
  return {
    child,
    readStdout: () => stdout,
    readStderr: () => stderr,
  };
}

function terminate(procState) {
  if (!procState?.child || procState.child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(procState.child.pid), '/T', '/F'], {
      stdio: 'ignore',
    });
  } else {
    procState.child.kill('SIGTERM');
  }
}

async function waitForReady(procState, pattern, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  const matcher = new RegExp(pattern);
  while (Date.now() < deadline) {
    if (matcher.test(procState.readStdout()) || matcher.test(procState.readStderr())) return;
    if (procState.child.exitCode !== null) {
      throw new Error(`${label} exited before readiness`);
    }
    await sleep(250);
  }
  throw new Error(`${label} did not become ready within ${Math.round(timeoutMs / 1000)}s`);
}

function tail(value) {
  const text = value.trim();
  return text ? text.slice(-2000) : '(no stderr output)';
}

const fixture = spawnProc('node', ['examples/phase12-source-hint-app/server.cjs']);
const studio = spawnProc(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
  'tsx',
  'apps/studio/src/index.ts',
]);
let stopping = false;

function stop() {
  if (stopping) return;
  stopping = true;
  terminate(studio);
  terminate(fixture);
}

process.once('SIGINT', () => {
  stop();
  process.exitCode = 0;
});
process.once('SIGTERM', () => {
  stop();
  process.exitCode = 0;
});

try {
  await waitForReady(
    fixture,
    'source hint fixture on http://localhost:3000',
    15000,
    'Fixture server',
  );
  await waitForReady(studio, 'Viskod Studio running on http://localhost:3001', 90000, 'Studio');

  console.log(`Fixture: ${FIXTURE_URL}`);
  console.log(`Studio: ${STUDIO_URL}`);
  console.log('Open Studio, enter the fixture URL, then choose Report UI issue.');

  const exitedService = await new Promise((resolvePromise) => {
    fixture.child.once('exit', () => resolvePromise('Fixture server'));
    studio.child.once('exit', () => resolvePromise('Studio'));
  });
  if (!stopping) {
    throw new Error(`${exitedService} exited unexpectedly`);
  }
} catch (error) {
  const failedService = /Fixture/.test(String(error)) ? fixture : studio;
  console.error(`Demo failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error(`Failed service stderr (tail):\n${tail(failedService.readStderr())}`);
  console.error('Recovery: stop any process using ports 3000/3001, then run pnpm demo again.');
  stop();
  process.exitCode = 1;
}
