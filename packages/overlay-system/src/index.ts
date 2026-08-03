export interface OverlayState {
  visible: boolean;
  mode: 'hover' | 'selection' | 'box-select' | 'diagnostics' | 'hidden';
  highlightedSelector?: string;
  highlightedBoundingBox?: { x: number; y: number; width: number; height: number };
  labelText?: string;
  diagnosticsVisible: boolean;
  hasSelection: boolean;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const OVERLAY_SCRIPT = `
(function() {
  if (document.getElementById('__viskod_overlay_root')) return;

  var PREFIX = '__viskod_';
  var host = document.createElement('div');
  host.id = PREFIX + 'overlay_root';
  host.style.cssText = 'position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;overflow:visible!important;z-index:2147483647!important;pointer-events:none!important;isolation:isolate!important;';
  document.documentElement.appendChild(host);

  var shadow = host.attachShadow({ mode: 'closed' });

  var prefersReducedMotion = false;
  try { prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch(e) {}

  // motion-design layers — primary (highlight), secondary (badge), ambient (indicator)
  // timing from motion-principles: hover 100ms, selection 200ms, confirmation 300ms
  // only transform/opacity animated — never layout properties
  var tHighlight = prefersReducedMotion ? 'none' : 'transform 0.1s ease-out, opacity 0.1s ease-out, border-color 0.15s ease-out, background 0.15s ease-out';
  var tBadge = prefersReducedMotion ? 'none' : 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease-out';
  var tConfirm = prefersReducedMotion ? 'none' : 'transform 0.3s ease-out, opacity 0.3s ease-out';
  var tIndicator = prefersReducedMotion ? 'none' : 'opacity 0.2s ease-out';

  var style = document.createElement('style');
  style.textContent = [
    '.' + PREFIX + 'highlight-box {',
      'position: fixed; pointer-events: none; z-index: 2147483646;',
      'border: 2px solid #4A90D9; background: rgba(74, 144, 217, 0.1);',
      'box-sizing: border-box; will-change: transform, opacity;',
      'left: 0; top: 0; width: 0; height: 0; opacity: 0;',
      'transition: ' + tHighlight + ';',
    '}',
    '.' + PREFIX + 'highlight-box.' + PREFIX + 'visible { opacity: 1; }',
    '.' + PREFIX + 'highlight-box.' + PREFIX + 'hover {',
      'border-color: #90CAF9; background: rgba(144, 202, 249, 0.15); border-style: dashed;',
    '}',
    '.' + PREFIX + 'highlight-box.' + PREFIX + 'selection {',
      'border-color: #4A90D9; background: rgba(74, 144, 217, 0.2); border-width: 3px; border-style: solid;',
    '}',
    '.' + PREFIX + 'highlight-box.' + PREFIX + 'selected {',
      'border-color: #22C55E; background: rgba(34, 197, 94, 0.12); border-width: 3px; border-style: solid;',
    '}',
    '.' + PREFIX + 'label {',
      'position: fixed; pointer-events: none; z-index: 2147483647;',
      'background: rgba(17, 24, 39, 0.92); color: #fff;',
      'font: 500 11px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
      'padding: 5px 10px; border-radius: 6px; white-space: nowrap; max-width: 300px;',
      'overflow: hidden; text-overflow: ellipsis;',
      'box-shadow: 0 2px 8px rgba(0,0,0,0.25); backdrop-filter: blur(4px);',
      'opacity: 0; transition: ' + tIndicator + ';',
    '}',
    '.' + PREFIX + 'label.' + PREFIX + 'visible { opacity: 1; }',
    '.' + PREFIX + 'event-layer {',
      'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;',
      'z-index: 2147483645; pointer-events: none;',
    '}',
    '.' + PREFIX + 'event-layer.' + PREFIX + 'active {',
      'pointer-events: auto; cursor: crosshair;',
    '}',
    '.' + PREFIX + 'drag-rect {',
      'position: fixed; pointer-events: none; z-index: 2147483646;',
      'border: 2px dashed #4A90D9; background: rgba(74, 144, 217, 0.08);',
      'box-sizing: border-box; opacity: 0;',
      'transition: opacity 0.1s ease-out;',
    '}',
    '.' + PREFIX + 'drag-rect.' + PREFIX + 'visible { opacity: 1; }',
    '.' + PREFIX + 'selection-badge {',
      'position: fixed; pointer-events: none; z-index: 2147483647;',
      'background: #22C55E; color: #fff; font: bold 14px -apple-system, BlinkMacSystemFont, sans-serif;',
      'width: 22px; height: 22px; border-radius: 50%;',
      'display: flex; align-items: center; justify-content: center; line-height: 1;',
      'opacity: 0; transform: scale(0); will-change: transform, opacity;',
      'transition: ' + tBadge + ';',
    '}',
    '.' + PREFIX + 'selection-badge.' + PREFIX + 'visible { opacity: 1; transform: scale(1); }',
    '.' + PREFIX + 'selection-indicator {',
      'position: fixed; top: 10px; right: 10px; z-index: 2147483647;',
      'background: rgba(15, 23, 42, 0.9); color: #fff;',
      'font: 500 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
      'padding: 7px 12px; border-radius: 8px; pointer-events: none;',
      'backdrop-filter: blur(6px); opacity: 0;',
      'box-shadow: 0 2px 12px rgba(0,0,0,0.3);',
      'display: flex; align-items: center; gap: 8px;',
      'transition: ' + tIndicator + ';',
    '}',
    '.' + PREFIX + 'selection-indicator.' + PREFIX + 'visible { opacity: 1; }',
    '.' + PREFIX + 'selection-indicator-dot {',
      'width: 8px; height: 8px; border-radius: 50%; background: #6366F1; flex-shrink: 0;',
    '}',
    '.' + PREFIX + 'confirmation {',
      'position: fixed; bottom: 16px; left: 50%;',
      'z-index: 2147483647; background: rgba(15, 23, 42, 0.92);',
      'color: #fff; font: 500 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
      'padding: 9px 18px; border-radius: 10px; pointer-events: none;',
      'backdrop-filter: blur(6px); gap: 12px; align-items: center;',
      'white-space: nowrap; opacity: 0; will-change: transform, opacity;',
      'box-shadow: 0 4px 20px rgba(0,0,0,0.35);',
      'transform: translateX(-50%) translateY(8px);',
      'transition: ' + tConfirm + ';',
    '}',
    '.' + PREFIX + 'confirmation.' + PREFIX + 'visible {',
      'opacity: 1; transform: translateX(-50%) translateY(0); pointer-events: auto;',
    '}',
    '.' + PREFIX + 'confirmation-btn {',
      'background: rgba(255, 255, 255, 0.15); border: none; color: #fff;',
      'font: 500 12px/1.4 -apple-system, BlinkMacSystemFont, sans-serif; padding: 5px 12px;',
      'border-radius: 6px; cursor: pointer; transition: background 0.1s ease-out;',
    '}',
    '.' + PREFIX + 'confirmation-btn:hover {',
      'background: rgba(255, 255, 255, 0.28);',
    '}',
    '.' + PREFIX + 'confirmation-text {',
      'pointer-events: none; max-width: 260px; overflow: hidden; text-overflow: ellipsis;',
    '}',
    // Diagnostics layer — bounding boxes and spacing visualization
    '.' + PREFIX + 'diag-layer {',
      'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;',
      'z-index: 2147483644; pointer-events: none; display: none;',
    '}',
    '.' + PREFIX + 'diag-layer.' + PREFIX + 'visible { display: block; }',
    '.' + PREFIX + 'diag-box {',
      'position: fixed; pointer-events: none;',
      'border: 1px dashed rgba(74, 144, 217, 0.4);',
      'background: rgba(74, 144, 217, 0.04);',
      'box-sizing: border-box;',
    '}',
    '.' + PREFIX + 'diag-margin {',
      'position: fixed; pointer-events: none;',
      'background: rgba(239, 68, 68, 0.08);',
      'box-sizing: border-box;',
    '}',
    '.' + PREFIX + 'diag-padding {',
      'position: fixed; pointer-events: none;',
      'background: rgba(34, 197, 94, 0.08);',
      'box-sizing: border-box;',
    '}',
    '.' + PREFIX + 'diag-spacing {',
      'position: fixed; pointer-events: none;',
      'box-sizing: border-box;',
    '}',
    '.' + PREFIX + 'diag-spacing-label {',
      'position: fixed; pointer-events: none; z-index: 2147483647;',
      'background: rgba(249, 115, 22, 0.9); color: #fff;',
      'font: bold 10px -apple-system, BlinkMacSystemFont, sans-serif;',
      'padding: 1px 4px; border-radius: 2px; white-space: nowrap;',
    '}',
  ].join('\\n');
  shadow.appendChild(style);

  var highlightBox = shadow.appendChild(document.createElement('div'));
  highlightBox.className = PREFIX + 'highlight-box';
  var selectedHighlightBoxes = [];
  var selectedBadges = [];

  var label = shadow.appendChild(document.createElement('div'));
  label.className = PREFIX + 'label';
  label.setAttribute('role', 'tooltip');

  var dragRect = shadow.appendChild(document.createElement('div'));
  dragRect.className = PREFIX + 'drag-rect';

  var selectionBadge = shadow.appendChild(document.createElement('div'));
  selectionBadge.className = PREFIX + 'selection-badge';
  selectionBadge.textContent = '\\u2713';
  selectionBadge.setAttribute('aria-hidden', 'true');

  var selectionIndicator = shadow.appendChild(document.createElement('div'));
  selectionIndicator.className = PREFIX + 'selection-indicator';
  selectionIndicator.setAttribute('role', 'status');
  selectionIndicator.setAttribute('aria-live', 'polite');
  var selIndicatorDot = selectionIndicator.appendChild(document.createElement('span'));
  selIndicatorDot.className = PREFIX + 'selection-indicator-dot';
  var selIndicatorText = selectionIndicator.appendChild(document.createElement('span'));
  selIndicatorText.textContent = 'Selection mode \\u00B7 Click or drag \\u00B7 Esc to exit';

  var confirmation = shadow.appendChild(document.createElement('div'));
  confirmation.className = PREFIX + 'confirmation';
  confirmation.setAttribute('role', 'toolbar');
  confirmation.setAttribute('aria-label', 'Selection actions');
  var confirmationText = confirmation.appendChild(document.createElement('span'));
  confirmationText.className = PREFIX + 'confirmation-text';
  var clearBtn = confirmation.appendChild(document.createElement('button'));
  clearBtn.className = PREFIX + 'confirmation-btn';
  clearBtn.textContent = 'Clear';
  clearBtn.setAttribute('aria-label', 'Clear selection');
  var exitBtn = confirmation.appendChild(document.createElement('button'));
  exitBtn.className = PREFIX + 'confirmation-btn';
  exitBtn.textContent = 'Exit';
  exitBtn.setAttribute('aria-label', 'Exit selection mode');

  var eventLayer = shadow.querySelector('.' + PREFIX + 'event-layer');
  if (!eventLayer) {
    eventLayer = shadow.appendChild(document.createElement('div'));
    eventLayer.className = PREFIX + 'event-layer';
  }

  var diagLayer = shadow.appendChild(document.createElement('div'));
  diagLayer.className = PREFIX + 'diag-layer';

  var mode = 'hidden';
  var isDragging = false;
  var dragStart = null;
  var hasSelection = false;
  var selectedElements = []; // array of { el, info, key, number } for multi-select
  var currentElementInfo = null;
  var lastHoveredElement = null;
  var throttleTimer = null;
  var diagnosticsOn = false;
  var diagOptions = { showBoundingBoxes: true, showSpacing: false };
  var overlaySettings = {
    multiSelect: true,
    boxSelect: true,
    hoverHighlight: true,
    diagnosticsOverlay: false,
    spacingVisualization: false,
  };

  function sendMessage(type, data) {
    window.postMessage({ source: '__viskod_overlay', type: type, data: data }, '*');
    // Write to shared DOM element for content script to read (bridges isolation gap)
    try {
      var bridge = document.getElementById('__viskod_bridge');
      if (!bridge) {
        bridge = document.createElement('div');
        bridge.id = '__viskod_bridge';
        bridge.style.display = 'none';
        document.body.appendChild(bridge);
      }
      bridge.textContent = JSON.stringify({ type: type, data: data });
    } catch(e) {}
  }

  // Listen for commands from content script via DOM polling
  setInterval(function() {
    try {
      var cmd = document.getElementById('__viskod_cmd');
      if (cmd && cmd.textContent) {
        var parsed = JSON.parse(cmd.textContent);
        cmd.textContent = '';
        if (parsed.command === 'overlay:show') {
          applyOverlaySettings(parsed.settings);
          setMode(parsed.mode || 'hover');
          sendMessage('overlay:ready', {});
        } else if (parsed.command === 'overlay:hide') {
          isDragging = false;
          dragStart = null;
          hideDragRect();
          hideConfirmation();
          clearSelectedVisuals();
          hideSelectionIndicator();
          setMode('hidden');
          clearHighlight();
          selectedElements = [];
          hasSelection = false;
        }
      }
    } catch(e) {}
  }, 100);

  function getElementInfo(el, includeDocumentOrder) {
    var rect = el.getBoundingClientRect();
    var tagName = el.tagName.toLowerCase();
    var role = el.getAttribute('role') || undefined;
    var accessibleName = el.getAttribute('aria-label') || undefined;
    var textPreview = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120) || undefined;
    var isInteractive = (
      tagName === 'button' || tagName === 'a' || tagName === 'input' ||
      tagName === 'select' || tagName === 'textarea' ||
      el.getAttribute('onclick') !== null ||
      el.getAttribute('role') === 'button' ||
      el.tabIndex >= 0
    );
    var attrs = {};
    var stableKeys = ['data-testid', 'data-test-id', 'data-id', 'data-cy', 'data-test', 'id', 'name', 'aria-label', 'type'];
    for (var i = 0; i < stableKeys.length; i++) {
      var v = el.getAttribute(stableKeys[i]);
      if (v) attrs[stableKeys[i]] = v;
    }
    var ancestors = [];
    var p = el.parentElement;
    var depth = 0;
    while (p && p !== document.body && p !== document.documentElement && depth < 10) {
      ancestors.push(p.tagName.toLowerCase());
      p = p.parentElement;
      depth++;
    }
    return {
      tagName: tagName,
      boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      role: role,
      accessibleName: accessibleName,
      textPreview: textPreview,
      isInteractive: isInteractive,
      stableAttributes: Object.keys(attrs).length > 0 ? attrs : undefined,
      ancestorTags: ancestors.length > 0 ? ancestors : undefined,
      documentOrder: includeDocumentOrder === false ? -1 : getDocumentOrder(el),
    };
  }

  function getDocumentOrder(el) {
    var order = 0;
    var walker = document.createTreeWalker(document.body, 4, null, false);
    var node;
    while (node = walker.nextNode()) {
      if (node === el) return order;
      order++;
    }
    return -1;
  }

  function showHighlight(box, text, className) {
    highlightBox.style.left = box.x + 'px';
    highlightBox.style.top = box.y + 'px';
    highlightBox.style.width = box.width + 'px';
    highlightBox.style.height = box.height + 'px';
    var cls = PREFIX + 'highlight-box ' + PREFIX + 'visible ' + PREFIX + (className || 'hover');
    highlightBox.className = cls;
    if (text) {
      var lx = Math.min(box.x + box.width + 8, window.innerWidth - 310);
      var ly = Math.max(box.y - 22, 4);
      label.style.top = ly + 'px';
      label.style.left = lx + 'px';
      label.textContent = text;
      label.classList.add(PREFIX + 'visible');
    } else {
      label.classList.remove(PREFIX + 'visible');
    }
  }

  function clearHighlight() {
    highlightBox.classList.remove(PREFIX + 'visible');
    label.classList.remove(PREFIX + 'visible');
    currentElementInfo = null;
    lastHoveredElement = null;
  }

  function showDragRect(x1, y1, x2, y2) {
    var left = Math.min(x1, x2);
    var top = Math.min(y1, y2);
    var width = Math.abs(x2 - x1);
    var height = Math.abs(y2 - y1);
    dragRect.style.left = left + 'px';
    dragRect.style.top = top + 'px';
    dragRect.style.width = width + 'px';
    dragRect.style.height = height + 'px';
    dragRect.classList.add(PREFIX + 'visible');
  }

  function hideDragRect() {
    dragRect.classList.remove(PREFIX + 'visible');
  }

  function showSelectionBadge(box) {
    selectionBadge.style.top = (box.y - 11) + 'px';
    selectionBadge.style.left = (box.x + box.width - 11) + 'px';
    selectionBadge.classList.add(PREFIX + 'visible');
  }

  function hideSelectionBadge() {
    selectionBadge.classList.remove(PREFIX + 'visible');
  }

  function clearSelectedVisuals() {
    for (var i = 0; i < selectedHighlightBoxes.length; i++) {
      selectedHighlightBoxes[i].remove();
    }
    for (var j = 0; j < selectedBadges.length; j++) {
      selectedBadges[j].remove();
    }
    selectedHighlightBoxes = [];
    selectedBadges = [];
    hideSelectionBadge();
  }

  function renderSelectedElements() {
    clearSelectedVisuals();
    var active = [];

    for (var i = 0; i < selectedElements.length; i++) {
      var selected = selectedElements[i];
      if (!selected || !selected.info) continue;

      var info = selected.info;
      if (selected.el && selected.el.isConnected) {
        info = getElementInfo(selected.el);
        selected.info = info;
      }
      active.push(selected);

      var box = shadow.appendChild(document.createElement('div'));
      box.className = PREFIX + 'highlight-box ' + PREFIX + 'visible ' + PREFIX + 'selected';
      box.style.left = info.boundingBox.x + 'px';
      box.style.top = info.boundingBox.y + 'px';
      box.style.width = info.boundingBox.width + 'px';
      box.style.height = info.boundingBox.height + 'px';
      box.setAttribute('aria-hidden', 'true');
      selectedHighlightBoxes.push(box);

      var badge = shadow.appendChild(document.createElement('div'));
      badge.className = PREFIX + 'selection-badge ' + PREFIX + 'visible';
      badge.textContent = String(selected.number);
      badge.style.top = (info.boundingBox.y - 11) + 'px';
      badge.style.left = (info.boundingBox.x + info.boundingBox.width - 11) + 'px';
      badge.setAttribute('aria-hidden', 'true');
      selectedBadges.push(badge);
    }

    selectedElements = active;
    hasSelection = active.length > 0;
  }

  function showConfirmation(text) {
    confirmationText.textContent = text;
    confirmation.classList.add(PREFIX + 'visible');
  }

  function hideConfirmation() {
    confirmation.classList.remove(PREFIX + 'visible');
  }

  function showSelectionIndicator() {
    selectionIndicator.classList.add(PREFIX + 'visible');
  }

  function hideSelectionIndicator() {
    selectionIndicator.classList.remove(PREFIX + 'visible');
  }

  // diagnostics overlay — bounding boxes + spacing visualization
  // spec: overlay:diagnostics { show, showBoundingBoxes, showSpacing }
  function clearDiagnostics() {
    diagLayer.innerHTML = '';
    diagLayer.classList.remove(PREFIX + 'visible');
    diagnosticsOn = false;
  }

  function showDiagnostics(opts) {
    clearDiagnostics();
    diagnosticsOn = true;
    diagOptions.showBoundingBoxes = opts.showBoundingBoxes !== false;
    diagOptions.showSpacing = opts.showSpacing === true;
    diagLayer.classList.add(PREFIX + 'visible');

    // Walk visible elements and draw bounding boxes
    var elements = document.querySelectorAll('body > *');
    var prevRect = null;

    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (el === host || host.contains(el)) continue;
      if (el.getAttribute && el.getAttribute('data-viskod-overlay') !== null) continue;

      var rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
      if (rect.right < 0 || rect.left > window.innerWidth) continue;

      var cs = window.getComputedStyle(el);

      if (diagOptions.showBoundingBoxes) {
        // Content box
        var box = document.createElement('div');
        box.className = PREFIX + 'diag-box';
        box.style.left = rect.left + 'px';
        box.style.top = rect.top + 'px';
        box.style.width = rect.width + 'px';
        box.style.height = rect.height + 'px';
        diagLayer.appendChild(box);

        // Margin (red)
        var mt = parseFloat(cs.marginTop) || 0;
        var mr = parseFloat(cs.marginRight) || 0;
        var mb = parseFloat(cs.marginBottom) || 0;
        var ml = parseFloat(cs.marginLeft) || 0;
        if (mt || mr || mb || ml) {
          var mg = document.createElement('div');
          mg.className = PREFIX + 'diag-margin';
          mg.style.left = (rect.left - ml) + 'px';
          mg.style.top = (rect.top - mt) + 'px';
          mg.style.width = (rect.width + ml + mr) + 'px';
          mg.style.height = (rect.height + mt + mb) + 'px';
          mg.style.borderLeft = ml ? '2px solid rgba(239,68,68,0.3)' : 'none';
          mg.style.borderRight = mr ? '2px solid rgba(239,68,68,0.3)' : 'none';
          mg.style.borderTop = mt ? '2px solid rgba(239,68,68,0.3)' : 'none';
          mg.style.borderBottom = mb ? '2px solid rgba(239,68,68,0.3)' : 'none';
          diagLayer.appendChild(mg);
        }

        // Padding (green)
        var pt = parseFloat(cs.paddingTop) || 0;
        var pr = parseFloat(cs.paddingRight) || 0;
        var pb = parseFloat(cs.paddingBottom) || 0;
        var pl = parseFloat(cs.paddingLeft) || 0;
        if (pt || pr || pb || pl) {
          var pg = document.createElement('div');
          pg.className = PREFIX + 'diag-padding';
          pg.style.left = (rect.left + pl) + 'px';
          pg.style.top = (rect.top + pt) + 'px';
          pg.style.width = (rect.width - pl - pr) + 'px';
          pg.style.height = (rect.height - pt - pb) + 'px';
          diagLayer.appendChild(pg);
        }
      }

      // Spacing between adjacent elements
      if (diagOptions.showSpacing && prevRect) {
        var gapX = rect.left - prevRect.right;
        var gapY = rect.top - prevRect.bottom;
        if (gapX > 0 && gapX < 200 && Math.abs(gapY) < 5) {
          var lbl = document.createElement('div');
          lbl.className = PREFIX + 'diag-spacing-label';
          lbl.textContent = Math.round(gapX) + 'px';
          lbl.style.left = (prevRect.right + gapX / 2 - 12) + 'px';
          lbl.style.top = (prevRect.top + prevRect.height / 2 - 7) + 'px';
          diagLayer.appendChild(lbl);

          var line = document.createElement('div');
          line.className = PREFIX + 'diag-spacing';
          line.style.left = prevRect.right + 'px';
          line.style.top = (prevRect.top + prevRect.height / 2) + 'px';
          line.style.width = gapX + 'px';
          line.style.height = '1px';
          line.style.background = 'rgba(249,115,22,0.5)';
          diagLayer.appendChild(line);
        }
      }

      prevRect = rect;
    }
  }

  function applyOverlaySettings(settings) {
    if (settings) {
      // Multi-select is the default interaction. Modifier keys are not required.
      overlaySettings.multiSelect = true;
      overlaySettings.boxSelect = settings.boxSelect !== false;
      overlaySettings.hoverHighlight = settings.hoverHighlight !== false;
      overlaySettings.diagnosticsOverlay = settings.diagnosticsOverlay === true;
      overlaySettings.spacingVisualization = settings.spacingVisualization === true;
    }

    var showDiagnosticsLayer = overlaySettings.diagnosticsOverlay || overlaySettings.spacingVisualization;
    if (showDiagnosticsLayer) {
      showDiagnostics({
        showBoundingBoxes: overlaySettings.diagnosticsOverlay,
        showSpacing: overlaySettings.spacingVisualization,
      });
    } else if (diagnosticsOn) {
      clearDiagnostics();
    }
  }

  function setMode(newMode) {
    mode = newMode;
    if (mode === 'hover' || mode === 'selection') {
      // Track pointer for highlight/hover, but only selection blocks clicks
      eventLayer.classList.add(PREFIX + 'active');
      if (mode === 'selection') showSelectionIndicator();
      else hideSelectionIndicator();
    } else if (mode === 'box-select') {
      eventLayer.classList.add(PREFIX + 'active');
    } else {
      eventLayer.classList.remove(PREFIX + 'active');
      hideSelectionIndicator();
    }
  }

  function getTargetElement(clientX, clientY) {
    highlightBox.classList.remove(PREFIX + 'visible');
    var savedPE = eventLayer.style.pointerEvents;
    eventLayer.style.pointerEvents = 'none';
    var el = document.elementFromPoint(clientX, clientY);
    eventLayer.style.pointerEvents = savedPE;
    if (hasSelection) highlightBox.classList.add(PREFIX + 'visible');
    if (!el) return null;
    if (el === host || host.contains(el)) return null;
    if (el.getAttribute && el.getAttribute('data-viskod-overlay') !== null) return null;
    return el;
  }

  function handlePointerMove(clientX, clientY) {
    if (mode !== 'hover' && mode !== 'selection') return;
    if (isDragging) return;
    if (!overlaySettings.hoverHighlight) {
      clearHighlight();
      return;
    }
    var el = getTargetElement(clientX, clientY);
    if (!el) {
      lastHoveredElement = null;
      clearHighlight();
      return;
    }
    if (el === lastHoveredElement) return;

    lastHoveredElement = el;
    var info = getElementInfo(el, false);
    currentElementInfo = info;
    showHighlight(info.boundingBox, info.tagName + (info.textPreview ? ' \\u00B7 ' + info.textPreview : ''), 'hover');
    sendMessage('overlay:element-hovered', info);
  }

  function getSelectionKey(info) {
    return String(info.documentOrder) + ':' + info.tagName;
  }

  function renumberSelectedElements() {
    for (var i = 0; i < selectedElements.length; i++) {
      selectedElements[i].number = i + 1;
    }
  }

  function handleClick(clientX, clientY) {
    if (mode !== 'selection') return;
    if (isDragging) return;

    var el = getTargetElement(clientX, clientY);
    if (!el) return;

    var info = getElementInfo(el);
    currentElementInfo = info;
    var selectionKey = getSelectionKey(info);
    var existingIdx = -1;
    for (var i = 0; i < selectedElements.length; i++) {
      if (selectedElements[i].key === selectionKey) { existingIdx = i; break; }
    }

    var wasDeselected = existingIdx >= 0;
    if (wasDeselected) {
      selectedElements.splice(existingIdx, 1);
      renumberSelectedElements();
    } else if (selectedElements.length === 0 || overlaySettings.multiSelect) {
      selectedElements.push({ el: el, info: info, key: selectionKey, number: selectedElements.length + 1 });
    } else {
      selectedElements = [{ el: el, info: info, key: selectionKey, number: 1 }];
    }

    var count = selectedElements.length;
    hasSelection = count > 0;
    var allInfos = selectedElements.map(function(s) {
      return Object.assign({}, s.info, { selectionNumber: s.number });
    });
    var selectionMsg = {};
    for (var k in info) { if (info.hasOwnProperty(k)) selectionMsg[k] = info[k]; }
    selectionMsg.multi = count > 1;
    selectionMsg.selectionCount = count;
    selectionMsg.selectedElements = allInfos;

    if (!hasSelection) {
      clearHighlight();
      clearSelectedVisuals();
      hideConfirmation();
      sendMessage('overlay:element-deselected', selectionMsg);
      return;
    }

    clearHighlight();
    renderSelectedElements();
    count = selectedElements.length;
    if (count > 1) {
      showConfirmation(count + ' elements selected \\u00B7 click a highlighted element to remove');
    } else {
      showConfirmation('1 element selected \\u00B7 click it again to remove');
    }

    selectionMsg.selectionCount = count;
    selectionMsg.selectedElements = selectedElements.map(function(s) {
      return Object.assign({}, s.info, { selectionNumber: s.number });
    });
    sendMessage(wasDeselected ? 'overlay:element-deselected' : 'overlay:element-clicked', selectionMsg);
  }

  function handlePointerDown(clientX, clientY) {
    if (mode !== 'selection') return;
    // Allow starting a new drag/click even when a selection exists (for multi-select)
    if (clientX === undefined) return;

    dragStart = { x: clientX, y: clientY };
    isDragging = false;
    if (!overlaySettings.boxSelect) return;
    showDragRect(clientX, clientY, clientX, clientY);
    setMode('box-select');
  }

  function handlePointerMoveDrag(clientX, clientY) {
    if (!dragStart || !overlaySettings.boxSelect) return;
    var dx = clientX - dragStart.x;
    var dy = clientY - dragStart.y;
    if (!isDragging && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
      isDragging = true;
    }
    if (isDragging) {
      showDragRect(dragStart.x, dragStart.y, clientX, clientY);
    }
  }

  function handlePointerUp(clientX, clientY) {
    if (!dragStart) { isDragging = false; return; }

    if (!overlaySettings.boxSelect) {
      var clickStart = dragStart;
      dragStart = null;
      isDragging = false;
      if (Math.abs(clientX - clickStart.x) <= 5 && Math.abs(clientY - clickStart.y) <= 5) {
        handleClick(clientX, clientY);
      }
      return;
    }

    if (!isDragging && dragStart) {
      hideDragRect();
      setMode('selection');
      if (Math.abs(clientX - dragStart.x) <= 5 && Math.abs(clientY - dragStart.y) <= 5) {
        handleClick(clientX, clientY);
      }
      dragStart = null;
      isDragging = false;
      return;
    }

    if (isDragging) {
      var left = Math.min(dragStart.x, clientX);
      var top = Math.min(dragStart.y, clientY);
      var width = Math.abs(clientX - dragStart.x);
      var height = Math.abs(clientY - dragStart.y);

      hideDragRect();

      if (width > 5 && height > 5) {
        hasSelection = true;
        var dragInfo = {
          viewportRect: { x: left, y: top, width: width, height: height },
          startX: dragStart.x,
          startY: dragStart.y,
          endX: clientX,
          endY: clientY,
        };
        showConfirmation('Box selection \\u00B7 ' + Math.round(width) + '\\u00D7' + Math.round(height));
        sendMessage('overlay:box-drag-completed', dragInfo);
      }

      dragStart = null;
      isDragging = false;
      setMode('selection');
    }
  }

  function clearSelection() {
    hasSelection = false;
    selectedElements = [];
    clearHighlight();
    clearSelectedVisuals();
    hideConfirmation();
    sendMessage('overlay:selection-cleared', {});
  }

  eventLayer.addEventListener('pointermove', function(e) {
    if (throttleTimer) return;
    throttleTimer = setTimeout(function() { throttleTimer = null; }, 16);
    if (isDragging || dragStart) {
      handlePointerMoveDrag(e.clientX, e.clientY);
    } else {
      handlePointerMove(e.clientX, e.clientY);
    }
  });

  eventLayer.addEventListener('pointerdown', function(e) {
    if (mode !== 'selection') return;
    e.stopPropagation();
    e.preventDefault();
    handlePointerDown(e.clientX, e.clientY);
  });

  eventLayer.addEventListener('pointerup', function(e) {
    if (mode !== 'selection' && mode !== 'box-select') return;
    e.stopPropagation();
    e.preventDefault();
    handlePointerUp(e.clientX, e.clientY);
  });

  eventLayer.addEventListener('pointercancel', function(e) {
    dragStart = null;
    isDragging = false;
    hideDragRect();
    setMode('selection');
  });

  clearBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    clearSelection();
  });

  exitBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    sendMessage('overlay:exit-requested', {});
  });

  document.addEventListener('keydown', function(e) {
    if (mode === 'hidden') return;
    if (e.key === 'Escape') {
      if (isDragging || dragStart) {
        isDragging = false;
        dragStart = null;
        hideDragRect();
        setMode('selection');
        e.preventDefault();
      } else if (hasSelection) {
        clearSelection();
        e.preventDefault();
      } else {
        sendMessage('overlay:exit-requested', {});
        e.preventDefault();
      }
    }
  });

  // Keep selected boxes aligned after scrolling by recalculating their live DOM rects.
  window.addEventListener('scroll', function() {
    lastHoveredElement = null;
    if (hasSelection) {
      clearHighlight();
      renderSelectedElements();
    }
  }, { passive: true });
  window.addEventListener('message', function(event) {
    if (event.data && event.data.source === '__viskod_browser') {
      var cmd = event.data.command;
      if (cmd === 'overlay:show') {
        setMode(event.data.mode || 'hover');
        sendMessage('overlay:ready', {});
      } else if (cmd === 'overlay:hide') {
        isDragging = false;
        dragStart = null;
        hideDragRect();
        hideConfirmation();
        clearSelectedVisuals();
        hideSelectionIndicator();
         setMode('hidden');
         clearHighlight();
         selectedElements = [];
         hasSelection = false;
      } else if (cmd === 'overlay:highlight') {
        var sel = event.data.selector;
        if (sel) {
          try {
            var el = document.querySelector(sel);
            if (el) {
              var rect = el.getBoundingClientRect();
              showHighlight({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }, event.data.label, 'selection');
            }
          } catch(e) {}
        }
      } else if (cmd === 'overlay:clear') {
        clearHighlight();
      } else if (cmd === 'overlay:set-selection') {
        if (event.data.selectionInfo) {
          hasSelection = true;
          var si = event.data.selectionInfo;
          showHighlight(si.boundingBox, si.label, 'selection');
          showSelectionBadge(si.boundingBox);
          showConfirmation(si.label);
        }
      } else if (cmd === 'overlay:set-selection-targets') {
        var incomingTargets = Array.isArray(event.data.targets) ? event.data.targets : [];
        selectedElements = incomingTargets
          .filter(function(info) { return info && info.boundingBox; })
          .map(function(info, index) { return { el: null, info: info, key: getSelectionKey(info), number: index + 1 }; });
        renderSelectedElements();
        if (selectedElements.length > 0) {
          showConfirmation(selectedElements.length + ' elements selected \\u00B7 click a highlighted element to remove');
        } else {
          hideConfirmation();
        }
      } else if (cmd === 'overlay:clear-selection') {
        clearSelection();
      } else if (cmd === 'overlay:diagnostics') {
        if (event.data.show) {
          showDiagnostics({
            showBoundingBoxes: event.data.showBoundingBoxes !== false,
            showSpacing: event.data.showSpacing === true,
          });
          sendMessage('overlay:diagnostics-shown', {
            showBoundingBoxes: diagOptions.showBoundingBoxes,
            showSpacing: diagOptions.showSpacing,
          });
        } else {
          clearDiagnostics();
          sendMessage('overlay:diagnostics-hidden', {});
        }
      }
    }
  });

  sendMessage('overlay:ready', {});
})();
`;

export function getOverlayScript(): string {
  return OVERLAY_SCRIPT;
}

export function getOverlayCleanupScript(): string {
  return `
(function() {
  var root = document.getElementById('__viskod_overlay_root');
  if (root) { root.remove(); }
})();
`;
}

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
