/**
 * CRM-1 Contacts, Companies and Leads — Frontend API Layer
 * Base Prefix: /api/v1/crm-contacts
 * All responses are Zod-validated before being returned to UI components.
 */
import {
  type CRM1Contact,
  type CRM1ContactRead,
  type CRM1ContactCreate,
  type CRM1ContactPatch,
  type CRM1Company,
  type CRM1CompanyCreate,
  type CRM1CompanyPatch,
  type CRM1Lead,
  type CRM1LeadRead,
  type CRM1LeadCreate,
  type CRM1LeadPatch,
  type CRM1ImportBatchDetail,
  type CRM1ImportReject,
  type CRM1LeadStatus,
  CRM1ContactReadSchema,
  CRM1CompanySchema,
  CRM1LeadReadSchema,
  CRM1ImportBatchDetailSchema,
  CRM1ImportRejectSchema,
  CRM1ListResponseSchema,
} from '@clearshift/contracts';

export class Crm1ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'Crm1ApiError';
  }

  get isPermissionDenied(): boolean {
    return this.statusCode === 403 || this.code === 'FORBIDDEN';
  }
}

const API_BASE = '/api/v1/crm-contacts';

export interface RequestOptions {
  signal?: AbortSignal;
  simulateError?: boolean;
  simulatePermissionDenied?: boolean;
}

export interface ContactsQueryParams {
  search?: string;
  page?: number;
  pageSize?: number;
  companyId?: string;
  leadStatus?: CRM1LeadStatus;
}

export interface CompaniesQueryParams {
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface LeadsQueryParams {
  search?: string;
  contactId?: string;
  status?: CRM1LeadStatus;
  page?: number;
  pageSize?: number;
}

export interface RejectsQueryParams {
  page?: number;
  pageSize?: number;
  reasonCode?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

async function request<T>(
  endpoint: string,
  options: RequestInit & RequestOptions = {}
): Promise<T> {
  const { signal, simulateError, simulatePermissionDenied, ...init } = options;

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
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers ?? {}),
    },
  };
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
    const errorBody = body as { error?: { code?: string; message?: string; details?: unknown } } | null;
    const code = errorBody?.error?.code ?? `HTTP_${res.status}`;
    const message = errorBody?.error?.message ?? `Request failed with status ${res.status}`;
    const details = errorBody?.error?.details;
    throw new Crm1ApiError(res.status, code, message, details);
  }

  return body as T;
}

// ---------------------------------------------------------------------------
// Contacts API
// ---------------------------------------------------------------------------

export async function getContacts(
  params: ContactsQueryParams = {},
  options?: RequestOptions
): Promise<PaginatedResult<CRM1ContactRead>> {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  if (params.companyId) qs.set('companyId', params.companyId);
  if (params.leadStatus) qs.set('leadStatus', params.leadStatus);

  const queryStr = qs.toString() ? `?${qs.toString()}` : '';
  const raw = await request<unknown>(`/contacts${queryStr}`, { method: 'GET', ...options });
  const schema = CRM1ListResponseSchema(CRM1ContactReadSchema);
  return schema.parse(raw);
}

export async function getContactById(
  id: string,
  options?: RequestOptions
): Promise<CRM1ContactRead> {
  const raw = await request<unknown>(`/contacts/${encodeURIComponent(id)}`, {
    method: 'GET',
    ...options,
  });
  return CRM1ContactReadSchema.parse(raw);
}

export async function createContact(
  data: CRM1ContactCreate,
  options?: RequestOptions
): Promise<CRM1ContactRead> {
  const raw = await request<unknown>('/contacts', {
    method: 'POST',
    body: JSON.stringify(data),
    ...options,
  });
  return CRM1ContactReadSchema.parse(raw);
}

export async function updateContact(
  id: string,
  data: CRM1ContactPatch,
  options?: RequestOptions
): Promise<CRM1ContactRead> {
  const raw = await request<unknown>(`/contacts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
    ...options,
  });
  return CRM1ContactReadSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// Companies API
// ---------------------------------------------------------------------------

export async function getCompanies(
  params: CompaniesQueryParams = {},
  options?: RequestOptions
): Promise<PaginatedResult<CRM1Company>> {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));

  const queryStr = qs.toString() ? `?${qs.toString()}` : '';
  const raw = await request<unknown>(`/companies${queryStr}`, { method: 'GET', ...options });
  const schema = CRM1ListResponseSchema(CRM1CompanySchema);
  return schema.parse(raw);
}

export async function getCompanyById(
  id: string,
  options?: RequestOptions
): Promise<CRM1Company> {
  const raw = await request<unknown>(`/companies/${encodeURIComponent(id)}`, {
    method: 'GET',
    ...options,
  });
  return CRM1CompanySchema.parse(raw);
}

export async function createCompany(
  data: CRM1CompanyCreate,
  options?: RequestOptions
): Promise<CRM1Company> {
  const raw = await request<unknown>('/companies', {
    method: 'POST',
    body: JSON.stringify(data),
    ...options,
  });
  return CRM1CompanySchema.parse(raw);
}

export async function updateCompany(
  id: string,
  data: CRM1CompanyPatch,
  options?: RequestOptions
): Promise<CRM1Company> {
  const raw = await request<unknown>(`/companies/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
    ...options,
  });
  return CRM1CompanySchema.parse(raw);
}

// ---------------------------------------------------------------------------
// Leads API
// ---------------------------------------------------------------------------

export async function getLeads(
  params: LeadsQueryParams = {},
  options?: RequestOptions
): Promise<PaginatedResult<CRM1LeadRead>> {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.contactId) qs.set('contactId', params.contactId);
  if (params.status) qs.set('status', params.status);
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));

  const queryStr = qs.toString() ? `?${qs.toString()}` : '';
  const raw = await request<unknown>(`/leads${queryStr}`, { method: 'GET', ...options });
  const schema = CRM1ListResponseSchema(CRM1LeadReadSchema);
  return schema.parse(raw);
}

export async function getLeadById(
  id: string,
  options?: RequestOptions
): Promise<CRM1LeadRead> {
  const raw = await request<unknown>(`/leads/${encodeURIComponent(id)}`, {
    method: 'GET',
    ...options,
  });
  return CRM1LeadReadSchema.parse(raw);
}

export async function createLead(
  data: CRM1LeadCreate,
  options?: RequestOptions
): Promise<CRM1LeadRead> {
  const raw = await request<unknown>('/leads', {
    method: 'POST',
    body: JSON.stringify(data),
    ...options,
  });
  return CRM1LeadReadSchema.parse(raw);
}

export async function updateLead(
  id: string,
  data: CRM1LeadPatch,
  options?: RequestOptions
): Promise<CRM1LeadRead> {
  const raw = await request<unknown>(`/leads/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
    ...options,
  });
  return CRM1LeadReadSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// Imports & Rejects API
// ---------------------------------------------------------------------------

export async function getImportBatch(
  batchId: string,
  options?: RequestOptions
): Promise<CRM1ImportBatchDetail> {
  const raw = await request<unknown>(`/imports/${encodeURIComponent(batchId)}`, {
    method: 'GET',
    ...options,
  });
  return CRM1ImportBatchDetailSchema.parse(raw);
}

export async function getImportRejects(
  batchId: string,
  params: RejectsQueryParams = {},
  options?: RequestOptions
): Promise<PaginatedResult<CRM1ImportReject>> {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  if (params.reasonCode) qs.set('reasonCode', params.reasonCode);

  const queryStr = qs.toString() ? `?${qs.toString()}` : '';
  const raw = await request<unknown>(
    `/imports/${encodeURIComponent(batchId)}/rejects${queryStr}`,
    { method: 'GET', ...options }
  );
  const schema = CRM1ListResponseSchema(CRM1ImportRejectSchema);
  return schema.parse(raw);
}
