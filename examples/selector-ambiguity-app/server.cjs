'use strict';
/**
 * Selector-ambiguity fixture for Phase 28A.
 *
 * Serves a deterministic DOM layout used to exercise selector resolution
 * against a real browser:
 *
 *   .multi-card         two 100x100 divs; the first occupies (0,0)-(100,100)
 *                       so the historical synthetic default box
 *                       {0,0,100,100} has center (50,50) inside it and NOT
 *                       inside the second. A bare `.multi-card` selector is
 *                       ambiguous but used to "resolve" via the default box.
 *   .overlap-card       two divs whose rects BOTH contain (50,50); real
 *                       geometry {0,0,100,100} cannot disambiguate them.
 *   .legacy-twin        two divs; an overlay-generated selector that became
 *                       non-unique after DOM changes, with persisted observed
 *                       geometry identifying the intended (first) one.
 *   #unique-target      single element; resolves as a bare selector.
 *   .duplicate-card     Phase 28B: two same-selector candidates A/B that are
 *                       observably different in text, attributes, computed
 *                       styles, parent context, and geometry. A is the first
 *                       querySelector('.duplicate-card') match; B sits at the
 *                       trusted geometry box {700,300,220,120}. Evidence must
 *                       always describe the resolved candidate, never the
 *                       first selector match.
 *
 * Query params (Phase 28B):
 *   ?viskodSimulate=dup           dispatches overlay:element-clicked for B
 *                                 using the NON-unique selector
 *                                 '.duplicate-card' plus B's real rect.
 *   ?viskodDetachDuplicateB=1     removes #card-b after detachDelay ms
 *                                 (default 1500) — exercises the detached-
 *                                 target contract without re-resolution.
 */

const http = require('node:http');

const PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Selector Ambiguity Fixture</title>
<style>
  body { margin: 0; font-family: sans-serif; }
  .multi-card, .overlap-card, .legacy-twin { position: absolute; width: 100px; height: 100px; }
  .multi-card.first { left: 0; top: 0; background: #dde8f5; }
  .multi-card.second { left: 500px; top: 500px; background: #f5e8dd; }
  .overlap-card.a { left: 0; top: 0; background: rgba(255, 0, 0, 0.35); }
  .overlap-card.b { left: 30px; top: 30px; background: rgba(0, 0, 255, 0.35); }
  .legacy-twin.one { left: 0; top: 200px; background: #e5f5dd; }
  .legacy-twin.two { left: 500px; top: 200px; background: #f5f5dd; }
  #unique-target { position: absolute; left: 300px; top: 300px; width: 50px; height: 50px; }
  /* Phase 28B: duplicate same-selector candidates with distinct evidence.
     Parents are static so the absolutely-positioned cards anchor to the
     viewport: A at (0,0), B at (700,300). */
  .duplicate-card {
    position: absolute;
    width: 220px;
    height: 120px;
    padding: 8px;
    box-sizing: border-box;
    font-size: 14px;
    font-family: sans-serif;
  }
  #card-a { left: 0; top: 0; background: #d8ecff; color: #003366; border: 2px solid #003366; }
  #card-b { left: 700px; top: 300px; background: #ffe9a8; color: #7a4a00; border: 4px dashed #7a4a00; }
</style>
</head>
<body>
  <div class="multi-card first" data-testid="card-a"></div>
  <div class="multi-card second" data-testid="card-b"></div>
  <div class="overlap-card a" data-testid="overlap-a"></div>
  <div class="overlap-card b" data-testid="overlap-b"></div>
  <div class="legacy-twin one" data-testid="legacy-1"></div>
  <div class="legacy-twin two" data-testid="legacy-2"></div>
  <button id="unique-target" data-testid="unique-btn">Go</button>
  <section id="parent-a" data-marker="parent-a">
    <div class="duplicate-card" id="card-a" data-target="a" data-testid="dup-a">FIRST CARD</div>
  </section>
  <main id="parent-b" data-marker="parent-b">
    <div class="duplicate-card" id="card-b" data-target="b" data-testid="dup-b">SECOND CARD</div>
  </main>
<script>
  // Test-only overlay simulation (Phase 28A): ?viskodSimulate=legacy dispatches
  // overlay:element-clicked for the FIRST .legacy-twin using the NON-unique
  // selector '.legacy-twin' (an overlay-produced stable selector that became
  // non-unique after DOM changes) plus the real observed rect {0,0,100,100}.
  // The workflow must still resolve the intended element via that trusted
  // geometry instead of failing or picking an arbitrary twin.
  (function () {
    var pending = new URLSearchParams(location.search).get('viskodSimulate');
    if (pending !== 'legacy') return;
    var dispatched = false;
    window.addEventListener('message', function (event) {
      var data = event.data || {};
      if (data.source !== '__viskod_overlay' || data.type !== 'overlay:ready') return;
      if (dispatched) return;
      dispatched = true;
      setTimeout(function () {
        var el = document.querySelector('.legacy-twin.one');
        if (!el) return;
        var rect = el.getBoundingClientRect();
        window.postMessage(
          {
            source: '__viskod_overlay',
            type: 'overlay:element-clicked',
            data: {
              selector: '.legacy-twin',
              tagName: 'div',
              boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              textPreview: 'legacy twin one',
              documentOrder: 1,
              selectionNumber: 1,
            },
          },
          '*',
        );
      }, 1500);
    });
  })();

  // Phase 28B: simulate an overlay click on candidate B using the NON-unique
  // selector '.duplicate-card' plus B's real rect. The workflow must resolve
  // B via the trusted geometry and every piece of target evidence must come
  // from B — never from the first selector match (candidate A).
  (function () {
    var pending = new URLSearchParams(location.search).get('viskodSimulate');
    if (pending !== 'dup') return;
    var dispatched = false;
    window.addEventListener('message', function (event) {
      var data = event.data || {};
      if (data.source !== '__viskod_overlay' || data.type !== 'overlay:ready') return;
      if (dispatched) return;
      dispatched = true;
      setTimeout(function () {
        var el = document.querySelector('#card-b');
        if (!el) return;
        var rect = el.getBoundingClientRect();
        window.postMessage(
          {
            source: '__viskod_overlay',
            type: 'overlay:element-clicked',
            data: {
              selector: '.duplicate-card',
              tagName: 'div',
              boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              textPreview: 'SECOND CARD',
              documentOrder: 2,
              selectionNumber: 1,
            },
          },
          '*',
        );
      }, 1500);
    });
  })();

  // Phase 28B: deterministic detachment of candidate B. After resolution of B
  // succeeds, the selector '.duplicate-card' matches ONLY candidate A — so any
  // selector re-query would silently fall back to A. The capture path must
  // instead surface a typed detached failure for the resolved element.
  (function () {
    var params = new URLSearchParams(location.search);
    if (params.get('viskodDetachDuplicateB') !== '1') return;
    var delay = Number(params.get('detachDelay')) || 1500;
    setTimeout(function () {
      var b = document.getElementById('card-b');
      if (b && b.isConnected) b.remove();
    }, delay);
  })();

</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(PAGE);
});

const port = Number(process.env.PORT) || 3221;
server.listen(port, '127.0.0.1', () => {
  console.log(`selector-ambiguity fixture listening on http://127.0.0.1:${port}`);
});
