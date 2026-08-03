// Viskod Chrome Extension — Background Script
// Injects overlay into page context using chrome.scripting API
// This bypasses CSP since chrome.scripting.executeScript runs in the MAIN world

const STUDIO_PORT = 3001;
const sidePanelPorts = new Set();

function broadcastToSidePanel(message) {
  for (const port of sidePanelPorts) {
    try {
      port.postMessage(message);
    } catch (e) {
      sidePanelPorts.delete(port);
    }
  }
}

function sendToActiveTab(message, port, responseType) {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id;
    if (!tabId) {
      port.postMessage({ type: responseType, ok: false, error: 'No active tab' });
      return;
    }
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        port.postMessage({
          type: responseType,
          ok: false,
          error: chrome.runtime.lastError.message,
        });
        return;
      }
      port.postMessage({ type: responseType, ...(response || { ok: true }) });
    });
  });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'viskod-sidepanel') return;
  sidePanelPorts.add(port);
  port.onDisconnect.addListener(() => sidePanelPorts.delete(port));
  port.onMessage.addListener((msg) => {
    if (msg.type === 'sidepanel:request-state') {
      sendToActiveTab({ type: 'sidepanel:get-state' }, port, 'sidepanel:state');
    } else if (msg.type === 'sidepanel:open-chat') {
      sendToActiveTab({ type: 'sidepanel:open-chat' }, port, 'sidepanel:action');
    } else if (msg.type === 'sidepanel:open-help') {
      sendToActiveTab({ type: 'sidepanel:open-help' }, port, 'sidepanel:action');
    } else if (msg.type === 'sidepanel:open-settings') {
      sendToActiveTab({ type: 'sidepanel:open-settings' }, port, 'sidepanel:action');
    } else if (msg.type === 'sidepanel:enable-selection') {
      sendToActiveTab({ type: 'sidepanel:enable-selection' }, port, 'sidepanel:action');
    } else if (msg.type === 'sidepanel:send-selection') {
      sendToActiveTab({ type: 'sidepanel:send-selection' }, port, 'sidepanel:selection-sent');
    }
  });
});

if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

if (chrome.action?.onClicked) {
  chrome.action.onClicked.addListener((tab) => {
    if (chrome.sidePanel?.open && tab.id) {
      chrome.sidePanel.open({ tabId: tab.id }).catch(() => {
        chrome.tabs.sendMessage(tab.id, { type: 'sidepanel:open-chat' }).catch(() => {});
      });
    } else if (tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'sidepanel:open-chat' }).catch(() => {});
    }
  });
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'selection-state') {
    broadcastToSidePanel(msg);
    return;
  }

  if (msg.type === 'inject-overlay' && sender.tab?.id) {
    fetch(`http://localhost:${STUDIO_PORT}/overlay/script`)
      .then((r) => r.text())
      .then((script) => {
        chrome.scripting
          .executeScript({
            target: { tabId: sender.tab.id },
            func: (code) => {
              try {
                // biome-ignore lint/security/noGlobalEval: overlay script arrives as a string from the local Studio server; eval-in-MAIN-world is the standard extension injection pattern
                eval(code);
              } catch (e) {
                console.warn('[Viskod] overlay eval error:', e.message);
              }
            },
            args: [script],
            world: 'MAIN',
          })
          .then(() => sendResponse({ ok: true }))
          .catch((e) => sendResponse({ ok: false, error: e.message }));
      })
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true; // async response
  }

  if (msg.type === 'reload-overlay' && sender.tab?.id) {
    // Reload page then re-inject overlay
    chrome.tabs.reload(sender.tab.id, { bypassCache: true }, () => {
      // Wait for page load, then inject
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === sender.tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(() => {
            fetch(`http://localhost:${STUDIO_PORT}/overlay/script`)
              .then((r) => r.text())
              .then((script) => {
                chrome.scripting.executeScript({
                  target: { tabId: sender.tab.id },
                  func: (code) => {
                    try {
                      // biome-ignore lint/security/noGlobalEval: overlay script arrives as a string from the local Studio server; eval-in-MAIN-world is the standard extension injection pattern
                      eval(code);
                    } catch (e) {}
                  },
                  args: [script],
                  world: 'MAIN',
                });
              });
          }, 500);
        }
      });
    });
    return true;
  }
});
