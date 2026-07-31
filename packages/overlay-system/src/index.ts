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
  document.body.appendChild(host);

  var shadow = host.attachShadow({ mode: 'closed' });

  var prefersReducedMotion = false;
  try { prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch(e) {}

  var style = document.createElement('style');
  style.textContent = [
    '.' + PREFIX + 'highlight-box {',
      'position: fixed; pointer-events: none; z-index: 2147483646;',
      'border: 2px solid #4A90D9; background: rgba(74, 144, 217, 0.1);',
      prefersReducedMotion ? '' : 'transition: all 0.1s ease;',
      'box-sizing: border-box;',
    '}',
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
      'background: #333; color: #fff; font: 11px -apple-system, BlinkMacSystemFont, sans-serif;',
      'padding: 3px 8px; border-radius: 4px; white-space: nowrap; max-width: 300px;',
      'overflow: hidden; text-overflow: ellipsis; line-height: 1.4;',
    '}',
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
      'box-sizing: border-box; display: none;',
    '}',
    '.' + PREFIX + 'selection-badge {',
      'position: fixed; pointer-events: none; z-index: 2147483647;',
      'background: #22C55E; color: #fff; font: bold 14px -apple-system, BlinkMacSystemFont, sans-serif;',
      'width: 22px; height: 22px; border-radius: 50%; display: none;',
      'align-items: center; justify-content: center; line-height: 1;',
    '}',
    '.' + PREFIX + 'selection-indicator {',
      'position: fixed; top: 8px; right: 8px; z-index: 2147483647;',
      'background: rgba(0, 0, 0, 0.75); color: #fff; font: 12px -apple-system, BlinkMacSystemFont, sans-serif;',
      'padding: 4px 10px; border-radius: 6px; pointer-events: none; display: none;',
      'backdrop-filter: blur(4px);',
    '}',
    '.' + PREFIX + 'selection-indicator.' + PREFIX + 'visible {',
      'display: block;',
    '}',
    '.' + PREFIX + 'confirmation {',
      'position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);',
      'z-index: 2147483647; background: rgba(0, 0, 0, 0.8);',
      'color: #fff; font: 13px -apple-system, BlinkMacSystemFont, sans-serif;',
      'padding: 8px 16px; border-radius: 8px; pointer-events: auto; display: none;',
      'backdrop-filter: blur(4px); gap: 12px; align-items: center;',
      'white-space: nowrap;',
    '}',
    '.' + PREFIX + 'confirmation.' + PREFIX + 'visible {',
      'display: flex;',
    '}',
    '.' + PREFIX + 'confirmation-btn {',
      'background: rgba(255, 255, 255, 0.15); border: none; color: #fff;',
      'font: 12px -apple-system, BlinkMacSystemFont, sans-serif; padding: 4px 10px;',
      'border-radius: 4px; cursor: pointer;',
    '}',
    '.' + PREFIX + 'confirmation-btn:hover {',
      'background: rgba(255, 255, 255, 0.25);',
    '}',
    '.' + PREFIX + 'confirmation-text {',
      'pointer-events: none; max-width: 250px; overflow: hidden; text-overflow: ellipsis;',
    '}',
  ].join('\\n');
  shadow.appendChild(style);

  var highlightBox = shadow.appendChild(document.createElement('div'));
  highlightBox.className = PREFIX + 'highlight-box';
  highlightBox.style.display = 'none';

  var label = shadow.appendChild(document.createElement('div'));
  label.className = PREFIX + 'label';
  label.style.display = 'none';

  var dragRect = shadow.appendChild(document.createElement('div'));
  dragRect.className = PREFIX + 'drag-rect';

  var selectionBadge = shadow.appendChild(document.createElement('div'));
  selectionBadge.className = PREFIX + 'selection-badge';
  selectionBadge.textContent = '\\u2713';

  var selectionIndicator = shadow.appendChild(document.createElement('div'));
  selectionIndicator.className = PREFIX + 'selection-indicator';
  selectionIndicator.textContent = 'Selection mode active \\u00B7 Click or drag to select \\u00B7 Esc to exit';

  var confirmation = shadow.appendChild(document.createElement('div'));
  confirmation.className = PREFIX + 'confirmation';
  var confirmationText = confirmation.appendChild(document.createElement('span'));
  confirmationText.className = PREFIX + 'confirmation-text';
  var clearBtn = confirmation.appendChild(document.createElement('button'));
  clearBtn.className = PREFIX + 'confirmation-btn';
  clearBtn.textContent = 'Clear';
  var exitBtn = confirmation.appendChild(document.createElement('button'));
  exitBtn.className = PREFIX + 'confirmation-btn';
  exitBtn.textContent = 'Exit';

  var eventLayer = shadow.querySelector('.' + PREFIX + 'event-layer');
  if (!eventLayer) {
    eventLayer = shadow.appendChild(document.createElement('div'));
    eventLayer.className = PREFIX + 'event-layer';
  }

  var mode = 'hidden';
  var isDragging = false;
  var dragStart = null;
  var hasSelection = false;
  var currentElementInfo = null;
  var throttleTimer = null;

  function sendMessage(type, data) {
    window.postMessage({ source: '__viskod_overlay', type: type, data: data }, '*');
  }

  function getElementInfo(el) {
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
      documentOrder: getDocumentOrder(el),
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
    highlightBox.style.display = 'block';
    highlightBox.style.top = box.y + 'px';
    highlightBox.style.left = box.x + 'px';
    highlightBox.style.width = box.width + 'px';
    highlightBox.style.height = box.height + 'px';
    var cls = PREFIX + 'highlight-box ' + PREFIX + (className || 'hover');
    if (hasSelection) cls += ' ' + PREFIX + 'selected';
    highlightBox.className = cls;
    if (text) {
      label.style.display = 'block';
      var lx = Math.min(box.x + box.width + 8, window.innerWidth - 310);
      var ly = Math.max(box.y - 22, 4);
      label.style.top = ly + 'px';
      label.style.left = lx + 'px';
      label.textContent = text;
    } else {
      label.style.display = 'none';
    }
  }

  function clearHighlight() {
    highlightBox.style.display = 'none';
    label.style.display = 'none';
    currentElementInfo = null;
  }

  function showDragRect(x1, y1, x2, y2) {
    var left = Math.min(x1, x2);
    var top = Math.min(y1, y2);
    var width = Math.abs(x2 - x1);
    var height = Math.abs(y2 - y1);
    dragRect.style.display = 'block';
    dragRect.style.left = left + 'px';
    dragRect.style.top = top + 'px';
    dragRect.style.width = width + 'px';
    dragRect.style.height = height + 'px';
  }

  function hideDragRect() {
    dragRect.style.display = 'none';
  }

  function showSelectionBadge(box) {
    selectionBadge.style.display = 'flex';
    selectionBadge.style.top = (box.y - 11) + 'px';
    selectionBadge.style.left = (box.x + box.width - 11) + 'px';
  }

  function hideSelectionBadge() {
    selectionBadge.style.display = 'none';
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

  function setMode(newMode) {
    mode = newMode;
    if (mode === 'hover' || mode === 'selection') {
      eventLayer.classList.add(PREFIX + 'active');
      showSelectionIndicator();
    } else if (mode === 'box-select') {
      eventLayer.classList.add(PREFIX + 'active');
    } else {
      eventLayer.classList.remove(PREFIX + 'active');
      hideSelectionIndicator();
    }
  }

  function getTargetElement(clientX, clientY) {
    highlightBox.style.display = 'none';
    var savedPE = eventLayer.style.pointerEvents;
    eventLayer.style.pointerEvents = 'none';
    var el = document.elementFromPoint(clientX, clientY);
    eventLayer.style.pointerEvents = savedPE;
    highlightBox.style.display = hasSelection ? 'block' : 'none';
    if (!el) return null;
    if (el === host || host.contains(el)) return null;
    if (el.getAttribute && el.getAttribute('data-viskod-overlay') !== null) return null;
    return el;
  }

  function handlePointerMove(clientX, clientY) {
    if (mode !== 'hover' && mode !== 'selection') return;
    if (isDragging) return;
    if (hasSelection) return;

    var el = getTargetElement(clientX, clientY);
    if (!el) { clearHighlight(); return; }

    var info = getElementInfo(el);
    currentElementInfo = info;
    showHighlight(info.boundingBox, info.tagName + (info.textPreview ? ' \\u00B7 ' + info.textPreview : ''), 'hover');
    sendMessage('overlay:element-hovered', info);
  }

  function handleClick(clientX, clientY) {
    if (mode !== 'selection') return;
    if (isDragging) return;

    var el = getTargetElement(clientX, clientY);
    if (!el) return;

    var info = getElementInfo(el);
    currentElementInfo = info;
    hasSelection = true;
    showHighlight(info.boundingBox, info.tagName + (info.textPreview ? ' \\u00B7 ' + info.textPreview : ''), 'selection');
    showSelectionBadge(info.boundingBox);
    showConfirmation(info.tagName + (info.textPreview ? ' \\u00B7 ' + info.textPreview : ''));
    sendMessage('overlay:element-clicked', info);
  }

  function handlePointerDown(clientX, clientY) {
    if (mode !== 'selection') return;
    if (hasSelection) return;
    if (clientX === undefined) return;

    dragStart = { x: clientX, y: clientY };
    isDragging = false;
    showDragRect(clientX, clientY, clientX, clientY);
    setMode('box-select');
  }

  function handlePointerMoveDrag(clientX, clientY) {
    if (!dragStart) return;
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
    clearHighlight();
    hideSelectionBadge();
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
        hideSelectionBadge();
        hideSelectionIndicator();
        setMode('hidden');
        clearHighlight();
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
      } else if (cmd === 'overlay:clear-selection') {
        hasSelection = false;
        hideSelectionBadge();
        hideConfirmation();
        clearHighlight();
        sendMessage('overlay:selection-cleared', {});
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
