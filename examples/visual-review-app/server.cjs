// Phase 31 visual-review fixture server (deterministic real-browser states).
//
// The page renders a target card driven by `state.json` in this directory.
// Tests mutate the state file (or POST /__state) to produce deterministic
// visible changes — color, typography, border/shadow, size, position, text,
// or target removal — then recapture. The same ?viskodSimulate=<id> overlay
// hook as the phase12 fixture drives Studio selection without a pointer.
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.VISKOD_REVIEW_FIXTURE_PORT || 3224);
const STATE_FILE = path.join(__dirname, 'state.json');

const DEFAULT_STATE = {
  background: '#ffffff',
  color: '#111111',
  fontSize: '16px',
  fontWeight: '400',
  lineHeight: '1.4',
  border: '1px solid #cccccc',
  shadow: 'none',
  width: '240px',
  height: '80px',
  marginLeft: '0px',
  marginTop: '0px',
  text: 'Target card',
  present: true,
};

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return { ...DEFAULT_STATE, ...parsed };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function writeState(next) {
  const merged = { ...readState(), ...next };
  const temp = `${STATE_FILE}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // Trailing newline keeps the persisted state file formatter-clean.
  fs.writeFileSync(temp, `${JSON.stringify(merged, null, 2)}\n`);
  // Windows can transiently lock the destination right after a rename
  // (antivirus/indexer); retry briefly instead of failing the mutation.
  let lastError = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      fs.renameSync(temp, STATE_FILE);
      return merged;
    } catch (error) {
      lastError = error;
      const delayMs = 50 * (attempt + 1);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    }
  }
  try {
    fs.rmSync(temp, { force: true });
  } catch {
    /* best effort */
  }
  throw lastError;
}

function stableSelector(el) {
  const tid = el.getAttribute('data-testid');
  if (tid) return `[data-testid="${tid}"]`;
  if (el.id) return `#${CSS.escape(el.id)}`;
  return null;
}

function simulatedSet() {
  try {
    return JSON.parse(sessionStorage.getItem('viskodSimulatedTargets') || '[]');
  } catch (e) {
    return [];
  }
}

function markSimulated(target) {
  const set = simulatedSet();
  if (!set.includes(target)) {
    set.push(target);
    sessionStorage.setItem('viskodSimulatedTargets', JSON.stringify(set));
  }
}

function dispatchElementClick(el, selector) {
  const rect = el.getBoundingClientRect();
  const tagName = el.tagName.toLowerCase();
  const textPreview = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120) || undefined;
  window.postMessage(
    {
      source: '__viskod_overlay',
      type: 'overlay:element-clicked',
      data: {
        tagName,
        boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        role: el.getAttribute('role') || undefined,
        accessibleName: el.getAttribute('aria-label') || undefined,
        textPreview,
        isInteractive: false,
        selector,
        documentOrder: 1,
        selectionNumber: 1,
      },
    },
    '*',
  );
}

function renderPage(state, query) {
  const simulate = query.getAll('viskodSimulate');
  const reset = query.get('viskodReset');
  const card = state.present
    ? `<div id="target-card" data-testid="target-card" style="
        background:${state.background};
        color:${state.color};
        font-size:${state.fontSize};
        font-weight:${state.fontWeight};
        line-height:${state.lineHeight};
        border:${state.border};
        box-shadow:${state.shadow};
        width:${state.width};
        height:${state.height};
        margin-left:${state.marginLeft};
        margin-top:${state.marginTop};
        padding:12px;
        border-radius:6px;
      ">${state.text}</div>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Viskod Visual Review Fixture</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 24px; background: #f3f4f6; }
  h1 { font-size: 20px; color: #333; }
  .page-context { max-width: 640px; }
  .page-context p { color: #667; }
</style>
</head>
<body>
<div class="page-context">
  <h1>Visual Review Fixture</h1>
  <p>Deterministic target states for Phase 31 before/after review.</p>
  ${card}
  <p class="page-context-note">Context paragraph below the target.</p>
</div>
<script>
(() => {
  if (${reset ? 'true' : 'false'}) { sessionStorage.clear(); }
  const simulateTargets = ${JSON.stringify(simulate)};

  function stableSelector(el) {
    const tid = el.getAttribute('data-testid');
    if (tid) return '[data-testid="' + tid + '"]';
    if (el.id) return '#' + CSS.escape(el.id);
    return null;
  }

  function simulatedSet() {
    try { return JSON.parse(sessionStorage.getItem('viskodSimulatedTargets') || '[]'); }
    catch (e) { return []; }
  }

  function markSimulated(target) {
    const set = simulatedSet();
    if (!set.includes(target)) {
      set.push(target);
      sessionStorage.setItem('viskodSimulatedTargets', JSON.stringify(set));
    }
  }

  function dispatchElementClick(el, selector) {
    const rect = el.getBoundingClientRect();
    const textPreview = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120) || undefined;
    window.postMessage(
      {
        source: '__viskod_overlay',
        type: 'overlay:element-clicked',
        data: {
          tagName: el.tagName.toLowerCase(),
          boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          role: el.getAttribute('role') || undefined,
          accessibleName: el.getAttribute('aria-label') || undefined,
          textPreview,
          isInteractive: false,
          selector,
          documentOrder: 1,
          selectionNumber: 1,
        },
      },
      '*',
    );
  }

  let sessionDispatched = false;
  window.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.source === '__viskod_browser' && data.command === 'overlay:hide') {
      sessionDispatched = false;
      return;
    }
    if (data.source !== '__viskod_overlay' || data.type !== 'overlay:ready') return;
    if (sessionDispatched) return;
    sessionDispatched = true;
    const pending = simulateTargets.find((id) => !simulatedSet().includes(id));
    if (!pending) return;
    setTimeout(() => {
      if (simulatedSet().includes(pending)) return;
      const el = document.getElementById(pending);
      if (!el) return;
      markSimulated(pending);
      const selector = stableSelector(el) || '[data-testid="' + pending + '"]';
      dispatchElementClick(el, selector);
    }, 800);
  });
})();
</script>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === '/__state' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(readState()));
    return;
  }
  if (url.pathname === '/__state' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const next = writeState(JSON.parse(body || '{}'));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(next));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: String(e) }));
      }
    });
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(renderPage(readState(), url.searchParams));
    return;
  }
  res.statusCode = 404;
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`visual-review fixture listening on http://127.0.0.1:${PORT}`);
});
