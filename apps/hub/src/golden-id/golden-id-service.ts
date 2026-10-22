import {
  EntityType,
  UpsertSourceIdentityRequest,
  UpsertSourceIdentityResponse,
  LookupSourceIdentityQuery,
  ResolveEvidenceRequest,
  MergeGoldenIdRequest,
  GoldenRecordDetailResponse,
  GoldenIdHistoryRecord,
} from '@clearshift/contracts';
import { IGoldenIdRepository, GoldenIdServiceOptions, CreateGoldenRecordParams } from './types.js';
import { InMemoryGoldenIdRepository } from './repository.js';
import { evaluateEvidenceConflict } from './conflict-detector.js';
import { assertNotDisplayGidAsKey } from './generator.js';

export class GoldenIdService {
  private repository: IGoldenIdRepository;
  private auditService?: GoldenIdServiceOptions['auditService'];

  constructor(options?: GoldenIdServiceOptions) {
    this.repository = options?.repository ?? new InMemoryGoldenIdRepository();
    this.auditService = options?.auditService;
  }

  public getRepository(): IGoldenIdRepository {
    return this.repository;
  }

  /**
   * Idempotent Upsert for Source Identity (PLT-07).
   * Invariants:
   * - Same entity/source-system/source-id returns same Golden ID across repeated calls.
   * - Different entity types may not collide.
   * - Concurrent upsert for same source key creates one map row.
   * - Conflicting tax/email/phone evidence opens review and does not auto-merge.
   * - No display GID is used as a primary or foreign key.
   */
  public async upsertSourceIdentity(
    request: UpsertSourceIdentityRequest,
    context?: { actor?: string; correlationId?: string }
  ): Promise<UpsertSourceIdentityResponse> {
    const { entityType, sourceSystem, sourceId, evidence } = request;
    const cleanSourceId = String(sourceId);

    // 1. Check existing source mapping under lock in repository
    const existingMapping = await this.repository.findSourceMapping(
      entityType,
      sourceSystem,
      cleanSourceId
    );

    if (existingMapping) {
      return {
        goldenRecordId: existingMapping.goldenRecordId,
        displayGid: existingMapping.displayGid,
        entityType: existingMapping.entityType,
        sourceSystem: existingMapping.sourceSystem,
        sourceId: existingMapping.sourceId,
        status: 'existing',
        createdAt: existingMapping.createdAt,
      };
    }

    // 2. Conflict Detection for new identity
    let hasConflict = false;
    let reviewCandidate: UpsertSourceIdentityResponse['reviewCandidate'] | undefined;

    if (evidence) {
      const existingMatches = await this.repository.findRecordsByEvidence(entityType, evidence);
      if (existingMatches.length > 0) {
        const conflictEval = evaluateEvidenceConflict({
          entityType,
          sourceSystem,
          sourceId: cleanSourceId,
          candidateEvidence: evidence,
          matches: existingMatches,
        });

        if (conflictEval.hasConflict) {
          hasConflict = true;
          reviewCandidate = conflictEval.reviewCandidate;
        }
      }
    }

    // 3. Create Golden Record with atomic mapping
    const metadata: Record<string, unknown> = {};
    if (evidence) {
      metadata['evidence'] = evidence;
    }
    if (hasConflict && reviewCandidate) {
      metadata['reviewCandidate'] = reviewCandidate;
    }

    const recordParams: CreateGoldenRecordParams = {
      entityType,
    };
    if (hasConflict && reviewCandidate) {
      recordParams.metadata = { flaggedReason: reviewCandidate.reason };
    }

    const { record, mapping } = await this.repository.createGoldenRecordWithMapping(
      recordParams,
      {
        entityType,
        sourceSystem,
        sourceId: cleanSourceId,
        metadata,
      },
      hasConflict ? 'conflict_flagged' : 'mapped',
      context?.actor
    );

    // 4. Log Privileged Audit Action
    if (this.auditService?.logPrivilegedAction && context?.correlationId) {
      await this.auditService.logPrivilegedAction({
        actor: context.actor ?? 'hub_system',
        action: hasConflict ? 'identity.conflict_flagged' : 'identity.mapped',
        targetEntity: 'golden_id',
        targetId: record.id,
        correlationId: context.correlationId,
        result: 'success',
        metadata: {
          displayGid: record.displayGid,
          sourceSystem,
          sourceId: cleanSourceId,
          entityType,
          hasConflict,
        },
      });
    }

    const response: UpsertSourceIdentityResponse = {
      goldenRecordId: record.id,
      displayGid: record.displayGid,
      entityType: record.entityType,
      sourceSystem: mapping.sourceSystem,
      sourceId: mapping.sourceId,
      status: hasConflict ? 'review_required' : 'created',
      createdAt: mapping.createdAt,
    };

    if (reviewCandidate) {
      response.reviewCandidate = reviewCandidate;
    }

    return response;
  }

  /**
   * Looks up a source mapping by composite key (entityType, sourceSystem, sourceId).
   */
  public async lookupSourceIdentity(
    query: LookupSourceIdentityQuery
  ): Promise<UpsertSourceIdentityResponse | null> {
    const mapping = await this.repository.findSourceMapping(
      query.entityType,
      query.sourceSystem,
      String(query.sourceId)
    );

    if (!mapping) return null;

    return {
      goldenRecordId: mapping.goldenRecordId,
      displayGid: mapping.displayGid,
      entityType: mapping.entityType,
      sourceSystem: mapping.sourceSystem,
      sourceId: mapping.sourceId,
      status: 'existing',
      createdAt: mapping.createdAt,
    };
  }

  /**
   * Looks up a Golden Record by UUID primary key and fetches all linked source mappings.
   * Invariant: Display GID is forbidden as lookup primary key.
   */
  public async lookupByGoldenId(
    goldenRecordId: string
  ): Promise<GoldenRecordDetailResponse | null> {
    assertNotDisplayGidAsKey(goldenRecordId, 'goldenRecordId');

    const record = await this.repository.findGoldenRecordById(goldenRecordId);
    if (!record) return null;

    const mappings = await this.repository.findSourceMappingsByGoldenId(goldenRecordId);
    const history = await this.repository.getHistory(goldenRecordId);

    return {
      record,
      mappings,
      history,
    };
  }

  /**
   * Resolves records by evidence for an entity namespace.
   */
  public async resolveEvidence(request: ResolveEvidenceRequest) {
    return this.repository.findRecordsByEvidence(request.entityType, {
      email: request.email,
      phone: request.phone,
      taxNumber: request.taxNumber,
    });
  }

  /**
   * Explicit Human-Governed Merge Operation (Acceptance Criterion 4).
   * Exact matches produce review candidates where destructive merge is possible; no fuzzy auto-merge.
   */
  public async mergeGoldenRecords(
    request: MergeGoldenIdRequest,
    context?: { correlationId?: string }
  ): Promise<GoldenRecordDetailResponse> {
    assertNotDisplayGidAsKey(request.targetGoldenRecordId, 'targetGoldenRecordId');
    assertNotDisplayGidAsKey(request.sourceGoldenRecordId, 'sourceGoldenRecordId');

    if (request.targetGoldenRecordId === request.sourceGoldenRecordId) {
      throw new Error('Cannot merge a Golden Record into itself.');
    }

    const targetRecord = await this.repository.findGoldenRecordById(request.targetGoldenRecordId);
    if (!targetRecord) {
      throw new Error(`Target Golden Record '${request.targetGoldenRecordId}' not found.`);
    }

    const sourceRecord = await this.repository.findGoldenRecordById(request.sourceGoldenRecordId);
    if (!sourceRecord) {
      throw new Error(`Source Golden Record '${request.sourceGoldenRecordId}' not found.`);
    }

    if (targetRecord.entityType !== sourceRecord.entityType) {
      throw new Error(
        `Cannot merge records across different entity types: '${targetRecord.entityType}' and '${sourceRecord.entityType}'.`
      );
    }

    // Repoint mappings and mark source as merged
    await this.repository.repointSourceMappings(
      request.sourceGoldenRecordId,
      request.targetGoldenRecordId,
      request.actor,
      request.reason
    );

    await this.repository.markGoldenRecordMerged(
      request.sourceGoldenRecordId,
      request.targetGoldenRecordId
    );

    // Audit Event
    if (this.auditService?.logMergeDecision && context?.correlationId) {
      await this.auditService.logMergeDecision({
        actor: request.actor,
        correlationId: context.correlationId,
        survivingGoldenId: targetRecord.id,
        subsumedSourceId: sourceRecord.id,
        decision: 'approved',
        approverNotes: request.reason,
      });
    }

    const updatedTarget = (await this.repository.findGoldenRecordById(
      request.targetGoldenRecordId
    ))!;
    const updatedMappings = await this.repository.findSourceMappingsByGoldenId(
      request.targetGoldenRecordId
    );
    const updatedHistory = await this.repository.getHistory(request.targetGoldenRecordId);

    return {
      record: updatedTarget,
      mappings: updatedMappings,
      history: updatedHistory,
    };
  }

  /**
   * Gets mapping history for a golden record.
   */
  public async getMappingHistory(goldenRecordId: string): Promise<GoldenIdHistoryRecord[]> {
    assertNotDisplayGidAsKey(goldenRecordId, 'goldenRecordId');
    return this.repository.getHistory(goldenRecordId);
  }
}
