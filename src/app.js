import { pad, formatUptime, copyCodeBlock } from './utils.js';
import {
  updateProgress, scrollToBottom, updateScrollThumb,
  clearFeed, switchTab, toggleSidebar, toggleSection, loadHistory
} from './ui.js';
import { toggleSettings, openSettings, dismissBanner, onApiKeyInput, initBanner, togglePin, saveSystemPrompt, resetSession, initSystemPrompt, onModelInput, initModel } from './settings.js';
import {
  handleSend, handleStop, setStatus,
  handleFileSelect, clearAttachment, readFileAsDataUrl,
  switchCodePane,
} from './chat.js';
import { sendToCodeEndpoint, stopCodeAgent, getRawCode, clearCodeOutput } from './code.js';

// ── Expose functions called from inline HTML handlers ────────
window.toggleSidebar   = toggleSidebar;
window.toggleSection   = toggleSection;
window.togglePin       = togglePin;
window.clearFeed       = clearFeed;
window.handleSend      = handleSend;
window.handleStop      = handleStop;
window.switchTab       = switchTab;
window.openSettings    = openSettings;
window.dismissBanner   = dismissBanner;
window.toggleSettings  = toggleSettings;
window.onApiKeyInput   = onApiKeyInput;
window.saveSystemPrompt = saveSystemPrompt;
window.resetSession    = resetSession;
window.onModelInput    = onModelInput;
window.clearAttachment = clearAttachment;
window.handleFileSelect = handleFileSelect;
window.switchCodePane  = switchCodePane;
window.copyCode        = () => {               // code tab copy button
  const code = getRawCode();
  if (!code) return;
  navigator.clipboard?.writeText(code);
  const btn = document.getElementById('cr-copy');
  if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy', 1500); }
};
window.copyCodeBlock   = copyCodeBlock;        // inline markdown copy buttons
window.runLastCode     = () => {};             // no-op; run via /chat tab instead
window.clearCodeTab    = clearCodeOutput;
window.handleCodeSend  = handleCodeSend;

// ── Clock & uptime ──────────────────────────────────────────
const startTime = Date.now();

function updateClock() {
  const now = new Date();
  document.getElementById('clock').textContent =
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  document.getElementById('uptime').textContent = `up ${formatUptime(Date.now() - startTime)}`;

  const sec = Math.floor((Date.now() - startTime) / 1000);
  const st = sec < 60 ? 'just now'
           : sec < 3600 ? `${Math.floor(sec / 60)}m ago`
           : `${Math.floor(sec / 3600)}h ago`;
  document.getElementById('session-time').textContent = st;
}
setInterval(updateClock, 1000);
updateClock();

// ── Drag & drop ──────────────────────────────────────────────
let dragCounter = 0;
document.addEventListener('dragenter', e => {
  if (!e.dataTransfer?.types?.includes('Files')) return;
  dragCounter++;
  document.getElementById('drag-overlay').classList.add('active');
});
document.addEventListener('dragleave', () => {
  dragCounter--;
  if (dragCounter <= 0) { dragCounter = 0; document.getElementById('drag-overlay').classList.remove('active'); }
});
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => {
  e.preventDefault();
  dragCounter = 0;
  document.getElementById('drag-overlay').classList.remove('active');
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  if (f.size > 5 * 1024 * 1024) { alert('File too large (max 5 MB)'); return; }
  readFileAsDataUrl(f);
  document.getElementById('input').focus();
});

// ── Input ────────────────────────────────────────────────────
const input     = document.getElementById('input');
const sendBtn   = document.getElementById('send-btn');
const inputCard = document.getElementById('input-card');
let typingTimer = null;

function onInputChange() {
  const text = input.innerText.replace(/ /g, ' ').replace(/\n$/, '');
  sendBtn.classList.toggle('ready', text.trim().length > 0);
  const len = text.length;
  document.getElementById('char-count').textContent = len > 20 ? len : '';
  inputCard.classList.add('typing');
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => inputCard.classList.remove('typing'), 1200);
}

input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); return; }
  if (e.key === 'Backspace' || e.key === 'Delete') setTimeout(onInputChange, 0);
});

input.addEventListener('keypress', e => {
  if (e.ctrlKey || e.metaKey || e.key === 'Enter') return;
  e.preventDefault();
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const span = document.createElement('span');
  span.className = 'ch';
  span.textContent = e.key === ' ' ? ' ' : e.key;
  range.insertNode(span);
  range.setStartAfter(span);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  onInputChange();
});

input.addEventListener('paste', e => {
  e.preventDefault();
  const text = e.clipboardData.getData('text/plain');
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  for (const ch of text) {
    const span = document.createElement('span');
    span.className = 'ch';
    if (ch === '\n') span.appendChild(document.createElement('br'));
    else span.textContent = ch === ' ' ? ' ' : ch;
    range.insertNode(span);
    range.setStartAfter(span);
    range.collapse(true);
  }
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  onInputChange();
});

// ── Code input ───────────────────────────────────────────────
const codeInput   = document.getElementById('code-input');
const codeSendBtn = document.getElementById('code-send-btn');
const codeOuter   = document.getElementById('code-input-outer');

function handleCodeSend() {
  const task = codeInput.value.trim();
  if (!task) return;
  codeInput.value = '';
  codeInput.style.height = 'auto';
  codeSendBtn.classList.remove('ready');
  sendToCodeEndpoint(task);
}
window.handleCodeSend = handleCodeSend;

codeInput.addEventListener('focus',  () => codeOuter.classList.add('focused'));
codeInput.addEventListener('blur',   () => codeOuter.classList.remove('focused'));
codeInput.addEventListener('input',  () => {
  codeSendBtn.classList.toggle('ready', codeInput.value.trim().length > 0);
  codeInput.style.height = 'auto';
  codeInput.style.height = Math.min(codeInput.scrollHeight, 90) + 'px';
});
codeInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCodeSend(); }
});

// ── Scroll thumb ─────────────────────────────────────────────
document.getElementById('feed').addEventListener('scroll', updateScrollThumb);

// ── Global keyboard shortcuts ────────────────────────────────
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    switchTab('chat');
    input.focus();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === '1') { e.preventDefault(); switchTab('chat'); }
  if ((e.metaKey || e.ctrlKey) && e.key === '2') { e.preventDefault(); switchTab('context'); }
  if ((e.metaKey || e.ctrlKey) && e.key === '3') { e.preventDefault(); switchTab('code'); }
});

// ── Init ─────────────────────────────────────────────────────
initBanner();
initSystemPrompt();
initModel();
updateProgress();
loadHistory();
