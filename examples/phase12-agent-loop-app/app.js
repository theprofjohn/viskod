// Phase 12B Agent Loop — client-side app logic

(() => {
  // Log page load
  const log = document.getElementById('activity-log');

  function addLog(message) {
    const p = document.createElement('p');
    p.className = 'log-entry';
    p.textContent = message;
    log.appendChild(p);
  }

  // Simulate a failed network request
  fetch('/api/phase12/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating: 'excellent' }),
  }).catch((err) => {
    console.error(`VISKOD_FETCH_FAILED: POST /api/phase12/submit failed — ${err.message}`);
    addLog('Network request failed (expected for this fixture)');
  });

  // Submit button handler with a deliberate console error for dogfooding
  document.getElementById('phase12-submit-button').addEventListener('click', () => {
    // This intentional console.error should appear in debug/audit evidence
    console.error('VISKOD_SMOKE_ERROR: fake api key sk_test_phase12_abc123 should be redacted');

    addLog(`Submit clicked at ${new Date().toLocaleTimeString()}`);
  });

  // Additional immediate console error for evidence capture
  console.error('VISKOD_SMOKE_ERROR: app initialized with placeholder data');

  addLog('App initialized');
})();
