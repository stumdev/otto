import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = Database.Database;

/**
 * Migrações em ordem. Nunca edite uma migração já aplicada: acrescente outra.
 * Valores monetários são INTEGER em centavos.
 */
const MIGRATIONS: string[] = [
  // 1 — esquema inicial
  `
  CREATE TABLE accounts (
    id            TEXT PRIMARY KEY,          -- id do agregador (ou "mock-checking")
    item_id       TEXT,
    name          TEXT NOT NULL,
    balance_cents INTEGER NOT NULL DEFAULT 0,
    currency      TEXT NOT NULL DEFAULT 'BRL',
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE transactions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id   TEXT NOT NULL UNIQUE,      -- chave idempotente (id do agregador)
    account_id    TEXT NOT NULL REFERENCES accounts(id),
    occurred_at   TEXT NOT NULL,             -- instante UTC ISO-8601 (ordenação)
    local_date    TEXT NOT NULL,             -- YYYY-MM-DD em America/Sao_Paulo (agregação)
    has_time      INTEGER NOT NULL DEFAULT 1,-- 0 quando o banco só informou a data
    amount_cents  INTEGER NOT NULL,          -- > 0 entrada, < 0 saída
    description   TEXT NOT NULL,
    counterpart   TEXT,
    method        TEXT,                      -- PIX, TED, BOLETO, CARTAO...
    category      TEXT,
    status        TEXT NOT NULL DEFAULT 'POSTED',
    deleted       INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );
  CREATE INDEX idx_tx_local_date ON transactions(local_date);
  CREATE INDEX idx_tx_order ON transactions(occurred_at DESC, id DESC);

  CREATE TABLE notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    dedupe_key  TEXT NOT NULL UNIQUE,        -- ex.: "tx:<externalId>", "summary:2026-11-19"
    kind        TEXT NOT NULL,               -- in | out | summary | test
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    target      TEXT NOT NULL DEFAULT 'home',
    created_at  TEXT NOT NULL,
    push_sent_at TEXT
  );

  CREATE TABLE devices (
    token      TEXT PRIMARY KEY,
    platform   TEXT NOT NULL DEFAULT 'android',
    created_at TEXT NOT NULL,
    last_seen  TEXT NOT NULL
  );

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE webhook_events (
    event_id    TEXT PRIMARY KEY,
    event       TEXT NOT NULL,
    received_at TEXT NOT NULL
  );

  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

export function openDatabase(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

export function migrate(db: DB): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    const sql = MIGRATIONS[v]!;
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

export function getMeta(db: DB, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setMeta(db: DB, key: string, value: string): void {
  db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    value,
  );
}
