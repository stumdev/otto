import { randomUUID } from 'node:crypto';
import type { TxInput } from '../../db/repo.js';
import { addDays, localDateOf, localToUtcIso } from '../../lib/time.js';

export const MOCK_ACCOUNT_ID = 'mock-checking';
export const MOCK_ACCOUNT_NAME = 'Conta corrente (simulada)';
export const MOCK_DAYS = 60;

/** PRNG determinístico (mulberry32): o mesmo dia gera sempre as mesmas transações. */
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

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const PEOPLE = [
  'João Silva',
  'Mariana Costa',
  'Rafael Souza',
  'Ana Beatriz Lima',
  'Pedro Henrique Alves',
  'Camila Rocha',
  'Lucas Ferreira',
  'Juliana Martins',
  'Bruno Carvalho',
  'Fernanda Ribeiro',
];
const CLIENTS = ['Estúdio Norte Ltda', 'Agência Prisma', 'Loja Vila Verde', 'Construtora Horizonte', 'Clínica Bem Estar'];
const GROCERIES = ['Mercado Central', 'Supermercado Bom Preço', 'Hortifruti da Praça', 'Atacadão do Bairro'];
const FOOD = ['Padaria Pão Dourado', 'Restaurante Sabor Caseiro', 'Café da Esquina', 'Pizzaria Forno a Lenha'];
const TRANSPORT = ['Posto Rota 10', 'App de Transporte', 'Estacionamento Centro'];
const PHARMACY = ['Farmácia Saúde Já', 'Drogaria Popular'];

interface Draft {
  hour: number;
  minute: number;
  amountCents: number;
  description: string;
  counterpart: string | null;
  method: string;
  category: string;
}

function pick<T>(rnd: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length)]!;
}

function between(rnd: () => number, minCents: number, maxCents: number): number {
  // arredonda para múltiplos de 10 centavos para parecer real
  return Math.round((minCents + rnd() * (maxCents - minCents)) / 10) * 10;
}

/** Gera as transações de um dia (data local). `first` marca o primeiro dia do histórico. */
export function generateDay(date: string, opts: { first: boolean }): TxInput[] {
  const rnd = mulberry32(hashString(`otto-mock:${date}`));
  const day = Number(date.slice(8, 10));
  const drafts: Draft[] = [];

  if (opts.first) {
    drafts.push({
      hour: 8,
      minute: 0,
      amountCents: 3_000_000,
      description: 'Transferência recebida',
      counterpart: 'Conta Reserva',
      method: 'TRANSFERENCIA_MESMA_INSTITUICAO',
      category: 'Transferências',
    });
  }

  // salário / pró-labore no dia 5
  if (day === 5) {
    drafts.push({
      hour: 7,
      minute: 12,
      amountCents: 1_250_000,
      description: 'Pix recebido',
      counterpart: 'Empresa Alfa Ltda',
      method: 'PIX',
      category: 'Salário',
    });
  }
  // contas fixas
  if (day === 10) {
    drafts.push({
      hour: 9,
      minute: 30,
      amountCents: -320_000,
      description: 'Pix enviado',
      counterpart: 'Imobiliária Lar Seguro',
      method: 'PIX',
      category: 'Moradia',
    });
  }
  if (day === 12) {
    drafts.push({
      hour: 10,
      minute: 5,
      amountCents: -between(rnd, 18_000, 32_000),
      description: 'Pagamento de boleto',
      counterpart: 'Companhia de Energia',
      method: 'BOLETO',
      category: 'Contas',
    });
    drafts.push({
      hour: 10,
      minute: 7,
      amountCents: -11_990,
      description: 'Pagamento de boleto',
      counterpart: 'Internet Fibra Max',
      method: 'BOLETO',
      category: 'Contas',
    });
  }
  if (day === 15) {
    drafts.push({
      hour: 6,
      minute: 0,
      amountCents: -5_590,
      description: 'Assinatura mensal',
      counterpart: 'Serviço de Streaming',
      method: 'CARTAO',
      category: 'Assinaturas',
    });
    drafts.push({
      hour: 6,
      minute: 1,
      amountCents: -2_190,
      description: 'Assinatura mensal',
      counterpart: 'App de Música',
      method: 'CARTAO',
      category: 'Assinaturas',
    });
  }
  if (day === 20) {
    drafts.push({
      hour: 8,
      minute: 45,
      amountCents: -between(rnd, 150_000, 260_000),
      description: 'Pagamento de fatura',
      counterpart: 'Cartão de crédito',
      method: 'BOLETO',
      category: 'Cartão de crédito',
    });
  }

  // recebimentos de clientes (movimenta bastante)
  const clientPayments = rnd() < 0.3 ? 1 : 0;
  for (let i = 0; i < clientPayments; i++) {
    drafts.push({
      hour: 9 + Math.floor(rnd() * 10),
      minute: Math.floor(rnd() * 60),
      amountCents: between(rnd, 30_000, 260_000),
      description: 'Pix recebido',
      counterpart: pick(rnd, CLIENTS),
      method: 'PIX',
      category: 'Recebimentos',
    });
  }
  // Pix recebido de pessoas
  if (rnd() < 0.35) {
    drafts.push({
      hour: Math.floor(rnd() * 24),
      minute: Math.floor(rnd() * 60),
      amountCents: between(rnd, 2_000, 60_000),
      description: 'Pix recebido',
      counterpart: pick(rnd, PEOPLE),
      method: 'PIX',
      category: 'Transferências',
    });
  }
  // Pix enviado a pessoas
  if (rnd() < 0.45) {
    drafts.push({
      hour: 8 + Math.floor(rnd() * 14),
      minute: Math.floor(rnd() * 60),
      amountCents: -between(rnd, 3_000, 90_000),
      description: 'Pix enviado',
      counterpart: pick(rnd, PEOPLE),
      method: 'PIX',
      category: 'Transferências',
    });
  }
  // mercado
  if (rnd() < 0.5) {
    drafts.push({
      hour: 10 + Math.floor(rnd() * 10),
      minute: Math.floor(rnd() * 60),
      amountCents: -between(rnd, 3_500, 48_000),
      description: 'Pix enviado',
      counterpart: pick(rnd, GROCERIES),
      method: 'PIX',
      category: 'Mercado',
    });
  }
  // comida
  if (rnd() < 0.6) {
    drafts.push({
      hour: 11 + Math.floor(rnd() * 11),
      minute: Math.floor(rnd() * 60),
      amountCents: -between(rnd, 1_200, 16_000),
      description: 'Compra no débito',
      counterpart: pick(rnd, FOOD),
      method: 'CARTAO',
      category: 'Alimentação',
    });
  }
  // transporte
  if (rnd() < 0.4) {
    drafts.push({
      hour: 7 + Math.floor(rnd() * 14),
      minute: Math.floor(rnd() * 60),
      amountCents: -between(rnd, 1_500, 25_000),
      description: 'Compra no débito',
      counterpart: pick(rnd, TRANSPORT),
      method: 'CARTAO',
      category: 'Transporte',
    });
  }
  // farmácia
  if (rnd() < 0.12) {
    drafts.push({
      hour: 9 + Math.floor(rnd() * 12),
      minute: Math.floor(rnd() * 60),
      amountCents: -between(rnd, 1_800, 22_000),
      description: 'Compra no débito',
      counterpart: pick(rnd, PHARMACY),
      method: 'CARTAO',
      category: 'Saúde',
    });
  }

  drafts.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
  return drafts.map((d, i) => {
    const occurredAt = localToUtcIso(date, d.hour, d.minute, i % 60);
    return {
      externalId: `mock-${date}-${String(i).padStart(2, '0')}`,
      accountId: MOCK_ACCOUNT_ID,
      occurredAt,
      localDate: date,
      hasTime: true,
      amountCents: d.amountCents,
      description: d.description,
      counterpart: d.counterpart,
      method: d.method,
      category: d.category,
      status: 'POSTED',
    };
  });
}

/**
 * Transações mock com instante em (afterIso, now]. Sem afterIso, gera os últimos MOCK_DAYS dias.
 * Como a geração é determinística, chamar de novo nunca duplica (os externalIds se repetem).
 */
export function generateMockRange(now: Date, afterIso?: string): TxInput[] {
  const today = localDateOf(now);
  const firstDay = addDays(today, -(MOCK_DAYS - 1));
  const startDay = afterIso ? maxDate(localDateOf(afterIso), firstDay) : firstDay;
  const nowIso = now.toISOString();
  const out: TxInput[] = [];
  for (let d = startDay; d <= today; d = addDays(d, 1)) {
    for (const tx of generateDay(d, { first: d === firstDay })) {
      if (tx.occurredAt > nowIso) continue;
      if (afterIso && tx.occurredAt <= afterIso) continue;
      out.push(tx);
    }
  }
  return out;
}

function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}

/** Transação avulsa para o botão "Simular Pix". */
export function simulatedPix(now: Date, direction: 'in' | 'out', amountCents?: number): TxInput {
  const rnd = mulberry32(hashString(randomUUID()));
  const cents =
    amountCents ?? (direction === 'in' ? between(rnd, 5_000, 300_000) : between(rnd, 2_000, 60_000));
  const counterpart = direction === 'in' ? pick(rnd, [...PEOPLE, ...CLIENTS]) : pick(rnd, [...PEOPLE, ...GROCERIES]);
  return {
    externalId: `sim-${randomUUID()}`,
    accountId: MOCK_ACCOUNT_ID,
    occurredAt: now.toISOString(),
    localDate: localDateOf(now),
    hasTime: true,
    amountCents: direction === 'in' ? cents : -cents,
    description: direction === 'in' ? 'Pix recebido' : 'Pix enviado',
    counterpart,
    method: 'PIX',
    category: direction === 'in' ? 'Transferências' : GROCERIES.includes(counterpart) ? 'Mercado' : 'Transferências',
    status: 'POSTED',
  };
}
