import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '../../db/index.js';
import { getMeta, setMeta } from '../../db/index.js';
import { markTransactionsDeleted, upsertAccount } from '../../db/repo.js';
import {
  markCardTransactionsDeleted,
  pruneInvestments,
  upsertBill,
  upsertCardTransaction,
  upsertCreditCard,
  upsertInvestment,
} from '../../db/wallet.js';
import { decimalToCents } from '../../lib/money.js';
import { addDays, todayLocal } from '../../lib/time.js';
import { addIngestResult, emptyIngestResult, ingestTransactions, type IngestResult } from '../ingest.js';
import type { Notifier } from '../notifier.js';
import type { Settings } from '../settings.js';
import type { PluggyAccount, PluggyClient } from './client.js';
import { mapCardTransaction, mapCreditCard, mapInvestment, mapPluggyTransaction } from './mapping.js';

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
  /** Cartões de crédito vistos na última leitura de contas, por item. */
  private cards = new Map<string, PluggyAccount[]>();

  constructor(private readonly d: SyncDeps) {}

  /** Serializa as sincronizações (polling e webhooks nunca rodam ao mesmo tempo). */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  syncAll(): Promise<IngestResult> {
    return this.exclusive(async () => {
      const total = emptyIngestResult();
      for (const itemId of this.d.itemIds) {
        const r = await this.syncItemUnlocked(itemId);
        addIngestResult(total, r);
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
      const total = emptyIngestResult();
      const accounts = await this.refreshAccounts();
      if ([...this.cards.values()].flat().some((c) => c.id === accountId)) {
        for (let i = 0; i < ids.length; i += 500) {
          const txs = await this.d.client.listTransactions(accountId, { ids: ids.slice(i, i + 500) });
          this.saveCardTransactions(txs.map((t) => mapCardTransaction(t, accountId)));
        }
        return total;
      }
      if (!accounts.some((a) => a.id === accountId)) return total;
      for (let i = 0; i < ids.length; i += 500) {
        const txs = await this.d.client.listTransactions(accountId, { ids: ids.slice(i, i + 500) });
        const r = await this.ingest(txs.map((t) => mapPluggyTransaction(t, accountId)), true);
        addIngestResult(total, r);
      }
      return total;
    });
  }

  /** transactions/deleted */
  deleteTransactions(ids: string[]): Promise<number> {
    return this.exclusive(async () => {
      const keys = ids.map((id) => `pluggy:${id}`);
      const nowIso = this.d.now().toISOString();
      const n = markTransactionsDeleted(this.d.db, keys, nowIso) + markCardTransactionsDeleted(this.d.db, keys, nowIso);
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
    const all = await this.d.client.listAccounts(itemId);
    const accounts = all.filter(isBankAccount);
    const nowIso = this.d.now().toISOString();
    const credit = all.filter((a) => a.type === 'CREDIT');
    for (const c of credit) upsertCreditCard(this.d.db, mapCreditCard(c, itemId), nowIso);
    this.cards.set(itemId, credit);
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
    const total = emptyIngestResult();
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
      addIngestResult(total, r);
    }
    try {
      await this.syncWalletOf(itemId);
    } catch (err) {
      this.d.log.warn({ err: (err as Error).message }, 'falha ao sincronizar cartão/caixinhas (a conta foi sincronizada)');
    }
    return total;
  }

  /** Compras do cartão, faturas e investimentos (caixinhas). */
  private async syncWalletOf(itemId: string): Promise<void> {
    const nowIso = this.d.now().toISOString();
    for (const card of this.cards.get(itemId) ?? []) {
      const startedAt = this.d.now();
      const cursorKey = `pluggy_card_created_from:${card.id}`;
      const cursor = getMeta(this.d.db, cursorKey);
      const txs = cursor
        ? await this.d.client.listTransactions(card.id, { createdAtFrom: new Date(Date.parse(cursor) - OVERLAP_MS).toISOString() })
        : await this.d.client.listTransactions(card.id, { dateFrom: addDays(todayLocal(startedAt), -BASELINE_DAYS) });
      this.saveCardTransactions(txs.map((t) => mapCardTransaction(t, card.id)));
      setMeta(this.d.db, cursorKey, startedAt.toISOString());
      try {
        for (const b of await this.d.client.listBills(card.id)) {
          upsertBill(
            this.d.db,
            {
              id: b.id,
              cardId: card.id,
              dueDate: b.dueDate.slice(0, 10),
              totalCents: decimalToCents(b.totalAmount),
              minimumCents: b.minimumPaymentAmount == null ? null : decimalToCents(b.minimumPaymentAmount),
            },
            nowIso,
          );
        }
      } catch (err) {
        this.d.log.warn({ err: (err as Error).message }, 'faturas indisponíveis para este cartão');
      }
    }
    const investments = await this.d.client.listInvestments(itemId);
    this.d.db.transaction(() => {
      for (const i of investments) upsertInvestment(this.d.db, mapInvestment(i, itemId), nowIso);
      pruneInvestments(this.d.db, itemId, investments.map((i) => i.id));
    })();
  }

  private saveCardTransactions(txs: ReturnType<typeof mapCardTransaction>[]): void {
    const nowIso = this.d.now().toISOString();
    this.d.db.transaction(() => {
      for (const t of txs) upsertCardTransaction(this.d.db, t, nowIso);
    })();
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
