import type { DB } from '../db/index.js';
import { totalBalance, upsertTransaction, type TxInput } from '../db/repo.js';
import type { Notifier } from './notifier.js';
import { transactionNotificationText } from './notifier.js';
import type { Settings } from './settings.js';

export interface IngestOptions {
  /** Quando false (ex.: primeira importação do histórico), grava sem notificar. */
  notify: boolean;
  /** Só notifica transações ocorridas há no máximo N horas. */
  maxAgeHours: number;
  now: Date;
  settings: Settings;
  /** Executado dentro da mesma transação SQL dos inserts (ex.: ajustar saldo do mock). */
  inTransaction?: () => void;
}

export interface IngestResult {
  inserted: number;
  updated: number;
  notified: number;
}

/**
 * Grava transações de forma idempotente (chave externalId) e notifica só as novas.
 * Pré-condição: o saldo das contas já foi atualizado (inclui estas transações).
 * O saldo mostrado em cada notificação é o saldo logo após aquela transação,
 * reconstruído a partir do saldo atual da conta.
 */
export async function ingestTransactions(
  db: DB,
  notifier: Notifier,
  txs: TxInput[],
  opts: IngestOptions,
): Promise<IngestResult> {
  const nowIso = opts.now.toISOString();
  const fresh: TxInput[] = [];
  let updated = 0;

  db.transaction(() => {
    opts.inTransaction?.();
    for (const tx of txs) {
      const r = upsertTransaction(db, tx, nowIso);
      if (r.inserted) fresh.push(tx);
      else updated++;
    }
  })();

  let notified = 0;
  if (opts.notify && fresh.length > 0) {
    const minTime = opts.now.getTime() - opts.maxAgeHours * 3600_000;
    const balanceNow = totalBalance(db).balanceCents;
    // ordena da mais antiga para a mais nova e calcula o saldo após cada uma
    const ordered = [...fresh].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    let laterSum = ordered.reduce((s, t) => s + t.amountCents, 0);
    for (const tx of ordered) {
      laterSum -= tx.amountCents;
      const balanceAfter = balanceNow - laterSum;
      if (Date.parse(tx.occurredAt) < minTime) continue;
      if (tx.amountCents > 0 && !opts.settings.notifyIncoming) continue;
      if (tx.amountCents < 0 && !opts.settings.notifyOutgoing) continue;
      if (tx.amountCents === 0) continue;
      const threshold = opts.settings.bigOutflowThresholdCents; // 0 = alerta desligado
      const big = threshold > 0 && tx.amountCents < 0 && -tx.amountCents >= threshold;
      const text = transactionNotificationText(tx, balanceAfter, { big });
      const row = await notifier.notify({
        dedupeKey: `tx:${tx.externalId}`,
        kind: big ? 'out_big' : text.kind,
        title: text.title,
        body: text.body,
        target: 'home',
      });
      if (row) notified++;
    }
  }
  return { inserted: fresh.length, updated, notified };
}
