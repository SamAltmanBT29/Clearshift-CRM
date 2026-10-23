/**
 * ClearShift CRM — CRM-5 Migration Control Center Frontend API Layer
 * API base: /api/v1/crm-control
 * All responses are Zod-validated before returning to the UI.
 * Conforms to Issue #49 [CRM5-04] and Master Architecture Baseline 1.0-A.
 */
import {
  type MigrationRun,
  type RunsQuery,
  type PaginatedRunsResponse,
  type QualityScore,
  type ScoresQuery,
  type ScoresResponse,
  type MigrationReject,
  type RejectsQuery,
  type PaginatedRejectsResponse,
  type ReconciliationReport,
  type CreateRunInput,
  MigrationRunSchema,
  PaginatedRunsResponseSchema,
  ScoresResponseSchema,
  PaginatedRejectsResponseSchema,
  ReconciliationReportSchema,
  CreateRunInputSchema,
  CRM5_API_PREFIX,
} from '@clearshift/contracts';

// ---------------------------------------------------------------------------
// 1. Error Type
// ---------------------------------------------------------------------------
export class Crm5ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'Crm5ApiError';
  }

  get isPermissionDenied(): boolean {
    return this.statusCode === 403 || this.code === 'FORBIDDEN';
  }
}

export interface RequestOptions {
  signal?: AbortSignal;
  permissionHeader?: string;
  token?: string;
  simulateError?: boolean;
  simulatePermissionDenied?: boolean;
}

const API_BASE = CRM5_API_PREFIX;

// ---------------------------------------------------------------------------
// 2. Internal Fetch Helper
// ---------------------------------------------------------------------------
async function request<T>(
  endpoint: string,
  options: RequestInit & RequestOptions = {}
): Promise<T> {
  const { signal, permissionHeader, token, simulateError, simulatePermissionDenied, ...init } = options;

  if (simulatePermissionDenied) {
    throw new Crm5ApiError(
      403,
      'FORBIDDEN',
      'Access denied: insufficient permissions to access CRM-5 migration control',
      { requiredCapability: 'control:read' }
    );
  }

  if (simulateError) {
    throw new Crm5ApiError(
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

  if (permissionHeader) {
    headers['x-user-permission'] = permissionHeader;
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const fetchInit: RequestInit = { ...init, headers };
  if (signal) {
    fetchInit.signal = signal;
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), fetchInit);
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    throw new Crm5ApiError(0, 'NETWORK_ERROR', 'Network error: unable to reach the CRM-5 service.');
  }

  let body: any;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  } else {
    body = null;
  }

  if (!response.ok) {
    const errorEnv = body?.error || body;
    const code = errorEnv?.code || (response.status === 403 ? 'FORBIDDEN' : 'HTTP_ERROR');
    const message =
      errorEnv?.message ||
      (response.status === 403
        ? 'Access denied: insufficient permissions'
        : `Request failed with status ${response.status}`);
    const details = errorEnv?.details;

    throw new Crm5ApiError(response.status, code, message, details);
  }

  return body as T;
}

// ---------------------------------------------------------------------------
// 3. Public API Methods
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/crm-control/runs
 * Fetches server-paginated migration run projections.
 */
export async function getRuns(
  query: Partial<RunsQuery> = {},
  options: RequestOptions = {}
): Promise<PaginatedRunsResponse> {
  const params = new URLSearchParams();

  if (query.page !== undefined) params.set('page', String(query.page));
  if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize));
  if (query.module) params.set('module', query.module);
  if (query.batchId) params.set('batchId', query.batchId);
  if (query.status) params.set('status', query.status);

  const qs = params.toString();
  const endpoint = `${API_BASE}/runs${qs ? `?${qs}` : ''}`;
  const raw = await request<unknown>(endpoint, { method: 'GET', ...options });

  const parsed = PaginatedRunsResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Crm5ApiError(
      502,
      'CONTRACT_VALIDATION_ERROR',
      'Server returned invalid runs list response schema',
      parsed.error.flatten()
    );
  }

  return parsed.data;
}

/**
 * GET /api/v1/crm-control/scores
 * Fetches 5-dimension quality scores and overall system average.
 */
export async function getScores(
  query: Partial<ScoresQuery> = {},
  options: RequestOptions = {}
): Promise<ScoresResponse> {
  const params = new URLSearchParams();

  if (query.page !== undefined) params.set('page', String(query.page));
  if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize));
  if (query.module) params.set('module', query.module);
  if (query.batchId) params.set('batchId', query.batchId);

  const qs = params.toString();
  const endpoint = `${API_BASE}/scores${qs ? `?${qs}` : ''}`;
  const raw = await request<unknown>(endpoint, { method: 'GET', ...options });

  const parsed = ScoresResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Crm5ApiError(
      502,
      'CONTRACT_VALIDATION_ERROR',
      'Server returned invalid scores response schema',
      parsed.error.flatten()
    );
  }

  return parsed.data;
}

/**
 * GET /api/v1/crm-control/rejects
 * Fetches paginated row-level rejection audit records.
 */
export async function getRejects(
  query: Partial<RejectsQuery> = {},
  options: RequestOptions = {}
): Promise<PaginatedRejectsResponse> {
  const params = new URLSearchParams();

  if (query.page !== undefined) params.set('page', String(query.page));
  if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize));
  if (query.module) params.set('module', query.module);
  if (query.batchId) params.set('batchId', query.batchId);

  const qs = params.toString();
  const endpoint = `${API_BASE}/rejects${qs ? `?${qs}` : ''}`;
  const raw = await request<unknown>(endpoint, { method: 'GET', ...options });

  const parsed = PaginatedRejectsResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Crm5ApiError(
      502,
      'CONTRACT_VALIDATION_ERROR',
      'Server returned invalid rejects response schema',
      parsed.error.flatten()
    );
  }

  return parsed.data;
}

/**
 * GET /api/v1/crm-control/reconciliation/:batch
 * Fetches row-count conservation balance sheet for a batch.
 */
export async function getReconciliation(
  batchId: string,
  options: RequestOptions = {}
): Promise<ReconciliationReport> {
  const endpoint = `${API_BASE}/reconciliation/${encodeURIComponent(batchId)}`;
  const raw = await request<unknown>(endpoint, { method: 'GET', ...options });

  const parsed = ReconciliationReportSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Crm5ApiError(
      502,
      'CONTRACT_VALIDATION_ERROR',
      'Server returned invalid reconciliation report schema',
      parsed.error.flatten()
    );
  }

  return parsed.data;
}

/**
 * POST /api/v1/crm-control/runs
 * Ingests a new migration run projection.
 */
export async function createRun(
  input: CreateRunInput,
  options: RequestOptions = {}
): Promise<MigrationRun> {
  const validatedInput = CreateRunInputSchema.parse(input);
  const endpoint = `${API_BASE}/runs`;

  const raw = await request<unknown>(endpoint, {
    method: 'POST',
    body: JSON.stringify(validatedInput),
    ...options,
  });

  const parsed = MigrationRunSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Crm5ApiError(
      502,
      'CONTRACT_VALIDATION_ERROR',
      'Server returned invalid created run schema',
      parsed.error.flatten()
    );
  }

  return parsed.data;
}
