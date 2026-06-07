export function pad(n) { return String(n).padStart(2, '0'); }

export function nowStr() {
  const n = new Date();
  return `${pad(n.getHours())}:${pad(n.getMinutes())}`;
}

export function formatUptime(ms) {
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Markdown setup ───────────────────────────────────────────
marked.setOptions({ breaks: true, gfm: true });

const mdRenderer = new marked.Renderer();
mdRenderer.code = ({ text, lang }) => {
  const escaped = (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const displayLang = lang || 'code';
  return `<pre><div class="code-block-header"><span>${displayLang}</span><button class="code-copy-btn" onclick="copyCodeBlock(this)">copy</button></div><code>${escaped}</code></pre>`;
};
marked.use({ renderer: mdRenderer });

export function copyCodeBlock(btn) {
  const code = btn.closest('pre').querySelector('code');
  navigator.clipboard.writeText(code.innerText).then(() => {
    btn.textContent = 'copied!';
    setTimeout(() => btn.textContent = 'copy', 1500);
  });
}

export function renderAgentBody(el, text) {
  el.classList.add('md');
  el.innerHTML = marked.parse(text);
}
