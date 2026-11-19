import pino from 'pino';
import { loadConfig, type Config } from '../src/config.js';
import { openDatabase, type DB } from '../src/db/index.js';
import { upsertAccount, type TxInput } from '../src/db/repo.js';
import { localDateOf } from '../src/lib/time.js';
import type { PushMessage, PushSender } from '../src/services/notifier.js';

export const TEST_TOKEN = 'test-token-0123456789-abcdefghijklmnopqrstuvwxyz';

export function makeConfig(env: Record<string, string> = {}): Config {
  return loadConfig({ APP_TOKEN: TEST_TOKEN, MOCK_MODE: 'true', LOG_LEVEL: 'silent', NODE_ENV: 'test', ...env });
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
