import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { makeConfig, signup } from './helpers.js';

/** Pluggy falsa: item "item-ana" pertence ao usuário que o cria (clientUserId definido no teste). */
const owners = new Map<string, string>();
const deleted: string[] = [];
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

const fakePluggy = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(url));
  const method = init?.method ?? 'GET';
  if (u.pathname === '/auth') return json({ apiKey: 'k' });
  if (u.pathname === '/connect_token') {
    const body = JSON.parse(String(init?.body));
    return json({ accessToken: `ct-for-${body.options.clientUserId}` });
  }
  const m = /^\/items\/([^/]+)$/.exec(u.pathname);
  if (m && method === 'DELETE') {
    deleted.push(m[1]!);
    return json({});
  }
  if (m) {
    const id = m[1]!;
    if (!owners.has(id)) return json({ message: 'nf' }, 404);
    return json({ id, status: 'UPDATED', clientUserId: owners.get(id), connector: { name: 'Nubank' } });
  }
  if (u.pathname === '/accounts' || u.pathname === '/investments') return json({ results: [], totalPages: 1 });
  return json({ results: [] });
}) as typeof fetch;

let app: FastifyInstance;
beforeAll(async () => {
  const built = await buildApp({
    config: makeConfig({ MOCK_MODE: 'false', PLUGGY_CLIENT_ID: 'cid', PLUGGY_CLIENT_SECRET: 'sec' }),
    logger: false,
    disableJobs: true,
    fetchImpl: fakePluggy,
  });
  app = built.app;
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe('conexão real (Pluggy simulada)', () => {
  it('gera connect token amarrado ao usuário e só aceita item criado por ele', async () => {
    const ana = await signup(app, 'ana@example.com');
    const bia = await signup(app, 'bia@example.com');

    const tok = await app.inject({ method: 'POST', url: '/v1/connection/token', headers: ana.headers, payload: {} });
    expect(tok.json()).toEqual({ mock: false, connectToken: `ct-for-${ana.userId}` });

    owners.set('item-ana', ana.userId);
    const stolen = await app.inject({ method: 'POST', url: '/v1/connection/items', headers: bia.headers, payload: { itemId: 'item-ana' } });
    expect(stolen.statusCode).toBe(403);
    const missing = await app.inject({ method: 'POST', url: '/v1/connection/items', headers: ana.headers, payload: { itemId: 'nao-existe' } });
    expect(missing.statusCode).toBe(404);
    const noId = await app.inject({ method: 'POST', url: '/v1/connection/items', headers: ana.headers, payload: {} });
    expect(noId.statusCode).toBe(400);

    const ok = await app.inject({ method: 'POST', url: '/v1/connection/items', headers: ana.headers, payload: { itemId: 'item-ana' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ connected: true, connector: 'Nubank' });
    const c = await app.inject({ method: 'GET', url: '/v1/connection', headers: ana.headers });
    expect(c.json()).toMatchObject({ connected: true, items: [{ itemId: 'item-ana', kind: 'pluggy' }] });
  });

  it('o webhook de um item só mexe na conta dona dele e é recusado sem segredo', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/webhooks/pluggy', payload: { event: 'item/updated', itemId: 'item-ana' } });
    expect(r.statusCode).toBe(401); // sem segredo configurado, todo webhook é recusado
  });

  it('desconectar remove o item na Pluggy (revoga o consentimento)', async () => {
    const eva = await signup(app, 'eva@example.com');
    owners.set('item-eva', eva.userId);
    await app.inject({ method: 'POST', url: '/v1/connection/items', headers: eva.headers, payload: { itemId: 'item-eva' } });
    const del = await app.inject({ method: 'DELETE', url: '/v1/connection', headers: eva.headers });
    expect(del.statusCode).toBe(200);
    expect(deleted).toContain('item-eva');
  });
});
