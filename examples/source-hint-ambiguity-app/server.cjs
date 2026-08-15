// Phase 30 source-ambiguity E2E fixture.
//
// Two unrelated source files (StatusWidgetA.jsx / StatusWidgetB.jsx) contain
// the exact same visible text. Source resolution MUST report ambiguous —
// never a confident winner — because the target text alone cannot
// distinguish the files.
//
// ?viskodSimulate=click dispatches an overlay:element-clicked event for the
// target (mirroring the Phase 28A/28B/29 fixture mechanism) so Studio's
// selection workflow can complete without a human click. ?viskodReset=1
// clears the simulation guard for repeated runs.

'use strict';
const http = require('node:http');

const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Phase 30 Source Ambiguity Fixture</title></head>
<body>
  <main id="app">
    <h1>Status panel</h1>
    <p id="dup-status" class="status-text" data-testid="dup-status">
      Duplicate status text: processing request 42
    </p>
  </main>
<script>
  (function () {
    var pending = new URLSearchParams(location.search).get('viskodSimulate');
    if (pending !== 'click') return;
    if (new URLSearchParams(location.search).get('viskodReset')) {
      sessionStorage.removeItem('viskodSimulatedTargets');
    }
    var dispatched = false;
    window.addEventListener('message', function (event) {
      var data = event.data || {};
      if (data.source !== '__viskod_overlay' || data.type !== 'overlay:ready') return;
      if (dispatched) return;
      dispatched = true;
      setTimeout(function () {
        if (sessionStorage.getItem('viskodSimulatedTargets')) return;
        var el = document.getElementById('dup-status');
        if (!el) return;
        var rect = el.getBoundingClientRect();
        sessionStorage.setItem('viskodSimulatedTargets', JSON.stringify(['dup-status']));
        window.postMessage(
          {
            source: '__viskod_overlay',
            type: 'overlay:element-clicked',
            data: {
              selector: '#dup-status',
              tagName: 'p',
              boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              textPreview: 'Duplicate status text: processing request 42',
              documentOrder: 1,
              selectionNumber: 1,
            },
          },
          '*',
        );
      }, 1500);
    });
  })();
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

const port = Number(process.env.PORT) || 3223;
server.listen(port, '127.0.0.1', () => {
  console.log(`Phase 30 ambiguity fixture listening on http://127.0.0.1:${port}`);
});
