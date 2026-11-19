import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { runTool } from '../src/ai/tools.js';
import { answerWithRules } from '../src/ai/rules.js';
import { sumAll, sumRange, topTransactions, totalBalance, upsertDevice, upsertTransaction } from '../src/db/repo.js';
import { reserveFlows, upsertCardTransaction, upsertCreditCard, upsertInvestment, type CardTxInput } from '../src/db/wallet.js';
import { nextMonthlyDate } from '../src/lib/time.js';
import { ingestTransactions } from '../src/services/ingest.js';
import { Notifier } from '../src/services/notifier.js';
import type { PluggyClient } from '../src/services/pluggy/client.js';
import { mapCardTransaction, mapCreditCard, mapInvestment, mapPluggyTransaction } from '../src/services/pluggy/mapping.js';
import { PluggySync } from '../src/services/pluggy/sync.js';
import { defaultSettings, type Settings } from '../src/services/settings.js';
import { buildCards, buildReserves } from '../src/services/wallet.js';
import { FakePush, makeConfig, memoryDb, seedAccount, silentLog, TEST_TOKEN, tx } from './helpers.js';

const NOW = new Date('2026-11-19T15:00:00.000Z'); // 12:00 em São Paulo
const settings: Settings = { ...defaultSettings(makeConfig()), cardDueDay: null };
const nowIso = NOW.toISOString();

function seedWallet(db: ReturnType<typeof memoryDb>) {
  upsertInvestment(db, { id: 'i1', itemId: 'item', name: 'CDB - NU FINANCEIRA S.A.', type: 'FIXED_INCOME', subtype: 'CDB', status: 'ACTIVE', balanceCents: 150_000, rate: 100, rateType: 'CDI', issuer: 'NU FINANCEIRA S.A.', dueDate: null, referenceDate: null }, nowIso);
  upsertInvestment(db, { id: 'i2', itemId: 'item', name: 'CDB - NU FINANCEIRA S.A.', type: 'FIXED_INCOME', subtype: 'CDB', status: 'ACTIVE', balanceCents: 900_000, rate: 100, rateType: 'CDI', issuer: 'NU FINANCEIRA S.A.', dueDate: null, referenceDate: null }, nowIso);
  upsertInvestment(db, { id: 'i3', itemId: 'item', name: 'CDB - NU FINANCEIRA S.A.', type: 'FIXED_INCOME', subtype: 'CDB', status: 'TOTAL_WITHDRAWAL', balanceCents: 0, rate: 100, rateType: 'CDI', issuer: 'NU FINANCEIRA S.A.', dueDate: null, referenceDate: null }, nowIso);
  upsertCreditCard(db, { id: 'card1', itemId: 'item', name: 'gold', number: '6308', brand: 'MASTERCARD', level: 'GOLD', openBillCents: 45_000, creditLimitCents: 500_000, availableLimitCents: 380_000, minimumPaymentCents: null, closeDate: null, dueDate: null }, nowIso);
  const card = (o: Partial<CardTxInput> & { externalId: string }): CardTxInput => ({
    cardId: 'card1', occurredAt: '2026-11-10T15:00:00.000Z', localDate: '2026-11-10', amountCents: 10_000, description: 'Loja', category: 'Compras', status: 'POSTED', billMonth: '2026-12', installmentNumber: null, totalInstallments: null, ...o,
  });
  upsertCardTransaction(db, card({ externalId: 'c1', amountCents: 25_000, description: 'Farmácia Saúde Já', category: 'Saúde' }), nowIso);
  upsertCardTransaction(db, card({ externalId: 'c2', amountCents: 20_000, description: 'Restaurante Bom', category: 'Alimentação', localDate: '2026-11-12', occurredAt: '2026-11-12T15:00:00.000Z' }), nowIso);
  upsertCardTransaction(db, card({ externalId: 'c3', amountCents: 30_000, description: 'Loja de Eletrônicos', billMonth: '2027-01', installmentNumber: 2, totalInstallments: 3 }), nowIso);
  upsertCardTransaction(db, card({ externalId: 'c4', amountCents: -5_000, description: 'Estorno', category: null }), nowIso);
}

describe('caixinhas fora dos totais', () => {
  it('entram no saldo mas não em entrou/saiu, maiores saídas e busca', () => {
    const db = memoryDb();
    seedAccount(db, 0);
    upsertTransaction(db, tx('2026-11-19T13:00:00.000Z', -80_000, { description: 'Guardado na caixinha', counterpart: null, category: 'Caixinha', internal: true }), nowIso);
    upsertTransaction(db, tx('2026-11-19T14:00:00.000Z', -20_000, { counterpart: 'Mercado Central', category: 'Mercado' }), nowIso);
    upsertTransaction(db, tx('2026-11-19T14:30:00.000Z', 30_000, { description: 'Resgate da caixinha', counterpart: null, category: 'Caixinha', internal: true }), nowIso);
    const range = { from: '2026-11-19', to: '2026-11-19' };
    expect(sumRange(db, range)).toMatchObject({ inCents: 0, outCents: 20_000, countOut: 1 });
    expect(sumAll(db)).toBe(-70_000); // o saldo continua considerando tudo
    expect(topTransactions(db, range, 'out', 5).map((r) => r.amount_cents)).toEqual([-20_000]);
    expect(reserveFlows(db, range)).toEqual({ savedCents: 80_000, withdrawnCents: 30_000, count: 2 });
  });

  it('notificação de caixinha não parece gasto nem dispara "saída grande"', async () => {
    const db = memoryDb();
    const push = new FakePush();
    const notifier = new Notifier(db, push, silentLog, () => NOW);
    seedAccount(db, 100_000);
    upsertDevice(db, 'fid-device-1234567890', 'android', nowIso);
    await ingestTransactions(
      db,
      notifier,
      [tx('2026-11-19T14:59:00.000Z', -250_000, { description: 'Guardado na caixinha', counterpart: null, category: 'Caixinha', internal: true })],
      { notify: true, maxAgeHours: 72, now: NOW, settings },
    );
    expect(push.sent[0]!.msg).toMatchObject({ kind: 'caixinha', title: 'Guardou R$ 2.500,00 na caixinha', body: 'Saldo da conta R$ 1.000,00' });
  });
});

describe('mapeamento Pluggy (cartão e caixinhas)', () => {
  const base = { id: 'x', description: 'Aplicação RDB', amount: -800, type: 'DEBIT' as const, date: '2026-11-18T12:00:00.000Z', status: 'POSTED' };

  it('marca Aplicação/Resgate RDB como interno', () => {
    expect(mapPluggyTransaction({ ...base, operationType: 'OTHER' }, 'acc')).toMatchObject({ internal: true, category: 'Caixinha', amountCents: -80_000 });
    expect(mapPluggyTransaction({ ...base, description: 'Pix enviado', operationType: 'PIX' }, 'acc').internal).toBe(false);
  });

  it('compras no cartão: cobrança positiva, mês da fatura e parcelas', () => {
    const t = mapCardTransaction(
      { ...base, description: 'Assinatura de streaming', amount: 110.5, type: 'DEBIT', category: 'Digital services', creditCardMetadata: { billForecastDate: '2026-12', installmentNumber: 1, totalInstallments: 1 } },
      'card1',
    );
    expect(t).toMatchObject({ amountCents: 11_050, billMonth: '2026-12', category: 'Assinaturas', installmentNumber: 1, externalId: 'pluggy:x' });
    expect(mapCardTransaction({ ...base, type: 'CREDIT', amount: 20 }, 'card1').amountCents).toBe(-2_000);
  });

  it('cartão e investimento em centavos', () => {
    const c = mapCreditCard(
      { id: 'card1', type: 'CREDIT', subtype: 'CREDIT_CARD', name: 'gold', number: '6308', balance: 449.9, currencyCode: 'BRL', creditData: { brand: 'MASTERCARD', level: 'GOLD', creditLimit: 5000, availableCreditLimit: 3800.1, balanceDueDate: null, minimumPayment: null } },
      'item',
    );
    expect(c).toMatchObject({ openBillCents: 44_990, creditLimitCents: 500_000, availableLimitCents: 380_010, number: '6308', dueDate: null, minimumPaymentCents: null });
    const i = mapInvestment({ id: 'i1', name: 'CDB - NU FINANCEIRA', type: 'FIXED_INCOME', subtype: 'CDB', status: 'ACTIVE', balance: 1500.25, rate: 100, rateType: 'CDI', date: '2026-11-19T10:00:00.000Z' }, 'item');
    expect(i).toMatchObject({ balanceCents: 150_025, rate: 100, rateType: 'CDI', referenceDate: '2026-11-19' });
  });
});

describe('vencimento do cartão', () => {
  it('calcula o próximo vencimento pelo dia definido', () => {
    expect(nextMonthlyDate('2026-11-19', 10)).toBe('2026-12-10');
    expect(nextMonthlyDate('2026-11-05', 10)).toBe('2026-11-10');
    expect(nextMonthlyDate('2026-11-10', 10)).toBe('2026-11-10');
    expect(nextMonthlyDate('2026-02-01', 31)).toBe('2026-02-28');
    expect(nextMonthlyDate('2026-12-20', 5)).toBe('2027-01-05');
  });

  it('usa a data do banco; sem ela, o dia dos Ajustes; sem nenhum, fica sem vencimento', () => {
    const db = memoryDb();
    seedWallet(db);
    expect(buildCards(db, settings, NOW)[0]).toMatchObject({ dueDate: null, dueDateSource: null, usedLimitCents: 120_000, name: 'Mastercard Gold' });
    expect(buildCards(db, { ...settings, cardDueDay: 10 }, NOW)[0]).toMatchObject({ dueDate: '2026-12-10', dueDateSource: 'ajuste' });
    upsertCreditCard(db, { id: 'card1', itemId: 'item', name: 'gold', number: '6308', brand: 'MASTERCARD', level: 'GOLD', openBillCents: 45_000, creditLimitCents: 500_000, availableLimitCents: 380_000, minimumPaymentCents: 9_000, closeDate: null, dueDate: '2026-12-08' }, nowIso);
    expect(buildCards(db, { ...settings, cardDueDay: 10 }, NOW)[0]).toMatchObject({ dueDate: '2026-12-08', dueDateSource: 'banco', minimumPaymentCents: 9_000 });
  });

  it('próximas faturas somam compras por mês (com parcelas futuras e estornos)', () => {
    const db = memoryDb();
    seedWallet(db);
    expect(buildCards(db, settings, NOW)[0]!.upcomingBills).toEqual([
      { month: '2026-12', totalCents: 40_000, count: 3 },
      { month: '2027-01', totalCents: 30_000, count: 1 },
    ]);
  });
});

describe('caixinhas', () => {
  it('lista só as que têm saldo, numeradas pelo maior saldo, com total', () => {
    const db = memoryDb();
    seedWallet(db);
    const r = buildReserves(db);
    expect(r.totalCents).toBe(1_050_000);
    expect(r.items.map((i) => [i.name, i.balanceCents, i.rateLabel])).toEqual([
      ['Caixinha 1', 900_000, '100% do CDI'],
      ['Caixinha 2', 150_000, '100% do CDI'],
    ]);
  });
});

describe('ferramentas da IA (caixinhas, cartão e análises)', () => {
  function setup() {
    const db = memoryDb();
    seedAccount(db, 500_000);
    seedWallet(db);
    upsertTransaction(db, tx('2026-11-03T13:00:00.000Z', -60_000, { description: 'Guardado na caixinha', counterpart: null, category: 'Caixinha', internal: true }), nowIso);
    upsertTransaction(db, tx('2026-11-04T13:00:00.000Z', -15_000, { counterpart: 'Mercado Central', category: 'Mercado' }), nowIso);
    upsertTransaction(db, tx('2026-11-05T13:00:00.000Z', -5_000, { counterpart: 'Farmácia Popular', category: 'Saúde' }), nowIso);
    upsertTransaction(db, tx('2026-11-05T14:00:00.000Z', 100_000, { counterpart: 'Cliente', category: 'Recebimentos' }), nowIso);
    return db;
  }

  it('get_balance traz conta e caixinhas', () => {
    const r = runTool(setup(), 'get_balance', '{}', NOW).result as Record<string, string>;
    expect(r).toMatchObject({ saldo_conta: 'R$ 5.000,00', total_caixinhas: 'R$ 10.500,00', conta_mais_caixinhas: 'R$ 15.500,00' });
  });

  it('get_reserves com período informa guardado e resgatado', () => {
    const out = runTool(setup(), 'get_reserves', '{"period":"this_month"}', NOW);
    expect(out.result).toMatchObject({ total_caixinhas: 'R$ 10.500,00', movimentacoes: { guardado: 'R$ 600,00', resgatado: 'R$ 0,00' } });
    expect(out.card).toMatchObject({ type: 'reserves', totalCents: 1_050_000 });
  });

  it('get_period_summary separa caixinha de entrada/saída', () => {
    const r = runTool(setup(), 'get_period_summary', '{"from":"2026-11-01","to":"2026-11-19"}', NOW).result;
    expect(r).toMatchObject({ entrou: 'R$ 1.000,00', saiu: 'R$ 200,00', guardado_na_caixinha: 'R$ 600,00' });
  });

  it('get_credit_card avisa quando o banco não informa vencimento', () => {
    const db = setup();
    const r = runTool(db, 'get_credit_card', '{}', NOW).result as { cartoes: Record<string, unknown>[] };
    expect(r.cartoes[0]).toMatchObject({ fatura_atual: 'R$ 450,00', limite_disponivel: 'R$ 3.800,00', limite_usado: 'R$ 1.200,00', pagamento_minimo: 'não informado pelo banco' });
    expect(String(r.cartoes[0]!.vencimento)).toMatch(/Ajustes/);
    const withDay = runTool(db, 'get_credit_card', '{}', NOW, { ...settings, cardDueDay: 10 }).result as { cartoes: Record<string, unknown>[] };
    expect(withDay.cartoes[0]).toMatchObject({ vencimento: '10/12/2026', proximas_faturas: [{ mes: 'dez/2026', valor_previsto: 'R$ 400,00' }, { mes: 'jan/2027', valor_previsto: 'R$ 300,00' }] });
  });

  it('get_card_spending filtra por texto e respeita o limite de itens', () => {
    const r = runTool(setup(), 'get_card_spending', '{"period":"this_month","query":"farmácia"}', NOW).result;
    expect(r).toMatchObject({ total_compras: 'R$ 250,00', quantidade: 1 });
    const all = runTool(setup(), 'get_card_spending', '{"period":"this_month","limit":2}', NOW).result as { maiores: unknown[]; quantidade: number };
    expect(all.maiores).toHaveLength(2);
    expect(all.quantidade).toBe(3);
  });

  it('get_category_breakdown junta conta e cartão e ignora caixinha', () => {
    const out = runTool(setup(), 'get_category_breakdown', '{"period":"this_month"}', NOW);
    const r = out.result as { categorias: { categoria: string; valor: string }[] };
    expect(r.categorias.map((c) => [c.categoria, c.valor])).toEqual([
      ['Compras', 'R$ 300,00'],
      ['Saúde', 'R$ 300,00'],
      ['Alimentação', 'R$ 200,00'],
      ['Mercado', 'R$ 150,00'],
    ]);
    expect(r.categorias.some((c) => c.categoria === 'Caixinha')).toBe(false);
    expect(out.card).toMatchObject({ type: 'breakdown' });
  });

  it('get_daily_breakdown limita a 31 dias e fecha o saldo do dia', () => {
    const db = setup();
    const r = runTool(db, 'get_daily_breakdown', '{"period":"2026-11-03..2026-11-05"}', NOW).result as { dias: Record<string, string>[] };
    expect(r.dias).toHaveLength(3);
    expect(r.dias[2]).toMatchObject({ entrou: 'R$ 1.000,00', saiu: 'R$ 50,00', saldo_fim_do_dia: 'R$ 5.000,00' });
    expect(r.dias[1]).toMatchObject({ saiu: 'R$ 150,00', saldo_fim_do_dia: 'R$ 4.050,00' });
    const err = runTool(db, 'get_daily_breakdown', '{"period":"last_90_days"}', NOW).result as { erro: string };
    expect(err.erro).toMatch(/31 dias/);
  });

  it('motor offline responde caixinhas, fatura e categorias', () => {
    const db = setup();
    expect(answerWithRules(db, 'quanto tenho nas caixinhas?', NOW).text).toBe('Você tem **R$ 10.500,00** em 2 caixinhas.');
    expect(answerWithRules(db, 'quanto guardei na caixinha esse mês?', NOW).text).toBe('Neste mês você guardou **R$ 600,00** e resgatou **R$ 0,00** das caixinhas.');
    expect(answerWithRules(db, 'qual o valor da fatura do cartão?', NOW, { ...settings, cardDueDay: 10 }).text).toBe(
      'A fatura atual do cartão está em **R$ 450,00**, vence em 10/12/2026. Limite disponível: **R$ 3.800,00**.',
    );
    expect(answerWithRules(db, 'onde gastei mais esse mês?', NOW).text).toMatch(/^Neste mês o que mais pesou foi \*\*Compras\*\*/);
  });
});

describe('sincronização Pluggy de cartão e caixinhas', () => {
  it('grava cartão, compras, faturas e investimentos sem afetar a conta', async () => {
    const db = memoryDb();
    const notifier = new Notifier(db, new FakePush(), silentLog, () => NOW);
    const fake = {
      listAccounts: async () => [
        { id: 'bank1', type: 'BANK', subtype: 'CHECKING_ACCOUNT', name: 'Conta', balance: 1000, currencyCode: 'BRL' },
        { id: 'card1', type: 'CREDIT', subtype: 'CREDIT_CARD', name: 'gold', number: '6308', balance: 110.5, currencyCode: 'BRL', creditData: { brand: 'MASTERCARD', level: 'GOLD', creditLimit: 5000, availableCreditLimit: 4889.5 } },
      ],
      listTransactions: async (accountId: string) =>
        accountId === 'card1'
          ? [{ id: 'ct1', description: 'Assinatura', amount: 110.5, type: 'DEBIT', date: '2026-11-12T16:36:52.001Z', status: 'PENDING', category: 'Digital services', creditCardMetadata: { billForecastDate: '2026-12' } }]
          : [{ id: 'bt1', description: 'Aplicação RDB', amount: -200, type: 'DEBIT', date: '2026-11-18T12:00:00.000Z', status: 'POSTED', operationType: 'OTHER' }],
      listBills: async () => [{ id: 'b1', dueDate: '2026-11-10T00:00:00.000Z', totalAmount: 320.4, minimumPaymentAmount: 64 }],
      listInvestments: async () => [{ id: 'i1', name: 'CDB - NU FINANCEIRA S.A.', type: 'FIXED_INCOME', subtype: 'CDB', status: 'ACTIVE', balance: 1500, rate: 100, rateType: 'CDI', issuer: 'NU FINANCEIRA S.A.' }],
    } as unknown as PluggyClient;
    const sync = new PluggySync({ db, client: fake, notifier, log: silentLog, itemIds: ['item'], now: () => NOW, settings: () => settings, maxAgeHours: 72 });
    await sync.syncAll();

    expect(totalBalance(db).balanceCents).toBe(100_000);
    expect(sumRange(db, { from: '2026-11-18', to: '2026-11-18' }).outCents).toBe(0); // aplicação RDB é interna
    const cards = buildCards(db, settings, NOW);
    expect(cards[0]).toMatchObject({ openBillCents: 11_050, availableLimitCents: 488_950, pastBills: [{ dueDate: '2026-11-10', totalCents: 32_040, minimumCents: 6_400 }] });
    expect(cards[0]!.upcomingBills).toEqual([{ month: '2026-12', totalCents: 11_050, count: 1 }]);
    expect(buildReserves(db)).toMatchObject({ totalCents: 150_000, items: [{ name: 'Caixinha 1' }] });
  });
});

describe('API', () => {
  it('GET /v1/wallet e resumo trazem caixinhas e cartão; ajuste de vencimento é validado', async () => {
    const { app, services } = await buildApp({ config: makeConfig(), db: memoryDb(), logger: false, disableJobs: true, now: () => NOW });
    await services.syncOnce();
    const auth = { authorization: `Bearer ${TEST_TOKEN}` };
    const w = (await app.inject({ method: 'GET', url: '/v1/wallet', headers: auth })).json();
    expect(w.reserves.items.map((i: { name: string }) => i.name)).toEqual(['Reserva de emergência', 'Viagem']);
    expect(w.reserves.totalCents).toBe(1_590_000);
    expect(w.cards[0]).toMatchObject({ name: 'Mastercard Gold', last4: '4321', creditLimitCents: 800_000, dueDate: '2026-12-10' });
    expect(w.cardTransactions.length).toBeGreaterThan(0);
    const s = (await app.inject({ method: 'GET', url: '/v1/summary', headers: auth })).json();
    expect(s.reserves.totalCents).toBe(1_590_000);
    expect(s.cards).toHaveLength(1);
    const put = (payload: object) => app.inject({ method: 'PUT', url: '/v1/settings', headers: auth, payload });
    expect((await put({ cardDueDay: 0 })).statusCode).toBe(400);
    expect((await put({ cardDueDay: 32 })).statusCode).toBe(400);
    expect((await put({ cardDueDay: 15 })).json().cardDueDay).toBe(15);
    expect((await put({ cardDueDay: null })).json().cardDueDay).toBeNull();
    await app.close();
  });
});
