/**
 * Cria (ou lista) o webhook da aplicação na Pluggy apontando para
 * <PUBLIC_BASE_URL>/v1/webhooks/pluggy, com o cabeçalho secreto
 * "Authorization: Bearer <PLUGGY_WEBHOOK_HEADER_SECRET>".
 * Endpoints: POST /webhooks e GET /webhooks (https://docs.pluggy.ai/reference/webhook/webhooks-create).
 *
 * Uso: npm run pluggy:register-webhook          (cria)
 *      npm run pluggy:register-webhook -- --list (só lista)
 */
import { loadDotEnv } from './env.js';

loadDotEnv();
const base = process.env['PLUGGY_BASE_URL'] || 'https://api.pluggy.ai';
const { PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET, PUBLIC_BASE_URL, PLUGGY_WEBHOOK_HEADER_SECRET } = process.env;
if (!PLUGGY_CLIENT_ID || !PLUGGY_CLIENT_SECRET) {
  console.error('Defina PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET no .env.');
  process.exit(1);
}

const authRes = await fetch(`${base}/auth`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ clientId: PLUGGY_CLIENT_ID, clientSecret: PLUGGY_CLIENT_SECRET }),
});
if (!authRes.ok) {
  console.error(`Falha no /auth: HTTP ${authRes.status}`);
  process.exit(1);
}
const { apiKey } = (await authRes.json()) as { apiKey: string };
const headers = { 'X-API-KEY': apiKey, 'content-type': 'application/json' };

const list = await fetch(`${base}/webhooks`, { headers });
const existing = (await list.json()) as { results?: { id: string; url: string; event: string; disabledAt: string | null }[] };
console.log('Webhooks atuais:');
for (const w of existing.results ?? []) console.log(`  ${w.id}  ${w.event}  ${w.url}${w.disabledAt ? '  (desativado)' : ''}`);
if (process.argv.includes('--list')) process.exit(0);

if (!PUBLIC_BASE_URL?.startsWith('https://')) {
  console.error('PUBLIC_BASE_URL precisa ser uma URL https pública (porta 443).');
  process.exit(1);
}
if (!PLUGGY_WEBHOOK_HEADER_SECRET || PLUGGY_WEBHOOK_HEADER_SECRET.length < 32) {
  console.error('Defina PLUGGY_WEBHOOK_HEADER_SECRET com pelo menos 32 caracteres (npm run gen-token).');
  process.exit(1);
}
const url = `${PUBLIC_BASE_URL.replace(/\/+$/, '')}/v1/webhooks/pluggy`;
if ((existing.results ?? []).some((w) => w.url === url && !w.disabledAt)) {
  console.log(`Já existe um webhook ativo para ${url}. Nada a fazer.`);
  process.exit(0);
}
const res = await fetch(`${base}/webhooks`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ url, event: 'all', headers: { Authorization: `Bearer ${PLUGGY_WEBHOOK_HEADER_SECRET}` } }),
});
if (!res.ok) {
  console.error(`Falha ao criar webhook: HTTP ${res.status}`);
  process.exit(1);
}
const created = (await res.json()) as { id: string };
console.log(`Webhook criado: ${created.id} -> ${url}`);
