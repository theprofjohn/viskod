/**
 * Smoke test for Phase 18 Agent Workflow Packaging.
 *
 * Validates that a new user can:
 *   1. Start viskod serve and receive tools/list with viskod_select_element and viskod_capture_context
 *   2. Call viskod_capture_context and receive ok, packetId, selection, screenshots, confidence
 *   3. No daemon/session token leaks
 *
 * Usage: pnpm smoke:agent-workflow
 *
 * Requires:
 *   - Fixture server running on http://127.0.0.1:3000
 *   - pnpm install completed
 *   - Playwright chromium browser installed
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const FIXTURE_CSS = join(
  ROOT,
  'examples',
  'phase12-source-hint-app',
  'src',
  'components',
  'TargetCard.css',
);
const FIXTURE_CSS_BROKEN = join(
  ROOT,
  'examples',
  'phase12-source-hint-app',
  'src',
  'components',
  'TargetCard.css.broken',
);

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

// Create broken CSS variant (description hidden) and save original
console.log('=== Phase 18 Agent Workflow Smoke ===\n');

let cssBackup = null;
if (existsSync(FIXTURE_CSS)) {
  cssBackup = readFileSync(FIXTURE_CSS, 'utf-8');
  // Write broken CSS: hide description
  // Replace description rule (multi-line or single-line) with display:none
  const brokenCss = cssBackup.replace(
    /\.target-card-description\s*\{[\s\S]*?\}/,
    '.target-card-description{display:none}',
  );
  writeFileSync(FIXTURE_CSS_BROKEN, brokenCss, 'utf-8');
  writeFileSync(FIXTURE_CSS, brokenCss, 'utf-8');
  console.log('Fixture CSS set to broken (description hidden)');
}

// Spawn viskod serve via npx tsx
const proc = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsx', 'packages/cli/src/index.ts', 'serve', '--url', 'http://127.0.0.1:3000'],
  { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'], shell: true },
);

let stdout = '';
let stderr = '';
proc.stdout.on('data', (d) => {
  stdout += d.toString();
});
proc.stderr.on('data', (d) => {
  stderr += d.toString();
});

function send(msg) {
  proc.stdin.write(`${JSON.stringify(msg)}\n`);
}

function waitForResponse(timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const lines = stdout.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        if (t?.startsWith('{')) {
          try {
            const obj = JSON.parse(t);
            lines.splice(i, 1);
            stdout = lines.join('\n');
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
      setTimeout(check, 500);
    };
    check();
  });
}

let exitCode = 0;

try {
  await new Promise((r) => setTimeout(r, 5000));

  // 1. tools/list
  console.log('\n--- 1. tools/list ---');
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

  // 2. viskod_capture_context
  console.log('\n--- 2. viskod_capture_context ---');
  send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'viskod_capture_context',
      arguments: {
        selector: '.target-card',
      },
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
  check('viskod_capture_context has content', !!capParsed);
  check('capture ok is true', capParsed?.ok === true);
  check('capture packetId is non-empty', !!capParsed?.packetId);
  check('capture selection has selector', !!capParsed?.selection?.selector);
  check('capture screenshots is array', Array.isArray(capParsed?.screenshots));
  check(
    'capture confidence is object',
    typeof capParsed?.confidence === 'object' && capParsed?.confidence !== null,
  );

  const capStr = JSON.stringify(capParsed || {});
  check(
    'no daemon/session token in capture output',
    !capStr.includes('daemon-token') && !capStr.includes('sessionToken'),
  );

  // 3. Summary
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
  // Restore original CSS
  if (cssBackup) {
    writeFileSync(FIXTURE_CSS, cssBackup, 'utf-8');
  }
  // Clean up broken variant
  try {
    if (existsSync(FIXTURE_CSS_BROKEN)) rmSync(FIXTURE_CSS_BROKEN, { force: true });
  } catch {}
  // Clean up temp files
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}

  proc.stdin.end();
  await new Promise((r) => setTimeout(r, 1000));
  proc.kill('SIGTERM');
  process.exit(exitCode);
}
