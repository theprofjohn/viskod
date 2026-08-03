// Viskod Chrome Extension — Content Script
// Provides the visual context companion and feature controls.
// Connects to Viskod Studio via WebSocket on localhost:3001.

(() => {
  if (window.__viskod_extension_loaded) return;
  window.__viskod_extension_loaded = true;

  const STUDIO_PORT = 3001;
  const PREFIX = '__viskod_ext_';
  const WS_URL = `ws://localhost:${STUDIO_PORT}`;
  const HTTP = `http://localhost:${STUDIO_PORT}`;
  const CURSOR_ICON =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l7.07 17 2.51-7.39L21 11.07z"/></svg>';
  const CHECK_ICON =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';

  // ── Always initialize the widget; health check only updates status ──
  init();

  function checkHealth() {
    return fetch(`${HTTP}/health`, { signal: AbortSignal.timeout(5000) })
      .then((r) => r.json())
      .catch(() => null);
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch (e) {}

    const fallback = document.createElement('textarea');
    fallback.value = text;
    fallback.setAttribute('readonly', '');
    fallback.style.position = 'fixed';
    fallback.style.opacity = '0';
    document.body.appendChild(fallback);
    fallback.select();
    const copied = document.execCommand('copy');
    fallback.remove();
    if (!copied) throw new Error('Clipboard unavailable');
  }

  function init() {
    const host = document.createElement('div');
    host.id = `${PREFIX}host`;
    host.style.cssText =
      'position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;overflow:visible!important;z-index:2147483647!important;pointer-events:none!important;isolation:isolate!important;';
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      /* ===== Design tokens — light (default) ===== */
      :host {
        --bg: #ffffff;
        --bg-elevated: #f8fafc;
        --bg-hover: #f1f5f9;
        --border: #e2e8f0;
        --border-strong: #cbd5e1;
        --text: #0f172a;
        --text-secondary: #475569;
        --text-muted: #94a3b8;
        --accent: #6366f1;
        --accent-hover: #4f46e5;
        --accent-soft: #eef2ff;
        --accent-contrast: #ffffff;
        --success: #10b981;
        --success-soft: #d1fae5;
        --success-contrast: #065f46;
        --danger: #ef4444;
        --warning: #f59e0b;
        --chat-user: #6366f1;
        --chat-user-text: #ffffff;
        --chat-agent: #f1f5f9;
        --chat-agent-text: #0f172a;
        --code-bg: #1e293b;
        --code-text: #e2e8f0;
        --shadow-sm: 0 1px 2px rgba(15,23,42,0.06), 0 1px 3px rgba(15,23,42,0.10);
        --shadow-md: 0 4px 6px -1px rgba(15,23,42,0.07), 0 2px 4px -2px rgba(15,23,42,0.05);
        --shadow-lg: 0 10px 15px -3px rgba(15,23,42,0.10), 0 4px 6px -4px rgba(15,23,42,0.05);
        --shadow-panel: 0 20px 40px -12px rgba(15,23,42,0.25), 0 8px 16px -8px rgba(15,23,42,0.12);
        --radius-sm: 6px;
        --radius-md: 10px;
         --radius-lg: 14px;
         --radius-xl: 18px;
         --space-1: 4px;
         --space-2: 8px;
         --space-3: 12px;
         --space-4: 16px;
         --space-5: 20px;
         --space-6: 24px;
        --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
        --font-mono: "SF Mono", "Fira Code", "Cascadia Code", ui-monospace, monospace;
      }
      :host([data-theme="dark"]) {
        --bg: #0f172a;
        --bg-elevated: #1e293b;
        --bg-hover: #334155;
        --border: #334155;
        --border-strong: #475569;
        --text: #f1f5f9;
        --text-secondary: #94a3b8;
        --text-muted: #64748b;
        --accent: #818cf8;
        --accent-hover: #a5b4fc;
        --accent-soft: #312e81;
        --accent-contrast: #0f172a;
        --success: #34d399;
        --success-soft: #064e3b;
        --success-contrast: #a7f3d0;
        --danger: #f87171;
        --warning: #fbbf24;
        --chat-user: #818cf8;
        --chat-user-text: #0f172a;
        --chat-agent: #1e293b;
        --chat-agent-text: #f1f5f9;
        --code-bg: #0b1120;
        --code-text: #cbd5e1;
        --shadow-sm: 0 1px 2px rgba(0,0,0,0.3), 0 1px 3px rgba(0,0,0,0.25);
        --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.3), 0 2px 4px -2px rgba(0,0,0,0.25);
        --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.4), 0 4px 6px -4px rgba(0,0,0,0.3);
        --shadow-panel: 0 20px 40px -12px rgba(0,0,0,0.6), 0 8px 16px -8px rgba(0,0,0,0.4);
      }

      * { box-sizing: border-box; margin: 0; padding: 0; font-family: var(--font); }

      /* ── Toggle button ── */
       .${PREFIX}toggle {
        position: fixed !important; bottom: 18px !important; right: 18px !important;
        z-index: 2147483647 !important;
        width: 46px; height: 46px; border-radius: 50%; border: none;
        background: linear-gradient(135deg, var(--accent), var(--accent-hover));
        color: var(--accent-contrast); cursor: pointer;
        display: flex !important; align-items: center; justify-content: center;
        box-shadow: var(--shadow-lg);
        font-size: 18px; font-weight: 700;
         transition: transform 0.15s ease, box-shadow 0.15s ease;
         pointer-events: auto;
      }
      .${PREFIX}toggle:hover { transform: translateY(-1px) scale(1.04); box-shadow: 0 14px 20px -6px rgba(15,23,42,0.35); }
      .${PREFIX}toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

      .${PREFIX}status-badge {
        position: fixed !important; bottom: 14px !important; right: 14px !important;
        z-index: 2147483647 !important;
        width: 12px; height: 12px; border-radius: 50%;
        border: 2px solid var(--bg);
        background: var(--danger);
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        pointer-events: none;
        transition: background 0.2s;
      }
      .${PREFIX}status-badge.${PREFIX}online { background: var(--success); }

      /* ── Panel ── */
      .${PREFIX}panel {
        position: fixed !important; bottom: 76px !important; right: 18px !important;
        z-index: 2147483647 !important;
         width: min(420px, calc(100vw - 32px));
         height: min(680px, calc(100dvh - 96px));
         min-height: 520px;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: var(--radius-xl);
        box-shadow: var(--shadow-panel);
        display: none !important; flex-direction: column; overflow: hidden;
         font-size: 14px; color: var(--text);
         pointer-events: auto;
        opacity: 0; transform: translateY(8px) scale(0.98);
        transition: opacity 0.18s ease, transform 0.18s ease;
      }
      .${PREFIX}panel.${PREFIX}open { display: flex !important; opacity: 1; transform: translateY(0) scale(1); }

      /* ── Header ── */
      .${PREFIX}header {
         padding: 12px 16px;
         background: linear-gradient(135deg, var(--bg-elevated), var(--bg));
         border-bottom: 1px solid var(--border);
         display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto auto;
         align-items: center; gap: 8px;
         font-weight: 600; font-size: 13px; flex-shrink: 0;
      }
      .${PREFIX}brand { display: flex; align-items: center; gap: 7px; }
      .${PREFIX}brand-mark {
        width: 22px; height: 22px; border-radius: 7px;
        background: linear-gradient(135deg, var(--accent), var(--accent-hover));
        color: var(--accent-contrast);
        display: flex; align-items: center; justify-content: center;
        font-size: 12px; font-weight: 800;
      }
      .${PREFIX}dot { width: 8px; height: 8px; border-radius: 50%; background: var(--danger); }
      .${PREFIX}dot.${PREFIX}connected { background: var(--success); }
      .${PREFIX}header-title { flex: 1; }
       .${PREFIX}header-btn {
         background: transparent; border: 1px solid var(--border); color: var(--text-secondary);
         border-radius: var(--radius-sm); padding: 7px 9px; cursor: pointer; font-size: 12px;
         display: inline-flex; align-items: center; gap: 4px; min-width: 58px; min-height: 34px;
         justify-content: center; white-space: nowrap;
        transition: background 0.15s, color 0.15s, border-color 0.15s;
      }
      .${PREFIX}header-btn:hover { background: var(--bg-hover); color: var(--text); }
      .${PREFIX}header-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
      .${PREFIX}header-btn.${PREFIX}active { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }

       .${PREFIX}view { flex: 1; min-height: 0; display: none; flex-direction: column; overflow: hidden; }
      .${PREFIX}view.${PREFIX}active { display: flex; }

      /* ── Onboarding ── */
       .${PREFIX}onboard { padding: 20px; overflow-y: auto; gap: 16px; }
       .${PREFIX}step {
         background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-lg);
         padding: 17px; display: flex; flex-direction: column; gap: 10px;
         transition: border-color 0.15s;
       }
      .${PREFIX}step:hover { border-color: var(--border-strong); }
      .${PREFIX}step-title { font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 6px; }
      .${PREFIX}step-status { margin-left: auto; font-size: 12px; font-weight: 500; }
      .${PREFIX}step-status.${PREFIX}ok { color: var(--success); }
      .${PREFIX}step-status.${PREFIX}wait { color: var(--text-muted); }
      .${PREFIX}codeblock {
        background: var(--code-bg); color: var(--code-text); border-radius: var(--radius-md); padding: 9px 11px;
        font-family: var(--font-mono); font-size: 11px; line-height: 1.5;
        white-space: pre-wrap; word-break: break-all; max-height: 130px; overflow-y: auto;
      }
      .${PREFIX}option {
        border: 1px solid var(--border); border-radius: var(--radius-md); padding: 9px; margin-top: 6px;
        display: flex; flex-direction: column; gap: 6px; background: var(--bg);
      }
      .${PREFIX}option-head { display: flex; align-items: center; gap: 6px; }
      .${PREFIX}option-badge {
        font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 999px;
        text-transform: uppercase; letter-spacing: 0.04em;
      }
      .${PREFIX}option-badge.${PREFIX}rec { background: var(--success-soft); color: var(--success-contrast); }
      .${PREFIX}option-badge.${PREFIX}alt { background: var(--bg-hover); color: var(--text-secondary); }
      .${PREFIX}option-title { font-size: 12px; font-weight: 600; color: var(--text); }
       .${PREFIX}option-note { font-size: 11px; color: var(--text-secondary); line-height: 1.45; }
       .${PREFIX}onboard-intro { padding: 2px 2px 4px; }
       .${PREFIX}onboard-intro-title { color: var(--text); font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
       .${PREFIX}onboard-intro-note { margin-top: 6px; color: var(--text-secondary); font-size: 12px; line-height: 1.5; }
       .${PREFIX}onboard-footer {
         position: sticky; bottom: -20px; z-index: 2; margin: auto -20px -20px; padding: 14px 20px 20px;
         background: linear-gradient(to bottom, color-mix(in srgb, var(--bg) 0%, transparent), var(--bg) 28%);
       }
       .${PREFIX}onboard-footer .${PREFIX}primary-btn { width: 100%; }
      .${PREFIX}copy-btn {
        align-self: flex-end; background: var(--accent); color: var(--accent-contrast); border: none;
        border-radius: var(--radius-sm); padding: 5px 13px; cursor: pointer; font-size: 12px; font-weight: 500;
        transition: background 0.15s, transform 0.1s;
      }
      .${PREFIX}copy-btn:hover { background: var(--accent-hover); }
      .${PREFIX}copy-btn:active { transform: scale(0.97); }
      .${PREFIX}select {
        border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding: 6px 9px; font-size: 12px;
        background: var(--bg); color: var(--text);
      }
      .${PREFIX}explainer { font-size: 12px; color: var(--text-secondary); line-height: 1.55; }
      .${PREFIX}primary-btn {
        background: linear-gradient(135deg, var(--accent), var(--accent-hover));
        color: var(--accent-contrast); border: none; border-radius: var(--radius-md);
        padding: 11px; cursor: pointer; font-weight: 600; font-size: 13px;
        box-shadow: var(--shadow-sm);
        transition: transform 0.1s, box-shadow 0.15s;
      }
      .${PREFIX}primary-btn:hover { box-shadow: var(--shadow-md); transform: translateY(-1px); }
      .${PREFIX}primary-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

      /* ── Connection wall ── */
      .${PREFIX}conn { padding: 22px 18px; align-items: center; justify-content: center; gap: 12px; text-align: center; }
      .${PREFIX}conn-icon {
        width: 68px; height: 68px; border-radius: 50%;
        background: var(--danger); color: #fff;
        display: flex; align-items: center; justify-content: center;
        box-shadow: var(--shadow-md);
      }
      .${PREFIX}conn-heading { font-size: 15px; font-weight: 700; color: var(--text); }
      .${PREFIX}conn .${PREFIX}codeblock { width: 100%; text-align: left; }
      .${PREFIX}conn .${PREFIX}copy-btn { align-self: flex-end; }
      .${PREFIX}conn .${PREFIX}primary-btn { width: 100%; margin-top: 4px; }
      .${PREFIX}conn .${PREFIX}option-note { width: 100%; }

      /* ── Chat ── */
       .${PREFIX}messages { flex: 1; min-height: 0; overflow-y: auto; padding: 20px 18px; display: flex; flex-direction: column; gap: 12px; }
      .${PREFIX}msg {
        max-width: 85%; padding: 9px 13px; border-radius: var(--radius-lg);
        font-size: 13px; line-height: 1.45; word-break: break-word;
        box-shadow: var(--shadow-sm);
        animation: ${PREFIX}msgIn 0.18s ease-out;
      }
      @keyframes ${PREFIX}msgIn {
        from { opacity: 0; transform: translateY(4px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .${PREFIX}msg.${PREFIX}user { align-self: flex-end; background: var(--chat-user); color: var(--chat-user-text); border-bottom-right-radius: 5px; }
      .${PREFIX}msg.${PREFIX}agent { align-self: flex-start; background: var(--chat-agent); color: var(--chat-agent-text); border-bottom-left-radius: 5px; }
      .${PREFIX}msg .${PREFIX}time { font-size: 10px; color: var(--text-muted); margin-top: 4px; }
      .${PREFIX}msg.${PREFIX}user .${PREFIX}time { color: color-mix(in srgb, var(--chat-user-text) 60%, transparent); }
       .${PREFIX}empty { flex: 1; display: flex; align-items: flex-start; justify-content: center; color: var(--text-muted); font-size: 13px; padding: 16px 2px; text-align: left; }
       .${PREFIX}guide { width: 100%; max-width: 360px; padding: 20px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg-elevated); box-shadow: var(--shadow-sm); }
       .${PREFIX}guide-title { color: var(--text); font-size: 18px; line-height: 1.2; font-weight: 700; margin-bottom: 16px; letter-spacing: -0.01em; }
       .${PREFIX}guide-step { display: flex; align-items: flex-start; gap: 10px; margin: 13px 0; line-height: 1.5; }
       .${PREFIX}guide-number { flex: 0 0 20px; height: 20px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; }
       .${PREFIX}guide-step strong { color: var(--text); }
       .${PREFIX}guide-note { margin-top: 18px; padding: 11px 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg); color: var(--text-secondary); font-size: 11px; line-height: 1.5; }
       .${PREFIX}agent-status { flex-shrink: 0; padding: 8px 18px; border-bottom: 1px solid var(--border); color: var(--text-secondary); background: var(--bg-elevated); font-size: 11px; line-height: 1.4; }
      .${PREFIX}agent-status.${PREFIX}connected { color: var(--success-contrast); background: var(--success-soft); }
      .${PREFIX}agent-status.${PREFIX}waiting { color: var(--accent); background: var(--accent-soft); }
      .${PREFIX}agent-status.${PREFIX}offline { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, var(--bg)); }

      .${PREFIX}confirm {
        align-self: stretch; border: 1px solid var(--border);
        border-radius: var(--radius-lg); padding: 11px 13px;
        background: var(--bg-elevated);
        display: flex; flex-direction: column; gap: 9px;
        box-shadow: var(--shadow-sm);
        animation: ${PREFIX}msgIn 0.18s ease-out;
      }
      .${PREFIX}confirm-text { font-size: 13px; line-height: 1.45; color: var(--text); word-break: break-word; }
      .${PREFIX}confirm-note { font-size: 11px; line-height: 1.4; color: var(--text-secondary); }
      .${PREFIX}confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }
      .${PREFIX}confirm-btn {
        border: none; border-radius: var(--radius-sm); padding: 7px 14px;
        font-size: 12px; font-weight: 600; cursor: pointer;
        transition: opacity 0.15s, transform 0.1s;
      }
      .${PREFIX}confirm-btn:hover { opacity: 0.9; }
      .${PREFIX}confirm-btn:active { transform: scale(0.97); }
      .${PREFIX}confirm-btn.${PREFIX}cancel {
        background: var(--bg-hover); color: var(--text-secondary);
      }
      .${PREFIX}confirm-btn.${PREFIX}proceed {
        background: linear-gradient(135deg, var(--accent), var(--accent-hover));
        color: var(--accent-contrast);
      }

       .${PREFIX}input-row {
         padding: 12px 14px 14px; border-top: 1px solid var(--border); display: grid;
         grid-template-columns: 1fr 1fr; gap: 8px; background: var(--bg); flex-shrink: 0;
       }
       .${PREFIX}input {
         grid-column: 1 / -1; width: 100%; border: 1px solid var(--border-strong); border-radius: var(--radius-md); padding: 11px 13px; font-size: 13px;
         outline: none; resize: vertical; min-height: 50px; max-height: 110px; color: var(--text); background: var(--bg);
         transition: border-color 0.15s, box-shadow 0.15s;
       }
      .${PREFIX}input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
      .${PREFIX}input::placeholder { color: var(--text-muted); }
       .${PREFIX}send {
        border: none; background: linear-gradient(135deg, var(--accent), var(--accent-hover));
         color: var(--accent-contrast); border-radius: var(--radius-md); padding: 0 12px; cursor: pointer;
         min-height: 40px; font-weight: 600; font-size: 12px; transition: opacity 0.15s, transform 0.1s;
       }
       .${PREFIX}input-row > .${PREFIX}send { grid-column: 1 / -1; width: 100%; }
      .${PREFIX}send:hover { opacity: 0.92; }
       .${PREFIX}send:active { transform: scale(0.97); }
       .${PREFIX}send:disabled { background: var(--bg-hover); color: var(--text-muted); cursor: not-allowed; }
       .${PREFIX}input-hint { grid-column: 1 / -1; color: var(--text-muted); font-size: 10px; line-height: 1.35; }

      /* ── Settings ── */
      .${PREFIX}settings { padding: 0; overflow: hidden; gap: 0; }
      .${PREFIX}settings-body { flex: 1; min-height: 0; overflow-y: auto; padding: 13px 13px 10px; }
      .${PREFIX}settings-group { border-bottom: 1px solid var(--border); padding: 9px 0; }
      .${PREFIX}settings-group:last-of-type { border-bottom: none; }
      .${PREFIX}settings-group-title { font-weight: 600; font-size: 11px; color: var(--text-muted); margin-bottom: 7px; text-transform: uppercase; letter-spacing: 0.05em; }
      .${PREFIX}setting { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: 13px; color: var(--text); }
      .${PREFIX}setting input[type="checkbox"] { accent-color: var(--accent); width: 15px; height: 15px; cursor: pointer; }
      .${PREFIX}setting-label { flex: 1; }
      .${PREFIX}setting-tip {
        display: inline-flex; align-items: center; justify-content: center;
        width: 16px; height: 16px; border-radius: 50%; background: var(--bg-hover);
        color: var(--text-muted); font-size: 11px; cursor: help; flex-shrink: 0;
      }
      .${PREFIX}setting-tip:hover { background: var(--border-strong); color: var(--text); }

      /* ── Theme selector ── */
      .${PREFIX}theme-row { display: flex; gap: 6px; margin-top: 2px; }
      .${PREFIX}theme-btn {
        flex: 1; border: 1px solid var(--border-strong); background: var(--bg); color: var(--text-secondary);
        border-radius: var(--radius-sm); padding: 7px 4px; font-size: 12px; cursor: pointer; font-weight: 500;
        transition: background 0.15s, color 0.15s, border-color 0.15s;
      }
      .${PREFIX}theme-btn:hover { background: var(--bg-hover); color: var(--text); }
      .${PREFIX}theme-btn.${PREFIX}active { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }

      .${PREFIX}settings-footer {
        flex-shrink: 0; padding: 10px 13px 13px; display: flex; gap: 8px;
        border-top: 1px solid var(--border); background: var(--bg);
        box-shadow: 0 -3px 10px rgba(15,23,42,0.06); z-index: 1;
      }
      .${PREFIX}settings-footer .${PREFIX}copy-btn { flex: 1; }

      @media (prefers-reduced-motion: reduce) {
        .${PREFIX}panel, .${PREFIX}msg, .${PREFIX}toggle { transition: none !important; animation: none !important; }
      }
      @media (max-width: 480px) {
        .${PREFIX}panel {
          right: 8px !important; bottom: 68px !important; width: calc(100vw - 16px);
          height: calc(100dvh - 84px); min-height: 0; border-radius: var(--radius-lg);
        }
        .${PREFIX}header { padding: 10px 12px; gap: 6px; }
        .${PREFIX}header-btn { min-width: 0; padding: 7px; }
        .${PREFIX}header-btn svg { margin: 0; }
        .${PREFIX}messages { padding: 14px 12px; }
        .${PREFIX}guide { padding: 16px; }
      }
    `;
    shadow.appendChild(style);

    // ── Toggle button ──
    const toggle = document.createElement('button');
    toggle.className = `${PREFIX}toggle`;
    toggle.textContent = 'V';
    toggle.setAttribute('aria-label', 'Toggle Viskod');
    // Inline fallback so the toggle is always visible even if the stylesheet is blocked
    toggle.style.cssText =
      'position:fixed;bottom:18px;right:18px;z-index:2147483647;width:46px;height:46px;' +
      'border-radius:50%;border:none;background:#6366f1;color:#fff;cursor:pointer;' +
      'display:flex;align-items:center;justify-content:center;box-shadow:0 8px 16px rgba(0,0,0,0.25);' +
      'font-size:18px;font-weight:700;';
    shadow.appendChild(toggle);

    // Connection status badge on the toggle corner
    const statusBadge = document.createElement('span');
    statusBadge.className = `${PREFIX}status-badge`;
    statusBadge.setAttribute('role', 'status');
    shadow.appendChild(statusBadge);
    function updateStatusBadge() {
      statusBadge.classList.toggle(`${PREFIX}online`, studioOnline);
      statusBadge.title = studioOnline ? 'Studio connected' : 'Studio offline — click to open help';
    }

    // Poll Studio health to track connection status
    let statusTimer = null;
    function checkStudioStatus() {
      checkHealth().then((data) => {
        const wasOnline = studioOnline;
        studioOnline = !!(data && data.studio?.status === 'running');
        if (!agentStatus.classList.contains(`${PREFIX}waiting`)) {
          setAgentStatus(
            studioOnline
              ? 'Studio connected · IDE/TUI MCP status is separate.'
              : 'Studio is offline · Start Studio to connect Viskod.',
            studioOnline ? 'connected' : 'offline',
          );
        }
        if (studioOnline !== wasOnline) {
          updateStatusBadge();
          // Auto-gate when the panel is open and connection state flips
          if (panelOpen) {
            if (!studioOnline) {
              showConnectionWall();
            } else if (view === 'conn') {
              // Reconnect then resume: onboarding or chat
              if (ws && ws.readyState !== WebSocket.OPEN) connect();
              if (onboardingDone) switchView('chat');
              else switchView('onboarding');
            }
          }
        }
        // If we were offline and the WebSocket isn't connected, try reconnecting
        if (studioOnline && (!ws || ws.readyState !== WebSocket.OPEN)) {
          connect();
        }
      });
    }
    function updateStatusPolling() {
      if (document.hidden) {
        if (statusTimer !== null) {
          clearInterval(statusTimer);
          statusTimer = null;
        }
        return;
      }
      if (statusTimer === null) {
        checkStudioStatus();
        statusTimer = setInterval(checkStudioStatus, 5000);
      }
    }
    document.addEventListener('visibilitychange', updateStatusPolling);
    updateStatusPolling();

    // ── Panel ──
    const panel = document.createElement('div');
    panel.className = `${PREFIX}panel`;

    // Header
    const header = document.createElement('div');
    header.className = `${PREFIX}header`;
    const dot = document.createElement('span');
    dot.className = `${PREFIX}dot`;
    header.appendChild(dot);
    const title = document.createElement('span');
    title.className = `${PREFIX}header-title`;
    const brand = document.createElement('span');
    brand.className = `${PREFIX}brand`;
    const brandMark = document.createElement('span');
    brandMark.className = `${PREFIX}brand-mark`;
    brandMark.textContent = 'V';
    brand.appendChild(brandMark);
    const brandText = document.createElement('span');
    brandText.textContent = 'Viskod';
    brand.appendChild(brandText);
    title.appendChild(brand);
    header.appendChild(title);
    const selBtn = document.createElement('button');
    selBtn.className = `${PREFIX}header-btn`;
    selBtn.innerHTML = `${CURSOR_ICON} Select`;
    selBtn.title = 'Toggle element selection mode';
    header.appendChild(selBtn);
    const tutorialBtn = document.createElement('button');
    tutorialBtn.className = `${PREFIX}header-btn`;
    tutorialBtn.textContent = '?';
    tutorialBtn.title = 'Tutorial / setup guide';
    header.appendChild(tutorialBtn);
    const settingsBtn = document.createElement('button');
    settingsBtn.className = `${PREFIX}header-btn`;
    settingsBtn.textContent = '⚙';
    settingsBtn.title = 'Settings';
    header.appendChild(settingsBtn);
    panel.appendChild(header);

    // Views
    const onboardView = document.createElement('div');
    onboardView.className = `${PREFIX}view ${PREFIX}onboard ${PREFIX}active`;
    panel.appendChild(onboardView);

    const chatView = document.createElement('div');
    chatView.className = `${PREFIX}view ${PREFIX}chat`;
    const agentStatus = document.createElement('div');
    agentStatus.className = `${PREFIX}agent-status`;
    agentStatus.setAttribute('role', 'status');
    agentStatus.setAttribute('aria-live', 'polite');
    chatView.appendChild(agentStatus);
    panel.appendChild(chatView);

    const settingsView = document.createElement('div');
    settingsView.className = `${PREFIX}view ${PREFIX}settings`;
    panel.appendChild(settingsView);

    const connView = document.createElement('div');
    connView.className = `${PREFIX}view ${PREFIX}conn`;
    panel.appendChild(connView);

    shadow.appendChild(panel);

    // ── State ──
    let panelOpen = false;
    let view = 'onboarding'; // 'onboarding' | 'chat' | 'settings' | 'conn'
    let ws = null;
    let connected = false;
    const DEFAULT_SETTINGS = {
      selectionMode: false,
      boxSelect: true,
      hoverHighlight: true,
      diagnosticsOverlay: false,
      spacingVisualization: false,
      screenshots: true,
      consoleLogs: true,
      networkRequests: true,
      computedStyles: true,
      autoRefresh: false,
      sourceHints: true,
      importGraph: false,
      theme: 'system', // 'light' | 'dark' | 'system'
    };
    // Load persisted settings, fall back to defaults
    let settings = { ...DEFAULT_SETTINGS };
    try {
      const saved = localStorage.getItem('__viskod_settings');
      if (saved) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    } catch (e) {}
    settings.multiSelect = undefined;
    let onboardingDone = false;
    try {
      onboardingDone = localStorage.getItem('__viskod_onboarded') === '1';
    } catch (e) {}
    let studioOnline = false;
    let bridgePoller = null;
    let pendingSelection = null; // { type, data, collected } awaiting user confirmation
    let pendingConfirmBox = null;
    let lastSelectionSummary = '';

    function setAgentStatus(text, state) {
      agentStatus.textContent = text;
      agentStatus.className = `${PREFIX}agent-status${state ? ` ${PREFIX}${state}` : ''}`;
    }

    function getSelectionState() {
      return {
        type: 'selection-state',
        hasSelection: Boolean(pendingSelection),
        summary: pendingSelection ? selectionSummary(pendingSelection) : '',
      };
    }

    function broadcastSelectionState() {
      try {
        chrome.runtime.sendMessage(getSelectionState(), () => void chrome.runtime.lastError);
      } catch (e) {}
    }

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.type === 'sidepanel:get-state') {
        sendResponse(getSelectionState());
        return;
      }
      if (msg.type === 'sidepanel:open-chat') {
        openPanel();
        sendResponse({ ok: true });
        return;
      }
      if (msg.type === 'sidepanel:open-help') {
        openPanel();
        buildOnboarding();
        switchView('onboarding');
        sendResponse({ ok: true });
        return;
      }
      if (msg.type === 'sidepanel:open-settings') {
        openPanel();
        buildSettings();
        switchView('settings');
        sendResponse({ ok: true });
        return;
      }
      if (msg.type === 'sidepanel:enable-selection') {
        if (!settings.selectionMode) selBtn.click();
        sendResponse({ ok: true });
        return;
      }
      if (msg.type === 'sidepanel:send-selection') {
        const summary = pendingSelection ? selectionSummary(pendingSelection) : '';
        sendResponse({ ok: submitPendingSelection(), summary });
      }
    });
    setAgentStatus('Starting Studio connection...');

    // ── Toggle panel ──
    function openPanel() {
      panelOpen = true;
      document.body.appendChild(host); // ensure on top
      panel.classList.add(`${PREFIX}open`);
      toggle.textContent = '+';
      if (!studioOnline) {
        showConnectionWall();
      } else if (onboardingDone) {
        switchView('chat');
      } else {
        switchView('onboarding');
      }
    }
    function closePanel() {
      panelOpen = false;
      panel.classList.remove(`${PREFIX}open`);
      toggle.textContent = 'V';
    }
    toggle.addEventListener('click', () => (panelOpen ? closePanel() : openPanel()));

    // Close the chatbot panel when Escape is pressed
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && panelOpen) {
          // Close the chat panel before the page/overlay sees the key (capture phase runs first).
          e.preventDefault();
          closePanel();
        }
      },
      true,
    );

    function switchView(name) {
      view = name;
      onboardView.classList.toggle(`${PREFIX}active`, name === 'onboarding');
      chatView.classList.toggle(`${PREFIX}active`, name === 'chat');
      settingsView.classList.toggle(`${PREFIX}active`, name === 'settings');
      connView.classList.toggle(`${PREFIX}active`, name === 'conn');
      if (name === 'chat') input.focus();
    }

    // Gate: if Studio is offline, block everything behind the connection wall
    function showConnectionWall() {
      buildConnectionWall();
      switchView('conn');
    }
    function gateView() {
      if (!studioOnline) {
        showConnectionWall();
        return false;
      }
      return true;
    }

    // Connection wall — shown until Studio is reachable
    function buildConnectionWall() {
      connView.innerHTML = '';

      const icon = document.createElement('div');
      icon.className = `${PREFIX}conn-icon`;
      icon.innerHTML =
        '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
      connView.appendChild(icon);

      const heading = document.createElement('div');
      heading.className = `${PREFIX}conn-heading`;
      heading.textContent = 'Studio is not connected';
      connView.appendChild(heading);

      const sub = document.createElement('div');
      sub.className = `${PREFIX}explainer`;
      sub.textContent =
        'Viskod needs its Studio server running to inspect the page, capture context, and chat with your agent. Chat is locked until it connects.';
      connView.appendChild(sub);

      // Start command
      const cmdLabel = document.createElement('div');
      cmdLabel.className = `${PREFIX}option-title`;
      cmdLabel.textContent = 'Start Studio in your terminal';
      connView.appendChild(cmdLabel);
      const cmd = document.createElement('div');
      cmd.className = `${PREFIX}codeblock`;
      cmd.textContent = 'npx tsx apps/studio/src/index.ts';
      connView.appendChild(cmd);
      const copyBtn = document.createElement('button');
      copyBtn.className = `${PREFIX}copy-btn`;
      copyBtn.textContent = 'Copy command';
      copyBtn.addEventListener('click', () => {
        copyToClipboard(cmd.textContent).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => {
            copyBtn.textContent = 'Copy command';
          }, 1500);
        });
      });
      connView.appendChild(copyBtn);

      const checkBtn = document.createElement('button');
      checkBtn.className = `${PREFIX}primary-btn`;
      checkBtn.textContent = 'Check again';
      checkBtn.addEventListener('click', () => {
        checkStudioStatus();
        setTimeout(() => {
          if (studioOnline) openPanel();
          else showConnectionWall();
        }, 300);
      });
      connView.appendChild(checkBtn);

      const hint = document.createElement('div');
      hint.className = `${PREFIX}option-note`;
      hint.textContent =
        'Run this from the Viskod repository folder (C:\\Viskod). The status badge on the V button turns green once connected.';
      connView.appendChild(hint);
    }

    // ── Onboarding UI ──
    function buildOnboarding() {
      onboardView.innerHTML = '';

      const intro = document.createElement('div');
      intro.className = `${PREFIX}onboard-intro`;
      intro.innerHTML = `<div class="${PREFIX}onboard-intro-title">Connect your visual context</div><div class="${PREFIX}onboard-intro-note">Viskod inspects the page. Your IDE/TUI agent handles the code.</div>`;
      onboardView.appendChild(intro);

      // Step 1: Studio status
      const step1 = document.createElement('div');
      step1.className = `${PREFIX}step`;
      const s1t = document.createElement('div');
      s1t.className = `${PREFIX}step-title`;
      s1t.innerHTML = `1. Studio connection <span class="${PREFIX}step-status ${PREFIX}wait" id="${PREFIX}s1">checking…</span>`;
      step1.appendChild(s1t);
      const s1d = document.createElement('div');
      s1d.className = `${PREFIX}explainer`;
      s1d.textContent =
        'Make sure Viskod Studio is running in your project terminal (npx tsx apps/studio/src/index.ts).';
      step1.appendChild(s1d);
      onboardView.appendChild(step1);

      // Step 2: Install MCP in your IDE
      const step2 = document.createElement('div');
      step2.className = `${PREFIX}step`;
      const s2t = document.createElement('div');
      s2t.className = `${PREFIX}step-title`;
      s2t.textContent = '2. Install MCP in your IDE';
      step2.appendChild(s2t);
      const s2d = document.createElement('div');
      s2d.className = `${PREFIX}explainer`;
      s2d.textContent =
        'Choose ONE option. The one-line command is the easiest — only use the raw config if the command doesn\u2019t work.';
      step2.appendChild(s2d);

      const ideSelect = document.createElement('select');
      ideSelect.className = `${PREFIX}select`;
      for (const ide of ['opencode', 'cursor', 'claude']) {
        const opt = document.createElement('option');
        opt.value = ide;
        opt.textContent = ide[0].toUpperCase() + ide.slice(1);
        ideSelect.appendChild(opt);
      }
      step2.appendChild(ideSelect);

      // Option A — one-line command (recommended)
      const optA = document.createElement('div');
      optA.className = `${PREFIX}option`;
      const optAHead = document.createElement('div');
      optAHead.className = `${PREFIX}option-head`;
      const optABadge = document.createElement('span');
      optABadge.className = `${PREFIX}option-badge ${PREFIX}rec`;
      optABadge.textContent = 'Recommended';
      optAHead.appendChild(optABadge);
      const optATitle = document.createElement('span');
      optATitle.className = `${PREFIX}option-title`;
      optATitle.textContent = 'One-line command';
      optAHead.appendChild(optATitle);
      optA.appendChild(optAHead);
      const installCode = document.createElement('div');
      installCode.className = `${PREFIX}codeblock`;
      installCode.textContent = `npx tsx C:/Viskod/packages/cli/src/index.ts install ${ideSelect.value}`;
      optA.appendChild(installCode);
      const installCopy = document.createElement('button');
      installCopy.className = `${PREFIX}copy-btn`;
      installCopy.textContent = 'Copy command';
      installCopy.addEventListener('click', () => {
        copyToClipboard(installCode.textContent).then(() => {
          installCopy.textContent = 'Copied!';
          setTimeout(() => {
            installCopy.textContent = 'Copy command';
          }, 1500);
        });
      });
      optA.appendChild(installCopy);
      const optANote = document.createElement('div');
      optANote.className = `${PREFIX}option-note`;
      optANote.textContent =
        'Run in your project terminal. Writes the MCP config into your IDE automatically.';
      optA.appendChild(optANote);
      step2.appendChild(optA);

      // Option B — raw JSON config (fallback)
      const optB = document.createElement('div');
      optB.className = `${PREFIX}option`;
      const optBHead = document.createElement('div');
      optBHead.className = `${PREFIX}option-head`;
      const optBBadge = document.createElement('span');
      optBBadge.className = `${PREFIX}option-badge ${PREFIX}alt`;
      optBBadge.textContent = 'Fallback';
      optBHead.appendChild(optBBadge);
      const optBTitle = document.createElement('span');
      optBTitle.className = `${PREFIX}option-title`;
      optBTitle.textContent = 'Raw JSON config';
      optBHead.appendChild(optBTitle);
      optB.appendChild(optBHead);
      const optBNote = document.createElement('div');
      optBNote.className = `${PREFIX}option-note`;
      optBNote.textContent =
        'Only if the command fails. Paste this into your IDE\u2019s MCP config file manually.';
      optB.appendChild(optBNote);
      const code = document.createElement('div');
      code.className = `${PREFIX}codeblock`;
      code.textContent = 'Loading…';
      optB.appendChild(code);
      const copyBtn = document.createElement('button');
      copyBtn.className = `${PREFIX}copy-btn`;
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', () => {
        copyToClipboard(code.textContent).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => {
            copyBtn.textContent = 'Copy';
          }, 1500);
        });
      });
      optB.appendChild(copyBtn);
      step2.appendChild(optB);

      onboardView.appendChild(step2);

      function loadMcpConfig() {
        const selected = ideSelect.value;
        installCode.textContent = `npx tsx C:/Viskod/packages/cli/src/index.ts install ${selected}`;
        fetch(`${HTTP}/setup/mcp-config?ide=${selected}`)
          .then((r) => r.text())
          .then((t) => {
            code.textContent = t;
          })
          .catch(() => {
            code.textContent = 'Could not fetch config.';
          });
      }
      ideSelect.addEventListener('change', loadMcpConfig);
      loadMcpConfig();

      // Step 3: Explainer
      const step3 = document.createElement('div');
      step3.className = `${PREFIX}step`;
      const s3t = document.createElement('div');
      s3t.className = `${PREFIX}step-title`;
      s3t.textContent = '3. How Viskod works';
      step3.appendChild(s3t);
      const s3d = document.createElement('div');
      s3d.className = `${PREFIX}explainer`;
      s3d.innerHTML =
        '• Hover over any element to preview it<br>' +
        '• Tap \u201cSelect\u201d in the header, then click to choose an element<br>' +
        '• Click multiple elements without modifier keys to build a selection<br>' +
        '• Copy or queue context for your IDE/TUI agent<br>' +
        '• Your agent re-captures and shows the result';
      step3.appendChild(s3d);
      onboardView.appendChild(step3);

      // Get started button
      const getStarted = document.createElement('button');
      getStarted.className = `${PREFIX}primary-btn`;
      getStarted.textContent = 'Get Started →';
      getStarted.addEventListener('click', () => {
        onboardingDone = true;
        try {
          localStorage.setItem('__viskod_onboarded', '1');
        } catch (e) {}
        switchView('chat');
      });
      const onboardFooter = document.createElement('div');
      onboardFooter.className = `${PREFIX}onboard-footer`;
      onboardFooter.appendChild(getStarted);
      onboardView.appendChild(onboardFooter);

      // Update step 1 status
      fetch(`${HTTP}/health`)
        .then((r) => r.json())
        .then((h) => {
          const el = shadow.querySelector(`#${PREFIX}s1`);
          if (el) {
            if (h.studio?.status === 'running' && h.browserConnected) {
              el.textContent = '✓ connected';
              el.className = `${PREFIX}step-status ${PREFIX}ok`;
            } else {
              el.textContent = '⚠ browser not connected';
            }
          }
        })
        .catch(() => {
          const el = shadow.querySelector(`#${PREFIX}s1`);
          if (el) {
            el.textContent = '✗ studio down';
          }
        });
    }

    // ── Chat UI ──
    const messagesEl = document.createElement('div');
    messagesEl.className = `${PREFIX}messages`;
    chatView.appendChild(messagesEl);

    const emptyState = document.createElement('div');
    emptyState.className = `${PREFIX}empty`;
    emptyState.innerHTML = `<div class="${PREFIX}guide"><div class="${PREFIX}guide-title">How Viskod works</div><div class="${PREFIX}guide-step"><span class="${PREFIX}guide-number">1</span><span><strong>Select</strong> an element or drag a box in Chrome.</span></div><div class="${PREFIX}guide-step"><span class="${PREFIX}guide-number">2</span><span><strong>Prepare</strong> the handoff. Viskod queues context and copies the prompt.</span></div><div class="${PREFIX}guide-step"><span class="${PREFIX}guide-number">3</span><span><strong>Review</strong> the code changes in your IDE or TUI.</span></div><div class="${PREFIX}guide-note">Viskod handles browser context. Your IDE/TUI agent handles reasoning, code changes, and verification through Viskod MCP.</div></div>`;
    messagesEl.appendChild(emptyState);

    const inputRow = document.createElement('div');
    inputRow.className = `${PREFIX}input-row`;
    const input = document.createElement('textarea');
    input.className = `${PREFIX}input`;
    input.placeholder = 'Describe the fix for your IDE/TUI agent...';
    input.rows = 1;
    inputRow.appendChild(input);
    const sendBtn = document.createElement('button');
    sendBtn.className = `${PREFIX}send`;
    sendBtn.textContent = 'Prepare handoff';
    sendBtn.disabled = true;
    const queueHint = document.createElement('div');
    queueHint.className = `${PREFIX}input-hint`;
    queueHint.textContent =
      'With a selection, queues context to MCP and copies a prompt. Without one, it copies the prompt only.';
    inputRow.appendChild(sendBtn);
    inputRow.appendChild(queueHint);
    chatView.appendChild(inputRow);

    function prepareHandoff() {
      const text = input.value.trim();
      const hasPendingSelection = Boolean(pendingSelection);
      const selection =
        lastSelectionSummary ||
        (pendingSelection ? selectionSummary(pendingSelection) : 'No browser selection attached.');
      if (!text && !hasPendingSelection && !lastSelectionSummary) return;
      const instruction =
        text ||
        'Review this selected UI context and identify the relevant source files and code changes.';
      const prompt = `${selection}\n\n${instruction}`;
      const queued = hasPendingSelection ? submitPendingSelection(false) : false;
      copyToClipboard(prompt)
        .then(() => {
          const message = queued
            ? 'Context queued and prompt copied for your IDE/TUI agent.'
            : hasPendingSelection
              ? 'Prompt copied, but context could not be queued because Studio is offline.'
              : 'Prompt copied for your IDE/TUI agent.';
          appendMessage('user', message);
          setAgentStatus(
            message.replace(' for your IDE/TUI agent.', ' · continue in your IDE/TUI agent.'),
            queued ? 'waiting' : hasPendingSelection ? 'offline' : 'ready',
          );
          input.value = '';
          updatePromptActions();
        })
        .catch(() => {
          setAgentStatus(
            'Clipboard access is unavailable. Select the prompt text and copy it manually.',
            'offline',
          );
        });
    }
    function updatePromptActions() {
      const hasText = Boolean(input.value.trim());
      const hasContext = Boolean(lastSelectionSummary || pendingSelection);
      sendBtn.disabled = !hasText && !hasContext;
    }
    sendBtn.addEventListener('click', prepareHandoff);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        prepareHandoff();
      }
    });
    input.addEventListener('input', () => {
      updatePromptActions();
    });

    function appendMessage(role, text) {
      emptyState.remove();
      const msg = document.createElement('div');
      msg.className = `${PREFIX}msg ${PREFIX}${role}`;
      const body = document.createElement('div');
      body.textContent = text;
      msg.appendChild(body);
      const time = document.createElement('div');
      time.className = `${PREFIX}time`;
      time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      msg.appendChild(time);
      messagesEl.appendChild(msg);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // ── Selection confirmation prompt ──
    function selectionSummary(sel) {
      if (sel.type === 'box') {
        const refs = sel.data.elements
          .map((element, index) => `Box #${element.selectionNumber || index + 1}`)
          .join(', ');
        return `Selected ${sel.data.elements.length} boxes: ${refs}`;
      }
      const info = sel.data;
      const selected = info.selectedElements || [];
      const count = info.selectionCount || selected.length || 1;
      if (count > 1) {
        const refs = selected
          .map((element, index) => `Box #${element.selectionNumber || index + 1}`)
          .join(', ');
        return `Selected ${count} boxes: ${refs}`;
      }
      const ref = selected[0]?.selectionNumber || info.selectionNumber || 1;
      return `Selected Box #${ref}`;
    }

    function showSelectionConfirm() {
      if (!pendingSelection) return;
      if (pendingConfirmBox) pendingConfirmBox.remove();
      emptyState.remove();
      const box = document.createElement('div');
      box.className = `${PREFIX}confirm`;

      const body = document.createElement('div');
      body.className = `${PREFIX}confirm-text`;
      body.textContent = selectionSummary(pendingSelection);
      box.appendChild(body);

      const note = document.createElement('div');
      note.className = `${PREFIX}confirm-note`;
      note.textContent =
        'Prepare the handoff to queue context and copy the prompt for your IDE/TUI agent.';
      box.appendChild(note);

      const actions = document.createElement('div');
      actions.className = `${PREFIX}confirm-actions`;

      const cancel = document.createElement('button');
      cancel.className = `${PREFIX}confirm-btn ${PREFIX}cancel`;
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => {
        // Clear overlay selection and drop the pending selection
        pendingSelection = null;
        clearOverlaySelection();
        box.remove();
        if (pendingConfirmBox === box) pendingConfirmBox = null;
        updatePromptActions();
        broadcastSelectionState();
      });
      actions.appendChild(cancel);

      const proceed = document.createElement('button');
      proceed.className = `${PREFIX}confirm-btn ${PREFIX}proceed`;
      proceed.textContent = 'Prepare handoff';
      proceed.addEventListener('click', () => {
        prepareHandoff();
      });
      actions.appendChild(proceed);

      box.appendChild(actions);
      messagesEl.appendChild(box);
      pendingConfirmBox = box;
      updatePromptActions();
      broadcastSelectionState();
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function submitPendingSelection(announce = true) {
      const sel = pendingSelection;
      if (!sel) return false;
      lastSelectionSummary = selectionSummary(sel);

      pendingSelection = null;
      if (pendingConfirmBox) {
        pendingConfirmBox.remove();
        pendingConfirmBox = null;
      }
      updatePromptActions();
      broadcastSelectionState();
      if (announce) appendMessage('user', 'Queue this selection for my IDE/TUI agent.');
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setAgentStatus(
          'Selection captured · connect Studio and your IDE/TUI agent to continue.',
          'offline',
        );
        if (announce)
          appendMessage(
            'agent',
            'Selection captured, but no Studio connection is available. Start Studio and your IDE/TUI agent with Viskod MCP.',
          );
        return false;
      }
      const eventType = sel.type === 'box' ? 'overlay:box-selected' : 'overlay:element-clicked';
      ws.send(JSON.stringify({ type: 'overlay:event', data: { type: eventType, data: sel.data } }));
      setAgentStatus('Selection queued for MCP · continue in your IDE/TUI agent.', 'waiting');
      if (announce)
        appendMessage(
          'agent',
          `${selectionSummary(sel)}\nSelection queued. Ask your IDE/TUI agent to read the latest Viskod context.`,
        );
      return true;
    }

    // Ask the overlay to clear its visual selection (via DOM command bridge)
    function clearOverlaySelection() {
      try {
        const cmd = document.getElementById('__viskod_cmd');
        if (cmd) {
          // Clear the current visual selection without leaving selection mode.
          cmd.textContent = JSON.stringify({ command: 'overlay:clear-selection' });
        }
      } catch (e) {}
    }

    // ── Settings UI ──
    function buildSettings() {
      settingsView.innerHTML = '';
      const settingsBody = document.createElement('div');
      settingsBody.className = `${PREFIX}settings-body`;

      // Appearance / theme group
      const appearanceGroup = document.createElement('div');
      appearanceGroup.className = `${PREFIX}settings-group`;
      const themeTitle = document.createElement('div');
      themeTitle.className = `${PREFIX}settings-group-title`;
      themeTitle.textContent = 'Appearance';
      appearanceGroup.appendChild(themeTitle);
      const themeRow = document.createElement('div');
      themeRow.className = `${PREFIX}theme-row`;
      const themeLabels = { light: 'Light', dark: 'Dark', system: 'System' };
      for (const [val, label] of Object.entries(themeLabels)) {
        const btn = document.createElement('button');
        btn.className = `${PREFIX}theme-btn${settings.theme === val ? ` ${PREFIX}active` : ''}`;
        btn.textContent = label;
        btn.addEventListener('click', () => {
          settings.theme = val;
          applyTheme();
          updateSettings();
          buildSettings();
        });
        themeRow.appendChild(btn);
      }
      appearanceGroup.appendChild(themeRow);
      const themeHint = document.createElement('div');
      themeHint.className = `${PREFIX}option-note`;
      themeHint.textContent =
        settings.theme === 'system'
          ? 'Follows your operating system\u2019s color scheme.'
          : 'Applies to the Viskod panel only \u2014 your site is untouched.';
      appearanceGroup.appendChild(themeHint);
      settingsBody.appendChild(appearanceGroup);

      const groups = [
        {
          title: 'Basic',
          items: [
            {
              key: 'selectionMode',
              label: 'Element selection (click)',
              desc: 'Enable click-to-select elements on the page. Click again or toggle off to stop.',
            },
            {
              key: 'boxSelect',
              label: 'Box-select (drag)',
              desc: 'Drag a rectangle over the page to select all elements inside it.',
            },
            {
              key: 'hoverHighlight',
              label: 'Hover highlight',
              desc: 'Show a blue outline around elements as you hover over them.',
            },
            {
              key: 'screenshots',
              label: 'Screenshots',
              desc: 'Capture screenshots of the selected element for the agent.',
            },
            {
              key: 'consoleLogs',
              label: 'Console logs',
              desc: 'Collect browser console errors into the context packet.',
            },
            {
              key: 'networkRequests',
              label: 'Network requests',
              desc: 'Collect network request/response info into the context packet.',
            },
            {
              key: 'computedStyles',
              label: 'Computed styles',
              desc: 'Collect computed CSS styles for the selected element.',
            },
            {
              key: 'sourceHints',
              label: 'Source hints',
              desc: 'Map selected elements to their source files so the agent can find and edit them.',
            },
          ],
        },
        {
          title: 'Advanced',
          items: [
            {
              key: 'diagnosticsOverlay',
              label: 'Diagnostics overlay',
              desc: 'Show bounding boxes, margins (red) and padding (green) for all elements.',
            },
            {
              key: 'spacingVisualization',
              label: 'Spacing visualization',
              desc: 'Show pixel gaps between adjacent elements with orange labels.',
            },
            {
              key: 'autoRefresh',
              label: 'Auto-refresh after fix',
              desc: 'Auto-reload the page after the agent applies a fix.',
            },
            {
              key: 'importGraph',
              label: 'Import graph (slower)',
              desc: 'Analyze the import graph for better source hints. Slower on large projects.',
            },
          ],
        },
      ];

      for (const g of groups) {
        const groupEl = document.createElement('div');
        groupEl.className = `${PREFIX}settings-group`;
        const gt = document.createElement('div');
        gt.className = `${PREFIX}settings-group-title`;
        gt.textContent = g.title;
        groupEl.appendChild(gt);
        for (const item of g.items) {
          const row = document.createElement('label');
          row.className = `${PREFIX}setting`;
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = settings[item.key];
          cb.addEventListener('change', () => {
            settings[item.key] = cb.checked;
            updateSettings();
            applySettings();
          });
          row.appendChild(cb);
          const lbl = document.createElement('span');
          lbl.className = `${PREFIX}setting-label`;
          lbl.textContent = item.label;
          row.appendChild(lbl);
          if (item.desc) {
            const tip = document.createElement('span');
            tip.className = `${PREFIX}setting-tip`;
            tip.textContent = '?';
            tip.title = item.desc;
            tip.setAttribute('aria-label', item.desc);
            row.appendChild(tip);
          }
          groupEl.appendChild(row);
        }
        settingsBody.appendChild(groupEl);
      }

      settingsView.appendChild(settingsBody);

      const footer = document.createElement('div');
      footer.className = `${PREFIX}settings-footer`;
      const reset = document.createElement('button');
      reset.className = `${PREFIX}copy-btn`;
      reset.textContent = 'Reset defaults';
      reset.addEventListener('click', () => {
        settings = { ...DEFAULT_SETTINGS };
        applyTheme();
        buildSettings();
        updateSettings();
        applySettings();
      });
      footer.appendChild(reset);
      const back = document.createElement('button');
      back.className = `${PREFIX}copy-btn`;
      back.textContent = 'Back to chat';
      back.addEventListener('click', () => switchView('chat'));
      footer.appendChild(back);
      settingsView.appendChild(footer);
    }

    // ── Settings sync ──
    function updateSettings() {
      // Persist locally so settings survive manual + auto refresh
      try {
        localStorage.setItem('__viskod_settings', JSON.stringify(settings));
      } catch (e) {}
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'settings:update', settings }));
      }
    }
    function applySettings() {
      const cmdEl = document.getElementById('__viskod_cmd');
      if (!cmdEl) {
        const el = document.createElement('div');
        el.id = '__viskod_cmd';
        el.style.display = 'none';
        document.body.appendChild(el);
      }
      const cmdTarget = document.getElementById('__viskod_cmd');
      const overlaySettings = {
        multiSelect: true,
        boxSelect: settings.boxSelect,
        hoverHighlight: settings.hoverHighlight,
        diagnosticsOverlay: settings.diagnosticsOverlay,
        spacingVisualization: settings.spacingVisualization,
      };
      if (settings.selectionMode) {
        // SELECT ON — load and activate the overlay only when needed.
        injectOverlay();
        startBridgePolling();
        cmdTarget.textContent = JSON.stringify({
          command: 'overlay:show',
          mode: 'selection',
          settings: overlaySettings,
        });
        selBtn.classList.add(`${PREFIX}active`);
      } else {
        // SELECT OFF — fully hide overlay and stop page polling.
        stopBridgePolling();
        cmdTarget.textContent = JSON.stringify({ command: 'overlay:hide' });
        selBtn.classList.remove(`${PREFIX}active`);
      }
    }

    // ── Theme ──
    function applyTheme() {
      const theme = settings.theme || 'system';
      let resolved = theme;
      if (theme === 'system') {
        resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      host.setAttribute('data-theme', resolved);
    }
    // Follow OS theme changes when in 'system' mode
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const onMediaChange = () => {
      if (settings.theme === 'system') applyTheme();
    };
    mediaQuery.addEventListener?.('change', onMediaChange);

    // Apply theme on init
    applyTheme();

    // ── Selection toggle button ──
    selBtn.addEventListener('click', () => {
      settings.selectionMode = !settings.selectionMode;
      buildSettings();
      updateSettings();
      applySettings();
      selBtn.classList.toggle(`${PREFIX}active`, settings.selectionMode);
      selBtn.innerHTML = settings.selectionMode
        ? `${CHECK_ICON} Selecting`
        : `${CURSOR_ICON} Select`;
    });

    // ── Tutorial button — reopen onboarding ──
    tutorialBtn.addEventListener('click', () => {
      buildOnboarding();
      switchView('onboarding');
    });

    settingsBtn.addEventListener('click', () => {
      buildSettings();
      switchView('settings');
    });

    // ── WebSocket ──
    function connect() {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        connected = true;
        studioOnline = true;
        dot.classList.add(`${PREFIX}connected`);
        updateStatusBadge();
        if (!agentStatus.classList.contains(`${PREFIX}waiting`)) {
          setAgentStatus('Studio connected · IDE/TUI MCP status is separate.', 'connected');
        }
      };
      ws.onclose = () => {
        connected = false;
        dot.classList.remove(`${PREFIX}connected`);
        if (!agentStatus.classList.contains(`${PREFIX}waiting`)) {
          setAgentStatus('Studio disconnected · Start Studio to reconnect.', 'offline');
        }
        setTimeout(connect, 3000);
      };
      ws.onerror = () => {
        ws.close();
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'chat:message' && msg.role === 'agent') {
            setAgentStatus(
              'Agent response received · code changes happen in your IDE/TUI.',
              'connected',
            );
            if (!onboardingDone) {
              onboardingDone = true;
              try {
                localStorage.setItem('__viskod_onboarded', '1');
              } catch (e) {}
              switchView('chat');
            }
            appendMessage('agent', msg.text);
          } else if (msg.type === 'chat:status') {
            const statusText = {
              working: 'Agent received · working in your IDE/TUI.',
              ready: 'Changes ready · review them in your IDE/TUI.',
            }[msg.status];
            if (statusText)
              setAgentStatus(statusText, msg.status === 'working' ? 'waiting' : 'connected');
          } else if (msg.type === 'chat:refresh') {
            appendMessage('agent', 'Page is refreshing...');
            if (settings.autoRefresh) {
              setTimeout(() => location.reload(), 300);
            }
          } else if (msg.type === 'settings:updated') {
            settings = { ...settings, ...msg.settings };
            try {
              localStorage.setItem('__viskod_settings', JSON.stringify(settings));
            } catch (e) {}
          }
        } catch {
          /* ignore malformed */
        }
      };
    }
    connect();

    // ── Overlay injection + event polling ──
    // Keep the page idle until selection mode is actually enabled.
    if (settings.selectionMode) {
      injectOverlay();
      startBridgePolling();
      setTimeout(() => {
        applySettings();
        selBtn.classList.add(`${PREFIX}active`);
        selBtn.innerHTML = `${CHECK_ICON} Selecting`;
      }, 1200);
    }

    function startBridgePolling() {
      if (bridgePoller) return;
      bridgePoller = setInterval(() => {
        const bridge = document.getElementById('__viskod_bridge');
        if (bridge?.textContent) {
          try {
            const event = JSON.parse(bridge.textContent);
            bridge.textContent = '';
            const deferredSelectionEvent = [
              'overlay:element-clicked',
              'overlay:element-deselected',
              'overlay:box-drag-completed',
              'overlay:selection-cleared',
            ].includes(event.type);
            if (!deferredSelectionEvent && ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'overlay:event', data: event }));
            }
            if (event.type === 'overlay:element-clicked' && event.data && onboardingDone) {
              // Don't send to chat yet — ask the user to confirm first
              pendingSelection = { type: 'element', data: event.data };
              showSelectionConfirm();
            }

            if (event.type === 'overlay:element-deselected' && event.data && onboardingDone) {
              const selectedElements = event.data.selectedElements || [];
              if (event.data.selectionCount > 0 && selectedElements.length > 0) {
                pendingSelection = { type: 'element', data: event.data };
                showSelectionConfirm();
              } else {
                pendingSelection = null;
                if (pendingConfirmBox) {
                  pendingConfirmBox.remove();
                  pendingConfirmBox = null;
                }
                updatePromptActions();
                broadcastSelectionState();
                setAgentStatus('Selection cleared · choose another box when ready.', 'connected');
              }
            }

            if (event.type === 'overlay:selection-cleared') {
              pendingSelection = null;
              if (pendingConfirmBox) {
                pendingConfirmBox.remove();
                pendingConfirmBox = null;
              }
              broadcastSelectionState();
            }

            // Box-drag: collect elements inside the drag rect and ask to confirm
            if (event.type === 'overlay:box-drag-completed' && event.data && onboardingDone) {
              const rect = event.data.viewportRect;
              if (rect) {
                const collected = collectBoxElements(rect);
                if (collected.length > 0) {
                  pendingSelection = { type: 'box', data: { rect, elements: collected } };
                  showSelectionConfirm();
                } else {
                  appendMessage(
                    'agent',
                    'No elements found inside the selection box. Drag over some content.',
                  );
                }
              }
            }
          } catch (e) {}
        }
      }, 200);
    }

    function stopBridgePolling() {
      if (bridgePoller) {
        clearInterval(bridgePoller);
        bridgePoller = null;
      }
    }

    buildOnboarding();
    if (onboardingDone) switchView('chat');
  }

  function injectOverlay() {
    if (document.getElementById('__viskod_overlay_root')) return;
    chrome.runtime.sendMessage({ type: 'inject-overlay' }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[Viskod] overlay injection failed:', chrome.runtime.lastError.message);
      } else if (!response?.ok) {
        console.warn('[Viskod] overlay injection failed:', response?.error || 'unknown error');
      }
    });
  }

  // Collect top-level elements intersecting the drag rect
  function collectBoxElements(rect) {
    const results = [];
    const all = document.querySelectorAll('body *');
    for (const el of all) {
      // Skip the overlay host and chat
      if (el.id?.startsWith('__viskod')) continue;
      if (el.closest?.('#__viskod_ext_host')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue; // skip tiny/invisible
      const overlap =
        r.left < rect.x + rect.width &&
        r.right > rect.x &&
        r.top < rect.y + rect.height &&
        r.bottom > rect.y;
      if (overlap) {
        // Only count if it's a substantial container, skip deeply nested text spans
        const tag = el.tagName.toLowerCase();
        if (['html', 'body'].includes(tag)) continue;
        if (tag === 'span' && !el.className) continue;
        // Limit to elements that are mostly inside the rect
        const interW = Math.min(r.right, rect.x + rect.width) - Math.max(r.left, rect.x);
        const interH = Math.min(r.bottom, rect.y + rect.height) - Math.max(r.top, rect.y);
        const interArea = interW * interH;
        const elArea = r.width * r.height;
        const ratio = elArea > 0 ? interArea / elArea : 0;
        if (ratio >= 0.5) {
          results.push({
            tagName: tag,
            selector: buildSelector(el),
            textPreview: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
            boundingBox: { x: r.x, y: r.y, width: r.width, height: r.height },
          });
        }
      }
    }
    // Deduplicate by selector, cap at 20
    const seen = new Set();
    const unique = [];
    for (const e of results) {
      if (!seen.has(e.selector)) {
        seen.add(e.selector);
        unique.push(e);
      }
      if (unique.length >= 20) break;
    }
    return unique.map((element, index) => ({
      ...element,
      selectionNumber: index + 1,
    }));
  }

  function buildSelector(el) {
    if (el.id) return `#${el.id}`;
    const cls = Array.from(el.classList).slice(0, 2).join('.');
    if (cls) return `${el.tagName.toLowerCase()}.${cls}`;
    return el.tagName.toLowerCase();
  }
})();
