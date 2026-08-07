import type { StudioWorkflowState } from './workflow';

export interface StudioUiState extends StudioWorkflowState {
  browserConnected?: boolean;
  pageUrl?: string;
}

function escapeHtml(value: string | undefined): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function selectionSummaryHtml(state: StudioWorkflowState): string {
  const selection = state.selection;
  if (!selection) return '';
  const label = selection.label ?? selection.textPreview ?? 'Selected element';
  const role = selection.role ? ` · ${selection.role}` : '';
  const count = selection.targetCount > 1 ? ` (${selection.targetCount} elements)` : '';
  return `<div class="target-summary">Selected: <strong>${escapeHtml(label)}</strong>${escapeHtml(role)}${escapeHtml(count)}</div>`;
}

/**
 * Plain-language comparison status. A changed screenshot is evidence, not
 * truth: the human always decides.
 */
export function comparisonMessage(state: StudioWorkflowState): string {
  const comparison = state.review?.comparison;
  if (!comparison) return 'No comparison is available yet.';
  switch (comparison.status) {
    case 'changed':
      return 'The rendered result changed; review whether it matches the expected result.';
    case 'unchanged':
      return 'No measurable change detected.';
    default:
      // missing/ambiguous/stale/capture-failed — use the service recovery wording
      return comparison.summary || 'The comparison could not be completed.';
  }
}

function evidenceDetailsHtml(state: StudioWorkflowState): string {
  const review = state.review;
  if (!review) return '';
  const comparison = review.comparison;
  const sourceHintLabel = (): string => {
    const count = review.before.targetSummary.confidence ?? 0;
    if (count > 0.8) return 'Source hints: high confidence';
    if (count > 0.5) return 'Source hints: medium confidence';
    return 'Source hints: low confidence';
  };
  const before = review.before;
  const after = review.after;
  const rows = [
    `<li>Before: captured ${escapeHtml(new Date(before.capturedAt).toLocaleString())}</li>`,
  ];
  if (after) {
    rows.push(
      `<li>After: captured ${escapeHtml(new Date(after.capturedAt).toLocaleString())}</li>`,
    );
  }
  rows.push(`<li>${sourceHintLabel()}</li>`);
  if (comparison) {
    rows.push(
      `<li>Confidence: ${Math.round((comparison.confidence ?? 0) * 100)}%</li>`,
      `<li>${escapeHtml(comparison.summary)}</li>`,
    );
  }
  return `<details class="evidence-details"><summary>Evidence details</summary><ul>${rows.join('')}</ul></details>`;
}

function screenHtml(state: StudioWorkflowState, browserConnected: boolean): string {
  const disconnected =
    !browserConnected &&
    state.stage !== 'idle' &&
    'Browser disconnected — reconnect or reopen the app';

  switch (state.stage) {
    case 'idle':
      return `
        <section class="screen" data-stage="idle">
          <h2>Open your app</h2>
          <form id="open-app-form" data-action="open-app">
            <input id="app-url" type="url" placeholder="http://localhost:3000" aria-label="App URL" />
            <button type="submit" class="primary">Open app</button>
          </form>
          ${state.pageUrl ? `<p class="hint">Current app: ${escapeHtml(state.pageUrl)}</p>` : '<p class="hint">Start your local app, then open it here.</p>'}
          ${state.pageUrl ? '<button id="report-start" class="primary" data-action="report-start">Report UI issue</button>' : ''}
          ${disconnected ? `<p class="warning">${disconnected}</p>` : ''}
        </section>`;

    case 'selecting':
      return `
        <section class="screen" data-stage="selecting">
          <h2>Report UI issue</h2>
          <p class="hint">Hover over the problem and click it</p>
          ${selectionSummaryHtml(state)}
          <button id="selection-accept" class="primary" data-action="selection-accept" ${state.selection ? '' : 'disabled'}>Continue</button>
          ${state.error ? `<p class="warning">${escapeHtml(state.error)}</p>` : ''}
          ${disconnected ? `<p class="warning">${disconnected}</p>` : ''}
        </section>`;

    case 'describe':
      return `
        <section class="screen" data-stage="describe">
          <h2>Describe the problem</h2>
          ${selectionSummaryHtml(state)}
          <form id="issue-form" data-action="create-issue">
            <label for="problem">What is wrong?</label>
            <textarea id="problem" name="problem" required placeholder="Describe what you see"></textarea>
            <label for="expected">What should happen?</label>
            <textarea id="expected" name="expected" required placeholder="Describe the expected result"></textarea>
            <label for="severity">Severity</label>
            <select id="severity" name="severity">
              <option value="low">Low</option>
              <option value="medium" selected>Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
            <button type="submit" class="primary" data-action="create-issue">Prepare agent handoff</button>
          </form>
          ${state.error ? `<p class="warning">${escapeHtml(state.error)}</p>` : ''}
          ${disconnected ? `<p class="warning">${disconnected}</p>` : ''}
        </section>`;

    case 'handoff_ready': {
      const handoff = state.handoff;
      const prompt = handoff
        ? `Fix the Viskod UI issue "${handoff.title}" (handoff ${handoff.handoffId}). Fetch the issue context through Viskod MCP.`
        : `Viskod handoff ${state.handoffId ?? ''} is ready for your coding agent.`;
      return `
        <section class="screen" data-stage="handoff_ready">
          <h2>Handoff ready</h2>
          <p>Give this to your coding agent:</p>
          <input id="handoff-prompt" readonly value="${escapeHtml(prompt)}" aria-label="Agent prompt" />
          <button class="secondary" data-action="copy-handoff">Copy</button>
          <p class="hint">Handoff ID: ${escapeHtml(state.handoffId ?? '')}</p>
          ${handoff && handoff.whatAgentReceives.length > 0 ? `<ul class="receives">${handoff.whatAgentReceives.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` : ''}
          ${state.error ? `<p class="warning">${escapeHtml(state.error)}</p>` : ''}
          <button class="primary" data-action="verify-start">Verify fix</button>
          ${disconnected ? `<p class="warning">${disconnected}</p>` : ''}
        </section>`;
    }

    case 'verifying':
      return `
        <section class="screen" data-stage="verifying">
          <h2>Verify fix</h2>
          <p class="hint">Reloading the page and recapturing the selected element…</p>
          ${state.error ? `<p class="warning">${escapeHtml(state.error)}</p>` : ''}
          <button class="primary" data-action="verify-recapture">Verify the fix now</button>
          ${disconnected ? `<p class="warning">${disconnected}</p>` : ''}
        </section>`;

    case 'review_ready':
      return `
        <section class="screen" data-stage="review_ready">
          <h2>Verify fix</h2>
          <div class="comparison-status">${escapeHtml(comparisonMessage(state))}</div>
          ${state.error ? `<p class="warning">${escapeHtml(state.error)}</p>` : ''}
          ${state.review?.comparison?.warnings?.length ? `<p class="warning">${state.review.comparison.warnings.map(escapeHtml).join(' ')}</p>` : ''}
          ${evidenceDetailsHtml(state)}
          <div class="actions">
            <button class="primary" data-action="decision-accepted">Accept fix</button>
            <button class="secondary" data-action="decision-rejected">Issue persists</button>
            <button class="secondary" data-action="decision-needs_follow_up">Needs follow-up</button>
          </div>
          ${disconnected ? `<p class="warning">${disconnected}</p>` : ''}
        </section>`;

    case 'decided': {
      const decision = state.review?.decision?.decision;
      const message =
        decision === 'accepted'
          ? 'Review accepted — the issue appears to be addressed.'
          : decision === 'rejected'
            ? 'Review rejected — the issue persists.'
            : decision === 'needs_follow_up'
              ? 'Review marked as needing follow-up.'
              : 'Decision recorded.';
      return `
        <section class="screen" data-stage="decided">
          <h2>${escapeHtml(message)}</h2>
          ${state.review?.comparison ? `<div class="comparison-status">${escapeHtml(comparisonMessage(state))}</div>` : ''}
          <button class="secondary" data-action="report-start">Report another issue</button>
          ${disconnected ? `<p class="warning">${disconnected}</p>` : ''}
        </section>`;
    }

    default:
      return `<section class="screen"><p>Loading…</p></section>`;
  }
}

/**
 * State-to-screen mapping used by the Studio UI. Tests assert the mapping
 * and its plain-language messages directly.
 */
export function renderScreen(state: StudioUiState): string {
  return screenHtml(state, state.browserConnected ?? true);
}

/**
 * Framework-free Studio HTML document: inline CSS + browser JavaScript.
 * No React/Vite/new frontend dependency for this first workflow.
 */
export function renderStudioHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Viskod Studio</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; background: #f6f7f9; color: #1a1a2e; }
  header { background: #1a1a2e; color: #fff; padding: 14px 24px; display: flex; align-items: center; gap: 12px; }
  header h1 { font-size: 16px; margin: 0; font-weight: 600; }
  header .stage-pill { background: rgba(255,255,255,0.15); border-radius: 999px; padding: 3px 10px; font-size: 12px; }
  main { max-width: 720px; margin: 0 auto; padding: 24px; }
  .screen { background: #fff; border: 1px solid #e2e4ea; border-radius: 10px; padding: 24px; }
  .screen h2 { margin: 0 0 12px; font-size: 18px; }
  .hint { color: #667; font-size: 14px; }
  .warning { background: #fff4e5; border: 1px solid #f0c36d; color: #7a4d00; border-radius: 6px; padding: 8px 12px; font-size: 13px; }
  .target-summary { background: #eef4ff; border-radius: 6px; padding: 10px 14px; margin: 12px 0; font-size: 14px; }
  .comparison-status { background: #eef4ff; border: 1px solid #c9d9f7; border-radius: 6px; padding: 12px 14px; margin: 12px 0; font-size: 15px; }
  label { display: block; margin: 12px 0 4px; font-size: 13px; font-weight: 600; }
  textarea, input[type="url"], input[readonly], select { width: 100%; padding: 9px 11px; border: 1px solid #c9cdd6; border-radius: 6px; font: inherit; }
  textarea { min-height: 76px; resize: vertical; }
  button { margin-top: 12px; padding: 9px 18px; border-radius: 6px; border: 1px solid #c9cdd6; background: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
  button.primary:disabled { opacity: 0.5; cursor: not-allowed; }
  button.secondary { background: #fff; }
  .actions { display: flex; gap: 10px; flex-wrap: wrap; }
  .receives { font-size: 13px; color: #445; padding-left: 18px; }
  .evidence-details { margin-top: 14px; font-size: 13px; color: #445; }
  .evidence-details summary { cursor: pointer; font-weight: 600; }
</style>
</head>
<body>
<header>
  <h1>Viskod Studio</h1>
  <span class="stage-pill" id="stage-pill">Report</span>
</header>
<main id="app">
  <section class="screen"><p>Loading…</p></section>
</main>
<script>
(function () {
  var current = { stage: 'idle', selection: null };
  var browserConnected = false;
  var pageUrl = null;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function selectionSummary(state) {
    if (!state.selection) return '';
    var label = state.selection.label || state.selection.textPreview || 'Selected element';
    var role = state.selection.role ? ' \u00B7 ' + state.selection.role : '';
    var count = state.selection.targetCount > 1 ? ' (' + state.selection.targetCount + ' elements)' : '';
    return '<div class="target-summary">Selected: <strong>' + esc(label) + '</strong>' + esc(role) + esc(count) + '</div>';
  }

  function comparisonMessage(state) {
    var comparison = state.review && state.review.comparison;
    if (!comparison) return 'No comparison is available yet.';
    if (comparison.status === 'changed') return 'The rendered result changed; review whether it matches the expected result.';
    if (comparison.status === 'unchanged') return 'No measurable change detected.';
    return comparison.summary || 'The comparison could not be completed.';
  }

  function evidenceDetails(state) {
    var review = state.review;
    if (!review) return '';
    var rows = ['<li>Before: captured ' + esc(new Date(review.before.capturedAt).toLocaleString()) + '</li>'];
    if (review.after) rows.push('<li>After: captured ' + esc(new Date(review.after.capturedAt).toLocaleString()) + '</li>');
    var conf = review.before.targetSummary.confidence || 0;
    rows.push('<li>' + (conf > 0.8 ? 'Source hints: high confidence' : conf > 0.5 ? 'Source hints: medium confidence' : 'Source hints: low confidence') + '</li>');
    if (review.comparison) {
      rows.push('<li>Confidence: ' + Math.round((review.comparison.confidence || 0) * 100) + '%</li>');
      rows.push('<li>' + esc(review.comparison.summary) + '</li>');
    }
    return '<details class="evidence-details"><summary>Evidence details</summary><ul>' + rows.join('') + '</ul></details>';
  }

  function render(state, connected) {
    current = state || { stage: 'idle', selection: null };
    browserConnected = !!connected;
    var html = '';
    var disconnected = !browserConnected && state && state.stage !== 'idle' ? '<p class="warning">Browser disconnected \u2014 reconnect or reopen the app</p>' : '';

    if (state.stage === 'idle') {
      html = '<section class="screen" data-stage="idle"><h2>Open your app</h2>' +
        '<form id="open-app-form" data-action="open-app"><input id="app-url" type="url" placeholder="http://localhost:3000" aria-label="App URL" /><button type="submit" class="primary">Open app</button></form>' +
        (pageUrl ? '<p class="hint">Current app: ' + esc(pageUrl) + '</p>' : '<p class="hint">Start your local app, then open it here.</p>') +
        (pageUrl ? '<button id="report-start" class="primary" data-action="report-start">Report UI issue</button>' : '') +
        (state.error ? '<p class="warning">' + esc(state.error) + '</p>' : '') + disconnected + '</section>';
    } else if (state.stage === 'selecting') {
      html = '<section class="screen" data-stage="selecting"><h2>Report UI issue</h2>' +
        '<p class="hint">Hover over the problem and click it</p>' + selectionSummary(state) +
        '<button id="selection-accept" class="primary" data-action="selection-accept"' + (state.selection ? '' : ' disabled') + '>Continue</button>' +
        (state.error ? '<p class="warning">' + esc(state.error) + '</p>' : '') + disconnected + '</section>';
    } else if (state.stage === 'describe') {
      html = '<section class="screen" data-stage="describe"><h2>Describe the problem</h2>' + selectionSummary(state) +
        '<form id="issue-form" data-action="create-issue">' +
        '<label for="problem">What is wrong?</label><textarea id="problem" name="problem" required placeholder="Describe what you see"></textarea>' +
        '<label for="expected">What should happen?</label><textarea id="expected" name="expected" required placeholder="Describe the expected result"></textarea>' +
        '<label for="severity">Severity</label><select id="severity" name="severity"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option><option value="critical">Critical</option></select>' +
        '<button type="submit" class="primary">Prepare agent handoff</button></form>' +
        (state.error ? '<p class="warning">' + esc(state.error) + '</p>' : '') + disconnected + '</section>';
    } else if (state.stage === 'handoff_ready') {
      var prompt = state.handoff ? 'Fix the Viskod UI issue "' + state.handoff.title + '" (handoff ' + state.handoff.handoffId + '). Fetch the issue context through Viskod MCP.' : 'Viskod handoff ' + (state.handoffId || '') + ' is ready for your coding agent.';
      var receives = state.handoff && state.handoff.whatAgentReceives.length ? '<ul class="receives">' + state.handoff.whatAgentReceives.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>' : '';
      html = '<section class="screen" data-stage="handoff_ready"><h2>Handoff ready</h2>' +
        '<p>Give this to your coding agent:</p>' +
        '<input id="handoff-prompt" readonly value="' + esc(prompt) + '" aria-label="Agent prompt" />' +
        '<button class="secondary" data-action="copy-handoff">Copy</button>' +
        '<p class="hint">Handoff ID: ' + esc(state.handoffId || '') + '</p>' + receives +
        (state.error ? '<p class="warning">' + esc(state.error) + '</p>' : '') +
        '<button class="primary" data-action="verify-start">Verify fix</button>' + disconnected + '</section>';
    } else if (state.stage === 'verifying') {
      html = '<section class="screen" data-stage="verifying"><h2>Verify fix</h2>' +
        '<p class="hint">Reloading the page and recapturing the selected element\u2026</p>' +
        (state.error ? '<p class="warning">' + esc(state.error) + '</p>' : '') +
        '<button class="primary" data-action="verify-recapture">Verify the fix now</button>' + disconnected + '</section>';
    } else if (state.stage === 'review_ready') {
      var warnings = (state.review && state.review.comparison && state.review.comparison.warnings && state.review.comparison.warnings.length) ? '<p class="warning">' + state.review.comparison.warnings.map(esc).join(' ') + '</p>' : '';
      html = '<section class="screen" data-stage="review_ready"><h2>Verify fix</h2>' +
        '<div class="comparison-status">' + esc(comparisonMessage(state)) + '</div>' +
        (state.error ? '<p class="warning">' + esc(state.error) + '</p>' : '') + warnings + evidenceDetails(state) +
        '<div class="actions">' +
        '<button class="primary" data-action="decision-accepted">Accept fix</button>' +
        '<button class="secondary" data-action="decision-rejected">Issue persists</button>' +
        '<button class="secondary" data-action="decision-needs_follow_up">Needs follow-up</button>' +
        '</div>' + disconnected + '</section>';
    } else if (state.stage === 'decided') {
      var decision = state.review && state.review.decision ? state.review.decision.decision : null;
      var message = decision === 'accepted' ? 'Review accepted \u2014 the issue appears to be addressed.' : decision === 'rejected' ? 'Review rejected \u2014 the issue persists.' : decision === 'needs_follow_up' ? 'Review marked as needing follow-up.' : 'Decision recorded.';
      html = '<section class="screen" data-stage="decided"><h2>' + esc(message) + '</h2>' +
        (state.review && state.review.comparison ? '<div class="comparison-status">' + esc(comparisonMessage(state)) + '</div>' : '') +
        '<button class="secondary" data-action="report-start">Report another issue</button>' + disconnected + '</section>';
    } else {
      html = '<section class="screen"><p>Loading\u2026</p></section>';
    }

    document.getElementById('app').innerHTML = html;
    document.getElementById('stage-pill').textContent = stageLabel(state.stage);
  }

  function stageLabel(stage) {
    var labels = { idle: 'Report', selecting: 'Report', describe: 'Prepare for agent', handoff_ready: 'Prepare for agent', verifying: 'Verify', review_ready: 'Verify', decided: 'Verify' };
    return labels[stage] || 'Report';
  }

  async function post(url, body) {
    var res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  async function refresh() {
    try {
      var res = await fetch('/state');
      var state = await res.json();
      pageUrl = state.pageUrl || null;
      render(state.workflow, state.browserConnected);
    } catch (e) {
      render({ stage: 'idle', selection: null, error: 'Studio backend unavailable.' }, false);
    }
  }

  document.getElementById('app').addEventListener('click', async function (event) {
    var target = event.target;
    while (target && target !== document.body) {
      var action = target.getAttribute && target.getAttribute('data-action');
      if (action) break;
      target = target.parentElement;
    }
    if (!target || !action) return;
    try {
      if (action === 'open-app') return;
      if (action === 'report-start') {
        await post('/workflow/report/start', {});
        await refresh();
      } else if (action === 'selection-accept') {
        await post('/workflow/selection/accept', {});
        await refresh();
      } else if (action === 'verify-start') {
        await post('/workflow/verify/start', { issueId: current.issueId, handoffId: current.handoffId });
        await refresh();
      } else if (action === 'verify-recapture') {
        await post('/workflow/verify/recapture', { reviewId: current.reviewId });
        await refresh();
      } else if (action === 'copy-handoff') {
        var input = document.getElementById('handoff-prompt');
        if (input) { input.select(); try { document.execCommand('copy'); } catch (e) {} }
      } else if (action.indexOf('decision-') === 0) {
        var decision = action.slice('decision-'.length);
        var note = '';
        await post('/workflow/decision', { reviewId: current.reviewId, decision: decision, note: note });
        await refresh();
      }
    } catch (e) {
      current.error = e.message;
      render(current, browserConnected);
    }
  });

  document.getElementById('app').addEventListener('submit', async function (event) {
    event.preventDefault();
    var form = event.target;
    var action = form.getAttribute('data-action');
    try {
      if (action === 'open-app') {
        var urlInput = document.getElementById('app-url');
        var url = urlInput ? urlInput.value.trim() : '';
        if (!url) return;
        await post('/navigate', { url: url });
        pageUrl = url;
        await refresh();
      } else if (action === 'create-issue') {
        var problem = document.getElementById('problem').value.trim();
        var expected = document.getElementById('expected').value.trim();
        var severity = document.getElementById('severity').value;
        await post('/workflow/issue', { problem: problem, expected: expected, severity: severity });
        await refresh();
      }
    } catch (e) {
      current.error = e.message;
      render(current, browserConnected);
    }
  });

  var ws = null;
  function connect() {
    try {
      ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
      ws.onmessage = function (event) {
        try {
          var msg = JSON.parse(event.data);
          if (msg.type === 'studio:state') {
            pageUrl = msg.state.pageUrl || pageUrl;
            render(msg.state.workflow, msg.state.browserConnected);
          }
        } catch (e) {}
      };
      ws.onclose = function () { setTimeout(connect, 2000); };
    } catch (e) {}
  }
  connect();
  refresh();
})();
</script>
</body>
</html>`;
}
