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
 * Phase 30/30A: truthful source-resolution wording.
 *
 * Resolution answers "can Viskod distinguish one candidate from
 * alternatives?"; qualification answers "how strong is the evidence for THIS
 * candidate?". A resolved result is therefore worded from the top candidate's
 * qualification — a `possible` candidate is NEVER labeled probable. The same
 * wording is used by the compact status panel and the review screen's
 * evidence details (mirrored in the client-side JS below).
 */
export function sourceResolutionLabel(source: {
  resolution: 'resolved' | 'ambiguous' | 'unavailable';
  candidates: Array<{ qualification?: string }>;
}): string {
  if (!source) return '';
  if (source.resolution === 'ambiguous') return 'Source: ambiguous — multiple candidates';
  if (source.resolution === 'unavailable') return 'Source: unavailable';
  switch (source.candidates[0]?.qualification) {
    case 'exact':
      return 'Source: exact source identified';
    case 'probable':
      return 'Source: probable source';
    case 'possible':
      return 'Source: possible source';
    case 'weak':
      // Phase 30 normally resolves single weak candidates as unavailable; a
      // weak candidate in a legitimate resolved context must not be promoted.
      return 'Source: weak source evidence';
    default:
      return 'Source: unavailable';
  }
}

/**
 * Compact Phase 30 source-resolution panel. Ambiguity is presented as
 * ambiguity — the first candidate is NEVER shown as confirmed. Paths are
 * repository-relative. The label is derived from the top candidate's
 * qualification (see `sourceResolutionLabel`).
 */
export function sourceStatusHtml(state: StudioWorkflowState): string {
  const source = state.source;
  if (!source) return '';
  const label = sourceResolutionLabel(source);
  const lines = [`<div class="source-status" data-source-resolution="${source.resolution}">`];
  lines.push(`<strong>${escapeHtml(label)}</strong>`);
  if (source.candidates.length > 0) {
    lines.push('<ul>');
    for (const c of source.candidates.slice(0, 3)) {
      lines.push(
        `<li><code>${escapeHtml(c.path)}</code> · ${escapeHtml(c.qualification)} · ${Math.round(c.confidence * 100)}%</li>`,
      );
    }
    if (source.candidates.length > 3) {
      lines.push(`<li>+${source.candidates.length - 3} more</li>`);
    }
    lines.push('</ul>');
  } else if (source.resolution === 'unavailable') {
    lines.push('<p class="hint">Source resolution was not available for this capture.</p>');
  }
  lines.push('</div>');
  return lines.join('');
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
    case 'incomparable':
    case 'visual_unavailable':
      // Phase 31: never pretend a pixel review happened.
      return (
        comparison.summary ||
        'Visual comparison unavailable — the before/after images could not be compared.'
      );
    default:
      // missing/ambiguous/stale/capture-failed — use the service recovery wording
      return comparison.summary || 'The comparison could not be completed.';
  }
}

/**
 * Phase 31: the local-sensitive visual review panel — BEFORE / AFTER / DIFF
 * rendered from opaque artifact endpoints plus the real comparison metrics.
 * The panel states "Visual comparison unavailable" truthfully when the
 * policy is disabled or the artifacts were not captured; it never fabricates
 * a pixel review.
 */
export function reviewVisualPanelHtml(state: StudioWorkflowState): string {
  const artifacts = state.review?.artifacts;
  if (!artifacts || artifacts.policy !== 'local-sensitive-target-crop') {
    return `<div class="review-visual" data-visual-status="unavailable"><p class="hint">Visual comparison unavailable — local visual review is disabled.</p></div>`;
  }
  const ac = artifacts.comparison;
  const before = artifacts.before;
  const after = artifacts.after;
  const diff = artifacts.diff;

  const image = (entry: { artifactId?: string; status?: string } | undefined, alt: string) =>
    entry && entry.status === 'collected' && entry.artifactId
      ? `<img src="/review/artifact/${encodeURIComponent(entry.artifactId)}" alt="${escapeHtml(alt)}" loading="lazy" />`
      : `<div class="review-image-missing">${entry?.status === 'failed' ? 'Capture failed' : 'Not captured'}</div>`;

  const ratio = ac?.changedPixelRatio;
  const geometry = ac?.geometry;
  const metrics: string[] = [];
  if (ratio !== undefined) metrics.push(`Changed pixels: ${(ratio * 100).toFixed(2)}%`);
  if (ac?.changedPixels !== undefined && ac?.totalPixels !== undefined) {
    metrics.push(`${ac.changedPixels} of ${ac.totalPixels} comparable pixels`);
  }
  if (geometry) {
    metrics.push(
      `Geometry: x${geometry.xDelta ?? 0} y${geometry.yDelta ?? 0} w${geometry.widthDelta ?? 0} h${geometry.heightDelta ?? 0}`,
    );
  }
  if (ac?.viewportCompatible === false) metrics.push('Viewport/DPR mismatch between captures');
  if (ac?.reason) metrics.push(ac.reason);

  const panel = [
    `<div class="review-visual" data-visual-status="${escapeHtml(ac?.status ?? 'unavailable')}">`,
    `<div class="review-visual-status"><strong>${escapeHtml(ac?.status === 'changed' ? 'Visual change detected' : ac?.status === 'unchanged' ? 'Visually unchanged' : ac?.status === 'incomparable' ? 'Visual comparison incomparable' : 'Visual comparison unavailable')}</strong></div>`,
  ];
  if (metrics.length > 0) {
    panel.push(
      `<ul class="review-metrics">${metrics.map((m) => `<li>${escapeHtml(m)}</li>`).join('')}</ul>`,
    );
  }
  if (before || after) {
    panel.push(
      '<div class="review-images">',
      `<figure class="review-image-card"><figcaption>BEFORE</figcaption>${image(before, 'Before capture')}</figure>`,
      `<figure class="review-image-card"><figcaption>AFTER</figcaption>${image(after, 'After capture')}</figure>`,
      diff && diff.status === 'collected'
        ? `<figure class="review-image-card"><figcaption>DIFF</figcaption>${image(diff, 'Visual difference')}</figure>`
        : '',
      '</div>',
    );
  }
  panel.push('</div>');
  return panel.join('');
}

/**
 * Phase 31: one-time consent banner for local-sensitive visual review
 * artifacts. Shown only when the user has not answered yet; after the first
 * answer it never appears again in the normal report flow.
 */
export function visualReviewBannerHtml(state: StudioWorkflowState): string {
  if (state.visualReviewPolicyAsked) return '';
  if (state.visualReviewPolicy === 'local-sensitive-target-crop') return '';
  return `
    <div class="policy-banner" data-action="policy-banner">
      <p><strong>Local visual review</strong> — Viskod will store a screenshot of the selected element on this machine so you can compare before/after your fix. Screenshots may contain visible sensitive information; they stay local and are <em>not</em> included in agent handoff context.</p>
      <div class="actions">
        <button class="primary" data-action="policy-enable">Enable local visual review</button>
        <button class="secondary" data-action="policy-disable">Keep disabled</button>
      </div>
    </div>`;
}

function evidenceDetailsHtml(state: StudioWorkflowState): string {
  const review = state.review;
  if (!review) return '';
  const comparison = review.comparison;
  // Phase 30A: the obsolete "Source hints: high/medium/low confidence"
  // mapping displayed the TARGET-resolution confidence under source-hint
  // semantics — a `possible` source candidate could read as "medium/high".
  // The review panel now reports the actual Phase 30 source status from the
  // captured packet (same wording as the compact status panel). When the
  // capture carried no source status there is nothing to claim.
  const sourceLabel = state.source ? sourceResolutionLabel(state.source) : null;
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
  if (sourceLabel) rows.push(`<li>${sourceLabel}</li>`);
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
          ${visualReviewBannerHtml(state)}
          ${selectionSummaryHtml(state)}
          <div class="actions">
            <button id="selection-accept" class="primary" data-action="selection-accept" ${state.selection ? '' : 'disabled'}>Continue</button>
            <button class="secondary" data-action="cancel">Cancel</button>
          </div>
          ${state.error ? `<p class="warning">${escapeHtml(state.error)}</p>` : ''}
          ${disconnected ? `<p class="warning">${disconnected}</p>` : ''}
        </section>`;

    case 'describe':
      return `
        <section class="screen" data-stage="describe">
          <h2>Describe the problem</h2>
          ${selectionSummaryHtml(state)}
          ${visualReviewBannerHtml(state)}
          ${sourceStatusHtml(state)}
          <form id="issue-form" data-action="prepare-handoff">
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
            <button type="submit" class="primary" data-action="prepare-handoff">Prepare agent handoff</button>
          </form>
          <div class="actions">
            <button class="secondary" data-action="reselect">Reselect</button>
            <button class="secondary" data-action="cancel">Cancel</button>
          </div>
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
          ${visualReviewBannerHtml(state)}
          ${sourceStatusHtml(state)}
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
          ${visualReviewBannerHtml(state)}
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
          ${reviewVisualPanelHtml(state)}
          ${evidenceDetailsHtml(state)}
          <label for="decision-note">Decision note (optional)</label>
          <textarea id="decision-note" placeholder="Why did you accept or reject this change?"></textarea>
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
      const note = state.review?.decision?.note;
      return `
        <section class="screen" data-stage="decided">
          <h2>${escapeHtml(message)}</h2>
          ${state.review?.comparison ? `<div class="comparison-status">${escapeHtml(comparisonMessage(state))}</div>` : ''}
          ${reviewVisualPanelHtml(state)}
          ${note ? `<p class="hint">Note: ${escapeHtml(note)}</p>` : ''}
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
  .source-status { background: #f4f7fb; border: 1px solid #dde3ee; border-radius: 6px; padding: 10px 14px; margin: 12px 0; font-size: 13px; }
  .source-status ul { margin: 6px 0 0; padding-left: 18px; }
  .source-status code { background: #e8edf5; border-radius: 3px; padding: 1px 5px; font-size: 12px; }
  .source-status[data-source-resolution="ambiguous"] { border-color: #f0c36d; background: #fff8ec; }
  .source-status[data-source-resolution="unavailable"] { border-color: #e2e4ea; background: #fafbfc; }
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
  .policy-banner { background: #fff8ec; border: 1px solid #f0c36d; border-radius: 6px; padding: 10px 14px; margin: 12px 0; font-size: 13px; }
  .policy-banner p { margin: 0 0 4px; }
  .review-visual { margin: 14px 0; border: 1px solid #dde3ee; border-radius: 8px; padding: 12px; background: #fafbfd; }
  .review-visual[data-visual-status="changed"] { border-color: #f0c36d; background: #fffdf6; }
  .review-visual[data-visual-status="unchanged"] { border-color: #cfe3cf; background: #f7fbf7; }
  .review-visual-status { font-size: 14px; margin-bottom: 6px; }
  .review-metrics { font-size: 12px; color: #445; margin: 4px 0 10px; padding-left: 18px; }
  .review-images { display: flex; gap: 12px; flex-wrap: wrap; }
  .review-image-card { margin: 0; flex: 1 1 200px; min-width: 180px; }
  .review-image-card figcaption { font-size: 11px; font-weight: 700; color: #667; letter-spacing: 0.08em; margin-bottom: 4px; }
  .review-image-card img { width: 100%; border: 1px solid #dde3ee; border-radius: 6px; background: #fff; image-rendering: pixelated; }
  .review-image-missing { border: 1px dashed #c9cdd6; border-radius: 6px; padding: 24px 8px; text-align: center; color: #889; font-size: 12px; }
  #decision-note { min-height: 52px; }
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
  // Description form state survives re-renders (handoff failure, reselect)
  // so the user never loses their entered text (VISKOD-AUDIT-001 retry).
  var form = { problem: '', expected: '', severity: 'medium' };
  var pending = false;

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

  // Phase 30A: wording mirrors the server-side sourceResolutionLabel() —
  // a resolved result is worded from the top candidate's qualification, so a
  // "possible" candidate is never labeled probable.
  function sourceResolutionLabel(source) {
    if (!source) return '';
    if (source.resolution === 'ambiguous') return 'Source: ambiguous \u2014 multiple candidates';
    if (source.resolution === 'unavailable') return 'Source: unavailable';
    switch (source.candidates && source.candidates[0] && source.candidates[0].qualification) {
      case 'exact': return 'Source: exact source identified';
      case 'probable': return 'Source: probable source';
      case 'possible': return 'Source: possible source';
      case 'weak': return 'Source: weak source evidence';
      default: return 'Source: unavailable';
    }
  }

  function sourceStatus(state) {
    var source = state.source;
    if (!source) return '';
    var label = sourceResolutionLabel(source);
    var html = '<div class="source-status" data-source-resolution="' + esc(source.resolution) + '"><strong>' + esc(label) + '</strong>';
    if (source.candidates && source.candidates.length > 0) {
      html += '<ul>';
      source.candidates.slice(0, 3).forEach(function (c) {
        html += '<li><code>' + esc(c.path) + '</code> \u00B7 ' + esc(c.qualification) + ' \u00B7 ' + Math.round((c.confidence || 0) * 100) + '%</li>';
      });
      if (source.candidates.length > 3) html += '<li>+' + (source.candidates.length - 3) + ' more</li>';
      html += '</ul>';
    } else if (source.resolution === 'unavailable') {
      html += '<p class="hint">Source resolution was not available for this capture.</p>';
    }
    html += '</div>';
    return html;
  }

  function comparisonMessage(state) {
    var comparison = state.review && state.review.comparison;
    if (!comparison) return 'No comparison is available yet.';
    if (comparison.status === 'changed') return 'The rendered result changed; review whether it matches the expected result.';
    if (comparison.status === 'unchanged') return 'No measurable change detected.';
    return comparison.summary || 'The comparison could not be completed.';
  }

  function reviewVisualPanel(state) {
    var artifacts = state.review && state.review.artifacts;
    if (!artifacts || artifacts.policy !== 'local-sensitive-target-crop') {
      return '<div class="review-visual" data-visual-status="unavailable"><p class="hint">Visual comparison unavailable \u2014 local visual review is disabled.</p></div>';
    }
    var ac = artifacts.comparison || {};
    var before = artifacts.before;
    var after = artifacts.after;
    var diff = artifacts.diff;
    function image(entry, alt) {
      if (entry && entry.status === 'collected' && entry.artifactId) {
        return '<img src="/review/artifact/' + encodeURIComponent(entry.artifactId) + '" alt="' + esc(alt) + '" loading="lazy" />';
      }
      return '<div class="review-image-missing">' + (entry && entry.status === 'failed' ? 'Capture failed' : 'Not captured') + '</div>';
    }
    var metrics = [];
    if (typeof ac.changedPixelRatio === 'number') metrics.push('Changed pixels: ' + (ac.changedPixelRatio * 100).toFixed(2) + '%');
    if (typeof ac.changedPixels === 'number' && typeof ac.totalPixels === 'number') metrics.push(ac.changedPixels + ' of ' + ac.totalPixels + ' comparable pixels');
    if (ac.geometry) metrics.push('Geometry: x' + (ac.geometry.xDelta || 0) + ' y' + (ac.geometry.yDelta || 0) + ' w' + (ac.geometry.widthDelta || 0) + ' h' + (ac.geometry.heightDelta || 0));
    if (ac.viewportCompatible === false) metrics.push('Viewport/DPR mismatch between captures');
    if (ac.reason) metrics.push(ac.reason);
    var statusText = ac.status === 'changed' ? 'Visual change detected' : ac.status === 'unchanged' ? 'Visually unchanged' : ac.status === 'incomparable' ? 'Visual comparison incomparable' : 'Visual comparison unavailable';
    var html = '<div class="review-visual" data-visual-status="' + esc(ac.status || 'unavailable') + '"><div class="review-visual-status"><strong>' + esc(statusText) + '</strong></div>';
    if (metrics.length) html += '<ul class="review-metrics">' + metrics.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>';
    if (before || after) {
      html += '<div class="review-images">' +
        '<figure class="review-image-card"><figcaption>BEFORE</figcaption>' + image(before, 'Before capture') + '</figure>' +
        '<figure class="review-image-card"><figcaption>AFTER</figcaption>' + image(after, 'After capture') + '</figure>' +
        (diff && diff.status === 'collected' ? '<figure class="review-image-card"><figcaption>DIFF</figcaption>' + image(diff, 'Visual difference') + '</figure>' : '') +
        '</div>';
    }
    html += '</div>';
    return html;
  }

  function policyBanner(state) {
    if (state.visualReviewPolicyAsked) return '';
    if (state.visualReviewPolicy === 'local-sensitive-target-crop') return '';
    return '<div class="policy-banner"><p><strong>Local visual review</strong> \u2014 Viskod will store a screenshot of the selected element on this machine so you can compare before/after your fix. Screenshots may contain visible sensitive information; they stay local and are <em>not</em> included in agent handoff context.</p>' +
      '<div class="actions">' +
      '<button class="primary" data-action="policy-enable">Enable local visual review</button>' +
      '<button class="secondary" data-action="policy-disable">Keep disabled</button>' +
      '</div></div>';
  }

  function evidenceDetails(state) {
    var review = state.review;
    if (!review) return '';
    var rows = ['<li>Before: captured ' + esc(new Date(review.before.capturedAt).toLocaleString()) + '</li>'];
    if (review.after) rows.push('<li>After: captured ' + esc(new Date(review.after.capturedAt).toLocaleString()) + '</li>');
    // Phase 30A: the obsolete "Source hints: high/medium/low confidence"
    // mapping (from TARGET-resolution confidence) is replaced with the real
    // Phase 30 source status from the captured packet.
    var sourceLabel = state.source ? sourceResolutionLabel(state.source) : null;
    if (sourceLabel) rows.push('<li>' + esc(sourceLabel) + '</li>');
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
        '<p class="hint">Hover over the problem and click it</p>' + policyBanner(state) + selectionSummary(state) +
        '<div class="actions">' +
        '<button id="selection-accept" class="primary" data-action="selection-accept"' + (state.selection ? '' : ' disabled') + '>Continue</button>' +
        '<button class="secondary" data-action="cancel">Cancel</button>' +
        '</div>' +
        (state.error ? '<p class="warning">' + esc(state.error) + '</p>' : '') + disconnected + '</section>';
    } else if (state.stage === 'describe') {
      html = '<section class="screen" data-stage="describe"><h2>Describe the problem</h2>' + selectionSummary(state) + policyBanner(state) + sourceStatus(state) +
        '<form id="issue-form" data-action="prepare-handoff">' +
        '<label for="problem">What is wrong?</label><textarea id="problem" name="problem" required placeholder="Describe what you see"></textarea>' +
        '<label for="expected">What should happen?</label><textarea id="expected" name="expected" required placeholder="Describe the expected result"></textarea>' +
        '<label for="severity">Severity</label><select id="severity" name="severity"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option><option value="critical">Critical</option></select>' +
        '<button type="submit" class="primary" data-action="prepare-handoff">Prepare agent handoff</button></form>' +
        '<div class="actions">' +
        '<button class="secondary" data-action="reselect">Reselect</button>' +
        '<button class="secondary" data-action="cancel">Cancel</button>' +
        '</div>' +
        (state.error ? '<p class="warning">' + esc(state.error) + '</p>' : '') + disconnected + '</section>';
    } else if (state.stage === 'handoff_ready') {
      var prompt = state.handoff ? 'Fix the Viskod UI issue "' + state.handoff.title + '" (handoff ' + state.handoff.handoffId + '). Fetch the issue context through Viskod MCP.' : 'Viskod handoff ' + (state.handoffId || '') + ' is ready for your coding agent.';
      var receives = state.handoff && state.handoff.whatAgentReceives.length ? '<ul class="receives">' + state.handoff.whatAgentReceives.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>' : '';
      html = '<section class="screen" data-stage="handoff_ready"><h2>Handoff ready</h2>' +
        '<p>Give this to your coding agent:</p>' +
        '<input id="handoff-prompt" readonly value="' + esc(prompt) + '" aria-label="Agent prompt" />' +
        '<button class="secondary" data-action="copy-handoff">Copy</button>' +
        '<p class="hint">Handoff ID: ' + esc(state.handoffId || '') + '</p>' + policyBanner(state) + sourceStatus(state) + receives +
        (state.error ? '<p class="warning">' + esc(state.error) + '</p>' : '') +
        '<button class="primary" data-action="verify-start">Verify fix</button>' + disconnected + '</section>';
    } else if (state.stage === 'verifying') {
      html = '<section class="screen" data-stage="verifying"><h2>Verify fix</h2>' +
        '<p class="hint">Reloading the page and recapturing the selected element\u2026</p>' + policyBanner(state) +
        (state.error ? '<p class="warning">' + esc(state.error) + '</p>' : '') +
        '<button class="primary" data-action="verify-recapture">Verify the fix now</button>' + disconnected + '</section>';
    } else if (state.stage === 'review_ready') {
      var warnings = (state.review && state.review.comparison && state.review.comparison.warnings && state.review.comparison.warnings.length) ? '<p class="warning">' + state.review.comparison.warnings.map(esc).join(' ') + '</p>' : '';
      html = '<section class="screen" data-stage="review_ready"><h2>Verify fix</h2>' +
        '<div class="comparison-status">' + esc(comparisonMessage(state)) + '</div>' +
        (state.error ? '<p class="warning">' + esc(state.error) + '</p>' : '') + warnings + reviewVisualPanel(state) + evidenceDetails(state) +
        '<label for="decision-note">Decision note (optional)</label>' +
        '<textarea id="decision-note" placeholder="Why did you accept or reject this change?"></textarea>' +
        '<div class="actions">' +
        '<button class="primary" data-action="decision-accepted">Accept fix</button>' +
        '<button class="secondary" data-action="decision-rejected">Issue persists</button>' +
        '<button class="secondary" data-action="decision-needs_follow_up">Needs follow-up</button>' +
        '</div>' + disconnected + '</section>';
    } else if (state.stage === 'decided') {
      var decision = state.review && state.review.decision ? state.review.decision.decision : null;
      var note = state.review && state.review.decision ? state.review.decision.note : null;
      var message = decision === 'accepted' ? 'Review accepted \u2014 the issue appears to be addressed.' : decision === 'rejected' ? 'Review rejected \u2014 the issue persists.' : decision === 'needs_follow_up' ? 'Review marked as needing follow-up.' : 'Decision recorded.';
      html = '<section class="screen" data-stage="decided"><h2>' + esc(message) + '</h2>' +
        (state.review && state.review.comparison ? '<div class="comparison-status">' + esc(comparisonMessage(state)) + '</div>' : '') +
        reviewVisualPanel(state) +
        (note ? '<p class="hint">Note: ' + esc(note) + '</p>' : '') +
        '<button class="secondary" data-action="report-start">Report another issue</button>' + disconnected + '</section>';
    } else {
      html = '<section class="screen"><p>Loading\u2026</p></section>';
    }

    document.getElementById('app').innerHTML = html;
    document.getElementById('stage-pill').textContent = stageLabel(state.stage);

    if (state.stage === 'describe') {
      var problem = document.getElementById('problem');
      var expected = document.getElementById('expected');
      var severity = document.getElementById('severity');
      if (problem) problem.value = form.problem;
      if (expected) expected.value = form.expected;
      if (severity) severity.value = form.severity;
      var submitBtn = document.querySelector('#issue-form button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = pending;
        submitBtn.textContent = pending ? 'Preparing…' : 'Prepare agent handoff';
      }
    }
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
        // New report = clean transient boundary: never carry the previous
        // report's description into the next one.
        form = { problem: '', expected: '', severity: 'medium' };
        await post('/workflow/report/start', {});
        await refresh();
      } else if (action === 'selection-accept') {
        await post('/workflow/selection/accept', {});
        await refresh();
      } else if (action === 'reselect') {
        await post('/workflow/reselect', {});
        await refresh();
      } else if (action === 'cancel') {
        await post('/workflow/cancel', {});
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
      } else if (action === 'policy-enable' || action === 'policy-disable') {
        var policy = action === 'policy-enable' ? 'local-sensitive-target-crop' : 'disabled';
        await post('/settings/visual-review-policy', { policy: policy });
        await refresh();
      } else if (action.indexOf('decision-') === 0) {
        var decision = action.slice('decision-'.length);
        var noteEl = document.getElementById('decision-note');
        var note = noteEl ? noteEl.value.trim() : '';
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
      } else if (action === 'prepare-handoff') {
        if (pending) return;
        var problem = document.getElementById('problem').value.trim();
        var expected = document.getElementById('expected').value.trim();
        var severity = document.getElementById('severity').value;
        form = { problem: problem, expected: expected, severity: severity };
        pending = true;
        render(current, browserConnected);
        try {
          await post('/workflow/prepare', {
            problem: form.problem,
            expected: form.expected,
            severity: form.severity,
          });
        } finally {
          pending = false;
        }
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
