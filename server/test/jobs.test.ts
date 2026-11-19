import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { upsertDevice } from '../src/db/repo.js';
import { FakePush, makeConfig, memoryDb } from './helpers.js';

describe('resumo diário', () => {
  it('sai uma única vez, no horário configurado em São Paulo', async () => {
    const db = memoryDb();
    const push = new FakePush();
    let now = new Date('2026-11-20T00:30:00.000Z'); // 19/11 21:30 em São Paulo
    const { app, services } = await buildApp({ config: makeConfig(), db, push, logger: false, disableJobs: true, now: () => now });
    await services.syncOnce();
    upsertDevice(db, 'fid-device-1234567890', 'android', now.toISOString());

    expect(await services.dailySummaryTick()).toBe(false); // antes das 22:00
    now = new Date('2026-11-20T01:01:00.000Z'); // 22:01
    expect(await services.dailySummaryTick()).toBe(true);
    expect(await services.dailySummaryTick()).toBe(false); // não repete
    const msg = push.sent.at(-1)!.msg;
    expect(msg.title).toBe('Resumo do dia');
    expect(msg.body).toMatch(/^Entrou R\$ [\d.]+,\d{2} · Saiu R\$ [\d.]+,\d{2} · Saldo R\$ [\d.]+,\d{2}$/);
    now = new Date('2026-11-20T04:00:00.000Z'); // 01:00 do dia 20: fora da janela
    expect(await services.dailySummaryTick()).toBe(false);
    await app.close();
  });
});
