import { z } from 'zod';
import type { DB } from '../db/index.js';
import { dailyTotals, searchTransactions, sumAfter, sumRange, topTransactions, totalBalance, type TxRow } from '../db/repo.js';
import { cardSpending, categoryBreakdown, reserveFlows, type CardTxRow } from '../db/wallet.js';
import type { Settings } from '../services/settings.js';
import { buildCards, buildReserves } from '../services/wallet.js';
import { formatBRL, formatSigned } from '../lib/money.js';
import {
  brDate,
  daysBetweenInclusive,
  isDateString,
  localTimeOf,
  normalizeRange,
  PERIOD_KEYWORDS,
  resolvePeriod,
  shortDateLabel,
  addDays,
  type DateRange,
} from '../lib/time.js';
import type { ToolDef } from './provider.js';

/** Máximo de itens que qualquer ferramenta devolve à IA. A IA nunca recebe o extrato inteiro. */
export const MAX_ITEMS = 10;
const MAX_RANGE_DAYS = 400;

/** Cartões inline que o app desenha junto da resposta. Valores em centavos. */
export type Card =
  | { type: 'balance'; title: string; amountCents: number }
  | { type: 'period'; title: string; inCents: number; outCents: number }
  | { type: 'list'; title: string; items: { title: string; subtitle: string; amountCents: number }[] }
  | { type: 'reserves'; title: string; totalCents: number; items: { name: string; subtitle: string; amountCents: number }[] }
  | {
      type: 'credit';
      title: string;
      billCents: number;
      limitCents: number | null;
      availableCents: number | null;
      subtitle: string;
    }
  | { type: 'breakdown'; title: string; items: { label: string; amountCents: number; pct: number }[] };

const periodDescription = `Período: uma palavra-chave (${PERIOD_KEYWORDS.join(', ')}), uma data "AAAA-MM-DD" ou um intervalo "AAAA-MM-DD..AAAA-MM-DD".`;

export const TOOL_DEFS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'get_balance',
      description: 'Saldo atual da conta corrente, total guardado nas caixinhas e a soma dos dois.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_period_summary',
      description:
        'Total que entrou e saiu da conta e o resultado líquido entre duas datas (inclusive). Movimentações com as caixinhas NÃO contam como entrada/saída; vêm separadas em guardado/resgatado.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Data inicial AAAA-MM-DD' },
          to: { type: 'string', description: 'Data final AAAA-MM-DD' },
        },
        required: ['from', 'to'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_top_transactions',
      description: `Maiores entradas ou saídas de um período, em ordem decrescente de valor. Máximo ${MAX_ITEMS}.`,
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', description: periodDescription },
          direction: { type: 'string', enum: ['in', 'out'], description: 'in = entradas, out = saídas' },
          limit: { type: 'integer', minimum: 1, maximum: MAX_ITEMS },
        },
        required: ['period', 'direction'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_transactions',
      description:
        'Busca movimentações por texto (nome de quem pagou/recebeu, descrição ou categoria, ex.: "mercado", "aluguel", "João") e devolve os totais e até 10 itens.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Termo de busca curto' },
          period: { type: 'string', description: periodDescription },
        },
        required: ['query', 'period'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_reserves',
      description:
        'Caixinhas (reservas/investimentos do Nubank): saldo de cada uma, rendimento contratado e total. Com period, informa também quanto foi guardado e resgatado no período.',
      parameters: {
        type: 'object',
        properties: { period: { type: 'string', description: `Opcional. ${periodDescription}` } },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_credit_card',
      description:
        'Cartão de crédito: fatura atual (em aberto), limite total, disponível e usado, vencimento, pagamento mínimo, próximas faturas (incluindo parcelas futuras) e faturas anteriores.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_card_spending',
      description: `Compras no cartão de crédito em um período (pela data da compra): total, quantidade e as maiores (até ${MAX_ITEMS}). Opcionalmente filtra por texto (loja ou categoria).`,
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', description: periodDescription },
          query: { type: 'string', description: 'Opcional: termo de busca (ex.: "farmácia", "uber")' },
          limit: { type: 'integer', minimum: 1, maximum: MAX_ITEMS },
        },
        required: ['period'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_category_breakdown',
      description: 'Gastos (ou entradas) agrupados por categoria em um período, do maior para o menor, com percentual. Até 10 categorias.',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', description: periodDescription },
          direction: { type: 'string', enum: ['in', 'out'], description: 'out = gastos (padrão), in = entradas' },
          source: {
            type: 'string',
            enum: ['conta', 'cartao', 'tudo'],
            description: 'conta = Pix/débito; cartao = compras no crédito; tudo = os dois (padrão)',
          },
        },
        required: ['period'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_daily_breakdown',
      description: 'Dia a dia de um período (até 31 dias): quanto entrou e saiu em cada dia e o saldo da conta no fim do dia.',
      parameters: {
        type: 'object',
        properties: { period: { type: 'string', description: periodDescription } },
        required: ['period'],
        additionalProperties: false,
      },
    },
  },
];

/** Sinônimos para que "mercado" ache também "Supermercado", "Hortifruti" e a categoria "Mercado". */
const SYNONYMS: Record<string, string[]> = {
  mercado: ['mercado', 'supermercado', 'hortifruti', 'atacad', 'sacolão', 'groceries'],
  supermercado: ['mercado', 'supermercado', 'atacad'],
  comida: ['alimentação', 'restaurante', 'padaria', 'lanchonete', 'pizzaria', 'ifood', 'delivery'],
  restaurante: ['alimentação', 'restaurante'],
  alimentação: ['alimentação', 'restaurante', 'padaria'],
  transporte: ['transporte', 'uber', '99', 'posto', 'combustível', 'estacionamento', 'pedágio'],
  combustível: ['posto', 'combustível', 'gasolina'],
  farmácia: ['farmácia', 'drogaria', 'saúde'],
  saúde: ['saúde', 'farmácia', 'drogaria', 'clínica', 'hospital'],
  assinatura: ['assinatura', 'streaming'],
  assinaturas: ['assinatura', 'streaming'],
  aluguel: ['aluguel', 'moradia', 'imobiliária'],
  moradia: ['moradia', 'aluguel', 'condomínio'],
  contas: ['contas', 'energia', 'luz', 'água', 'internet', 'telefone'],
  luz: ['energia', 'luz'],
  salário: ['salário', 'pró-labore'],
};

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '');
}

/** Termo + sinônimos. A chave de sinônimo casa com ou sem acento ("farmacia" = "farmácia"). */
export function expandQuery(q: string): string[] {
  const base = q.trim().toLowerCase().slice(0, 60);
  if (!base) return [];
  const plain = stripAccents(base);
  const key = Object.keys(SYNONYMS).find((k) => stripAccents(k) === plain);
  return [...new Set([base, ...(key ? (SYNONYMS[key] ?? []) : [])])];
}

function rangeLabel(r: DateRange): string {
  return r.from === r.to ? brDate(r.from) : `${brDate(r.from)} a ${brDate(r.to)}`;
}

function txForModel(r: TxRow) {
  return {
    data: brDate(r.local_date),
    hora: r.has_time ? localTimeOf(r.occurred_at) : null,
    descricao: r.description,
    contraparte: r.counterpart,
    categoria: r.category,
    valor: formatSigned(r.amount_cents),
  };
}

function txForCard(r: TxRow) {
  return {
    title: r.counterpart ?? r.description,
    subtitle: `${r.description} · ${brDate(r.local_date).slice(0, 5)}`,
    amountCents: r.amount_cents,
  };
}

function clampRange(r: DateRange): DateRange {
  const n = normalizeRange(r);
  if (daysBetweenInclusive(n.from, n.to) > MAX_RANGE_DAYS) throw new Error(`Período maior que ${MAX_RANGE_DAYS} dias`);
  return n;
}

const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** "2026-12" -> "dez/2026" */
function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  return `${MONTHS_PT[Number(m) - 1] ?? m}/${y}`;
}

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

function cardTxForModel(t: CardTxRow) {
  return {
    data: brDate(t.local_date),
    descricao: t.description,
    categoria: t.category,
    valor: formatBRL(t.amount_cents),
    parcela: t.installment_number && t.total_installments ? `${t.installment_number}/${t.total_installments}` : null,
    fatura: t.bill_month ? monthLabel(t.bill_month) : null,
  };
}

const NO_SETTINGS: Settings = {
  bigOutflowThresholdCents: 0,
  dailySummaryTime: '22:00',
  dailySummaryEnabled: false,
  notifyIncoming: true,
  notifyOutgoing: true,
  cardDueDay: null,
};

const ReservesArgs = z.object({ period: z.string().optional() });
const CardSpendingArgs = z.object({
  period: z.string(),
  query: z.string().max(60).optional(),
  limit: z.number().int().min(1).max(MAX_ITEMS).optional(),
});
const BreakdownArgs = z.object({
  period: z.string(),
  direction: z.enum(['in', 'out']).optional(),
  source: z.enum(['conta', 'cartao', 'tudo']).optional(),
});
const DailyArgs = z.object({ period: z.string() });

const SummaryArgs = z.object({ from: z.string(), to: z.string() });
const TopArgs = z.object({
  period: z.string(),
  direction: z.enum(['in', 'out']),
  limit: z.number().int().min(1).max(MAX_ITEMS).optional(),
});
const SearchArgs = z.object({ query: z.string().min(1).max(60), period: z.string() });

export interface ToolOutcome {
  /** JSON devolvido à IA (só o necessário, valores já formatados). */
  result: unknown;
  card?: Card;
}

/** Executa uma ferramenta localmente. Erros viram uma mensagem para a IA (nunca derrubam o chat). */
export function runTool(db: DB, name: string, rawArgs: string, now: Date, settings: Settings = NO_SETTINGS): ToolOutcome {
  let args: unknown;
  try {
    args = rawArgs.trim() ? JSON.parse(rawArgs) : {};
  } catch {
    return { result: { erro: 'Argumentos inválidos (JSON malformado).' } };
  }
  try {
    switch (name) {
      case 'get_balance': {
        const b = totalBalance(db);
        const r = buildReserves(db);
        return {
          result: {
            saldo_conta: formatBRL(b.balanceCents),
            total_caixinhas: formatBRL(r.totalCents),
            conta_mais_caixinhas: formatBRL(b.balanceCents + r.totalCents),
            atualizado_em: b.updatedAt,
          },
          card: { type: 'balance', title: 'Saldo na conta', amountCents: b.balanceCents },
        };
      }
      case 'get_period_summary': {
        const a = SummaryArgs.parse(args);
        if (!isDateString(a.from) || !isDateString(a.to)) throw new Error('Datas devem ser AAAA-MM-DD');
        const range = clampRange({ from: a.from, to: a.to });
        const t = sumRange(db, range);
        const flows = reserveFlows(db, range);
        return {
          result: {
            periodo: rangeLabel(range),
            entrou: formatBRL(t.inCents),
            saiu: formatBRL(t.outCents),
            liquido: formatSigned(t.netCents),
            qtd_entradas: t.countIn,
            qtd_saidas: t.countOut,
            guardado_na_caixinha: formatBRL(flows.savedCents),
            resgatado_da_caixinha: formatBRL(flows.withdrawnCents),
            observacao: 'Guardar/resgatar da caixinha não conta como entrada ou saída.',
            sem_movimentacoes: t.countIn + t.countOut + flows.count === 0,
          },
          card: { type: 'period', title: rangeLabel(range), inCents: t.inCents, outCents: t.outCents },
        };
      }
      case 'get_top_transactions': {
        const a = TopArgs.parse(args);
        const range = clampRange(resolvePeriod(a.period, now));
        const rows = topTransactions(db, range, a.direction, a.limit ?? 5);
        return {
          result: {
            periodo: rangeLabel(range),
            tipo: a.direction === 'in' ? 'entradas' : 'saídas',
            itens: rows.map(txForModel),
            vazio: rows.length === 0,
          },
          card: rows.length
            ? {
                type: 'list',
                title: `${a.direction === 'in' ? 'Maiores entradas' : 'Maiores saídas'} · ${rangeLabel(range)}`,
                items: rows.slice(0, 5).map(txForCard),
              }
            : undefined,
        };
      }
      case 'search_transactions': {
        const a = SearchArgs.parse(args);
        const range = clampRange(resolvePeriod(a.period, now));
        const terms = expandQuery(a.query);
        const { totals, items } = searchTransactions(db, terms, range, MAX_ITEMS);
        const count = totals.countIn + totals.countOut;
        return {
          result: {
            periodo: rangeLabel(range),
            busca: a.query,
            entrou: formatBRL(totals.inCents),
            saiu: formatBRL(totals.outCents),
            quantidade: count,
            itens: items.map(txForModel),
            itens_omitidos: Math.max(0, count - items.length),
            vazio: count === 0,
          },
          card: count
            ? { type: 'period', title: `“${a.query}” · ${rangeLabel(range)}`, inCents: totals.inCents, outCents: totals.outCents }
            : undefined,
        };
      }
      case 'get_reserves': {
        const a = ReservesArgs.parse(args);
        const r = buildReserves(db);
        const range = a.period ? clampRange(resolvePeriod(a.period, now)) : undefined;
        const flows = range ? reserveFlows(db, range) : undefined;
        return {
          result: {
            total_caixinhas: formatBRL(r.totalCents),
            caixinhas: r.items.slice(0, MAX_ITEMS).map((i) => ({ nome: i.name, saldo: formatBRL(i.balanceCents), rendimento: i.rateLabel })),
            atualizado_em: r.updatedAt,
            observacao: 'O Open Finance não informa o nome que você deu a cada caixinha; elas são numeradas pelo maior saldo.',
            movimentacoes: range && flows
              ? { periodo: rangeLabel(range), guardado: formatBRL(flows.savedCents), resgatado: formatBRL(flows.withdrawnCents) }
              : undefined,
            vazio: r.items.length === 0,
          },
          card: r.items.length
            ? {
                type: 'reserves',
                title: 'Caixinhas',
                totalCents: r.totalCents,
                items: r.items.slice(0, 5).map((i) => ({ name: i.name, subtitle: i.rateLabel ?? 'Caixinha', amountCents: i.balanceCents })),
              }
            : undefined,
        };
      }
      case 'get_credit_card': {
        const cards = buildCards(db, settings, now);
        if (cards.length === 0) return { result: { vazio: true, observacao: 'Nenhum cartão de crédito conectado.' } };
        const first = cards[0]!;
        return {
          result: {
            cartoes: cards.map((c) => ({
              nome: c.name,
              final: c.last4,
              fatura_atual: formatBRL(c.openBillCents),
              limite_total: c.creditLimitCents === null ? null : formatBRL(c.creditLimitCents),
              limite_disponivel: c.availableLimitCents === null ? null : formatBRL(c.availableLimitCents),
              limite_usado: c.usedLimitCents === null ? null : formatBRL(c.usedLimitCents),
              vencimento: c.dueDate ? brDate(c.dueDate) : 'não informado pelo banco (defina o dia nos Ajustes do app)',
              origem_vencimento: c.dueDateSource,
              pagamento_minimo: c.minimumPaymentCents === null ? 'não informado pelo banco' : formatBRL(c.minimumPaymentCents),
              proximas_faturas: c.upcomingBills.slice(0, 6).map((b) => ({ mes: monthLabel(b.month), valor_previsto: formatBRL(b.totalCents), lancamentos: b.count })),
              faturas_anteriores: c.pastBills.map((b) => ({ vencimento: brDate(b.dueDate), valor: formatBRL(b.totalCents) })),
            })),
          },
          card: {
            type: 'credit',
            title: first.last4 ? `${first.name} •••• ${first.last4}` : first.name,
            billCents: first.openBillCents,
            limitCents: first.creditLimitCents,
            availableCents: first.availableLimitCents,
            subtitle: first.dueDate ? `Vence em ${brDate(first.dueDate)}` : 'Vencimento não informado',
          },
        };
      }
      case 'get_card_spending': {
        const a = CardSpendingArgs.parse(args);
        const range = clampRange(resolvePeriod(a.period, now));
        const terms = a.query ? expandQuery(a.query) : [];
        const r = cardSpending(db, range, terms, a.limit ?? 5);
        return {
          result: {
            periodo: rangeLabel(range),
            busca: a.query ?? null,
            total_compras: formatBRL(r.chargesCents),
            estornos_e_creditos: formatBRL(r.creditsCents),
            quantidade: r.count,
            maiores: r.items.map(cardTxForModel),
            vazio: r.count === 0,
          },
          card: r.items.length
            ? {
                type: 'list',
                title: `Cartão${a.query ? ` · “${a.query}”` : ''} · ${rangeLabel(range)}`,
                items: r.items.slice(0, 5).map((t) => ({
                  title: t.description,
                  subtitle: `${t.category ?? 'Cartão'} · ${brDate(t.local_date).slice(0, 5)}${t.installment_number && t.total_installments ? ` · ${t.installment_number}/${t.total_installments}` : ''}`,
                  amountCents: -t.amount_cents,
                })),
              }
            : undefined,
        };
      }
      case 'get_category_breakdown': {
        const a = BreakdownArgs.parse(args);
        const range = clampRange(resolvePeriod(a.period, now));
        const direction = a.direction ?? 'out';
        const source = direction === 'in' ? 'conta' : (a.source ?? 'tudo');
        const rows = categoryBreakdown(db, range, direction, source, MAX_ITEMS);
        const total = rows.reduce((s, r) => s + r.totalCents, 0);
        return {
          result: {
            periodo: rangeLabel(range),
            tipo: direction === 'in' ? 'entradas' : 'gastos',
            fonte: source,
            total_das_categorias_listadas: formatBRL(total),
            categorias: rows.map((r) => ({ categoria: r.category, valor: formatBRL(r.totalCents), percentual: pct(r.totalCents, total), quantidade: r.count })),
            vazio: rows.length === 0,
          },
          card: rows.length
            ? {
                type: 'breakdown',
                title: `${direction === 'in' ? 'Entradas' : 'Gastos'} por categoria · ${rangeLabel(range)}`,
                items: rows.slice(0, 6).map((r) => ({ label: r.category, amountCents: direction === 'in' ? r.totalCents : -r.totalCents, pct: pct(r.totalCents, total) })),
              }
            : undefined,
        };
      }
      case 'get_daily_breakdown': {
        const a = DailyArgs.parse(args);
        const range = clampRange(resolvePeriod(a.period, now));
        if (daysBetweenInclusive(range.from, range.to) > 31) throw new Error('Use um período de até 31 dias');
        const daily = dailyTotals(db, range);
        const balance = totalBalance(db).balanceCents;
        const dias = [];
        for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
          const t = daily.get(d) ?? { inCents: 0, outCents: 0, netCents: 0 };
          dias.push({ date: d, ...t, closing: balance - sumAfter(db, d) });
        }
        const maxAbs = Math.max(1, ...dias.map((x) => Math.abs(x.netCents)));
        return {
          result: {
            periodo: rangeLabel(range),
            dias: dias.map((x) => ({
              data: shortDateLabel(x.date),
              entrou: formatBRL(x.inCents),
              saiu: formatBRL(x.outCents),
              saldo_fim_do_dia: formatBRL(x.closing),
            })),
          },
          card: {
            type: 'breakdown',
            title: `Dia a dia · ${rangeLabel(range)}`,
            items: dias.slice(-10).map((x) => ({ label: shortDateLabel(x.date), amountCents: x.netCents, pct: pct(Math.abs(x.netCents), maxAbs) })),
          },
        };
      }
      default:
        return { result: { erro: `Função desconhecida: ${name}` } };
    }
  } catch (err) {
    const msg = err instanceof z.ZodError ? 'Argumentos inválidos.' : (err as Error).message;
    return { result: { erro: msg } };
  }
}
