import { FastifyReply, FastifyRequest, FastifyInstance } from 'fastify';
import { AppError } from '@cs/kernel';
import {
  ClearShiftRoles,
  type RoleType,
  type RoutePermissionPolicy,
  DenyCodes,
} from '@clearshift/contracts';
import { exportCsvSafe, type ExportCsvOptions } from '../exports/csv-safe.js';

/**
 * [PLT-06] Central Role and Field-Level Authorization Matrix
 *
 * Traceability:
 * - ClearShift Project Plan v3.0 §§9.3-9.6, 17
 * - SDS ClearShift CRM v2.0 §4
 * - SDS ClearShift Migration Kit v2.0 §4
 *
 * Constraints:
 * - Every route has explicit allowed roles or public annotation; default is deny.
 * - Matrix tests enumerate each role against every route; unauthorized response is 403.
 * - Hidden UI button is not treated as the security boundary; direct API calls are denied.
 * - No role can read credentials/tokens; sensitive-field masking is tested for API and CSV.
 * - Admin salary visibility follows approved HR policy, but does not grant access to bank details or government identifiers. Viewer salary masked.
 */

// Regex patterns for field detection
const SECRET_FIELD_REGEX = /^(?:password|passwd|pass|argon2hash|passwordhash|secret|jwt|token|refreshtoken|tokenhash|privateenc|signingkey|privatekey|clientsecret|authorization|apikey)$/i;
const BANK_FIELD_REGEX = /^(?:bank_?account|account_?number|iban|routing_?number|swift|cvv|card_?number)$/i;
const GOVT_ID_REGEX = /^(?:ssn|tax_?id|national_?id|aadhaar|pan|identity_?number)$/i;
const SALARY_FIELD_REGEX = /^(?:salary|base_?salary|compensation|wage|hourly_?rate)$/i;

export interface MaskOptions {
  /**
   * If true and user is Admin, salary fields are displayed unmasked under approved HR policy.
   * Default: true for Admin, false for other roles.
   */
  hrSalaryPolicyApproved?: boolean;
}

/**
 * Masks a bank account, credit card, or routing number to the format XXXX-XXXX-7890.
 * Shorter values (< 4 chars) are masked as XXXX.
 * Admin does NOT bypass bank details masking.
 */
export function maskBankDetails(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value).trim();
  if (str === '') {
    return '';
  }
  const digits = str.replace(/\D/g, '');
  if (digits.length < 4) {
    return 'XXXX';
  }
  const last4 = digits.slice(-4);
  return `XXXX-XXXX-${last4}`;
}

/**
 * Masks a government identifier (SSN, Tax ID, National ID).
 * Admin does NOT bypass government identifier masking.
 */
export function maskGovernmentId(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value).trim();
  const digits = str.replace(/\D/g, '');
  if (digits.length >= 4) {
    const last4 = digits.slice(-4);
    return `***-**-${last4}`;
  }
  return '[REDACTED_ID]';
}

/**
 * Masks salary or compensation figures to 'XX,XXX' or 'salary hidden'.
 * Viewer salary is always masked.
 */
export function maskSalary(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return 'salary hidden';
  }
  return 'XX,XXX';
}

/**
 * Server-side field-level masking engine.
 * Applies masking policy to a data record before JSON serialization or export.
 *
 * Invariants:
 * 1. Credentials & Secrets: always stripped/redacted for ALL roles (including Admin).
 * 2. Bank Details: always masked as XXXX-XXXX-7890 for ALL roles (including Admin).
 * 3. Government IDs: always masked for ALL roles (including Admin).
 * 4. Salary & Compensation:
 *    - Viewer: always masked as 'XX,XXX' or 'salary hidden'.
 *    - Admin: visible only when hrSalaryPolicyApproved is true (default for Admin).
 *    - Other roles (Editor, Migration Runner, Analyst): masked.
 */
export function maskRecordForRole<T>(
  record: T,
  roles: RoleType | readonly RoleType[] | undefined,
  options: MaskOptions = {}
): T {
  if (record === null || record === undefined) {
    return record;
  }

  if (typeof record !== 'object') {
    return record;
  }

  if (record instanceof Date) {
    return record;
  }

  const roleList: readonly RoleType[] = Array.isArray(roles)
    ? roles
    : roles
    ? [roles]
    : [];

  const isAdmin = roleList.includes(ClearShiftRoles.ADMIN);
  const allowAdminSalary = isAdmin && (options.hrSalaryPolicyApproved ?? true);

  if (Array.isArray(record)) {
    return record.map((item) => maskRecordForRole(item, roleList, options)) as unknown as T;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
    // 1. Secrets & Credentials -> Redacted for ALL roles
    if (SECRET_FIELD_REGEX.test(key)) {
      result[key] = '[REDACTED]';
      continue;
    }

    // 2. Bank Details -> Masked for ALL roles (including Admin)
    if (BANK_FIELD_REGEX.test(key)) {
      result[key] = maskBankDetails(value);
      continue;
    }

    // 3. Government Identifiers -> Masked for ALL roles (including Admin)
    if (GOVT_ID_REGEX.test(key)) {
      result[key] = maskGovernmentId(value);
      continue;
    }

    // 4. Salary & Compensation
    if (SALARY_FIELD_REGEX.test(key)) {
      if (allowAdminSalary) {
        // Admin salary visibility follows approved HR policy
        result[key] = value;
      } else {
        // Viewer, Editor, Migration Runner, Analyst -> Masked
        result[key] = maskSalary(value);
      }
      continue;
    }

    // 5. Nested objects and arrays
    if (value && typeof value === 'object') {
      result[key] = maskRecordForRole(value, roleList, options);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

/**
 * Masks an array of records for a given role set.
 */
export function maskRecordsForRole<T>(
  records: readonly T[],
  roles: RoleType | readonly RoleType[] | undefined,
  options: MaskOptions = {}
): T[] {
  return records.map((record) => maskRecordForRole(record, roles, options));
}

/**
 * Exports records to formula-safe CSV with server-side field-level masking applied first.
 * Ensures:
 * 1. Protected/sensitive fields are masked according to caller role before CSV generation.
 * 2. Formula injection triggers (=, +, -, @) are neutralized by prepending single quotes.
 */
export function exportCsvWithFieldMasking<T extends Record<string, unknown>>(
  records: readonly T[],
  roles: RoleType | readonly RoleType[] | undefined,
  options: ExportCsvOptions<T> & MaskOptions = {}
): string {
  const maskedRecords = maskRecordsForRole(records, roles, options);
  return exportCsvSafe(maskedRecords, options);
}

/**
 * Evaluates route access against a route permission policy.
 * Default is DENY.
 */
export function evaluateRouteAccess(
  policy: RoutePermissionPolicy | undefined,
  userRoles: readonly RoleType[] | undefined,
  context: {
    isMigrationRunnerSelfApproval?: boolean;
  } = {}
): { allowed: boolean; statusCode: number; denyCode: string; message: string } {
  // 1. If no policy exists for this route -> Default Deny (403)
  if (!policy) {
    return {
      allowed: false,
      statusCode: 403,
      denyCode: DenyCodes.DEFAULT_DENY,
      message: 'Access denied: Route has no explicit allowed roles policy (default deny).',
    };
  }

  // 2. Public route -> Allowed
  if (policy.isPublic) {
    return {
      allowed: true,
      statusCode: 200,
      denyCode: '',
      message: 'Route is public',
    };
  }

  // 3. Protected route requires authentication
  if (!userRoles || userRoles.length === 0) {
    return {
      allowed: false,
      statusCode: 401,
      denyCode: DenyCodes.UNAUTHENTICATED,
      message: 'Authentication required: missing or invalid credentials.',
    };
  }

  const allowedRoles = policy.allowedRoles ?? [];

  // 4. Default Deny if allowedRoles is empty
  if (allowedRoles.length === 0) {
    return {
      allowed: false,
      statusCode: 403,
      denyCode: DenyCodes.DEFAULT_DENY,
      message: 'Access denied: No roles are permitted for this endpoint.',
    };
  }

  // 5. Enforce non-negotiable Separation of Duties:
  // "Migration Runner may execute import/load and opening-balance/payroll-total bulk endpoints
  //  but not approve its own merge/skip decisions"
  if (policy.isApprovalDecision) {
    const isOnlyRunner =
      userRoles.length === 1 && userRoles[0] === ClearShiftRoles.MIGRATION_RUNNER;
    if (isOnlyRunner || context.isMigrationRunnerSelfApproval) {
      return {
        allowed: false,
        statusCode: 403,
        denyCode: DenyCodes.SELF_APPROVAL_FORBIDDEN,
        message: 'Access denied: Migration Runner is strictly prohibited from approving merge or skip decisions.',
      };
    }
  }

  // 6. Role intersection check
  const hasRole = userRoles.some((role) => allowedRoles.includes(role));
  if (!hasRole) {
    return {
      allowed: false,
      statusCode: 403,
      denyCode: DenyCodes.FORBIDDEN,
      message: `Access denied. Allowed roles for this endpoint: [${allowedRoles.join(', ')}]`,
    };
  }

  return {
    allowed: true,
    statusCode: 200,
    denyCode: '',
    message: 'Authorized',
  };
}

/**
 * Fastify preHandler guard that enforces allowed roles on a specific endpoint.
 * Default is deny. Unauthorized calls receive 403 with standard AppError envelope.
 */
export function requireRoles(allowedRoles: readonly RoleType[]) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      throw new AppError('UNAUTHORIZED', 'Authentication required', 401);
    }

    const userRoles = request.user.roles ?? [];
    const evaluation = evaluateRouteAccess(
      {
        path: request.url,
        method: request.method as any,
        allowedRoles,
      },
      userRoles
    );

    if (!evaluation.allowed) {
      throw new AppError(evaluation.denyCode, evaluation.message, evaluation.statusCode);
    }
  };
}

/**
 * Fastify preHandler guard enforcing a specific RoutePermissionPolicy.
 */
export function requireRoutePolicy(policy: RoutePermissionPolicy) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (policy.isPublic) {
      return;
    }

    if (!request.user) {
      throw new AppError('UNAUTHORIZED', 'Authentication required', 401);
    }

    const evaluation = evaluateRouteAccess(policy, request.user.roles);
    if (!evaluation.allowed) {
      throw new AppError(evaluation.denyCode, evaluation.message, evaluation.statusCode);
    }
  };
}

/**
 * Server-side route authorization and field masking hook for Fastify.
 * - Enforces default deny on every registered route unless annotated as public or having explicit roles.
 * - Enforces field-level masking on outgoing responses.
 */
export function registerRouteAuthorization(
  fastify: FastifyInstance,
  routePolicies: Map<string, RoutePermissionPolicy>
): void {
  // 1. Authorization Pre-Handler Hook (Default Deny)
  fastify.addHook('preHandler', async (request: FastifyRequest, _reply: FastifyReply) => {
    // Determine route key: method + normalized path
    const routeKey = `${request.method}:${request.routeOptions.url || request.url.split('?')[0]}`;
    const policy = routePolicies.get(routeKey);

    const userRoles = request.user?.roles;
    const evaluation = evaluateRouteAccess(policy, userRoles);

    if (!evaluation.allowed) {
      throw new AppError(evaluation.denyCode, evaluation.message, evaluation.statusCode);
    }
  });

  // 2. Pre-Serialization Hook: apply field-level masking server-side before serialization
  fastify.addHook('preSerialization', async (request: FastifyRequest, _reply: FastifyReply, payload: unknown) => {
    if (payload && typeof payload === 'object') {
      const userRoles = request.user?.roles;
      return maskRecordForRole(payload, userRoles);
    }
    return payload;
  });
}
