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

// ── Code tab ─────────────────────────────────────────────────
let codeIsThinking = false;
let lastCodeBlock  = '';
let codePane       = 'output';
let _currentChain  = null;
let _chainStepIdx  = 0;

const statusCycle = ['Analyzing…', 'Planning…', 'Generating…', 'Writing code…', 'Almost there…'];
let statusIdx = 0, statusTimer = null;

function startStatusCycle() {
  statusIdx = 0;
  statusTimer = setInterval(() => {
    document.getElementById('gen-status').textContent = statusCycle[statusIdx % statusCycle.length];
    statusIdx++;
  }, 1800);
}
function stopStatusCycle() { clearInterval(statusTimer); }

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
    status.textContent    = lastCodeBlock ? 'Done' : 'Waiting for input';
    statusSub.textContent = lastCodeBlock ? 'Code ready' : 'Ask KAI to write or execute code';
  }
}

export function addCodeMsg(role, text) {
  const feed = document.getElementById('code-feed');
  const wrap = document.createElement('div');
  wrap.className = `cmsg from-${role}`;

  const meta = document.createElement('div');
  meta.className = 'cmsg-meta';
  const dot = document.createElement('span');
  dot.className = 'cmsg-meta-dot';
  meta.appendChild(dot);
  meta.append(role === 'user' ? 'YOU' : 'KAI');

  const bubble = document.createElement('div');
  bubble.className = 'cmsg-bubble';
  bubble.textContent = text;

  wrap.appendChild(meta);
  wrap.appendChild(bubble);
  feed.appendChild(wrap);
  feed.scrollTop = feed.scrollHeight;
  return bubble;
}

function ensureChain() {
  if (_currentChain) return _currentChain;
  const feed = document.getElementById('code-feed');
  const chain = document.createElement('div');
  chain.className = 'ctool-chain';
  chain.innerHTML = `<div class="ctool-chain-label">Tool calls</div><div class="ctool-route"></div>`;
  feed.appendChild(chain);
  _currentChain = { chainEl: chain, routeEl: chain.querySelector('.ctool-route'), steps: new Map() };
  return _currentChain;
}

function addCodeTool(toolName, detail) {
  const chain = ensureChain();
  const key   = `${toolName}_${_chainStepIdx++}`;
  const step = document.createElement('div');
  step.className = 'ctool-step';
  step.innerHTML = `
    <div class="ctool-dot running">▶</div>
    <div class="ctool-step-info">
      <span class="ctool-step-name">${toolName}</span>
      <span class="ctool-step-detail">${detail ?? ''}</span>
    </div>`;
  chain.routeEl.appendChild(step);
  chain.steps.set(key, step);
  document.getElementById('code-feed').scrollTop = 99999;
  return key;
}

function resolveCodeTool(key, result, isError) {
  if (!_currentChain) return;
  const step = _currentChain.steps.get(key);
  if (!step) return;
  const dot    = step.querySelector('.ctool-dot');
  const detail = step.querySelector('.ctool-step-detail');
  dot.className = `ctool-dot ${isError ? 'error' : 'done'}`;
  dot.textContent = isError ? '✕' : '✓';
  if (result) {
    const res = document.createElement('span');
    res.className = isError ? 'ctool-step-detail' : 'ctool-step-result';
    res.textContent = String(result).slice(0, 80);
    detail.after(res);
  }
}

function resetChain() { _currentChain = null; _chainStepIdx = 0; }

function showCodeOutput(code) {
  const empty = document.getElementById('code-output-empty');
  const pre   = document.getElementById('code-pre');
  empty.style.display = 'none';
  pre.style.display   = 'block';
  pre.textContent     = code;
  lastCodeBlock       = code;
}

function extractCodeBlock(text) {
  const m = text.match(/```(?:\w+)?\n([\s\S]*?)```/);
  return m ? m[1].trim() : null;
}

export function switchCodePane(pane) {
  codePane = pane;
  document.getElementById('crt-output').classList.toggle('active', pane === 'output');
  document.getElementById('crt-source').classList.toggle('active', pane === 'source');
}

export function copyCodeTabOutput() {
  if (!lastCodeBlock) return;
  navigator.clipboard?.writeText(lastCodeBlock);
  const btn = document.getElementById('cr-copy');
  btn.textContent = 'Copied!';
  setTimeout(() => btn.textContent = 'Copy', 1500);
}

export function runLastCode() {
  if (!lastCodeBlock) return;
  addCodeMsg('user', '> run last code block');
  sendToCodeAgent('Run the last code block you wrote and show the output.');
}

export function clearCodeTab() {
  document.getElementById('code-feed').innerHTML = '';
  const empty = document.getElementById('code-output-empty');
  const pre   = document.getElementById('code-pre');
  empty.style.display = 'flex';
  pre.style.display   = 'none';
  pre.textContent     = '';
  lastCodeBlock       = '';
  setCodeStatus(false);
}

export function handleCodeSend() {
  const codeInput   = document.getElementById('code-input');
  const codeSendBtn = document.getElementById('code-send-btn');
  const text = codeInput.value.trim();
  if (!text || codeIsThinking) return;
  codeInput.value = '';
  codeInput.style.height = 'auto';
  codeSendBtn.classList.remove('ready');
  addCodeMsg('user', text);
  sendToCodeAgent(text);
}

export async function sendToCodeAgent(userText) {
  setCodeStatus(true, 'Generating…');
  startStatusCycle();

  const feed = document.getElementById('code-feed');
  const thinkRow = document.createElement('div');
  thinkRow.className = 'cthink';
  thinkRow.innerHTML = `<div class="cthink-dots"><span></span><span></span><span></span></div><span id="cthink-label">thinking</span>`;
  feed.appendChild(thinkRow);
  feed.scrollTop = feed.scrollHeight;

  let accumulated = '';
  let lastToolKey  = null;
  const agentBubble = addCodeMsg('agent', '');
  resetChain();

  try {
    const sysPrompt = document.getElementById('system-prompt-area').value.trim();
    const res = await fetch(`${BACKEND}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: userText, sessionId: 'code', systemPrompt: sysPrompt }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buf     = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let ev;
        try { ev = JSON.parse(line.slice(6)); } catch { continue; }

        if (ev.type === 'delta') {
          accumulated += ev.text;
          agentBubble.textContent = accumulated;
          feed.scrollTop = feed.scrollHeight;
          const lbl = document.getElementById('cthink-label');
          if (lbl) lbl.textContent = accumulated.slice(-30).replace(/\n/g, ' ').trim() || 'thinking';
        } else if (ev.type === 'tool_call') {
          const argStr = Object.entries(ev.args ?? {}).map(([k,v]) => `${k}: ${String(v).slice(0,30)}`).join(' · ');
          lastToolKey = addCodeTool(ev.tool, argStr);
        } else if (ev.type === 'tool_result') {
          const resultStr = ev.result?.output ?? ev.result?.content ?? ev.result?.error ?? '';
          const isError   = !!ev.result?.error;
          resolveCodeTool(lastToolKey, resultStr.slice(0, 80), isError);
          if (resultStr) showCodeOutput(resultStr);
        } else if (ev.type === 'error') {
          throw new Error(ev.message);
        } else if (ev.type === 'done') {
          break;
        }
      }
    }

    const block = extractCodeBlock(accumulated);
    if (block) showCodeOutput(block);

  } catch (err) {
    agentBubble.textContent = `Error: ${err.message}`;
  } finally {
    thinkRow.remove();
    stopStatusCycle();
    setCodeStatus(false);
    feed.scrollTop = feed.scrollHeight;
  }
}
