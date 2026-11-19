import type { FastifyBaseLogger } from 'fastify';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from '../config.js';
import { getMeta, openDatabase, setMeta, type DB } from '../db/index.js';
import { expireProvisionals, sumRange, totalBalance } from '../db/repo.js';
import { localMinutesOfDay, todayLocal } from '../lib/time.js';
import { MockBank } from '../services/mock/mock.js';
import { Notifier, summaryNotificationText, type PushSender } from '../services/notifier.js';
import type { PluggyClient } from '../services/pluggy/client.js';
import { PluggySync } from '../services/pluggy/sync.js';
import { getSettings, type Settings } from '../services/settings.js';
import type { Directory } from './directory.js';

/** Tudo que pertence a um usuário: o banco dele, o notificador e o sincronizador. */
export class UserRuntime {
  readonly notifier: Notifier;
  readonly mock?: MockBank;
  readonly sync?: PluggySync;
  /** itemIds da Pluggy deste usuário (a mesma referência é usada pelo sincronizador e pelo webhook). */
  readonly itemIds: string[];

  constructor(
    readonly userId: string,
    readonly db: DB,
    private readonly cfg: {
      config: Config;
      push: PushSender;
      log: FastifyBaseLogger;
      now: () => Date;
      client?: PluggyClient;
      itemIds: string[];
    },
  ) {
    this.itemIds = cfg.itemIds;
    this.notifier = new Notifier(db, cfg.push, cfg.log, cfg.now);
    if (cfg.config.MOCK_MODE) {
      this.mock = new MockBank(db, this.notifier);
    } else if (cfg.client) {
      this.sync = new PluggySync({
        db,
        client: cfg.client,
        notifier: this.notifier,
        log: cfg.log,
        itemIds: this.itemIds,
        now: cfg.now,
        settings: () => this.settings(),
        maxAgeHours: cfg.config.NOTIFY_MAX_AGE_HOURS,
      });
    }
  }

  settings(): Settings {
    return getSettings(this.db, this.cfg.config);
  }

  /** Uma rodada de sincronização (mock ou Pluggy). */
  async syncOnce(): Promise<void> {
    const { config, now, log } = this.cfg;
    if (this.mock) {
      await this.mock.tick(now(), this.settings(), config.NOTIFY_MAX_AGE_HOURS);
      setMeta(this.db, 'last_sync_at', now().toISOString());
    } else if (this.sync && this.itemIds.length > 0) {
      await this.sync.syncAll();
      // provisória que o agregador nunca confirmou deixa de contar no saldo
      const cutoff = new Date(now().getTime() - config.PROVISIONAL_TTL_HOURS * 3600_000).toISOString();
      const expired = expireProvisionals(this.db, cutoff, now().toISOString());
      if (expired > 0) log.warn({ expired }, 'provisórias expiradas sem confirmação do agregador');
    }
  }

  /** Verifica e envia o resumo diário, se for a hora. */
  async dailySummaryTick(): Promise<boolean> {
    const s = this.settings();
    if (!s.dailySummaryEnabled) return false;
    const t = this.cfg.now();
    const today = todayLocal(t);
    const [hh, mm] = s.dailySummaryTime.split(':').map(Number) as [number, number];
    const target = hh * 60 + mm;
    const minutes = localMinutesOfDay(t);
    // envia na primeira verificação dentro de 1h após o horário (cobre reinícios)
    if (minutes < target || minutes > target + 60) return false;
    if (getMeta(this.db, 'summary_sent_date') === today) return false;
    const totals = sumRange(this.db, { from: today, to: today });
    const text = summaryNotificationText({
      inCents: totals.inCents,
      outCents: totals.outCents,
      balanceCents: totalBalance(this.db).balanceCents,
    });
    await this.notifier.notify({ dedupeKey: `summary:${today}`, kind: 'summary', ...text, target: 'home' });
    setMeta(this.db, 'summary_sent_date', today);
    return true;
  }
}

export interface RuntimeDeps {
  config: Config;
  directory: Directory;
  push: PushSender;
  log: FastifyBaseLogger;
  now: () => Date;
  client?: PluggyClient;
}

/** Abre (e guarda em cache) o runtime de cada usuário. Um arquivo SQLite por usuário: isolamento total. */
export class UserRuntimes {
  private readonly cache = new Map<string, UserRuntime>();

  constructor(private readonly d: RuntimeDeps) {}

  private get inMemory(): boolean {
    return this.d.config.DATA_DIR === ':memory:';
  }

  private dbPath(userId: string): string {
    return this.inMemory ? ':memory:' : join(this.d.config.DATA_DIR, 'users', `${userId}.db`);
  }

  get(userId: string): UserRuntime {
    let rt = this.cache.get(userId);
    if (!rt) {
      const itemIds = this.d.directory
        .itemsOf(userId)
        .filter((i) => i.kind === 'pluggy')
        .map((i) => i.item_id);
      rt = new UserRuntime(userId, openDatabase(this.dbPath(userId)), { ...this.d, itemIds });
      this.cache.set(userId, rt);
    }
    return rt;
  }

  /** Apaga todos os dados financeiros do usuário (arquivo e cache). */
  wipe(userId: string): void {
    const rt = this.cache.get(userId);
    rt?.db.close();
    this.cache.delete(userId);
    if (!this.inMemory) {
      for (const suffix of ['', '-wal', '-shm']) rmSync(`${this.dbPath(userId)}${suffix}`, { force: true });
    }
  }

  closeAll(): void {
    for (const rt of this.cache.values()) rt.db.close();
    this.cache.clear();
  }
}
