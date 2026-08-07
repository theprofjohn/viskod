// Phase 12C Source Hint — client-side logic
(() => {
  const log = document.getElementById('activity-log');
  if (log) log.textContent = '';

  function addLog(msg) {
    const p = document.createElement('p');
    p.style.cssText = 'margin:2px 0;padding:4px 0;border-bottom:1px solid #eee';
    p.textContent = msg;
    document.querySelector('main')?.appendChild(p);
  }

  addLog('App initialized');

  console.error(
    'VISKOD_SOURCE_HINT_ERROR: fake api key sk_test_sourcehint_abc123 should be redacted',
  );

  fetch('/api/source-hint/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'hint-validation' }),
  }).catch((err) => {
    console.error(
      `VISKOD_SOURCE_FETCH_FAILED: POST /api/source-hint/submit failed — ${err.message}`,
    );
    addLog('Network request failed (expected fixture behaviour)');
  });

  document.getElementById('phase12-source-submit-button')?.addEventListener('click', () => {
    console.error('VISKOD_SOURCE_HINT_ERROR: fake api key sk_test_sourcehint_abc123');
    addLog(`Submit clicked at ${new Date().toLocaleTimeString()}`);
  });

  // Test-only deterministic selection: ?viskodSimulate=<data-testid> dispatches
  // an overlay:element-clicked event once the Viskod overlay is ready. Used by
  // the smoke script and e2e Studio flow to select the fixture target through
  // the overlay event without a physical pointer. Guarded by sessionStorage so
  // recapture reloads do not re-dispatch.
  const simulateTarget = new URLSearchParams(location.search).get('viskodSimulate');
  if (simulateTarget) {
    window.addEventListener('message', (event) => {
      const data = event.data || {};
      if (data.source !== '__viskod_overlay' || data.type !== 'overlay:ready') return;
      if (sessionStorage.getItem('viskodSimulated')) return;
      sessionStorage.setItem('viskodSimulated', '1');
      setTimeout(() => {
        const el =
          document.querySelector(`[data-testid="${simulateTarget}"]`) ||
          document.getElementById(simulateTarget);
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const tagName = el.tagName.toLowerCase();
        const textPreview =
          (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120) || undefined;
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
              selector: `[data-testid="${simulateTarget}"]`,
              documentOrder: 1,
              selectionNumber: 1,
            },
          },
          '*',
        );
      }, 1500);
    });
  }
})();
