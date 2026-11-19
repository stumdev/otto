import { describe, expect, it } from 'vitest';
import { runChat, type ChatDeps, type ChatEvent } from '../src/ai/chat.js';
import type { AiProviderConfig } from '../src/config.js';
import { upsertTransaction } from '../src/db/repo.js';
import { runTool } from '../src/ai/tools.js';
import { answerWithRules } from '../src/ai/rules.js';
import { memoryDb, seedAccount, silentLog, tx } from './helpers.js';

const groq: AiProviderConfig = { name: 'groq', baseUrl: 'https://groq.test/openai/v1', apiKey: 'gk', model: 'openai/gpt-oss-120b' };
const gemini: AiProviderConfig = {
  name: 'gemini',
  baseUrl: 'https://gemini.test/v1beta/openai/',
  apiKey: 'gm',
  model: 'gemini-3.8-flash',
};

function sse(chunks: unknown[]): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const text = (s: string) => ({ choices: [{ delta: { content: s } }] });

interface Call {
  url: string;
  body: { model: string; messages: { role: string; content?: string | null; tool_calls?: unknown[] }[]; tools?: unknown[] };
}

function fakeFetch(handler: (call: Call, n: number) => Response) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), body: JSON.parse(String(init?.body)) } as Call;
    calls.push(call);
    return handler(call, calls.length);
  }) as typeof fetch;
  return { impl, calls };
}

function deps(over: Partial<ChatDeps>): ChatDeps {
  const db = memoryDb();
  seedAccount(db, 4821590);
  return {
    db,
    providers: [groq, gemini],
    log: silentLog,
    now: () => new Date('2026-11-19T15:00:00.000Z'),
    timeoutMs: 5000,
    maxRetries: 2,
    sleep: async () => {},
    ...over,
  };
}

async function collect(gen: AsyncGenerator<ChatEvent>) {
  const out: ChatEvent[] = [];
  for await (const e of gen) out.push(e);
  const textOut = out
    .filter((e): e is Extract<ChatEvent, { event: 'delta' }> => e.event === 'delta')
    .map((e) => e.data.text)
    .join('');
  return { events: out, text: textOut };
}

const ask = [{ role: 'user' as const, content: 'qual meu saldo?' }];

describe('fallback de provedor de IA', () => {
  it('usa o Groq quando ele responde', async () => {
    const f = fakeFetch(() => sse([text('Seu saldo é '), text('**R$ 48.215,90**.')]));
    const r = await collect(runChat(deps({ fetchImpl: f.impl }), ask));
    expect(r.text).toBe('Seu saldo é **R$ 48.215,90**.');
    expect(r.events[0]).toEqual({ event: 'meta', data: { mode: 'ai', provider: 'groq', model: expect.any(String) } });
    expect(f.calls[0]!.url).toBe('https://groq.test/openai/v1/chat/completions');
    expect(f.calls[0]!.body.model).toBe('openai/gpt-oss-120b');
  });

  it('faz retry com backoff em 429/5xx e troca para o Gemini', async () => {
    const sleeps: number[] = [];
    const f = fakeFetch((c) =>
      c.url.startsWith('https://groq.test')
        ? new Response('limite', { status: 429 })
        : sse([text('Olá do Gemini')]),
    );
    const r = await collect(
      runChat(deps({ fetchImpl: f.impl, sleep: async (ms) => void sleeps.push(ms) }), ask),
    );
    const groqCalls = f.calls.filter((c) => c.url.startsWith('https://groq.test')).length;
    expect(groqCalls).toBe(3); // 1 + 2 retries
    expect(sleeps).toHaveLength(2);
    expect(sleeps[1]!).toBeGreaterThan(sleeps[0]!); // backoff exponencial
    expect(f.calls[f.calls.length - 1]!.url).toBe('https://gemini.test/v1beta/openai/chat/completions');
    expect(r.text).toBe('Olá do Gemini');
    expect(r.events[0]).toEqual({ event: 'meta', data: { mode: 'ai', provider: 'gemini', model: expect.any(String) } });
  });

  it('não insiste em erro não recuperável (401) e vai direto ao próximo', async () => {
    const f = fakeFetch((c) => (c.url.startsWith('https://groq.test') ? new Response('', { status: 401 }) : sse([text('ok')])));
    await collect(runChat(deps({ fetchImpl: f.impl }), ask));
    expect(f.calls.filter((c) => c.url.startsWith('https://groq.test'))).toHaveLength(1);
  });

  it('cai para o motor de regras se todos falharem', async () => {
    const f = fakeFetch(() => new Response('', { status: 503 }));
    const r = await collect(runChat(deps({ fetchImpl: f.impl }), ask));
    expect(r.events[0]).toEqual({ event: 'meta', data: { mode: 'offline', reason: 'provedores_indisponiveis' } });
    expect(r.text).toBe('Seu saldo agora é **R$ 48.215,90**.');
  });

  it('sem chave configurada responde offline com regras', async () => {
    const r = await collect(runChat(deps({ providers: [] }), ask));
    expect(r.events[0]).toEqual({ event: 'meta', data: { mode: 'offline', reason: 'sem_chave' } });
    expect(r.events.some((e) => e.event === 'card')).toBe(true);
    expect(r.events[r.events.length - 1]!.event).toBe('done');
  });

  it('executa tool calling localmente e devolve só o resultado da função', async () => {
    const f = fakeFetch((_c, n) => {
      if (n === 1) {
        return sse([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_1',
                      type: 'function',
                      function: { name: 'get_balance', arguments: '' },
                      extra_content: { google: { thought_signature: 'sig-A' } },
                    },
                  ],
                },
              },
            ],
          },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{}' } }] } }] },
        ]);
      }
      return sse([text('Seu saldo é **R$ 48.215,90**.')]);
    });
    const r = await collect(runChat(deps({ fetchImpl: f.impl, providers: [gemini] }), ask));
    expect(r.text).toBe('Seu saldo é **R$ 48.215,90**.');
    const second = f.calls[1]!.body.messages;
    const assistant = second.find((m) => m.role === 'assistant')!;
    // a assinatura de pensamento do Gemini é devolvida intacta
    expect(assistant.tool_calls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'get_balance', arguments: '{}' },
        extra_content: { google: { thought_signature: 'sig-A' } },
      },
    ]);
    const toolMsg = second.find((m) => m.role === 'tool')!;
    expect(JSON.parse(toolMsg.content!)).toMatchObject({ saldo_conta: 'R$ 48.215,90', total_caixinhas: 'R$ 0,00' });
    expect(r.events.find((e) => e.event === 'card')).toEqual({
      event: 'card',
      data: { type: 'balance', title: 'Saldo na conta', amountCents: 4821590 },
    });
    // o system prompt proíbe inventar números
    expect(f.calls[0]!.body.messages[0]!.content).toMatch(/NUNCA invente/);
  });
});

describe('ferramentas da IA', () => {
  it('nunca devolvem mais que 10 itens', () => {
    const db = memoryDb();
    seedAccount(db, 0);
    const nowIso = new Date().toISOString();
    for (let i = 0; i < 30; i++) {
      upsertTransaction(db, tx(`2026-11-1${i % 9}T15:00:00.000Z`, -(1000 + i), { counterpart: 'Mercado Central', category: 'Mercado' }), nowIso);
    }
    const now = new Date('2026-11-19T15:00:00.000Z');
    const search = runTool(db, 'search_transactions', JSON.stringify({ query: 'mercado', period: 'this_month' }), now);
    const res = search.result as { itens: unknown[]; quantidade: number; itens_omitidos: number };
    expect(res.itens).toHaveLength(10);
    expect(res.quantidade).toBe(30);
    expect(res.itens_omitidos).toBe(20);
    const top = runTool(db, 'get_top_transactions', JSON.stringify({ period: 'this_month', direction: 'out', limit: 50 }), now);
    expect((top.result as { erro?: string }).erro).toBeDefined(); // limite acima do máximo é recusado
    const bad = runTool(db, 'get_period_summary', '{"from":"ontem","to":"hoje"}', now);
    expect((bad.result as { erro: string }).erro).toMatch(/AAAA-MM-DD/);
  });

  it('motor de regras entende perguntas comuns', () => {
    const db = memoryDb();
    seedAccount(db, 100000);
    const nowIso = new Date().toISOString();
    upsertTransaction(db, tx('2026-11-19T13:00:00.000Z', 324000), nowIso);
    upsertTransaction(db, tx('2026-11-19T14:00:00.000Z', -21540, { counterpart: 'Mercado Central', category: 'Mercado' }), nowIso);
    upsertTransaction(db, tx('2026-11-17T14:00:00.000Z', -90000, { counterpart: 'Farmácia Saúde Já', category: 'Saúde' }), nowIso);
    const now = new Date('2026-11-19T18:00:00.000Z');
    expect(answerWithRules(db, 'Quanto entrou hoje?', now).text).toBe('Hoje entrou **R$ 3.240,00** (1 entrada).');
    expect(answerWithRules(db, 'qual foi minha maior saída da semana?', now).text).toBe(
      'A maior saída nesta semana foi de **R$ 900,00** (Farmácia Saúde Já), em 17/11/2026.',
    );
    expect(answerWithRules(db, 'quanto gastei no mercado este mês?', now).text).toBe(
      'Você gastou **R$ 215,40** com “mercado” neste mês, em 1 movimentação.',
    );
    expect(answerWithRules(db, 'quanto gastei na farmacia?', now).text).toMatch(/R\$ 900,00/);
  });
});
