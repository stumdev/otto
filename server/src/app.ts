import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { z } from 'zod';
import { runChat, type ChatDeps } from './ai/chat.js';
import type { FetchLike } from './ai/provider.js';
import type { Config } from './config.js';
import type { DB } from './db/index.js';
import { getMeta, setMeta } from './db/index.js';
import {
  expireProvisionals,
  lastNotificationId,
  listNotificationsAfter,
  listTransactions,
  sumRange,
  totalBalance,
  upsertDevice,
} from './db/repo.js';
import { BankNotificationSchema, handleBankNotification } from './services/bankNotification.js';
import { bearerToken, safeEqual } from './lib/crypto.js';
import { isDateString, localMinutesOfDay, todayLocal } from './lib/time.js';
import { MockBank } from './services/mock/mock.js';
import { disabledPushSender, Notifier, summaryNotificationText, type PushSender } from './services/notifier.js';
import { PluggyClient } from './services/pluggy/client.js';
import { PluggySync } from './services/pluggy/sync.js';
import { authenticateWebhook, processWebhook, WebhookPayloadSchema } from './services/pluggy/webhook.js';
import { getSettings, SettingsPatchSchema, updateSettings } from './services/settings.js';
import { buildSummary, decodeCursor, encodeCursor, toTxDto } from './services/summary.js';

export const VERSION = '1.0.0';

export interface AppOptions {
  config: Config;
  db: DB;
  now?: () => Date;
  push?: PushSender;
  fetchImpl?: FetchLike;
  logger?: FastifyServerOptions['logger'];
  /** Desliga os temporizadores (testes). */
  disableJobs?: boolean;
}

export interface OttoServices {
  notifier: Notifier;
  mock?: MockBank;
  sync?: PluggySync;
  /** Uma rodada de sincronização (mock ou Pluggy). */
  syncOnce(): Promise<void>;
  /** Verifica e envia o resumo diário, se for a hora. */
  dailySummaryTick(): Promise<boolean>;
}

const TxQuery = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  from: z.string().refine(isDateString, 'from deve ser AAAA-MM-DD').optional(),
  to: z.string().refine(isDateString, 'to deve ser AAAA-MM-DD').optional(),
});

const ChatBody = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(40),
});

const DeviceBody = z.object({
  fid: z.string().min(10).max(512),
  platform: z.enum(['android']).default('android'),
});

const NotificationsQuery = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const SimulateBody = z
  .object({
    direction: z.enum(['in', 'out']).optional(),
    amountCents: z.number().int().min(1).max(100_000_000).optional(),
  })
  .default({});

/** Quantas mensagens de histórico vão para a IA (as mais recentes). */
const CHAT_HISTORY_LIMIT = 12;

export async function buildApp(opts: AppOptions): Promise<{ app: FastifyInstance; services: OttoServices }> {
  const { config, db } = opts;
  const now = opts.now ?? (() => new Date());

  const app = Fastify({
    logger: opts.logger ?? {
      level: config.LOG_LEVEL,
      // nunca registrar segredos
      redact: ['req.headers.authorization', 'req.headers["x-pluggy-signature"]'],
    },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 256 * 1024,
  });

  const notifier = new Notifier(db, opts.push ?? disabledPushSender, app.log, now);
  const settings = () => getSettings(db, config);

  let mock: MockBank | undefined;
  let sync: PluggySync | undefined;
  if (config.MOCK_MODE) {
    mock = new MockBank(db, notifier);
  } else {
    const client = new PluggyClient(
      config.PLUGGY_BASE_URL,
      config.PLUGGY_CLIENT_ID!,
      config.PLUGGY_CLIENT_SECRET!,
      opts.fetchImpl,
    );
    sync = new PluggySync({
      db,
      client,
      notifier,
      log: app.log,
      itemIds: config.pluggyItemIds,
      now,
      settings,
      maxAgeHours: config.NOTIFY_MAX_AGE_HOURS,
    });
  }

  const services: OttoServices = {
    notifier,
    mock,
    sync,
    async syncOnce() {
      if (mock) {
        await mock.tick(now(), settings(), config.NOTIFY_MAX_AGE_HOURS);
        setMeta(db, 'last_sync_at', now().toISOString());
      } else if (sync) {
        await sync.syncAll();
        // no modo real, provisória que o agregador nunca confirmou deixa de contar no saldo
        const cutoff = new Date(now().getTime() - config.PROVISIONAL_TTL_HOURS * 3600_000).toISOString();
        const expired = expireProvisionals(db, cutoff, now().toISOString());
        if (expired > 0) app.log.warn({ expired }, 'provisórias expiradas sem confirmação do agregador');
      }
    },
    async dailySummaryTick() {
      const s = settings();
      if (!s.dailySummaryEnabled) return false;
      const t = now();
      const today = todayLocal(t);
      const [hh, mm] = s.dailySummaryTime.split(':').map(Number) as [number, number];
      const target = hh * 60 + mm;
      const minutes = localMinutesOfDay(t);
      // envia na primeira verificação dentro de 1h após o horário (cobre reinícios)
      if (minutes < target || minutes > target + 60) return false;
      if (getMeta(db, 'summary_sent_date') === today) return false;
      const totals = sumRange(db, { from: today, to: today });
      const text = summaryNotificationText({
        inCents: totals.inCents,
        outCents: totals.outCents,
        balanceCents: totalBalance(db).balanceCents,
      });
      await notifier.notify({ dedupeKey: `summary:${today}`, kind: 'summary', ...text, target: 'home' });
      setMeta(db, 'summary_sent_date', today);
      return true;
    },
  };

  await app.register(helmet, { contentSecurityPolicy: false });
  // CORS fechado: nenhuma origem de navegador é autorizada (o app Android não usa CORS)
  await app.register(cors, { origin: false });
  await app.register(rateLimit, { global: true, max: 120, timeWindow: '1 minute' });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof z.ZodError) {
      return reply.status(400).send({ error: 'requisição inválida', details: err.issues.map((i) => i.message) });
    }
    const e = err as { statusCode?: number; message?: string };
    const status = e.statusCode && e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 500;
    if (status >= 500) req.log.error({ err: e.message }, 'erro interno');
    return reply.status(status).send({ error: status >= 500 ? 'erro interno' : (e.message ?? 'erro') });
  });

  // ---------- público ----------
  app.get('/health', async () => ({ status: 'ok', version: VERSION, mode: config.MOCK_MODE ? 'mock' : 'real' }));

  // ---------- webhook Pluggy (autenticado por assinatura/segredo, não pelo token do app) ----------
  await app.register(async (scope) => {
    // precisamos do corpo bruto para verificar a assinatura HMAC
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

    scope.post('/v1/webhooks/pluggy', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (req, reply) => {
      if (!sync) return reply.status(404).send({ error: 'webhooks desativados no modo mock' });
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
      const auth = authenticateWebhook(
        {
          signingSecrets: [config.PLUGGY_WEBHOOK_SIGNING_SECRET, config.PLUGGY_WEBHOOK_SIGNING_SECRET_PREVIOUS].filter(
            (s): s is string => !!s,
          ),
          headerSecret: config.PLUGGY_WEBHOOK_HEADER_SECRET,
          rotating: config.PLUGGY_WEBHOOK_ROTATING,
        },
        raw,
        req.headers,
      );
      if (!auth.ok) {
        req.log.warn('webhook recusado: autenticação falhou');
        return reply.status(auth.status).send({ error: 'não autorizado' });
      }
      let payload;
      try {
        payload = WebhookPayloadSchema.parse(JSON.parse(raw.toString('utf8')));
      } catch {
        // 2xx para não gerar novas tentativas de um corpo que nunca será válido
        return reply.status(202).send({ ok: true, ignored: true });
      }
      // responde já (a Pluggy exige 2xx em até 10s) e processa em seguida
      reply.status(202).send({ ok: true });
      const deps = {
        db,
        sync,
        notifier,
        log: req.log,
        clientId: config.PLUGGY_CLIENT_ID!,
        itemIds: config.pluggyItemIds,
        now,
      };
      setImmediate(() => {
        processWebhook(deps, payload)
          .then((r) => req.log.info({ event: payload.event, result: r }, 'webhook processado'))
          .catch((err: Error) => req.log.error({ event: payload.event, err: err.message }, 'falha ao processar webhook'));
      });
      return reply;
    });
  });

  // ---------- API do app (Bearer token) ----------
  await app.register(async (api) => {
    api.addHook('onRequest', async (req, reply) => {
      const token = bearerToken(req.headers.authorization);
      if (!token || !safeEqual(token, config.APP_TOKEN)) {
        return reply.status(401).send({ error: 'não autorizado' });
      }
    });

    api.get('/v1/status', async () => ({
      mode: config.MOCK_MODE ? 'mock' : 'real',
      pushEnabled: notifier.pushEnabled,
      ai: config.aiProviders.length ? 'ai' : 'offline',
      aiProviders: config.aiProviders.map((p) => p.name),
      lastSyncAt: getMeta(db, 'last_sync_at') ?? null,
      lastNotificationId: lastNotificationId(db),
      version: VERSION,
    }));

    api.get('/v1/summary', async () => buildSummary(db, now()));

    api.get('/v1/transactions', async (req) => {
      const q = TxQuery.parse(req.query);
      const cursor = q.cursor ? decodeCursor(q.cursor) : undefined;
      if (q.cursor && !cursor) throw Object.assign(new Error('cursor inválido'), { statusCode: 400 });
      const rows = listTransactions(db, { limit: q.limit + 1, cursor, range: { from: q.from, to: q.to } });
      const page = rows.slice(0, q.limit);
      const last = page[page.length - 1];
      return {
        items: page.map(toTxDto),
        nextCursor: rows.length > q.limit && last ? encodeCursor(last) : null,
      };
    });

    api.post('/v1/sync', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async () => {
      await services.syncOnce();
      return { ok: true, lastSyncAt: getMeta(db, 'last_sync_at') ?? null };
    });

    // notificação do app do banco lida no celular -> transação provisória + aviso imediato
    api.post('/v1/events/bank-notification', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
      const body = BankNotificationSchema.parse(req.body);
      const r = await handleBankNotification(db, notifier, body, settings(), now());
      if (r.status === 'rejected') return reply.status(422).send({ error: r.reason });
      const n = r.status === 'created' ? r.notification : null;
      return {
        ok: true,
        status: r.status,
        balanceCents: r.balanceCents,
        notification: n ? { id: n.id, kind: n.kind, title: n.title, body: n.body, target: n.target } : null,
      };
    });

    api.post('/v1/devices', async (req) => {
      const b = DeviceBody.parse(req.body);
      upsertDevice(db, b.fid, b.platform, now().toISOString());
      return { ok: true, pushEnabled: notifier.pushEnabled };
    });

    api.post('/v1/devices/test', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async () => {
      if (!notifier.pushEnabled) return { ok: true, push: false };
      const r = await notifier.sendEphemeral({
        id: 0,
        kind: 'test',
        title: 'Notificação de teste',
        body: 'Se você está vendo isto, o push do Otto está funcionando.',
        target: 'settings',
      });
      return { ok: true, push: true, delivered: r.successCount };
    });

    api.get('/v1/notifications', async (req) => {
      const q = NotificationsQuery.parse(req.query);
      const rows = listNotificationsAfter(db, q.after, q.limit);
      return {
        items: rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, target: r.target, createdAt: r.created_at })),
        lastId: lastNotificationId(db),
      };
    });

    api.get('/v1/settings', async () => settings());

    api.put('/v1/settings', async (req) => {
      const patch = SettingsPatchSchema.parse(req.body);
      return updateSettings(db, config, patch);
    });

    api.post('/v1/chat', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
      const body = ChatBody.parse(req.body);
      const turns = body.messages.slice(-CHAT_HISTORY_LIMIT);
      const abort = new AbortController();
      // Cancela a IA só se o CLIENTE desconectar antes do fim. Atenção: o 'close' da requisição
      // (req.raw) dispara assim que o corpo foi lido — não serve para isso. O da resposta, sim.
      reply.raw.on('close', () => {
        if (!reply.raw.writableEnded) abort.abort();
      });

      reply.hijack();
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      const send = (event: string, data: unknown) => {
        if (!reply.raw.writableEnded) reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      const deps: ChatDeps = {
        db,
        providers: config.aiProviders,
        log: req.log,
        now,
        timeoutMs: config.AI_TIMEOUT_MS,
        maxRetries: config.AI_MAX_RETRIES,
        fetchImpl: opts.fetchImpl,
        offlineChunkDelayMs: 18,
      };
      try {
        for await (const ev of runChat(deps, turns, abort.signal)) send(ev.event, ev.data);
      } catch (err) {
        req.log.error({ err: (err as Error).message }, 'falha no chat');
        send('error', { message: 'Não consegui responder agora. Tente de novo.' });
      } finally {
        if (!reply.raw.writableEnded) reply.raw.end();
      }
    });

    if (mock) {
      const m = mock;
      api.post('/v1/dev/simulate', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
        const b = SimulateBody.parse(req.body ?? {});
        const direction = b.direction ?? (Math.random() < 0.5 ? 'in' : 'out');
        const { tx, result } = await m.simulate(now(), settings(), direction, b.amountCents);
        setMeta(db, 'last_sync_at', now().toISOString());
        const row = result.notified > 0 ? listNotificationsAfter(db, lastNotificationId(db) - 1, 1)[0] : undefined;
        return {
          ok: true,
          transaction: { amountCents: tx.amountCents, counterpart: tx.counterpart },
          notified: result.notified > 0,
          notification: row ? { id: row.id, title: row.title, body: row.body, kind: row.kind } : null,
          balanceCents: totalBalance(db).balanceCents,
        };
      });
    }
  });

  // ---------- jobs ----------
  if (!opts.disableJobs) {
    const runSync = () =>
      services.syncOnce().catch((err: Error) => app.log.error({ err: err.message }, 'falha na sincronização'));
    const runSummary = () =>
      services.dailySummaryTick().catch((err: Error) => app.log.error({ err: err.message }, 'falha no resumo diário'));
    const syncTimer = setInterval(runSync, config.SYNC_INTERVAL_MINUTES * 60_000);
    const summaryTimer = setInterval(runSummary, 30_000);
    syncTimer.unref();
    summaryTimer.unref();
    app.addHook('onReady', async () => {
      void runSync();
    });
    app.addHook('onClose', async () => {
      clearInterval(syncTimer);
      clearInterval(summaryTimer);
    });
  }

  return { app, services };
}
