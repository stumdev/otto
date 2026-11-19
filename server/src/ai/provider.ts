import type { AiProviderConfig } from '../config.js';

/**
 * Cliente mínimo para APIs compatíveis com OpenAI Chat Completions (Groq e Gemini),
 * com streaming SSE e tool calling.
 */

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
  /** Campos extras devolvidos pelo provedor (ex.: extra_content.google.thought_signature do Gemini). */
  [extra: string]: unknown;
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export type StreamEvent = { type: 'content'; text: string } | { type: 'tool_calls'; calls: ToolCall[] };

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export type FetchLike = typeof fetch;

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

/** Faz uma chamada em streaming. Lança ProviderError antes de emitir qualquer evento se a resposta falhar. */
export async function* streamChatCompletion(
  provider: AiProviderConfig,
  body: { messages: ChatMessage[]; tools?: ToolDef[]; temperature?: number; max_tokens?: number },
  opts: { timeoutMs: number; fetchImpl?: FetchLike; signal?: AbortSignal },
): AsyncGenerator<StreamEvent> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const signals = [AbortSignal.timeout(opts.timeoutMs)];
  if (opts.signal) signals.push(opts.signal);

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${provider.apiKey}`,
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: provider.model,
        messages: body.messages,
        ...(body.tools?.length ? { tools: body.tools, tool_choice: 'auto' } : {}),
        temperature: body.temperature ?? 0.2,
        max_tokens: body.max_tokens ?? 1024,
        stream: true,
      }),
      signal: AbortSignal.any(signals),
    });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    throw new ProviderError(`falha de rede (${(err as Error).name})`, undefined, true);
  }

  if (!res.ok || !res.body) {
    const retryAfter = Number(res.headers.get('retry-after'));
    // não registramos o corpo do erro: pode ecoar parte da conversa
    await res.body?.cancel().catch(() => undefined);
    throw new ProviderError(
      `${provider.name} respondeu HTTP ${res.status}`,
      res.status,
      isRetryableStatus(res.status),
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
    );
  }

  const calls = new Map<number, ToolCall>();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawTool = false;

  const reader = res.body.getReader();
  try {
    for (;;) {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        throw new ProviderError('conexão interrompida durante o streaming', undefined, true);
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let json: {
          choices?: { delta?: { content?: string | null; tool_calls?: Record<string, unknown>[] } }[];
          error?: unknown;
        };
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        if (json.error) throw new ProviderError(`${provider.name} devolveu erro no stream`, undefined, true);
        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.tool_calls) {
          sawTool = true;
          for (const tc of delta.tool_calls) mergeToolCallDelta(calls, tc);
        }
        if (typeof delta.content === 'string' && delta.content.length > 0) {
          yield { type: 'content', text: delta.content };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (sawTool && calls.size > 0) {
    const list = [...calls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([i, c]) => (c.id ? c : { ...c, id: `call_${i}` }));
    yield { type: 'tool_calls', calls: list };
  }
}

function mergeToolCallDelta(calls: Map<number, ToolCall>, tc: Record<string, unknown>): void {
  const index = typeof tc['index'] === 'number' ? (tc['index'] as number) : calls.size;
  let cur = calls.get(index);
  if (!cur) {
    cur = { id: '', type: 'function', function: { name: '', arguments: '' } };
    calls.set(index, cur);
  }
  for (const [k, v] of Object.entries(tc)) {
    if (k === 'index' || v === null || v === undefined) continue;
    if (k === 'id' && typeof v === 'string') cur.id = cur.id || v;
    else if (k === 'type') continue;
    else if (k === 'function' && typeof v === 'object') {
      const f = v as { name?: string; arguments?: string };
      if (f.name) cur.function.name = cur.function.name || f.name;
      if (typeof f.arguments === 'string') cur.function.arguments += f.arguments;
    } else {
      cur[k] = v; // preserva campos extras (ex.: assinatura de pensamento do Gemini)
    }
  }
}
