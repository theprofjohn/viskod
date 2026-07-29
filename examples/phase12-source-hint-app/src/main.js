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

  console.error('VISKOD_SOURCE_HINT_ERROR: fake api key sk_test_sourcehint_abc123 should be redacted');

  fetch('/api/source-hint/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'hint-validation' }),
  }).catch((err) => {
    console.error('VISKOD_SOURCE_FETCH_FAILED: POST /api/source-hint/submit failed — ' + err.message);
    addLog('Network request failed (expected fixture behaviour)');
  });

  document.getElementById('phase12-source-submit-button')?.addEventListener('click', () => {
    console.error('VISKOD_SOURCE_HINT_ERROR: fake api key sk_test_sourcehint_abc123');
    addLog('Submit clicked at ' + new Date().toLocaleTimeString());
  });
})();
