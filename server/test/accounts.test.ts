import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, type OttoServices } from '../src/app.js';
import { makeConfig, signup, signupConnected, TEST_PASSWORD } from './helpers.js';

let app: FastifyInstance;
let services: OttoServices;

beforeAll(async () => {
  const built = await buildApp({ config: makeConfig({ SIGNUP_CODE: 'convite-123' }), logger: false, disableJobs: true });
  app = built.app;
  services = built.services;
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

const post = (url: string, payload: unknown, headers?: Record<string, string>) =>
  app.inject({ method: 'POST', url, payload: payload as object, headers });

describe('contas', () => {
  it('/v1/config informa se o cadastro exige código', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/config' });
    expect(r.json()).toMatchObject({ signupCodeRequired: true, mode: 'mock' });
  });

  it('cadastro valida código, e-mail e senha; e-mail repetido é recusado', async () => {
    const ok = { email: 'Bia@Example.com', password: TEST_PASSWORD, signupCode: 'convite-123' };
    expect((await post('/v1/auth/register', { ...ok, signupCode: 'errado' })).statusCode).toBe(403);
    expect((await post('/v1/auth/register', { ...ok, email: 'sem-arroba' })).statusCode).toBe(400);
    expect((await post('/v1/auth/register', { ...ok, password: 'curta' })).statusCode).toBe(400);
    const created = await post('/v1/auth/register', ok);
    expect(created.statusCode).toBe(201);
    expect(created.json().user.email).toBe('bia@example.com');
    expect(created.json().token.length).toBeGreaterThan(30);
    expect((await post('/v1/auth/register', { ...ok, email: 'bia@example.com' })).statusCode).toBe(409);
  });

  it('login aceita a senha certa (e-mail sem diferenciar maiúsculas) e recusa a errada', async () => {
    await signup(app, 'caio@example.com', { signupCode: 'convite-123' });
    expect((await post('/v1/auth/login', { email: 'CAIO@example.com', password: 'senha-errada-1' })).statusCode).toBe(401);
    expect((await post('/v1/auth/login', { email: 'ninguem@example.com', password: TEST_PASSWORD })).statusCode).toBe(401);
    const r = await post('/v1/auth/login', { email: 'CAIO@example.com', password: TEST_PASSWORD });
    expect(r.statusCode).toBe(200);
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${r.json().token}` } });
    expect(me.json().email).toBe('caio@example.com');
  });

  it('logout invalida o token', async () => {
    const s = await signup(app, 'dani@example.com', { signupCode: 'convite-123' });
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: s.headers })).statusCode).toBe(200);
    await post('/v1/auth/logout', {}, s.headers);
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: s.headers })).statusCode).toBe(401);
  });
});

describe('conexão e isolamento', () => {
  it('sem banco conectado, /v1/connection diz connected=false; depois de conectar, vem dado', async () => {
    const s = await signup(app, 'edu@example.com', { signupCode: 'convite-123' });
    expect((await app.inject({ method: 'GET', url: '/v1/connection', headers: s.headers })).json().connected).toBe(false);
    const tok = await post('/v1/connection/token', {}, s.headers);
    expect(tok.json()).toMatchObject({ mock: true });
    const c = await post('/v1/connection/items', {}, s.headers);
    expect(c.json()).toMatchObject({ ok: true, connected: true, synced: true });
    expect((await app.inject({ method: 'GET', url: '/v1/connection', headers: s.headers })).json().connected).toBe(true);
    const sum = (await app.inject({ method: 'GET', url: '/v1/summary', headers: s.headers })).json();
    expect(sum.balanceCents).toBeGreaterThan(0);
  });

  it('cada usuário só vê os próprios dados', async () => {
    const a = await signupConnected(app, 'fabi@example.com', { signupCode: 'convite-123' });
    const b = await signup(app, 'gabi@example.com', { signupCode: 'convite-123' });
    const sumB = (await app.inject({ method: 'GET', url: '/v1/summary', headers: b.headers })).json();
    expect(sumB.balanceCents).toBe(0);
    // simular na conta A não aparece na B
    await post('/v1/dev/simulate', { direction: 'in', amountCents: 12345 }, a.headers);
    const listB = (await app.inject({ method: 'GET', url: '/v1/transactions', headers: b.headers })).json();
    expect(listB.items).toHaveLength(0);
  });

  it('desconectar apaga os dados importados', async () => {
    const s = await signupConnected(app, 'hugo@example.com', { signupCode: 'convite-123' });
    const del = await app.inject({ method: 'DELETE', url: '/v1/connection', headers: s.headers });
    expect(del.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/connection', headers: s.headers })).json().connected).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/v1/transactions', headers: s.headers })).json().items).toHaveLength(0);
  });

  it('excluir a conta exige a senha e remove sessão e dados', async () => {
    const s = await signupConnected(app, 'iris@example.com', { signupCode: 'convite-123' });
    const bad = await app.inject({ method: 'DELETE', url: '/v1/account', headers: s.headers, payload: { password: 'errada-123' } });
    expect(bad.statusCode).toBe(403); // 403 (não 401): o app não deve interpretar como sessão expirada
    const ok = await app.inject({ method: 'DELETE', url: '/v1/account', headers: s.headers, payload: { password: TEST_PASSWORD } });
    expect(ok.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: s.headers })).statusCode).toBe(401);
    expect((await post('/v1/auth/login', { email: 'iris@example.com', password: TEST_PASSWORD })).statusCode).toBe(401);
    expect(services.directory.connectedUserIds()).not.toContain(s.userId);
  });

  it('a página /connect é pública e não carrega o token no servidor', async () => {
    const r = await app.inject({ method: 'GET', url: '/connect' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/html/);
    expect(r.body).toContain('pluggy-connect');
  });
});
