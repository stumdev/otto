import type { TxInput } from '../../db/repo.js';
import { decimalToCents } from '../../lib/money.js';
import { localDateOf, localToUtcIso } from '../../lib/time.js';
import type { PluggyTransaction } from './client.js';

/** Categorias do categorizador da Pluggy (nível 1/2) traduzidas para exibição e busca em pt-BR. */
const CATEGORY_PT: Record<string, string> = {
  Income: 'Receitas',
  Salary: 'Salário',
  Retirement: 'Aposentadoria',
  'Entrepreneurial activities': 'Atividade empresarial',
  'Government aid': 'Auxílio do governo',
  'Non-recurring income': 'Receita eventual',
  'Loans and Financing': 'Empréstimos e financiamentos',
  Investments: 'Investimentos',
  'Same person transfer': 'Transferência entre contas próprias',
  'Same person transfer - PIX': 'Transferência entre contas próprias',
  'Same person transfer - TED': 'Transferência entre contas próprias',
  Transfers: 'Transferências',
  'Transfer - PIX': 'Transferências',
  'Transfer - TED': 'Transferências',
  'Transfer - Internal': 'Transferências',
  'Third-party transfers': 'Transferências',
  'Credit card payment': 'Cartão de crédito',
  Services: 'Serviços',
  Telecommunications: 'Contas',
  Internet: 'Contas',
  Mobile: 'Contas',
  Education: 'Educação',
  'Wellness and fitness': 'Bem-estar',
  Shopping: 'Compras',
  'Online shopping': 'Compras',
  'Digital services': 'Assinaturas',
  'Video streaming': 'Assinaturas',
  'Music streaming': 'Assinaturas',
  Groceries: 'Mercado',
  'Food and drinks': 'Alimentação',
  'Eating out': 'Alimentação',
  'Food delivery': 'Alimentação',
  Travel: 'Viagem',
  Donations: 'Doações',
  Gambling: 'Apostas',
  Taxes: 'Impostos',
  'Bank fees': 'Tarifas bancárias',
  Housing: 'Moradia',
  Rent: 'Moradia',
  Utilities: 'Contas',
  Electricity: 'Contas',
  Water: 'Contas',
  Healthcare: 'Saúde',
  Pharmacy: 'Saúde',
  Transportation: 'Transporte',
  'Taxi and ride-hailing': 'Transporte',
  Automotive: 'Transporte',
  'Gas stations': 'Transporte',
  Parking: 'Transporte',
  Insurance: 'Seguros',
  Leisure: 'Lazer',
  // demais categorias da tabela da Pluggy (docs.pluggy.ai/docs/products/transaction-categorization)
  Other: 'Outros',
  Others: 'Outros',
  'Loans': 'Empréstimos e financiamentos',
  'Late payment and overdraft costs': 'Juros e cheque especial',
  'Interests charged': 'Juros',
  Financing: 'Financiamentos',
  'Real estate financing': 'Financiamentos',
  'Vehicle Financing': 'Financiamentos',
  'Student loan': 'Financiamentos',
  'Automatic investment': 'Investimentos',
  'Fixed income': 'Investimentos',
  'Mutual funds': 'Investimentos',
  'Variable income': 'Investimentos',
  Margin: 'Investimentos',
  'Proceeds interests and dividends': 'Rendimentos',
  Pension: 'Previdência',
  'Same person transfer - Cash': 'Transferência entre contas próprias',
  'Transfer - Bank slip (Boleto)': 'Transferências',
  'Transfer - Cash': 'Transferências',
  'Transfer - Check': 'Transferências',
  'Transfer - DOC': 'Transferências',
  'Transfer - Foreign exchange': 'Câmbio',
  'Bank slip': 'Transferências',
  'Debt card': 'Transferências',
  DOC: 'Transferências',
  PIX: 'Transferências',
  TED: 'Transferências',
  'Legal obligations': 'Obrigações legais',
  'Blocked balances': 'Saldo bloqueado',
  Alimony: 'Pensão alimentícia',
  TV: 'Contas',
  'Online Courses': 'Educação',
  University: 'Educação',
  School: 'Educação',
  Kindergarten: 'Educação',
  'Gyms and fitness centers': 'Bem-estar',
  'Sports practice': 'Bem-estar',
  Wellness: 'Bem-estar',
  Tickets: 'Ingressos',
  'Stadiums and arenas': 'Ingressos',
  'Landmarks and museums': 'Ingressos',
  'Cinema, theater and concerts': 'Ingressos',
  Electronics: 'Compras',
  'Pet supplies and vet': 'Pets',
  Clothing: 'Compras',
  'Kids and toys': 'Compras',
  Bookstore: 'Compras',
  'Sports goods': 'Compras',
  'Office Supplies': 'Compras',
  Cashback: 'Cashback',
  Gaming: 'Assinaturas',
  'Airport and airlines': 'Viagem',
  Accommodation: 'Viagem',
  'Mileage programs': 'Viagem',
  'Bus tickets': 'Transporte',
  Lottery: 'Apostas',
  'Online bet': 'Apostas',
  'Income taxes': 'Impostos',
  'Taxes on investments': 'Impostos',
  'Tax on financial operations': 'Impostos',
  'Account fees': 'Tarifas bancárias',
  'Wire transfer fees and ATM fees': 'Tarifas bancárias',
  'Credit card fees': 'Tarifas bancárias',
  Houseware: 'Casa',
  'Urban land and building tax': 'Impostos',
  Gas: 'Contas',
  Dentist: 'Saúde',
  Optometry: 'Saúde',
  'Hospital clinics and labs': 'Saúde',
  'Public transportation': 'Transporte',
  'Car rental': 'Transporte',
  Bicycle: 'Transporte',
  'Tolls and in-vehicle payment': 'Transporte',
  'Vehicle ownership taxes and fees': 'Transporte',
  'Vehicle maintenance': 'Transporte',
  'Traffic tickets': 'Transporte',
  'Life insurance': 'Seguros',
  'Home Insurance': 'Seguros',
  'Health insurance': 'Seguros',
  'Vehicle insurance': 'Seguros',
};

export function translateCategory(c: string | null | undefined): string | null {
  if (!c) return null;
  return CATEGORY_PT[c] ?? c;
}

const MIDNIGHT_UTC = /T00:00:00(\.0+)?Z$/;

/**
 * Converte uma transação da Pluggy no formato interno.
 * - Sinal pelo `type` (DEBIT = saída, CREDIT = entrada), em centavos inteiros.
 * - Muitos bancos informam só a data (00:00:00Z). Nesse caso guardamos a data como
 *   está (sem converter de fuso, o que a jogaria para o dia anterior) e has_time = false.
 */
export function mapPluggyTransaction(t: PluggyTransaction, accountId: string): TxInput {
  const abs = Math.abs(decimalToCents(t.amount));
  const amountCents = t.type === 'DEBIT' ? -abs : abs;

  let occurredAt: string;
  let localDate: string;
  let hasTime: boolean;
  if (MIDNIGHT_UTC.test(t.date)) {
    localDate = t.date.slice(0, 10);
    occurredAt = localToUtcIso(localDate, 12, 0);
    hasTime = false;
  } else {
    occurredAt = new Date(t.date).toISOString();
    localDate = localDateOf(occurredAt);
    hasTime = true;
  }

  let method = t.paymentData?.paymentMethod ?? t.operationType ?? null;
  const party = t.type === 'CREDIT' ? t.paymentData?.payer : t.paymentData?.receiver;
  let counterpart = cleanName(party?.name) ?? cleanName(t.merchant?.name) ?? cleanName(t.merchant?.businessName);
  let category = translateCategory(t.category);

  let description = (t.description ?? t.descriptionRaw ?? '').trim() || 'Movimentação';
  // O Nubank (Open Finance) manda muitas vezes "tipo|contraparte", ex.:
  // "Transferência Recebida|Fulano de Tal", "Compra no débito|MINIMERCADO X".
  const pipe = description.indexOf('|');
  if (pipe > 0) {
    const right = description.slice(pipe + 1).replace(/\s+/g, ' ').trim();
    description = description.slice(0, pipe).trim() || 'Movimentação';
    counterpart = counterpart ?? cleanName(right);
  }
  const plain = description.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if ((!method || method === 'OTHER' || method === 'OUTROS') && plain.startsWith('compra no debito')) method = 'CARTAO';
  // "Aplicação RDB" / "Resgate RDB" = dinheiro indo/voltando de uma Caixinha do Nubank
  if (/\brdb\b/.test(plain)) {
    description = t.type === 'CREDIT' ? 'Resgate da caixinha' : 'Guardado na caixinha';
    category = 'Caixinha';
  }
  if (counterpart) {
    if (method === 'PIX') description = t.type === 'CREDIT' ? 'Pix recebido' : 'Pix enviado';
    else if (method === 'TED') description = t.type === 'CREDIT' ? 'TED recebida' : 'TED enviada';
    else if (method === 'BOLETO') description = 'Pagamento de boleto';
    else if (method === 'CARTAO') description = 'Compra no débito';
  }

  return {
    externalId: `pluggy:${t.id}`,
    accountId,
    occurredAt,
    localDate,
    hasTime,
    amountCents,
    description,
    counterpart,
    method,
    category,
    status: t.status ?? 'POSTED',
  };
}

function cleanName(s: string | null | undefined): string | null {
  const v = s?.trim();
  if (!v) return null;
  // nomes vêm muitas vezes em CAIXA ALTA; deixa em "Título" para ficar legível
  if (v === v.toUpperCase() && /[A-ZÀ-Ú]/.test(v)) {
    return v
      .toLowerCase()
      .split(/\s+/)
      .map((w) => (['da', 'de', 'do', 'das', 'dos', 'e'].includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(' ')
      .replace(/\b(Ltda|Me|Sa|Eireli)\b/g, (m) => m.toUpperCase());
  }
  return v;
}
