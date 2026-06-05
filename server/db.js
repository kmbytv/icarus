import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH = process.env.DB_PATH || '/data/kai.db';

// Ensure the directory exists
const dir = path.dirname(DB_PATH);
fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT    NOT NULL,
    role       TEXT    NOT NULL,
    content    TEXT    NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS memory_core (
    id         INTEGER PRIMARY KEY,
    content    TEXT    NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS user_profile (
    id         INTEGER PRIMARY KEY,
    content    TEXT    NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL DEFAULT 0
  );
`);

// Ensure singleton rows exist
db.prepare('INSERT OR IGNORE INTO memory_core  (id, content, updated_at) VALUES (1, \'\', 0)').run();
db.prepare('INSERT OR IGNORE INTO user_profile (id, content, updated_at) VALUES (1, \'\', 0)').run();

export default db;
