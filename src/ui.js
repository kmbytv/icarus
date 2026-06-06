import { nowStr, renderAgentBody } from './utils.js';

export let msgCount    = 0;
export let lastMsgTime = null;
export const MSG_LIMIT = 50;

export function resetMsgCount() { msgCount = 0; lastMsgTime = null; }

export function updateProgress() {
  const pct = Math.min((msgCount / MSG_LIMIT) * 100, 100);
  document.getElementById('sidebar-progress-fill').style.width = pct + '%';
  document.getElementById('sidebar-progress-count').textContent = `${msgCount} / ${MSG_LIMIT} msgs`;
}

export function scrollToBottom() {
  const feed = document.getElementById('feed');
  feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
}

export function updateScrollThumb() {
  const feed  = document.getElementById('feed');
  const thumb = document.getElementById('scroll-thumb');
  if (!feed || !thumb) return;
  const ratio = feed.clientHeight / feed.scrollHeight;
  const top   = (feed.scrollTop / feed.scrollHeight) * feed.clientHeight;
  thumb.style.height = Math.max(ratio * feed.clientHeight, 24) + 'px';
  thumb.style.top    = top + 'px';
}

function maybeAddDivider(wrap) {
  const now = Date.now();
  if (!lastMsgTime || now - lastMsgTime > 120000) {
    const div = document.createElement('div');
    div.className = 'time-divider';
    const sp = document.createElement('span');
    sp.textContent = nowStr();
    div.appendChild(sp);
    wrap.appendChild(div);
  }
  lastMsgTime = now;
}

export function addMessage(role, text) {
  document.getElementById('empty')?.remove();
  const wrap = document.getElementById('feed-inner');
  maybeAddDivider(wrap);

  const row = document.createElement('div');
  row.className = `msg-row from-${role}`;
  row.id = `msg-${++msgCount}`;
  updateProgress();

  if (role === 'agent') {
    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.innerHTML = `<i class="ti ti-circles"></i>`;
    row.appendChild(avatar);
  }

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.setAttribute('data-time', nowStr());
  bubble.textContent = text;

  row.appendChild(bubble);
  wrap.appendChild(row);
  scrollToBottom();
  updateScrollThumb();
  return bubble;
}

export function addProcessing() {
  document.getElementById('empty')?.remove();
  const wrap = document.getElementById('feed-inner');

  const row = document.createElement('div');
  row.className = 'msg-row from-agent';
  row.id = `msg-${++msgCount}`;
  updateProgress();

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.innerHTML = `<i class="ti ti-circles"></i>`;

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.setAttribute('data-time', nowStr());
  bubble.innerHTML = '<div class="processing"><div class="processing-dots"><span></span><span></span><span></span></div></div>';

  row.appendChild(avatar);
  row.appendChild(bubble);
  wrap.appendChild(row);
  scrollToBottom();
  updateScrollThumb();
  return { msg: row, body: bubble };
}

export function clearFeed() {
  resetMsgCount();
  updateProgress();
  try { localStorage.removeItem('kai_chat_history'); } catch {}
  const wrap = document.getElementById('feed-inner');
  wrap.innerHTML = `
    <div id="empty">
      <div id="empty-icon"><i class="ti ti-circles"></i></div>
      <div id="empty-title"><strong>Ask Kai</strong> anything</div>
      <div id="empty-sub">Start a conversation — I can write code,<br>answer questions, and use tools for you.</div>
    </div>`;
}

export function switchTab(tab) {
  ['chat', 'context', 'code'].forEach(t => {
    const btn   = document.getElementById(`tab-${t}-btn`);
    const panel = document.getElementById(`tab-${t}`);
    if (!btn || !panel) return;
    const active = t === tab;
    btn.classList.toggle('active', active);
    panel.style.display = active ? (t === 'code' ? 'block' : 'flex') : 'none';
  });
  if (window.innerWidth <= 640) toggleSidebar();
}

export function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
}

export function toggleSection(id) {
  document.getElementById(id).classList.toggle('collapsed');
}

export function loadHistory() {
  try {
    const history = JSON.parse(localStorage.getItem('kai_chat_history') || '[]');
    if (!history.length) return;
    document.getElementById('empty')?.remove();
    for (const item of history) {
      if (item.role === 'user') {
        addMessage('user', item.text);
      } else if (item.role === 'agent') {
        const bubble = addMessage('agent', '');
        renderAgentBody(bubble, item.text);
      }
    }
  } catch {}
}
