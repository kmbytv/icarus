import { setCodeStatus } from './chat.js';

const BACKEND = 'https://icarus-production-5c67.up.railway.app';

let rawCode      = '';   // accumulates full code for Source tab / copy
let codeAbort    = null;

// ── Plan block ───────────────────────────────────────────────
function showPlan(plan) {
  const el = document.getElementById('code-plan');
  if (!el) return;

  const steps = Array.isArray(plan.plan) ? plan.plan : [];
  const risks = Array.isArray(plan.risks) ? plan.risks.filter(Boolean) : [];

  let html = `<div id="code-plan-title">ПЛАН</div>
<ul id="code-plan-steps">
  ${steps.map((s, i) => `<li class="code-plan-step"><span class="code-plan-step-num">${i + 1}.</span>${escHtml(s)}</li>`).join('')}
</ul>`;

  if (risks.length) {
    html += `<div id="code-plan-risks">
<div id="code-plan-risks-label">Риски</div>
${risks.map(r => `<div class="code-plan-risk">· ${escHtml(r)}</div>`).join('')}
</div>`;
  }

  el.innerHTML = html;
  el.style.display = 'block';
}

function hidePlan() {
  const el = document.getElementById('code-plan');
  if (el) { el.style.display = 'none'; el.innerHTML = ''; }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Output pane ──────────────────────────────────────────────
function showCodeOutput(code) {
  const empty = document.getElementById('code-output-empty');
  const pre   = document.getElementById('code-pre');
  if (empty) empty.style.display = 'none';
  if (pre)   { pre.style.display = 'block'; pre.textContent = code; }
}

function resetOutput() {
  const empty = document.getElementById('code-output-empty');
  const pre   = document.getElementById('code-pre');
  if (empty) empty.style.display = 'flex';
  if (pre)   { pre.style.display = 'none'; pre.textContent = ''; }
  rawCode = '';
  hidePlan();
}

// ── Send task to /code endpoint ──────────────────────────────
export async function sendToCodeEndpoint(task) {
  if (!task.trim()) return;

  rawCode = '';
  resetOutput();
  setCodeStatus(true, 'Analyzing task…');

  codeAbort = new AbortController();

  try {
    const res = await fetch(`${BACKEND}/code`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ task }),
      signal:  codeAbort.signal,
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

        if (ev.type === 'status') {
          setCodeStatus(true, ev.text);
        } else if (ev.type === 'plan') {
          setCodeStatus(true, 'Generating code…');
          showPlan(ev.content);
        } else if (ev.type === 'code_delta') {
          rawCode += ev.text;
          showCodeOutput(rawCode);
        } else if (ev.type === 'error') {
          throw new Error(ev.message);
        } else if (ev.type === 'done') {
          break;
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      showCodeOutput(`// Error: ${err.message}`);
    }
  } finally {
    codeAbort = null;
    setCodeStatus(false);
  }
}

export function stopCodeAgent() {
  if (codeAbort) { codeAbort.abort(); codeAbort = null; }
}

export function getRawCode() { return rawCode; }

export function clearCodeOutput() {
  stopCodeAgent();
  resetOutput();
  document.getElementById('code-feed').innerHTML = '';
  setCodeStatus(false);
}
