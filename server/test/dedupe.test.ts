import { describe, expect, it } from 'vitest';
import { listNotificationsAfter, upsertDevice } from '../src/db/repo.js';
import { ingestTransactions } from '../src/services/ingest.js';
import { Notifier, summaryNotificationText, transactionNotificationText } from '../src/services/notifier.js';
import { processWebhook } from '../src/services/pluggy/webhook.js';
import type { PluggySync } from '../src/services/pluggy/sync.js';
import { defaultSettings } from '../src/services/settings.js';
import { FakePush, makeConfig, memoryDb, seedAccount, silentLog, tx } from './helpers.js';

const config = makeConfig();

function setup() {
  const db = memoryDb();
  const push = new FakePush();
  const now = new Date('2026-11-19T15:00:00.000Z');
  const notifier = new Notifier(db, push, silentLog, () => now);
  upsertDevice(db, 'fid-device-1234567890', 'android', now.toISOString());
  return { db, push, now, notifier };
}

describe('deduplicação de notificações', () => {
  it('a mesma transação nunca gera duas notificações', async () => {
    const { db, push, now, notifier } = setup();
    seedAccount(db, 4821590);
    const t = tx('2026-11-19T14:59:00.000Z', 180000, { counterpart: 'João Silva' });
    const opts = { notify: true, maxAgeHours: 72, now, settings: defaultSettings(config) };

    const r1 = await ingestTransactions(db, notifier, [t], opts);
    const r2 = await ingestTransactions(db, notifier, [t], opts); // webhook repetido / polling
    const r3 = await ingestTransactions(db, notifier, [{ ...t, status: 'PENDING' }], opts); // atualização

    expect(r1).toEqual({ inserted: 1, updated: 0, notified: 1 });
    expect(r2).toEqual({ inserted: 0, updated: 1, notified: 0 });
    expect(r3.notified).toBe(0);
    expect(push.sent).toHaveLength(1);
    expect(listNotificationsAfter(db, 0, 10)).toHaveLength(1);
  });

  it('a chave idempotente na outbox impede duplicata mesmo chamando notify direto', async () => {
    const { push, notifier } = setup();
    const n = { dedupeKey: 'summary:2026-11-19', kind: 'summary', title: 'Resumo do dia', body: 'x', target: 'home' };
    expect(await notifier.notify(n)).toBeDefined();
    expect(await notifier.notify(n)).toBeUndefined();
    expect(push.sent).toHaveLength(1);
  });

  it('não notifica a importação inicial nem transações antigas', async () => {
    const { db, push, now, notifier } = setup();
    seedAccount(db, 0);
    const settings = defaultSettings(config);
    await ingestTransactions(db, notifier, [tx('2026-11-19T10:00:00.000Z', 100)], {
      notify: false,
      maxAgeHours: 72,
      now,
      settings,
    });
    await ingestTransactions(db, notifier, [tx('2026-11-01T10:00:00.000Z', 100)], {
      notify: true,
      maxAgeHours: 72,
      now,
      settings,
    });
    expect(push.sent).toHaveLength(0);
  });

  it('mostra em cada notificação o saldo logo após aquela transação', async () => {
    const { db, push, now, notifier } = setup();
    seedAccount(db, 4641590); // saldo final, já incluindo as duas
    await ingestTransactions(
      db,
      notifier,
      [
        tx('2026-11-19T14:50:00.000Z', -21540, { counterpart: 'Mercado Central' }),
        tx('2026-11-19T14:00:00.000Z', 180000, { counterpart: 'João Silva' }),
      ],
      { notify: true, maxAgeHours: 72, now, settings: defaultSettings(config) },
    );
    expect(push.sent.map((s) => [s.msg.title, s.msg.body])).toEqual([
      ['Entrou R$ 1.800,00', 'Pix de João Silva · Saldo R$ 46.631,30'],
      ['Saiu R$ 215,40', 'Pix para Mercado Central · Saldo R$ 46.415,90'],
    ]);
  });

  it('eventos de webhook repetidos (mesmo eventId) são ignorados', async () => {
    const { db, notifier } = setup();
    let calls = 0;
    const sync = { syncItem: async () => (calls++, { inserted: 0, updated: 0, notified: 0 }) } as unknown as PluggySync;
    const deps = { db, sync, notifier, log: silentLog, clientId: 'client-1', itemIds: ['item-1'], now: () => new Date() };
    const ev = { event: 'transactions/created', eventId: 'ev-1', clientId: 'client-1', itemId: 'item-1' };
    expect(await processWebhook(deps, ev)).toBe('sincronizado');
    expect(await processWebhook(deps, ev)).toBe('ignorado: evento repetido');
    expect(await processWebhook(deps, { ...ev, eventId: 'ev-2', clientId: 'outro' })).toMatch(/clientId/);
    expect(await processWebhook(deps, { ...ev, eventId: 'ev-3', itemId: 'item-x' })).toMatch(/item/);
    expect(calls).toBe(1);
  });
});

describe('texto das notificações', () => {
  it('segue o formato combinado', () => {
    expect(
      transactionNotificationText({ amountCents: 180000, method: 'PIX', counterpart: 'João Silva', description: 'Pix recebido' }, 4821590),
    ).toEqual({ title: 'Entrou R$ 1.800,00', body: 'Pix de João Silva · Saldo R$ 48.215,90', kind: 'in' });
    expect(
      transactionNotificationText({ amountCents: -21540, method: 'PIX', counterpart: 'Mercado Central', description: 'Pix enviado' }, 4641590),
    ).toEqual({ title: 'Saiu R$ 215,40', body: 'Pix para Mercado Central · Saldo R$ 46.415,90', kind: 'out' });
    expect(summaryNotificationText({ inCents: 324000, outCents: 111540, balanceCents: 4821590 })).toEqual({
      title: 'Resumo do dia',
      body: 'Entrou R$ 3.240,00 · Saiu R$ 1.115,40 · Saldo R$ 48.215,90',
    });
  });

  it('marca saídas acima do limite como saída grande', () => {
    const t = transactionNotificationText(
      { amountCents: -250000, method: 'PIX', counterpart: 'Loja X', description: 'Pix enviado' },
      100000,
      { big: true },
    );
    expect(t.body).toBe('Saída grande · Pix para Loja X · Saldo R$ 1.000,00');
  });
});
