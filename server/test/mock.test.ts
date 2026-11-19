import { describe, expect, it } from 'vitest';
import { countTransactions, sumAll, totalBalance } from '../src/db/repo.js';
import { generateDay, generateMockRange, MOCK_DAYS } from '../src/services/mock/generator.js';
import { MockBank } from '../src/services/mock/mock.js';
import { Notifier } from '../src/services/notifier.js';
import { defaultSettings } from '../src/services/settings.js';
import { FakePush, makeConfig, memoryDb, silentLog } from './helpers.js';
import { upsertDevice } from '../src/db/repo.js';

const settings = defaultSettings(makeConfig());

describe('modo mock', () => {
  it('gera ~60 dias de transações plausíveis', () => {
    const now = new Date('2026-11-19T15:00:00.000Z');
    const txs = generateMockRange(now);
    const days = new Set(txs.map((t) => t.localDate));
    expect(days.size).toBeGreaterThan(MOCK_DAYS * 0.8);
    expect(txs.length).toBeGreaterThan(100);
    expect(txs.every((t) => Number.isSafeInteger(t.amountCents) && t.amountCents !== 0)).toBe(true);
    expect(txs.every((t) => t.occurredAt <= now.toISOString())).toBe(true);
    expect(txs.some((t) => t.method === 'PIX' && t.amountCents > 0)).toBe(true);
    expect(txs.some((t) => t.category === 'Mercado')).toBe(true);
    expect(txs.some((t) => t.category === 'Assinaturas')).toBe(true);
  });

  it('é determinístico por dia', () => {
    expect(generateDay('2026-11-10', { first: false })).toEqual(generateDay('2026-11-10', { first: false }));
  });

  it('o saldo bate com a soma das transações e nunca fica negativo', async () => {
    const db = memoryDb();
    const push = new FakePush();
    let now = new Date('2026-11-19T12:00:00.000Z');
    const notifier = new Notifier(db, push, silentLog, () => now);
    upsertDevice(db, 'fid-device-1234567890', 'android', now.toISOString());
    const bank = new MockBank(db, notifier);

    await bank.tick(now, settings, 72);
    expect(totalBalance(db).balanceCents).toBe(sumAll(db));
    expect(push.sent).toHaveLength(0); // histórico inicial não notifica

    // saldo de fechamento de cada dia nunca negativo
    const rows = db
      .prepare('SELECT local_date d, SUM(amount_cents) s FROM transactions GROUP BY local_date ORDER BY local_date')
      .all() as { d: string; s: number }[];
    let running = 0;
    for (const r of rows) {
      running += r.s;
      expect(running).toBeGreaterThanOrEqual(0);
    }

    const before = countTransactions(db);
    await bank.tick(now, settings, 72); // repetir não duplica
    expect(countTransactions(db)).toBe(before);

    now = new Date('2026-11-20T23:00:00.000Z'); // o dia seguinte "acontece"
    await bank.tick(now, settings, 72);
    expect(countTransactions(db)).toBeGreaterThan(before);
    expect(totalBalance(db).balanceCents).toBe(sumAll(db));

    const sim = await bank.simulate(now, settings, 'in', 180000);
    expect(sim.result.notified).toBe(1);
    expect(totalBalance(db).balanceCents).toBe(sumAll(db));
    const last = push.sent[push.sent.length - 1]!.msg;
    expect(last.title).toBe('Entrou R$ 1.800,00');
    expect(last.body).toMatch(/^Pix de .+ · Saldo R\$ [\d.]+,\d{2}$/);
  });
});
