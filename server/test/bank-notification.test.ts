import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import {
  countTransactions,
  expireProvisionals,
  listNotificationsAfter,
  totalBalance,
  upsertAccount,
  upsertDevice,
} from '../src/db/repo.js';
import { handleBankNotification, type BankNotificationInput } from '../src/services/bankNotification.js';
import { ingestTransactions } from '../src/services/ingest.js';
import { Notifier } from '../src/services/notifier.js';
import { defaultSettings } from '../src/services/settings.js';
import { FakePush, makeConfig, memoryDb, seedAccount, silentLog, signupConnected, tx } from './helpers.js';

const settings = defaultSettings(makeConfig());
const fp = (s: string) => createHash('sha256').update(s).digest('hex');

function setup(balanceCents = 4641590) {
  const db = memoryDb();
  const push = new FakePush();
  const now = new Date('2026-11-19T15:00:00.000Z'); // 12:00 em São Paulo
  const notifier = new Notifier(db, push, silentLog, () => now);
  seedAccount(db, balanceCents);
  upsertDevice(db, 'fid-device-1234567890', 'android', now.toISOString());
  return { db, push, now, notifier };
}

function event(over: Partial<BankNotificationInput> = {}): BankNotificationInput {
  return {
    fingerprint: fp('evento-1'),
    amountCents: 180000,
    counterpart: 'João Silva',
    method: 'PIX',
    occurredAt: '2026-11-19T14:59:30.000Z',
    alreadyNotified: false,
    ...over,
  };
}

describe('notificação do banco lida no celular', () => {
  it('vira transação provisória, entra no saldo e notifica na hora', async () => {
    const { db, push, now, notifier } = setup();
    const r = await handleBankNotification(db, notifier, event(), settings, now);
    expect(r.status).toBe('created');
    expect(totalBalance(db)).toMatchObject({ balanceCents: 4821590, provisionalCents: 180000 });
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]!.msg.title).toBe('Entrou R$ 1.800,00');
    expect(push.sent[0]!.msg.body).toBe('Pix de João Silva · Saldo R$ 48.215,90');
    if (r.status === 'created') expect(r.notification?.title).toBe('Entrou R$ 1.800,00');
  });

  it('a mesma notificação reenviada não duplica nada', async () => {
    const { db, push, now, notifier } = setup();
    await handleBankNotification(db, notifier, event(), settings, now);
    const again = await handleBankNotification(db, notifier, event(), settings, now);
    expect(again.status).toBe('duplicate');
    expect(countTransactions(db)).toBe(1);
    expect(push.sent).toHaveLength(1);
  });

  it('quando o agregador entrega a oficial, ela substitui a provisória sem notificar de novo', async () => {
    const { db, push, now, notifier } = setup();
    await handleBankNotification(db, notifier, event(), settings, now);

    // dia seguinte: a Pluggy entrega a transação (só com a data) e o saldo já a inclui
    const later = new Date('2026-11-20T15:00:00.000Z');
    upsertAccount(db, { id: 'acc-1', itemId: null, name: 'Conta', balanceCents: 4821590, currency: 'BRL' }, later.toISOString());
    const official = tx('2026-11-19T15:00:00.000Z', 180000, { externalId: 'pluggy:abc', localDate: '2026-11-19', hasTime: false });
    const r = await ingestTransactions(db, notifier, [official], { notify: true, maxAgeHours: 72, now: later, settings });

    expect(r).toMatchObject({ inserted: 1, matched: 1, notified: 0 });
    expect(push.sent).toHaveLength(1); // só o aviso original
    expect(countTransactions(db)).toBe(1); // provisória removida, oficial no lugar
    expect(totalBalance(db)).toMatchObject({ balanceCents: 4821590, provisionalCents: 0 }); // sem contar duas vezes
    // a notificação original reenviada (fila do app) continua sendo reconhecida como repetida
    expect((await handleBankNotification(db, notifier, event(), settings, now)).status).toBe('duplicate');
  });

  it('se o agregador chegou antes, só vincula e não cria provisória nem avisa', async () => {
    const { db, push, now, notifier } = setup(4821590);
    const official = tx('2026-11-19T14:59:00.000Z', 180000, { externalId: 'pluggy:xyz' });
    await ingestTransactions(db, notifier, [official], { notify: false, maxAgeHours: 72, now, settings });
    const r = await handleBankNotification(db, notifier, event(), settings, now);
    expect(r.status).toBe('already_confirmed');
    expect(countTransactions(db)).toBe(1);
    expect(totalBalance(db).balanceCents).toBe(4821590);
    expect(push.sent).toHaveLength(0);
  });

  it('valores diferentes não se confundem', async () => {
    const { db, notifier, now } = setup();
    await handleBankNotification(db, notifier, event(), settings, now);
    const other = tx('2026-11-19T15:00:00.000Z', 179999, { externalId: 'pluggy:outra' });
    const r = await ingestTransactions(db, notifier, [other], { notify: false, maxAgeHours: 72, now, settings });
    expect(r.matched).toBe(0);
    expect(countTransactions(db)).toBe(2);
  });

  it('saídas respeitam o alerta de saída grande', async () => {
    const { db, push, now, notifier } = setup(500000);
    await handleBankNotification(
      db,
      notifier,
      event({ fingerprint: fp('saida'), amountCents: -250000, counterpart: 'Loja X' }),
      settings,
      now,
    );
    expect(push.sent[0]!.msg).toMatchObject({
      kind: 'out_big',
      title: 'Saiu R$ 2.500,00',
      body: 'Saída grande · Pix para Loja X · Saldo R$ 2.500,00',
    });
  });

  it('com alreadyNotified grava a provisória mas não avisa de novo', async () => {
    const { db, push, now, notifier } = setup();
    const r = await handleBankNotification(db, notifier, event({ alreadyNotified: true }), settings, now);
    expect(r.status).toBe('created');
    expect(push.sent).toHaveLength(0);
    expect(listNotificationsAfter(db, 0, 10)).toHaveLength(0);
    expect(totalBalance(db).provisionalCents).toBe(180000);
  });

  it('recusa horário no futuro, evento antigo e servidor sem conta', async () => {
    const { db, now, notifier } = setup();
    expect((await handleBankNotification(db, notifier, event({ occurredAt: '2026-11-19T16:00:00.000Z' }), settings, now)).status).toBe('rejected');
    expect((await handleBankNotification(db, notifier, event({ occurredAt: '2026-11-15T15:00:00.000Z' }), settings, now)).status).toBe('rejected');
    const empty = memoryDb();
    const n2 = new Notifier(empty, new FakePush(), silentLog, () => now);
    expect(await handleBankNotification(empty, n2, event(), settings, now)).toEqual({
      status: 'rejected',
      reason: 'nenhuma conta sincronizada ainda',
    });
  });

  it('provisória nunca confirmada expira e sai do saldo', async () => {
    const { db, now, notifier } = setup();
    await handleBankNotification(db, notifier, event(), settings, now);
    expect(expireProvisionals(db, new Date(now.getTime() - 1000).toISOString(), now.toISOString())).toBe(0);
    expect(expireProvisionals(db, new Date(now.getTime() + 1000).toISOString(), now.toISOString())).toBe(1);
    expect(totalBalance(db)).toMatchObject({ balanceCents: 4641590, provisionalCents: 0 });
  });
});

describe('POST /v1/events/bank-notification', () => {
  it('exige token, valida o corpo e cria a provisória', async () => {
    const push = new FakePush();
    const { app } = await buildApp({ config: makeConfig(), push, logger: false, disableJobs: true });
    const url = '/v1/events/bank-notification';
    const auth = (await signupConnected(app)).headers;
    const payload = { ...event(), occurredAt: new Date().toISOString() };

    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url, headers: auth, payload: { ...payload, fingerprint: 'abc' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url, headers: auth, payload: { ...payload, amountCents: 0 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url, headers: auth, payload: { ...payload, extra: 1 } })).statusCode).toBe(400);

    const ok = await app.inject({ method: 'POST', url, headers: auth, payload });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ ok: true, status: 'created', notification: { title: 'Entrou R$ 1.800,00' } });
    const dup = await app.inject({ method: 'POST', url, headers: auth, payload });
    expect(dup.json()).toMatchObject({ status: 'duplicate', notification: null });

    const list = await app.inject({ method: 'GET', url: '/v1/transactions?limit=1', headers: auth });
    expect(list.json().items[0]).toMatchObject({ amountCents: 180000, status: 'PROVISIONAL' });
    expect(list.json().items[0].subtitle).toMatch(/a confirmar$/);
    await app.close();
  });
});
