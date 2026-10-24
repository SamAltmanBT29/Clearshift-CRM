import {
  type CRM1ContactRead,
  type CRM1ContactCreate,
  type CRM1ContactPatch,
  type CRM1Company,
  type CRM1CompanyCreate,
  type CRM1CompanyPatch,
  type CRM1LeadRead,
  type CRM1LeadCreate,
  type CRM1LeadPatch,
  type CRM1ImportBatchDetail,
  type CRM1ImportReject,
  CRM1ContactReadSchema,
  CRM1CompanySchema,
  CRM1LeadReadSchema,
  CRM1ImportBatchDetailSchema,
  CRM1ImportRejectSchema,
} from '@clearshift/contracts';

const API_BASE = '/api/v1/crm-contacts';

export class Crm1ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'Crm1ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  isPermissionDenied(): boolean {
    return this.status === 403 || this.code === 'FORBIDDEN';
  }
}

export interface ContactsQueryParams {
  page?: number | undefined;
  pageSize?: number | undefined;
  search?: string | undefined;
  leadStatus?: string | undefined;
  companyId?: string | undefined;
}

export interface CompaniesQueryParams {
  page?: number | undefined;
  pageSize?: number | undefined;
  search?: string | undefined;
}

export interface LeadsQueryParams {
  page?: number | undefined;
  pageSize?: number | undefined;
  search?: string | undefined;
  status?: string | undefined;
}

export interface RejectsQueryParams {
  page?: number | undefined;
  pageSize?: number | undefined;
  reasonCode?: string | undefined;
}

export interface RequestOptions {
  method?: string | undefined;
  body?: string | undefined;
  headers?: Record<string, string> | undefined;
  signal?: AbortSignal | undefined;
  simulatePermissionDenied?: boolean | undefined;
  simulateError?: boolean | undefined;
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

async function request<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { signal, simulateError, simulatePermissionDenied, method = 'GET', body: reqBody, headers } = options;

  if (simulatePermissionDenied) {
    throw new Crm1ApiError(
      403,
      'FORBIDDEN',
      'Insufficient permissions to access this CRM-1 resource.'
    );
  }

  if (simulateError) {
    throw new Crm1ApiError(500, 'INTERNAL_SERVER_ERROR', 'Simulated network failure.');
  }

  const url = `${API_BASE}${endpoint}`;
  let res: Response;
  const fetchOptions: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(headers ?? {}),
    },
  };
  if (reqBody) {
    fetchOptions.body = reqBody;
  }
  if (signal) {
    fetchOptions.signal = signal;
  }
  try {
    res = await fetch(url, fetchOptions);
  } catch (err: unknown) {
    if (err instanceof Crm1ApiError) throw err;
    const msg = err instanceof Error ? err.message : 'Network request failed';
    throw new Crm1ApiError(0, 'NETWORK_ERROR', msg);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const errorBody = body as { code?: string; message?: string; details?: unknown } | null;
    const code = errorBody?.code || (res.status === 403 ? 'FORBIDDEN' : 'API_ERROR');
    const message = errorBody?.message || res.statusText || 'API request failed';
    throw new Crm1ApiError(res.status, code, message, errorBody?.details);
  }

  return body as T;
}

// ---------------------------------------------------------------------------
// Contacts Endpoints
// ---------------------------------------------------------------------------

export async function getContacts(
  params: ContactsQueryParams = {},
  options: RequestOptions = {}
): Promise<PaginatedResult<CRM1ContactRead>> {
  const sp = new URLSearchParams();
  if (params.page !== undefined) sp.set('page', String(params.page));
  if (params.pageSize !== undefined) sp.set('pageSize', String(params.pageSize));
  if (params.search) sp.set('search', params.search);
  if (params.leadStatus) sp.set('status', params.leadStatus);
  if (params.companyId) sp.set('companyId', params.companyId);

  const qs = sp.toString() ? `?${sp.toString()}` : '';
  const data = await request<{ items: unknown[]; page: number; pageSize: number; total: number }>(
    `/contacts${qs}`,
    { ...options, method: 'GET' }
  );

  return {
    items: data.items.map((it) => CRM1ContactReadSchema.parse(it)),
    page: data.page,
    pageSize: data.pageSize,
    total: data.total,
  };
}

export async function getContactById(
  id: string,
  options: RequestOptions = {}
): Promise<CRM1ContactRead> {
  const data = await request<unknown>(`/contacts/${encodeURIComponent(id)}`, {
    ...options,
    method: 'GET',
  });
  return CRM1ContactReadSchema.parse(data);
}

export async function createContact(
  payload: CRM1ContactCreate,
  options: RequestOptions = {}
): Promise<CRM1ContactRead> {
  const data = await request<unknown>('/contacts', {
    ...options,
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return CRM1ContactReadSchema.parse(data);
}

export async function updateContact(
  id: string,
  payload: CRM1ContactPatch,
  options: RequestOptions = {}
): Promise<CRM1ContactRead> {
  const data = await request<unknown>(`/contacts/${encodeURIComponent(id)}`, {
    ...options,
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return CRM1ContactReadSchema.parse(data);
}

// ---------------------------------------------------------------------------
// Companies Endpoints
// ---------------------------------------------------------------------------

export async function getCompanies(
  params: CompaniesQueryParams = {},
  options: RequestOptions = {}
): Promise<PaginatedResult<CRM1Company>> {
  const sp = new URLSearchParams();
  if (params.page !== undefined) sp.set('page', String(params.page));
  if (params.pageSize !== undefined) sp.set('pageSize', String(params.pageSize));
  if (params.search) sp.set('search', params.search);

  const qs = sp.toString() ? `?${sp.toString()}` : '';
  const data = await request<{ items: unknown[]; page: number; pageSize: number; total: number }>(
    `/companies${qs}`,
    { ...options, method: 'GET' }
  );

  return {
    items: data.items.map((it) => CRM1CompanySchema.parse(it)),
    page: data.page,
    pageSize: data.pageSize,
    total: data.total,
  };
}

export async function getCompanyById(
  id: string,
  options: RequestOptions = {}
): Promise<CRM1Company> {
  const data = await request<unknown>(`/companies/${encodeURIComponent(id)}`, {
    ...options,
    method: 'GET',
  });
  return CRM1CompanySchema.parse(data);
}

export async function createCompany(
  payload: CRM1CompanyCreate,
  options: RequestOptions = {}
): Promise<CRM1Company> {
  const data = await request<unknown>('/companies', {
    ...options,
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return CRM1CompanySchema.parse(data);
}

export async function updateCompany(
  id: string,
  payload: CRM1CompanyPatch,
  options: RequestOptions = {}
): Promise<CRM1Company> {
  const data = await request<unknown>(`/companies/${encodeURIComponent(id)}`, {
    ...options,
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return CRM1CompanySchema.parse(data);
}

// ---------------------------------------------------------------------------
// Leads Endpoints
// ---------------------------------------------------------------------------

export async function getLeads(
  params: LeadsQueryParams = {},
  options: RequestOptions = {}
): Promise<PaginatedResult<CRM1LeadRead>> {
  const sp = new URLSearchParams();
  if (params.page !== undefined) sp.set('page', String(params.page));
  if (params.pageSize !== undefined) sp.set('pageSize', String(params.pageSize));
  if (params.search) sp.set('search', params.search);
  if (params.status) sp.set('status', params.status);

  const qs = sp.toString() ? `?${sp.toString()}` : '';
  const data = await request<{ items: unknown[]; page: number; pageSize: number; total: number }>(
    `/leads${qs}`,
    { ...options, method: 'GET' }
  );

  return {
    items: data.items.map((it) => CRM1LeadReadSchema.parse(it)),
    page: data.page,
    pageSize: data.pageSize,
    total: data.total,
  };
}

export async function getLeadById(
  id: string,
  options: RequestOptions = {}
): Promise<CRM1LeadRead> {
  const data = await request<unknown>(`/leads/${encodeURIComponent(id)}`, {
    ...options,
    method: 'GET',
  });
  return CRM1LeadReadSchema.parse(data);
}

export async function createLead(
  payload: CRM1LeadCreate,
  options: RequestOptions = {}
): Promise<CRM1LeadRead> {
  const data = await request<unknown>('/leads', {
    ...options,
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return CRM1LeadReadSchema.parse(data);
}

export async function updateLead(
  id: string,
  payload: CRM1LeadPatch,
  options: RequestOptions = {}
): Promise<CRM1LeadRead> {
  const data = await request<unknown>(`/leads/${encodeURIComponent(id)}`, {
    ...options,
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return CRM1LeadReadSchema.parse(data);
}

// ---------------------------------------------------------------------------
// Imports & Rejects Endpoints
// ---------------------------------------------------------------------------

export async function getImportBatch(
  batchId: string,
  options: RequestOptions = {}
): Promise<CRM1ImportBatchDetail> {
  const data = await request<unknown>(`/imports/${encodeURIComponent(batchId)}`, {
    ...options,
    method: 'GET',
  });
  return CRM1ImportBatchDetailSchema.parse(data);
}

export async function getImportRejects(
  batchId: string,
  params: RejectsQueryParams = {},
  options: RequestOptions = {}
): Promise<PaginatedResult<CRM1ImportReject>> {
  const sp = new URLSearchParams();
  if (params.page !== undefined) sp.set('page', String(params.page));
  if (params.pageSize !== undefined) sp.set('pageSize', String(params.pageSize));
  if (params.reasonCode) sp.set('reasonCode', params.reasonCode);

  const qs = sp.toString() ? `?${sp.toString()}` : '';
  const data = await request<{ items: unknown[]; page: number; pageSize: number; total: number }>(
    `/imports/${encodeURIComponent(batchId)}/rejects${qs}`,
    { ...options, method: 'GET' }
  );

  return {
    items: data.items.map((it) => CRM1ImportRejectSchema.parse(it)),
    page: data.page,
    pageSize: data.pageSize,
    total: data.total,
  };
}
