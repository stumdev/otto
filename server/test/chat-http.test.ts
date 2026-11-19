import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { makeConfig, memoryDb, TEST_TOKEN } from './helpers.js';

/**
 * Regressão: com um socket HTTP de verdade, o evento 'close' da REQUISIÇÃO dispara logo
 * depois que o corpo é lido. Se o chat usasse esse evento para cancelar a IA, a resposta
 * sairia vazia. O `inject` do Fastify não reproduz isso, por isso este teste usa listen().
 */
let app: FastifyInstance;
let base: string;

// provedor de IA falso (o servidor chama via fetchImpl), respondendo em SSE
// 1ª chamada: a IA pede a ferramenta; 2ª: responde. Com latência de rede realista.
let aiCalls = 0;
const fakeAi = (async (_url: string | URL | Request, init?: RequestInit) => {
  await new Promise((r) => setTimeout(r, 300));
  if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
  aiCalls++;
  const payloads =
    aiCalls % 2 === 1
      ? [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'get_balance', arguments: '{}' } }] } }] }]
      : ['Entrou ', '**R$ 10,00**', ' hoje.'].map((t) => ({ choices: [{ delta: { content: t } }] }));
  const body = payloads.map((p) => `data: ${JSON.stringify(p)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}) as typeof fetch;

beforeAll(async () => {
  const built = await buildApp({
    config: makeConfig({ GROQ_API_KEY: 'gsk_fake', AI_PROVIDER_ORDER: 'groq' }),
    db: memoryDb(),
    logger: false,
    disableJobs: true,
    fetchImpl: fakeAi,
  });
  app = built.app;
  await built.services.syncOnce();
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('sem porta');
  base = `http://127.0.0.1:${addr.port}`;
});
afterAll(async () => {
  await app.close();
});

describe('chat por HTTP real', () => {
  it('entrega a resposta completa da IA em streaming', async () => {
    const r = await fetch(`${base}/v1/chat`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TEST_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'quanto entrou hoje?' }] }),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/text\/event-stream/);
    const body = await r.text();
    expect(body).toContain('event: meta\ndata: {"mode":"ai","provider":"groq"}');
    const text = [...body.matchAll(/event: delta\ndata: (.*)/g)].map((m) => JSON.parse(m[1]!).text).join('');
    expect(text).toBe('Entrou **R$ 10,00** hoje.');
    expect(body.trim().endsWith('event: done\ndata: {}')).toBe(true);
  });
});
