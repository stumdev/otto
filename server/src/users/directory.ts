import Database from 'better-sqlite3';
import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
}

export interface ItemRow {
  item_id: string;
  user_id: string;
  kind: 'pluggy' | 'mock';
  connector: string | null;
  created_at: string;
}

const MIGRATIONS = [
  `
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,         -- minúsculo
    name          TEXT,
    password_hash TEXT NOT NULL,                -- scrypt$<salt b64>$<hash b64>
    created_at    TEXT NOT NULL
  );
  CREATE TABLE sessions (
    token_hash   TEXT PRIMARY KEY,              -- SHA-256 do token (o token em si nunca é guardado)
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TEXT NOT NULL,
    last_used_at TEXT NOT NULL
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);
  CREATE TABLE items (
    item_id    TEXT PRIMARY KEY,                -- itemId da Pluggy, ou "mock:<userId>"
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    connector  TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_items_user ON items(user_id);
  `,
];

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Hash "de mentira" para gastar o mesmo tempo quando o e-mail não existe (não revela contas pelo tempo de resposta). */
const DUMMY_HASH = await hashPassword('otto-dummy-password');

/** Banco central: contas, sessões e a ligação item -> usuário. Os dados financeiros ficam em um banco por usuário. */
export class Directory {
  readonly db: Database.Database;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(path.replace(/[\\/][^\\/]*$/, '') || '.', { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    const current = this.db.pragma('user_version', { simple: true }) as number;
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.db.transaction(() => {
        this.db.exec(MIGRATIONS[v]!);
        this.db.pragma(`user_version = ${v + 1}`);
      })();
    }
  }

  close(): void {
    this.db.close();
  }

  // ---------- usuários ----------

  async createUser(email: string, password: string, name: string | null, nowIso: string): Promise<UserRow | 'exists'> {
    const e = email.trim().toLowerCase();
    if (this.db.prepare('SELECT 1 FROM users WHERE email = ?').get(e)) return 'exists';
    const id = randomUUID();
    const hash = await hashPassword(password);
    try {
      this.db
        .prepare('INSERT INTO users(id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, e, name, hash, nowIso);
    } catch {
      return 'exists'; // corrida entre dois cadastros do mesmo e-mail
    }
    return { id, email: e, name, created_at: nowIso };
  }

  async checkCredentials(email: string, password: string): Promise<UserRow | undefined> {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase()) as
      | (UserRow & { password_hash: string })
      | undefined;
    const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !ok) return undefined;
    return { id: row.id, email: row.email, name: row.name, created_at: row.created_at };
  }

  getUser(id: string): UserRow | undefined {
    return this.db.prepare('SELECT id, email, name, created_at FROM users WHERE id = ?').get(id) as UserRow | undefined;
  }

  /** Apaga a conta (sessões e itens vão em cascata). */
  deleteUser(id: string): void {
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }

  // ---------- sessões ----------

  createSession(userId: string, nowIso: string): string {
    const token = randomBytes(32).toString('base64url');
    this.db
      .prepare('INSERT INTO sessions(token_hash, user_id, created_at, last_used_at) VALUES (?, ?, ?, ?)')
      .run(sha256(token), userId, nowIso, nowIso);
    return token;
  }

  /** Valida o token; renova `last_used_at` (no máx. 1x por hora) e rejeita sessões ociosas demais. */
  resolveSession(token: string, now: Date, idleDays: number): UserRow | undefined {
    const h = sha256(token);
    const row = this.db
      .prepare(
        `SELECT u.id, u.email, u.name, u.created_at, s.last_used_at
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
      )
      .get(h) as (UserRow & { last_used_at: string }) | undefined;
    if (!row) return undefined;
    const idleMs = now.getTime() - Date.parse(row.last_used_at);
    if (idleMs > idleDays * 86_400_000) {
      this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(h);
      return undefined;
    }
    if (idleMs > 3_600_000) {
      this.db.prepare('UPDATE sessions SET last_used_at = ? WHERE token_hash = ?').run(now.toISOString(), h);
    }
    return { id: row.id, email: row.email, name: row.name, created_at: row.created_at };
  }

  deleteSession(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  }

  // ---------- itens (conexões bancárias) ----------

  /** Retorna false se o item já pertence a outro usuário. */
  addItem(itemId: string, userId: string, kind: 'pluggy' | 'mock', connector: string | null, nowIso: string): boolean {
    const existing = this.getItem(itemId);
    if (existing && existing.user_id !== userId) return false;
    this.db
      .prepare(
        `INSERT INTO items(item_id, user_id, kind, connector, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(item_id) DO UPDATE SET connector = excluded.connector`,
      )
      .run(itemId, userId, kind, connector, nowIso);
    return true;
  }

  getItem(itemId: string): ItemRow | undefined {
    return this.db.prepare('SELECT * FROM items WHERE item_id = ?').get(itemId) as ItemRow | undefined;
  }

  itemsOf(userId: string): ItemRow[] {
    return this.db.prepare('SELECT * FROM items WHERE user_id = ? ORDER BY created_at').all(userId) as ItemRow[];
  }

  removeItemsOf(userId: string): void {
    this.db.prepare('DELETE FROM items WHERE user_id = ?').run(userId);
  }

  /** Usuários que têm alguma conexão (os únicos que precisam de sincronização e resumo diário). */
  connectedUserIds(): string[] {
    return (this.db.prepare('SELECT DISTINCT user_id FROM items').all() as { user_id: string }[]).map((r) => r.user_id);
  }
}
