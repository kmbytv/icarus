import { readJSON, writeJSON } from './storage.js';

export function getMemoryContext() {
  const core    = readJSON('memory_core.json', null);
  const profile = readJSON('profile.json',     { content: '' });

  const parts = [];

  if (core) {
    // Structured format (has summary field)
    if (core.summary) {
      const lines = [`## Память о пользователе`, core.summary];
      if (core.facts?.length)         lines.push(`Факты: ${core.facts.join('; ')}`);
      if (core.preferences?.length)   lines.push(`Предпочтения: ${core.preferences.join('; ')}`);
      if (core.ongoing_tasks?.length) lines.push(`Активные задачи: ${core.ongoing_tasks.join('; ')}`);
      if (core.recent_topics?.length) lines.push(`Недавние темы: ${core.recent_topics.join('; ')}`);
      parts.push(lines.join('\n'));
    // Legacy plain-text format ({ content: "..." })
    } else if (core.content?.trim()) {
      parts.push(`## Долгосрочная память\n${core.content.trim()}`);
    // Fallback raw string saved on parse failure
    } else if (core.raw?.trim()) {
      parts.push(`## Долгосрочная память\n${core.raw.trim()}`);
    }
  }

  const profileText = profile.content?.trim() || '';
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

export function updateMemoryCore(data) {
  // data can be a structured object or a plain string (legacy)
  const payload = typeof data === 'string' ? { content: data, updatedAt: Date.now() } : { ...data, updatedAt: Date.now() };
  writeJSON('memory_core.json', payload);
}
