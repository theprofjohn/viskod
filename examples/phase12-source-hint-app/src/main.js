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

  // Test-only clean slate: ?viskodReset=1 clears the simulated-target
  // sessionStorage so repeated e2e runs on the same origin start fresh.
  if (new URLSearchParams(location.search).get('viskodReset')) {
    sessionStorage.clear();
  }

  // Test-only deterministic selection: ?viskodSimulate=<id> dispatches an
  // overlay:element-clicked event once the Viskod overlay is ready. Used by
  // the smoke script and e2e Studio flow to select the fixture target through
  // the overlay event without a physical pointer. Repeated params select one
  // target per overlay:ready (multi-target reselect journeys); each simulated
  // target is guarded by sessionStorage so recapture reloads do not re-dispatch.
  const simulateTargets = new URLSearchParams(location.search).getAll('viskodSimulate');
  const afterAcceptTarget = new URLSearchParams(location.search).get('viskodAfterAccept');

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
          selector,
          documentOrder: 1,
          selectionNumber: 1,
        },
      },
      '*',
    );
  }

  if (simulateTargets.length > 0) {
    // The overlay emits overlay:ready twice per enter (script init + overlay:show),
    // so dispatch at most one pending target per selection-mode session; the
    // session resets on overlay:hide (acceptance/cancel) so Reselect can pick
    // the next target.
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
      const pending = simulateTargets.find((target) => !simulatedSet().includes(target));
      if (!pending) return;
      setTimeout(() => {
        if (simulatedSet().includes(pending)) return;
        const el =
          document.querySelector(`[data-testid="${pending}"]`) || document.getElementById(pending);
        if (!el) return;
        markSimulated(pending);
        const selector = stableSelector(el) || `[data-testid="${pending}"]`;
        dispatchElementClick(el, selector);
      }, 1500);
    });
  }

  // Test-only overlay-stopped verification: ?viskodAfterAccept=<id> dispatches
  // ONE element-clicked event for another element shortly after the overlay is
  // hidden (i.e. after the user accepts the selection). If selection-mode
  // polling is still alive the selection would change; a frozen selection
  // proves polling/interception stopped (VISKOD-AUDIT-013).
  if (afterAcceptTarget) {
    window.addEventListener('message', (event) => {
      const data = event.data || {};
      if (data.source !== '__viskod_browser' || data.command !== 'overlay:hide') return;
      setTimeout(() => {
        const el =
          document.querySelector(`[data-testid="${afterAcceptTarget}"]`) ||
          document.getElementById(afterAcceptTarget);
        if (!el) return;
        const selector = stableSelector(el) || `[data-testid="${afterAcceptTarget}"]`;
        dispatchElementClick(el, selector);
      }, 1200);
    });
  }
})();
