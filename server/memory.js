import db from './db.js';

export function getMemoryContext() {
  const core    = db.prepare('SELECT content FROM memory_core  WHERE id = 1').get();
  const profile = db.prepare('SELECT content FROM user_profile WHERE id = 1').get();

  const coreText    = core?.content?.trim()    || '';
  const profileText = profile?.content?.trim() || '';

  if (!coreText && !profileText) return '';

  const parts = [];
  if (coreText)    parts.push(`## Долгосрочная память\n${coreText}`);
  if (profileText) parts.push(`## Профиль пользователя\n${profileText}`);
  return parts.join('\n\n');
}

export function saveMessage(sessionId, role, content) {
  db.prepare(
    'INSERT INTO sessions (session_id, role, content, created_at) VALUES (?, ?, ?, ?)'
  ).run(sessionId, role, content, Date.now());
}

export function getRecentSessions(sinceDays = 3) {
  const since = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  return db.prepare(
    'SELECT * FROM sessions WHERE created_at >= ? ORDER BY created_at ASC'
  ).all(since);
}

export function updateMemoryCore(newContent) {
  db.prepare(
    'UPDATE memory_core SET content = ?, updated_at = ? WHERE id = 1'
  ).run(newContent, Date.now());
}
