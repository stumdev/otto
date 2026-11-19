import { describe, expect, it } from 'vitest';
import { sumRange, upsertTransaction } from '../src/db/repo.js';
import { localDateOf, resolvePeriod, shortDateLabel } from '../src/lib/time.js';
import { mapPluggyTransaction } from '../src/services/pluggy/mapping.js';
import { buildSummary } from '../src/services/summary.js';
import { memoryDb, seedAccount, tx } from './helpers.js';

describe('fuso America/Sao_Paulo', () => {
  it('converte o instante para a data local, não a de UTC', () => {
    // 02:30 UTC do dia 19 ainda é 23:30 do dia 18 em São Paulo (UTC-3)
    expect(localDateOf('2026-11-19T02:30:00.000Z')).toBe('2026-11-18');
    expect(localDateOf('2026-11-19T03:00:00.000Z')).toBe('2026-11-19');
  });

  it('resolve "hoje", "semana" e "mês" no fuso local, mesmo com o servidor em UTC', () => {
    // quinta, 19/11/2026 às 01:00 em UTC = quarta 18/11 às 22:00 em São Paulo
    const now = new Date('2026-11-19T01:00:00.000Z');
    expect(resolvePeriod('today', now)).toEqual({ from: '2026-11-18', to: '2026-11-18' });
    expect(resolvePeriod('yesterday', now)).toEqual({ from: '2026-11-17', to: '2026-11-17' });
    expect(resolvePeriod('this_week', now)).toEqual({ from: '2026-11-16', to: '2026-11-18' }); // segunda 16
    expect(resolvePeriod('last_week', now)).toEqual({ from: '2026-11-09', to: '2026-11-15' });
    expect(resolvePeriod('this_month', now)).toEqual({ from: '2026-11-01', to: '2026-11-18' });
    expect(resolvePeriod('last_month', now)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(resolvePeriod('last_7_days', now)).toEqual({ from: '2026-11-12', to: '2026-11-18' });
    expect(resolvePeriod('2026-11-20..2026-11-01', now)).toEqual({ from: '2026-11-01', to: '2026-11-20' });
    expect(() => resolvePeriod('semana que vem', now)).toThrow();
  });

  it('formata o rótulo de data como no cabeçalho do app', () => {
    expect(shortDateLabel('2026-11-19')).toBe('Qui, 19 nov');
  });
});

describe('agregação por período', () => {
  it('soma entradas e saídas por dia local, ignorando transações removidas', () => {
    const db = memoryDb();
    seedAccount(db, 0);
    const now = new Date().toISOString();
    upsertTransaction(db, tx('2026-11-19T02:30:00.000Z', 10000), now); // 18/11 23:30 local
    upsertTransaction(db, tx('2026-11-19T03:30:00.000Z', 20000), now); // 19/11 00:30 local
    upsertTransaction(db, tx('2026-11-19T15:00:00.000Z', -5000), now); // 19/11 12:00 local
    upsertTransaction(db, tx('2026-11-20T02:59:00.000Z', -700), now); // 19/11 23:59 local
    const removed = tx('2026-11-19T16:00:00.000Z', -99999);
    upsertTransaction(db, removed, now);
    db.prepare('UPDATE transactions SET deleted = 1 WHERE external_id = ?').run(removed.externalId);

    expect(sumRange(db, { from: '2026-11-18', to: '2026-11-18' })).toEqual({
      inCents: 10000,
      outCents: 0,
      netCents: 10000,
      countIn: 1,
      countOut: 0,
    });
    expect(sumRange(db, { from: '2026-11-19', to: '2026-11-19' })).toEqual({
      inCents: 20000,
      outCents: 5700,
      netCents: 14300,
      countIn: 1,
      countOut: 2,
    });
  });

  it('monta a série de 7 dias com saldo de fechamento coerente', () => {
    const db = memoryDb();
    const nowIso = new Date().toISOString();
    seedAccount(db, 75000); // saldo atual = soma das transações abaixo
    upsertTransaction(db, tx('2026-11-17T15:00:00.000Z', 100000), nowIso);
    upsertTransaction(db, tx('2026-11-18T15:00:00.000Z', -30000), nowIso);
    upsertTransaction(db, tx('2026-11-19T15:00:00.000Z', 5000), nowIso);
    const s = buildSummary(db, new Date('2026-11-19T18:00:00.000Z'));
    expect(s.balanceCents).toBe(75000);
    expect(s.today).toMatchObject({ date: '2026-11-19', label: 'Qui, 19 nov', inCents: 5000, outCents: 0 });
    expect(s.series).toHaveLength(7);
    expect(s.series.map((p) => p.date)).toEqual([
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
    ]);
    expect(s.series.map((p) => p.closingBalanceCents)).toEqual([0, 0, 0, 0, 100000, 70000, 75000]);
    expect(s.week.netCents).toBe(75000);
    expect(s.recent).toHaveLength(3);
  });
});

describe('mapeamento Pluggy', () => {
  const base = {
    id: 'abc',
    description: 'PIX TRANSF',
    amount: -212.45,
    type: 'DEBIT' as const,
    status: 'POSTED',
    category: 'Groceries',
  };

  it('mantém a data quando o banco não informa horário (00:00Z não vira o dia anterior)', () => {
    const t = mapPluggyTransaction({ ...base, date: '2026-11-19T00:00:00.000Z' }, 'acc');
    expect(t.localDate).toBe('2026-11-19');
    expect(t.hasTime).toBe(false);
  });

  it('usa o fuso local quando há horário', () => {
    const t = mapPluggyTransaction({ ...base, date: '2026-11-19T02:10:00.000Z' }, 'acc');
    expect(t.localDate).toBe('2026-11-18');
    expect(t.hasTime).toBe(true);
  });

  it('define o sinal pelo tipo, em centavos, e traduz a categoria', () => {
    const debit = mapPluggyTransaction({ ...base, date: '2026-11-19T12:00:00.000Z' }, 'acc');
    expect(debit.amountCents).toBe(-21245);
    expect(debit.category).toBe('Mercado');
    const credit = mapPluggyTransaction(
      {
        ...base,
        type: 'CREDIT',
        amount: 1800,
        date: '2026-11-19T12:00:00.000Z',
        paymentData: { payer: { name: 'JOAO DA SILVA' }, receiver: null, paymentMethod: 'PIX' },
      },
      'acc',
    );
    expect(credit.amountCents).toBe(180000);
    expect(credit.counterpart).toBe('Joao da Silva');
    expect(credit.description).toBe('Pix recebido');
    expect(credit.externalId).toBe('pluggy:abc');
  });
});
