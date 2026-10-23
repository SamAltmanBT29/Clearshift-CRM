import {
  EntityType,
  GoldenRecord,
  SourceIdentityMapRecord,
  IdentityEvidence,
  IdentityReviewCandidate,
  GoldenIdHistoryRecord,
} from '@clearshift/contracts';

export interface CreateGoldenRecordParams {
  id?: string | undefined;
  displayGid?: string | undefined;
  entityType: EntityType;
  metadata?: Record<string, unknown> | undefined;
}

export interface CreateSourceMappingParams {
  goldenRecordId: string;
  displayGid: string;
  entityType: EntityType;
  sourceSystem: string;
  sourceId: string;
  metadata?: Record<string, unknown> | undefined;
}

export interface IGoldenIdRepository {
  findGoldenRecordById(id: string): Promise<GoldenRecord | null>;
  findGoldenRecordByDisplayGid(displayGid: string): Promise<GoldenRecord | null>;
  findSourceMapping(
    entityType: EntityType,
    sourceSystem: string,
    sourceId: string
  ): Promise<SourceIdentityMapRecord | null>;
  findSourceMappingsByGoldenId(goldenRecordId: string): Promise<SourceIdentityMapRecord[]>;
  findRecordsByEvidence(
    entityType: EntityType,
    evidence: IdentityEvidence
  ): Promise<Array<{ record: GoldenRecord; mapping?: SourceIdentityMapRecord; matchedKey: string }>>;
  createGoldenRecordWithMapping(
    recordParams: CreateGoldenRecordParams,
    mappingParams: Omit<CreateSourceMappingParams, 'goldenRecordId' | 'displayGid'>,
    historyAction?: 'mapped' | 'conflict_flagged',
    actor?: string
  ): Promise<{ record: GoldenRecord; mapping: SourceIdentityMapRecord }>;
  repointSourceMappings(
    sourceGoldenRecordId: string,
    targetGoldenRecordId: string,
    actor: string,
    reason: string
  ): Promise<SourceIdentityMapRecord[]>;
  markGoldenRecordMerged(
    sourceGoldenRecordId: string,
    targetGoldenRecordId: string
  ): Promise<GoldenRecord>;
  addHistoryRecord(history: Omit<GoldenIdHistoryRecord, 'id' | 'timestamp'>): Promise<GoldenIdHistoryRecord>;
  getHistory(goldenRecordId: string): Promise<GoldenIdHistoryRecord[]>;
}

export interface GoldenIdServiceOptions {
  repository?: IGoldenIdRepository;
  auditService?: {
    logPrivilegedAction?: (entry: any) => Promise<any>;
    logMergeDecision?: (entry: any) => Promise<any>;
  };
}
