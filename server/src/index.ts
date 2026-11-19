import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createFcmSender } from './services/fcm.js';
import pino from 'pino';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  const bootLog = pino({ level: config.LOG_LEVEL });
  if (config.NODE_ENV === 'production' && config.MOCK_MODE) {
    bootLog.warn('MOCK_MODE=true em produção: os dados exibidos são fictícios');
  }

  const push = await createFcmSender(config.FIREBASE_SERVICE_ACCOUNT_FILE, bootLog);
  const { app } = await buildApp({ config, push });

  app.log.info(
    {
      mode: config.MOCK_MODE ? 'mock' : 'real',
      push: push.enabled ? 'fcm' : 'polling',
      ai: config.aiProviders.map((p) => `${p.name}:${p.model}`).join(',') || 'offline (regras)',
    },
    'Otto iniciando',
  );

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'encerrando');
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.HOST, port: config.PORT });
}

void main();
