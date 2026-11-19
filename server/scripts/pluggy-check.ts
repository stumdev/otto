/**
 * Confere as credenciais da Pluggy e o itemId: mostra o status do item, a validade do
 * consentimento e as contas encontradas (sem exibir transações).
 *
 * Uso: npm run pluggy:check
 */
import { PluggyClient } from '../src/services/pluggy/client.js';
import { decimalToCents, formatBRL } from '../src/lib/money.js';
import { loadDotEnv } from './env.js';

loadDotEnv();
const { PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET, PLUGGY_ITEM_IDS, PLUGGY_BASE_URL } = process.env;
if (!PLUGGY_CLIENT_ID || !PLUGGY_CLIENT_SECRET || !PLUGGY_ITEM_IDS) {
  console.error('Defina PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET e PLUGGY_ITEM_IDS no .env.');
  process.exit(1);
}
const client = new PluggyClient(PLUGGY_BASE_URL || 'https://api.pluggy.ai', PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET);

for (const itemId of PLUGGY_ITEM_IDS.split(',').map((s) => s.trim()).filter(Boolean)) {
  try {
    const item = await client.getItem(itemId);
    console.log(`\nItem ${itemId}`);
    console.log(`  conector:      ${item.connector?.name ?? '?'}`);
    console.log(`  status:        ${item.status} / ${item.executionStatus ?? '-'}`);
    console.log(`  última atualização: ${item.lastUpdatedAt ?? '-'}`);
    console.log(`  consentimento expira: ${item.consentExpiresAt ?? '-'}`);
    if (item.error) console.log(`  erro: ${item.error.code} - ${item.error.message}`);
    const accounts = await client.listAccounts(itemId);
    for (const a of accounts) {
      console.log(`  conta ${a.type}/${a.subtype ?? '-'}: ${a.marketingName ?? a.name ?? a.id} · saldo ${formatBRL(decimalToCents(a.balance))}`);
    }
    if (!accounts.some((a) => a.type === 'BANK')) console.log('  ! nenhuma conta BANK (corrente) encontrada neste item');
  } catch (err) {
    console.error(`Item ${itemId}: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
