import { ErrorEnvelopeSchema } from '@clearshift/contracts/common';
import {
  CRM1_API_PREFIX,
  CRM1CompanyCreateSchema,
  CRM1CompanyListQuerySchema,
  CRM1CompanyPatchSchema,
  CRM1CompanySchema,
  CRM1ContactCreateSchema,
  CRM1ContactListQuerySchema,
  CRM1ContactPatchSchema,
  CRM1ContactReadSchema,
  CRM1ImportBatchDetailSchema,
  CRM1ImportBatchListSchema,
  CRM1ImportCreateSchema,
  CRM1ImportListQuerySchema,
  CRM1ImportRejectListSchema,
  CRM1LeadCreateSchema,
  CRM1LeadListQuerySchema,
  CRM1LeadPatchSchema,
  CRM1LeadReadSchema,
  CRM1ListResponseSchema,
  CRM1ImportRejectSchema,
  type CRM1Company,
  type CRM1CompanyListQueryInput,
  type CRM1ContactListQueryInput,
  type CRM1ContactRead,
  type CRM1ImportBatch,
  type CRM1ImportBatchDetail,
  type CRM1ImportBatchListQuery,
  type CRM1ImportCreate,
  type CRM1ImportReject,
  type CRM1LeadListQueryInput,
  type CRM1LeadRead,
} from '@clearshift/contracts/crm-1';

export interface Crm1Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export class Crm1ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'Crm1ApiError';
  }
}

export interface Crm1ApiClientOptions {
  getAccessToken: () => string | null | Promise<string | null>;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class Crm1ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: Crm1ApiClientOptions) {
    this.baseUrl = options.baseUrl ?? CRM1_API_PREFIX;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async listContacts(
    query: CRM1ContactListQueryInput,
    signal?: AbortSignal
  ): Promise<Crm1Page<CRM1ContactRead>> {
    const parsedQuery = CRM1ContactListQuerySchema.parse(query);
    const response = await this.request(
      `/contacts${this.queryString(parsedQuery)}`,
      CRM1ListResponseSchema(CRM1ContactReadSchema),
      { method: 'GET', ...(signal ? { signal } : {}) }
    );
    return response;
  }

  async createContact(input: unknown): Promise<CRM1ContactRead> {
    const body = CRM1ContactCreateSchema.parse(input);
    return this.request('/contacts', CRM1ContactReadSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async updateContact(id: string, input: unknown): Promise<CRM1ContactRead> {
    const body = CRM1ContactPatchSchema.parse(input);
    return this.request(`/contacts/${encodeURIComponent(id)}`, CRM1ContactReadSchema, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  async listCompanies(
    query: CRM1CompanyListQueryInput,
    signal?: AbortSignal
  ): Promise<Crm1Page<CRM1Company>> {
    const parsedQuery = CRM1CompanyListQuerySchema.parse(query);
    return this.request(
      `/companies${this.queryString(parsedQuery)}`,
      CRM1ListResponseSchema(CRM1CompanySchema),
      { method: 'GET', ...(signal ? { signal } : {}) }
    );
  }

  async createCompany(input: unknown): Promise<CRM1Company> {
    const body = CRM1CompanyCreateSchema.parse(input);
    return this.request('/companies', CRM1CompanySchema, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async updateCompany(id: string, input: unknown): Promise<CRM1Company> {
    const body = CRM1CompanyPatchSchema.parse(input);
    return this.request(`/companies/${encodeURIComponent(id)}`, CRM1CompanySchema, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  async listLeads(
    query: CRM1LeadListQueryInput,
    signal?: AbortSignal
  ): Promise<Crm1Page<CRM1LeadRead>> {
    const parsedQuery = CRM1LeadListQuerySchema.parse(query);
    return this.request(
      `/leads${this.queryString(parsedQuery)}`,
      CRM1ListResponseSchema(CRM1LeadReadSchema),
      { method: 'GET', ...(signal ? { signal } : {}) }
    );
  }

  async createLead(input: unknown): Promise<CRM1LeadRead> {
    const body = CRM1LeadCreateSchema.parse(input);
    return this.request('/leads', CRM1LeadReadSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async updateLead(id: string, input: unknown): Promise<CRM1LeadRead> {
    const body = CRM1LeadPatchSchema.parse(input);
    return this.request(`/leads/${encodeURIComponent(id)}`, CRM1LeadReadSchema, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  async listImports(
    query: CRM1ImportBatchListQuery,
    signal?: AbortSignal
  ): Promise<Crm1Page<CRM1ImportBatch>> {
    const parsedQuery = CRM1ImportListQuerySchema.parse(query);
    return this.request(
      `/imports${this.queryString(parsedQuery)}`,
      CRM1ImportBatchListSchema,
      { method: 'GET', ...(signal ? { signal } : {}) }
    );
  }

  async getImport(batchId: string, signal?: AbortSignal): Promise<CRM1ImportBatchDetail> {
    return this.request(
      `/imports/${encodeURIComponent(batchId)}`,
      CRM1ImportBatchDetailSchema,
      { method: 'GET', ...(signal ? { signal } : {}) }
    );
  }

  async listImportRejects(
    batchId: string,
    query: { page?: number; pageSize?: number },
    signal?: AbortSignal
  ): Promise<Crm1Page<CRM1ImportReject>> {
    const parsedQuery = CRM1ImportListQuerySchema.pick({
      page: true,
      pageSize: true,
    }).parse(query);
    return this.request(
      `/imports/${encodeURIComponent(batchId)}/rejects${this.queryString(parsedQuery)}`,
      CRM1ImportRejectListSchema,
      { method: 'GET', ...(signal ? { signal } : {}) }
    );
  }

  async createImport(input: CRM1ImportCreate, idempotencyKey: string): Promise<CRM1ImportBatchDetail> {
    const body = CRM1ImportCreateSchema.parse(input);
    const key = idempotencyKey.trim();
    if (!key || key.length > 256) {
      throw new TypeError('Idempotency key must contain 1 to 256 characters.');
    }
    return this.request('/imports', CRM1ImportBatchDetailSchema, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Idempotency-Key': key },
    });
  }

  private queryString(query: Record<string, string | number | boolean | undefined>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') {
        params.set(key, String(value));
      }
    }
    const serialized = params.toString();
    return serialized ? `?${serialized}` : '';
  }

  private async request<T>(
    path: string,
    responseSchema: { parse: (value: unknown) => T },
    init: RequestInit
  ): Promise<T> {
    const accessToken = await this.options.getAccessToken();
    if (!accessToken?.trim()) {
      throw new Crm1ApiError(401, 'UNAUTHENTICATED', 'Your session has expired. Sign in and try again.');
    }

    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    headers.set('Authorization', `Bearer ${accessToken}`);
    if (init.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      credentials: 'same-origin',
      headers,
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      if (cause instanceof SyntaxError || cause instanceof TypeError) {
        throw new Crm1ApiError(
          response.status,
          'INVALID_RESPONSE',
          'The server returned an unreadable response. Please try again.'
        );
      }
      throw cause;
    }

    if (!response.ok) {
      const parsedError = ErrorEnvelopeSchema.safeParse(payload);
      const error = parsedError.success
        ? 'error' in parsedError.data
          ? parsedError.data.error
          : parsedError.data
        : undefined;
      throw new Crm1ApiError(
        response.status,
        error?.code ?? 'REQUEST_FAILED',
        error?.message ?? 'The request could not be completed. Please try again.'
      );
    }

    return responseSchema.parse(payload);
  }
}

export function createCrm1ApiClient(options: Crm1ApiClientOptions): Crm1ApiClient {
  return new Crm1ApiClient(options);
}
