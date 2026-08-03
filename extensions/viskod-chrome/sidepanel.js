(() => {
  const port = chrome.runtime.connect({ name: 'viskod-sidepanel' });
  const status = document.getElementById('status');
  const selection = document.getElementById('selection');
  const selectionSummary = document.getElementById('selection-summary');
  const messages = document.getElementById('messages');
  const input = document.getElementById('chat-input');
  const form = document.getElementById('chat-form');
  let socket = null;
  let lastSelection = '';
  let pendingHandoffPrompt = null;

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch (error) {}
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

  function setStatus(text) {
    status.textContent = text;
  }

  function appendMessage(role, text) {
    const message = document.createElement('div');
    message.className = `message ${role}`;
    message.textContent = text;
    messages.appendChild(message);
    messages.scrollTop = messages.scrollHeight;
  }

  function renderSelection(message) {
    if (message.hasSelection && message.summary) {
      lastSelection = message.summary;
      selection.hidden = false;
      selectionSummary.textContent = message.summary;
    } else {
      selection.hidden = true;
      selectionSummary.textContent = '';
    }
  }

  port.onMessage.addListener((message) => {
    if (message.type === 'selection-state' || message.type === 'sidepanel:state') {
      renderSelection(message);
    } else if (message.type === 'sidepanel:selection-sent') {
      if (message.ok) {
        lastSelection = message.summary || lastSelection;
        selection.hidden = true;
        if (pendingHandoffPrompt) {
          const prompt = pendingHandoffPrompt;
          pendingHandoffPrompt = null;
          copyToClipboard(prompt)
            .then(() => {
              appendMessage('user', 'Context queued and prompt copied for your IDE/TUI agent.');
              input.value = '';
              setStatus('Context queued and prompt copied · continue in your IDE/TUI agent.');
            })
            .catch(() => {
              setStatus('Context queued, but clipboard access is unavailable.');
            });
        } else {
          setStatus('Selection queued for MCP · continue in your IDE/TUI agent.');
          appendMessage(
            'agent',
            'Selection queued. Ask your IDE/TUI agent to read the latest Viskod context.',
          );
        }
      } else {
        setStatus(message.error || 'Could not send selection.');
      }
    } else if (message.type === 'sidepanel:action' && !message.ok) {
      setStatus(message.error || 'Could not reach the active page.');
    }
  });

  document.getElementById('select').addEventListener('click', () => {
    port.postMessage({ type: 'sidepanel:enable-selection' });
    setStatus('Selection enabled on the active page.');
  });

  document.getElementById('send-selection').addEventListener('click', () => {
    form.requestSubmit();
  });

  document.getElementById('help').addEventListener('click', () => {
    port.postMessage({ type: 'sidepanel:open-help' });
  });

  document.getElementById('settings').addEventListener('click', () => {
    port.postMessage({ type: 'sidepanel:open-settings' });
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text && !lastSelection) return;
    const instruction =
      text ||
      'Review this selected UI context and identify the relevant source files and code changes.';
    const prompt = `${lastSelection || 'No browser selection attached.'}\n\n${instruction}`;
    if (!selection.hidden) {
      pendingHandoffPrompt = prompt;
      port.postMessage({ type: 'sidepanel:send-selection' });
      setStatus('Queueing context and preparing prompt...');
      return;
    }
    copyToClipboard(prompt)
      .then(() => {
        appendMessage('user', 'Prompt copied for your IDE/TUI agent.');
        input.value = '';
        setStatus('Prompt copied · continue in your IDE/TUI agent.');
      })
      .catch(() => {
        setStatus('Clipboard access is unavailable. Select the prompt text and copy it manually.');
      });
  });

  function connect() {
    socket = new WebSocket('ws://localhost:3001');
    socket.onopen = () => setStatus('Studio connected · IDE/TUI MCP status is separate.');
    socket.onclose = () => {
      setStatus('Studio disconnected · start Studio to reconnect.');
      setTimeout(connect, 3000);
    };
    socket.onerror = () => socket.close();
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'chat:message' && message.role === 'agent') {
          appendMessage('agent', message.text);
          setStatus('Agent response received · code changes happen in your IDE/TUI.');
        } else if (message.type === 'chat:status') {
          const statusText = {
            working: 'Agent received · working in your IDE/TUI.',
            ready: 'Changes ready · review them in your IDE/TUI.',
          }[message.status];
          if (statusText) setStatus(statusText);
        }
      } catch (error) {}
    };
  }

  port.postMessage({ type: 'sidepanel:request-state' });
  connect();
})();
