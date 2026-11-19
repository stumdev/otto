/**
 * Backup consistente do SQLite (API de backup online: funciona com o servidor rodando).
 *   Local:  npm run backup -- [pasta-destino]          (padrão: ./backups)
 *   Docker: docker compose exec tony node dist/cli/backup.js /data/backups
 * Mantém os 14 backups mais recentes na pasta.
 */
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

for (const p of [resolve('..', '.env'), resolve('.env')]) {
  if (existsSync(p)) {
    process.loadEnvFile(p);
    break;
  }
}

const dbPath = resolve(process.env['DATABASE_PATH'] ?? './data/tony.db');
const dest = resolve(process.argv[2] ?? './backups');
if (!existsSync(dbPath)) {
  console.error(`Banco não encontrado em ${dbPath}`);
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = join(dest, `tony-${stamp}.db`);
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
await db.backup(target);
db.close();
console.log(`Backup salvo em ${target}`);

const files = readdirSync(dest)
  .filter((f) => /^tony-.*\.db$/.test(f))
  .sort()
  .reverse();
for (const old of files.slice(14)) rmSync(join(dest, old));
