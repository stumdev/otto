/**
 * Backup consistente dos bancos SQLite (API de backup online: funciona com o servidor rodando).
 * Copia directory.db (contas) e users/*.db (um por usuário) para <destino>/<data-hora>/.
 *   Local:  npm run backup -- [pasta-destino]          (padrão: ./backups)
 *   Docker: docker compose exec otto node dist/cli/backup.js /data/backups
 * Mantém os 14 backups mais recentes.
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

const dataDir = resolve(process.env['DATA_DIR'] ?? './data');
const dest = resolve(process.argv[2] ?? './backups');
const dirDb = join(dataDir, 'directory.db');
if (!existsSync(dirDb)) {
  console.error(`Banco não encontrado em ${dirDb}`);
  process.exit(1);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = join(dest, stamp);
mkdirSync(join(target, 'users'), { recursive: true });

async function copy(src: string, to: string): Promise<void> {
  const db = new Database(src, { readonly: true, fileMustExist: true });
  await db.backup(to);
  db.close();
}

await copy(dirDb, join(target, 'directory.db'));
const usersDir = join(dataDir, 'users');
let n = 0;
if (existsSync(usersDir)) {
  for (const f of readdirSync(usersDir).filter((f) => f.endsWith('.db'))) {
    await copy(join(usersDir, f), join(target, 'users', f));
    n++;
  }
}
console.log(`Backup salvo em ${target} (${n} usuário(s))`);

const old = readdirSync(dest, { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}T/.test(e.name))
  .map((e) => e.name)
  .sort()
  .reverse();
for (const name of old.slice(14)) rmSync(join(dest, name), { recursive: true });
