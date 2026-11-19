import { z } from 'zod';
import type { DB } from '../db/index.js';
import type { Config } from '../config.js';

export const SettingsSchema = z.object({
  bigOutflowThresholdCents: z.number().int().min(0).max(100_000_000_00),
  dailySummaryTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM'),
  dailySummaryEnabled: z.boolean(),
  notifyIncoming: z.boolean(),
  notifyOutgoing: z.boolean(),
});
export type Settings = z.infer<typeof SettingsSchema>;
export const SettingsPatchSchema = SettingsSchema.partial().strict();

export function defaultSettings(config: Config): Settings {
  return {
    bigOutflowThresholdCents: config.DEFAULT_BIG_OUTFLOW_CENTS,
    dailySummaryTime: config.DEFAULT_DAILY_SUMMARY_TIME,
    dailySummaryEnabled: true,
    notifyIncoming: true,
    notifyOutgoing: true,
  };
}

export function getSettings(db: DB, config: Config): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const stored: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      stored[r.key] = JSON.parse(r.value);
    } catch {
      /* ignora valor corrompido: cai no padrão */
    }
  }
  const merged = { ...defaultSettings(config), ...stored };
  const parsed = SettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : defaultSettings(config);
}

export function updateSettings(db: DB, config: Config, patch: Partial<Settings>): Settings {
  const next = SettingsSchema.parse({ ...getSettings(db, config), ...patch });
  const stmt = db.prepare(
    'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  db.transaction(() => {
    for (const [k, v] of Object.entries(patch)) stmt.run(k, JSON.stringify(v));
  })();
  return next;
}
