/**
 * Smoke test for the UI Issue → Verified Fix workflow (RFC-0001).
 *
 * Starts its own deterministic fixture server and Studio, then proves:
 *   1. MCP tools/list exposes the agent tools and viskod_capture_context works
 *   2. The end-user path through http://localhost:3001:
 *      open app → report UI issue → point at the problem (overlay event) →
 *      what is wrong / what should happen → prepare agent handoff →
 *      verify fix (reload + cache-bust) → human decision
 *   3. No daemon/session token, selector, packet JSON, or path leaks
 *
 * Exits nonzero for a missing selection, stale target, missing expected
 * result, failed recapture, or leaked secret/path field.
 *
 * Usage: pnpm smoke:agent-workflow
 * Requires: pnpm install completed, Playwright chromium installed.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const FIXTURE_HTML = join(ROOT, 'examples', 'phase12-source-hint-app', 'index.html');
const FIXTURE_HTML_BROKEN = join(ROOT, 'examples', 'phase12-source-hint-app', 'index.html.stale');
const STALE_COPY = 'STALE stale stale card copy for the smoke regression fixture';

const FIXTURE_URL = 'http://127.0.0.1:3000';
const STUDIO_URL = 'http://127.0.0.1:3001';
const SIMULATE_QUERY = '?viskodSimulate=target-card-description';

const tmpDir = mkdtempSync(join(tmpdir(), 'viskod-smoke18-'));
const captureOut = join(tmpDir, 'capture.json');
const resultsOut = join(tmpDir, 'results.json');

const results = [];
let passCount = 0;
let failCount = 0;

function check(name, pass, detail) {
  results.push({ name, pass, detail });
  if (pass) {
    passCount++;
  } else {
    failCount++;
  }
  console.log(`  ${pass ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function httpJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

function spawnProc(cmd, args, cwd) {
  const proc = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: true });
  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (d) => {
    stdout += d.toString();
  });
  proc.stderr.on('data', (d) => {
    stderr += d.toString();
  });
  return { proc, readStdout: () => stdout, readStderr: () => stderr };
}

function killTree(procState) {
  if (!procState?.proc || procState.proc.killed) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(procState.proc.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      procState.proc.kill('SIGTERM');
    }
  } catch {
    /* already gone */
  }
}

async function waitForLog(procState, pattern, timeoutMs, label) {
  const start = Date.now();
  const re = new RegExp(pattern);
  while (Date.now() - start < timeoutMs) {
    if (re.test(procState.readStdout()) || re.test(procState.readStderr())) return true;
    await sleep(500);
  }
  console.error(`  [${label}] timeout waiting for ${pattern}`);
  console.error(`  [${label}] stdout: ${procState.readStdout().slice(-2000)}`);
  console.error(`  [${label}] stderr: ${procState.readStderr().slice(-2000)}`);
  return false;
}

async function waitForWorkflowState(predicate, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { status, body } = await httpJson(`${STUDIO_URL}/workflow/state`);
    if (status === 200 && body && predicate(body)) return body;
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${label}`);
}

const WORKFLOW_FORBIDDEN_KEYS = [
  'selector',
  'packetJson',
  'absoluteCaptureDir',
  'sessionToken',
  'daemon-token',
  'captureDir',
];
const CAPTURE_FORBIDDEN_KEYS = ['daemon-token', 'sessionToken', 'absoluteCaptureDir', 'captureDir'];

function findKeys(obj, keys, path = '', found = []) {
  if (!obj || typeof obj !== 'object') return found;
  for (const [k, v] of Object.entries(obj)) {
    if (keys.includes(k)) found.push(`${path}${k}`);
    if (v && typeof v === 'object') findKeys(v, keys, `${path}${k}.`, found);
  }
  return found;
}

function checkNoLeaks(name, payload, keys) {
  const leaked = findKeys(payload ?? {}, keys);
  check(name, leaked.length === 0, leaked.length > 0 ? `leaked: ${leaked.join(', ')}` : undefined);
}

// ---------------------------------------------------------------------------
// Setup: stale fixture description copy, fixture server, Studio
// ---------------------------------------------------------------------------

console.log('=== Viskod UI Issue → Verified Fix Smoke ===\n');

let htmlBackup = null;
if (existsSync(FIXTURE_HTML)) {
  htmlBackup = readFileSync(FIXTURE_HTML, 'utf-8');
  const staleHtml = htmlBackup.replace(
    'This card is the target for source hint validation. Select it with .phase12-source-target-card.',
    STALE_COPY,
  );
  writeFileSync(FIXTURE_HTML_BROKEN, staleHtml, 'utf-8');
  writeFileSync(FIXTURE_HTML, staleHtml, 'utf-8');
  console.log('Fixture description set to stale copy');
}

const fixtureProc = spawnProc('node', ['examples/phase12-source-hint-app/server.cjs'], ROOT);
const studioProc = spawnProc(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsx', 'apps/studio/src/index.ts'],
  ROOT,
);

let exitCode = 0;

try {
  console.log('\n--- 0. Fixture + Studio startup ---');
  const fixtureReady = await waitForLog(
    fixtureProc,
    'source hint fixture on http://localhost:3000',
    15000,
    'fixture',
  );
  check('fixture server started', fixtureReady);

  const studioReady = await waitForLog(
    studioProc,
    'Viskod Studio running on http://(localhost|127\\.0\\.0\\.1):3001',
    90000,
    'studio',
  );
  check('Studio server started on 3001', studioReady);

  if (!fixtureReady || !studioReady) {
    throw new Error('Fixture or Studio failed to start');
  }

  // -------------------------------------------------------------------------
  // 1. End-user workflow through the Studio HTTP surface
  // -------------------------------------------------------------------------

  console.log('\n--- 1. Report UI issue → Prepare agent handoff → Verify fix ---');

  const nav = await httpJson(`${STUDIO_URL}/navigate`, {
    method: 'POST',
    body: JSON.stringify({ url: `${FIXTURE_URL}${SIMULATE_QUERY}` }),
  });
  check('open app navigates the browser', nav.status === 200 && nav.body?.ok === true);

  const report = await httpJson(`${STUDIO_URL}/workflow/report/start`, { method: 'POST' });
  check(
    'report start enters selection mode',
    report.status === 200 && report.body?.state?.stage === 'selecting',
  );

  // Negative: accepting before any selection must fail with a recovery message.
  const earlyAccept = await httpJson(`${STUDIO_URL}/workflow/selection/accept`, { method: 'POST' });
  const selectionAlreadyPresent = report.body?.state?.selection != null;
  check(
    'accept before selection is rejected (missing selection)',
    selectionAlreadyPresent ||
      (earlyAccept.status === 409 &&
        /Select the element again/.test(earlyAccept.body?.error ?? '')),
  );

  // Wait for the overlay event → selection (fixture dispatches it 1.5s after ready)
  const selected = await waitForWorkflowState(
    (s) => s.stage === 'selecting' && s.selection != null,
    20000,
    'overlay selection',
  );
  check('target selected through the overlay event', !!selected.selection?.label);
  checkNoLeaks('selection state has no internal fields', selected, WORKFLOW_FORBIDDEN_KEYS);

  const accept = await httpJson(`${STUDIO_URL}/workflow/selection/accept`, { method: 'POST' });
  check(
    'accept selection captures evidence and shows the describe stage',
    accept.status === 200 && accept.body?.state?.stage === 'describe',
  );

  // Negative: missing expected result must be rejected with 400.
  const badIssue = await httpJson(`${STUDIO_URL}/workflow/issue`, {
    method: 'POST',
    body: JSON.stringify({ problem: 'Description is stale', expected: '' }),
  });
  check('missing expected result is rejected (400)', badIssue.status === 400);

  const issue = await httpJson(`${STUDIO_URL}/workflow/issue`, {
    method: 'POST',
    body: JSON.stringify({
      problem: 'The card description copy is stale',
      expected: 'The description should describe the target card',
      severity: 'high',
    }),
  });
  check(
    'issue created with problem and expected result',
    issue.status === 200 && !!issue.body?.state?.issueId,
  );

  const handoff = await httpJson(`${STUDIO_URL}/workflow/handoff`, {
    method: 'POST',
    body: JSON.stringify({ issueId: issue.body?.state?.issueId }),
  });
  check(
    'handoff prepared (Handoff ready)',
    handoff.status === 200 &&
      handoff.body?.state?.stage === 'handoff_ready' &&
      !!handoff.body?.state?.handoffId,
  );
  checkNoLeaks(
    'handoff state has no internal fields',
    handoff.body?.state,
    WORKFLOW_FORBIDDEN_KEYS,
  );

  // Apply the fix: restore the correct description copy before verification.
  if (htmlBackup) {
    writeFileSync(FIXTURE_HTML, htmlBackup, 'utf-8');
    console.log('Fixture description copy restored');
  }

  const verifyStart = await httpJson(`${STUDIO_URL}/workflow/verify/start`, {
    method: 'POST',
    body: JSON.stringify({
      issueId: issue.body?.state?.issueId,
      handoffId: handoff.body?.state?.handoffId,
    }),
  });
  check(
    'verification started',
    verifyStart.status === 200 &&
      verifyStart.body?.state?.stage === 'verifying' &&
      !!verifyStart.body?.state?.reviewId,
  );

  const recapture = await httpJson(`${STUDIO_URL}/workflow/verify/recapture`, {
    method: 'POST',
    body: JSON.stringify({ reviewId: verifyStart.body?.state?.reviewId }),
  });
  check(
    'recapture with reload + cache-bust succeeds',
    recapture.status === 200 && recapture.body?.state?.stage === 'review_ready',
  );
  check(
    'comparison reports the rendered result changed',
    recapture.body?.state?.review?.comparison?.status === 'changed',
  );
  checkNoLeaks(
    'review state has no internal fields',
    recapture.body?.state,
    WORKFLOW_FORBIDDEN_KEYS,
  );

  const decision = await httpJson(`${STUDIO_URL}/workflow/decision`, {
    method: 'POST',
    body: JSON.stringify({
      reviewId: verifyStart.body?.state?.reviewId,
      decision: 'accepted',
      note: 'Smoke verification',
    }),
  });
  check(
    'human decision recorded (accepted)',
    decision.status === 200 && decision.body?.state?.stage === 'decided',
  );

  // -------------------------------------------------------------------------
  // 2. MCP tool discovery + capture (agent section)
  // -------------------------------------------------------------------------

  console.log('\n--- 2. MCP tools/list + viskod_capture_context ---');

  const mcpProc = spawnProc(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['tsx', 'packages/cli/src/index.ts', 'serve', '--url', FIXTURE_URL],
    ROOT,
  );

  let parsedIndex = 0;
  function send(msg) {
    mcpProc.proc.stdin.write(`${JSON.stringify(msg)}\n`);
  }
  function waitForResponse(timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const checkLoop = () => {
        const full = mcpProc.readStdout();
        const tail = full.slice(parsedIndex);
        const lines = tail.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const t = lines[i].trim();
          if (t?.startsWith('{')) {
            try {
              const obj = JSON.parse(t);
              parsedIndex = full.length;
              resolve(obj);
              return;
            } catch (e) {
              /* partial line */
            }
          }
        }
        if (Date.now() - start > timeoutMs) {
          resolve(null);
          return;
        }
        setTimeout(checkLoop, 500);
      };
      checkLoop();
    });
  }

  await sleep(5000);

  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  const initResp = await waitForResponse(10000);
  check('initialize response received', !!initResp);

  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const toolsResp = await waitForResponse(10000);
  const tools = toolsResp?.result?.tools || [];
  const toolNames = tools.map((t) => t.name);
  check('tools/list returns tool array', Array.isArray(tools));
  check('viskod_select_element is listed', toolNames.includes('viskod_select_element'));
  check('viskod_capture_context is listed', toolNames.includes('viskod_capture_context'));

  if (!toolNames.includes('viskod_capture_context')) {
    throw new Error('viskod_capture_context not found in tools/list');
  }

  send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'viskod_capture_context',
      arguments: { selector: '.target-card' },
    },
  });
  const capResp = await waitForResponse(120000);
  writeFileSync(captureOut, JSON.stringify(capResp, null, 2));
  check('viskod_capture_context response received', !!capResp);

  if (capResp?.error) {
    throw new Error(`viskod_capture_context error: ${capResp.error.message}`);
  }

  const capText = capResp?.result?.content?.[0]?.text;
  const capParsed = capText ? JSON.parse(capText) : null;
  check('capture ok is true', capParsed?.ok === true);
  check('capture packetId is non-empty', !!capParsed?.packetId);
  check('capture screenshots is array', Array.isArray(capParsed?.screenshots));
  checkNoLeaks('capture output has no token leaks', capParsed, CAPTURE_FORBIDDEN_KEYS);

  mcpProc.proc.stdin.end();
  await sleep(1000);
  killTree(mcpProc);

  // -------------------------------------------------------------------------
  // 3. Summary
  // -------------------------------------------------------------------------

  console.log(`\n=== RESULTS: ${passCount}/${results.length} passed, ${failCount} failed ===`);
  writeFileSync(
    resultsOut,
    JSON.stringify(
      {
        verdict: failCount === 0 ? 'PASS' : 'FAIL',
        passCount,
        failCount,
        total: results.length,
        results,
        date: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  if (failCount > 0) {
    console.log('Failures:');
    for (const f of results.filter((r) => !r.pass)) {
      console.log(`  • ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
    }
    exitCode = 1;
  } else {
    console.log('All checks passed.');
  }
} catch (e) {
  console.error(`\nSMOKE FAILED: ${e.message}`);
  exitCode = 1;
} finally {
  // Restore original fixture HTML
  if (htmlBackup) {
    writeFileSync(FIXTURE_HTML, htmlBackup, 'utf-8');
  }
  // Clean up stale variant
  try {
    if (existsSync(FIXTURE_HTML_BROKEN)) rmSync(FIXTURE_HTML_BROKEN, { force: true });
  } catch {}
  // Clean up temp files
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}

  killTree(studioProc);
  killTree(fixtureProc);
  await sleep(1000);
  process.exit(exitCode);
}
