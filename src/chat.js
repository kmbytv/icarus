import { addMessage, addProcessing, scrollToBottom, updateScrollThumb } from './ui.js';
import { renderAgentBody, nowStr } from './utils.js';

const BACKEND = 'https://icarus-production-5c67.up.railway.app';

export let abortController = null;
export let isThinking = false;

// ── File attachment ──────────────────────────────────────────
export let attachedFile = null;

export function handleFileSelect(input) {
  const f = input.files[0];
  if (!f) return;
  if (f.size > 5 * 1024 * 1024) { alert('File too large (max 5 MB)'); input.value = ''; return; }
  readFileAsDataUrl(f);
}

export function readFileAsDataUrl(f) {
  const reader = new FileReader();
  reader.onload = e => {
    attachedFile = { name: f.name, mimeType: f.type, dataUrl: e.target.result };
    showFilePreview();
  };
  reader.readAsDataURL(f);
}

export function showFilePreview() {
  const preview   = document.getElementById('file-preview');
  const thumb     = document.getElementById('file-preview-thumb');
  const icon      = document.getElementById('file-preview-icon');
  const nameEl    = document.getElementById('file-preview-name');
  const attachBtn = document.getElementById('attach-btn');
  preview.classList.add('visible');
  attachBtn.classList.add('has-file');
  nameEl.textContent = attachedFile.name;
  if (attachedFile.mimeType.startsWith('image/')) {
    thumb.src = attachedFile.dataUrl;
    thumb.style.display = '';
    icon.style.display = 'none';
  } else {
    icon.style.display = '';
    thumb.style.display = 'none';
  }
}

export function clearAttachment() {
  attachedFile = null;
  document.getElementById('file-preview').classList.remove('visible');
  document.getElementById('attach-btn').classList.remove('has-file');
  document.getElementById('file-preview-thumb').style.display = 'none';
  document.getElementById('file-preview-icon').style.display = 'none';
  document.getElementById('file-input').value = '';
}

export function setStatus(thinking) {
  isThinking = thinking;
  document.getElementById('status-dot').classList.toggle('thinking', thinking);
  document.getElementById('status-text').textContent = thinking ? 'THINKING' : 'ONLINE';
  document.getElementById('send-btn').style.display = thinking ? 'none' : '';
  document.getElementById('stop-btn').style.display = thinking ? '' : 'none';
}

export function handleStop() {
  if (abortController) { abortController.abort(); abortController = null; }
}

function saveHistory(role, text) {
  try {
    const history = JSON.parse(localStorage.getItem('kai_chat_history') || '[]');
    history.push({ role, text, ts: Date.now() });
    if (history.length > 100) history.splice(0, history.length - 100);
    localStorage.setItem('kai_chat_history', JSON.stringify(history));
  } catch {}
}

export function handleSend() {
  const input   = document.getElementById('input');
  const sendBtn = document.getElementById('send-btn');
  const text    = input.innerText.replace(/ /g, ' ').replace(/\n$/, '').trim();
  if ((!text && !attachedFile) || isThinking) return;
  sendBtn.classList.add('firing');
  sendBtn.addEventListener('animationend', () => sendBtn.classList.remove('firing'), { once: true });
  input.innerHTML = '';
  sendBtn.classList.remove('ready');
  document.getElementById('char-count').textContent = '';
  const file = attachedFile;
  clearAttachment();
  const userBubble = addMessage('user', text || ' ');
  if (file) {
    const attach = document.createElement('div');
    attach.style.cssText = 'margin-top:6px;display:flex;align-items:center;gap:6px;font-size:12px;opacity:0.7;';
    if (file.mimeType.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = file.dataUrl;
      img.style.cssText = 'width:80px;height:60px;object-fit:cover;border-radius:6px;border:1px solid var(--border)';
      attach.appendChild(img);
    } else {
      attach.innerHTML = `<i class="ti ti-file-text" style="font-size:16px"></i><span>${file.name}</span>`;
    }
    userBubble.appendChild(attach);
  }
  saveHistory('user', text);
  sendToAgent(text || 'Посмотри на прикреплённый файл', file);
}

export async function sendToAgent(userText, file = null) {
  setStatus(true);
  const { body } = addProcessing();
  const systemPrompt = document.getElementById('system-prompt-area').value.trim();

  let accumulated = '';
  const cursor = document.createElement('span');
  cursor.className = 'cursor';

  abortController = new AbortController();

  try {
    const payload = { message: userText, sessionId: 'main', systemPrompt };
    if (file) payload.file = { name: file.name, mimeType: file.mimeType, dataUrl: file.dataUrl };

    const res = await fetch(`${BACKEND}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: abortController.signal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HTTP ${res.status}: ${err}`);
    }

    body.textContent = '';
    body.classList.add('md');
    body.appendChild(cursor);

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buf     = '';
    let   planInserted = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let event;
        try { event = JSON.parse(line.slice(6)); } catch { continue; }

        if (event.type === 'plan' && Array.isArray(event.steps) && !planInserted) {
          planInserted = true;
          const planEl = document.createElement('div');
          planEl.className = 'plan-block';
          planEl.innerHTML = `<div class="plan-block-title">План выполнения</div><ol class="plan-steps">${
            event.steps.map((s, i) =>
              `<li class="plan-step"><span class="plan-step-num">${i + 1}.</span><span class="plan-step-text">${s}</span></li>`
            ).join('')
          }</ol>`;
          body.insertAdjacentElement('beforebegin', planEl);
          scrollToBottom();
        } else if (event.type === 'delta' && event.text) {
          accumulated += event.text;
          cursor.remove();
          body.innerHTML = marked.parse(accumulated);
          body.appendChild(cursor);
          scrollToBottom();
          updateScrollThumb();
        } else if (event.type === 'error') {
          throw new Error(event.message ?? 'Stream error');
        } else if (event.type === 'done') {
          break;
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      accumulated = `Error: ${err.message}`;
      body.textContent = accumulated;
    }
  } finally {
    abortController = null;
    cursor.remove();
    if (accumulated) {
      renderAgentBody(body, accumulated);
      saveHistory('agent', accumulated);
    }
    setStatus(false);
    scrollToBottom();
    updateScrollThumb();
  }
}

// ── Code tab status (used by src/code.js) ────────────────────
let codeIsThinking = false;

export function setCodeStatus(thinking, label = '') {
  codeIsThinking = thinking;
  const orb       = document.getElementById('gen-orb');
  const status    = document.getElementById('gen-status');
  const statusSub = document.getElementById('gen-status-sub');
  orb.classList.toggle('active', thinking);
  if (thinking) {
    status.textContent    = label || 'Generating…';
    statusSub.textContent = 'Thinking…';
  } else {
    status.textContent    = 'Waiting for input';
    statusSub.textContent = 'Ask KAI to write or execute code';
  }
}

export function switchCodePane(pane) {
  document.getElementById('crt-output').classList.toggle('active', pane === 'output');
  document.getElementById('crt-source').classList.toggle('active', pane === 'source');
}
