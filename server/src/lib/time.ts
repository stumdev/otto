import { DateTime } from 'luxon';

/** Todo "hoje", "semana" e "mês" é calculado neste fuso, independente do fuso do servidor. */
export const ZONE = 'America/Sao_Paulo';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type Clock = () => Date;
export const systemClock: Clock = () => new Date();

export function isDateString(s: string): boolean {
  return DATE_RE.test(s) && DateTime.fromISO(s, { zone: ZONE }).isValid;
}

/** Data local (YYYY-MM-DD) em São Paulo para um instante. */
export function localDateOf(instant: Date | string): string {
  const dt = typeof instant === 'string' ? DateTime.fromISO(instant, { zone: 'utc' }) : DateTime.fromJSDate(instant);
  if (!dt.isValid) throw new Error(`Data inválida: ${String(instant)}`);
  return dt.setZone(ZONE).toISODate()!;
}

export function todayLocal(now: Date): string {
  return localDateOf(now);
}

export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: ZONE }).plus({ days }).toISODate()!;
}

/** Segunda-feira da semana de `date`. */
export function startOfWeek(date: string): string {
  return DateTime.fromISO(date, { zone: ZONE }).startOf('week').toISODate()!;
}

export function startOfMonth(date: string): string {
  return DateTime.fromISO(date, { zone: ZONE }).startOf('month').toISODate()!;
}

export function endOfMonth(date: string): string {
  return DateTime.fromISO(date, { zone: ZONE }).endOf('month').toISODate()!;
}

/** Diferença em dias (inclusiva) entre duas datas locais. */
export function daysBetweenInclusive(from: string, to: string): number {
  const a = DateTime.fromISO(from, { zone: ZONE });
  const b = DateTime.fromISO(to, { zone: ZONE });
  return Math.round(b.diff(a, 'days').days) + 1;
}

/** "HH:mm" em São Paulo. */
export function localTimeOf(instant: string): string {
  return DateTime.fromISO(instant, { zone: 'utc' }).setZone(ZONE).toFormat('HH:mm');
}

/** Minutos desde 00:00 em São Paulo (para comparar com o horário do resumo diário). */
export function localMinutesOfDay(now: Date): number {
  const dt = DateTime.fromJSDate(now).setZone(ZONE);
  return dt.hour * 60 + dt.minute;
}

/** Instante UTC (ISO) correspondente a uma data/hora local em São Paulo. */
export function localToUtcIso(date: string, hour: number, minute: number, second = 0): string {
  return DateTime.fromISO(date, { zone: ZONE })
    .set({ hour, minute, second, millisecond: 0 })
    .toUTC()
    .toISO({ suppressMilliseconds: false })!;
}

const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** "Qui, 19 nov" */
export function shortDateLabel(date: string): string {
  const dt = DateTime.fromISO(date, { zone: ZONE });
  return `${WEEKDAYS[dt.weekday - 1]}, ${dt.day} ${MONTHS[dt.month - 1]}`;
}

/** "19/11/2026" */
export function brDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Próxima data (YYYY-MM-DD) com o dia do mês `day` a partir de `today` (inclusive).
 * Em meses mais curtos usa o último dia (ex.: dia 31 em fevereiro -> 28/29).
 */
export function nextMonthlyDate(today: string, day: number): string {
  const t = DateTime.fromISO(today, { zone: ZONE });
  const inMonth = (m: DateTime) => m.set({ day: Math.min(day, m.daysInMonth ?? 28) });
  const thisMonth = inMonth(t.startOf('month'));
  const target = thisMonth.toISODate()! >= today ? thisMonth : inMonth(t.startOf('month').plus({ months: 1 }));
  return target.toISODate()!;
}

/** "YYYY-MM" do mês da data local. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export interface DateRange {
  from: string; // inclusivo, YYYY-MM-DD local
  to: string; // inclusivo, YYYY-MM-DD local
}

export const PERIOD_KEYWORDS = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'last_7_days',
  'this_month',
  'last_month',
  'last_30_days',
  'last_90_days',
] as const;

/**
 * Resolve um período textual para um intervalo de datas locais.
 * Aceita palavras-chave (PERIOD_KEYWORDS), "YYYY-MM-DD" ou "YYYY-MM-DD..YYYY-MM-DD".
 */
export function resolvePeriod(period: string, now: Date): DateRange {
  const today = todayLocal(now);
  const p = period.trim();
  switch (p) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case 'this_week':
      return { from: startOfWeek(today), to: today };
    case 'last_week': {
      const start = addDays(startOfWeek(today), -7);
      return { from: start, to: addDays(start, 6) };
    }
    case 'last_7_days':
      return { from: addDays(today, -6), to: today };
    case 'this_month':
      return { from: startOfMonth(today), to: today };
    case 'last_month': {
      const start = startOfMonth(addDays(startOfMonth(today), -1));
      return { from: start, to: endOfMonth(start) };
    }
    case 'last_30_days':
      return { from: addDays(today, -29), to: today };
    case 'last_90_days':
      return { from: addDays(today, -89), to: today };
  }
  const range = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(p);
  if (range && isDateString(range[1]!) && isDateString(range[2]!)) {
    return normalizeRange({ from: range[1]!, to: range[2]! });
  }
  if (isDateString(p)) return { from: p, to: p };
  throw new Error(`Período inválido: ${period}`);
}

export function normalizeRange(r: DateRange): DateRange {
  return r.from <= r.to ? r : { from: r.to, to: r.from };
}
