import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { loadConfig, type Config } from '../src/config.js';
import { openDatabase, type DB } from '../src/db/index.js';
import { upsertAccount, type TxInput } from '../src/db/repo.js';
import { localDateOf } from '../src/lib/time.js';
import type { PushMessage, PushSender } from '../src/services/notifier.js';

export const TEST_PASSWORD = 'senha-forte-123';

export function makeConfig(env: Record<string, string> = {}): Config {
  return loadConfig({ DATA_DIR: ':memory:', MOCK_MODE: 'true', LOG_LEVEL: 'silent', NODE_ENV: 'test', SIGNUP_RATE_PER_HOUR: '1000', ...env });
}

export function memoryDb(): DB {
  return openDatabase(':memory:');
}

export const silentLog = pino({ level: 'silent' });

export function seedAccount(db: DB, balanceCents: number, id = 'acc-1'): void {
  upsertAccount(db, { id, itemId: null, name: 'Conta', balanceCents, currency: 'BRL' }, new Date().toISOString());
}

let seq = 0;
export function tx(occurredAt: string, amountCents: number, extra: Partial<TxInput> = {}): TxInput {
  seq++;
  return {
    externalId: `t-${seq}`,
    accountId: 'acc-1',
    occurredAt,
    localDate: localDateOf(occurredAt),
    hasTime: true,
    amountCents,
    description: amountCents > 0 ? 'Pix recebido' : 'Pix enviado',
    counterpart: 'Fulano de Tal',
    method: 'PIX',
    category: 'Transferências',
    status: 'POSTED',
    ...extra,
  };
}

export class FakePush implements PushSender {
  readonly enabled = true;
  sent: { tokens: string[]; msg: PushMessage }[] = [];
  async send(tokens: string[], msg: PushMessage) {
    this.sent.push({ tokens, msg });
    return { successCount: tokens.length, invalidTokens: [] };
  }
}

/** Cria uma conta pela API e devolve os cabeçalhos de autenticação. */
export async function signup(app: FastifyInstance, email = 'ana@example.com', extra: Record<string, unknown> = {}) {
  const r = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { email, password: TEST_PASSWORD, ...extra } });
  if (r.statusCode !== 201) throw new Error(`cadastro falhou: ${r.statusCode} ${r.body}`);
  const body = r.json() as { token: string; user: { id: string } };
  return { headers: { authorization: `Bearer ${body.token}` }, token: body.token, userId: body.user.id };
}

/** Cria a conta e "conecta o banco" (no modo mock, gera a conta de demonstração e importa o histórico). */
export async function signupConnected(app: FastifyInstance, email = 'ana@example.com', extra: Record<string, unknown> = {}) {
  const s = await signup(app, email, extra);
  const c = await app.inject({ method: 'POST', url: '/v1/connection/items', headers: s.headers, payload: {} });
  if (c.statusCode !== 200) throw new Error(`conexão falhou: ${c.statusCode} ${c.body}`);
  return s;
}
