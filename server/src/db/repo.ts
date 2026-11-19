import type { DB } from './index.js';
import type { DateRange } from '../lib/time.js';

export interface TxInput {
  externalId: string;
  accountId: string;
  occurredAt: string; // UTC ISO
  localDate: string; // YYYY-MM-DD (São Paulo)
  hasTime: boolean;
  amountCents: number;
  description: string;
  counterpart?: string | null;
  method?: string | null;
  category?: string | null;
  status?: string;
  /** Movimentação com as caixinhas: entra no saldo, não nos totais de entrada/saída. */
  internal?: boolean;
}

export interface TxRow {
  id: number;
  external_id: string;
  account_id: string;
  occurred_at: string;
  local_date: string;
  has_time: number;
  amount_cents: number;
  description: string;
  counterpart: string | null;
  method: string | null;
  category: string | null;
  status: string;
  source_fingerprint: string | null;
  internal: number;
}

export interface AccountRow {
  id: string;
  item_id: string | null;
  name: string;
  balance_cents: number;
  currency: string;
  updated_at: string;
}

// ---------- contas ----------

export function upsertAccount(
  db: DB,
  a: { id: string; itemId: string | null; name: string; balanceCents: number; currency: string },
  nowIso: string,
): void {
  db.prepare(
    `INSERT INTO accounts(id, item_id, name, balance_cents, currency, updated_at)
     VALUES (@id, @itemId, @name, @balanceCents, @currency, @now)
     ON CONFLICT(id) DO UPDATE SET item_id = excluded.item_id, name = excluded.name,
       balance_cents = excluded.balance_cents, currency = excluded.currency, updated_at = excluded.updated_at`,
  ).run({ ...a, now: nowIso });
}

export function listAccounts(db: DB): AccountRow[] {
  return db.prepare('SELECT * FROM accounts ORDER BY id').all() as AccountRow[];
}

export const PROVISIONAL = 'PROVISIONAL';

/**
 * Saldo = saldo informado pelas contas + transações provisórias ainda não confirmadas.
 * (O saldo da conta vem do agregador e só passa a incluir uma transação quando ela é
 * entregue; até lá, a provisória lida da notificação do banco cobre a diferença.)
 */
export function totalBalance(db: DB): { balanceCents: number; updatedAt: string | null; provisionalCents: number } {
  const row = db
    .prepare(
      `SELECT
         (SELECT COALESCE(SUM(balance_cents), 0) FROM accounts) AS b,
         (SELECT COALESCE(SUM(amount_cents), 0) FROM transactions WHERE status = '${PROVISIONAL}' AND deleted = 0) AS p,
         (SELECT MAX(updated_at) FROM accounts) AS u`,
    )
    .get() as { b: number; p: number; u: string | null };
  return { balanceCents: row.b + row.p, updatedAt: row.u, provisionalCents: row.p };
}

/** Provisória com o mesmo valor (e sinal) em até ±1 dia da data informada, a mais próxima no tempo. */
export function findProvisionalMatch(
  db: DB,
  amountCents: number,
  fromDate: string,
  toDate: string,
  occurredAt: string,
): TxRow | undefined {
  return db
    .prepare(
      `SELECT * FROM transactions
       WHERE status = '${PROVISIONAL}' AND deleted = 0 AND amount_cents = ? AND local_date BETWEEN ? AND ?
       ORDER BY ABS(julianday(occurred_at) - julianday(?)) ASC, id ASC LIMIT 1`,
    )
    .get(amountCents, fromDate, toDate, occurredAt) as TxRow | undefined;
}

/**
 * Transação oficial (não provisória) ainda não vinculada a nenhuma notificação, com o mesmo
 * valor em até ±1 dia e gravada recentemente. Usada quando o agregador entrega antes da notificação.
 */
export function findUnclaimedOfficial(
  db: DB,
  amountCents: number,
  fromDate: string,
  toDate: string,
  occurredAt: string,
  createdAfterIso: string,
): TxRow | undefined {
  return db
    .prepare(
      `SELECT * FROM transactions
       WHERE status <> '${PROVISIONAL}' AND deleted = 0 AND source_fingerprint IS NULL
         AND amount_cents = ? AND local_date BETWEEN ? AND ? AND created_at >= ?
       ORDER BY ABS(julianday(occurred_at) - julianday(?)) ASC, id ASC LIMIT 1`,
    )
    .get(amountCents, fromDate, toDate, createdAfterIso, occurredAt) as TxRow | undefined;
}

export function findByFingerprint(db: DB, fingerprint: string): TxRow | undefined {
  return db
    .prepare('SELECT * FROM transactions WHERE source_fingerprint = ? ORDER BY id LIMIT 1')
    .get(fingerprint) as TxRow | undefined;
}

export function setFingerprint(db: DB, id: number, fingerprint: string): void {
  db.prepare('UPDATE transactions SET source_fingerprint = ? WHERE id = ?').run(fingerprint, id);
}

export function deleteTransactionRow(db: DB, id: number): void {
  db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
}

/** Provisórias nunca confirmadas pelo agregador saem do saldo depois do prazo. */
export function expireProvisionals(db: DB, createdBeforeIso: string, nowIso: string): number {
  return db
    .prepare(
      `UPDATE transactions SET deleted = 1, updated_at = ?
       WHERE status = '${PROVISIONAL}' AND deleted = 0 AND created_at < ?`,
    )
    .run(nowIso, createdBeforeIso).changes;
}

export function adjustBalance(db: DB, accountId: string, deltaCents: number, nowIso: string): void {
  db.prepare('UPDATE accounts SET balance_cents = balance_cents + ?, updated_at = ? WHERE id = ?').run(
    deltaCents,
    nowIso,
    accountId,
  );
}

// ---------- transações ----------

/** Insere ou atualiza pela chave idempotente `externalId`. Retorna se a linha é nova. */
export function upsertTransaction(db: DB, tx: TxInput, nowIso: string): { inserted: boolean; id: number } {
  if (!Number.isSafeInteger(tx.amountCents)) throw new Error('amountCents precisa ser inteiro');
  const existing = db.prepare('SELECT id FROM transactions WHERE external_id = ?').get(tx.externalId) as
    | { id: number }
    | undefined;
  const params = {
    externalId: tx.externalId,
    accountId: tx.accountId,
    occurredAt: tx.occurredAt,
    localDate: tx.localDate,
    hasTime: tx.hasTime ? 1 : 0,
    amountCents: tx.amountCents,
    description: tx.description,
    counterpart: tx.counterpart ?? null,
    method: tx.method ?? null,
    category: tx.category ?? null,
    status: tx.status ?? 'POSTED',
    internal: tx.internal ? 1 : 0,
    now: nowIso,
  };
  if (existing) {
    db.prepare(
      `UPDATE transactions SET account_id=@accountId, occurred_at=@occurredAt, local_date=@localDate,
         has_time=@hasTime, amount_cents=@amountCents, description=@description, counterpart=@counterpart,
         method=@method, category=@category, status=@status, internal=@internal, deleted=0, updated_at=@now
       WHERE external_id=@externalId`,
    ).run(params);
    return { inserted: false, id: existing.id };
  }
  const info = db
    .prepare(
      `INSERT INTO transactions(external_id, account_id, occurred_at, local_date, has_time, amount_cents,
         description, counterpart, method, category, status, internal, created_at, updated_at)
       VALUES (@externalId, @accountId, @occurredAt, @localDate, @hasTime, @amountCents,
         @description, @counterpart, @method, @category, @status, @internal, @now, @now)`,
    )
    .run(params);
  return { inserted: true, id: Number(info.lastInsertRowid) };
}

export function markTransactionsDeleted(db: DB, externalIds: string[], nowIso: string): number {
  const stmt = db.prepare('UPDATE transactions SET deleted = 1, updated_at = ? WHERE external_id = ?');
  let n = 0;
  db.transaction(() => {
    for (const id of externalIds) n += stmt.run(nowIso, id).changes;
  })();
  return n;
}

export function getTransactionByExternalId(db: DB, externalId: string): TxRow | undefined {
  return db.prepare('SELECT * FROM transactions WHERE external_id = ?').get(externalId) as TxRow | undefined;
}

export interface PeriodTotals {
  inCents: number;
  outCents: number; // valor positivo (soma das saídas em módulo)
  netCents: number;
  countIn: number;
  countOut: number;
}

export function sumRange(db: DB, range: DateRange): PeriodTotals {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents END), 0) AS inC,
         COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents END), 0) AS outC,
         COUNT(CASE WHEN amount_cents > 0 THEN 1 END) AS nIn,
         COUNT(CASE WHEN amount_cents < 0 THEN 1 END) AS nOut
       FROM transactions WHERE deleted = 0 AND internal = 0 AND local_date BETWEEN ? AND ?`,
    )
    .get(range.from, range.to) as { inC: number; outC: number; nIn: number; nOut: number };
  return { inCents: row.inC, outCents: row.outC, netCents: row.inC - row.outC, countIn: row.nIn, countOut: row.nOut };
}

export function dailyTotals(db: DB, range: DateRange): Map<string, PeriodTotals> {
  const rows = db
    .prepare(
      `SELECT local_date AS d,
         COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents END), 0) AS inC,
         COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents END), 0) AS outC,
         COUNT(CASE WHEN amount_cents > 0 THEN 1 END) AS nIn,
         COUNT(CASE WHEN amount_cents < 0 THEN 1 END) AS nOut
       FROM transactions WHERE deleted = 0 AND internal = 0 AND local_date BETWEEN ? AND ?
       GROUP BY local_date`,
    )
    .all(range.from, range.to) as { d: string; inC: number; outC: number; nIn: number; nOut: number }[];
  const map = new Map<string, PeriodTotals>();
  for (const r of rows) {
    map.set(r.d, { inCents: r.inC, outCents: r.outC, netCents: r.inC - r.outC, countIn: r.nIn, countOut: r.nOut });
  }
  return map;
}

/** Soma de todas as transações com data local posterior a `date` (para reconstruir saldo de fechamento). */
export function sumAfter(db: DB, date: string): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(amount_cents), 0) AS s FROM transactions WHERE deleted = 0 AND local_date > ?')
    .get(date) as { s: number };
  return row.s;
}

export function sumAll(db: DB): number {
  const row = db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS s FROM transactions WHERE deleted = 0').get() as {
    s: number;
  };
  return row.s;
}

export interface ListParams {
  limit: number;
  cursor?: { occurredAt: string; id: number };
  range?: Partial<DateRange>;
}

export function listTransactions(db: DB, p: ListParams): TxRow[] {
  const where: string[] = ['deleted = 0'];
  const args: (string | number)[] = [];
  if (p.range?.from) {
    where.push('local_date >= ?');
    args.push(p.range.from);
  }
  if (p.range?.to) {
    where.push('local_date <= ?');
    args.push(p.range.to);
  }
  if (p.cursor) {
    where.push('(occurred_at < ? OR (occurred_at = ? AND id < ?))');
    args.push(p.cursor.occurredAt, p.cursor.occurredAt, p.cursor.id);
  }
  args.push(p.limit);
  return db
    .prepare(`SELECT * FROM transactions WHERE ${where.join(' AND ')} ORDER BY occurred_at DESC, id DESC LIMIT ?`)
    .all(...args) as TxRow[];
}

export function topTransactions(db: DB, range: DateRange, direction: 'in' | 'out', limit: number): TxRow[] {
  const order = direction === 'in' ? 'amount_cents DESC' : 'amount_cents ASC';
  const sign = direction === 'in' ? 'amount_cents > 0' : 'amount_cents < 0';
  return db
    .prepare(
      `SELECT * FROM transactions WHERE deleted = 0 AND internal = 0 AND ${sign} AND local_date BETWEEN ? AND ?
       ORDER BY ${order}, occurred_at DESC LIMIT ?`,
    )
    .all(range.from, range.to, limit) as TxRow[];
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Busca por termos (OR) em descrição, contraparte e categoria. */
export function searchTransactions(
  db: DB,
  terms: string[],
  range: DateRange,
  limit: number,
): { totals: PeriodTotals; items: TxRow[] } {
  const clean = terms.map((t) => t.trim()).filter((t) => t.length > 0);
  if (clean.length === 0) {
    return { totals: { inCents: 0, outCents: 0, netCents: 0, countIn: 0, countOut: 0 }, items: [] };
  }
  const conds = clean
    .map(
      () =>
        // LIKE do SQLite já ignora maiúsculas/minúsculas em ASCII
        "(description LIKE ? ESCAPE '\\' OR counterpart LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\')",
    )
    .join(' OR ');
  const likeArgs = clean.flatMap((t) => {
    const v = `%${escapeLike(t)}%`;
    return [v, v, v];
  });
  const base = `FROM transactions WHERE deleted = 0 AND internal = 0 AND local_date BETWEEN ? AND ? AND (${conds})`;
  const totalsRow = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents END), 0) AS inC,
         COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents END), 0) AS outC,
         COUNT(CASE WHEN amount_cents > 0 THEN 1 END) AS nIn,
         COUNT(CASE WHEN amount_cents < 0 THEN 1 END) AS nOut ${base}`,
    )
    .get(range.from, range.to, ...likeArgs) as { inC: number; outC: number; nIn: number; nOut: number };
  const items = db
    .prepare(`SELECT * ${base} ORDER BY occurred_at DESC LIMIT ?`)
    .all(range.from, range.to, ...likeArgs, limit) as TxRow[];
  return {
    totals: {
      inCents: totalsRow.inC,
      outCents: totalsRow.outC,
      netCents: totalsRow.inC - totalsRow.outC,
      countIn: totalsRow.nIn,
      countOut: totalsRow.nOut,
    },
    items,
  };
}

export function countTransactions(db: DB): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE deleted = 0').get() as { n: number }).n;
}

export function latestLocalDate(db: DB): string | undefined {
  const row = db.prepare('SELECT MAX(local_date) AS d FROM transactions WHERE deleted = 0').get() as {
    d: string | null;
  };
  return row.d ?? undefined;
}

// ---------- dispositivos ----------

export function upsertDevice(db: DB, token: string, platform: string, nowIso: string): void {
  db.prepare(
    `INSERT INTO devices(token, platform, created_at, last_seen) VALUES (?, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET last_seen = excluded.last_seen, platform = excluded.platform`,
  ).run(token, platform, nowIso, nowIso);
}

export function listDeviceTokens(db: DB): string[] {
  return (db.prepare('SELECT token FROM devices').all() as { token: string }[]).map((r) => r.token);
}

export function deleteDevice(db: DB, token: string): void {
  db.prepare('DELETE FROM devices WHERE token = ?').run(token);
}

// ---------- notificações (outbox) ----------

export interface NotificationRow {
  id: number;
  dedupe_key: string;
  kind: string;
  title: string;
  body: string;
  target: string;
  created_at: string;
  push_sent_at: string | null;
}

/** Grava a notificação se a chave ainda não existe. Retorna a linha nova, ou undefined se já existia. */
export function insertNotificationOnce(
  db: DB,
  n: { dedupeKey: string; kind: string; title: string; body: string; target: string },
  nowIso: string,
): NotificationRow | undefined {
  const info = db
    .prepare(
      `INSERT INTO notifications(dedupe_key, kind, title, body, target, created_at)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(dedupe_key) DO NOTHING`,
    )
    .run(n.dedupeKey, n.kind, n.title, n.body, n.target, nowIso);
  if (info.changes === 0) return undefined;
  return db.prepare('SELECT * FROM notifications WHERE id = ?').get(Number(info.lastInsertRowid)) as NotificationRow;
}

export function markPushSent(db: DB, id: number, nowIso: string): void {
  db.prepare('UPDATE notifications SET push_sent_at = ? WHERE id = ?').run(nowIso, id);
}

export function listNotificationsAfter(db: DB, afterId: number, limit: number): NotificationRow[] {
  return db
    .prepare('SELECT * FROM notifications WHERE id > ? ORDER BY id ASC LIMIT ?')
    .all(afterId, limit) as NotificationRow[];
}

export function lastNotificationId(db: DB): number {
  return (db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM notifications').get() as { m: number }).m;
}

// ---------- webhooks ----------

/** Registra o eventId; retorna false se já foi processado (idempotência). */
export function recordWebhookEvent(db: DB, eventId: string, event: string, nowIso: string): boolean {
  const info = db
    .prepare('INSERT INTO webhook_events(event_id, event, received_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
    .run(eventId, event, nowIso);
  return info.changes > 0;
}
