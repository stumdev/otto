import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '../db/index.js';
import {
  deleteDevice,
  insertNotificationOnce,
  listDeviceTokens,
  markPushSent,
  type NotificationRow,
} from '../db/repo.js';
import { formatBRL } from '../lib/money.js';

export interface PushMessage {
  id: number;
  kind: string;
  title: string;
  body: string;
  target: string;
}

export interface PushResult {
  successCount: number;
  invalidTokens: string[];
}

export interface PushSender {
  readonly enabled: boolean;
  send(tokens: string[], msg: PushMessage): Promise<PushResult>;
}

export const disabledPushSender: PushSender = {
  enabled: false,
  send: async () => ({ successCount: 0, invalidTokens: [] }),
};

const METHOD_LABEL: Record<string, string> = {
  PIX: 'Pix',
  TED: 'TED',
  DOC: 'DOC',
  BOLETO: 'Boleto',
  CARTAO: 'Cartão',
  TRANSFERENCIA_MESMA_INSTITUICAO: 'Transferência',
  DEPOSITO: 'Depósito',
  SAQUE: 'Saque',
};

export function methodLabel(method: string | null | undefined): string | undefined {
  return method ? METHOD_LABEL[method] : undefined;
}

/** "Pix de João Silva" / "Pix para Mercado Central" / descrição como fallback. */
export function counterpartLabel(tx: {
  amountCents: number;
  method?: string | null;
  counterpart?: string | null;
  description: string;
}): string {
  const m = methodLabel(tx.method);
  if (tx.counterpart) {
    const prep = tx.amountCents > 0 ? 'de' : 'para';
    return `${m ?? (tx.amountCents > 0 ? 'Recebido' : 'Pago')} ${prep} ${tx.counterpart}`;
  }
  return tx.description;
}

export function transactionNotificationText(
  tx: { amountCents: number; method?: string | null; counterpart?: string | null; description: string },
  balanceCents: number,
  opts: { big?: boolean } = {},
): { title: string; body: string; kind: 'in' | 'out' } {
  const abs = Math.abs(tx.amountCents);
  const kind = tx.amountCents > 0 ? 'in' : 'out';
  const title = kind === 'in' ? `Entrou ${formatBRL(abs)}` : `Saiu ${formatBRL(abs)}`;
  const parts = [counterpartLabel(tx), `Saldo ${formatBRL(balanceCents)}`];
  if (opts.big && kind === 'out') parts.unshift('Saída grande');
  return { title, body: parts.join(' · '), kind };
}

export function summaryNotificationText(t: { inCents: number; outCents: number; balanceCents: number }): {
  title: string;
  body: string;
} {
  return {
    title: 'Resumo do dia',
    body: `Entrou ${formatBRL(t.inCents)} · Saiu ${formatBRL(t.outCents)} · Saldo ${formatBRL(t.balanceCents)}`,
  };
}

export class Notifier {
  constructor(
    private readonly db: DB,
    private readonly push: PushSender,
    private readonly log: FastifyBaseLogger,
    private readonly now: () => Date,
  ) {}

  get pushEnabled(): boolean {
    return this.push.enabled;
  }

  /**
   * Grava na outbox (idempotente pela dedupeKey) e envia push.
   * Se a chave já existe, não faz nada: a mesma transação nunca notifica duas vezes.
   */
  async notify(n: { dedupeKey: string; kind: string; title: string; body: string; target: string }): Promise<
    NotificationRow | undefined
  > {
    const row = insertNotificationOnce(this.db, n, this.now().toISOString());
    if (!row) {
      this.log.debug({ dedupeKey: n.dedupeKey }, 'notificação já enviada, ignorando');
      return undefined;
    }
    await this.deliver(row);
    return row;
  }

  /** Envia push sem gravar na outbox (ex.: teste de notificação). */
  async sendEphemeral(msg: PushMessage): Promise<PushResult> {
    return this.sendToAll(msg);
  }

  private async deliver(row: NotificationRow): Promise<void> {
    if (!this.push.enabled) return; // o app busca pela outbox (GET /v1/notifications)
    try {
      const res = await this.sendToAll({
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        target: row.target,
      });
      if (res.successCount > 0) markPushSent(this.db, row.id, this.now().toISOString());
    } catch (err) {
      // a notificação continua na outbox; o app ainda pode buscá-la
      this.log.warn({ err: (err as Error).message, id: row.id }, 'falha ao enviar push');
    }
  }

  private async sendToAll(msg: PushMessage): Promise<PushResult> {
    const tokens = listDeviceTokens(this.db);
    if (!this.push.enabled || tokens.length === 0) return { successCount: 0, invalidTokens: [] };
    const res = await this.push.send(tokens, msg);
    for (const t of res.invalidTokens) deleteDevice(this.db, t);
    if (res.invalidTokens.length > 0) this.log.info({ removed: res.invalidTokens.length }, 'tokens FCM inválidos removidos');
    return res;
  }
}
