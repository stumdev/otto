import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Comparação em tempo constante. Compara os hashes SHA-256 (sempre 32 bytes),
 * então o tempo não depende nem do conteúdo nem do tamanho do segredo.
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

/** Extrai o token de "Authorization: Bearer <token>". */
export function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return m?.[1];
}

export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

/**
 * Verifica o cabeçalho X-Pluggy-Signature ("t=<unix>,v1=<hex HMAC-SHA256>"),
 * conforme https://docs.pluggy.ai/docs/developer-tools/webhook-security:
 * HMAC-SHA256 de "<t>.<corpo bruto>" usando o segredo completo (com "whsec_") como chave.
 */
export function verifyPluggySignature(
  rawBody: Buffer,
  header: string | undefined,
  secrets: string[],
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!header || secrets.length === 0) return false;
  const parts = new Map<string, string>();
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    parts.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  const t = parts.get('t');
  const received = parts.get('v1');
  if (!t || !received || !/^[0-9]{1,12}$/.test(t) || !/^[0-9a-f]{64}$/.test(received)) return false;
  if (Math.abs(nowSeconds - Number(t)) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const receivedBytes = Buffer.from(received, 'utf8');
  let ok = false;
  for (const secret of secrets) {
    const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest('hex');
    const expectedBytes = Buffer.from(expected, 'utf8');
    if (expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes)) ok = true;
  }
  return ok;
}
