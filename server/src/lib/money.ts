/**
 * Dinheiro sempre em centavos inteiros. Nunca use float para somar valores.
 * A formatação é feita à mão (e não com Intl) para ser idêntica em qualquer
 * runtime: Intl insere espaços não separáveis que variam entre versões do ICU.
 */

export const MINUS = '−'; // "−" (sinal de menos tipográfico)

/** 123456 -> "R$ 1.234,56"; -123456 -> "-R$ 1.234,56" (use formatSigned para o padrão do app). */
export function formatBRL(cents: number): string {
  assertCents(cents);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const reais = Math.floor(abs / 100);
  const centavos = abs % 100;
  const reaisStr = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}R$ ${reaisStr},${String(centavos).padStart(2, '0')}`;
}

/** Sempre com sinal junto ao valor: "+ R$ 3.240,00" / "− R$ 1.115,40". Zero sai sem sinal. */
export function formatSigned(cents: number): string {
  assertCents(cents);
  if (cents === 0) return formatBRL(0);
  return `${cents > 0 ? '+' : MINUS} ${formatBRL(Math.abs(cents))}`;
}

/**
 * Converte um valor decimal vindo de API (ex.: -212.45) em centavos inteiros.
 * Usa a representação decimal em string para não herdar erro de float
 * (ex.: 1.005 * 100 = 100.49999...).
 */
export function decimalToCents(value: number | string): number {
  const str = typeof value === 'number' ? numberToPlainString(value) : value.trim();
  const m = /^([+-])?(\d+)(?:[.,](\d+))?$/.exec(str);
  if (!m) throw new Error(`Valor monetário inválido: ${String(value)}`);
  const sign = m[1] === '-' ? -1 : 1;
  const intPart = Number(m[2]);
  const frac = (m[3] ?? '').padEnd(3, '0');
  // arredonda meio para cima no terceiro dígito
  let cents = intPart * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) cents += 1;
  const result = sign * cents;
  return Object.is(result, -0) ? 0 : result;
}

function numberToPlainString(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Valor monetário inválido: ${n}`);
  // toFixed(6) evita notação exponencial e preserva precisão suficiente para centavos
  return n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function assertCents(cents: number): void {
  if (!Number.isSafeInteger(cents)) throw new Error(`Centavos devem ser inteiros: ${cents}`);
}
