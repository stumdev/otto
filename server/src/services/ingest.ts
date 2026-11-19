import type { DB } from '../db/index.js';
import {
  deleteTransactionRow,
  findProvisionalMatch,
  getTransactionByExternalId,
  setFingerprint,
  totalBalance,
  upsertTransaction,
  type TxInput,
} from '../db/repo.js';
import { addDays } from '../lib/time.js';
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
  /** Transações oficiais novas que confirmaram uma provisória (já avisada pela leitura do celular). */
  matched: number;
}

export const emptyIngestResult = (): IngestResult => ({ inserted: 0, updated: 0, notified: 0, matched: 0 });

export function addIngestResult(total: IngestResult, r: IngestResult): void {
  total.inserted += r.inserted;
  total.updated += r.updated;
  total.notified += r.notified;
  total.matched += r.matched;
}

/**
 * Grava transações de forma idempotente (chave externalId) e notifica só as novas.
 * Pré-condição: o saldo das contas já foi atualizado (inclui estas transações).
 * O saldo mostrado em cada notificação é o saldo logo após aquela transação,
 * reconstruído a partir do saldo atual.
 *
 * Uma transação oficial nova com o mesmo valor (e sinal) de uma provisória em até ±1 dia
 * substitui a provisória e NÃO gera nova notificação.
 */
export async function ingestTransactions(
  db: DB,
  notifier: Notifier,
  txs: TxInput[],
  opts: IngestOptions,
): Promise<IngestResult> {
  const nowIso = opts.now.toISOString();
  const fresh: TxInput[] = [];
  const matched = new Set<string>();
  let updated = 0;

  db.transaction(() => {
    opts.inTransaction?.();
    for (const tx of txs) {
      let fingerprint: string | null = null;
      if (tx.amountCents !== 0 && !getTransactionByExternalId(db, tx.externalId)) {
        const prov = findProvisionalMatch(
          db,
          tx.amountCents,
          addDays(tx.localDate, -1),
          addDays(tx.localDate, 1),
          tx.occurredAt,
        );
        if (prov) {
          fingerprint = prov.source_fingerprint;
          deleteTransactionRow(db, prov.id);
          matched.add(tx.externalId);
        }
      }
      const r = upsertTransaction(db, tx, nowIso);
      if (fingerprint) setFingerprint(db, r.id, fingerprint);
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
      if (matched.has(tx.externalId)) continue; // já avisada quando a notificação do banco chegou
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
  return { inserted: fresh.length, updated, notified, matched: matched.size };
}
