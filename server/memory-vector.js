import Database from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'memory.db');

let db;

function getDb() {
  if (!db) {
    db = new Database.Database(DB_PATH);
    db.run(`CREATE TABLE IF NOT EXISTS memory_vectors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      text TEXT NOT NULL,
      embedding TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_mv_session ON memory_vectors(session_id)`);
  }
  return db;
}

// ── Embedding через OpenRouter ──────────────────────────────────
async function getEmbedding(text) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text.slice(0, 8000),
      }),
    });
    const data = await res.json();
    return data?.data?.[0]?.embedding ?? null;
  } catch (e) {
    console.error('[memvec] embedding error:', e.message);
    return null;
  }
}

// ── Cosine similarity ────────────────────────────────────────────
function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// ── Поиск релевантных воспоминаний ──────────────────────────────
async function searchMemory(query, sessionId, limit = 5) {
  if (!process.env.OPENROUTER_API_KEY) return [];

  const queryEmb = await getEmbedding(query);
  if (!queryEmb) return [];

  const db = getDb();
  const rows = await new Promise((resolve, reject) => {
    db.all(
      `SELECT text, embedding FROM memory_vectors
       WHERE session_id = ? AND embedding IS NOT NULL
       ORDER BY created_at DESC LIMIT 200`,
      [sessionId],
      (err, rows) => (err ? reject(err) : resolve(rows)),
    );
  });

  return rows
    .map(r => ({ text: r.text, score: cosineSim(queryEmb, JSON.parse(r.embedding)) }))
    .filter(r => r.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(r => r.text);
}

// ── Сохранение воспоминания ─────────────────────────────────────
async function saveMemory(sessionId, text) {
  if (!text || !process.env.OPENROUTER_API_KEY || process.env.VECTOR_MEMORY !== 'true') return;

  const embedding = await getEmbedding(text);
  const db = getDb();
  db.run(
    `INSERT INTO memory_vectors (session_id, text, embedding) VALUES (?, ?, ?)`,
    [sessionId, text.slice(0, 2000), embedding ? JSON.stringify(embedding) : null],
  );
}

export { searchMemory, saveMemory };