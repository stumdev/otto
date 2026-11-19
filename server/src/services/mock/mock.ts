import type { DB } from '../../db/index.js';
import { getMeta, setMeta } from '../../db/index.js';
import { adjustBalance, getTransactionByExternalId, listAccounts, upsertAccount, type TxInput } from '../../db/repo.js';
import { ingestTransactions, type IngestResult } from '../ingest.js';
import type { Notifier } from '../notifier.js';
import type { Settings } from '../settings.js';
import { generateMockRange, MOCK_ACCOUNT_ID, MOCK_ACCOUNT_NAME, simulatedPix } from './generator.js';
import { refreshMockWallet } from './wallet.js';

const META_UNTIL = 'mock_generated_until';

/**
 * Modo mock: o saldo da conta é SEMPRE a soma das transações gravadas.
 * - Primeira execução: cria ~60 dias de histórico (sem notificar).
 * - A cada sincronização: gera o que "aconteceu" desde a última vez (e notifica).
 */
export class MockBank {
  constructor(
    private readonly db: DB,
    private readonly notifier: Notifier,
  ) {}

  ensureAccount(nowIso: string): void {
    if (!listAccounts(this.db).some((a) => a.id === MOCK_ACCOUNT_ID)) {
      upsertAccount(
        this.db,
        { id: MOCK_ACCOUNT_ID, itemId: null, name: MOCK_ACCOUNT_NAME, balanceCents: 0, currency: 'BRL' },
        nowIso,
      );
    }
  }

  async tick(now: Date, settings: Settings, maxAgeHours: number): Promise<IngestResult> {
    const nowIso = now.toISOString();
    this.ensureAccount(nowIso);
    refreshMockWallet(this.db, now);
    const after = getMeta(this.db, META_UNTIL);
    const generated = generateMockRange(now, after);
    const result = await this.apply(generated, { notify: after !== undefined, now, settings, maxAgeHours });
    setMeta(this.db, META_UNTIL, nowIso);
    return result;
  }

  async simulate(
    now: Date,
    settings: Settings,
    direction: 'in' | 'out',
    amountCents?: number,
  ): Promise<{ tx: TxInput; result: IngestResult }> {
    this.ensureAccount(now.toISOString());
    const tx = simulatedPix(now, direction, amountCents);
    // forçamos as notificações de entrada/saída aqui: simular é justamente para ver a notificação
    const result = await this.apply([tx], {
      notify: true,
      now,
      settings: { ...settings, notifyIncoming: true, notifyOutgoing: true },
      maxAgeHours: 1,
    });
    return { tx, result };
  }

  private async apply(
    txs: TxInput[],
    o: { notify: boolean; now: Date; settings: Settings; maxAgeHours: number },
  ): Promise<IngestResult> {
    const nowIso = o.now.toISOString();
    const fresh = txs.filter((t) => !getTransactionByExternalId(this.db, t.externalId));
    const delta = fresh.reduce((s, t) => s + t.amountCents, 0);
    return ingestTransactions(this.db, this.notifier, fresh, {
      inTransaction: () => {
        if (delta !== 0) adjustBalance(this.db, MOCK_ACCOUNT_ID, delta, nowIso);
      },
      notify: o.notify,
      maxAgeHours: o.maxAgeHours,
      now: o.now,
      settings: o.settings,
    });
  }
}
