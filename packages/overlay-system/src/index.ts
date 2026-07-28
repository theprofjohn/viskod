export interface OverlayState {
  visible: boolean;
  mode: 'hover' | 'selection' | 'diagnostics' | 'hidden';
  highlightedSelector?: string;
  highlightedBoundingBox?: { x: number; y: number; width: number; height: number };
  labelText?: string;
  diagnosticsVisible: boolean;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Generates the self-contained overlay injection script.
 * This string is injected into the inspected page by Browser Runtime via addScriptTag.
 *
 * Security: No module imports, no eval, no network access, no page globals access.
 * Isolation: Shadow DOM with closed mode, __viskod_ CSS prefix for all classes.
 */
export function getOverlayScript(): string {
  return `
(function() {
  if (document.getElementById('__viskod_overlay_root')) return;

  const PREFIX = '__viskod_';
  const host = document.createElement('div');
  host.id = PREFIX + 'overlay_root';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = \`
    .\${PREFIX}highlight-box {
      position: fixed; pointer-events: none; z-index: 2147483646;
      border: 2px solid #4A90D9; background: rgba(74, 144, 217, 0.1);
      transition: all 0.1s ease;
      box-sizing: border-box;
    }
    .\${PREFIX}highlight-box.\${PREFIX}hover {
      border-color: #90CAF9; background: rgba(144, 202, 249, 0.15);
    }
    .\${PREFIX}highlight-box.\${PREFIX}selection {
      border-color: #4A90D9; background: rgba(74, 144, 217, 0.2); border-width: 3px;
    }
    .\${PREFIX}label {
      position: fixed; pointer-events: none; z-index: 2147483647;
      background: #333; color: #fff; font: 11px monospace;
      padding: 2px 6px; border-radius: 3px; white-space: nowrap;
    }
    .\${PREFIX}event-layer {
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      z-index: 2147483645; pointer-events: none;
    }
    .\${PREFIX}event-layer.\${PREFIX}active {
      pointer-events: auto; cursor: crosshair;
    }
  \`;
  shadow.appendChild(style);

  const highlightBox = document.createElement('div');
  highlightBox.className = PREFIX + 'highlight-box';
  highlightBox.style.display = 'none';
  shadow.appendChild(highlightBox);

  const label = document.createElement('div');
  label.className = PREFIX + 'label';
  label.style.display = 'none';
  shadow.appendChild(label);

  const eventLayer = document.createElement('div');
  eventLayer.className = PREFIX + 'event-layer';
  shadow.appendChild(eventLayer);

  let mode = 'hidden';
  let currentSelector = null;

  function sendMessage(type, data) {
    window.postMessage({ source: '__viskod_overlay', type: type, data: data }, '*');
  }

  function getElementInfo(el) {
    const rect = el.getBoundingClientRect();
    return {
      selector: getSelector(el),
      boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      tagName: el.tagName.toLowerCase(),
    };
  }

  function getSelector(el) {
    if (el.id) return '#' + el.id;
    let path = [];
    while (el && el !== document.body) {
      let selector = el.tagName.toLowerCase();
      if (el.id) { path.unshift('#' + el.id); break; }
      if (el.className && typeof el.className === 'string') {
        const cls = el.className.trim().split(/\\s+/).filter(c => c && !c.startsWith('__viskod_')).slice(0, 2).join('.');
        if (cls) selector += '.' + cls;
      }
      path.unshift(selector);
      el = el.parentElement;
    }
    return path.join(' > ');
  }

  function highlightElement(selector, className) {
    try {
      const el = document.querySelector(selector);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      highlightBox.style.display = 'block';
      highlightBox.style.top = rect.top + 'px';
      highlightBox.style.left = rect.left + 'px';
      highlightBox.style.width = rect.width + 'px';
      highlightBox.style.height = rect.height + 'px';
      highlightBox.className = PREFIX + 'highlight-box ' + PREFIX + (className || 'hover');
      currentSelector = selector;
    } catch (e) { /* element not found — silently ignore */ }
  }

  function clearHighlight() {
    highlightBox.style.display = 'none';
    label.style.display = 'none';
    currentSelector = null;
  }

  function showLabel(text, x, y) {
    label.style.display = 'block';
    label.style.top = y + 'px';
    label.style.left = x + 'px';
    label.textContent = text;
  }

  // Event layer: capture pointer for hover and selection
  eventLayer.addEventListener('mousemove', function(e) {
    if (mode !== 'hover' && mode !== 'selection') return;
    // Hide overlay to get element underneath, then reshow
    highlightBox.style.display = 'none';
    const el = document.elementFromPoint(e.clientX, e.clientY);
    highlightBox.style.display = 'block';
    if (!el || el === host || host.contains(el)) return;
    highlightElement(getSelector(el), 'hover');
    showLabel(el.tagName.toLowerCase(), e.clientX + 12, e.clientY - 12);
    sendMessage('overlay:element-hovered', getElementInfo(el));
  });

  eventLayer.addEventListener('click', function(e) {
    if (mode !== 'selection') return;
    highlightBox.style.display = 'none';
    const el = document.elementFromPoint(e.clientX, e.clientY);
    highlightBox.style.display = 'block';
    if (!el || el === host || host.contains(el)) return;
    highlightElement(getSelector(el), 'selection');
    const info = getElementInfo(el);
    sendMessage('overlay:element-clicked', info);
    e.stopPropagation();
    e.preventDefault();
  });

  // Listen for commands from Browser Runtime
  window.addEventListener('message', function(event) {
    if (event.data && event.data.source === '__viskod_browser') {
      const cmd = event.data.command;
      if (cmd === 'overlay:show') {
        mode = event.data.mode || 'hover';
        eventLayer.classList.add(PREFIX + 'active');
        sendMessage('overlay:ready', {});
      } else if (cmd === 'overlay:hide') {
        mode = 'hidden';
        eventLayer.classList.remove(PREFIX + 'active');
        clearHighlight();
      } else if (cmd === 'overlay:highlight') {
        highlightElement(event.data.selector, 'selection');
        if (event.data.label) showLabel(event.data.label, event.data.x || 0, event.data.y || 0);
      } else if (cmd === 'overlay:clear') {
        clearHighlight();
      }
    }
  });

  sendMessage('overlay:ready', {});
})();
`;
}

/**
 * Get the cleanup script that removes all overlay artifacts.
 * Called by BrowserRuntime.removeOverlay().
 */
export function getOverlayCleanupScript(): string {
  return `
(function() {
  var root = document.getElementById('__viskod_overlay_root');
  if (root) { root.remove(); }
})();
`;
}

/**
 * Create a SelectionTarget from an overlay element-clicked event payload.
 * This is the P0 interface — when SPEC-011 (selection-engine) is approved,
 * SelectionTarget enriches with validation, scores, and hierarchy.
 */
export function toSelectionTarget(data: {
  selector: string;
  boundingBox: BoundingBox;
  tagName: string;
}): { selector: string; boundingBox: BoundingBox; tagName: string } {
  return {
    selector: data.selector,
    boundingBox: data.boundingBox,
    tagName: data.tagName,
  };
}
