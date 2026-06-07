import BetterSQLite from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(__dirname, '..', 'data');
const DB_PATH   = path.join(DATA_DIR, 'memory.db');

// Ensure data dir exists
fs.mkdirSync(DATA_DIR, { recursive: true });

let _db = null;
function db() {
  if (!_db) {
    _db = new BetterSQLite(DB_PATH);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS memory_vectors (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        text       TEXT NOT NULL,
        embedding  TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_mv_session ON memory_vectors(session_id);
    `);
  }
  return _db;
}

async function getEmbedding(text) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 8000) }),
    });
    const data = await res.json();
    return data?.data?.[0]?.embedding ?? null;
  } catch (e) {
    console.error('[memvec] embedding error:', e.message);
    return null;
  }
}

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export async function searchMemory(query, sessionId, limit = 5) {
  if (!process.env.OPENROUTER_API_KEY) return [];
  try {
    const queryEmb = await getEmbedding(query);
    if (!queryEmb) return [];

    const rows = db().prepare(
      `SELECT text, embedding FROM memory_vectors
       WHERE session_id = ? AND embedding IS NOT NULL
       ORDER BY created_at DESC LIMIT 200`
    ).all(sessionId);

    return rows
      .map(r => ({ text: r.text, score: cosineSim(queryEmb, JSON.parse(r.embedding)) }))
      .filter(r => r.score > 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(r => r.text);
  } catch (e) {
    console.error('[memvec] searchMemory error:', e.message);
    return [];
  }
}

export async function saveMemory(sessionId, text) {
  if (!text || !process.env.OPENROUTER_API_KEY) return;
  try {
    const embedding = await getEmbedding(text);
    db().prepare(
      `INSERT INTO memory_vectors (session_id, text, embedding) VALUES (?, ?, ?)`
    ).run(sessionId, text.slice(0, 2000), embedding ? JSON.stringify(embedding) : null);
  } catch (e) {
    console.error('[memvec] saveMemory error:', e.message);
  }
}
