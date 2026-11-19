import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '../../db/index.js';
import { getMeta, setMeta } from '../../db/index.js';
import { markTransactionsDeleted, upsertAccount } from '../../db/repo.js';
import { decimalToCents } from '../../lib/money.js';
import { addDays, todayLocal } from '../../lib/time.js';
import { ingestTransactions, type IngestResult } from '../ingest.js';
import type { Notifier } from '../notifier.js';
import type { Settings } from '../settings.js';
import type { PluggyAccount, PluggyClient } from './client.js';
import { mapPluggyTransaction } from './mapping.js';

/** Janela de sobreposição ao buscar novidades: cobre relógios dessincronizados; a dedup evita repetição. */
const OVERLAP_MS = 30 * 60_000;
/** Primeira importação: últimos 90 dias, sem notificar. */
const BASELINE_DAYS = 90;

export interface SyncDeps {
  db: DB;
  client: PluggyClient;
  notifier: Notifier;
  log: FastifyBaseLogger;
  itemIds: string[];
  now: () => Date;
  settings: () => Settings;
  maxAgeHours: number;
}

/** Contas consideradas: só conta corrente/poupança (cartão de crédito está fora de escopo). */
export function isBankAccount(a: PluggyAccount): boolean {
  return a.type === 'BANK';
}

export class PluggySync {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly d: SyncDeps) {}

  /** Serializa as sincronizações (polling e webhooks nunca rodam ao mesmo tempo). */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  syncAll(): Promise<IngestResult> {
    return this.exclusive(async () => {
      const total: IngestResult = { inserted: 0, updated: 0, notified: 0 };
      for (const itemId of this.d.itemIds) {
        const r = await this.syncItemUnlocked(itemId);
        total.inserted += r.inserted;
        total.updated += r.updated;
        total.notified += r.notified;
      }
      setMeta(this.d.db, 'last_sync_at', this.d.now().toISOString());
      return total;
    });
  }

  syncItem(itemId: string): Promise<IngestResult> {
    return this.exclusive(async () => {
      const r = await this.syncItemUnlocked(itemId);
      setMeta(this.d.db, 'last_sync_at', this.d.now().toISOString());
      return r;
    });
  }

  /** transactions/updated: busca pelos ids (até 500 por chamada). */
  refreshTransactions(accountId: string, ids: string[]): Promise<IngestResult> {
    return this.exclusive(async () => {
      const total: IngestResult = { inserted: 0, updated: 0, notified: 0 };
      const accounts = await this.refreshAccounts();
      if (!accounts.some((a) => a.id === accountId)) return total;
      for (let i = 0; i < ids.length; i += 500) {
        const txs = await this.d.client.listTransactions(accountId, { ids: ids.slice(i, i + 500) });
        const r = await this.ingest(txs.map((t) => mapPluggyTransaction(t, accountId)), true);
        total.inserted += r.inserted;
        total.updated += r.updated;
        total.notified += r.notified;
      }
      return total;
    });
  }

  /** transactions/deleted */
  deleteTransactions(ids: string[]): Promise<number> {
    return this.exclusive(async () => {
      const n = markTransactionsDeleted(
        this.d.db,
        ids.map((id) => `pluggy:${id}`),
        this.d.now().toISOString(),
      );
      await this.refreshAccounts();
      return n;
    });
  }

  private async refreshAccounts(): Promise<PluggyAccount[]> {
    const out: PluggyAccount[] = [];
    for (const itemId of this.d.itemIds) out.push(...(await this.upsertAccountsOf(itemId)));
    return out;
  }

  private async upsertAccountsOf(itemId: string): Promise<PluggyAccount[]> {
    const accounts = (await this.d.client.listAccounts(itemId)).filter(isBankAccount);
    const nowIso = this.d.now().toISOString();
    for (const a of accounts) {
      upsertAccount(
        this.d.db,
        {
          id: a.id,
          itemId,
          name: a.marketingName ?? a.name ?? 'Conta',
          // saldo disponível informado pelo banco, convertido para centavos
          balanceCents: decimalToCents(a.balance),
          currency: a.currencyCode,
        },
        nowIso,
      );
    }
    return accounts;
  }

  private async syncItemUnlocked(itemId: string): Promise<IngestResult> {
    const total: IngestResult = { inserted: 0, updated: 0, notified: 0 };
    // 1) saldo primeiro: as notificações mostram o saldo após cada transação
    const accounts = await this.upsertAccountsOf(itemId);
    for (const a of accounts) {
      const startedAt = this.d.now();
      const cursorKey = `pluggy_created_from:${a.id}`;
      const cursor = getMeta(this.d.db, cursorKey);
      let r: IngestResult;
      if (!cursor) {
        const dateFrom = addDays(todayLocal(startedAt), -BASELINE_DAYS);
        const txs = await this.d.client.listTransactions(a.id, { dateFrom });
        r = await this.ingest(txs.map((t) => mapPluggyTransaction(t, a.id)), false);
        this.d.log.info({ count: r.inserted }, 'importação inicial concluída (sem notificações)');
      } else {
        const from = new Date(Date.parse(cursor) - OVERLAP_MS).toISOString();
        const txs = await this.d.client.listTransactions(a.id, { createdAtFrom: from });
        r = await this.ingest(txs.map((t) => mapPluggyTransaction(t, a.id)), true);
      }
      setMeta(this.d.db, cursorKey, startedAt.toISOString());
      total.inserted += r.inserted;
      total.updated += r.updated;
      total.notified += r.notified;
    }
    return total;
  }

  private ingest(txs: ReturnType<typeof mapPluggyTransaction>[], notify: boolean): Promise<IngestResult> {
    return ingestTransactions(this.d.db, this.d.notifier, txs, {
      notify,
      maxAgeHours: this.d.maxAgeHours,
      now: this.d.now(),
      settings: this.d.settings(),
    });
  }
}
