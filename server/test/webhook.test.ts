import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { safeEqual, verifyPluggySignature } from '../src/lib/crypto.js';
import { authenticateWebhook } from '../src/services/pluggy/webhook.js';

const SECRET = 'whsec_' + 'a'.repeat(64);
const body = Buffer.from('{"event":"transactions/created","eventId":"e1"}');

function sign(t: number, secret = SECRET, raw = body) {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.`).update(raw).digest('hex')}`;
}

describe('assinatura do webhook da Pluggy', () => {
  const now = 1_795_000_000;

  it('aceita assinatura válida e recente', () => {
    expect(verifyPluggySignature(body, sign(now), [SECRET], now)).toBe(true);
  });

  it('recusa corpo alterado, segredo errado, cabeçalho malformado e replay antigo', () => {
    expect(verifyPluggySignature(Buffer.from('{"event":"x"}'), sign(now), [SECRET], now)).toBe(false);
    expect(verifyPluggySignature(body, sign(now, 'whsec_outro'), [SECRET], now)).toBe(false);
    expect(verifyPluggySignature(body, 'v1=abc', [SECRET], now)).toBe(false);
    expect(verifyPluggySignature(body, undefined, [SECRET], now)).toBe(false);
    expect(verifyPluggySignature(body, sign(now - 301), [SECRET], now)).toBe(false);
  });

  it('aceita o segredo anterior durante a rotação', () => {
    expect(verifyPluggySignature(body, sign(now, 'whsec_antigo'), [SECRET, 'whsec_antigo'], now)).toBe(true);
  });

  it('exige todas as camadas configuradas e responde 503 em rotação', () => {
    const headers = { 'x-pluggy-signature': sign(now), authorization: 'Bearer segredo-do-header' };
    const cfg = { signingSecrets: [SECRET], headerSecret: 'segredo-do-header', rotating: false };
    expect(authenticateWebhook(cfg, body, headers, now)).toEqual({ ok: true });
    expect(authenticateWebhook(cfg, body, { ...headers, authorization: 'Bearer errado' }, now)).toEqual({
      ok: false,
      status: 401,
    });
    expect(authenticateWebhook({ ...cfg, rotating: true }, body, { ...headers, authorization: 'x' }, now)).toEqual({
      ok: false,
      status: 503,
    });
    // nada configurado: recusa tudo
    expect(authenticateWebhook({ signingSecrets: [], rotating: false }, body, headers, now)).toEqual({
      ok: false,
      status: 401,
    });
  });

  it('comparação de token em tempo constante funciona com tamanhos diferentes', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
