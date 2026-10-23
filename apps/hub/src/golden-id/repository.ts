import { randomUUID } from 'crypto';
import {
  EntityType,
  GoldenRecord,
  SourceIdentityMapRecord,
  IdentityEvidence,
  GoldenIdHistoryRecord,
} from '@clearshift/contracts';
import {
  IGoldenIdRepository,
  CreateGoldenRecordParams,
  CreateSourceMappingParams,
} from './types.js';
import {
  generatePrimaryIdentityId,
  formatDisplayGid,
  assertNotDisplayGidAsKey,
} from './generator.js';
import { normalizeEvidence } from './conflict-detector.js';

export class InMemoryGoldenIdRepository implements IGoldenIdRepository {
  private goldenRecords = new Map<string, GoldenRecord>();
  private sourceMappings = new Map<string, SourceIdentityMapRecord>();
  private history = new Map<string, GoldenIdHistoryRecord[]>();

  // Inverted indexes for evidence lookup, strictly partitioned by EntityType
  private emailIndex = new Map<string, string>(); // `${entityType}:::${normEmail}` -> goldenRecordId
  private taxIndex = new Map<string, string>(); // `${entityType}:::${normTax}` -> goldenRecordId
  private phoneIndex = new Map<string, string>(); // `${entityType}:::${normPhone}` -> goldenRecordId

  // Mutex locks for atomic concurrency handling per source key
  private locks = new Map<string, Promise<unknown>>();

  private buildSourceKey(entityType: EntityType, sourceSystem: string, sourceId: string): string {
    // Preserve string identifier verbatim without lossy numeric conversion
    return `${entityType}:::${sourceSystem}:::${String(sourceId)}`;
  }

  public async acquireLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    while (this.locks.has(key)) {
      try {
        await this.locks.get(key);
      } catch {
        // ignore prior lock rejection
      }
    }

    let resolveLock!: () => void;
    let rejectLock!: (err: unknown) => void;
    const lockPromise = new Promise<void>((res, rej) => {
      resolveLock = res;
      rejectLock = rej;
    });

    this.locks.set(key, lockPromise);

    try {
      const result = await task();
      resolveLock();
      return result;
    } catch (err) {
      rejectLock(err);
      throw err;
    } finally {
      this.locks.delete(key);
    }
  }

  public async findGoldenRecordById(id: string): Promise<GoldenRecord | null> {
    assertNotDisplayGidAsKey(id, 'id');
    const record = this.goldenRecords.get(id);
    return record ? { ...record } : null;
  }

  public async findGoldenRecordByDisplayGid(displayGid: string): Promise<GoldenRecord | null> {
    for (const record of this.goldenRecords.values()) {
      if (record.displayGid === displayGid) {
        return { ...record };
      }
    }
    return null;
  }

  public async findSourceMapping(
    entityType: EntityType,
    sourceSystem: string,
    sourceId: string
  ): Promise<SourceIdentityMapRecord | null> {
    const key = this.buildSourceKey(entityType, sourceSystem, sourceId);
    const mapping = this.sourceMappings.get(key);
    return mapping ? { ...mapping } : null;
  }

  public async findSourceMappingsByGoldenId(
    goldenRecordId: string
  ): Promise<SourceIdentityMapRecord[]> {
    assertNotDisplayGidAsKey(goldenRecordId, 'goldenRecordId');
    const results: SourceIdentityMapRecord[] = [];
    for (const mapping of this.sourceMappings.values()) {
      if (mapping.goldenRecordId === goldenRecordId) {
        results.push({ ...mapping });
      }
    }
    return results;
  }

  public async findRecordsByEvidence(
    entityType: EntityType,
    evidence: IdentityEvidence
  ): Promise<Array<{ record: GoldenRecord; mapping?: SourceIdentityMapRecord; matchedKey: string }>> {
    const norm = normalizeEvidence(evidence);
    const matchedGoldenIds = new Map<string, string>(); // goldenRecordId -> matchedKey

    if (norm.normalizedTaxNumber) {
      const taxKey = `${entityType}:::${norm.normalizedTaxNumber}`;
      const gid = this.taxIndex.get(taxKey);
      if (gid) matchedGoldenIds.set(gid, `tax_number:${norm.normalizedTaxNumber}`);
    }

    if (norm.normalizedEmail) {
      const emailKey = `${entityType}:::${norm.normalizedEmail}`;
      const gid = this.emailIndex.get(emailKey);
      if (gid) matchedGoldenIds.set(gid, `email:${norm.normalizedEmail}`);
    }

    if (norm.normalizedPhone) {
      const phoneKey = `${entityType}:::${norm.normalizedPhone}`;
      const gid = this.phoneIndex.get(phoneKey);
      if (gid) matchedGoldenIds.set(gid, `phone:${norm.normalizedPhone}`);
    }

    const results: Array<{ record: GoldenRecord; mapping?: SourceIdentityMapRecord; matchedKey: string }> = [];

    for (const [gid, matchedKey] of matchedGoldenIds.entries()) {
      const record = this.goldenRecords.get(gid);
      if (record && record.entityType === entityType) {
        const mappings = await this.findSourceMappingsByGoldenId(gid);
        const primaryMapping = mappings[0];
        const item: { record: GoldenRecord; mapping?: SourceIdentityMapRecord; matchedKey: string } = {
          record: { ...record },
          matchedKey,
        };
        if (primaryMapping) {
          item.mapping = primaryMapping;
        }
        results.push(item);
      }
    }

    return results;
  }

  public async createGoldenRecordWithMapping(
    recordParams: CreateGoldenRecordParams,
    mappingParams: Omit<CreateSourceMappingParams, 'goldenRecordId' | 'displayGid'>,
    historyAction: 'mapped' | 'conflict_flagged' = 'mapped',
    actor?: string
  ): Promise<{ record: GoldenRecord; mapping: SourceIdentityMapRecord }> {
    const sourceKey = this.buildSourceKey(
      mappingParams.entityType,
      mappingParams.sourceSystem,
      mappingParams.sourceId
    );

    return this.acquireLock(sourceKey, async () => {
      // Check existing under lock to ensure strict idempotency and single row creation
      const existing = this.sourceMappings.get(sourceKey);
      if (existing) {
        const record = this.goldenRecords.get(existing.goldenRecordId)!;
        return { record: { ...record }, mapping: { ...existing } };
      }

      const goldenId = recordParams.id ?? generatePrimaryIdentityId();
      assertNotDisplayGidAsKey(goldenId, 'goldenRecordId');

      const displayGid =
        recordParams.displayGid ?? formatDisplayGid(recordParams.entityType, goldenId);

      const now = new Date().toISOString();

      const newRecord: GoldenRecord = {
        id: goldenId,
        displayGid,
        entityType: recordParams.entityType,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };

      const newMapping: SourceIdentityMapRecord = {
        id: randomUUID(),
        goldenRecordId: goldenId,
        displayGid,
        entityType: mappingParams.entityType,
        sourceSystem: mappingParams.sourceSystem,
        sourceId: String(mappingParams.sourceId), // Ensure string representation
        createdAt: now,
      };
      if (mappingParams.metadata) {
        newMapping.metadata = mappingParams.metadata;
      }

      this.goldenRecords.set(goldenId, newRecord);
      this.sourceMappings.set(sourceKey, newMapping);

      // Index evidence for lookup
      const evidence = mappingParams.metadata?.['evidence'] as IdentityEvidence | undefined;
      if (evidence) {
        const norm = normalizeEvidence(evidence);
        if (norm.normalizedTaxNumber) {
          this.taxIndex.set(`${recordParams.entityType}:::${norm.normalizedTaxNumber}`, goldenId);
        }
        if (norm.normalizedEmail) {
          this.emailIndex.set(`${recordParams.entityType}:::${norm.normalizedEmail}`, goldenId);
        }
        if (norm.normalizedPhone) {
          this.phoneIndex.set(`${recordParams.entityType}:::${norm.normalizedPhone}`, goldenId);
        }
      }

      // Record history
      const historyItem: GoldenIdHistoryRecord = {
        id: randomUUID(),
        goldenRecordId: goldenId,
        sourceSystem: mappingParams.sourceSystem,
        sourceId: String(mappingParams.sourceId),
        action: historyAction,
        timestamp: now,
      };
      if (actor) historyItem.actor = actor;
      if (mappingParams.metadata) historyItem.details = mappingParams.metadata;

      const recordHistory = this.history.get(goldenId) ?? [];
      recordHistory.push(historyItem);
      this.history.set(goldenId, recordHistory);

      return { record: { ...newRecord }, mapping: { ...newMapping } };
    });
  }

  public async repointSourceMappings(
    sourceGoldenRecordId: string,
    targetGoldenRecordId: string,
    actor: string,
    reason: string
  ): Promise<SourceIdentityMapRecord[]> {
    assertNotDisplayGidAsKey(sourceGoldenRecordId, 'sourceGoldenRecordId');
    assertNotDisplayGidAsKey(targetGoldenRecordId, 'targetGoldenRecordId');

    const targetRecord = this.goldenRecords.get(targetGoldenRecordId);
    if (!targetRecord) {
      throw new Error(`Target Golden Record '${targetGoldenRecordId}' not found.`);
    }

    const repointed: SourceIdentityMapRecord[] = [];
    const now = new Date().toISOString();

    for (const [key, mapping] of this.sourceMappings.entries()) {
      if (mapping.goldenRecordId === sourceGoldenRecordId) {
        const updatedMapping: SourceIdentityMapRecord = {
          ...mapping,
          goldenRecordId: targetGoldenRecordId,
          displayGid: targetRecord.displayGid,
          updatedAt: now,
        };
        this.sourceMappings.set(key, updatedMapping);
        repointed.push({ ...updatedMapping });

        // Add history record for repointed source
        const historyItem: GoldenIdHistoryRecord = {
          id: randomUUID(),
          goldenRecordId: targetGoldenRecordId,
          sourceSystem: mapping.sourceSystem,
          sourceId: mapping.sourceId,
          action: 'repointed',
          timestamp: now,
          actor,
          details: {
            previousGoldenRecordId: sourceGoldenRecordId,
            reason,
          },
        };
        const recordHistory = this.history.get(targetGoldenRecordId) ?? [];
        recordHistory.push(historyItem);
        this.history.set(targetGoldenRecordId, recordHistory);
      }
    }

    return repointed;
  }

  public async markGoldenRecordMerged(
    sourceGoldenRecordId: string,
    targetGoldenRecordId: string
  ): Promise<GoldenRecord> {
    assertNotDisplayGidAsKey(sourceGoldenRecordId, 'sourceGoldenRecordId');
    assertNotDisplayGidAsKey(targetGoldenRecordId, 'targetGoldenRecordId');

    const record = this.goldenRecords.get(sourceGoldenRecordId);
    if (!record) {
      throw new Error(`Source Golden Record '${sourceGoldenRecordId}' not found.`);
    }

    const updated: GoldenRecord = {
      ...record,
      status: 'merged',
      mergedIntoId: targetGoldenRecordId,
      updatedAt: new Date().toISOString(),
    };
    this.goldenRecords.set(sourceGoldenRecordId, updated);
    return { ...updated };
  }

  public async addHistoryRecord(
    history: Omit<GoldenIdHistoryRecord, 'id' | 'timestamp'>
  ): Promise<GoldenIdHistoryRecord> {
    assertNotDisplayGidAsKey(history.goldenRecordId, 'goldenRecordId');
    const item: GoldenIdHistoryRecord = {
      ...history,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };
    const list = this.history.get(history.goldenRecordId) ?? [];
    list.push(item);
    this.history.set(history.goldenRecordId, list);
    return { ...item };
  }

  public async getHistory(goldenRecordId: string): Promise<GoldenIdHistoryRecord[]> {
    assertNotDisplayGidAsKey(goldenRecordId, 'goldenRecordId');
    const list = this.history.get(goldenRecordId) ?? [];
    return list.map((h) => ({ ...h }));
  }

  public clear(): void {
    this.goldenRecords.clear();
    this.sourceMappings.clear();
    this.history.clear();
    this.emailIndex.clear();
    this.taxIndex.clear();
    this.phoneIndex.clear();
    this.locks.clear();
  }
}
