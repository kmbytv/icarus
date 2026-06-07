export function toggleSettings() {
  document.getElementById('settings-panel').classList.toggle('open');
}

export function openSettings() {
  const sec = document.getElementById('sec-system');
  sec.classList.remove('collapsed');
  document.getElementById('settings-panel').classList.add('open');
  document.getElementById('settings-nav').scrollIntoView({ behavior: 'smooth' });
}

export function dismissBanner() {
  document.getElementById('api-banner').classList.add('hidden');
  try { localStorage.setItem('kai_banner_dismissed', '1'); } catch {}
}

export function onApiKeyInput() {
  const val   = document.getElementById('api-key-input').value.trim();
  const badge = document.getElementById('settings-badge');
  badge.style.display = val ? 'none' : '';
  if (val) {
    document.getElementById('api-banner').classList.add('hidden');
    try { localStorage.setItem('kai_banner_dismissed', '1'); } catch {}
  } else {
    try { localStorage.removeItem('kai_banner_dismissed'); } catch {}
    document.getElementById('api-banner').classList.remove('hidden');
  }
}

export function initBanner() {
  try {
    if (localStorage.getItem('kai_banner_dismissed')) {
      document.getElementById('api-banner').classList.add('hidden');
    }
  } catch {}
  document.getElementById('settings-badge').style.display = '';
}

export function togglePin() {
  document.getElementById('bc-star').classList.toggle('pinned');
}

export function saveSystemPrompt() {
  const val = document.getElementById('settings-system-prompt').value;
  try { localStorage.setItem('kai_system_prompt', val); } catch {}
  const area = document.getElementById('system-prompt-area');
  if (area) area.value = val;
}

export function resetSession() {
  fetch('https://icarus-production-5c67.up.railway.app/session/default', { method: 'DELETE' })
    .catch(() => {});
  try { localStorage.removeItem('kai_chat_history'); } catch {}
  const clearFeedFn = window.clearFeed;
  if (clearFeedFn) clearFeedFn();
}

export function initSystemPrompt() {
  try {
    const saved = localStorage.getItem('kai_system_prompt');
    if (saved) {
      const settingsArea = document.getElementById('settings-system-prompt');
      if (settingsArea) settingsArea.value = saved;
      const promptArea = document.getElementById('system-prompt-area');
      if (promptArea) promptArea.value = saved;
    }
  } catch {}
}
