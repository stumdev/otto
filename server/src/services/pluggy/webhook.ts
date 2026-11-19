import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import type { DB } from '../../db/index.js';
import { recordWebhookEvent } from '../../db/repo.js';
import { bearerToken, safeEqual, verifyPluggySignature } from '../../lib/crypto.js';
import { todayLocal } from '../../lib/time.js';
import type { Notifier } from '../notifier.js';
import type { PluggySync } from './sync.js';

export const WebhookPayloadSchema = z
  .object({
    event: z.string().max(100),
    eventId: z.string().max(200).optional(),
    clientId: z.string().max(200).optional(),
    itemId: z.string().max(200).optional(),
    accountId: z.string().max(200).optional(),
    transactionIds: z.array(z.string().max(200)).max(5000).optional(),
    error: z.object({ code: z.string().optional(), message: z.string().optional() }).passthrough().nullish(),
  })
  .passthrough();
export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;

export interface WebhookAuthConfig {
  signingSecrets: string[]; // atual e anterior (rotação)
  headerSecret?: string;
  rotating: boolean;
}

export type AuthOutcome = { ok: true } | { ok: false; status: 401 | 503 };

/**
 * Camadas de https://docs.pluggy.ai/docs/developer-tools/webhook-security:
 *  - assinatura HMAC (X-Pluggy-Signature) sobre o corpo bruto, se houver signing secret;
 *  - cabeçalho secreto (Authorization: Bearer ...), se configurado no POST /webhooks.
 * Todas as camadas configuradas precisam passar. Sem nenhuma configurada, recusamos tudo:
 * nesse caso o polling periódico cobre a sincronização.
 * Em rotação de segredo, respondemos 503 (a Pluggy tenta de novo) em vez de 401 (não tenta).
 */
export function authenticateWebhook(
  cfg: WebhookAuthConfig,
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
  nowSeconds?: number,
): AuthOutcome {
  const fail: AuthOutcome = { ok: false, status: cfg.rotating ? 503 : 401 };
  if (cfg.signingSecrets.length === 0 && !cfg.headerSecret) return { ok: false, status: 401 };
  if (cfg.signingSecrets.length > 0) {
    const sig = headers['x-pluggy-signature'];
    if (!verifyPluggySignature(rawBody, Array.isArray(sig) ? sig[0] : sig, cfg.signingSecrets, nowSeconds)) return fail;
  }
  if (cfg.headerSecret) {
    const auth = headers['authorization'];
    const token = bearerToken(Array.isArray(auth) ? auth[0] : auth);
    if (!token || !safeEqual(token, cfg.headerSecret)) return fail;
  }
  return { ok: true };
}

export interface WebhookDeps {
  db: DB;
  sync: PluggySync;
  notifier: Notifier;
  log: FastifyBaseLogger;
  clientId: string;
  itemIds: string[];
  now: () => Date;
}

/**
 * Processa um evento já autenticado. A notificação é só um sinal: buscamos os dados
 * de novo na API com a nossa chave antes de agir.
 */
export async function processWebhook(d: WebhookDeps, p: WebhookPayload): Promise<string> {
  if (p.clientId && p.clientId !== d.clientId) return 'ignorado: clientId de outra aplicação';
  if (p.itemId && !d.itemIds.includes(p.itemId)) return 'ignorado: item não configurado';
  if (p.eventId && !recordWebhookEvent(d.db, p.eventId, p.event, d.now().toISOString())) {
    return 'ignorado: evento repetido';
  }

  switch (p.event) {
    case 'transactions/created':
    case 'item/updated':
    case 'item/created':
    case 'item/login_succeeded':
      if (p.itemId) await d.sync.syncItem(p.itemId);
      else await d.sync.syncAll();
      return 'sincronizado';
    case 'transactions/updated':
      if (p.accountId && p.transactionIds?.length) {
        await d.sync.refreshTransactions(p.accountId, p.transactionIds);
        return 'transações atualizadas';
      }
      await d.sync.syncAll();
      return 'sincronizado';
    case 'transactions/deleted':
      if (p.transactionIds?.length) await d.sync.deleteTransactions(p.transactionIds);
      return 'transações removidas';
    case 'item/error':
    case 'item/waiting_user_action':
    case 'item/waiting_user_input': {
      const code = p.error?.code ?? p.event;
      d.log.warn({ event: p.event, code }, 'conexão com o banco precisa de atenção');
      await d.notifier.notify({
        dedupeKey: `item:${p.itemId ?? '?'}:${code}:${todayLocal(d.now())}`,
        kind: 'system',
        title: 'Conexão com o banco precisa de atenção',
        body:
          code === 'USER_AUTHORIZATION_EXPIRED'
            ? 'A autorização expirou. Renove no painel da Pluggy para voltar a receber movimentações.'
            : 'O Otto não conseguiu atualizar os dados. Veja o painel da Pluggy.',
        target: 'settings',
      });
      return 'alerta registrado';
    }
    default:
      return 'ignorado: evento não tratado';
  }
}
