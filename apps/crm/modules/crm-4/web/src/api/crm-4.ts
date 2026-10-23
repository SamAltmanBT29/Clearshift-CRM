/**
 * CRM-4 Marketing Lists and Campaign History — Frontend API Layer
 * API base: /api/v1/crm-marketing
 * All responses are Zod-validated before being returned to the UI.
 */
import {
  type CRM4ListQuery,
  type CRM4ListResponse,
  type CRM4List,
  type CRM4ListCreate,
  type CRM4ListPatch,
  type CRM4CampaignQuery,
  type CRM4CampaignListResponse,
  type CRM4Campaign,
  type CRM4CampaignCreate,
  type CRM4CampaignPatch,
  type CRM4MemberQuery,
  type CRM4MemberListResponse,
  type CRM4Member,
  type CRM4MemberCreate,
  type CRM4Consent,
  type CRM4ConsentSet,
  CRM4ListResponseSchema,
  CRM4ListSchema,
  CRM4CampaignListResponseSchema,
  CRM4CampaignSchema,
  CRM4MemberListResponseSchema,
  CRM4MemberSchema,
  CRM4ConsentSchema,
} from '@clearshift/contracts';

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------
export class Crm4ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'Crm4ApiError';
  }

  get isPermissionDenied(): boolean {
    return this.statusCode === 403 || this.code === 'FORBIDDEN';
  }
}

const API_BASE = '/api/v1/crm-marketing';

export interface RequestOptions {
  signal?: AbortSignal;
  simulateError?: boolean;
  simulatePermissionDenied?: boolean;
}

// ---------------------------------------------------------------------------
// Internal fetch helper
// ---------------------------------------------------------------------------
async function request<T>(
  endpoint: string,
  options: RequestInit & RequestOptions = {}
): Promise<T> {
  const { signal, simulateError, simulatePermissionDenied, ...init } = options;

  // Early simulation guards (matching CRM-5 pattern for testability without network)
  if (simulatePermissionDenied) {
    throw new Crm4ApiError(
      403,
      'FORBIDDEN',
      'Access denied: insufficient permissions to access CRM-4 marketing module',
      { requiredCapability: 'module.read' }
    );
  }
  if (simulateError) {
    throw new Crm4ApiError(
      500,
      'INTERNAL_SERVER_ERROR',
      'Simulated server communication error during query execution.'
    );
  }

  let origin = '';
  if (typeof window !== 'undefined' && window.location?.origin) {
    origin = window.location.origin;
  }
  const url = new URL(endpoint, origin || 'http://localhost');

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
  };

  const fetchInit: RequestInit = { ...init, headers };
  if (signal) {
    fetchInit.signal = signal;
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), fetchInit);
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    throw new Crm4ApiError(0, 'NETWORK_ERROR', 'Network error: unable to reach the server.');
  }

  let body: unknown;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    body = await response.json();
  } else {
    body = null;
  }

  if (!response.ok) {
    const err = (body && typeof body === 'object') ? (body as Record<string, any>) : {};
    throw new Crm4ApiError(
      response.status,
      err['code'] ?? 'API_ERROR',
      err['message'] ?? `Request failed with status ${response.status}`,
      err['details']
    );
  }

  return body as T;
}

// ---------------------------------------------------------------------------
// Marketing Lists
// ---------------------------------------------------------------------------

export async function getMarketingLists(
  query: Partial<CRM4ListQuery> = {},
  opts: RequestOptions = {}
): Promise<CRM4ListResponse> {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));

  const raw = await request<unknown>(`${API_BASE}/lists?${params}`, {
    method: 'GET',
    ...opts,
  });
  return CRM4ListResponseSchema.parse(raw);
}

export async function getMarketingListById(
  id: string,
  opts: RequestOptions = {}
): Promise<CRM4List> {
  const raw = await request<unknown>(`${API_BASE}/lists/${encodeURIComponent(id)}`, {
    method: 'GET',
    ...opts,
  });
  return CRM4ListSchema.parse(raw);
}

export async function createList(
  body: CRM4ListCreate,
  opts: RequestOptions = {}
): Promise<CRM4List> {
  const raw = await request<unknown>(`${API_BASE}/lists`, {
    method: 'POST',
    body: JSON.stringify(body),
    ...opts,
  });
  return CRM4ListSchema.parse(raw);
}

export const createMarketingList = createList;

export async function patchList(
  id: string,
  body: CRM4ListPatch,
  opts: RequestOptions = {}
): Promise<CRM4List> {
  const raw = await request<unknown>(`${API_BASE}/lists/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    ...opts,
  });
  return CRM4ListSchema.parse(raw);
}

export const updateMarketingList = patchList;

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export async function getCampaigns(
  query: Partial<CRM4CampaignQuery> = {},
  opts: RequestOptions = {}
): Promise<CRM4CampaignListResponse> {
  const params = new URLSearchParams();
  if (query.listId) params.set('listId', query.listId);
  if (query.search) params.set('search', query.search);
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));

  const raw = await request<unknown>(`${API_BASE}/campaigns?${params}`, {
    method: 'GET',
    ...opts,
  });
  return CRM4CampaignListResponseSchema.parse(raw);
}

export async function getCampaignById(
  id: string,
  opts: RequestOptions = {}
): Promise<CRM4Campaign> {
  const raw = await request<unknown>(`${API_BASE}/campaigns/${encodeURIComponent(id)}`, {
    method: 'GET',
    ...opts,
  });
  return CRM4CampaignSchema.parse(raw);
}

export async function createCampaign(
  body: CRM4CampaignCreate,
  opts: RequestOptions = {}
): Promise<CRM4Campaign> {
  const raw = await request<unknown>(`${API_BASE}/campaigns`, {
    method: 'POST',
    body: JSON.stringify(body),
    ...opts,
  });
  return CRM4CampaignSchema.parse(raw);
}

export async function patchCampaign(
  id: string,
  body: CRM4CampaignPatch,
  opts: RequestOptions = {}
): Promise<CRM4Campaign> {
  const raw = await request<unknown>(`${API_BASE}/campaigns/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    ...opts,
  });
  return CRM4CampaignSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// Campaign Members
// ---------------------------------------------------------------------------

export async function getCampaignMembers(
  campaignId: string,
  query: Partial<CRM4MemberQuery> = {},
  opts: RequestOptions = {}
): Promise<CRM4MemberListResponse> {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));

  const raw = await request<unknown>(
    `${API_BASE}/campaigns/${encodeURIComponent(campaignId)}/members?${params}`,
    { method: 'GET', ...opts }
  );
  return CRM4MemberListResponseSchema.parse(raw);
}

export async function createCampaignMember(
  body: CRM4MemberCreate,
  opts: RequestOptions = {}
): Promise<CRM4Member> {
  const { campaignId, ...payload } = body;
  const raw = await request<unknown>(
    `${API_BASE}/campaigns/${encodeURIComponent(campaignId)}/members`,
    { method: 'POST', body: JSON.stringify(payload), ...opts }
  );
  return CRM4MemberSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// Consents
// ---------------------------------------------------------------------------

export async function setConsent(
  body: CRM4ConsentSet,
  opts: RequestOptions = {}
): Promise<CRM4Consent> {
  const raw = await request<unknown>(`${API_BASE}/consents`, {
    method: 'POST',
    body: JSON.stringify(body),
    ...opts,
  });
  return CRM4ConsentSchema.parse(raw);
}

export async function getConsent(
  contactId: string,
  opts: RequestOptions = {}
): Promise<CRM4Consent | null> {
  try {
    const raw = await request<unknown>(
      `${API_BASE}/consents/${encodeURIComponent(contactId)}`,
      { method: 'GET', ...opts }
    );
    return CRM4ConsentSchema.parse(raw);
  } catch (err) {
    if (err instanceof Crm4ApiError && err.statusCode === 404) return null;
    throw err;
  }
}
