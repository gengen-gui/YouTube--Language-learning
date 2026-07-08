import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = process.env.DB_FILE || 'data.db';
// Resolve relative to server/ root (one level up from src/ at runtime this is dist/, so use cwd)
const dbPath = path.isAbsolute(DB_FILE) ? DB_FILE : path.resolve(process.cwd(), DB_FILE);

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT UNIQUE NOT NULL,
    password   TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS vocab (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    text          TEXT NOT NULL,          -- original sentence
    translation   TEXT,                   -- cached translation
    target_lang   TEXT NOT NULL DEFAULT 'zh-CN',
    source_lang   TEXT,
    video_id      TEXT,                   -- YouTube video id
    video_title   TEXT,
    start_time    REAL,                   -- seconds, to jump back
    created_at    INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_vocab_user ON vocab(user_id, created_at DESC);
`);

export interface UserRow {
  id: number;
  email: string;
  password: string;
  created_at: number;
}

export interface VocabRow {
  id: number;
  user_id: number;
  text: string;
  translation: string | null;
  target_lang: string;
  source_lang: string | null;
  video_id: string | null;
  video_title: string | null;
  start_time: number | null;
  created_at: number;
}
