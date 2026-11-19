import type { DB } from '../db/index.js';
import { searchTransactions, sumRange, topTransactions, totalBalance } from '../db/repo.js';
import { formatBRL } from '../lib/money.js';
import { brDate, resolvePeriod, type DateRange } from '../lib/time.js';
import { expandQuery, stripAccents, type Card } from './tools.js';

/**
 * Motor simples de regras, usado quando nenhuma chave de IA está configurada
 * (ou quando todos os provedores falharam). Responde só com dados do SQLite.
 */

/** Minúsculas, sem pontuação, preservando acentos (necessários para a busca no banco). */
function lowerClean(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface PeriodPick {
  key: string;
  label: string;
}

function detectPeriod(t: string, fallback: PeriodPick): PeriodPick {
  if (/\bontem\b/.test(t)) return { key: 'yesterday', label: 'ontem' };
  if (/\bsemana passada\b/.test(t)) return { key: 'last_week', label: 'na semana passada' };
  if (/\bmes passado\b/.test(t)) return { key: 'last_month', label: 'no mês passado' };
  if (/\b7 dias\b|\bsete dias\b/.test(t)) return { key: 'last_7_days', label: 'nos últimos 7 dias' };
  if (/\b30 dias\b|\btrinta dias\b/.test(t)) return { key: 'last_30_days', label: 'nos últimos 30 dias' };
  if (/\bsemana\b/.test(t)) return { key: 'this_week', label: 'nesta semana' };
  if (/\bmes\b/.test(t)) return { key: 'this_month', label: 'neste mês' };
  if (/\bhoje\b|\bdia a dia\b/.test(t)) return { key: 'today', label: 'hoje' };
  return fallback;
}

function rangeTitle(r: DateRange): string {
  return r.from === r.to ? brDate(r.from) : `${brDate(r.from)} a ${brDate(r.to)}`;
}

const STOP = new Set(['este', 'esse', 'neste', 'nesse', 'essa', 'esta', 'nesta', 'nessa', 'mes', 'semana', 'hoje', 'ontem', 'passado', 'passada', 'ultimos', 'dias']);

/** "quanto gastei no mercado este mês" -> "mercado" */
function extractSearchTerm(t: string): string | undefined {
  const m = /\b(?:com|no|na|nos|nas|em|de|para|pra)\s+([\p{L}\p{N} ]+)/u.exec(t);
  if (!m) return undefined;
  const words: string[] = [];
  for (const w of m[1]!.split(' ')) {
    if (STOP.has(stripAccents(w)) || w === 'o' || w === 'a') break;
    words.push(w);
  }
  const term = words.join(' ').trim();
  return term.length >= 3 ? term : undefined;
}

export interface RuleAnswer {
  text: string;
  cards: Card[];
}

export function answerWithRules(db: DB, question: string, now: Date): RuleAnswer {
  const lower = lowerClean(question);
  const t = stripAccents(lower); // para detectar intenção
  const today: PeriodPick = { key: 'today', label: 'hoje' };

  const wantsIn = /\b(entrou|entrada|entradas|recebi|recebido|recebidos|ganhei)\b/.test(t);
  const wantsOut = /\b(saiu|saida|saidas|gastei|gasto|gastos|paguei|enviei)\b/.test(t);
  const wantsTop = /\b(maior|maiores)\b/.test(t);

  if (/\bsaldo\b/.test(t) && !wantsIn && !wantsOut) {
    const b = totalBalance(db);
    return {
      text: `Seu saldo agora é **${formatBRL(b.balanceCents)}**.`,
      cards: [{ type: 'balance', title: 'Saldo agora', amountCents: b.balanceCents }],
    };
  }

  if (wantsTop) {
    const dir = wantsIn && !wantsOut ? 'in' : 'out';
    const p = detectPeriod(t, { key: 'this_week', label: 'nesta semana' });
    const range = resolvePeriod(p.key, now);
    const rows = topTransactions(db, range, dir, 3);
    if (rows.length === 0) {
      return { text: `Não encontrei ${dir === 'in' ? 'entradas' : 'saídas'} ${p.label}.`, cards: [] };
    }
    const first = rows[0]!;
    const who = first.counterpart ? ` (${first.counterpart})` : '';
    return {
      text: `A maior ${dir === 'in' ? 'entrada' : 'saída'} ${p.label} foi de **${formatBRL(Math.abs(first.amount_cents))}**${who}, em ${brDate(first.local_date)}.`,
      cards: [
        {
          type: 'list',
          title: `${dir === 'in' ? 'Maiores entradas' : 'Maiores saídas'} · ${rangeTitle(range)}`,
          items: rows.map((r) => ({
            title: r.counterpart ?? r.description,
            subtitle: `${r.description} · ${brDate(r.local_date).slice(0, 5)}`,
            amountCents: r.amount_cents,
          })),
        },
      ],
    };
  }

  const term = wantsOut || wantsIn ? extractSearchTerm(lower) : undefined;
  if (term) {
    const p = detectPeriod(t, { key: 'this_month', label: 'neste mês' });
    const range = resolvePeriod(p.key, now);
    const { totals } = searchTransactions(db, expandQuery(term), range, 10);
    const count = totals.countIn + totals.countOut;
    if (count === 0) return { text: `Não encontrei movimentações com “${term}” ${p.label}.`, cards: [] };
    const value = wantsIn && !wantsOut ? totals.inCents : totals.outCents;
    const verb = wantsIn && !wantsOut ? 'Entrou' : 'Você gastou';
    return {
      text: `${verb} **${formatBRL(value)}** com “${term}” ${p.label}, em ${count} ${count === 1 ? 'movimentação' : 'movimentações'}.`,
      cards: [{ type: 'period', title: `“${term}” · ${rangeTitle(range)}`, inCents: totals.inCents, outCents: totals.outCents }],
    };
  }

  if (wantsIn || wantsOut || /\b(resumo|dia a dia|hoje|semana|mes|ontem)\b/.test(t)) {
    const p = detectPeriod(t, today);
    const range = resolvePeriod(p.key, now);
    const s = sumRange(db, range);
    const card: Card = { type: 'period', title: rangeTitle(range), inCents: s.inCents, outCents: s.outCents };
    if (wantsIn && !wantsOut) {
      return { text: `${capitalize(p.label)} entrou **${formatBRL(s.inCents)}** (${s.countIn} ${plural(s.countIn, 'entrada', 'entradas')}).`, cards: [card] };
    }
    if (wantsOut && !wantsIn) {
      return { text: `${capitalize(p.label)} saiu **${formatBRL(s.outCents)}** (${s.countOut} ${plural(s.countOut, 'saída', 'saídas')}).`, cards: [card] };
    }
    return {
      text: `${capitalize(p.label)} entrou **${formatBRL(s.inCents)}** e saiu **${formatBRL(s.outCents)}**.`,
      cards: [card],
    };
  }

  return {
    text: 'No modo offline eu respondo sobre saldo, quanto entrou ou saiu (hoje, ontem, na semana ou no mês), maiores saídas e gastos por nome, como “quanto gastei no mercado este mês?”.',
    cards: [],
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}
