import { z } from 'zod';
import type { DB } from '../db/index.js';
import {
  findByFingerprint,
  findUnclaimedOfficial,
  getTransactionByExternalId,
  listAccounts,
  PROVISIONAL,
  setFingerprint,
  totalBalance,
  upsertTransaction,
  type NotificationRow,
} from '../db/repo.js';
import { addDays, localDateOf } from '../lib/time.js';
import type { Notifier } from './notifier.js';
import { transactionNotificationText } from './notifier.js';
import type { Settings } from './settings.js';

/**
 * Evento enviado pelo app quando ele lê, no próprio celular, a notificação do app do banco
 * (ex.: "Você recebeu um Pix de R$ 1.800,00 de João Silva"). Chega em segundos, ao contrário
 * do agregador. Vira uma transação PROVISÓRIA até o agregador entregar a oficial.
 */
export const BankNotificationSchema = z
  .object({
    /** SHA-256 (hex) calculado no aparelho a partir do pacote, chave, horário e texto da notificação. */
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    amountCents: z
      .number()
      .int()
      .refine((v) => v !== 0, 'valor não pode ser zero')
      .refine((v) => Math.abs(v) <= 10_000_000_000, 'valor fora do limite'),
    counterpart: z.string().trim().min(1).max(120).nullish(),
    method: z.enum(['PIX', 'TED', 'CARTAO', 'TRANSFERENCIA_MESMA_INSTITUICAO', 'BOLETO']).nullish(),
    occurredAt: z.iso.datetime({ offset: true }),
    /** true quando o app já mostrou o aviso localmente (servidor estava fora do ar). */
    alreadyNotified: z.boolean().default(false),
  })
  .strict();
export type BankNotificationInput = z.infer<typeof BankNotificationSchema>;

export const PROVISIONAL_PREFIX = 'notif:';
/** Aceita eventos de até 72 h atrás (o app reenvia o que ficou na fila sem rede). */
const MAX_AGE_MS = 72 * 3600_000;
const MAX_FUTURE_MS = 5 * 60_000;

export type BankNotificationResult =
  | { status: 'created'; notification: NotificationRow | null; balanceCents: number }
  | { status: 'duplicate'; balanceCents: number }
  | { status: 'already_confirmed'; balanceCents: number }
  | { status: 'rejected'; reason: string };

function description(amountCents: number, method: string | null | undefined): string {
  if (method === 'PIX') return amountCents > 0 ? 'Pix recebido' : 'Pix enviado';
  if (method === 'TED') return amountCents > 0 ? 'TED recebida' : 'TED enviada';
  if (method === 'CARTAO') return 'Compra no débito';
  if (method === 'BOLETO') return 'Pagamento de boleto';
  if (method === 'TRANSFERENCIA_MESMA_INSTITUICAO') return amountCents > 0 ? 'Transferência recebida' : 'Transferência enviada';
  return amountCents > 0 ? 'Entrada' : 'Saída';
}

export async function handleBankNotification(
  db: DB,
  notifier: Notifier,
  input: BankNotificationInput,
  settings: Settings,
  now: Date,
): Promise<BankNotificationResult> {
  const t = Date.parse(input.occurredAt);
  if (t > now.getTime() + MAX_FUTURE_MS) return { status: 'rejected', reason: 'horário no futuro' };
  if (t < now.getTime() - MAX_AGE_MS) return { status: 'rejected', reason: 'evento antigo demais' };

  const nowIso = now.toISOString();
  const occurredAt = new Date(t).toISOString();
  const localDate = localDateOf(occurredAt);
  const externalId = `${PROVISIONAL_PREFIX}${input.fingerprint}`;

  type Outcome = { kind: 'duplicate' } | { kind: 'confirmed' } | { kind: 'created' } | { kind: 'no_account' };
  const outcome = db.transaction((): Outcome => {
    // 1) a mesma notificação já foi processada (ou já foi substituída pela oficial)
    if (getTransactionByExternalId(db, externalId) || findByFingerprint(db, input.fingerprint)) {
      return { kind: 'duplicate' };
    }
    // 2) o agregador chegou antes: vincula à oficial e não cria nada
    const official = findUnclaimedOfficial(
      db,
      input.amountCents,
      addDays(localDate, -1),
      addDays(localDate, 1),
      occurredAt,
      new Date(now.getTime() - MAX_AGE_MS).toISOString(),
    );
    if (official) {
      setFingerprint(db, official.id, input.fingerprint);
      return { kind: 'confirmed' };
    }
    // 3) cria a provisória na conta principal
    const account = listAccounts(db)[0];
    if (!account) return { kind: 'no_account' };
    const r = upsertTransaction(
      db,
      {
        externalId,
        accountId: account.id,
        occurredAt,
        localDate,
        hasTime: true,
        amountCents: input.amountCents,
        description: description(input.amountCents, input.method),
        counterpart: input.counterpart ?? null,
        method: input.method ?? null,
        category: null,
        status: PROVISIONAL,
      },
      nowIso,
    );
    setFingerprint(db, r.id, input.fingerprint);
    return { kind: 'created' };
  })();

  const balanceCents = totalBalance(db).balanceCents;
  if (outcome.kind === 'duplicate') return { status: 'duplicate', balanceCents };
  if (outcome.kind === 'confirmed') return { status: 'already_confirmed', balanceCents };
  if (outcome.kind === 'no_account') return { status: 'rejected', reason: 'nenhuma conta sincronizada ainda' };

  // notificação do Tony (com o saldo já incluindo esta transação)
  let notification: NotificationRow | null = null;
  const wants = input.amountCents > 0 ? settings.notifyIncoming : settings.notifyOutgoing;
  if (!input.alreadyNotified && wants) {
    const threshold = settings.bigOutflowThresholdCents;
    const big = threshold > 0 && input.amountCents < 0 && -input.amountCents >= threshold;
    const text = transactionNotificationText(
      {
        amountCents: input.amountCents,
        method: input.method,
        counterpart: input.counterpart,
        description: description(input.amountCents, input.method),
      },
      balanceCents,
      { big },
    );
    notification =
      (await notifier.notify({
        dedupeKey: `tx:${externalId}`,
        kind: big ? 'out_big' : text.kind,
        title: text.title,
        body: text.body,
        target: 'home',
      })) ?? null;
  }
  return { status: 'created', notification, balanceCents };
}
