import {
  type DealsQuery,
  type DealsListResponse,
  type StagesListResponse,
  type QuotesQueryInput,
  type QuotesListResponse,
  type Deal,
  type Quote,
  type CreateDealInput,
  type UpdateDealInput,
  type CreateQuoteInput,
  type UpdateQuoteInput,
  DealsListResponseSchema,
  StagesListResponseSchema,
  DealSchema,
  QuoteSchema,
  QuotesListResponseSchema,
} from '@clearshift/contracts';

export class Crm2ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'Crm2ApiError';
  }

  get isPermissionDenied(): boolean {
    return this.statusCode === 403 || this.code === 'FORBIDDEN';
  }
}

const API_BASE = '/api/v1/crm-deals';

export interface RequestOptions {
  signal?: AbortSignal;
  permissionHeader?: string;
  simulateError?: boolean;
  simulatePermissionDenied?: boolean;
}

async function request<T>(
  endpoint: string,
  options: RequestInit & RequestOptions = {}
): Promise<T> {
  const { signal, permissionHeader, simulateError, simulatePermissionDenied, ...init } = options;

  const url = new URL(endpoint, typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
  if (simulateError) {
    url.searchParams.set('simulateError', 'true');
  }
  if (simulatePermissionDenied) {
    url.searchParams.set('simulatePermissionDenied', 'true');
  }

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
  };

  if (permissionHeader) {
    headers['x-user-permission'] = permissionHeader;
  }

  let response: Response;
  try {
    const fetchInit: RequestInit = {
      ...init,
      headers,
    };
    if (signal) {
      fetchInit.signal = signal;
    }
    response = await fetch(url.toString(), fetchInit);
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw err;
    }
    throw new Crm2ApiError(0, 'NETWORK_ERROR', 'Network communication failed. Please verify your connection.');
  }

  if (!response.ok) {
    let errorData: any = {};
    try {
      errorData = await response.json();
    } catch {
      // response was not JSON
    }
    throw new Crm2ApiError(
      response.status,
      errorData.code || 'HTTP_ERROR',
      errorData.message || `Request failed with status ${response.status}`,
      errorData.details
    );
  }

  return response.json() as Promise<T>;
}

export async function getDeals(
  query: DealsQuery,
  options?: RequestOptions
): Promise<DealsListResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set('page', String(query.page));
  searchParams.set('pageSize', String(query.pageSize));

  if (query.search && query.search.trim() !== '') {
    searchParams.set('search', query.search.trim());
  }

  if (query.stage) {
    searchParams.set('stage', query.stage);
  }

  const data = await request<unknown>(`${API_BASE}/deals?${searchParams.toString()}`, {
    method: 'GET',
    ...options,
  });

  return DealsListResponseSchema.parse(data);
}

export async function getDealById(
  id: string,
  options?: RequestOptions
): Promise<Deal> {
  const data = await request<unknown>(`${API_BASE}/deals/${id}`, {
    method: 'GET',
    ...options,
  });

  return DealSchema.parse(data);
}

export async function createDeal(
  input: CreateDealInput,
  options?: RequestOptions
): Promise<Deal> {
  const data = await request<unknown>(`${API_BASE}/deals`, {
    method: 'POST',
    body: JSON.stringify(input),
    ...options,
  });

  return DealSchema.parse(data);
}

export async function updateDeal(
  id: string,
  input: UpdateDealInput,
  options?: RequestOptions
): Promise<Deal> {
  const data = await request<unknown>(`${API_BASE}/deals/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    ...options,
  });

  return DealSchema.parse(data);
}

export async function getStages(
  options?: RequestOptions
): Promise<StagesListResponse> {
  const data = await request<unknown>(`${API_BASE}/stages`, {
    method: 'GET',
    ...options,
  });

  return StagesListResponseSchema.parse(data);
}

export async function getQuotes(
  query: QuotesQueryInput = {},
  options?: RequestOptions
): Promise<QuotesListResponse> {
  const searchParams = new URLSearchParams();
  if (query.page) searchParams.set('page', String(query.page));
  if (query.pageSize) searchParams.set('pageSize', String(query.pageSize));
  if (query.deal_id) searchParams.set('deal_id', query.deal_id);

  const data = await request<unknown>(`${API_BASE}/quotes?${searchParams.toString()}`, {
    method: 'GET',
    ...options,
  });

  return QuotesListResponseSchema.parse(data);
}

export async function getQuoteById(
  id: string,
  options?: RequestOptions
): Promise<Quote> {
  const data = await request<unknown>(`${API_BASE}/quotes/${id}`, {
    method: 'GET',
    ...options,
  });

  return QuoteSchema.parse(data);
}

export async function createQuote(
  input: CreateQuoteInput,
  options?: RequestOptions
): Promise<Quote> {
  const data = await request<unknown>(`${API_BASE}/quotes`, {
    method: 'POST',
    body: JSON.stringify(input),
    ...options,
  });

  return QuoteSchema.parse(data);
}

export async function updateQuote(
  id: string,
  input: UpdateQuoteInput,
  options?: RequestOptions
): Promise<Quote> {
  const data = await request<unknown>(`${API_BASE}/quotes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    ...options,
  });

  return QuoteSchema.parse(data);
}

export const crm2Api = {
  getDeals,
  getDealById,
  createDeal,
  updateDeal,
  getStages,
  getQuotes,
  getQuoteById,
  createQuote,
  updateQuote,
};

