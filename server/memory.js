import { readJSON, writeJSON } from './storage.js';

export function getMemoryContext() {
  const core    = readJSON('memory_core.json', { content: '' });
  const profile = readJSON('profile.json',     { content: '' });

  const coreText    = core.content?.trim()    || '';
  const profileText = profile.content?.trim() || '';

  if (!coreText && !profileText) return '';

  const parts = [];
  if (coreText)    parts.push(`## Долгосрочная память\n${coreText}`);
  if (profileText) parts.push(`## Профиль пользователя\n${profileText}`);
  return parts.join('\n\n');
}

export function saveMessage(sessionId, role, content) {
  let sessions = readJSON('sessions.json', []);
  sessions.push({ sessionId, role, content, ts: Date.now() });
  if (sessions.length > 2000) sessions = sessions.slice(-2000);
  writeJSON('sessions.json', sessions);
}

export function getRecentSessions(sinceDays = 3) {
  const since = Date.now() - sinceDays * 86400000;
  return readJSON('sessions.json', [])
    .filter(m => m.ts >= since)
    .sort((a, b) => a.ts - b.ts);
}

export function updateMemoryCore(newContent) {
  writeJSON('memory_core.json', { content: newContent, updatedAt: Date.now() });
}
