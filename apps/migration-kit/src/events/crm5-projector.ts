import type {
  EventEnvelope,
  KitBatchExtractedPayload,
  KitBatchProfiledPayload,
  KitBatchCleanedPayload,
  KitBatchMappedPayload,
  KitBatchLoadedPayload,
  KitBatchValidatedPayload,
  KitBatchFailedPayload,
  KitContactMergedPayload,
} from '@clearshift/contracts';
import { MigrationKitEventTypes } from '@clearshift/contracts';
import type {
  ICrm5ProjectionStore,
  IConsumedEventsRepository,
  Crm5RunProjection,
  Crm5ScoreProjection,
  Crm5ReconciliationProjection,
} from './types.js';

export interface ProjectorResult {
  eventId: string;
  eventType: string;
  outcome: 'projected' | 'skipped_duplicate' | 'ignored_unknown';
  applied: boolean;
  reason?: string;
}

const STEP_PRECEDENCE: Record<string, number> = {
  extract: 1,
  profile: 2,
  clean: 3,
  map: 4,
  dry_run: 5,
  load: 6,
  validate: 7,
  reconcile: 8,
};

/**
 * CRM-5 Event Projector (KIT-13)
 *
 * Consumes transactional event envelopes from PostgreSQL Outbox / Redis Streams
 * and projects them into CRM-5 read models (runs, quality scores, reconciliation reports).
 *
 * Guarantees:
 * 1. Consumer Deduplication: Idempotently processes events using platform.consumed_events.
 * 2. Out-of-Order Tolerance: Monotonic step progression ensures out-of-order deliveries
 *    never regress run status, step ordering, or completed counts.
 * 3. Failure Safety: Hard failures mark runs as 'failed' with failure metadata.
 */
export class Crm5EventProjector {
  private consumerName: string;

  constructor(
    private projectionStore: ICrm5ProjectionStore,
    private consumedEvents: IConsumedEventsRepository,
    options?: { consumerName?: string }
  ) {
    this.consumerName = options?.consumerName ?? 'crm5-projection-worker';
  }

  public async projectEvent(envelope: EventEnvelope<Record<string, unknown>>): Promise<ProjectorResult> {
    // 1. Deduplication Check (platform.consumed_events)
    const alreadyConsumed = await this.consumedEvents.isEventConsumed(
      this.consumerName,
      envelope.id
    );
    if (alreadyConsumed) {
      return {
        eventId: envelope.id,
        eventType: envelope.eventType,
        outcome: 'skipped_duplicate',
        applied: false,
        reason: `Event '${envelope.id}' was already processed by consumer '${this.consumerName}'`,
      };
    }

    // 2. Dispatch to specific projector handler
    let handled = false;
    switch (envelope.eventType) {
      case MigrationKitEventTypes.BATCH_EXTRACTED:
        await this.handleBatchExtracted(envelope as unknown as EventEnvelope<KitBatchExtractedPayload>);
        handled = true;
        break;

      case MigrationKitEventTypes.BATCH_PROFILED:
        await this.handleBatchProfiled(envelope as unknown as EventEnvelope<KitBatchProfiledPayload>);
        handled = true;
        break;

      case MigrationKitEventTypes.BATCH_CLEANED:
        await this.handleBatchCleaned(envelope as unknown as EventEnvelope<KitBatchCleanedPayload>);
        handled = true;
        break;

      case MigrationKitEventTypes.BATCH_MAPPED:
        await this.handleBatchMapped(envelope as unknown as EventEnvelope<KitBatchMappedPayload>);
        handled = true;
        break;

      case MigrationKitEventTypes.BATCH_LOADED:
        await this.handleBatchLoaded(envelope as unknown as EventEnvelope<KitBatchLoadedPayload>);
        handled = true;
        break;

      case MigrationKitEventTypes.BATCH_VALIDATED:
        await this.handleBatchValidated(envelope as unknown as EventEnvelope<KitBatchValidatedPayload>);
        handled = true;
        break;

      case MigrationKitEventTypes.BATCH_FAILED:
        await this.handleBatchFailed(envelope as unknown as EventEnvelope<KitBatchFailedPayload>);
        handled = true;
        break;

      case MigrationKitEventTypes.CONTACT_MERGED:
        await this.handleContactMerged(envelope as unknown as EventEnvelope<KitContactMergedPayload>);
        handled = true;
        break;

      default:
        return {
          eventId: envelope.id,
          eventType: envelope.eventType,
          outcome: 'ignored_unknown',
          applied: false,
          reason: `Unrecognized event type: '${envelope.eventType}'`,
        };
    }

    // 3. Mark event as consumed
    if (handled) {
      await this.consumedEvents.recordConsumed(this.consumerName, envelope.id);
    }

    return {
      eventId: envelope.id,
      eventType: envelope.eventType,
      outcome: 'projected',
      applied: true,
    };
  }

  // --------------------------------------------------------------------------
  // Event Projection Handlers
  // --------------------------------------------------------------------------

  private async handleBatchExtracted(envelope: EventEnvelope<KitBatchExtractedPayload>): Promise<void> {
    const p = envelope.payload;
    const existing = await this.projectionStore.getRun(p.batch_id);
    const now = new Date(p.occurred_at);

    if (existing) {
      // Do not regress if already in a later step
      const currentLevel = STEP_PRECEDENCE[existing.step] ?? 0;
      const targetLevel = STEP_PRECEDENCE['extract'] ?? 1;

      const updated: Crm5RunProjection = {
        ...existing,
        recordsIn: Math.max(existing.recordsIn, p.counts.source_count),
        recordsOut: Math.max(existing.recordsOut, p.counts.raw_count),
        step: currentLevel > targetLevel ? existing.step : 'extract',
        status: existing.status === 'failed' ? 'failed' : 'completed',
        updatedAt: now,
      };
      await this.projectionStore.saveRun(updated);
    } else {
      const newRun: Crm5RunProjection = {
        id: crypto.randomUUID(),
        batchId: p.batch_id,
        module: p.module,
        step: 'extract',
        status: 'completed',
        recordsIn: p.counts.source_count,
        recordsOut: p.counts.raw_count,
        recordsRejected: 0,
        startedAt: now,
        completedAt: now,
        metadata: p.references ?? null,
        createdAt: now,
        updatedAt: now,
      };
      await this.projectionStore.saveRun(newRun);
    }
  }

  private async handleBatchProfiled(envelope: EventEnvelope<KitBatchProfiledPayload>): Promise<void> {
    const p = envelope.payload;
    const existing = await this.projectionStore.getRun(p.batch_id);
    const now = new Date(p.occurred_at);

    if (existing) {
      const currentLevel = STEP_PRECEDENCE[existing.step] ?? 0;
      const targetLevel = STEP_PRECEDENCE['profile'] ?? 2;

      const updated: Crm5RunProjection = {
        ...existing,
        step: currentLevel > targetLevel ? existing.step : 'profile',
        status: existing.status === 'failed' ? 'failed' : 'completed',
        updatedAt: now,
      };
      await this.projectionStore.saveRun(updated);
    } else {
      const newRun: Crm5RunProjection = {
        id: crypto.randomUUID(),
        batchId: p.batch_id,
        module: p.module,
        step: 'profile',
        status: 'completed',
        recordsIn: p.counts.total_rows,
        recordsOut: p.counts.total_rows,
        recordsRejected: 0,
        startedAt: now,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      await this.projectionStore.saveRun(newRun);
    }

    // Populate or update Quality Score Projection if references present
    if (p.references) {
      const refs = p.references;
      const isFullyScored = refs.overall_score !== undefined;
      const scoreProj: Crm5ScoreProjection = {
        id: crypto.randomUUID(),
        batchId: p.batch_id,
        module: p.module,
        completeness: refs.completeness ?? null,
        validity: refs.validity ?? null,
        duplicateRate: refs.duplicate_rate ?? null,
        rejectRate: refs.reject_rate ?? null,
        linkIntegrity: refs.link_integrity ?? null,
        score: refs.overall_score ?? null,
        isFullyScored,
        scoredAt: now,
        createdAt: now,
      };
      await this.projectionStore.saveScore(scoreProj);
    }
  }

  private async handleBatchCleaned(envelope: EventEnvelope<KitBatchCleanedPayload>): Promise<void> {
    const p = envelope.payload;
    const existing = await this.projectionStore.getRun(p.batch_id);
    const now = new Date(p.occurred_at);

    if (existing) {
      const currentLevel = STEP_PRECEDENCE[existing.step] ?? 0;
      const targetLevel = STEP_PRECEDENCE['clean'] ?? 3;

      const updated: Crm5RunProjection = {
        ...existing,
        recordsIn: Math.max(existing.recordsIn, p.counts.input_rows),
        recordsOut: currentLevel > targetLevel ? existing.recordsOut : p.counts.clean_rows,
        recordsRejected: Math.max(existing.recordsRejected, p.counts.rejected_rows),
        step: currentLevel > targetLevel ? existing.step : 'clean',
        status: existing.status === 'failed' ? 'failed' : 'completed',
        updatedAt: now,
      };
      await this.projectionStore.saveRun(updated);
    } else {
      const newRun: Crm5RunProjection = {
        id: crypto.randomUUID(),
        batchId: p.batch_id,
        module: p.module,
        step: 'clean',
        status: 'completed',
        recordsIn: p.counts.input_rows,
        recordsOut: p.counts.clean_rows,
        recordsRejected: p.counts.rejected_rows,
        startedAt: now,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      await this.projectionStore.saveRun(newRun);
    }
  }

  private async handleBatchMapped(envelope: EventEnvelope<KitBatchMappedPayload>): Promise<void> {
    const p = envelope.payload;
    const existing = await this.projectionStore.getRun(p.batch_id);
    const now = new Date(p.occurred_at);

    if (existing) {
      const currentLevel = STEP_PRECEDENCE[existing.step] ?? 0;
      const targetLevel = STEP_PRECEDENCE['map'] ?? 4;

      const updated: Crm5RunProjection = {
        ...existing,
        step: currentLevel > targetLevel ? existing.step : 'map',
        status: existing.status === 'failed' ? 'failed' : 'completed',
        updatedAt: now,
      };
      await this.projectionStore.saveRun(updated);
    } else {
      const newRun: Crm5RunProjection = {
        id: crypto.randomUUID(),
        batchId: p.batch_id,
        module: p.module,
        step: 'map',
        status: 'completed',
        recordsIn: p.counts.mapped_rows + (p.counts.unmapped_rows ?? 0),
        recordsOut: p.counts.mapped_rows,
        recordsRejected: p.counts.unmapped_rows ?? 0,
        startedAt: now,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      await this.projectionStore.saveRun(newRun);
    }
  }

  private async handleBatchLoaded(envelope: EventEnvelope<KitBatchLoadedPayload>): Promise<void> {
    const p = envelope.payload;
    const existing = await this.projectionStore.getRun(p.batch_id);
    const now = new Date(p.occurred_at);

    if (existing) {
      const currentLevel = STEP_PRECEDENCE[existing.step] ?? 0;
      const targetLevel = STEP_PRECEDENCE['load'] ?? 6;

      const updated: Crm5RunProjection = {
        ...existing,
        recordsOut: p.counts.loaded_count,
        recordsRejected: Math.max(existing.recordsRejected, p.counts.rejected_count),
        step: currentLevel > targetLevel ? existing.step : 'load',
        status: existing.status === 'failed' ? 'failed' : 'completed',
        updatedAt: now,
      };
      await this.projectionStore.saveRun(updated);
    } else {
      const sourceCount =
        p.counts.loaded_count +
        p.counts.rejected_count +
        (p.counts.merged_count ?? 0) +
        (p.counts.skipped_count ?? 0);

      const newRun: Crm5RunProjection = {
        id: crypto.randomUUID(),
        batchId: p.batch_id,
        module: p.module,
        step: 'load',
        status: 'completed',
        recordsIn: sourceCount,
        recordsOut: p.counts.loaded_count,
        recordsRejected: p.counts.rejected_count,
        startedAt: now,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      await this.projectionStore.saveRun(newRun);
    }

    // Populate / update Reconciliation Report Read Model
    const existingRecon = await this.projectionStore.getReconciliation(p.batch_id);
    const sourceCount =
      existing?.recordsIn ??
      (p.counts.loaded_count +
        p.counts.rejected_count +
        (p.counts.merged_count ?? 0) +
        (p.counts.skipped_count ?? 0));

    const recon: Crm5ReconciliationProjection = {
      id: existingRecon?.id ?? crypto.randomUUID(),
      batchId: p.batch_id,
      module: p.module,
      sourceCount: Math.max(existingRecon?.sourceCount ?? 0, sourceCount),
      loadedCount: p.counts.loaded_count,
      rejectedCount: p.counts.rejected_count,
      mergedCount: p.counts.merged_count ?? existingRecon?.mergedCount ?? 0,
      skippedCount: p.counts.skipped_count ?? existingRecon?.skippedCount ?? 0,
      unaccountedCount: p.counts.unaccounted_count ?? 0,
      status: (p.counts.unaccounted_count ?? 0) === 0 ? 'OK' : 'UNBALANCED',
      reconciledAt: now,
      createdAt: existingRecon?.createdAt ?? now,
    };
    await this.projectionStore.saveReconciliation(recon);
  }

  private async handleBatchValidated(envelope: EventEnvelope<KitBatchValidatedPayload>): Promise<void> {
    const p = envelope.payload;
    const existing = await this.projectionStore.getRun(p.batch_id);
    const now = new Date(p.occurred_at);

    if (existing) {
      const currentLevel = STEP_PRECEDENCE[existing.step] ?? 0;
      const targetLevel = STEP_PRECEDENCE['validate'] ?? 7;

      const updated: Crm5RunProjection = {
        ...existing,
        step: currentLevel > targetLevel ? existing.step : 'validate',
        status: existing.status === 'failed' ? 'failed' : 'completed',
        updatedAt: now,
      };
      await this.projectionStore.saveRun(updated);
    }

    const existingRecon = await this.projectionStore.getReconciliation(p.batch_id);
    if (existingRecon) {
      const isBalanced =
        p.references.status === 'OK' ||
        (p.references.status === 'PASSED' && p.counts.failed_count === 0);

      const updatedRecon: Crm5ReconciliationProjection = {
        ...existingRecon,
        status: isBalanced ? 'OK' : 'UNBALANCED',
        reconciledAt: now,
      };
      await this.projectionStore.saveReconciliation(updatedRecon);
    }
  }

  private async handleBatchFailed(envelope: EventEnvelope<KitBatchFailedPayload>): Promise<void> {
    const p = envelope.payload;
    const existing = await this.projectionStore.getRun(p.batch_id);
    const now = new Date(p.occurred_at);

    if (existing) {
      const updated: Crm5RunProjection = {
        ...existing,
        status: 'failed',
        step: p.failed_step,
        completedAt: now,
        metadata: {
          ...(existing.metadata ?? {}),
          errorCode: p.error_code,
          errorMessage: p.error_message,
          failedStep: p.failed_step,
        },
        updatedAt: now,
      };
      await this.projectionStore.saveRun(updated);
    } else {
      const newRun: Crm5RunProjection = {
        id: crypto.randomUUID(),
        batchId: p.batch_id,
        module: p.module,
        step: p.failed_step,
        status: 'failed',
        recordsIn: p.counts?.attempted_rows ?? 0,
        recordsOut: 0,
        recordsRejected: 0,
        startedAt: now,
        completedAt: now,
        metadata: {
          errorCode: p.error_code,
          errorMessage: p.error_message,
          failedStep: p.failed_step,
        },
        createdAt: now,
        updatedAt: now,
      };
      await this.projectionStore.saveRun(newRun);
    }
  }

  private async handleContactMerged(envelope: EventEnvelope<KitContactMergedPayload>): Promise<void> {
    const p = envelope.payload;
    const existingRecon = await this.projectionStore.getReconciliation(p.batch_id);
    const now = new Date(p.occurred_at);

    if (existingRecon) {
      const newMerged = existingRecon.mergedCount + p.counts.total_merged;
      const unaccounted =
        existingRecon.sourceCount -
        (existingRecon.loadedCount + existingRecon.rejectedCount + newMerged + existingRecon.skippedCount);

      const updated: Crm5ReconciliationProjection = {
        ...existingRecon,
        mergedCount: newMerged,
        unaccountedCount: Math.max(0, unaccounted),
        status: unaccounted === 0 ? 'OK' : 'UNBALANCED',
        reconciledAt: now,
      };
      await this.projectionStore.saveReconciliation(updated);
    }
  }
}
