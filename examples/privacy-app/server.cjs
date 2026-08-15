// Phase 29 privacy E2E fixture.
// Serves synthetic sensitive material across several surfaces so the real
// browser capture path can be verified end-to-end:
//   - password input value
//   - API key-like text
//   - bearer token text
//   - credential URL query parameter (the app URL itself carries ?token=)
//   - email
//   - card-like value
//   - base64/token-like value
//   - sensitive DOM attribute (data-secret) on the selected target
//   - visible non-sensitive neighboring text that must remain useful
//
// ?viskodSimulate=click dispatches an overlay:element-clicked event for the
// target card (mirroring the Phase 28A/28B fixture mechanism) so Studio's
// selection workflow can complete without a human click.

const http = require('node:http');

const SECRETS = {
  password: 'e2e-password-9f8e7d6c',
  apiKey: 'sk_live_e2eSECRETkey000111222',
  bearer: 'Bearer e2e.bearer.token.abcdef',
  email: 'e2e.user@viskod-test.example',
  card: '4242 4242 4242 4242',
  base64: 'ZTJlLXZpc2tvZC1iYXNlNjQtc2VjcmV0LXZhbHVlPT0=',
  queryToken: 'e2e-query-token-xyz',
  secretAttr: 'e2e-secret-attribute',
  passwordAttr: 'e2e-password-attribute-value',
};

const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Phase 29 Privacy Fixture</title></head>
<body>
  <main id="app">
    <h1>Account settings</h1>
    <p class="useful-copy">Change your email address here — your current email is ${SECRETS.email}.</p>
    <section id="privacy-card" class="settings-card" data-secret="${SECRETS.secretAttr}" data-testid="privacy-target">
      <h2>Credentials</h2>
      <form>
        <label for="pwd">Password</label>
        <input id="pwd" type="password" name="password" value="${SECRETS.password}" data-password="${SECRETS.passwordAttr}" />
        <label for="api">API key</label>
        <input id="api" type="text" value="${SECRETS.apiKey}" />
        <button type="button" id="save-btn">Save changes</button>
      </form>
      <p class="token-note">Session token: ${SECRETS.bearer}</p>
      <p class="token-note">Refresh token: ${SECRETS.base64}</p>
      <p class="token-note">Billing card: ${SECRETS.card}</p>
    </section>
  </main>
<script>
  (function () {
    var pending = new URLSearchParams(location.search).get('viskodSimulate');
    if (pending !== 'click') return;
    var dispatched = false;
    window.addEventListener('message', function (event) {
      var data = event.data || {};
      if (data.source !== '__viskod_overlay' || data.type !== 'overlay:ready') return;
      if (dispatched) return;
      dispatched = true;
      setTimeout(function () {
        var el = document.getElementById('privacy-card');
        if (!el) return;
        var rect = el.getBoundingClientRect();
        window.postMessage(
          {
            source: '__viskod_overlay',
            type: 'overlay:element-clicked',
            data: {
              selector: '#privacy-card',
              tagName: 'section',
              boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              textPreview: 'Account settings — change your email here',
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

server.listen(3222, '127.0.0.1', () => {
  console.log('Phase 29 privacy fixture listening on http://127.0.0.1:3222');
});
