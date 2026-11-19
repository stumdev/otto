import type { DB } from '../../db/index.js';
import { upsertCardTransaction, upsertCreditCard, upsertInvestment, type CardTxInput } from '../../db/wallet.js';
import { addDays, localDateOf, localToUtcIso, monthOf, nextMonthlyDate } from '../../lib/time.js';

/* Caixinhas, cartão e compras fictícias para o modo mock. Determinístico por dia. */

export const MOCK_CARD_ID = 'mock-card';
const LIMIT_CENTS = 800_000;
const CLOSE_DAY = 3; // compras a partir do dia 3 vão para a fatura do mês seguinte
const DUE_DAY = 10;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const MERCHANTS: { name: string; category: string; min: number; max: number }[] = [
  { name: 'Restaurante Sabor Caseiro', category: 'Alimentação', min: 3_500, max: 18_000 },
  { name: 'Loja Online Express', category: 'Compras', min: 5_000, max: 35_000 },
  { name: 'Posto Rota 10', category: 'Transporte', min: 8_000, max: 25_000 },
  { name: 'Farmácia Saúde Já', category: 'Saúde', min: 2_000, max: 12_000 },
  { name: 'Supermercado Bom Preço', category: 'Mercado', min: 6_000, max: 40_000 },
  { name: 'Cinema Centro', category: 'Lazer', min: 4_000, max: 9_000 },
];

function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Mês da fatura em que entra uma compra feita em `date`. */
export function mockBillMonth(date: string): string {
  const day = Number(date.slice(8, 10));
  return day < CLOSE_DAY ? monthOf(date) : addMonths(monthOf(date), 1);
}

/** Compras dos últimos `days` dias (até `now`), incluindo uma compra parcelada em 3x. */
export function generateMockCardTransactions(now: Date, days = 45): CardTxInput[] {
  const today = localDateOf(now);
  const nowIso = now.toISOString();
  const out: CardTxInput[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const rnd = mulberry32(hash(`otto-card:${date}`));
    if (rnd() < 0.45) {
      const m = MERCHANTS[Math.floor(rnd() * MERCHANTS.length)]!;
      const occurredAt = localToUtcIso(date, 10 + Math.floor(rnd() * 11), Math.floor(rnd() * 60));
      if (occurredAt > nowIso) continue;
      out.push({
        externalId: `mock-card-${date}`,
        cardId: MOCK_CARD_ID,
        occurredAt,
        localDate: date,
        amountCents: Math.round((m.min + rnd() * (m.max - m.min)) / 10) * 10,
        description: m.name,
        category: m.category,
        status: 'POSTED',
        billMonth: mockBillMonth(date),
        installmentNumber: null,
        totalInstallments: null,
      });
    }
  }
  // compra parcelada (3x de R$ 300,00) feita há 20 dias
  const pDate = addDays(today, -20);
  const first = mockBillMonth(pDate);
  for (let n = 1; n <= 3; n++) {
    out.push({
      externalId: `mock-card-parcela-${pDate}-${n}`,
      cardId: MOCK_CARD_ID,
      occurredAt: localToUtcIso(pDate, 15, 30),
      localDate: pDate,
      amountCents: 30_000,
      description: 'Loja de Eletrônicos',
      category: 'Compras',
      status: 'POSTED',
      billMonth: addMonths(first, n - 1),
      installmentNumber: n,
      totalInstallments: 3,
    });
  }
  return out;
}

/** Atualiza caixinhas, cartão e compras fictícias (idempotente). */
export function refreshMockWallet(db: DB, now: Date): void {
  const nowIso = now.toISOString();
  const today = localDateOf(now);
  const txs = generateMockCardTransactions(now);
  const openMonth = mockBillMonth(today);
  const openBill = txs.filter((t) => t.billMonth === openMonth).reduce((s, t) => s + t.amountCents, 0);
  const committed = txs.filter((t) => t.billMonth !== null && t.billMonth >= openMonth).reduce((s, t) => s + t.amountCents, 0);

  db.transaction(() => {
    upsertInvestment(db, { id: 'mock-inv-1', itemId: null, name: 'Reserva de emergência', type: 'FIXED_INCOME', subtype: 'CDB', status: 'ACTIVE', balanceCents: 1_250_000, rate: 100, rateType: 'CDI', issuer: null, dueDate: null, referenceDate: today }, nowIso);
    upsertInvestment(db, { id: 'mock-inv-2', itemId: null, name: 'Viagem', type: 'FIXED_INCOME', subtype: 'CDB', status: 'ACTIVE', balanceCents: 340_000, rate: 100, rateType: 'CDI', issuer: null, dueDate: null, referenceDate: today }, nowIso);
    upsertCreditCard(
      db,
      {
        id: MOCK_CARD_ID,
        itemId: null,
        name: 'gold',
        number: '4321',
        brand: 'MASTERCARD',
        level: 'GOLD',
        openBillCents: openBill,
        creditLimitCents: LIMIT_CENTS,
        availableLimitCents: Math.max(0, LIMIT_CENTS - committed),
        minimumPaymentCents: null,
        closeDate: null,
        dueDate: nextMonthlyDate(today, DUE_DAY),
      },
      nowIso,
    );
    for (const t of txs) upsertCardTransaction(db, t, nowIso);
  })();
}
