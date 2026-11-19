import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1' || v === 'yes'));

const optStr = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: bool(false),
  DATABASE_PATH: z.string().default('./data/tony.db'),

  APP_TOKEN: z.string().min(32, 'APP_TOKEN precisa ter pelo menos 32 caracteres (use `npm run gen-token`).'),

  MOCK_MODE: bool(true),

  // Pluggy (Open Finance)
  PLUGGY_BASE_URL: z.url().default('https://api.pluggy.ai'),
  PLUGGY_CLIENT_ID: optStr,
  PLUGGY_CLIENT_SECRET: optStr,
  PLUGGY_ITEM_IDS: optStr, // separados por vírgula (preparado para multi-conta)
  PLUGGY_WEBHOOK_SIGNING_SECRET: optStr,
  PLUGGY_WEBHOOK_SIGNING_SECRET_PREVIOUS: optStr,
  PLUGGY_WEBHOOK_HEADER_SECRET: optStr,
  PLUGGY_WEBHOOK_ROTATING: bool(false),
  PUBLIC_BASE_URL: optStr,

  SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(120).default(5),
  NOTIFY_MAX_AGE_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(72),
  /** Provisórias (lidas da notificação do banco) não confirmadas pelo agregador saem do saldo após este prazo. */
  PROVISIONAL_TTL_HOURS: z.coerce.number().int().min(6).max(24 * 14).default(96),

  // Firebase Cloud Messaging
  FIREBASE_SERVICE_ACCOUNT_FILE: optStr,

  // IA
  AI_PROVIDER_ORDER: z.string().default('groq,gemini'),
  GROQ_API_KEY: optStr,
  GROQ_BASE_URL: z.url().default('https://api.groq.com/openai/v1'),
  GROQ_MODEL: z.string().default('openai/gpt-oss-120b'),
  GEMINI_API_KEY: optStr,
  GEMINI_BASE_URL: z.url().default('https://generativelanguage.googleapis.com/v1beta/openai/'),
  GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),

  // Padrões de ajustes (podem ser alterados pelo app em PUT /v1/settings)
  DEFAULT_BIG_OUTFLOW_CENTS: z.coerce.number().int().min(0).default(100000),
  DEFAULT_DAILY_SUMMARY_TIME: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default('22:00'),
});

export type Env = z.infer<typeof EnvSchema>;

export interface AiProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface Config extends Env {
  pluggyItemIds: string[];
  pluggyEnabled: boolean;
  aiProviders: AiProviderConfig[];
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida no .env:\n${msg}`);
  }
  const env = parsed.data;

  const pluggyItemIds = (env.PLUGGY_ITEM_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const pluggyEnabled = !env.MOCK_MODE && !!env.PLUGGY_CLIENT_ID && !!env.PLUGGY_CLIENT_SECRET && pluggyItemIds.length > 0;

  if (!env.MOCK_MODE && !pluggyEnabled) {
    throw new Error(
      'MOCK_MODE=false exige PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET e PLUGGY_ITEM_IDS. Veja o README, seção "Ligar o modo real".',
    );
  }

  const available: Record<string, AiProviderConfig | undefined> = {
    groq: env.GROQ_API_KEY
      ? { name: 'groq', baseUrl: env.GROQ_BASE_URL, apiKey: env.GROQ_API_KEY, model: env.GROQ_MODEL }
      : undefined,
    gemini: env.GEMINI_API_KEY
      ? { name: 'gemini', baseUrl: env.GEMINI_BASE_URL, apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL }
      : undefined,
  };
  const aiProviders = env.AI_PROVIDER_ORDER.split(',')
    .map((s) => s.trim().toLowerCase())
    .map((n) => available[n])
    .filter((p): p is AiProviderConfig => !!p);

  return { ...env, pluggyItemIds, pluggyEnabled, aiProviders };
}
