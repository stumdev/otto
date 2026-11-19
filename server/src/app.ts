import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyServerOptions } from 'fastify';
import { z } from 'zod';
import { runChat, type ChatDeps } from './ai/chat.js';
import type { FetchLike } from './ai/provider.js';
import type { Config } from './config.js';
import { getMeta, setMeta } from './db/index.js';
import {
  lastNotificationId,
  listNotificationsAfter,
  listTransactions,
  totalBalance,
  upsertDevice,
} from './db/repo.js';
import { bearerToken, safeEqual } from './lib/crypto.js';
import { isDateString } from './lib/time.js';
import { connectPageHtml } from './routes/connectPage.js';
import { BankNotificationSchema, handleBankNotification } from './services/bankNotification.js';
import { disabledPushSender, type PushSender } from './services/notifier.js';
import { PluggyClient } from './services/pluggy/client.js';
import { authenticateWebhook, processWebhook, WebhookPayloadSchema } from './services/pluggy/webhook.js';
import { SettingsPatchSchema, updateSettings } from './services/settings.js';
import { buildSummary, decodeCursor, encodeCursor, toTxDto } from './services/summary.js';
import { buildWallet } from './services/wallet.js';
import { Directory, type UserRow } from './users/directory.js';
import { UserRuntimes, type UserRuntime } from './users/runtime.js';

export const VERSION = '2.0.0';

export interface AppOptions {
  config: Config;
  now?: () => Date;
  push?: PushSender;
  fetchImpl?: FetchLike;
  logger?: FastifyServerOptions['logger'];
  /** Desliga os temporizadores (testes). */
  disableJobs?: boolean;
}

export interface OttoServices {
  directory: Directory;
  runtimes: UserRuntimes;
  pluggy?: PluggyClient;
  /** Sincroniza todos os usuários conectados. */
  syncAll(): Promise<void>;
  /** Resumo diário de todos os usuários conectados. */
  dailySummaryTickAll(): Promise<number>;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: UserRow;
    rt?: UserRuntime;
    sessionToken?: string;
  }
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

const RegisterBody = z.object({
  email: z.email().max(200),
  password: z.string().min(8, 'A senha precisa ter pelo menos 8 caracteres.').max(128),
  name: z.string().trim().max(80).optional(),
  signupCode: z.string().max(200).optional(),
});
const LoginBody = z.object({ email: z.string().max(200), password: z.string().min(1).max(128) });
const DeleteAccountBody = z.object({ password: z.string().min(1).max(128) });
const ConnectItemBody = z.object({ itemId: z.string().min(1).max(200).optional() }).default({});

/** Quantas mensagens de histórico vão para a IA (as mais recentes). */
const CHAT_HISTORY_LIMIT = 12;
/** Quanto esperar a primeira importação antes de responder ao app (ela continua em segundo plano). */
const FIRST_SYNC_WAIT_MS = 90_000;

export async function buildApp(opts: AppOptions): Promise<{ app: FastifyInstance; services: OttoServices }> {
  const { config } = opts;
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

  const directory = new Directory(config.DATA_DIR === ':memory:' ? ':memory:' : `${config.DATA_DIR}/directory.db`);
  const pluggy = config.pluggyEnabled
    ? new PluggyClient(config.PLUGGY_BASE_URL, config.PLUGGY_CLIENT_ID!, config.PLUGGY_CLIENT_SECRET!, opts.fetchImpl)
    : undefined;
  const runtimes = new UserRuntimes({
    config,
    directory,
    push: opts.push ?? disabledPushSender,
    log: app.log,
    now,
    client: pluggy,
  });
  const pushEnabled = (opts.push ?? disabledPushSender).enabled;

  let syncing = false;
  const services: OttoServices = {
    directory,
    runtimes,
    pluggy,
    async syncAll() {
      if (syncing) return;
      syncing = true;
      try {
        for (const userId of directory.connectedUserIds()) {
          try {
            await runtimes.get(userId).syncOnce();
          } catch (err) {
            app.log.error({ err: (err as Error).message }, 'falha na sincronização de um usuário');
          }
        }
      } finally {
        syncing = false;
      }
    },
    async dailySummaryTickAll() {
      let sent = 0;
      for (const userId of directory.connectedUserIds()) {
        try {
          if (await runtimes.get(userId).dailySummaryTick()) sent++;
        } catch (err) {
          app.log.error({ err: (err as Error).message }, 'falha no resumo diário de um usuário');
        }
      }
      return sent;
    },
  };

  await app.register(helmet, { contentSecurityPolicy: false });
  // CORS fechado: nenhuma origem de navegador é autorizada (o app Android não usa CORS)
  await app.register(cors, { origin: false });
  await app.register(rateLimit, { global: true, max: 120, timeWindow: '1 minute' });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof z.ZodError) {
      return reply.status(400).send({ error: err.issues[0]?.message ?? 'requisição inválida', details: err.issues.map((i) => i.message) });
    }
    const e = err as { statusCode?: number; message?: string };
    const status = e.statusCode && e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 500;
    if (status >= 500) req.log.error({ err: e.message }, 'erro interno');
    return reply.status(status).send({ error: status >= 500 ? 'erro interno' : (e.message ?? 'erro') });
  });

  const modeName = config.MOCK_MODE ? 'mock' : 'real';

  // ---------- público ----------
  app.get('/health', async () => ({ status: 'ok', version: VERSION, mode: modeName }));

  /** O app consulta isto antes de mostrar o cadastro. */
  app.get('/v1/config', async () => ({ mode: modeName, signupCodeRequired: !!config.SIGNUP_CODE, version: VERSION }));

  app.get('/connect', async (_req, reply) => {
    reply
      .header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer');
    return connectPageHtml(config.PLUGGY_CONNECT_SCRIPT_URL);
  });

  const issueSession = (user: UserRow) => ({
    token: directory.createSession(user.id, now().toISOString()),
    user: { id: user.id, email: user.email, name: user.name },
  });

  app.post('/v1/auth/register', { config: { rateLimit: { max: config.SIGNUP_RATE_PER_HOUR, timeWindow: '1 hour' } } }, async (req, reply) => {
    const b = RegisterBody.parse(req.body);
    if (config.SIGNUP_CODE && !(b.signupCode && safeEqual(b.signupCode.trim(), config.SIGNUP_CODE))) {
      return reply.status(403).send({ error: 'Código de convite inválido.' });
    }
    const user = await directory.createUser(b.email, b.password, b.name || null, now().toISOString());
    if (user === 'exists') return reply.status(409).send({ error: 'Este e-mail já tem uma conta.' });
    return reply.status(201).send(issueSession(user));
  });

  app.post('/v1/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = LoginBody.parse(req.body);
    const user = await directory.checkCredentials(b.email, b.password);
    if (!user) return reply.status(401).send({ error: 'E-mail ou senha incorretos.' });
    return issueSession(user);
  });

  // ---------- webhook Pluggy (autenticado por assinatura/segredo, não pela sessão do app) ----------
  await app.register(async (scope) => {
    // precisamos do corpo bruto para verificar a assinatura HMAC
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

    scope.post('/v1/webhooks/pluggy', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (req, reply) => {
      if (!pluggy) return reply.status(404).send({ error: 'webhooks desativados no modo mock' });
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
      // o item diz de quem são os dados
      const item = payload.itemId ? directory.getItem(payload.itemId) : undefined;
      if (!item || item.kind !== 'pluggy') return reply.status(202).send({ ok: true, ignored: true });
      const rt = runtimes.get(item.user_id);
      if (!rt.sync) return reply.status(202).send({ ok: true, ignored: true });
      // responde já (a Pluggy exige 2xx em até 10s) e processa em seguida
      reply.status(202).send({ ok: true });
      const deps = {
        db: rt.db,
        sync: rt.sync,
        notifier: rt.notifier,
        log: req.log,
        clientId: config.PLUGGY_CLIENT_ID!,
        itemIds: rt.itemIds,
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

  // ---------- API do app (sessão Bearer) ----------
  await app.register(async (api) => {
    api.addHook('onRequest', async (req, reply) => {
      const token = bearerToken(req.headers.authorization);
      const user = token ? directory.resolveSession(token, now(), config.SESSION_IDLE_DAYS) : undefined;
      if (!token || !user) return reply.status(401).send({ error: 'não autorizado' });
      req.user = user;
      req.sessionToken = token;
      req.rt = runtimes.get(user.id);
    });

    const rtOf = (req: FastifyRequest): UserRuntime => req.rt!;

    // ----- conta -----
    api.get('/v1/me', async (req) => ({ id: req.user!.id, email: req.user!.email, name: req.user!.name }));

    api.post('/v1/auth/logout', async (req) => {
      directory.deleteSession(req.sessionToken!);
      return { ok: true };
    });

    /** Exclui a conta e todos os dados (LGPD). Pede a senha de novo. */
    api.delete('/v1/account', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
      const b = DeleteAccountBody.parse(req.body);
      const ok = await directory.checkCredentials(req.user!.email, b.password);
      if (!ok) return reply.status(403).send({ error: 'Senha incorreta.' });
      await dropConnection(req.user!.id, req.log);
      directory.deleteUser(req.user!.id);
      return { ok: true };
    });

    // ----- conexão com o banco -----
    api.get('/v1/connection', async (req) => {
      const items = directory.itemsOf(req.user!.id);
      return {
        connected: items.length > 0,
        mode: modeName,
        items: items.map((i) => ({ itemId: i.item_id, kind: i.kind, connector: i.connector, connectedAt: i.created_at })),
      };
    });

    /** Token curto para o widget Pluggy Connect. No modo mock não há widget: o app usa a conta de demonstração. */
    api.post('/v1/connection/token', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
      if (!pluggy) return { mock: true, connectToken: null };
      try {
        // os webhooks vêm do webhook da aplicação (npm run pluggy:register-webhook), que leva o segredo
        const connectToken = await pluggy.createConnectToken({ clientUserId: req.user!.id });
        return { mock: false, connectToken };
      } catch (err) {
        req.log.error({ err: (err as Error).message }, 'falha ao criar connect token');
        return reply.status(502).send({ error: 'Não foi possível iniciar a conexão com o banco agora.' });
      }
    });

    /** Registra o item criado pelo widget (ou a conta de demonstração) e faz a primeira importação. */
    api.post('/v1/connection/items', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
      const b = ConnectItemBody.parse(req.body ?? {});
      const user = req.user!;
      const rt = rtOf(req);
      let connector: string | null = null;

      if (!pluggy) {
        directory.addItem(`mock:${user.id}`, user.id, 'mock', 'Conta de demonstração', now().toISOString());
      } else {
        if (!b.itemId) return reply.status(400).send({ error: 'itemId obrigatório' });
        let item;
        try {
          item = await pluggy.getItem(b.itemId);
        } catch {
          return reply.status(404).send({ error: 'Conexão não encontrada na Pluggy.' });
        }
        // o item precisa ter sido criado com o connect token DESTE usuário
        if (item.clientUserId !== user.id) return reply.status(403).send({ error: 'Esta conexão não pertence à sua conta.' });
        if (item.status === 'LOGIN_ERROR') {
          return reply.status(422).send({ error: 'O banco recusou a autorização. Tente conectar de novo.' });
        }
        connector = item.connector?.name ?? null;
        if (!directory.addItem(item.id, user.id, 'pluggy', connector, now().toISOString())) {
          return reply.status(409).send({ error: 'Esta conexão já está em outra conta.' });
        }
        if (!rt.itemIds.includes(item.id)) rt.itemIds.push(item.id);
      }

      const first = rt.syncOnce().then(
        () => true,
        (err: Error) => {
          req.log.error({ err: err.message }, 'falha na primeira sincronização');
          return false;
        },
      );
      const timeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), FIRST_SYNC_WAIT_MS).unref());
      const synced = await Promise.race([first, timeout]);
      return { ok: true, connected: true, synced, connector };
    });

    /** Desconecta o banco e apaga os dados importados (a conta do Otto continua). */
    api.delete('/v1/connection', async (req) => {
      await dropConnection(req.user!.id, req.log);
      return { ok: true };
    });

    async function dropConnection(userId: string, log: FastifyRequest['log']): Promise<void> {
      for (const item of directory.itemsOf(userId)) {
        if (item.kind === 'pluggy' && pluggy) {
          try {
            await pluggy.deleteItem(item.item_id); // revoga o consentimento
          } catch (err) {
            log.warn({ err: (err as Error).message }, 'não foi possível remover o item na Pluggy');
          }
        }
      }
      directory.removeItemsOf(userId);
      runtimes.wipe(userId);
    }

    // ----- dados financeiros -----
    api.get('/v1/status', async (req) => {
      const rt = rtOf(req);
      return {
        mode: modeName,
        connected: directory.itemsOf(req.user!.id).length > 0,
        pushEnabled,
        ai: config.aiProviders.length ? 'ai' : 'offline',
        aiProviders: config.aiProviders.map((p) => p.name),
        aiModel: config.aiProviders[0]?.model ?? null,
        lastSyncAt: getMeta(rt.db, 'last_sync_at') ?? null,
        lastNotificationId: lastNotificationId(rt.db),
        version: VERSION,
      };
    });

    api.get('/v1/summary', async (req) => {
      const rt = rtOf(req);
      return buildSummary(rt.db, now(), rt.settings());
    });

    // caixinhas, cartão (fatura, limite, próximas faturas) e compras recentes no cartão
    api.get('/v1/wallet', async (req) => {
      const rt = rtOf(req);
      return buildWallet(rt.db, rt.settings(), now());
    });

    api.get('/v1/transactions', async (req) => {
      const q = TxQuery.parse(req.query);
      const cursor = q.cursor ? decodeCursor(q.cursor) : undefined;
      if (q.cursor && !cursor) throw Object.assign(new Error('cursor inválido'), { statusCode: 400 });
      const rows = listTransactions(rtOf(req).db, { limit: q.limit + 1, cursor, range: { from: q.from, to: q.to } });
      const page = rows.slice(0, q.limit);
      const last = page[page.length - 1];
      return {
        items: page.map(toTxDto),
        nextCursor: rows.length > q.limit && last ? encodeCursor(last) : null,
      };
    });

    api.post('/v1/sync', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req) => {
      const rt = rtOf(req);
      await rt.syncOnce();
      return { ok: true, lastSyncAt: getMeta(rt.db, 'last_sync_at') ?? null };
    });

    // notificação do app do banco lida no celular -> transação provisória + aviso imediato
    api.post('/v1/events/bank-notification', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
      const rt = rtOf(req);
      const body = BankNotificationSchema.parse(req.body);
      const r = await handleBankNotification(rt.db, rt.notifier, body, rt.settings(), now());
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
      upsertDevice(rtOf(req).db, b.fid, b.platform, now().toISOString());
      return { ok: true, pushEnabled };
    });

    api.post('/v1/devices/test', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
      if (!pushEnabled) return { ok: true, push: false };
      const r = await rtOf(req).notifier.sendEphemeral({
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
      const db = rtOf(req).db;
      const rows = listNotificationsAfter(db, q.after, q.limit);
      return {
        items: rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, target: r.target, createdAt: r.created_at })),
        lastId: lastNotificationId(db),
      };
    });

    api.get('/v1/settings', async (req) => rtOf(req).settings());

    api.put('/v1/settings', async (req) => {
      const patch = SettingsPatchSchema.parse(req.body);
      return updateSettings(rtOf(req).db, config, patch);
    });

    api.post('/v1/chat', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
      const rt = rtOf(req);
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
        db: rt.db,
        providers: config.aiProviders,
        log: req.log,
        now,
        timeoutMs: config.AI_TIMEOUT_MS,
        maxRetries: config.AI_MAX_RETRIES,
        fetchImpl: opts.fetchImpl,
        offlineChunkDelayMs: 18,
        settings: () => rt.settings(),
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

    if (config.MOCK_MODE) {
      api.post('/v1/dev/simulate', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
        const rt = rtOf(req);
        if (!rt.mock) return reply.status(404).send({ error: 'indisponível' });
        const b = SimulateBody.parse(req.body ?? {});
        const direction = b.direction ?? (Math.random() < 0.5 ? 'in' : 'out');
        const { tx, result } = await rt.mock.simulate(now(), rt.settings(), direction, b.amountCents);
        setMeta(rt.db, 'last_sync_at', now().toISOString());
        const row = result.notified > 0 ? listNotificationsAfter(rt.db, lastNotificationId(rt.db) - 1, 1)[0] : undefined;
        return {
          ok: true,
          transaction: { amountCents: tx.amountCents, counterpart: tx.counterpart },
          notified: result.notified > 0,
          notification: row ? { id: row.id, title: row.title, body: row.body, kind: row.kind } : null,
          balanceCents: totalBalance(rt.db).balanceCents,
        };
      });
    }
  });

  // ---------- jobs ----------
  if (!opts.disableJobs) {
    const syncTimer = setInterval(() => void services.syncAll(), config.SYNC_INTERVAL_MINUTES * 60_000);
    const summaryTimer = setInterval(() => void services.dailySummaryTickAll(), 30_000);
    syncTimer.unref();
    summaryTimer.unref();
    app.addHook('onReady', async () => {
      void services.syncAll();
    });
    app.addHook('onClose', async () => {
      clearInterval(syncTimer);
      clearInterval(summaryTimer);
    });
  }
  app.addHook('onClose', async () => {
    runtimes.closeAll();
    directory.close();
  });

  return { app, services };
}
