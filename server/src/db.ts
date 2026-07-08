// Dual-backend data layer.
//
//  • If DATABASE_URL is set  -> PostgreSQL (e.g. Neon free tier, for production).
//  • Otherwise               -> local SQLite file (great for dev & Docker self-host).
//
// All callers use the same async helpers: `dbGet`, `dbAll`, `dbRun`.
// SQL is written in Postgres style with $1, $2 … placeholders; the SQLite
// adapter rewrites them to `?` automatically.

const DATABASE_URL = process.env.DATABASE_URL;
export const usingPostgres = Boolean(DATABASE_URL);

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

export interface RunResult {
  /** Inserted row id (from RETURNING id / lastInsertRowid). */
  lastInsertRowid: number;
  /** Rows affected (for UPDATE/DELETE). */
  changes: number;
}

// The unified interface implemented by both backends.
interface DbAdapter {
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<RunResult>;
  init(): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* PostgreSQL adapter                                                  */
/* ------------------------------------------------------------------ */
async function createPostgresAdapter(): Promise<DbAdapter> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // Neon / most managed PG require SSL
    max: 5,
  });

  return {
    async get<T>(sql: string, params: unknown[] = []) {
      const r = await pool.query(sql, params);
      return (r.rows[0] as T) ?? undefined;
    },
    async all<T>(sql: string, params: unknown[] = []) {
      const r = await pool.query(sql, params);
      return r.rows as T[];
    },
    async run(sql: string, params: unknown[] = []) {
      const r = await pool.query(sql, params);
      const lastInsertRowid =
        r.rows[0] && typeof (r.rows[0] as any).id === 'number' ? (r.rows[0] as any).id : 0;
      return { lastInsertRowid, changes: r.rowCount ?? 0 };
    },
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id         SERIAL PRIMARY KEY,
          email      TEXT UNIQUE NOT NULL,
          password   TEXT NOT NULL,
          created_at BIGINT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS vocab (
          id            SERIAL PRIMARY KEY,
          user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          text          TEXT NOT NULL,
          translation   TEXT,
          target_lang   TEXT NOT NULL DEFAULT 'zh-CN',
          source_lang   TEXT,
          video_id      TEXT,
          video_title   TEXT,
          start_time    DOUBLE PRECISION,
          created_at    BIGINT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_vocab_user ON vocab(user_id, created_at DESC);
      `);
    },
  };
}

/* ------------------------------------------------------------------ */
/* SQLite adapter                                                      */
/* ------------------------------------------------------------------ */
async function createSqliteAdapter(): Promise<DbAdapter> {
  const { default: Database } = await import('better-sqlite3');
  const path = await import('node:path');

  const DB_FILE = process.env.DB_FILE || 'data.db';
  const dbPath = path.isAbsolute(DB_FILE) ? DB_FILE : path.resolve(process.cwd(), DB_FILE);
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');

  // Convert Postgres-style $1,$2 placeholders to SQLite ? placeholders.
  const toSqlite = (sql: string) =>
    sql
      .replace(/\$\d+/g, '?')
      // Strip Postgres-only "RETURNING id" — we read lastInsertRowid instead.
      .replace(/\s+RETURNING\s+id\s*/gi, ' ');

  return {
    async get<T>(sql: string, params: unknown[] = []) {
      return sqlite.prepare(toSqlite(sql)).get(...(params as any[])) as T | undefined;
    },
    async all<T>(sql: string, params: unknown[] = []) {
      return sqlite.prepare(toSqlite(sql)).all(...(params as any[])) as T[];
    },
    async run(sql: string, params: unknown[] = []) {
      const info = sqlite.prepare(toSqlite(sql)).run(...(params as any[]));
      return {
        lastInsertRowid: Number(info.lastInsertRowid),
        changes: info.changes,
      };
    },
    async init() {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          email      TEXT UNIQUE NOT NULL,
          password   TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS vocab (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id       INTEGER NOT NULL,
          text          TEXT NOT NULL,
          translation   TEXT,
          target_lang   TEXT NOT NULL DEFAULT 'zh-CN',
          source_lang   TEXT,
          video_id      TEXT,
          video_title   TEXT,
          start_time    REAL,
          created_at    INTEGER NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_vocab_user ON vocab(user_id, created_at DESC);
      `);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Singleton init                                                      */
/* ------------------------------------------------------------------ */
let adapterPromise: Promise<DbAdapter> | null = null;

async function getAdapter(): Promise<DbAdapter> {
  if (!adapterPromise) {
    adapterPromise = (usingPostgres ? createPostgresAdapter() : createSqliteAdapter()).then(
      async (a) => {
        await a.init();
        console.log(`[yt-lingo] database ready (${usingPostgres ? 'postgres' : 'sqlite'})`);
        return a;
      },
    );
  }
  return adapterPromise;
}

// Public async helpers used by routes.
export async function dbGet<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await getAdapter()).get<T>(sql, params);
}
export async function dbAll<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await getAdapter()).all<T>(sql, params);
}
export async function dbRun(sql: string, params: unknown[] = []): Promise<RunResult> {
  return (await getAdapter()).run(sql, params);
}

// Eagerly initialise on boot so table creation / connection errors surface early.
export const dbReady = getAdapter();
