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
  number: z.string().nullish(),
  balance: z.number(),
  currencyCode: z.string().default('BRL'),
  creditData: z
    .object({
      level: z.string().nullish(),
      brand: z.string().nullish(),
      balanceCloseDate: z.string().nullish(),
      balanceDueDate: z.string().nullish(),
      availableCreditLimit: z.number().nullish(),
      creditLimit: z.number().nullish(),
      minimumPayment: z.number().nullish(),
    })
    .passthrough()
    .nullish(),
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
  /** Só em contas de cartão de crédito. */
  creditCardMetadata: z
    .object({
      installmentNumber: z.number().nullish(),
      totalInstallments: z.number().nullish(),
      billForecastDate: z.string().nullish(), // "YYYY-MM"
      billId: z.string().nullish(),
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
    clientUserId: z.string().nullish(),
    lastUpdatedAt: z.string().nullish(),
    consentExpiresAt: z.string().nullish(),
    error: z.object({ code: z.string(), message: z.string() }).nullish(),
    connector: z.object({ name: z.string() }).passthrough().nullish(),
  })
  .passthrough();
export type PluggyItem = z.infer<typeof ItemSchema>;

const InvestmentSchema = z
  .object({
    id: z.string(),
    itemId: z.string().nullish(),
    name: z.string(),
    type: z.string(),
    subtype: z.string().nullish(),
    status: z.string().nullish(),
    balance: z.number(),
    rate: z.number().nullish(),
    rateType: z.string().nullish(),
    issuer: z.string().nullish(),
    dueDate: z.string().nullish(),
    date: z.string().nullish(),
  })
  .passthrough();
export type PluggyInvestment = z.infer<typeof InvestmentSchema>;

const BillSchema = z
  .object({
    id: z.string(),
    dueDate: z.string(),
    totalAmount: z.number(),
    minimumPaymentAmount: z.number().nullish(),
  })
  .passthrough();
export type PluggyBill = z.infer<typeof BillSchema>;

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

  /** Chamada com corpo (POST/DELETE). Mesma renovação da chave que o GET. */
  private async send(method: 'POST' | 'DELETE', path: string, body?: unknown, attempt = 0): Promise<unknown> {
    const key = await this.getApiKey(attempt > 0);
    const res = await this.fetchImpl(new URL(path, this.baseUrl), {
      method,
      headers: { 'X-API-KEY': key, accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401 && attempt === 0) return this.send(method, path, body, 1);
    if (!res.ok) throw new PluggyError(`Pluggy ${method} ${path.split('?')[0]} respondeu ${res.status}`, res.status);
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  /** Token de curta duração para o widget Pluggy Connect. `clientUserId` amarra o item ao usuário do Otto. */
  async createConnectToken(opts: { clientUserId: string; webhookUrl?: string }): Promise<string> {
    const body: Record<string, unknown> = { options: { clientUserId: opts.clientUserId } };
    if (opts.webhookUrl) (body.options as Record<string, unknown>).webhookUrl = opts.webhookUrl;
    const r = z.object({ accessToken: z.string() }).parse(await this.send('POST', '/connect_token', body));
    return r.accessToken;
  }

  /** Remove o item na Pluggy (revoga o consentimento). */
  async deleteItem(itemId: string): Promise<void> {
    await this.send('DELETE', `/items/${encodeURIComponent(itemId)}`);
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

  /** GET /investments?itemId= (as Caixinhas do Nubank vêm como CDB). */
  async listInvestments(itemId: string): Promise<PluggyInvestment[]> {
    const out: PluggyInvestment[] = [];
    for (let page = 1; page <= 20; page++) {
      const body = z
        .object({ results: z.array(InvestmentSchema), totalPages: z.number().optional() })
        .parse(await this.get(`/investments?itemId=${encodeURIComponent(itemId)}&page=${page}&pageSize=100`));
      out.push(...body.results);
      if (!body.totalPages || page >= body.totalPages) break;
    }
    return out;
  }

  /** GET /bills?accountId= (faturas fechadas do cartão; nem todo conector fornece). */
  async listBills(accountId: string): Promise<PluggyBill[]> {
    const out: PluggyBill[] = [];
    for (let page = 1; page <= 10; page++) {
      const body = z
        .object({ results: z.array(BillSchema), totalPages: z.number().optional() })
        .parse(await this.get(`/bills?accountId=${encodeURIComponent(accountId)}&page=${page}`));
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
