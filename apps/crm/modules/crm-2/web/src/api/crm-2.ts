import {
  type DealsQuery,
  type DealsQueryInput,
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
  type Crm2ExecuteBatchLoadInput,
  type Crm2BatchExecutionReport,
  type Crm2ImportReceipt,
  type Crm2DetectDuplicatesInput,
  type Crm2ResolveDuplicateInput,
  type Crm2DuplicateCandidate,
  type Crm2DuplicateAuditLogEntry,
  type DealDuplicateEvaluationResult,
  type QuoteDuplicateEvaluationResult,
  type Crm2EvaluateDealDuplicateInput,
  type Crm2EvaluateQuoteDuplicateInput,
  DealsListResponseSchema,
  StagesListResponseSchema,
  DealSchema,
  QuoteSchema,
  QuotesListResponseSchema,
  Crm2BatchExecutionReportSchema,
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
  query: DealsQueryInput | DealsQuery,
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

  if (query.sort) {
    searchParams.set('sort', query.sort);
  }

  if (query.order) {
    searchParams.set('order', query.order);
  }

  if ((query as any).is_orphan !== undefined && (query as any).is_orphan !== '') {
    searchParams.set('is_orphan', String((query as any).is_orphan));
  }

  if ((query as any).source_system) {
    searchParams.set('source_system', (query as any).source_system);
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
  if (query.sort) searchParams.set('sort', query.sort);
  if (query.order) searchParams.set('order', query.order);

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

export async function executeBatchLoad(
  input: Crm2ExecuteBatchLoadInput,
  options?: RequestOptions
): Promise<Crm2BatchExecutionReport> {
  const data = await request<unknown>(`${API_BASE}/batches/execute-load`, {
    method: 'POST',
    body: JSON.stringify(input),
    ...options,
  });

  return Crm2BatchExecutionReportSchema.parse(data);
}

export async function getBatchReport(
  batchId: string,
  options?: RequestOptions
): Promise<Crm2BatchExecutionReport> {
  const data = await request<unknown>(`${API_BASE}/batches/${batchId}/report`, {
    method: 'GET',
    ...options,
  });

  return Crm2BatchExecutionReportSchema.parse(data);
}

export async function getImportReceipts(
  options?: RequestOptions
): Promise<{ items: Crm2ImportReceipt[] }> {
  return request<{ items: Crm2ImportReceipt[] }>(`${API_BASE}/import/receipts`, {
    method: 'GET',
    ...options,
  });
}

// ---------------------------------------------------------------------------
// Exact Duplicate Key Policy & Human Review Client (CRM2-12 / KIT-10)
// ---------------------------------------------------------------------------

export async function detectDuplicates(
  input: Crm2DetectDuplicatesInput,
  options?: RequestOptions
): Promise<{
  uniqueRecords: Array<{ id: string; keyValue: string }>;
  duplicateCandidates: Crm2DuplicateCandidate[];
  summary: {
    totalRecords: number;
    uniqueCount: number;
    duplicateGroupCount: number;
    duplicateRecordCount: number;
  };
}> {
  return request(`${API_BASE}/duplicates/detect`, {
    method: 'POST',
    body: JSON.stringify(input),
    ...options,
  });
}

export async function getHeldDuplicates(
  query?: { batchId?: string; keyType?: string; entity?: string },
  options?: RequestOptions
): Promise<{ items: Crm2DuplicateCandidate[]; total: number }> {
  const url = new URL(`${API_BASE}/duplicates/held`, typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
  if (query?.batchId) url.searchParams.set('batchId', query.batchId);
  if (query?.keyType) url.searchParams.set('keyType', query.keyType);
  if (query?.entity) url.searchParams.set('entity', query.entity);

  return request(url.pathname + url.search, {
    method: 'GET',
    ...options,
  });
}

export async function resolveDuplicate(
  input: Crm2ResolveDuplicateInput,
  options?: RequestOptions
): Promise<{ status: 'resolved'; audit: Crm2DuplicateAuditLogEntry }> {
  return request(`${API_BASE}/duplicates/resolve`, {
    method: 'POST',
    body: JSON.stringify(input),
    ...options,
  });
}

export async function getDuplicateAuditLogs(
  query?: {
    candidateId?: string;
    actorId?: string;
    entity?: string;
    page?: number;
    pageSize?: number;
  },
  options?: RequestOptions
): Promise<{
  items: Crm2DuplicateAuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const url = new URL(`${API_BASE}/duplicates/audit`, typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
  if (query?.candidateId) url.searchParams.set('candidateId', query.candidateId);
  if (query?.actorId) url.searchParams.set('actorId', query.actorId);
  if (query?.entity) url.searchParams.set('entity', query.entity);
  if (query?.page) url.searchParams.set('page', String(query.page));
  if (query?.pageSize) url.searchParams.set('pageSize', String(query.pageSize));

  return request(url.pathname + url.search, {
    method: 'GET',
    ...options,
  });
}

export async function evaluateDealDuplicate(
  candidate: Crm2EvaluateDealDuplicateInput,
  options?: RequestOptions
): Promise<DealDuplicateEvaluationResult> {
  return request(`${API_BASE}/deals/evaluate-duplicate`, {
    method: 'POST',
    body: JSON.stringify(candidate),
    ...options,
  });
}

export async function evaluateQuoteDuplicate(
  candidate: Crm2EvaluateQuoteDuplicateInput,
  options?: RequestOptions
): Promise<QuoteDuplicateEvaluationResult> {
  return request(`${API_BASE}/quotes/evaluate-duplicate`, {
    method: 'POST',
    body: JSON.stringify(candidate),
    ...options,
  });
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
  executeBatchLoad,
  getBatchReport,
  getImportReceipts,
  detectDuplicates,
  getHeldDuplicates,
  resolveDuplicate,
  getDuplicateAuditLogs,
  evaluateDealDuplicate,
  evaluateQuoteDuplicate,
};

