import { describe, expect, it } from 'vitest';
import { decimalToCents, formatBRL, formatSigned, MINUS } from '../src/lib/money.js';

describe('formatação de moeda', () => {
  it('formata em reais no padrão brasileiro', () => {
    expect(formatBRL(0)).toBe('R$ 0,00');
    expect(formatBRL(5)).toBe('R$ 0,05');
    expect(formatBRL(180000)).toBe('R$ 1.800,00');
    expect(formatBRL(4821590)).toBe('R$ 48.215,90');
    expect(formatBRL(123456789012)).toBe('R$ 1.234.567.890,12');
    expect(formatBRL(-21540)).toBe('-R$ 215,40');
  });

  it('sempre coloca o sinal junto ao valor', () => {
    expect(formatSigned(324000)).toBe('+ R$ 3.240,00');
    expect(formatSigned(-111540)).toBe(`${MINUS} R$ 1.115,40`);
    expect(formatSigned(0)).toBe('R$ 0,00');
  });

  it('recusa centavos não inteiros', () => {
    expect(() => formatBRL(10.5)).toThrow();
  });

  it('converte decimais da API em centavos sem erro de ponto flutuante', () => {
    expect(decimalToCents(-212.45)).toBe(-21245);
    expect(decimalToCents(0.1 + 0.2)).toBe(30);
    expect(decimalToCents(1.005)).toBe(101);
    expect(decimalToCents(4439.4)).toBe(443940);
    expect(decimalToCents('1800')).toBe(180000);
    expect(decimalToCents('12,5')).toBe(1250);
    expect(decimalToCents(-0)).toBe(0);
    expect(() => decimalToCents(Number.NaN)).toThrow();
  });
});
