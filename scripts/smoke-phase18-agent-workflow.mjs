/**
 * Smoke test for Phase 18 Agent Workflow Packaging.
 *
 * Validates that a new user can:
 *   1. Start viskod serve and receive tools/list with capture_context and recapture_context
 *   2. Call capture_context and receive packetPath, captureDir, brief, sourceHintCount
 *   3. Call recapture_context with previousPacketPath, reload, cacheBust
 *   4. Receive a comparisonSummary with boundingBoxDelta, areaDelta, verdict
 *   5. No daemon/session token leaks
 *
 * Usage: pnpm smoke:agent-workflow
 *
 * Requires:
 *   - Fixture server running on http://127.0.0.1:3000
 *   - pnpm install completed
 *   - Playwright chromium browser installed
 */

import { spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
const recapOut = join(tmpDir, 'recapture.json');
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

function extractBoxFromBrief(brief) {
  if (!brief) return null;
  const m = brief.match(/w=(\d+\.?\d*)\s+h=(\d+\.?\d*)/);
  if (!m) return null;
  return { width: Number.parseFloat(m[1]), height: Number.parseFloat(m[2]) };
}

// Create broken CSS variant (description hidden) and save original
console.log('=== Phase 18 Agent Workflow Smoke ===\n');

let cssBackup = null;
if (existsSync(FIXTURE_CSS)) {
  cssBackup = readFileSync(FIXTURE_CSS, 'utf-8');
  // Write broken CSS: hide description
  const brokenCss = cssBackup.replace(
    /\.target-card-description\{[^}]*\}/,
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
  check('capture_context is listed', toolNames.includes('capture_context'));
  check('recapture_context is listed', toolNames.includes('recapture_context'));

  if (!toolNames.includes('capture_context')) {
    throw new Error('capture_context not found in tools/list');
  }

  // 2. capture_context
  console.log('\n--- 2. capture_context ---');
  send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'capture_context',
      arguments: {
        selector: '.target-card',
        url: 'http://127.0.0.1:3000',
        profile: 'debug',
        projectPath: 'examples/phase12-source-hint-app',
        format: 'markdown',
      },
    },
  });
  const capResp = await waitForResponse(120000);
  writeFileSync(captureOut, JSON.stringify(capResp, null, 2));
  check('capture_context response received', !!capResp);

  if (capResp?.error) {
    throw new Error(`capture_context error: ${capResp.error.message}`);
  }

  const capText = capResp?.result?.content?.[0]?.text;
  const capParsed = capText ? JSON.parse(capText) : null;
  check('capture_context has content', !!capParsed);

  check('capture_context packetPath is non-empty', !!capParsed?.packetPath);
  check('capture_context captureDir is non-empty', !!capParsed?.captureDir);
  check('capture_context brief is non-empty', !!capParsed?.brief);
  check('capture_context sourceHintCount >= 0', typeof capParsed?.sourceHintCount === 'number');

  const beforeBox = capParsed ? extractBoxFromBrief(capParsed.brief) : null;
  check('before bounding box extractable from brief', !!beforeBox);
  if (beforeBox) {
    check(`before card height = ${beforeBox.height}px`, true);
    check('before card width = 640px', beforeBox.width === 640, `got ${beforeBox.width}px`);
  }

  const capStr = JSON.stringify(capParsed || {});
  check(
    'no daemon/session token in capture output',
    !capStr.includes('daemon-token') && !capStr.includes('sessionToken'),
  );

  check('source hints include TargetCard.jsx', capParsed?.brief?.includes('TargetCard.jsx'));
  check('source hints include TargetCard.css', capParsed?.brief?.includes('TargetCard.css'));

  // 3. Apply CSS fix
  console.log('\n--- 3. Apply CSS fix ---');
  if (cssBackup) {
    writeFileSync(FIXTURE_CSS, cssBackup, 'utf-8');
    console.log('  ✓ CSS restored to fixed version');
  }

  // 4. recapture_context
  console.log('\n--- 4. recapture_context ---');
  send({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'recapture_context',
      arguments: {
        selector: '.target-card',
        url: 'http://127.0.0.1:3000',
        profile: 'default',
        projectPath: 'examples/phase12-source-hint-app',
        previousPacketPath: capParsed.packetPath,
        reload: true,
        cacheBust: true,
        format: 'markdown',
      },
    },
  });
  const recapResp = await waitForResponse(120000);
  writeFileSync(recapOut, JSON.stringify(recapResp, null, 2));
  check('recapture_context response received', !!recapResp);

  if (recapResp?.error) {
    throw new Error(`recapture_context error: ${recapResp.error.message}`);
  }

  const recapText = recapResp?.result?.content?.[0]?.text;
  const recapParsed = recapText ? JSON.parse(recapText) : null;
  check('recapture_context has content', !!recapParsed);

  check('recapture_context packetPath is non-empty', !!recapParsed?.packetPath);
  check('recapture_context captureDir is non-empty', !!recapParsed?.captureDir);

  const afterBox = recapParsed ? extractBoxFromBrief(recapParsed.brief) : null;
  check('after bounding box extractable from brief', !!afterBox);
  if (afterBox && beforeBox) {
    const hDelta = Math.round((afterBox.height - beforeBox.height) * 100) / 100;
    check(
      `bounding box: before h=${beforeBox.height} → after h=${afterBox.height} (delta ${hDelta}px)`,
      true,
    );
    check(`height delta > 0 (${hDelta}px)`, hDelta > 0, `delta ${hDelta}px`);
    check(
      'width unchanged at 640px',
      afterBox.width === 640 && beforeBox.width === 640,
      `before ${beforeBox.width} after ${afterBox.width}`,
    );
  }

  // 5. comparisonSummary
  const cs = recapParsed?.comparisonSummary;
  check('comparisonSummary is present', !!cs);
  if (cs) {
    check('comparisonSummary.boundingBoxDelta present', !!cs.boundingBoxDelta);
    if (cs.boundingBoxDelta?.height) {
      check(
        'boundingBoxDelta.height has before/after/delta',
        cs.boundingBoxDelta.height.before !== undefined &&
          cs.boundingBoxDelta.height.after !== undefined &&
          cs.boundingBoxDelta.height.delta !== undefined,
        `before=${cs.boundingBoxDelta.height.before} after=${cs.boundingBoxDelta.height.after} delta=${cs.boundingBoxDelta.height.delta}`,
      );
    }
    check('comparisonSummary.areaDelta present', !!cs.areaDelta);
    check(
      'areaDelta.percentChange is a number',
      typeof cs.areaDelta?.percentChange === 'number',
      `got ${cs.areaDelta?.percentChange}`,
    );
    check('comparisonSummary.evidenceDelta present', !!cs.evidenceDelta);
    check('comparisonSummary.changedFields is array', Array.isArray(cs.changedFields));
    check(
      'changedFields includes boundingBox.height',
      cs.changedFields?.includes('boundingBox.height'),
      `changedFields: ${JSON.stringify(cs.changedFields)}`,
    );
    check(
      'verdict is valid',
      ['improved', 'changed', 'unchanged', 'regressed', 'unknown'].includes(cs.verdict),
      `got "${cs.verdict}"`,
    );
    check('notes is non-empty string', typeof cs.notes === 'string' && cs.notes.length > 0);

    const csStr = JSON.stringify(cs);
    check(
      'no daemon/session token in comparisonSummary',
      !csStr.includes('daemon-token') && !csStr.includes('sessionToken'),
    );
  }

  // Source hints in recapture
  if (recapParsed?.brief) {
    check(
      'source hints include TargetCard.jsx after recapture',
      recapParsed.brief.includes('TargetCard.jsx'),
    );
    check(
      'source hints include TargetCard.css after recapture',
      recapParsed.brief.includes('TargetCard.css'),
    );
  }

  // No .tmp files
  if (recapParsed?.captureDir) {
    try {
      const files = readdirSync(recapParsed.captureDir);
      const tmpFiles = files.filter((f) => f.endsWith('.tmp'));
      check(
        'no .tmp files in capture dir',
        tmpFiles.length === 0,
        tmpFiles.length > 0 ? tmpFiles.join(',') : undefined,
      );
    } catch {}
  }

  // Summary
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
