import type { DB } from '../db/index.js';
import { getMeta } from '../db/index.js';
import { dailyTotals, listTransactions, sumAfter, sumRange, totalBalance, type TxRow } from '../db/repo.js';
import { addDays, localTimeOf, shortDateLabel, todayLocal } from '../lib/time.js';

export interface TxDto {
  id: number;
  occurredAt: string;
  localDate: string;
  time: string | null;
  amountCents: number;
  title: string;
  subtitle: string;
  description: string;
  counterpart: string | null;
  method: string | null;
  category: string | null;
  status: string;
}

export function toTxDto(r: TxRow): TxDto {
  const time = r.has_time ? localTimeOf(r.occurred_at) : null;
  const pending = r.status === 'PENDING' ? ' · pendente' : '';
  return {
    id: r.id,
    occurredAt: r.occurred_at,
    localDate: r.local_date,
    time,
    amountCents: r.amount_cents,
    title: r.counterpart ?? r.description,
    subtitle: `${r.counterpart ? r.description : (r.category ?? 'Movimentação')}${time ? ` · ${time}` : ''}${pending}`,
    description: r.description,
    counterpart: r.counterpart,
    method: r.method,
    category: r.category,
    status: r.status,
  };
}

export interface DayPoint {
  date: string;
  inCents: number;
  outCents: number;
  netCents: number;
  closingBalanceCents: number;
}

export interface SummaryDto {
  balanceCents: number;
  balanceUpdatedAt: string | null;
  lastSyncAt: string | null;
  today: { date: string; label: string; inCents: number; outCents: number };
  week: { from: string; to: string; inCents: number; outCents: number; netCents: number };
  series: DayPoint[];
  recent: TxDto[];
}

/** Saldo, entrou/saiu hoje e série dos últimos 7 dias (com saldo de fechamento de cada dia). */
export function buildSummary(db: DB, now: Date): SummaryDto {
  const today = todayLocal(now);
  const from = addDays(today, -6);
  const { balanceCents, updatedAt } = totalBalance(db);
  const todayTotals = sumRange(db, { from: today, to: today });
  const week = sumRange(db, { from, to: today });
  const daily = dailyTotals(db, { from, to: today });

  const series: DayPoint[] = [];
  for (let d = from; d <= today; d = addDays(d, 1)) {
    const t = daily.get(d) ?? { inCents: 0, outCents: 0, netCents: 0 };
    series.push({
      date: d,
      inCents: t.inCents,
      outCents: t.outCents,
      netCents: t.netCents,
      closingBalanceCents: balanceCents - sumAfter(db, d),
    });
  }

  return {
    balanceCents,
    balanceUpdatedAt: updatedAt,
    lastSyncAt: getMeta(db, 'last_sync_at') ?? null,
    today: { date: today, label: shortDateLabel(today), inCents: todayTotals.inCents, outCents: todayTotals.outCents },
    week: { from, to: today, inCents: week.inCents, outCents: week.outCents, netCents: week.netCents },
    series,
    recent: listTransactions(db, { limit: 3 }).map(toTxDto),
  };
}

// ---------- cursor opaco para paginação ----------

export function encodeCursor(row: { occurred_at: string; id: number }): string {
  return Buffer.from(JSON.stringify({ o: row.occurred_at, i: row.id }), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { occurredAt: string; id: number } | undefined {
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o?: unknown; i?: unknown };
    if (typeof v.o === 'string' && typeof v.i === 'number' && Number.isSafeInteger(v.i)) {
      return { occurredAt: v.o, id: v.i };
    }
  } catch {
    /* cursor inválido */
  }
  return undefined;
}
