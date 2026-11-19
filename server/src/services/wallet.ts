import type { DB } from '../db/index.js';
import {
  billTotalsByMonth,
  listActiveInvestments,
  listBills,
  listCreditCards,
  recentCardTransactions,
  type CardTxRow,
  type InvestmentRow,
} from '../db/wallet.js';
import { localTimeOf, monthOf, nextMonthlyDate, todayLocal } from '../lib/time.js';
import type { Settings } from './settings.js';

export interface ReserveItemDto {
  id: string;
  name: string;
  balanceCents: number;
  rateLabel: string | null;
}

export interface ReservesDto {
  totalCents: number;
  items: ReserveItemDto[];
  updatedAt: string | null;
}

export interface CardDto {
  id: string;
  name: string;
  last4: string | null;
  brand: string | null;
  level: string | null;
  openBillCents: number;
  creditLimitCents: number | null;
  availableLimitCents: number | null;
  usedLimitCents: number | null;
  minimumPaymentCents: number | null;
  closeDate: string | null;
  dueDate: string | null;
  /** 'banco' = informado pela instituição; 'ajuste' = calculado pelo dia definido nos Ajustes. */
  dueDateSource: 'banco' | 'ajuste' | null;
  /** Total previsto por mês de fatura (inclui parcelas futuras), a partir do mês atual. */
  upcomingBills: { month: string; totalCents: number; count: number }[];
  /** Faturas fechadas informadas pela instituição (quando houver). */
  pastBills: { dueDate: string; totalCents: number; minimumCents: number | null }[];
}

export interface CardTxDto {
  id: number;
  cardId: string;
  occurredAt: string;
  localDate: string;
  time: string;
  amountCents: number;
  description: string;
  category: string | null;
  status: string;
  billMonth: string | null;
  installment: string | null;
}

const RATE_TYPE_PT: Record<string, string> = { CDI: 'CDI', SELIC: 'Selic', IPCA: 'IPCA', IGPM: 'IGP-M', DOLAR: 'dólar', EURO: 'euro' };

function rateLabel(i: InvestmentRow): string | null {
  if (i.rate === null || i.rate === undefined) return null;
  const r = Number.isInteger(i.rate) ? String(i.rate) : i.rate.toFixed(2).replace('.', ',');
  if (i.rate_type) return `${r}% do ${RATE_TYPE_PT[i.rate_type] ?? i.rate_type}`;
  return `${r}% ao ano`;
}

function isNubankReserve(i: InvestmentRow): boolean {
  const text = `${i.name} ${i.issuer ?? ''}`.toUpperCase();
  return text.includes('NU FINANCEIRA') || text.includes('NU PAGAMENTOS');
}

/**
 * Caixinhas/investimentos com saldo. O Open Finance não compartilha o nome que o usuário
 * deu a cada caixinha do Nubank (todas vêm como "CDB - NU FINANCEIRA..."), então elas são
 * numeradas como "Caixinha 1", "Caixinha 2"... (maior saldo primeiro).
 */
export function buildReserves(db: DB): ReservesDto {
  const rows = listActiveInvestments(db);
  let n = 0;
  const items = rows.map((i) => ({
    id: i.id,
    name: isNubankReserve(i) ? `Caixinha ${++n}` : i.name,
    balanceCents: i.balance_cents,
    rateLabel: rateLabel(i),
  }));
  return {
    totalCents: rows.reduce((s, i) => s + i.balance_cents, 0),
    items,
    updatedAt: rows.reduce<string | null>((m, i) => (m === null || i.updated_at > m ? i.updated_at : m), null),
  };
}

function cardName(name: string, brand: string | null): string {
  const pretty = name.length <= 3 ? name.toUpperCase() : name.charAt(0).toUpperCase() + name.slice(1);
  if (!brand) return `Cartão ${pretty}`;
  const b = brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase();
  return pretty.toLowerCase().includes(b.toLowerCase()) ? `Cartão ${pretty}` : `${b} ${pretty}`;
}

export function buildCards(db: DB, settings: Settings, now: Date): CardDto[] {
  const today = todayLocal(now);
  return listCreditCards(db).map((c) => {
    let dueDate = c.due_date;
    let dueDateSource: CardDto['dueDateSource'] = dueDate ? 'banco' : null;
    if (!dueDate && settings.cardDueDay) {
      dueDate = nextMonthlyDate(today, settings.cardDueDay);
      dueDateSource = 'ajuste';
    }
    const used =
      c.credit_limit_cents !== null && c.available_limit_cents !== null
        ? Math.max(0, c.credit_limit_cents - c.available_limit_cents)
        : null;
    return {
      id: c.id,
      name: cardName(c.name, c.brand),
      last4: c.number,
      brand: c.brand,
      level: c.level,
      openBillCents: c.open_bill_cents,
      creditLimitCents: c.credit_limit_cents,
      availableLimitCents: c.available_limit_cents,
      usedLimitCents: used,
      minimumPaymentCents: c.minimum_payment_cents,
      closeDate: c.close_date,
      dueDate,
      dueDateSource,
      upcomingBills: billTotalsByMonth(db, c.id, monthOf(today), 12).filter((b) => b.totalCents !== 0),
      pastBills: listBills(db, c.id, 6).map((b) => ({ dueDate: b.due_date, totalCents: b.total_cents, minimumCents: b.minimum_cents })),
    };
  });
}

export function toCardTxDto(t: CardTxRow): CardTxDto {
  return {
    id: t.id,
    cardId: t.card_id,
    occurredAt: t.occurred_at,
    localDate: t.local_date,
    time: localTimeOf(t.occurred_at),
    amountCents: t.amount_cents,
    description: t.description,
    category: t.category,
    status: t.status,
    billMonth: t.bill_month,
    installment: t.installment_number && t.total_installments ? `${t.installment_number}/${t.total_installments}` : null,
  };
}

export function buildWallet(db: DB, settings: Settings, now: Date) {
  return {
    reserves: buildReserves(db),
    cards: buildCards(db, settings, now),
    cardTransactions: recentCardTransactions(db, 40).map(toCardTxDto),
  };
}
