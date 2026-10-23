import {
  type CRM4ListQuery,
  type CRM4ListResponse,
  type CRM4List,
  type CRM4ListCreate,
  type CRM4ListPatch,
  type CRM4CampaignQuery,
  type CRM4CampaignListResponse,
  type CRM4Campaign,
  type CRM4MemberQuery,
  type CRM4MemberListResponse,
  type CRM4Consent,
  type CRM4ConsentSet,
  CRM4ListResponseSchema,
  CRM4ListSchema,
  CRM4CampaignListResponseSchema,
  CRM4CampaignSchema,
  CRM4MemberListResponseSchema,
  CRM4ConsentSchema,
} from '@clearshift/contracts';

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
  permissionHeader?: string;
  simulateError?: boolean;
  simulatePermissionDenied?: boolean;
}

async function request<T>(
  endpoint: string,
  options: RequestInit & RequestOptions = {}
): Promise<T> {
  const { signal, permissionHeader, simulateError, simulatePermissionDenied, ...init } = options;

  let origin = '';
  if (typeof window !== 'undefined' && window.location?.origin) {
    origin = window.location.origin;
  }
  const url = new URL(endpoint, origin || 'http://localhost');
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
    throw new Crm4ApiError(0, 'NETWORK_ERROR', 'Network communication failed. Please verify your connection.');
  }

  if (!response.ok) {
    let errorData: any = {};
    try {
      errorData = await response.json();
    } catch {
      // response was not JSON
    }
    throw new Crm4ApiError(
      response.status,
      errorData.code || 'HTTP_ERROR',
      errorData.message || `Request failed with status ${response.status}`,
      errorData.details
    );
  }

  return response.json() as Promise<T>;
}

export async function getMarketingLists(
  query: Partial<CRM4ListQuery> = {},
  options?: RequestOptions
): Promise<CRM4ListResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set('page', String(query.page ?? 1));
  searchParams.set('pageSize', String(query.pageSize ?? 25));

  if (query.search && query.search.trim() !== '') {
    searchParams.set('search', query.search.trim());
  }

  const data = await request<unknown>(`${API_BASE}/lists?${searchParams.toString()}`, {
    method: 'GET',
    ...options,
  });

  return CRM4ListResponseSchema.parse(data);
}

export async function getMarketingListById(
  id: string,
  options?: RequestOptions
): Promise<CRM4List> {
  const data = await request<unknown>(`${API_BASE}/lists/${id}`, {
    method: 'GET',
    ...options,
  });

  return CRM4ListSchema.parse(data);
}

export async function createMarketingList(
  input: CRM4ListCreate,
  options?: RequestOptions
): Promise<CRM4List> {
  const data = await request<unknown>(`${API_BASE}/lists`, {
    method: 'POST',
    body: JSON.stringify(input),
    ...options,
  });

  return CRM4ListSchema.parse(data);
}

export async function updateMarketingList(
  id: string,
  input: CRM4ListPatch,
  options?: RequestOptions
): Promise<CRM4List> {
  const data = await request<unknown>(`${API_BASE}/lists/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
    ...options,
  });

  return CRM4ListSchema.parse(data);
}

export async function getCampaigns(
  query: Partial<CRM4CampaignQuery> = {},
  options?: RequestOptions
): Promise<CRM4CampaignListResponse> {
  const searchParams = new URLSearchParams();
  if (query.page) searchParams.set('page', String(query.page));
  if (query.pageSize) searchParams.set('pageSize', String(query.pageSize));
  if (query.listId) searchParams.set('listId', query.listId);
  if (query.search) searchParams.set('search', query.search);

  const data = await request<unknown>(`${API_BASE}/campaigns?${searchParams.toString()}`, {
    method: 'GET',
    ...options,
  });

  return CRM4CampaignListResponseSchema.parse(data);
}

export async function getCampaignMembers(
  campaignId: string,
  query: Partial<CRM4MemberQuery> = {},
  options?: RequestOptions
): Promise<CRM4MemberListResponse> {
  const searchParams = new URLSearchParams();
  if (query.page) searchParams.set('page', String(query.page));
  if (query.pageSize) searchParams.set('pageSize', String(query.pageSize));
  if (query.status) searchParams.set('status', query.status);

  const data = await request<unknown>(`${API_BASE}/campaigns/${campaignId}/members?${searchParams.toString()}`, {
    method: 'GET',
    ...options,
  });

  return CRM4MemberListResponseSchema.parse(data);
}

export async function getContactConsent(
  contactId: string,
  options?: RequestOptions
): Promise<CRM4Consent> {
  const data = await request<unknown>(`${API_BASE}/consents/${contactId}`, {
    method: 'GET',
    ...options,
  });

  return CRM4ConsentSchema.parse(data);
}

export async function setContactConsent(
  input: CRM4ConsentSet,
  options?: RequestOptions
): Promise<CRM4Consent> {
  const data = await request<unknown>(`${API_BASE}/consents`, {
    method: 'POST',
    body: JSON.stringify(input),
    ...options,
  });

  return CRM4ConsentSchema.parse(data);
}
