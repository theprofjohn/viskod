import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const FIXTURE_URL = 'http://127.0.0.1:3000';
const STUDIO_URL = 'http://127.0.0.1:3001';
const SIMULATE_QUERY = '?viskodSimulate=target-card-description';
const OUTPUTS = [
  join(ROOT, 'website', 'demo-selection.png'),
  join(ROOT, 'website', 'demo-review.png'),
];

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function httpJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
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
  return { child, readStdout: () => stdout, readStderr: () => stderr };
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
    if (procState.child.exitCode !== null) throw new Error(`${label} exited before readiness`);
    await sleep(250);
  }
  throw new Error(`${label} did not become ready within ${Math.round(timeoutMs / 1000)}s`);
}

async function waitForState(predicate, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await httpJson(`${STUDIO_URL}/workflow/state`);
    if (result.status === 200 && predicate(result.body)) return result.body;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function tail(value) {
  const text = value.trim();
  return text ? text.slice(-2000) : '(no stderr output)';
}

function assertOutput(path) {
  if (!existsSync(path) || statSync(path).size === 0) {
    throw new Error(`Expected non-empty screenshot: ${path}`);
  }
}

const fixture = spawnProc('node', ['examples/phase12-source-hint-app/server.cjs']);
const studio = spawnProc(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
  'tsx',
  'apps/studio/src/index.ts',
]);
let browser;
let stopping = false;

function stop() {
  if (stopping) return;
  stopping = true;
  terminate(studio);
  terminate(fixture);
}

process.once('SIGINT', () => {
  stop();
  process.exitCode = 130;
});
process.once('SIGTERM', () => {
  stop();
  process.exitCode = 143;
});

try {
  await waitForReady(
    fixture,
    'source hint fixture on http://localhost:3000',
    15000,
    'Fixture server',
  );
  await waitForReady(studio, 'Viskod Studio running on http://localhost:3001', 90000, 'Studio');

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(STUDIO_URL, { waitUntil: 'networkidle' });

  const navigate = await httpJson(`${STUDIO_URL}/navigate`, {
    method: 'POST',
    body: JSON.stringify({ url: `${FIXTURE_URL}${SIMULATE_QUERY}` }),
  });
  if (navigate.status !== 200 || navigate.body?.ok !== true) {
    throw new Error('Studio could not open the included fixture');
  }

  const report = await httpJson(`${STUDIO_URL}/workflow/report/start`, { method: 'POST' });
  if (report.status !== 200 || report.body?.state?.stage !== 'selecting') {
    throw new Error('Studio did not enter selection mode');
  }
  await waitForState(
    (state) => state.stage === 'selecting' && state.selection,
    'fixture selection',
  );

  const accept = await httpJson(`${STUDIO_URL}/workflow/selection/accept`, { method: 'POST' });
  if (accept.status !== 200 || accept.body?.state?.stage !== 'describe') {
    throw new Error('Studio did not reach the describe stage');
  }
  await page.goto(STUDIO_URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-stage="describe"]', { timeout: 10000 });
  await page.evaluate(() => {
    for (const element of document.querySelectorAll('.target-summary')) {
      element.textContent = 'Selected: Target card description';
    }
  });
  await page.screenshot({ path: OUTPUTS[0], fullPage: true });

  const issue = await httpJson(`${STUDIO_URL}/workflow/issue`, {
    method: 'POST',
    body: JSON.stringify({
      problem: 'The target card needs a visual review',
      expected: 'The target card should remain clearly readable',
      severity: 'medium',
    }),
  });
  if (issue.status !== 200 || !issue.body?.state?.issueId) throw new Error('Issue creation failed');
  const handoff = await httpJson(`${STUDIO_URL}/workflow/handoff`, {
    method: 'POST',
    body: JSON.stringify({ issueId: issue.body.state.issueId }),
  });
  if (handoff.status !== 200 || !handoff.body?.state?.handoffId) {
    throw new Error('Handoff creation failed');
  }
  const verify = await httpJson(`${STUDIO_URL}/workflow/verify/start`, {
    method: 'POST',
    body: JSON.stringify({
      issueId: issue.body.state.issueId,
      handoffId: handoff.body.state.handoffId,
    }),
  });
  const recapture = await httpJson(`${STUDIO_URL}/workflow/verify/recapture`, {
    method: 'POST',
    body: JSON.stringify({ reviewId: verify.body.state.reviewId }),
  });
  if (recapture.status !== 200 || recapture.body?.state?.stage !== 'review_ready') {
    throw new Error('Studio did not reach the review state');
  }
  await page.goto(STUDIO_URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-stage="review_ready"]', { timeout: 10000 });
  await page.screenshot({ path: OUTPUTS[1], fullPage: true });

  for (const output of OUTPUTS) assertOutput(output);
  console.log(`Captured ${OUTPUTS[0]}`);
  console.log(`Captured ${OUTPUTS[1]}`);
  console.log('Demo evidence captured');
} catch (error) {
  for (const output of OUTPUTS) rmSync(output, { force: true });
  const failedService = /Fixture/.test(String(error)) ? fixture : studio;
  console.error(`Demo capture failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error(`Failed service stderr (tail):\n${tail(failedService.readStderr())}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  stop();
}
