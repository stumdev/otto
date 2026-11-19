import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { FakePush, makeConfig, signup, signupConnected, TEST_PASSWORD } from './helpers.js';

let app: FastifyInstance;
const push = new FakePush();
let auth: { authorization: string };

beforeAll(async () => {
  const built = await buildApp({ config: makeConfig(), push, logger: false, disableJobs: true });
  app = built.app;
  await app.ready();
  auth = (await signupConnected(app)).headers;
});
afterAll(async () => {
  await app.close();
});

describe('API', () => {
  it('GET /health responde sem token', async () => {
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: 'ok', mode: 'mock' });
  });

  it('exige sessão válida', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/summary' })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/summary', headers: { authorization: 'Bearer errado' } })).statusCode,
    ).toBe(401);
  });

  it('não envia cabeçalhos CORS para origens de navegador', async () => {
    const r = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://evil.example' } });
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('GET /v1/summary traz saldo, hoje e série de 7 dias', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/summary', headers: auth });
    expect(r.statusCode).toBe(200);
    const s = r.json();
    expect(Number.isInteger(s.balanceCents)).toBe(true);
    expect(s.series).toHaveLength(7);
    expect(s.series[6].closingBalanceCents).toBe(s.balanceCents);
    expect(s.recent.length).toBeLessThanOrEqual(3);
  });

  it('GET /v1/transactions pagina por cursor sem repetir itens', async () => {
    const seen = new Set<number>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `/v1/transactions?limit=25${cursor ? `&cursor=${cursor}` : ''}`;
      const r = await app.inject({ method: 'GET', url, headers: auth });
      expect(r.statusCode).toBe(200);
      const body = r.json() as { items: { id: number }[]; nextCursor: string | null };
      for (const it of body.items) {
        expect(seen.has(it.id)).toBe(false);
        seen.add(it.id);
      }
      cursor = body.nextCursor;
      pages++;
    } while (cursor && pages < 100);
    expect(pages).toBeGreaterThan(1);
    expect((await app.inject({ method: 'GET', url: '/v1/transactions?cursor=lixo', headers: auth })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/v1/transactions?from=19-11-2026', headers: auth })).statusCode).toBe(400);
  });

  it('PUT /v1/settings valida e persiste', async () => {
    const ok = await app.inject({
      method: 'PUT',
      url: '/v1/settings',
      headers: auth,
      payload: { bigOutflowThresholdCents: 250000, dailySummaryTime: '21:30' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ bigOutflowThresholdCents: 250000, dailySummaryTime: '21:30' });
    const bad = await app.inject({ method: 'PUT', url: '/v1/settings', headers: auth, payload: { dailySummaryTime: '25:00' } });
    expect(bad.statusCode).toBe(400);
    const unknown = await app.inject({ method: 'PUT', url: '/v1/settings', headers: auth, payload: { foo: 1 } });
    expect(unknown.statusCode).toBe(400);
  });

  it('POST /v1/devices registra o FID e /v1/dev/simulate dispara o push', async () => {
    const d = await app.inject({ method: 'POST', url: '/v1/devices', headers: auth, payload: { fid: 'fid-abcdef-123456' } });
    expect(d.statusCode).toBe(200);
    const r = await app.inject({
      method: 'POST',
      url: '/v1/dev/simulate',
      headers: auth,
      payload: { direction: 'out', amountCents: 21540 },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.notification.title).toBe('Saiu R$ 215,40');
    expect(push.sent.at(-1)!.msg.title).toBe('Saiu R$ 215,40');
    expect(push.sent.at(-1)!.tokens).toEqual(['fid-abcdef-123456']);
    const n = await app.inject({ method: 'GET', url: '/v1/notifications?after=0', headers: auth });
    expect(n.json().items.at(-1).title).toBe('Saiu R$ 215,40');
  });

  it('POST /v1/chat responde em streaming SSE (modo offline sem chave)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: auth,
      payload: { messages: [{ role: 'user', content: 'Qual meu saldo agora?' }] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/event-stream/);
    expect(r.body).toMatch(/event: meta\ndata: {"mode":"offline"/);
    expect(r.body).toMatch(/event: delta/);
    expect(r.body).toMatch(/event: card/);
    expect(r.body.trim().endsWith('event: done\ndata: {}')).toBe(true);
  });

  it('webhook não existe no modo mock', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/webhooks/pluggy', payload: { event: 'x' } });
    expect(r.statusCode).toBe(404);
  });
});
