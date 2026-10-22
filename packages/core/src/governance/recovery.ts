import { createHash } from 'node:crypto';

/**
 * ClearShift V1 Governance & Operational Recovery Invariants (PMO-12)
 */

export const IncidentSeverity = {
  SEV_1_CRITICAL: 'SEV-1',
  SEV_2_HIGH: 'SEV-2',
  SEV_3_MEDIUM: 'SEV-3',
  SEV_4_LOW: 'SEV-4',
} as const;

export type IncidentSeverityType = (typeof IncidentSeverity)[keyof typeof IncidentSeverity];

export interface IncidentSla {
  responseMinutes: number;
  updateCadenceMinutes: number;
  escalationTarget: string;
}

export const INCIDENT_SLAS: Record<IncidentSeverityType, IncidentSla> = {
  [IncidentSeverity.SEV_1_CRITICAL]: {
    responseMinutes: 15,
    updateCadenceMinutes: 30,
    escalationTarget: 'Incident Commander & Executive Sponsors',
  },
  [IncidentSeverity.SEV_2_HIGH]: {
    responseMinutes: 30,
    updateCadenceMinutes: 60,
    escalationTarget: 'Incident Commander & Relevant Module Leads',
  },
  [IncidentSeverity.SEV_3_MEDIUM]: {
    responseMinutes: 240, // 4 hours
    updateCadenceMinutes: 1440, // daily
    escalationTarget: 'Module Sprint Backlog',
  },
  [IncidentSeverity.SEV_4_LOW]: {
    responseMinutes: 1440, // 24 hours
    updateCadenceMinutes: 10080, // weekly
    escalationTarget: 'Standard Backlog Triage',
  },
};

export interface ReconciliationCounts {
  source: number;
  loaded: number;
  rejected: number;
  merged: number;
  skipped: number;
}

export interface ReconciliationResult {
  source: number;
  loaded: number;
  rejected: number;
  merged: number;
  skipped: number;
  accounted: number;
  unaccounted: number;
  isValid: boolean;
  discrepancyMessage?: string | undefined;
}

/**
 * Evaluates the master ClearShift reconciliation formula:
 * source = loaded + rejected + merged + skipped
 * unaccounted = source - (loaded + rejected + merged + skipped) = 0
 */
export function calculateReconciliation(counts: ReconciliationCounts): ReconciliationResult {
  const { source, loaded, rejected, merged, skipped } = counts;
  
  if (source < 0 || loaded < 0 || rejected < 0 || merged < 0 || skipped < 0) {
    throw new Error('Reconciliation counts must be non-negative integers');
  }

  const accounted = loaded + rejected + merged + skipped;
  const unaccounted = source - accounted;
  const isValid = unaccounted === 0;

  return {
    source,
    loaded,
    rejected,
    merged,
    skipped,
    accounted,
    unaccounted,
    isValid,
    discrepancyMessage: isValid
      ? undefined
      : `Reconciliation invariant broken: source (${source}) != accounted (${accounted}). Delta: ${unaccounted}`,
  };
}

/**
 * Computes the deterministic idempotency key for a source row within a batch.
 * Key format: SHA256(batchId:sourceRow:targetEntity:schemaVersion)
 */
export function computeIdempotencyKey(
  batchId: string,
  sourceRow: number,
  targetEntity: string,
  schemaVersion: string
): string {
  if (!batchId || !targetEntity || !schemaVersion || sourceRow < 1) {
    throw new Error('Invalid arguments for idempotency key generation');
  }

  const rawKey = `${batchId}:${sourceRow}:${targetEntity}:${schemaVersion}`;
  return createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Evaluates if a batch must halt due to the 10% row failure threshold
 * or the 50 MB payload ceiling.
 */
export function evaluateStopCondition(params: {
  attemptedRows: number;
  failedRows: number;
  fileSizeBytes?: number;
}): { shouldHalt: boolean; reason?: string | undefined } {
  const { attemptedRows, failedRows, fileSizeBytes } = params;

  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
  if (fileSizeBytes !== undefined && fileSizeBytes > MAX_FILE_SIZE) {
    return {
      shouldHalt: true,
      reason: `File size ${fileSizeBytes} bytes exceeds 50 MB maximum ceiling (STP-02)`,
    };
  }

  if (attemptedRows > 0) {
    const failureRate = (failedRows / attemptedRows) * 100;
    if (failureRate > 10.0) {
      return {
        shouldHalt: true,
        reason: `Cumulative row failure rate ${failureRate.toFixed(1)}% exceeds 10% threshold (STP-01)`,
      };
    }
  }

  return { shouldHalt: false };
}

/**
 * Asserts that the V1 architectural boundary is strictly preserved:
 * - No compensating rollback saga
 * - No fuzzy auto-merge
 * - Stop on failure enabled
 * - Deterministic idempotency enabled
 */
export function assertV1RecoveryBoundaries(policy: {
  hasRollbackSaga?: boolean;
  hasFuzzyAutoMerge?: boolean;
  stopsOnFailure: boolean;
  deterministicIdempotency: boolean;
}): void {
  if (policy.hasRollbackSaga === true) {
    throw new Error('V1 Boundary Violation: Compensating rollback saga is strictly out of scope for V1');
  }
  if (policy.hasFuzzyAutoMerge === true) {
    throw new Error('V1 Boundary Violation: Fuzzy duplicate auto-merge is strictly out of scope for V1');
  }
  if (!policy.stopsOnFailure) {
    throw new Error('V1 Boundary Violation: Automatic stop-on-failure safety must be enabled');
  }
  if (!policy.deterministicIdempotency) {
    throw new Error('V1 Boundary Violation: Deterministic idempotency key verification must be enabled');
  }
}

/**
 * Validates that an operational recovery runbook contains all mandatory PMO-12 sections.
 */
export function validateRunbookDocument(content: string): { isValid: boolean; missingSections: string[] } {
  const requiredKeywords = [
    'Stop Conditions',
    'Safe Batch Stoppage',
    'Node Restart',
    'Reconciliation Checks',
    'source = loaded + rejected + merged + skipped',
    'unaccounted',
    'IdempotencyKey',
    'Rollback',
  ];

  const missingSections = requiredKeywords.filter(
    (kw) => !content.toLowerCase().includes(kw.toLowerCase())
  );

  return {
    isValid: missingSections.length === 0,
    missingSections,
  };
}

/**
 * Validates that an incident response roles document contains all mandatory PMO-12 sections.
 */
export function validateIncidentRolesDocument(content: string): { isValid: boolean; missingSections: string[] } {
  const requiredKeywords = [
    'Incident Commander',
    'Communications Lead',
    'SEV-1',
    'SEV-2',
    'SEV-3',
    'SEV-4',
    'Escalation',
    'Post-Mortem',
  ];

  const missingSections = requiredKeywords.filter(
    (kw) => !content.toLowerCase().includes(kw.toLowerCase())
  );

  return {
    isValid: missingSections.length === 0,
    missingSections,
  };
}

/**
 * Validates that a demo rehearsal schedule document contains all mandatory PMO-12 sections.
 */
export function validateDemoScheduleDocument(content: string): { isValid: boolean; missingSections: string[] } {
  const requiredKeywords = [
    'Rehearsal',
    'Gate G4 Showcase',
    'Run-of-Show',
    '45 Minute',
    'Speaker',
    'Contingency',
    'Scorecard',
  ];

  const missingSections = requiredKeywords.filter(
    (kw) => !content.toLowerCase().includes(kw.toLowerCase())
  );

  return {
    isValid: missingSections.length === 0,
    missingSections,
  };
}
