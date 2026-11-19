import { z } from 'zod';
import type { DB } from '../db/index.js';
import { searchTransactions, sumRange, topTransactions, totalBalance, type TxRow } from '../db/repo.js';
import { formatBRL, formatSigned } from '../lib/money.js';
import {
  brDate,
  daysBetweenInclusive,
  isDateString,
  localTimeOf,
  normalizeRange,
  PERIOD_KEYWORDS,
  resolvePeriod,
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
  | { type: 'list'; title: string; items: { title: string; subtitle: string; amountCents: number }[] };

const periodDescription = `Período: uma palavra-chave (${PERIOD_KEYWORDS.join(', ')}), uma data "AAAA-MM-DD" ou um intervalo "AAAA-MM-DD..AAAA-MM-DD".`;

export const TOOL_DEFS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'get_balance',
      description: 'Saldo atual da conta e quando foi atualizado.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_period_summary',
      description: 'Total que entrou, saiu e o resultado líquido entre duas datas (inclusive), no fuso de São Paulo.',
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
export function runTool(db: DB, name: string, rawArgs: string, now: Date): ToolOutcome {
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
        return {
          result: { saldo: formatBRL(b.balanceCents), atualizado_em: b.updatedAt },
          card: { type: 'balance', title: 'Saldo agora', amountCents: b.balanceCents },
        };
      }
      case 'get_period_summary': {
        const a = SummaryArgs.parse(args);
        if (!isDateString(a.from) || !isDateString(a.to)) throw new Error('Datas devem ser AAAA-MM-DD');
        const range = clampRange({ from: a.from, to: a.to });
        const t = sumRange(db, range);
        return {
          result: {
            periodo: rangeLabel(range),
            entrou: formatBRL(t.inCents),
            saiu: formatBRL(t.outCents),
            liquido: formatSigned(t.netCents),
            qtd_entradas: t.countIn,
            qtd_saidas: t.countOut,
            sem_movimentacoes: t.countIn + t.countOut === 0,
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
      default:
        return { result: { erro: `Função desconhecida: ${name}` } };
    }
  } catch (err) {
    const msg = err instanceof z.ZodError ? 'Argumentos inválidos.' : (err as Error).message;
    return { result: { erro: msg } };
  }
}
