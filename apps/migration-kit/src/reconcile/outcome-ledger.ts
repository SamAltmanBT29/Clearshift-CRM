import { randomUUID } from 'node:crypto';
import {
  type KitRowOutcome,
  type SkipRowApprovalInput,
  type TerminalOutcomeType,
  DuplicateRowOutcomeError,
  InvalidSkipApprovalError,
  OPERATOR_APPROVED_SKIP_POLICY,
} from '@clearshift/contracts';

/**
 * Valid pre-load batch statuses where row skipping is permissible (KIT-09)
 */
export const ALLOWED_PRE_LOAD_SKIP_STATUSES = [
  'created',
  'extracting',
  'extracted',
  'profiled',
  'cleaned',
  'mapped',
  'dry_run_passed',
] as const;

/**
 * Roles authorized to approve row skips (Editor or Admin only; Runner prohibited)
 */
export const AUTHORIZED_SKIP_ROLES = [
  'migration_admin',
  'platform_admin',
  'editor',
] as const;

/**
 * Storage interface for append-only terminal row outcomes.
 */
export interface IRowOutcomeLedger {
  recordOutcome(outcome: Omit<KitRowOutcome, 'id' | 'createdAt'>): Promise<KitRowOutcome>;
  recordSkipApproval(
    input: SkipRowApprovalInput,
    currentBatchStatus: string
  ): Promise<{ outcome: KitRowOutcome; dryRunInvalidated: boolean }>;
  getOutcome(batchId: string, sourceRow: number): Promise<KitRowOutcome | null>;
  getCountsByBatchId(batchId: string): Promise<{
    loaded: number;
    rejected: number;
    merged: number;
    skipped: number;
    total: number;
  }>;
  listOutcomesByBatchId(batchId: string): Promise<KitRowOutcome[]>;
}

/**
 * In-Memory append-only outcome ledger for tests and verification.
 * Enforces composite uniqueness (batch_id, source_row) and skip authorization rules.
 */
export class InMemoryRowOutcomeLedger implements IRowOutcomeLedger {
  private outcomesByKey: Map<string, KitRowOutcome> = new Map();

  private makeKey(batchId: string, sourceRow: number): string {
    return `${batchId}:${sourceRow}`;
  }

  public async recordOutcome(
    outcome: Omit<KitRowOutcome, 'id' | 'createdAt'>
  ): Promise<KitRowOutcome> {
    const key = this.makeKey(outcome.batchId, outcome.sourceRow);
    const existing = this.outcomesByKey.get(key);

    if (existing) {
      throw new DuplicateRowOutcomeError(
        outcome.batchId,
        outcome.sourceRow,
        existing.outcome,
        outcome.outcome
      );
    }

    const record: KitRowOutcome = {
      ...outcome,
      id: randomUUID(),
      createdAt: new Date(),
    };

    this.outcomesByKey.set(key, record);
    return record;
  }

  public async recordSkipApproval(
    input: SkipRowApprovalInput,
    currentBatchStatus: string
  ): Promise<{ outcome: KitRowOutcome; dryRunInvalidated: boolean }> {
    // 1. Enforce phase restriction: skip is permitted ONLY before real load
    const isPreLoad = (ALLOWED_PRE_LOAD_SKIP_STATUSES as readonly string[]).includes(
      currentBatchStatus
    );
    if (!isPreLoad) {
      throw new InvalidSkipApprovalError(
        `Row skip is prohibited in batch state '${currentBatchStatus}'. Skips are permitted only before real load (KIT-09).`
      );
    }

    // 2. Enforce role separation: Editor or Admin required; Migration Runner cannot approve
    const isAuthorizedRole = (AUTHORIZED_SKIP_ROLES as readonly string[]).includes(
      input.actorRole
    );
    if (!isAuthorizedRole) {
      throw new InvalidSkipApprovalError(
        `Actor role '${input.actorRole}' is not authorized to approve row skips. Editor or Admin approval is required (KIT-09).`,
        true // 403 Forbidden
      );
    }

    // 3. Enforce reason length: at least 10 non-whitespace characters
    const trimmedReason = input.reason.trim();
    if (trimmedReason.length < 10) {
      throw new InvalidSkipApprovalError(
        'Skip reason must contain at least 10 non-whitespace characters.'
      );
    }

    // 4. If batch was already dry_run_passed, any skip invalidates the dry-run token
    const dryRunInvalidated = currentBatchStatus === 'dry_run_passed';

    // 5. Commit terminal skipped outcome
    const outcome = await this.recordOutcome({
      batchId: input.batchId,
      sourceRow: input.sourceRow,
      outcome: 'skipped',
      reasonCode: 'OPERATOR_APPROVED_SKIP',
      reasonMessage: trimmedReason,
      actor: input.actor,
      policyCode: OPERATOR_APPROVED_SKIP_POLICY,
      approvedBy: input.actor,
      approvedAt: new Date(),
    });

    return { outcome, dryRunInvalidated };
  }

  public async getOutcome(
    batchId: string,
    sourceRow: number
  ): Promise<KitRowOutcome | null> {
    return this.outcomesByKey.get(this.makeKey(batchId, sourceRow)) ?? null;
  }

  public async getCountsByBatchId(batchId: string): Promise<{
    loaded: number;
    rejected: number;
    merged: number;
    skipped: number;
    total: number;
  }> {
    const records = await this.listOutcomesByBatchId(batchId);
    let loaded = 0;
    let rejected = 0;
    let merged = 0;
    let skipped = 0;

    for (const r of records) {
      switch (r.outcome) {
        case 'loaded':
          loaded++;
          break;
        case 'rejected':
          rejected++;
          break;
        case 'merged':
          merged++;
          break;
        case 'skipped':
          skipped++;
          break;
      }
    }

    return {
      loaded,
      rejected,
      merged,
      skipped,
      total: records.length,
    };
  }

  public async listOutcomesByBatchId(batchId: string): Promise<KitRowOutcome[]> {
    return Array.from(this.outcomesByKey.values()).filter(
      (r) => r.batchId === batchId
    );
  }

  public clear(): void {
    this.outcomesByKey.clear();
  }
}
