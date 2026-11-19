import type { DB } from './index.js';
import type { DateRange } from '../lib/time.js';

/* Caixinhas (investimentos) e cartão de crédito. Valores sempre em centavos. */

export interface InvestmentInput {
  id: string;
  itemId: string | null;
  name: string;
  type: string;
  subtype: string | null;
  status: string | null;
  balanceCents: number;
  rate: number | null;
  rateType: string | null;
  issuer: string | null;
  dueDate: string | null;
  referenceDate: string | null;
}

export interface InvestmentRow {
  id: string;
  item_id: string | null;
  name: string;
  type: string;
  subtype: string | null;
  status: string | null;
  balance_cents: number;
  rate: number | null;
  rate_type: string | null;
  issuer: string | null;
  due_date: string | null;
  reference_date: string | null;
  updated_at: string;
}

export function upsertInvestment(db: DB, i: InvestmentInput, nowIso: string): void {
  db.prepare(
    `INSERT INTO investments(id, item_id, name, type, subtype, status, balance_cents, rate, rate_type, issuer, due_date, reference_date, updated_at)
     VALUES (@id, @itemId, @name, @type, @subtype, @status, @balanceCents, @rate, @rateType, @issuer, @dueDate, @referenceDate, @now)
     ON CONFLICT(id) DO UPDATE SET item_id=excluded.item_id, name=excluded.name, type=excluded.type, subtype=excluded.subtype,
       status=excluded.status, balance_cents=excluded.balance_cents, rate=excluded.rate, rate_type=excluded.rate_type,
       issuer=excluded.issuer, due_date=excluded.due_date, reference_date=excluded.reference_date, updated_at=excluded.updated_at`,
  ).run({ ...i, now: nowIso });
}

/** Remove investimentos do item que não vieram mais na API (resgatados e apagados na origem). */
export function pruneInvestments(db: DB, itemId: string, keepIds: string[]): void {
  const all = db.prepare('SELECT id FROM investments WHERE item_id = ?').all(itemId) as { id: string }[];
  const keep = new Set(keepIds);
  const del = db.prepare('DELETE FROM investments WHERE id = ?');
  for (const r of all) if (!keep.has(r.id)) del.run(r.id);
}

/** Posições com saldo (ativas). Resgatadas por completo ficam de fora. */
export function listActiveInvestments(db: DB): InvestmentRow[] {
  return db
    .prepare(
      `SELECT * FROM investments
       WHERE balance_cents > 0 AND (status IS NULL OR status <> 'TOTAL_WITHDRAWAL')
       ORDER BY balance_cents DESC, id`,
    )
    .all() as InvestmentRow[];
}

export interface CreditCardInput {
  id: string;
  itemId: string | null;
  name: string;
  number: string | null;
  brand: string | null;
  level: string | null;
  openBillCents: number;
  creditLimitCents: number | null;
  availableLimitCents: number | null;
  minimumPaymentCents: number | null;
  closeDate: string | null;
  dueDate: string | null;
}

export interface CreditCardRow {
  id: string;
  item_id: string | null;
  name: string;
  number: string | null;
  brand: string | null;
  level: string | null;
  open_bill_cents: number;
  credit_limit_cents: number | null;
  available_limit_cents: number | null;
  minimum_payment_cents: number | null;
  close_date: string | null;
  due_date: string | null;
  updated_at: string;
}

export function upsertCreditCard(db: DB, c: CreditCardInput, nowIso: string): void {
  db.prepare(
    `INSERT INTO credit_cards(id, item_id, name, number, brand, level, open_bill_cents, credit_limit_cents, available_limit_cents,
       minimum_payment_cents, close_date, due_date, updated_at)
     VALUES (@id, @itemId, @name, @number, @brand, @level, @openBillCents, @creditLimitCents, @availableLimitCents,
       @minimumPaymentCents, @closeDate, @dueDate, @now)
     ON CONFLICT(id) DO UPDATE SET item_id=excluded.item_id, name=excluded.name, number=excluded.number, brand=excluded.brand,
       level=excluded.level, open_bill_cents=excluded.open_bill_cents, credit_limit_cents=excluded.credit_limit_cents,
       available_limit_cents=excluded.available_limit_cents, minimum_payment_cents=excluded.minimum_payment_cents,
       close_date=excluded.close_date, due_date=excluded.due_date, updated_at=excluded.updated_at`,
  ).run({ ...c, now: nowIso });
}

export function listCreditCards(db: DB): CreditCardRow[] {
  return db.prepare('SELECT * FROM credit_cards ORDER BY name, id').all() as CreditCardRow[];
}

export interface BillRow {
  id: string;
  card_id: string;
  due_date: string;
  total_cents: number;
  minimum_cents: number | null;
}

export function upsertBill(
  db: DB,
  b: { id: string; cardId: string; dueDate: string; totalCents: number; minimumCents: number | null },
  nowIso: string,
): void {
  db.prepare(
    `INSERT INTO card_bills(id, card_id, due_date, total_cents, minimum_cents, updated_at)
     VALUES (@id, @cardId, @dueDate, @totalCents, @minimumCents, @now)
     ON CONFLICT(id) DO UPDATE SET due_date=excluded.due_date, total_cents=excluded.total_cents,
       minimum_cents=excluded.minimum_cents, updated_at=excluded.updated_at`,
  ).run({ ...b, now: nowIso });
}

export function listBills(db: DB, cardId: string, limit: number): BillRow[] {
  return db
    .prepare('SELECT * FROM card_bills WHERE card_id = ? ORDER BY due_date DESC LIMIT ?')
    .all(cardId, limit) as BillRow[];
}

export interface CardTxInput {
  externalId: string;
  cardId: string;
  occurredAt: string;
  localDate: string;
  amountCents: number; // > 0 compra/cobrança
  description: string;
  category: string | null;
  status: string;
  billMonth: string | null;
  installmentNumber: number | null;
  totalInstallments: number | null;
}

export interface CardTxRow {
  id: number;
  external_id: string;
  card_id: string;
  occurred_at: string;
  local_date: string;
  amount_cents: number;
  description: string;
  category: string | null;
  status: string;
  bill_month: string | null;
  installment_number: number | null;
  total_installments: number | null;
}

/** Idempotente pela chave externa. */
export function upsertCardTransaction(db: DB, t: CardTxInput, nowIso: string): void {
  if (!Number.isSafeInteger(t.amountCents)) throw new Error('amountCents precisa ser inteiro');
  db.prepare(
    `INSERT INTO card_transactions(external_id, card_id, occurred_at, local_date, amount_cents, description, category, status,
       bill_month, installment_number, total_installments, deleted, created_at, updated_at)
     VALUES (@externalId, @cardId, @occurredAt, @localDate, @amountCents, @description, @category, @status,
       @billMonth, @installmentNumber, @totalInstallments, 0, @now, @now)
     ON CONFLICT(external_id) DO UPDATE SET card_id=excluded.card_id, occurred_at=excluded.occurred_at,
       local_date=excluded.local_date, amount_cents=excluded.amount_cents, description=excluded.description,
       category=excluded.category, status=excluded.status, bill_month=excluded.bill_month,
       installment_number=excluded.installment_number, total_installments=excluded.total_installments,
       deleted=0, updated_at=excluded.updated_at`,
  ).run({ ...t, now: nowIso });
}

export function markCardTransactionsDeleted(db: DB, externalIds: string[], nowIso: string): number {
  const stmt = db.prepare('UPDATE card_transactions SET deleted = 1, updated_at = ? WHERE external_id = ?');
  let n = 0;
  db.transaction(() => {
    for (const id of externalIds) n += stmt.run(nowIso, id).changes;
  })();
  return n;
}

export function recentCardTransactions(db: DB, limit: number): CardTxRow[] {
  return db
    .prepare('SELECT * FROM card_transactions WHERE deleted = 0 ORDER BY occurred_at DESC, id DESC LIMIT ?')
    .all(limit) as CardTxRow[];
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Gastos no cartão no período (pela data da compra), opcionalmente filtrados por termos. */
export function cardSpending(
  db: DB,
  range: DateRange,
  terms: string[],
  limit: number,
): { chargesCents: number; creditsCents: number; count: number; items: CardTxRow[] } {
  const clean = terms.map((t) => t.trim()).filter(Boolean);
  const cond = clean.length
    ? `AND (${clean.map(() => "(description LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\')").join(' OR ')})`
    : '';
  const likeArgs = clean.flatMap((t) => {
    const v = `%${escapeLike(t)}%`;
    return [v, v];
  });
  const base = `FROM card_transactions WHERE deleted = 0 AND local_date BETWEEN ? AND ? ${cond}`;
  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents END), 0) AS ch,
              COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents END), 0) AS cr,
              COUNT(CASE WHEN amount_cents > 0 THEN 1 END) AS n ${base}`,
    )
    .get(range.from, range.to, ...likeArgs) as { ch: number; cr: number; n: number };
  const items = db
    .prepare(`SELECT * ${base} AND amount_cents > 0 ORDER BY amount_cents DESC, occurred_at DESC LIMIT ?`)
    .all(range.from, range.to, ...likeArgs, limit) as CardTxRow[];
  return { chargesCents: totals.ch, creditsCents: totals.cr, count: totals.n, items };
}

/** Soma das compras (menos estornos) por mês de fatura, a partir de `fromMonth` (YYYY-MM). Inclui parcelas futuras. */
export function billTotalsByMonth(db: DB, cardId: string, fromMonth: string, months: number): { month: string; totalCents: number; count: number }[] {
  return db
    .prepare(
      `SELECT bill_month AS month, COALESCE(SUM(amount_cents), 0) AS totalCents, COUNT(*) AS count
       FROM card_transactions WHERE deleted = 0 AND card_id = ? AND bill_month IS NOT NULL AND bill_month >= ?
       GROUP BY bill_month ORDER BY bill_month ASC LIMIT ?`,
    )
    .all(cardId, fromMonth, months) as { month: string; totalCents: number; count: number }[];
}

/** Dinheiro guardado e resgatado nas caixinhas no período (movimentações internas da conta). */
export function reserveFlows(db: DB, range: DateRange): { savedCents: number; withdrawnCents: number; count: number } {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents END), 0) AS saved,
              COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents END), 0) AS withdrawn,
              COUNT(*) AS n
       FROM transactions WHERE deleted = 0 AND internal = 1 AND local_date BETWEEN ? AND ?`,
    )
    .get(range.from, range.to) as { saved: number; withdrawn: number; n: number };
  return { savedCents: r.saved, withdrawnCents: r.withdrawn, count: r.n };
}

/**
 * Gastos (ou entradas) por categoria no período.
 * source: 'conta' (débito/Pix), 'cartao' (compras no crédito) ou 'tudo'.
 */
export function categoryBreakdown(
  db: DB,
  range: DateRange,
  direction: 'in' | 'out',
  source: 'conta' | 'cartao' | 'tudo',
  limit: number,
): { category: string; totalCents: number; count: number }[] {
  const parts: string[] = [];
  const args: (string | number)[] = [];
  if (source !== 'cartao') {
    parts.push(
      `SELECT COALESCE(category, 'Sem categoria') AS category, ${direction === 'out' ? '-amount_cents' : 'amount_cents'} AS v
       FROM transactions WHERE deleted = 0 AND internal = 0 AND ${direction === 'out' ? 'amount_cents < 0' : 'amount_cents > 0'}
         AND local_date BETWEEN ? AND ?`,
    );
    args.push(range.from, range.to);
  }
  if (source !== 'conta' && direction === 'out') {
    parts.push(
      `SELECT COALESCE(category, 'Sem categoria') AS category, amount_cents AS v
       FROM card_transactions WHERE deleted = 0 AND amount_cents > 0 AND local_date BETWEEN ? AND ?`,
    );
    args.push(range.from, range.to);
  }
  if (parts.length === 0) return [];
  args.push(limit);
  return db
    .prepare(
      `SELECT category, SUM(v) AS totalCents, COUNT(*) AS count FROM (${parts.join(' UNION ALL ')})
       GROUP BY category ORDER BY totalCents DESC, category ASC LIMIT ?`,
    )
    .all(...args) as { category: string; totalCents: number; count: number }[];
}
