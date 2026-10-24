/**
 * ClearShift CRM — CRM-5 Quality Assurance & Design Specifications
 *
 * Implements canonical QA & Data Lead specifications for CRM-5:
 * - Field-level Data Dictionary (all 5 tables: crm5_runs, crm5_scores, crm5_rejects, crm5_reconciliation_reports, crm5_import_receipts)
 * - Entity-Relationship Diagram (ERD) relationship metadata and cardinality
 * - Requirement-to-Test Traceability Matrix (mapping SDS §4.2 / §4.8 Must requirements to automated tests)
 * - Synthetic Dirty Data Pack Plan with defect distributions and conservation balance sheet
 *
 * Traceability:
 * - Issue: #197 [CRM5-24] CRM-5 Migration Control Center and Reports: Data dictionary, ERD, traceability and Dirty Data Pack plan
 * - ClearShift Project Plan v3.0 §§9.3–9.6, 17
 * - SDS ClearShift CRM v2.0 §4.2, §4.7, §4.8, §4.11, §4.12
 * - Master Architecture Blueprint Baseline 1.0-A §4.2
 */

export interface ColumnDefinition {
  name: string;
  pgType: string;
  nullable: boolean;
  default: string | null;
  constraints: string[];
  businessRule: string;
  example: string | number | boolean | Record<string, unknown> | null;
}

export interface TableDefinition {
  tableName: string;
  entityName: string;
  owner: string;
  description: string;
  columns: ColumnDefinition[];
  indexes: string[];
  checkConstraints: string[];
}

export interface RelationshipDefinition {
  relationshipId: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  cardinality: '1:1' | '1:N' | 'N:1' | '0..N';
  onDelete?: 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'NO ACTION';
  enforcement: 'Database Foreign Key' | 'Domain Application Guard' | 'API Projection' | 'Logical Event Correlation';
  description: string;
}

export interface TraceabilityEntry {
  reqId: string;
  requirement: string;
  priority: 'Must' | 'Should' | 'Could';
  sourceDoc: string;
  category: 'Database' | 'Domain' | 'API' | 'Web' | 'Security' | 'Migration';
  testType: 'unit' | 'contract' | 'regression' | 'schema' | 'security' | 'integration' | 'e2e';
  testFile: string;
  testSuite: string;
  verificationEvidence: string;
}

export interface DefectScenario {
  scenarioId: string;
  category: string;
  description: string;
  targetEntity: string;
  expectedOutcome: 'valid' | 'malformed' | 'null_required' | 'exact_duplicate' | 'foreign_key_missing' | 'loaded' | 'rejected' | 'merged' | 'skipped' | 'out_of_bounds' | 'invariant_violation' | 'whitespace_padding';
  reasonCode?: string;
  expectedCountIn100: number;
  expectedCountIn1000: number;
  sampleRecord: Record<string, unknown>;
}

export interface DirtyDataPackPlan {
  module: 'crm-5';
  targetEntities: string[];
  canonical1000Plan: {
    totalSourceRows: number;
    expectedLoaded: number;
    expectedRejected: number;
    expectedMerged: number;
    expectedSkipped: number;
    unaccounted: number;
  };
  module100Plan: {
    totalSourceRows: number;
    expectedLoaded: number;
    expectedRejected: number;
    expectedMerged: number;
    expectedSkipped: number;
    unaccounted: number;
  };
  scenarios: DefectScenario[];
}

// =============================================================================
// 1. DATA DICTIONARY (5 Tables)
// =============================================================================

export const CRM5_DATA_DICTIONARY: TableDefinition[] = [
  {
    tableName: 'crm5_runs',
    entityName: 'Migration Run Projection',
    owner: 'CRM-5 Migration Control Center (Group 5)',
    description: 'Stores immutable migration batch step execution events projected from Migration Kit outbox events.',
    columns: [
      {
        name: 'id',
        pgType: 'uuid',
        nullable: false,
        default: 'gen_random_uuid()',
        constraints: ['Primary Key'],
        businessRule: 'Immutable surrogate UUID primary key generated at projection record creation.',
        example: '550e8400-e29b-41d4-a716-446655440001',
      },
      {
        name: 'batch_id',
        pgType: 'varchar(128)',
        nullable: false,
        default: null,
        constraints: ['Indexed', 'Non-empty'],
        businessRule: 'Correlation identifier matching the Migration Kit execution batch ID. Indexed for fast lookup.',
        example: 'batch-2026-10-crm1-001',
      },
      {
        name: 'module',
        pgType: 'varchar(64)',
        nullable: false,
        default: null,
        constraints: ['Indexed', 'Module Allowlist'],
        businessRule: 'Target or source ClearShift module identifier (e.g. crm-1, crm-2, crm-3, crm-4, crm-5).',
        example: 'crm-1',
      },
      {
        name: 'step',
        pgType: 'varchar(32)',
        nullable: false,
        default: null,
        constraints: ['Migration Step Allowlist'],
        businessRule: 'Migration pipeline step enum (extract, profile, clean, map, load, validate, reconcile).',
        example: 'load',
      },
      {
        name: 'status',
        pgType: 'varchar(32)',
        nullable: false,
        default: "'pending'",
        constraints: ['chk_crm5_runs_status'],
        businessRule: 'Current execution status: pending, running, completed, failed, or halted.',
        example: 'completed',
      },
      {
        name: 'records_in',
        pgType: 'integer',
        nullable: false,
        default: '0',
        constraints: ['chk_crm5_runs_records_in (>= 0)'],
        businessRule: 'Total count of input records presented to this step. Must be non-negative.',
        example: 1000,
      },
      {
        name: 'records_out',
        pgType: 'integer',
        nullable: false,
        default: '0',
        constraints: ['chk_crm5_runs_records_out (>= 0)'],
        businessRule: 'Total count of successfully processed records output by this step. Must be non-negative.',
        example: 780,
      },
      {
        name: 'records_rejected',
        pgType: 'integer',
        nullable: false,
        default: '0',
        constraints: ['chk_crm5_runs_records_rejected (>= 0)'],
        businessRule: 'Total count of records rejected due to validation errors. Must be non-negative.',
        example: 140,
      },
      {
        name: 'started_at',
        pgType: 'timestamptz',
        nullable: false,
        default: 'now()',
        constraints: ['UTC Timestamp'],
        businessRule: 'UTC timestamp recording when the migration step commenced execution.',
        example: '2026-10-23T08:00:00.000Z',
      },
      {
        name: 'completed_at',
        pgType: 'timestamptz',
        nullable: true,
        default: null,
        constraints: ['UTC Timestamp (Optional)'],
        businessRule: 'UTC timestamp recording when execution terminated. Null while run is pending or running.',
        example: '2026-10-23T08:05:30.000Z',
      },
      {
        name: 'metadata',
        pgType: 'jsonb',
        nullable: true,
        default: null,
        constraints: ['Non-sensitive telemetry JSON'],
        businessRule: 'Optional non-sensitive operational telemetry (timing, worker host, chunk counts). No raw PII.',
        example: { workerId: 'worker-01', chunksProcessed: 2 },
      },
      {
        name: 'created_at',
        pgType: 'timestamptz',
        nullable: false,
        default: 'now()',
        constraints: ['UTC Timestamp'],
        businessRule: 'Timestamp when this projection row was committed to PostgreSQL.',
        example: '2026-10-23T08:00:00.000Z',
      },
      {
        name: 'updated_at',
        pgType: 'timestamptz',
        nullable: false,
        default: 'now()',
        constraints: ['UTC Timestamp'],
        businessRule: 'Timestamp when this projection row was last modified.',
        example: '2026-10-23T08:05:30.000Z',
      },
    ],
    indexes: ['idx_crm5_runs_batch_id', 'idx_crm5_runs_module'],
    checkConstraints: [
      'chk_crm5_runs_records_in',
      'chk_crm5_runs_records_out',
      'chk_crm5_runs_records_rejected',
      'chk_crm5_runs_status',
    ],
  },
  {
    tableName: 'crm5_scores',
    entityName: 'Data Quality Score Card',
    owner: 'CRM-5 Migration Control Center (Group 5)',
    description: 'Stores normalized 5-dimension data quality score cards and weighted composite scores for migration batches.',
    columns: [
      {
        name: 'id',
        pgType: 'uuid',
        nullable: false,
        default: 'gen_random_uuid()',
        constraints: ['Primary Key'],
        businessRule: 'Immutable surrogate UUID primary key for the quality scorecard.',
        example: '550e8400-e29b-41d4-a716-446655440002',
      },
      {
        name: 'batch_id',
        pgType: 'varchar(128)',
        nullable: false,
        default: null,
        constraints: ['Indexed', 'Non-empty'],
        businessRule: 'Batch correlation identifier associated with the scored migration run.',
        example: 'batch-2026-10-crm1-001',
      },
      {
        name: 'module',
        pgType: 'varchar(64)',
        nullable: false,
        default: null,
        constraints: ['Indexed', 'Module Allowlist'],
        businessRule: 'Target module scored by the quality profiler.',
        example: 'crm-1',
      },
      {
        name: 'completeness',
        pgType: 'numeric(5,4)',
        nullable: true,
        default: null,
        constraints: ['chk_crm5_scores_completeness (0.0000..1.0000)'],
        businessRule: 'Normalized fraction of mandatory non-null required attributes.',
        example: '0.9850',
      },
      {
        name: 'validity',
        pgType: 'numeric(5,4)',
        nullable: true,
        default: null,
        constraints: ['chk_crm5_scores_validity (0.0000..1.0000)'],
        businessRule: 'Normalized fraction of records conforming to format, regex, and range rules.',
        example: '0.9720',
      },
      {
        name: 'duplicate_rate',
        pgType: 'numeric(5,4)',
        nullable: true,
        default: null,
        constraints: ['chk_crm5_scores_duplicate_rate (0.0000..1.0000)'],
        businessRule: 'Fraction of detected duplicate candidate records relative to total records.',
        example: '0.0400',
      },
      {
        name: 'reject_rate',
        pgType: 'numeric(5,4)',
        nullable: true,
        default: null,
        constraints: ['chk_crm5_scores_reject_rate (0.0000..1.0000)'],
        businessRule: 'Fraction of rejected records relative to total attempted records.',
        example: '0.0500',
      },
      {
        name: 'link_integrity',
        pgType: 'numeric(5,4)',
        nullable: true,
        default: null,
        constraints: ['chk_crm5_scores_link_integrity (0.0000..1.0000)'],
        businessRule: 'Fraction of foreign key and master entity references verified valid.',
        example: '0.9900',
      },
      {
        name: 'score',
        pgType: 'numeric(5,2)',
        nullable: true,
        default: null,
        constraints: ['chk_crm5_scores_score (0.00..100.00)'],
        businessRule: 'Calculated 100-point composite score: 100 * (completeness + validity + (1 - duplicate_rate) + (1 - reject_rate) + link_integrity) / 5.',
        example: '97.14',
      },
      {
        name: 'is_fully_scored',
        pgType: 'boolean',
        nullable: false,
        default: 'false',
        constraints: ['Boolean flag'],
        businessRule: 'True if and only if all 5 quality dimensions are present and composite score is calculated.',
        example: true,
      },
      {
        name: 'scored_at',
        pgType: 'timestamptz',
        nullable: false,
        default: 'now()',
        constraints: ['UTC Timestamp'],
        businessRule: 'Timestamp when the quality score was calculated.',
        example: '2026-10-23T08:05:30.000Z',
      },
      {
        name: 'created_at',
        pgType: 'timestamptz',
        nullable: false,
        default: 'now()',
        constraints: ['UTC Timestamp'],
        businessRule: 'Timestamp when the quality scorecard was saved.',
        example: '2026-10-23T08:05:30.000Z',
      },
    ],
    indexes: ['idx_crm5_scores_batch_id', 'idx_crm5_scores_module'],
    checkConstraints: [
      'chk_crm5_scores_completeness',
      'chk_crm5_scores_validity',
      'chk_crm5_scores_duplicate_rate',
      'chk_crm5_scores_reject_rate',
      'chk_crm5_scores_link_integrity',
      'chk_crm5_scores_score',
    ],
  },
  {
    tableName: 'crm5_rejects',
    entityName: 'Migration Rejection Record',
    owner: 'CRM-5 Migration Control Center (Group 5)',
    description: 'Audits failed rows with sanitized error reasons and cryptographic SHA-256 payload hash without storing raw PII.',
    columns: [
      {
        name: 'id',
        pgType: 'uuid',
        nullable: false,
        default: 'gen_random_uuid()',
        constraints: ['Primary Key'],
        businessRule: 'Surrogate UUID primary key for the rejection record.',
        example: '550e8400-e29b-41d4-a716-446655440003',
      },
      {
        name: 'batch_id',
        pgType: 'varchar(128)',
        nullable: false,
        default: null,
        constraints: ['Indexed', 'Non-empty'],
        businessRule: 'Correlation identifier matching the source execution batch.',
        example: 'batch-2026-10-crm1-001',
      },
      {
        name: 'module',
        pgType: 'varchar(64)',
        nullable: false,
        default: null,
        constraints: ['Indexed', 'Module Allowlist'],
        businessRule: 'Target module where the rejection occurred.',
        example: 'crm-1',
      },
      {
        name: 'row_index',
        pgType: 'integer',
        nullable: false,
        default: null,
        constraints: ['chk_crm5_rejects_row_index (>= 1)'],
        businessRule: '1-indexed source row number in the parsed input file for exact operator traceability.',
        example: 42,
      },
      {
        name: 'error_code',
        pgType: 'varchar(64)',
        nullable: false,
        default: null,
        constraints: ['Machine-readable string'],
        businessRule: 'Standardized machine error code (e.g. INVALID_EMAIL, EMPTY_MANDATORY_FIELD, NEGATIVE_VALUE).',
        example: 'INVALID_EMAIL',
      },
      {
        name: 'error_message',
        pgType: 'text',
        nullable: false,
        default: null,
        constraints: ['Sanitized text'],
        businessRule: 'Human-readable explanation of why the row was rejected, sanitized to avoid leaking sensitive data.',
        example: 'Email address elena@ violates RFC-5322 syntax requirements',
      },
      {
        name: 'raw_payload_hash',
        pgType: 'varchar(64)',
        nullable: false,
        default: null,
        constraints: ['SHA-256 (64 hex characters)'],
        businessRule: 'Cryptographic SHA-256 hash of the canonical serialized input row payload for tamper-evident verification.',
        example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
      {
        name: 'created_at',
        pgType: 'timestamptz',
        nullable: false,
        default: 'now()',
        constraints: ['UTC Timestamp'],
        businessRule: 'Timestamp when the rejection record was recorded.',
        example: '2026-10-23T08:02:15.000Z',
      },
    ],
    indexes: ['idx_crm5_rejects_batch_id', 'idx_crm5_rejects_module'],
    checkConstraints: ['chk_crm5_rejects_row_index'],
  },
  {
    tableName: 'crm5_reconciliation_reports',
    entityName: 'Reconciliation Conservation Balance Sheet',
    owner: 'CRM-5 Migration Control Center (Group 5)',
    description: 'Audits the mathematical conservation of source rows across the migration lifecycle: source = loaded + rejected + merged + skipped.',
    columns: [
      {
        name: 'id',
        pgType: 'uuid',
        nullable: false,
        default: 'gen_random_uuid()',
        constraints: ['Primary Key'],
        businessRule: 'Surrogate UUID primary key for the reconciliation report.',
        example: '550e8400-e29b-41d4-a716-446655440004',
      },
      {
        name: 'batch_id',
        pgType: 'varchar(128)',
        nullable: false,
        default: null,
        constraints: ['Unique Index', 'Non-empty'],
        businessRule: 'Unique correlation identifier for the batch. Exactly one reconciliation balance sheet per batch.',
        example: 'batch-2026-10-crm1-001',
      },
      {
        name: 'module',
        pgType: 'varchar(64)',
        nullable: false,
        default: null,
        constraints: ['Indexed', 'Module Allowlist'],
        businessRule: 'Target module reconciled by this balance sheet.',
        example: 'crm-1',
      },
      {
        name: 'source_count',
        pgType: 'integer',
        nullable: false,
        default: '0',
        constraints: ['chk_crm5_recon_source_count (>= 0)'],
        businessRule: 'Total number of records parsed from the original source dataset.',
        example: 1000,
      },
      {
        name: 'loaded_count',
        pgType: 'integer',
        nullable: false,
        default: '0',
        constraints: ['chk_crm5_recon_loaded_count (>= 0)'],
        businessRule: 'Count of records successfully committed to target PostgreSQL business tables with durable receipts.',
        example: 780,
      },
      {
        name: 'rejected_count',
        pgType: 'integer',
        nullable: false,
        default: '0',
        constraints: ['chk_crm5_recon_rejected_count (>= 0)'],
        businessRule: 'Count of records rejected during pipeline validation and logged in rejects table.',
        example: 140,
      },
      {
        name: 'merged_count',
        pgType: 'integer',
        nullable: false,
        default: '0',
        constraints: ['chk_crm5_recon_merged_count (>= 0)'],
        businessRule: 'Count of exact duplicate candidate records merged into surviving canonical records via authorized human review.',
        example: 80,
      },
      {
        name: 'skipped_count',
        pgType: 'integer',
        nullable: false,
        default: '0',
        constraints: ['chk_crm5_recon_skipped_count (>= 0)'],
        businessRule: 'Count of records bypassed with an approved business skip reason (strictly 0 in V1 baseline).',
        example: 0,
      },
      {
        name: 'unaccounted_count',
        pgType: 'integer',
        nullable: false,
        default: '0',
        constraints: ['chk_crm5_recon_unaccounted_count (>= 0)'],
        businessRule: 'Discrepancy count: source - (loaded + rejected + merged + skipped). Must strictly equal 0 for OK status.',
        example: 0,
      },
      {
        name: 'status',
        pgType: 'varchar(16)',
        nullable: false,
        default: null,
        constraints: ["chk_crm5_recon_status ('OK' | 'UNBALANCED')"],
        businessRule: 'Conservation status. OK if unaccounted == 0; UNBALANCED if unaccounted > 0.',
        example: 'OK',
      },
      {
        name: 'reconciled_at',
        pgType: 'timestamptz',
        nullable: false,
        default: 'now()',
        constraints: ['UTC Timestamp'],
        businessRule: 'Timestamp when the reconciliation calculation was performed.',
        example: '2026-10-23T08:06:00.000Z',
      },
      {
        name: 'created_at',
        pgType: 'timestamptz',
        nullable: false,
        default: 'now()',
        constraints: ['UTC Timestamp'],
        businessRule: 'Timestamp when the reconciliation balance sheet was recorded.',
        example: '2026-10-23T08:06:00.000Z',
      },
    ],
    indexes: ['idx_crm5_recon_batch_unique', 'idx_crm5_recon_module'],
    checkConstraints: [
      'chk_crm5_recon_source_count',
      'chk_crm5_recon_loaded_count',
      'chk_crm5_recon_rejected_count',
      'chk_crm5_recon_merged_count',
      'chk_crm5_recon_skipped_count',
      'chk_crm5_recon_unaccounted_count',
      'chk_crm5_recon_status',
    ],
  },
  {
    tableName: 'crm5_import_receipts',
    entityName: 'Migration Import Receipt',
    owner: 'CRM-5 Migration Control Center (Group 5)',
    description: 'Stores durable import receipts committed alongside target business records in the same atomic local database transaction (KIT-08 & Decision C4).',
    columns: [
      {
        name: 'id',
        pgType: 'uuid',
        nullable: false,
        default: 'gen_random_uuid()',
        constraints: ['Primary Key'],
        businessRule: 'Surrogate UUID primary key for the durable receipt.',
        example: '550e8400-e29b-41d4-a716-446655440005',
      },
      {
        name: 'batch_id',
        pgType: 'varchar(128)',
        nullable: false,
        default: null,
        constraints: ['Indexed', 'Non-empty'],
        businessRule: 'Batch correlation identifier linking receipt to the execution batch.',
        example: 'batch-2026-10-crm1-001',
      },
      {
        name: 'source_row',
        pgType: 'integer',
        nullable: false,
        default: null,
        constraints: ['chk_crm5_receipts_source_row (>= 1)'],
        businessRule: '1-indexed source row number in the parsed migration file.',
        example: 1,
      },
      {
        name: 'source_system',
        pgType: 'varchar(64)',
        nullable: true,
        default: null,
        constraints: ['Optional system identifier'],
        businessRule: 'Originating legacy source system name (e.g. salesforce_legacy, zendesk_legacy).',
        example: 'salesforce_legacy',
      },
      {
        name: 'source_id',
        pgType: 'varchar(128)',
        nullable: true,
        default: null,
        constraints: ['Optional external ID'],
        businessRule: 'Originating external system primary key.',
        example: 'SF-RUN-001',
      },
      {
        name: 'entity',
        pgType: 'varchar(64)',
        nullable: false,
        default: null,
        constraints: ['Target Entity Type'],
        businessRule: 'Target domain entity type mutated by the migration write (e.g. runs, scores, rejects, reconciliation).',
        example: 'runs',
      },
      {
        name: 'schema_version',
        pgType: 'integer',
        nullable: false,
        default: '1',
        constraints: ['Schema Version'],
        businessRule: 'Version of the target entity schema at time of ingestion.',
        example: 1,
      },
      {
        name: 'idempotency_key',
        pgType: 'varchar(256)',
        nullable: false,
        default: null,
        constraints: ['idx_crm5_receipts_idempotency_key (Unique Index)'],
        businessRule: 'Stable idempotency key (batch ID + source row + target entity/schema version). Reused across retries.',
        example: 'batch-2026-10-crm1-001:1:runs:v1',
      },
      {
        name: 'payload_hash',
        pgType: 'varchar(64)',
        nullable: false,
        default: null,
        constraints: ['SHA-256 (64 hex characters)'],
        businessRule: 'Deterministic SHA-256 canonical hash of incoming row payload to detect replay conflicts.',
        example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
      {
        name: 'target_id',
        pgType: 'uuid',
        nullable: false,
        default: null,
        constraints: ['Indexed', 'Polymorphic Foreign Key'],
        businessRule: 'UUID primary key of the committed business record in CRM-5 tables.',
        example: '550e8400-e29b-41d4-a716-446655440001',
      },
      {
        name: 'kind',
        pgType: 'varchar(32)',
        nullable: false,
        default: "'created'",
        constraints: ['Mutation kind'],
        businessRule: 'Mutation classification: created or updated.',
        example: 'created',
      },
      {
        name: 'outcome',
        pgType: 'varchar(32)',
        nullable: false,
        default: "'created'",
        constraints: ['Outcome allowlist'],
        businessRule: 'Terminal row outcome: created, updated, rejected, or skipped.',
        example: 'created',
      },
      {
        name: 'response_payload',
        pgType: 'jsonb',
        nullable: true,
        default: null,
        constraints: ['Cached response JSON'],
        businessRule: 'Serialized execution result payload returned during identical idempotent replays.',
        example: { id: '550e8400-e29b-41d4-a716-446655440001', status: 'created' },
      },
      {
        name: 'created_at',
        pgType: 'timestamptz',
        nullable: false,
        default: 'now()',
        constraints: ['UTC Timestamp'],
        businessRule: 'Timestamp when the receipt and target record committed in the transaction.',
        example: '2026-10-23T08:00:00.000Z',
      },
    ],
    indexes: [
      'idx_crm5_receipts_idempotency_key',
      'idx_crm5_receipts_batch_row',
      'idx_crm5_receipts_target_id',
    ],
    checkConstraints: ['chk_crm5_receipts_source_row'],
  },
];

// =============================================================================
// 2. ERD RELATIONSHIPS & MASTER-DATA OWNERSHIP
// =============================================================================

export const CRM5_ERD_RELATIONSHIPS: RelationshipDefinition[] = [
  {
    relationshipId: 'REL-CRM5-01',
    fromTable: 'crm5_runs',
    fromColumn: 'batch_id',
    toTable: 'crm5_scores',
    toColumn: 'batch_id',
    cardinality: '1:1',
    enforcement: 'Logical Event Correlation',
    description: 'Migration execution step runs correlate to quality score cards by batch_id.',
  },
  {
    relationshipId: 'REL-CRM5-02',
    fromTable: 'crm5_runs',
    fromColumn: 'batch_id',
    toTable: 'crm5_rejects',
    toColumn: 'batch_id',
    cardinality: '1:N',
    enforcement: 'Logical Event Correlation',
    description: 'Migration run step projects row-level rejections correlating by batch_id.',
  },
  {
    relationshipId: 'REL-CRM5-03',
    fromTable: 'crm5_runs',
    fromColumn: 'batch_id',
    toTable: 'crm5_reconciliation_reports',
    toColumn: 'batch_id',
    cardinality: '1:1',
    enforcement: 'Logical Event Correlation',
    description: 'Each migration batch produces exactly one final reconciliation balance sheet.',
  },
  {
    relationshipId: 'REL-CRM5-04',
    fromTable: 'crm5_import_receipts',
    fromColumn: 'target_id',
    toTable: 'crm5_runs',
    toColumn: 'id',
    cardinality: 'N:1',
    enforcement: 'Logical Event Correlation',
    description: 'Durable import receipts point polymorphically to mutated run projections via target_id.',
  },
  {
    relationshipId: 'REL-CRM5-05',
    fromTable: 'crm5_import_receipts',
    fromColumn: 'target_id',
    toTable: 'crm5_scores',
    toColumn: 'id',
    cardinality: 'N:1',
    enforcement: 'Logical Event Correlation',
    description: 'Durable import receipts point polymorphically to mutated score cards via target_id.',
  },
  {
    relationshipId: 'REL-CRM5-06',
    fromTable: 'crm5_runs',
    fromColumn: 'module',
    toTable: 'clearshift_modules',
    toColumn: 'code',
    cardinality: 'N:1',
    enforcement: 'Domain Application Guard',
    description: 'Module scope restricted to approved ClearShift modules (crm-1, crm-2, crm-3, crm-4, crm-5) via domain allowlist.',
  },
];

// =============================================================================
// 3. REQUIREMENT-TO-TEST TRACEABILITY MATRIX
// =============================================================================

export const CRM5_TRACEABILITY_MATRIX: TraceabilityEntry[] = [
  {
    reqId: 'FR-CRM5-01',
    requirement: 'Migration Control Center dashboard with total, running, failed runs and average quality score.',
    priority: 'Must',
    sourceDoc: 'SDS ClearShift CRM v2.0 §4.2',
    category: 'API',
    testType: 'contract',
    testFile: 'apps/crm/modules/crm-5/tests/api/list.test.ts',
    testSuite: 'CRM-5 List / Read Routes (Issue #190)',
    verificationEvidence: 'GET /api/v1/crm-control/runs and /scores return verified summary counters',
  },
  {
    reqId: 'FR-CRM5-02',
    requirement: 'Migration run projection collection: module, batch, step, status, record counters, timestamps, bounded paging.',
    priority: 'Must',
    sourceDoc: 'SDS ClearShift CRM v2.0 §4.2',
    category: 'API',
    testType: 'contract',
    testFile: 'apps/crm/modules/crm-5/tests/api/list.test.ts',
    testSuite: 'CRM-5 List / Read Routes (Issue #190)',
    verificationEvidence: 'Server-paged runs list respects pageSize <= 100 and deterministic sort',
  },
  {
    reqId: 'FR-CRM5-03',
    requirement: '5-dimension data quality score cards (completeness, validity, duplicate rate, reject rate, link integrity).',
    priority: 'Must',
    sourceDoc: 'SDS ClearShift CRM v2.0 §4.2',
    category: 'Database',
    testType: 'schema',
    testFile: 'apps/crm/modules/crm-5/tests/db/schema.test.ts',
    testSuite: 'CRM-5 Schema & Architectural Invariants (Issue #46)',
    verificationEvidence: 'Check constraints enforce numeric range [0..1] and composite score [0..100]',
  },
  {
    reqId: 'FR-CRM5-04',
    requirement: 'Row-level rejection audit with 1-indexed source row, error code, sanitized message, and SHA-256 payload hash.',
    priority: 'Must',
    sourceDoc: 'SDS ClearShift CRM v2.0 §4.2',
    category: 'API',
    testType: 'contract',
    testFile: 'apps/crm/modules/crm-5/tests/api/list.test.ts',
    testSuite: 'CRM-5 List / Read Routes (Issue #190)',
    verificationEvidence: 'Rejects endpoint returns paginated failures with privacy-safe payload hashes',
  },
  {
    reqId: 'FR-CRM5-05',
    requirement: 'Reconciliation conservation balance sheet: source = loaded + rejected + merged + skipped (status OK iff unaccounted = 0).',
    priority: 'Must',
    sourceDoc: 'ClearShift Core Rules & SDS §4.2',
    category: 'Database',
    testType: 'schema',
    testFile: 'apps/crm/modules/crm-5/tests/db/schema.test.ts',
    testSuite: 'CRM-5 Schema & Architectural Invariants (Issue #46)',
    verificationEvidence: 'Reconciliation table verifies exact conservation invariant and non-negative counts',
  },
  {
    reqId: 'FR-CRM5-06',
    requirement: 'Deterministic exact duplicate candidate detection without fuzzy heuristics; candidate holding workflow.',
    priority: 'Must',
    sourceDoc: 'ClearShift Core Rules & SDS §4.11',
    category: 'Domain',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-5/tests/domain/duplicate-policy.test.ts',
    testSuite: 'CRM-5 Exact Duplicate Normalization & Holding Policy (Issue #191)',
    verificationEvidence: 'Exact key normalizers handle email, tax_id, phone, sku, composite; fuzzy merge throws 422',
  },
  {
    reqId: 'FR-CRM5-07',
    requirement: 'Target Adapter port (KIT-08) & durable import receipts committed atomically in single database transaction.',
    priority: 'Must',
    sourceDoc: 'KIT-08 & Decision C4',
    category: 'Migration',
    testType: 'integration',
    testFile: 'apps/crm/modules/crm-5/tests/migration/idempotency.test.ts',
    testSuite: 'CRM-5 Target Adapter & Idempotent Ingestion Suite (Issue #52)',
    verificationEvidence: 'Target write and durable receipt commit together; rollback on error preserves zero dirty state',
  },
  {
    reqId: 'FR-CRM5-08',
    requirement: 'Strict idempotency deduplication by stable idempotency key with SHA-256 payload conflict detection.',
    priority: 'Must',
    sourceDoc: 'KIT-08 & Decision C4',
    category: 'Migration',
    testType: 'integration',
    testFile: 'apps/crm/modules/crm-5/tests/migration/idempotency.test.ts',
    testSuite: 'CRM-5 Target Adapter & Idempotent Ingestion Suite (Issue #52)',
    verificationEvidence: 'Identical replay returns cached receipt (HTTP 200); altered payload returns conflict (HTTP 409)',
  },
  {
    reqId: 'FR-CRM5-09',
    requirement: 'Chunked 500-row batch loading with bounded exponential backoff retries.',
    priority: 'Must',
    sourceDoc: 'ClearShift Core Rules & SDS §4.2',
    category: 'API',
    testType: 'contract',
    testFile: 'apps/crm/modules/crm-5/tests/api/batch-loader.test.ts',
    testSuite: 'CRM-5 Batch Loader API (Issue #192)',
    verificationEvidence: 'POST /batches/execute-load processes 500-row chunks with retries',
  },
  {
    reqId: 'FR-CRM5-10',
    requirement: '10% partial-load stop condition: abort migration when failure rate > 10% after 50 attempts, preserving receipts.',
    priority: 'Must',
    sourceDoc: 'ClearShift Core Rules',
    category: 'Domain',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-5/tests/domain/batch-loader.test.ts',
    testSuite: 'CRM-5 Domain Batch Loader Logic (Issue #192)',
    verificationEvidence: 'Batch loader transitions to STOPPED_EXCESSIVE_FAILURES and halts execution cleanly',
  },
  {
    reqId: 'FR-CRM5-11',
    requirement: 'Deterministic mock server and fixture package for cross-module testing and consumer contracts.',
    priority: 'Must',
    sourceDoc: 'Master Architecture Baseline §4.2',
    category: 'API',
    testType: 'contract',
    testFile: 'packages/contracts/tests/crm-5-mock.test.ts',
    testSuite: 'CRM-5 Mock Server Plugin (Issue #187)',
    verificationEvidence: 'crm5MockServerPlugin routes serve deterministic synthetic runs, scores, rejects',
  },
  {
    reqId: 'FR-CRM5-12',
    requirement: 'Human duplicate review resolution workflow: explicit operator decisions (MERGE, REJECT, KEEP_SEPARATE) with audit trail.',
    priority: 'Must',
    sourceDoc: 'ClearShift Core Rules & SDS §4.11',
    category: 'API',
    testType: 'contract',
    testFile: 'apps/crm/modules/crm-5/tests/api/duplicates.test.ts',
    testSuite: 'CRM-5 Exact Duplicate API Routes (Issue #191)',
    verificationEvidence: 'POST /duplicates/resolve records decision, updates candidates, and appends audit log',
  },
  {
    reqId: 'FR-CRM5-13',
    requirement: 'Transactional outbox event envelopes and domain event taxonomy for CRM-5 aggregate events.',
    priority: 'Must',
    sourceDoc: 'PLT-04 & PLT-09',
    category: 'Domain',
    testType: 'unit',
    testFile: 'packages/contracts/tests/crm-5-events.test.ts',
    testSuite: 'CRM-5 Domain Events & Envelopes (Issue #187)',
    verificationEvidence: 'Outbox schemas validate run_projected, score_computed, reject_recorded, reconciliation_completed',
  },
  {
    reqId: 'FR-CRM5-14',
    requirement: 'OpenAPI 3.1 specification for /api/v1/crm-control with standard error envelope { code, message, details }.',
    priority: 'Must',
    sourceDoc: 'SDS ClearShift CRM v2.0 §7.1',
    category: 'API',
    testType: 'contract',
    testFile: 'apps/crm/modules/crm-5/tests/contracts/openapi.test.ts',
    testSuite: 'CRM-5 OpenAPI Contract Verification (Issue #187)',
    verificationEvidence: 'OpenAPI validator confirms route schemas, parameters, and error responses',
  },
  {
    reqId: 'FR-CRM5-15',
    requirement: 'Asymmetric EdDSA JWT authentication and RBAC capability enforcement (viewer, analyst, admin, migration_runner).',
    priority: 'Must',
    sourceDoc: 'SDS ClearShift CRM v2.0 §4.8, PLT-05, PLT-06',
    category: 'Security',
    testType: 'security',
    testFile: 'apps/crm/modules/crm-5/tests/security/authorization.test.ts',
    testSuite: 'CRM-5 Authorization & Multi-Tenant Boundary Controls (Issue #188)',
    verificationEvidence: '69 tests verify 401 unauthenticated, 403 forbidden roles, tenant isolation, and record ownership',
  },
  {
    reqId: 'FR-CRM5-16',
    requirement: 'Web module route shell, 5 sub-views registration, ARIA landmarks, and keyboard skip link navigation.',
    priority: 'Must',
    sourceDoc: 'Master Architecture Baseline §4.2',
    category: 'Web',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-5/tests/web/routes.test.ts',
    testSuite: 'CRM-5 Frontend Route Registration (Issue #193)',
    verificationEvidence: '14 tests assert route registration, title sync, route guards, and ARIA landmarks',
  },
  {
    reqId: 'FR-CRM5-17',
    requirement: 'Primary paginated data table with server-side sorting, deterministic toggle cycle, and bounded paging <= 100.',
    priority: 'Must',
    sourceDoc: 'Master Architecture Baseline §4.2',
    category: 'Web',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-5/tests/web/data-table.test.ts',
    testSuite: 'CRM-5 Main Paginated Data Table (Issue #194)',
    verificationEvidence: '16 tests assert sorting toggle asc/desc, page size ceiling, and pagination reset on sort',
  },
  {
    reqId: 'FR-CRM5-18',
    requirement: 'Search input with 300ms keystroke debouncing, faceted filter sidebar, and active filter pill tags with clear-all.',
    priority: 'Must',
    sourceDoc: 'Master Architecture Baseline §4.2',
    category: 'Web',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-5/tests/web/search-filters.test.ts',
    testSuite: 'CRM-5 Search & Faceted Filter Controls (Issue #195)',
    verificationEvidence: '16 tests assert 300ms debounce, enter flush, pill removal, clear-all action, and URL sync',
  },
  {
    reqId: 'FR-CRM5-19',
    requirement: 'UI shimmer skeleton loader, actionable empty states, sanitized error alerts, and 403 access-denied views.',
    priority: 'Must',
    sourceDoc: 'Master Architecture Baseline §4.2',
    category: 'Web',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-5/tests/web/ui-states.test.ts',
    testSuite: 'CRM-5 UI Loading, Empty, Error, and 403 States (Issue #189)',
    verificationEvidence: '28 tests verify shimmer accessibility, stack trace sanitization, and 403 view',
  },
  {
    reqId: 'FR-CRM5-20',
    requirement: 'Entity create form with modal dialog, Zod field-level validation, double-submit lock, and server error mapping.',
    priority: 'Must',
    sourceDoc: 'Master Architecture Baseline §4.2',
    category: 'Web',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-5/tests/web/create-form.test.ts',
    testSuite: 'CRM-5 Create Run Form & Modal (Issue #189)',
    verificationEvidence: '38 tests assert field validation, count invariants, modal workflow, and error envelopes',
  },
  {
    reqId: 'FR-CRM5-21',
    requirement: 'Shared UI component library integration: Table, Input, Select, Button, Alert, Badge, Pagination.',
    priority: 'Must',
    sourceDoc: 'Master Architecture Baseline §4.2',
    category: 'Web',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-5/tests/web/components.test.tsx',
    testSuite: 'CRM-5 UI Component Integration (Issue #189)',
    verificationEvidence: '13 tests verify shared UI primitive integration and accessibility attributes',
  },
  {
    reqId: 'FR-CRM5-22',
    requirement: 'CSV report export with formula-safe prefix escaping (=, +, -, @) to prevent CWE-1236 injection.',
    priority: 'Must',
    sourceDoc: 'ClearShift Core Rules & PLT-12',
    category: 'Web',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-5/tests/web/reject-review.test.ts',
    testSuite: 'CRM-5 Rejection Audit Review & Export (Issue #196)',
    verificationEvidence: 'Tests assert formula triggers are prepended with single quote in exported CSVs',
  },
  {
    reqId: 'FR-CRM5-23',
    requirement: 'Rejection review screen displaying natural cross-module entity context identifiers for CRM-1..5.',
    priority: 'Must',
    sourceDoc: 'SDS ClearShift CRM v2.0 §4.2',
    category: 'Web',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-5/tests/web/reject-review.test.ts',
    testSuite: 'CRM-5 Rejection Audit Review & Export (Issue #196)',
    verificationEvidence: '22 tests assert module-specific natural identifier extraction (contact_id, deal_id, ticket_id)',
  },
  {
    reqId: 'FR-CRM5-24',
    requirement: 'Data dictionary, ERD, traceability matrix, and Dirty Data Pack plan design specifications for Gate G1.',
    priority: 'Must',
    sourceDoc: 'ClearShift Project Plan v3.0 §17, Issue #197',
    category: 'Domain',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-5/tests/domain/qa-g1-design.test.ts',
    testSuite: 'CRM-5 QA Gate G1 Design Specifications (Issue #197 / [CRM5-24])',
    verificationEvidence: 'Automated test suite asserts schema alignment, traceability coverage, and conservation invariants',
  },
  {
    reqId: 'FR-CRM5-25',
    requirement: 'Canonical module Dirty Data Pack with 100 synthetic rows and 11 disjoint defect categories in manifest.json.',
    priority: 'Must',
    sourceDoc: 'CLEARSHIFT_V1_MASTER_ARCHITECTURE_SPEC.md §Slot 25',
    category: 'Migration',
    testType: 'regression',
    testFile: 'apps/crm/modules/crm-5/tests/fixtures/dirty-pack.test.ts',
    testSuite: 'CRM-5 Canonical Dirty Data Pack (#198, [CRM5-25])',
    verificationEvidence: '26 tests verify 100 data rows, canonical headers, disjoint categories, and zero PII',
  },
  {
    reqId: 'FR-CRM5-26',
    requirement: 'Module profiling configuration: 7-step profiling without mutating input data, column statistics and quality scorecards.',
    priority: 'Must',
    sourceDoc: 'ClearShift Project Plan v3.0 §17',
    category: 'Migration',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-5/tests/kit/profiler.test.ts',
    testSuite: 'CRM-5 Profiling Configuration & Manifest Assertions (#199, [CRM5-26])',
    verificationEvidence: '11 tests assert column stats, distinct counts, null rates, and defect category counts',
  },
  {
    reqId: 'FR-CRM5-27',
    requirement: 'Migration mapping configuration and type coercion with dry-run guards.',
    priority: 'Must',
    sourceDoc: 'ClearShift Project Plan v3.0 §17, KIT-03',
    category: 'Migration',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-5/tests/kit/mapping.test.ts',
    testSuite: 'CRM-5 Mapping Configuration Suite (#200, [CRM5-27])',
    verificationEvidence: '10 tests verify mapping template, field transformations, and dry-run safety',
  },
  {
    reqId: 'FR-CRM5-28',
    requirement: 'Standard field-level cleaning, defect quarantine, and row rejection audit.',
    priority: 'Must',
    sourceDoc: 'ClearShift Project Plan v3.0 §17, KIT-04',
    category: 'Migration',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-5/tests/kit/cleaner.test.ts',
    testSuite: 'CRM-5 Cleaner & Ingestion Rules Suite (#201, [CRM5-28])',
    verificationEvidence: '12 tests assert date normalization, enum standardizers, and defect tagging',
  },
  {
    reqId: 'FR-CRM5-29',
    requirement: 'Comprehensive Gate G4 regression suite across all 25+ domain, contract, migration, and web specifications.',
    priority: 'Must',
    sourceDoc: 'ClearShift Project Plan v3.0 §17, Issue #202',
    category: 'Domain',
    testType: 'regression',
    testFile: 'apps/crm/modules/crm-5/tests/domain/qa-g4-regression.test.ts',
    testSuite: 'CRM-5 QA Gate G4 Regression Suite (#202, [CRM5-29])',
    verificationEvidence: '20 tests assert comprehensive cross-layer invariants, role authorization, and zero-defect quality',
  },
  {
    reqId: 'FR-CRM5-30',
    requirement: 'Module reconciliation proof, single terminal outcome enforcement, link integrity audit, and Gate G4 evidence pack.',
    priority: 'Must',
    sourceDoc: 'ClearShift Project Plan v3.0 §17, Issue #203',
    category: 'Migration',
    testType: 'integration',
    testFile: 'apps/crm/modules/crm-5/tests/domain/reconciliation-acceptance.test.ts',
    testSuite: 'CRM-5 Migration Reconciliation Proof & Gate G4 Evidence Suite (#203, [CRM5-30])',
    verificationEvidence: '13 tests verify exact conservation equation, link integrity across runs/scores/rejects, and 100% durable receipt completeness',
  },
];

// =============================================================================
// 4. SYNTHETIC DIRTY DATA PACK PLAN
// =============================================================================

export const CRM5_DIRTY_DATA_PACK_PLAN: DirtyDataPackPlan = {
  module: 'crm-5',
  targetEntities: ['crm5_runs', 'crm5_scores', 'crm5_rejects', 'crm5_reconciliation_reports', 'crm5_import_receipts'],
  canonical1000Plan: {
    totalSourceRows: 1000,
    expectedLoaded: 780,
    expectedRejected: 140,
    expectedMerged: 80,
    expectedSkipped: 0,
    unaccounted: 0,
  },
  module100Plan: {
    totalSourceRows: 100,
    expectedLoaded: 50,
    expectedRejected: 45,
    expectedMerged: 5,
    expectedSkipped: 0,
    unaccounted: 0,
  },
  scenarios: [
    {
      scenarioId: 'SCENARIO-01',
      category: 'clean_records',
      description: 'Clean synthetic migration run records conforming strictly to schemas, valid enums, non-negative counters, and valid ISO timestamps.',
      targetEntity: 'crm5_runs',
      expectedOutcome: 'valid',
      expectedCountIn100: 50,
      expectedCountIn1000: 780,
      sampleRecord: {
        id: '550e8400-e29b-41d4-a716-446655440001',
        batch_id: 'batch-2026-10-crm1-001',
        module: 'crm-1',
        step: 'load',
        status: 'completed',
        records_in: 1000,
        records_out: 780,
        records_rejected: 140,
        started_at: '2026-10-23T08:00:00.000Z',
        completed_at: '2026-10-23T08:05:30.000Z',
        metadata: { workerId: 'worker-01' },
      },
    },
    {
      scenarioId: 'SCENARIO-02',
      category: 'NULL_REQUIRED',
      description: 'Mandatory fields (batch_id, module, step) with missing, empty, or whitespace-only blank values.',
      targetEntity: 'crm5_runs',
      expectedOutcome: 'null_required',
      reasonCode: 'NULL_REQUIRED_FIELD',
      expectedCountIn100: 7,
      expectedCountIn1000: 25,
      sampleRecord: {
        id: '550e8400-e29b-41d4-a716-446655440051',
        batch_id: '',
        module: 'crm-1',
        step: 'load',
        status: 'completed',
      },
    },
    {
      scenarioId: 'SCENARIO-03',
      category: 'EXACT_DUPLICATE',
      description: 'Exact duplicate records replicating primary keys or natural candidate keys of existing rows; held for human review merge.',
      targetEntity: 'crm5_runs',
      expectedOutcome: 'exact_duplicate',
      reasonCode: 'EXACT_DUPLICATE_KEY',
      expectedCountIn100: 5,
      expectedCountIn1000: 80,
      sampleRecord: {
        id: '550e8400-e29b-41d4-a716-446655440001',
        batch_id: 'batch-2026-10-crm1-001',
        module: 'crm-1',
        step: 'load',
      },
    },
    {
      scenarioId: 'SCENARIO-04',
      category: 'FOREIGN_KEY_MISSING',
      description: 'Parent module or batch reference does not exist in registered system catalog.',
      targetEntity: 'crm5_runs',
      expectedOutcome: 'foreign_key_missing',
      reasonCode: 'REFERENCE_NOT_FOUND',
      expectedCountIn100: 5,
      expectedCountIn1000: 20,
      sampleRecord: {
        id: '550e8400-e29b-41d4-a716-446655440063',
        batch_id: 'batch-nonexistent-999',
        module: 'crm-99-unknown',
        step: 'extract',
      },
    },
    {
      scenarioId: 'SCENARIO-05',
      category: 'WHITESPACE_PADDING',
      description: 'Identifiers and enums padded with unstripped leading, trailing, or tab whitespace.',
      targetEntity: 'crm5_runs',
      expectedOutcome: 'whitespace_padding',
      reasonCode: 'WHITESPACE_IN_IDENTIFIER',
      expectedCountIn100: 5,
      expectedCountIn1000: 15,
      sampleRecord: {
        id: ' 550e8400-e29b-41d4-a716-446655440068 ',
        batch_id: '  batch-padded-01\t',
        module: ' crm-2 ',
        step: ' clean ',
      },
    },
    {
      scenarioId: 'SCENARIO-06',
      category: 'DATE_FORMAT_VARIANTS',
      description: 'Non-ISO date formats, localized dates, date-only strings, or unparseable timestamps.',
      targetEntity: 'crm5_runs',
      expectedOutcome: 'malformed',
      reasonCode: 'INVALID_TIMESTAMP_FORMAT',
      expectedCountIn100: 6,
      expectedCountIn1000: 20,
      sampleRecord: {
        id: '550e8400-e29b-41d4-a716-446655440073',
        started_at: '23/10/2026 14:00',
        completed_at: 'yesterday',
      },
    },
    {
      scenarioId: 'SCENARIO-07',
      category: 'BOUNDARY_NUMBERS',
      description: 'Negative record counts or integer capacity overflow numbers.',
      targetEntity: 'crm5_runs',
      expectedOutcome: 'out_of_bounds',
      reasonCode: 'RECORD_COUNT_OUT_OF_BOUNDS',
      expectedCountIn100: 5,
      expectedCountIn1000: 15,
      sampleRecord: {
        id: '550e8400-e29b-41d4-a716-446655440079',
        records_in: -10,
        records_out: 9999999999999,
      },
    },
    {
      scenarioId: 'SCENARIO-08',
      category: 'MALFORMED_UUID',
      description: 'Primary key id not conforming to RFC-4122 UUID v4 format.',
      targetEntity: 'crm5_runs',
      expectedOutcome: 'malformed',
      reasonCode: 'INVALID_UUID_SYNTAX',
      expectedCountIn100: 4,
      expectedCountIn1000: 15,
      sampleRecord: {
        id: 'not-a-valid-uuid-format',
      },
    },
    {
      scenarioId: 'SCENARIO-09',
      category: 'LOGICAL_COUNT_INVARIANT_VIOLATION',
      description: 'Row output and reject totals mathematically exceed input records (records_out + records_rejected > records_in).',
      targetEntity: 'crm5_runs',
      expectedOutcome: 'invariant_violation',
      reasonCode: 'COUNT_CONSERVATION_VIOLATION',
      expectedCountIn100: 4,
      expectedCountIn1000: 15,
      sampleRecord: {
        records_in: 100,
        records_out: 80,
        records_rejected: 30, // 80 + 30 = 110 > 100
      },
    },
    {
      scenarioId: 'SCENARIO-10',
      category: 'CHRONOLOGICAL_SEQUENCE_VIOLATION',
      description: 'completed_at precedes started_at in execution chronology.',
      targetEntity: 'crm5_runs',
      expectedOutcome: 'invariant_violation',
      reasonCode: 'CHRONOLOGY_VIOLATION',
      expectedCountIn100: 3,
      expectedCountIn1000: 10,
      sampleRecord: {
        started_at: '2026-10-23T10:00:00.000Z',
        completed_at: '2026-10-23T09:00:00.000Z',
      },
    },
    {
      scenarioId: 'SCENARIO-11',
      category: 'MALFORMED_JSON_METADATA',
      description: 'metadata column contains unparseable or malformed JSON strings.',
      targetEntity: 'crm5_runs',
      expectedOutcome: 'malformed',
      reasonCode: 'INVALID_JSON_SYNTAX',
      expectedCountIn100: 3,
      expectedCountIn1000: 10,
      sampleRecord: {
        metadata: '{ unquoted_key: true, corrupt ',
      },
    },
    {
      scenarioId: 'SCENARIO-12',
      category: 'FORMULA_INJECTION_RISK',
      description: 'Text fields start with spreadsheet formula trigger prefixes (=, @, +, -) posing injection risks.',
      targetEntity: 'crm5_runs',
      expectedOutcome: 'malformed',
      reasonCode: 'FORMULA_INJECTION_PREFIX',
      expectedCountIn100: 3,
      expectedCountIn1000: 10,
      sampleRecord: {
        batch_id: '=cmd|"/C calc"!A0',
        module: '+@HYPERLINK("http://evil.example.com")',
      },
    },
  ],
};

// =============================================================================
// 5. CONSERVATION EQUATION HELPER
// =============================================================================

/**
 * Validates the mathematical conservation balance sheet:
 * source = loaded + rejected + merged + skipped
 * and verifies unaccounted == 0.
 */
export function assertConservationEquation(
  source: number,
  loaded: number,
  rejected: number,
  merged: number,
  skipped: number
): { isBalanced: boolean; unaccounted: number; expectedStatus: 'OK' | 'UNBALANCED' } {
  const accounted = loaded + rejected + merged + skipped;
  const unaccounted = source - accounted;
  const isBalanced = unaccounted === 0;

  return {
    isBalanced,
    unaccounted,
    expectedStatus: isBalanced ? 'OK' : 'UNBALANCED',
  };
}
