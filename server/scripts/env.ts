import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Carrega ../.env (raiz do monorepo) ou ./.env, se existirem. Variáveis já definidas têm prioridade. */
export function loadDotEnv(): void {
  for (const p of [resolve(process.cwd(), '..', '.env'), resolve(process.cwd(), '.env')]) {
    if (existsSync(p)) {
      process.loadEnvFile(p);
      return;
    }
  }
}
