import { z } from 'zod';

/**
 * Cliente mínimo da API Pluggy (https://docs.pluggy.ai).
 * Endpoints confirmados na documentação em nov/2026:
 *   POST /auth                 -> { apiKey }  (válida por 2h; enviada em X-API-KEY)
 *   GET  /items/{id}
 *   GET  /accounts?itemId=     -> { page, total, totalPages, results }
 *   GET  /v2/transactions?accountId=&createdAtFrom=|dateFrom=|ids=&after=
 *        -> { results, next }   (paginação por cursor; o /transactions v1 é descontinuado em 31/12/2026)
 * Só leitura: nunca disparamos PATCH /items em lote (a Pluggy proíbe; a atualização diária é deles).
 */

const AccountSchema = z.object({
  id: z.string(),
  itemId: z.string().optional(),
  type: z.string(),
  subtype: z.string().nullish(),
  name: z.string().nullish(),
  marketingName: z.string().nullish(),
  balance: z.number(),
  currencyCode: z.string().default('BRL'),
});
export type PluggyAccount = z.infer<typeof AccountSchema>;

const PartySchema = z
  .object({
    name: z.string().nullish(),
  })
  .passthrough()
  .nullish();

const TransactionSchema = z.object({
  id: z.string(),
  accountId: z.string().optional(),
  description: z.string().nullish(),
  descriptionRaw: z.string().nullish(),
  currencyCode: z.string().nullish(),
  amount: z.number(),
  date: z.string(),
  type: z.enum(['DEBIT', 'CREDIT']),
  category: z.string().nullish(),
  status: z.string().nullish(),
  operationType: z.string().nullish(),
  createdAt: z.string().nullish(),
  paymentData: z
    .object({
      payer: PartySchema,
      receiver: PartySchema,
      paymentMethod: z.string().nullish(),
    })
    .passthrough()
    .nullish(),
  merchant: z
    .object({
      name: z.string().nullish(),
      businessName: z.string().nullish(),
    })
    .passthrough()
    .nullish(),
});
export type PluggyTransaction = z.infer<typeof TransactionSchema>;

const ItemSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    executionStatus: z.string().nullish(),
    lastUpdatedAt: z.string().nullish(),
    consentExpiresAt: z.string().nullish(),
    error: z.object({ code: z.string(), message: z.string() }).nullish(),
    connector: z.object({ name: z.string() }).passthrough().nullish(),
  })
  .passthrough();
export type PluggyItem = z.infer<typeof ItemSchema>;

export class PluggyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type FetchLike = typeof fetch;

export class PluggyClient {
  private apiKey: { value: string; expiresAt: number } | undefined;

  constructor(
    private readonly baseUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async getApiKey(force = false): Promise<string> {
    // a chave vale 2h; renovamos com folga de 15 min
    if (!force && this.apiKey && Date.now() < this.apiKey.expiresAt) return this.apiKey.value;
    const res = await this.fetchImpl(new URL('/auth', this.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: this.clientId, clientSecret: this.clientSecret }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new PluggyError(`Pluggy /auth respondeu ${res.status}`, res.status);
    const body = z.object({ apiKey: z.string() }).parse(await res.json());
    this.apiKey = { value: body.apiKey, expiresAt: Date.now() + 105 * 60_000 };
    return body.apiKey;
  }

  private async get(pathWithQuery: string, attempt = 0): Promise<unknown> {
    const key = await this.getApiKey(attempt > 0 && attempt < 2);
    const url = new URL(pathWithQuery, this.baseUrl);
    if (url.origin !== new URL(this.baseUrl).origin) throw new Error('URL fora da API Pluggy recusada');
    const res = await this.fetchImpl(url, {
      headers: { 'X-API-KEY': key, accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401 && attempt === 0) return this.get(pathWithQuery, 1); // chave expirada: renova
    if (res.status === 429 && attempt < 2) {
      const wait = Math.min(Number(res.headers.get('RateLimit-Reset') ?? '60') || 60, 60);
      await new Promise((r) => setTimeout(r, wait * 1000));
      return this.get(pathWithQuery, attempt + 2);
    }
    if (!res.ok) throw new PluggyError(`Pluggy GET ${url.pathname} respondeu ${res.status}`, res.status);
    return res.json();
  }

  async getItem(itemId: string): Promise<PluggyItem> {
    return ItemSchema.parse(await this.get(`/items/${encodeURIComponent(itemId)}`));
  }

  async listAccounts(itemId: string): Promise<PluggyAccount[]> {
    const out: PluggyAccount[] = [];
    for (let page = 1; page <= 20; page++) {
      const body = z
        .object({ results: z.array(AccountSchema), totalPages: z.number().optional() })
        .parse(await this.get(`/accounts?itemId=${encodeURIComponent(itemId)}&page=${page}`));
      out.push(...body.results);
      if (!body.totalPages || page >= body.totalPages) break;
    }
    return out;
  }

  /**
   * Lista transações seguindo o cursor `next` até o fim.
   * Use `createdAtFrom` para pegar novidades (transações novas podem ter data no passado).
   */
  async listTransactions(
    accountId: string,
    filter: { createdAtFrom?: string; dateFrom?: string; ids?: string[] },
    maxPages = 40,
  ): Promise<PluggyTransaction[]> {
    const qs = new URLSearchParams({ accountId });
    if (filter.createdAtFrom) qs.set('createdAtFrom', filter.createdAtFrom);
    if (filter.dateFrom) qs.set('dateFrom', filter.dateFrom);
    if (filter.ids?.length) qs.set('ids', filter.ids.join(','));
    let path: string | null = `/v2/transactions?${qs.toString()}`;
    const out: PluggyTransaction[] = [];
    for (let i = 0; path && i < maxPages; i++) {
      const body = z
        .object({ results: z.array(TransactionSchema), next: z.string().nullish() })
        .parse(await this.get(path));
      out.push(...body.results);
      // `next` é uma query string pronta para anexar ao caminho (documentação v2)
      path = body.next && body.next.startsWith('?') ? `/v2/transactions${body.next}` : null;
    }
    return out;
  }
}
