/**
 * ClearShift CRM — CRM-1 Quality Assurance & Design Specifications
 *
 * Implements canonical QA & Data Lead specifications for CRM-1:
 * - Field-level Data Dictionary (all 6 tables: companies, contacts, leads, import_batches, receipts, rejects)
 * - Entity-Relationship Diagram (ERD) relationship metadata and cardinality
 * - Requirement-to-Test Traceability Matrix (mapping SDS §4.2 Must requirements to automated tests)
 * - Synthetic Dirty Data Pack Plan with defect distributions and conservation balance sheet
 *
 * Traceability:
 * - Issue: #117 [CRM1-24] CRM-1 Contacts, Companies and Leads: Data dictionary, ERD, traceability and Dirty Data Pack plan
 * - ClearShift Project Plan v3.0 §§9.3–9.6, 17
 * - SDS ClearShift CRM v2.0 §4.2, §4.7, §4.11, §4.12
 * - Master Architecture Blueprint Baseline 1.0-A §4.2
 */

export interface ColumnDefinition {
  name: string;
  pgType: string;
  nullable: boolean;
  default: string | null;
  constraints: string[];
  businessRule: string;
  example: string | number | boolean | null;
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
  cardinality: '1:1' | '1:N' | 'N:1';
  onDelete: 'RESTRICT' | 'CASCADE' | 'SET NULL';
  enforcement: 'Database Foreign Key' | 'Domain Application Guard' | 'API Projection';
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
  category:
    | 'golden_baseline'
    | 'exact_duplicate'
    | 'malformed_syntax'
    | 'missing_required'
    | 'referential_orphan'
    | 'lifecycle_violation'
    | 'consent_violation'
    | 'formula_injection'
    | 'encoding_boundary';
  description: string;
  targetEntity: 'company' | 'contact' | 'lead';
  expectedOutcome: 'loaded' | 'rejected' | 'merged' | 'skipped';
  reasonCode?: string;
  expectedCountIn100: number;
  expectedCountIn1000: number;
  sampleRecord: Record<string, unknown>;
}

export interface DirtyDataPackPlan {
  module: 'crm-1';
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
// 1. DATA DICTIONARY (6 Tables)
// =============================================================================

export const CRM1_DATA_DICTIONARY: TableDefinition[] = [
  {
    tableName: 'crm1_companies',
    entityName: 'Company',
    owner: 'CRM-1 (Group 1)',
    description: 'Flat company master records in V1. Parent hierarchies are deferred to V2.',
    columns: [
      {
        name: 'id',
        pgType: 'uuid',
        nullable: false,
        default: 'gen_random_uuid()',
        constraints: ['Primary Key'],
        businessRule: 'Immutable surrogate UUID primary key generated at creation.',
        example: '550e8400-e29b-41d4-a716-446655440000',
      },
      {
        name: 'name',
        pgType: 'text',
        nullable: false,
        default: null,
        constraints: ['crm1_companies_name_nonempty_check'],
        businessRule: 'Flat company legal/trade name; trimmed length must be > 0.',
        example: 'Acme Industrial Solutions Inc',
      },
      {
        name: 'tax_number',
        pgType: 'text',
        nullable: true,
        default: null,
        constraints: ['Deterministic exact duplicate matching candidate key'],
        businessRule: 'Normalized tax identifier (uppercase, alphanumeric only).',
        example: 'US-EIN-987654321',
      },
      {
        name: 'email',
        pgType: 'text',
        nullable: true,
        default: null,
        constraints: ['RFC-5322 syntax validation via Zod / OpenAPI contract'],
        businessRule: 'Company main contact email, normalized lowercase on search.',
        example: 'contact@acmeindustrial.example.com',
      },
      {
        name: 'phone',
        pgType: 'text',
        nullable: true,
        default: null,
        constraints: ['E.164 normalization recommendation'],
        businessRule: 'Primary telephone number for company headquarters.',
        example: '+1-555-019-2834',
      },
      {
        name: 'address',
        pgType: 'text',
        nullable: true,
        default: null,
        constraints: ['Single flat string in V1'],
        businessRule: 'Combined postal address string (street, suite, city, state, zip, country).',
        example: '100 Enterprise Way, Suite 400, Chicago, IL 60601',
      },
      {
        name: 'source_system',
        pgType: 'text',
        nullable: true,
        default: null,
        constraints: ['crm1_companies_source_pair_check', 'crm1_companies_source_key (UNIQUE)'],
        businessRule: 'Legacy system identifier; must be paired with source_id and non-empty.',
        example: 'salesforce_legacy',
      },
      {
        name: 'source_id',
        pgType: 'text',
        nullable: true,
        default: null,
        constraints: ['crm1_companies_source_pair_check', 'crm1_companies_source_key (UNIQUE)'],
        businessRule: 'Original record primary key in legacy system; pair is unique.',
        example: '0015000000XyZ1AAAZ',
      },
      {
        name: 'created_at',
        pgType: 'timestamptz',
        nullable: false,
        default: 'now()',
        constraints: ['UTC timestamp'],
        businessRule: 'Audit timestamp set once when company record is first inserted.',
        example: '2026-10-23T08:00:00.000Z',
      },
      {
        name: 'updated_at',
        pgType: 'timestamptz',
        nullable: false,
        default: 'now()',
        constraints: ['UTC timestamp'],
        businessRule: 'Audit timestamp automatically updated on every mutation.',
        example: '2026-10-23T08:15:00.000Z',
      },
    ],
    indexes: [
      'crm1_companies_source_key: UNIQUE (source_system, source_id)',
      'crm1_companies_name_search_idx: INDEX (lower(name))',
    ],
    checkConstraints: [
      'crm1_companies_name_nonempty_check: length(btrim(name)) > 0',
      'crm1_companies_source_pair_check: (source_system IS NULL AND source_id IS NULL) OR (both NOT NULL and length > 0)',
    ],
  },
  {
    tableName: 'crm1_contacts',
    entityName: 'Contact',
    owner: 'CRM-1 (Group 1)',
    description: 'Golden contact records with identity keys, consent status, and company links.',
    columns: [
      {
        name: 'id',
        pgType: 'uuid',
        nullable: false,
        default: 'gen_random_uuid()',
        constraints: ['Primary Key'],
        businessRule: 'Immutable surrogate UUID primary key.',
        example: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
      },
      {
        name: 'first_name',
        pgType: 'text',
        nullable: false,
        default: null,
        constraints: ['crm1_contacts_first_name_nonempty_check'],
        businessRule: 'Given name; trimmed length must be > 0.',
        example: 'Elena',
      },
      {
        name: 'last_name',
        pgType: 'text',
        nullable: false,
        default: null,
        constraints: ['crm1_contacts_last_name_nonempty_check'],
        businessRule: 'Family name; trimmed length must be > 0.',
        example: 'Rostova',
      },
      {
        name: 'email',
        pgType: 'text',
        nullable: true,
        default: null,
        constraints: ['Case-insensitive search index', 'Deterministic exact duplicate matching candidate key'],
        businessRule: 'Contact email. Exact matches are flagged for human review; no fuzzy auto-merge.',
        example: 'elena.rostova@example.com',
      },
      {
        name: 'phone',
        pgType: 'text',
        nullable: true,
        default: null,
        constraints: ['Paired with normalized name for exact candidate key'],
        businessRule: 'Contact telephone number.',
        example: '+1-555-014-9988',
      },
      {
        name: 'address',
        pgType: 'text',
        nullable: true,
        default: null,
        constraints: ['Single flat string in V1'],
        businessRule: 'Postal address for contact communication.',
        example: '742 Evergreen Terrace, Springfield, OR 97477',
      },
      {
        name: 'company_id',
        pgType: 'uuid',
        nullable: true,
        default: null,
        constraints: ['Foreign Key -> crm1_companies(id)', 'ON DELETE RESTRICT', 'Indexed'],
        businessRule: 'Optional link to owning company. Cannot delete company while linked contacts exist.',
        example: '550e8400-e29b-41d4-a716-446655440000',
      },
      {
        name: 'lead_status',
        pgType: 'text',
        nullable: true,
        default: null,
        constraints: ['crm1_contacts_lead_status_check'],
        businessRule: 'Allowlist check: NULL or IN ("New", "Working", "Qualified", "Closed").',
        example: 'Qualified',
      },
      {
        name: 'golden_id',
        pgType: 'text',
        nullable: false,
        default: null,
        constraints: ['crm1_contacts_golden_id_key (UNIQUE)', 'crm1_contacts_golden_id_nonempty_check'],
        businessRule: 'Unique master identity key assigned by Golden ID service. Immutable once generated.',
        example: 'GID-CRM1-2026-9048123',
      },
      {
        name: 'source_system',
        pgType: 'text',
        nullable: true,
        default: null,
        constraints: ['crm1_contacts_source_pair_check', 'crm1_contacts_source_key (UNIQUE)'],
        businessRule: 'Source system tag from migration ingest.',
        example: 'hubspot_crm',
      },
      {
        name: 'source_id',
        pgType: 'text',
        nullable: true,
        default: null,
        constraints: ['crm1_contacts_source_pair_check', 'crm1_contacts_source_key (UNIQUE)'],
        businessRule: 'Unique source row identifier in origin system.',
        example: 'hs_contact_884129',
      },
      {
        name: 'consent_status',
        pgType: 'text',
        nullable: false,
        default: "'unknown'",
        constraints: ['crm1_contacts_consent_status_check', 'crm1_contacts_consent_timestamp_check'],
        businessRule: 'Allowed values: "unknown", "granted", "withdrawn". Non-unknown requires consent_updated_at.',
        example: 'granted',
      },
      {
        name: 'consent_updated_at',
        pgType: 'timestamptz',
        nullable: true,
        default: null,
        constraints: ['Monotonic timestamp trigger check'],
        businessRule: 'Source event time. Database rejects stale updates where timestamp is <= existing.',
        example: '2026-10-23T08:00:00.000Z',
      },
      {
        name: 'unsubscribed',
        pgType: 'boolean',
        nullable: false,
        default: 'false',
        constraints: ['crm1_contacts_unsubscribed_timestamp_check'],
        businessRule: 'Unsubscribe flag (BR-CRM4-01). True requires unsubscribed_updated_at; never overturned by import.',
        example: false,
      },
      {
        name: 'unsubscribed_updated_at',
        pgType: 'timestamptz',
        nullable: true,
        default: null,
        constraints: ['Monotonic timestamp trigger check'],
        businessRule: 'Source timestamp when user unsubscribed.',
        example: null,
      },
      {
        name: 'created_at',
        pgType: 'timestamptz',
        nullable: false,
        default: 'now()',
        constraints: ['UTC timestamp'],
        businessRule: 'Audit timestamp set when contact is inserted.',
        example: '2026-10-23T08:00:00.000Z',
      },
      {
        name: 'updated_at',
        pgType: 'timestamptz',
        nullable: false,
        default: 'now()',
        constraints: ['UTC timestamp'],
        businessRule: 'Audit timestamp updated on contact mutation.',
        example: '2026-10-23T08:15:00.000Z',
      },
    ],
    indexes: [
      'crm1_contacts_golden_id_key: UNIQUE (golden_id)',
      'crm1_contacts_source_key: UNIQUE (source_system, source_id)',
      'crm1_contacts_name_search_idx: INDEX (lower(first_name), lower(last_name))',
      'crm1_contacts_email_search_idx: INDEX (lower(email))',
      'crm1_contacts_company_id_idx: INDEX (company_id)',
    ],
    checkConstraints: [
      'crm1_contacts_first_name_nonempty_check: length(btrim(first_name)) > 0',
      'crm1_contacts_last_name_nonempty_check: length(btrim(last_name)) > 0',
      'crm1_contacts_golden_id_nonempty_check: length(btrim(golden_id)) > 0',
      'crm1_contacts_lead_status_check: lead_status IS NULL OR lead_status IN ("New", "Working", "Qualified", "Closed")',
      'crm1_contacts_consent_status_check: consent_status IN ("unknown", "granted", "withdrawn")',
      'crm1_contacts_consent_timestamp_check: (consent_status = "unknown" AND consent_updated_at IS NULL) OR (consent_status <> "unknown" AND consent_updated_at IS NOT NULL)',
      'crm1_contacts_unsubscribed_timestamp_check: unsubscribed = false OR unsubscribed_updated_at IS NOT NULL',
      'crm1_contacts_source_pair_check: (source_system IS NULL AND source_id IS NULL) OR (both NOT NULL and length > 0)',
    ],
  },
  {
    tableName: 'crm1_leads',
    entityName: 'Lead',
    owner: 'CRM-1 (Group 1)',
    description: 'Leads representing sales prospects associated with a master contact.',
    columns: [
      {
        name: 'id',
        pgType: 'uuid',
        nullable: false,
        default: 'gen_random_uuid()',
        constraints: ['Primary Key'],
        businessRule: 'Immutable surrogate UUID primary key.',
        example: 'c3d4e5f6-7a8b-9c0d-1e2f-3a4b5c6d7e8f',
      },
      {
        name: 'contact_id',
        pgType: 'uuid',
        nullable: false,
        default: null,
        constraints: ['Foreign Key -> crm1_contacts(id)', 'ON DELETE RESTRICT', 'Indexed'],
        businessRule: 'Mandatory reference to the contact. Orphan leads are prohibited.',
        example: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
      },
      {
        name: 'status',
        pgType: 'text',
        nullable: false,
        default: null,
        constraints: ['crm1_leads_status_check', 'Indexed'],
        businessRule: 'Strict workflow allowlist: New -> Working -> Qualified -> Closed. Regressions return 422.',
        example: 'New',
      },
      {
        name: 'source_system',
        pgType: 'text',
        nullable: true,
        default: null,
        constraints: ['crm1_leads_source_pair_check', 'crm1_leads_source_key (UNIQUE)'],
        businessRule: 'Origin system tag for migrated leads.',
        example: 'pipedrive_source',
      },
      {
        name: 'source_id',
        pgType: 'text',
        nullable: true,
        default: null,
        constraints: ['crm1_leads_source_pair_check', 'crm1_leads_source_key (UNIQUE)'],
        businessRule: 'Origin system lead identifier.',
        example: 'pd_lead_44901',
      },
      {
        name: 'created_at',
        pgType: 'timestamptz',
        nullable: false,
        default: 'now()',
        constraints: ['UTC timestamp'],
        businessRule: 'Audit timestamp set on lead creation.',
        example: '2026-10-23T08:00:00.000Z',
      },
      {
        name: 'updated_at',
        pgType: 'timestamptz',
        nullable: false,
        default: 'now()',
        constraints: ['UTC timestamp'],
        businessRule: 'Audit timestamp updated on lead status advance or modification.',
        example: '2026-10-23T08:10:00.000Z',
      },
    ],
    indexes: [
      'crm1_leads_source_key: UNIQUE (source_system, source_id)',
      'crm1_leads_contact_id_idx: INDEX (contact_id)',
      'crm1_leads_status_idx: INDEX (status)',
    ],
    checkConstraints: [
      'crm1_leads_status_check: status IN ("New", "Working", "Qualified", "Closed")',
      'crm1_leads_source_pair_check: (source_system IS NULL AND source_id IS NULL) OR (both NOT NULL and length > 0)',
    ],
  },
  {
    tableName: 'crm1_import_batches',
    entityName: 'ImportBatch',
    owner: 'CRM-1 (Group 1)',
    description: 'Tracks migration batch state, loaded/rejected counters, and idempotency digests.',
    columns: [
      {
        name: 'id',
        pgType: 'uuid',
        nullable: false,
        default: 'gen_random_uuid()',
        constraints: ['Primary Key'],
        businessRule: 'Primary identifier for import batch correlation.',
        example: 'b1a2c3d4-0000-4000-8000-111122223333',
      },
      {
        name: 'source_system',
        pgType: 'text',
        nullable: false,
        default: null,
        constraints: ['crm1_import_batches_source_system_nonempty_check'],
        businessRule: 'Origin source system name (e.g. "salesforce", "csv_upload").',
        example: 'csv_upload_contacts',
      },
      {
        name: 'status',
        pgType: 'text',
        nullable: false,
        default: "'pending'",
        constraints: ['crm1_import_batches_status_check'],
        businessRule: 'Batch state: "pending", "processing", "completed", or "failed".',
        example: 'completed',
      },
      {
        name: 'idempotency_key',
        pgType: 'text',
        nullable: true,
        default: null,
        constraints: ['crm1_import_batches_idempotency_key (UNIQUE)', 'crm1_import_batches_idempotency_pair_check'],
        businessRule: 'Caller-supplied idempotency key. Same key + same hash returns original batch; mismatch returns 409.',
        example: 'idem-crm1-batch-20261023-001',
      },
      {
        name: 'request_hash',
        pgType: 'text',
        nullable: true,
        default: null,
        constraints: ['crm1_import_batches_idempotency_pair_check'],
        businessRule: 'Deterministic SHA-256 hash of validated input payload.',
        example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
      {
        name: 'loaded_count',
        pgType: 'integer',
        nullable: false,
        default: '0',
        constraints: ['crm1_import_batches_loaded_count_check (>= 0)'],
        businessRule: 'Committed target records count. Updated atomically with receipts.',
        example: 85,
      },
      {
        name: 'rejected_count',
        pgType: 'integer',
        nullable: false,
        default: '0',
        constraints: ['crm1_import_batches_rejected_count_check (>= 0)'],
        businessRule: 'Count of failed records stored in rejects table.',
        example: 15,
      },
      {
        name: 'created_at',
        pgType: 'timestamptz',
        nullable: false,
        default: 'now()',
        constraints: ['Indexed'],
        businessRule: 'Timestamp when batch execution initiated.',
        example: '2026-10-23T08:00:00.000Z',
      },
      {
        name: 'updated_at',
        pgType: 'timestamptz',
        nullable: false,
        default: 'now()',
        constraints: ['UTC timestamp'],
        businessRule: 'Timestamp when batch counters were last committed.',
        example: '2026-10-23T08:01:30.000Z',
      },
      {
        name: 'completed_at',
        pgType: 'timestamptz',
        nullable: true,
        default: null,
        constraints: ['Set upon terminal state'],
        businessRule: 'Timestamp when batch reached terminal status (completed or failed).',
        example: '2026-10-23T08:01:30.000Z',
      },
    ],
    indexes: [
      'crm1_import_batches_idempotency_key: UNIQUE (idempotency_key)',
      'crm1_import_batches_created_at_idx: INDEX (created_at)',
    ],
    checkConstraints: [
      'crm1_import_batches_source_system_nonempty_check: length(btrim(source_system)) > 0',
      'crm1_import_batches_status_check: status IN ("pending", "processing", "completed", "failed")',
      'crm1_import_batches_idempotency_pair_check: (idempotency_key IS NULL AND request_hash IS NULL) OR (both NOT NULL and length > 0)',
      'crm1_import_batches_loaded_count_check: loaded_count >= 0',
      'crm1_import_batches_rejected_count_check: rejected_count >= 0',
    ],
  },
  {
    tableName: 'crm1_import_receipts',
    entityName: 'ImportReceipt',
    owner: 'CRM-1 (Group 1)',
    description: 'Durable receipts written atomically with target records. Provides per-row idempotency.',
    columns: [
      {
        name: 'id',
        pgType: 'uuid',
        nullable: false,
        default: 'gen_random_uuid()',
        constraints: ['Primary Key'],
        businessRule: 'Surrogate UUID for the receipt.',
        example: 'd4e5f67a-8b9c-0d1e-2f3a-4b5c6d7e8f9a',
      },
      {
        name: 'batch_id',
        pgType: 'uuid',
        nullable: false,
        default: null,
        constraints: ['Foreign Key -> crm1_import_batches(id)', 'ON DELETE CASCADE'],
        businessRule: 'Owning migration batch. Cascade-deleted if parent batch is removed.',
        example: 'b1a2c3d4-0000-4000-8000-111122223333',
      },
      {
        name: 'source_row',
        pgType: 'integer',
        nullable: false,
        default: null,
        constraints: ['crm1_import_receipts_source_row_check (> 0)'],
        businessRule: '1-indexed source row number in input file/stream.',
        example: 42,
      },
      {
        name: 'entity',
        pgType: 'text',
        nullable: false,
        default: null,
        constraints: ['crm1_import_receipts_entity_check'],
        businessRule: 'Target entity type: "contact", "company", or "lead".',
        example: 'contact',
      },
      {
        name: 'source_system',
        pgType: 'text',
        nullable: false,
        default: null,
        constraints: ['crm1_import_receipts_source_system_nonempty_check'],
        businessRule: 'Origin system tag for provenance tracking.',
        example: 'csv_upload_contacts',
      },
      {
        name: 'source_id',
        pgType: 'text',
        nullable: false,
        default: null,
        constraints: ['crm1_import_receipts_source_id_nonempty_check'],
        businessRule: 'Legacy primary key or synthesized row key in origin system.',
        example: 'legacy_row_42',
      },
      {
        name: 'target_id',
        pgType: 'uuid',
        nullable: false,
        default: null,
        constraints: ['Indexed'],
        businessRule: 'UUID of created/mutated target domain record (contact, company, lead).',
        example: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
      },
      {
        name: 'idempotency_key',
        pgType: 'text',
        nullable: false,
        default: null,
        constraints: ['crm1_import_receipts_idempotency_key (UNIQUE)', 'crm1_import_receipts_idempotency_key_nonempty_check'],
        businessRule: 'Deterministic key: `${batchId}:${sourceRow}:${entity}`. Retries safely skip duplicate insertion.',
        example: 'b1a2c3d4-0000-4000-8000-111122223333:42:contact',
      },
      {
        name: 'created_at',
        pgType: 'timestamptz',
        nullable: false,
        default: 'now()',
        constraints: ['UTC timestamp'],
        businessRule: 'Timestamp when receipt and target business record committed together.',
        example: '2026-10-23T08:00:45.000Z',
      },
    ],
    indexes: [
      'crm1_import_receipts_idempotency_key: UNIQUE (idempotency_key)',
      'crm1_import_receipts_batch_row_entity_key: UNIQUE (batch_id, source_row, entity)',
      'crm1_import_receipts_target_id_idx: INDEX (target_id)',
    ],
    checkConstraints: [
      'crm1_import_receipts_source_row_check: source_row > 0',
      'crm1_import_receipts_entity_check: entity IN ("contact", "company", "lead")',
      'crm1_import_receipts_source_system_nonempty_check: length(btrim(source_system)) > 0',
      'crm1_import_receipts_source_id_nonempty_check: length(btrim(source_id)) > 0',
      'crm1_import_receipts_idempotency_key_nonempty_check: length(btrim(idempotency_key)) > 0',
    ],
  },
  {
    tableName: 'crm1_import_rejects',
    entityName: 'ImportReject',
    owner: 'CRM-1 (Group 1)',
    description: 'Audits failed migration rows with reason codes and privacy-safe messages (no raw PII).',
    columns: [
      {
        name: 'id',
        pgType: 'uuid',
        nullable: false,
        default: 'gen_random_uuid()',
        constraints: ['Primary Key'],
        businessRule: 'Surrogate UUID for the reject audit entry.',
        example: 'e5f67a8b-9c0d-1e2f-3a4b-5c6d7e8f9a0b',
      },
      {
        name: 'batch_id',
        pgType: 'uuid',
        nullable: false,
        default: null,
        constraints: ['Foreign Key -> crm1_import_batches(id)', 'ON DELETE CASCADE', 'Indexed'],
        businessRule: 'Owning migration batch correlation ID.',
        example: 'b1a2c3d4-0000-4000-8000-111122223333',
      },
      {
        name: 'source_row',
        pgType: 'integer',
        nullable: false,
        default: null,
        constraints: ['crm1_import_rejects_source_row_check (> 0)'],
        businessRule: '1-indexed source row number where failure occurred.',
        example: 87,
      },
      {
        name: 'entity',
        pgType: 'text',
        nullable: false,
        default: null,
        constraints: ['crm1_import_rejects_entity_check'],
        businessRule: 'Attempted target entity: "contact", "company", or "lead".',
        example: 'contact',
      },
      {
        name: 'reason_code',
        pgType: 'text',
        nullable: false,
        default: null,
        constraints: ['crm1_import_rejects_reason_code_nonempty_check'],
        businessRule: 'Standard machine-readable error code (e.g. INVALID_EMAIL, REFERENCE_NOT_FOUND).',
        example: 'INVALID_EMAIL',
      },
      {
        name: 'message',
        pgType: 'text',
        nullable: false,
        default: null,
        constraints: ['crm1_import_rejects_message_nonempty_check'],
        businessRule: 'Privacy-safe, non-PII diagnostic message describing why the row was rejected.',
        example: 'Email format does not conform to RFC-5322 syntax specification',
      },
      {
        name: 'created_at',
        pgType: 'timestamptz',
        nullable: false,
        default: 'now()',
        constraints: ['UTC timestamp'],
        businessRule: 'Timestamp when reject audit record was stored.',
        example: '2026-10-23T08:00:50.000Z',
      },
    ],
    indexes: ['crm1_import_rejects_batch_id_idx: INDEX (batch_id)'],
    checkConstraints: [
      'crm1_import_rejects_source_row_check: source_row > 0',
      'crm1_import_rejects_entity_check: entity IN ("contact", "company", "lead")',
      'crm1_import_rejects_reason_code_nonempty_check: length(btrim(reason_code)) > 0',
      'crm1_import_rejects_message_nonempty_check: length(btrim(message)) > 0',
    ],
  },
];

// =============================================================================
// 2. ERD RELATIONSHIPS & CARDINALITY (Primary Keys, Foreign Keys, Boundaries)
// =============================================================================

export const CRM1_ERD_RELATIONSHIPS: RelationshipDefinition[] = [
  {
    relationshipId: 'REL-CRM1-01',
    fromTable: 'crm1_contacts',
    fromColumn: 'company_id',
    toTable: 'crm1_companies',
    toColumn: 'id',
    cardinality: 'N:1',
    onDelete: 'RESTRICT',
    enforcement: 'Database Foreign Key',
    description: 'Contacts optionally link to one parent Company. Deletion of company is restricted while contacts exist.',
  },
  {
    relationshipId: 'REL-CRM1-02',
    fromTable: 'crm1_leads',
    fromColumn: 'contact_id',
    toTable: 'crm1_contacts',
    toColumn: 'id',
    cardinality: 'N:1',
    onDelete: 'RESTRICT',
    enforcement: 'Database Foreign Key',
    description: 'Leads must link to a valid Contact. Deletion of contact is restricted while leads exist.',
  },
  {
    relationshipId: 'REL-CRM1-03',
    fromTable: 'crm1_import_receipts',
    fromColumn: 'batch_id',
    toTable: 'crm1_import_batches',
    toColumn: 'id',
    cardinality: 'N:1',
    onDelete: 'CASCADE',
    enforcement: 'Database Foreign Key',
    description: 'Per-row import receipts belong to an Import Batch; cascade deleted if batch is pruned.',
  },
  {
    relationshipId: 'REL-CRM1-04',
    fromTable: 'crm1_import_rejects',
    fromColumn: 'batch_id',
    toTable: 'crm1_import_batches',
    toColumn: 'id',
    cardinality: 'N:1',
    onDelete: 'CASCADE',
    enforcement: 'Database Foreign Key',
    description: 'Row-level rejections belong to an Import Batch; cascade deleted if batch is pruned.',
  },
  {
    relationshipId: 'REL-CRM1-05',
    fromTable: 'crm1_import_receipts',
    fromColumn: 'target_id',
    toTable: 'crm1_contacts / crm1_companies / crm1_leads',
    toColumn: 'id',
    cardinality: 'N:1',
    onDelete: 'RESTRICT',
    enforcement: 'Domain Application Guard',
    description: 'Polymorphic target reference recorded at commit time; indexed for fast lookup without cross-table foreign key.',
  },
];

// =============================================================================
// 3. REQUIREMENT-TO-TEST TRACEABILITY MATRIX (SDS §4.2 Must Requirements)
// =============================================================================

export const CRM1_TRACEABILITY_MATRIX: TraceabilityEntry[] = [
  {
    reqId: 'FR-CRM1-01',
    requirement: 'Show a contact list with search by name and email, paged (25 per page, max 100).',
    priority: 'Must',
    sourceDoc: 'SDS ClearShift CRM v2.0 §4.2',
    category: 'API',
    testType: 'contract',
    testFile: 'apps/crm/modules/crm-1/tests/api/list.test.ts',
    testSuite: 'CRM-1 List/Read API & Contracts (Issue #7 / [CRM1-02])',
    verificationEvidence: 'GET /contacts returns 25 records with totalCount, page, totalPages, and supports query filters.',
  },
  {
    reqId: 'FR-CRM1-02',
    requirement: 'Create and edit contact: first name, last name, email, phone, address, company link, lead status.',
    priority: 'Must',
    sourceDoc: 'SDS ClearShift CRM v2.0 §4.2',
    category: 'API',
    testType: 'regression',
    testFile: 'apps/crm/modules/crm-1/tests/api/mutations.test.ts',
    testSuite: 'CRM-1 mutation API',
    verificationEvidence: 'POST /contacts creates record with Zod validation; PATCH /contacts/:id updates mutable fields.',
  },
  {
    reqId: 'FR-CRM1-03',
    requirement: 'Create and edit flat company: name, tax number, email, phone, address.',
    priority: 'Must',
    sourceDoc: 'SDS ClearShift CRM v2.0 §4.2',
    category: 'API',
    testType: 'regression',
    testFile: 'apps/crm/modules/crm-1/tests/api/mutations.test.ts',
    testSuite: 'CRM-1 mutation API',
    verificationEvidence: 'POST /companies validates non-empty name; PATCH /companies/:id updates company details.',
  },
  {
    reqId: 'FR-CRM1-04',
    requirement: 'Link a contact to one company (optional field, restrict on delete).',
    priority: 'Must',
    sourceDoc: 'SDS ClearShift CRM v2.0 §4.2',
    category: 'Database',
    testType: 'schema',
    testFile: 'apps/crm/modules/crm-1/tests/db/schema.test.ts',
    testSuite: 'CRM-1 Drizzle schema constraints',
    verificationEvidence: 'FK constraint crm1_contacts_company_id_crm1_companies_id_fk enforces ON DELETE RESTRICT.',
  },
  {
    reqId: 'FR-CRM1-05',
    requirement: 'Lead status field with allowlist values: New -> Working -> Qualified -> Closed.',
    priority: 'Must',
    sourceDoc: 'SDS ClearShift CRM v2.0 §4.2',
    category: 'Domain',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-1/tests/domain/relationships.test.ts',
    testSuite: 'CRM-1 Relationships & Domain Invariants',
    verificationEvidence: 'assertLeadStatusTransition enforces forward-only lifecycle; backward transitions throw 422.',
  },
  {
    reqId: 'FR-CRM1-06',
    requirement: 'Import screen / API: upload CSV file, show profile report, execute run, watch status.',
    priority: 'Must',
    sourceDoc: 'SDS ClearShift CRM v2.0 §4.2',
    category: 'Migration',
    testType: 'integration',
    testFile: 'apps/crm/modules/crm-1/tests/services/crm1-mutation.service.test.ts',
    testSuite: 'CRM-1 mutation service & idempotent imports',
    verificationEvidence: 'importBatch executes target writes and commits receipts in single transaction.',
  },
  {
    reqId: 'FR-CRM1-07',
    requirement: 'Reject list: rejected rows with machine reason code, safe non-PII message, downloadable as CSV.',
    priority: 'Must',
    sourceDoc: 'SDS ClearShift CRM v2.0 §4.2',
    category: 'API',
    testType: 'contract',
    testFile: 'apps/crm/modules/crm-1/tests/api/list.test.ts',
    testSuite: 'CRM-1 List/Read API & Contracts (Issue #7 / [CRM1-02])',
    verificationEvidence: 'GET /imports/:batch/rejects returns row errors with reasonCode; payload does not leak raw secrets.',
  },
  {
    reqId: 'FR-CRM1-08',
    requirement: 'Every list view shows an accessible empty state with instructions ("No contacts yet — import a CSV file").',
    priority: 'Should',
    sourceDoc: 'SDS ClearShift CRM v2.0 §4.2',
    category: 'Web',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-1/tests/web/routes.test.ts',
    testSuite: 'CRM-1 Frontend Route Registration & Layout Shell',
    verificationEvidence: 'React page components render aria-live empty state container when dataset length is 0.',
  },
  {
    reqId: 'FR-CRM1-10',
    requirement: 'Duplicate review: show candidate pairs, deterministic exact keys, buttons Keep / Merge / Skip.',
    priority: 'Must',
    sourceDoc: 'SDS ClearShift CRM v2.0 §4.2',
    category: 'Domain',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-1/tests/web/routes.test.ts',
    testSuite: 'CRM-1 Frontend Route Registration & Layout Shell',
    verificationEvidence: 'Route /crm-1/duplicates registered with role guard; duplicate evaluation uses deterministic exact keys.',
  },
  {
    reqId: 'FR-CRM1-14',
    requirement: 'Import history: list past runs with user, source system, loaded/rejected counts, link to receipts.',
    priority: 'Must',
    sourceDoc: 'SDS ClearShift CRM v2.0 §4.2',
    category: 'API',
    testType: 'contract',
    testFile: 'apps/crm/modules/crm-1/tests/api/list.test.ts',
    testSuite: 'CRM-1 List/Read API & Contracts (Issue #7 / [CRM1-02])',
    verificationEvidence: 'GET /imports/:batch returns batch metadata, loadedCount, and rejectedCount.',
  },
  {
    reqId: 'FR-CRM1-23',
    requirement: 'Append-only audit trail: capture actor, action, timestamp, entity, correlationId, redacted diff.',
    priority: 'Must',
    sourceDoc: 'SDS ClearShift CRM v2.0 §4.2',
    category: 'Security',
    testType: 'security',
    testFile: 'apps/crm/modules/crm-1/tests/security/authorization.test.ts',
    testSuite: 'CRM-1 Security & Authorization (Issue #14 / [CRM1-09])',
    verificationEvidence: 'auditService writes immutable entry; raw passwords and bank numbers are redacted.',
  },
  {
    reqId: 'BR-CRM1-DUP-01',
    requirement: 'Contact exact email key normalization: lowercase, trimmed, whitespace stripped. No fuzzy scoring.',
    priority: 'Must',
    sourceDoc: 'CRM SDS v2.0 §4.2 & Master Architecture Spec',
    category: 'Domain',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-1/tests/domain/relationships.test.ts',
    testSuite: 'CRM-1 Relationships & Domain Invariants',
    verificationEvidence: 'Exact key normalization matches identical emails deterministically without fuzzy auto-merge.',
  },
  {
    reqId: 'BR-CRM1-DUP-02',
    requirement: 'Contact exact combined key: normalized phone + normalized name (${phone}#${first_name} ${last_name}).',
    priority: 'Must',
    sourceDoc: 'CRM SDS v2.0 §4.2 & Master Architecture Spec',
    category: 'Domain',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-1/tests/domain/relationships.test.ts',
    testSuite: 'CRM-1 Relationships & Domain Invariants',
    verificationEvidence: 'Deterministic compound key resolves contact pairs with matching phone and name.',
  },
  {
    reqId: 'BR-CRM1-DUP-03',
    requirement: 'Company exact tax number key: alphanumeric uppercase normalization.',
    priority: 'Must',
    sourceDoc: 'CRM SDS v2.0 §4.2 & Master Architecture Spec',
    category: 'Domain',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-1/tests/domain/relationships.test.ts',
    testSuite: 'CRM-1 Relationships & Domain Invariants',
    verificationEvidence: 'Deterministic tax number normalization strips dashes/spaces and compares exact keys.',
  },
  {
    reqId: 'SEC-01',
    requirement: 'Enforce asymmetric EdDSA JWT authentication and RBAC 5 roles (viewer, editor, analyst, admin, migration_runner).',
    priority: 'Must',
    sourceDoc: 'SDS ClearShift CRM v2.0 §7.1',
    category: 'Security',
    testType: 'security',
    testFile: 'apps/crm/modules/crm-1/tests/security/authorization.test.ts',
    testSuite: 'CRM-1 Security & Authorization (Issue #14 / [CRM1-09])',
    verificationEvidence: 'HTTP 401 on missing/expired tokens; HTTP 403 when user lacks authorized role.',
  },
  {
    reqId: 'SEC-02',
    requirement: 'Mask sensitive fields (bank accounts XXXX-XXXX-7890, salary XX,XXX, CSV formula escape apostrophe).',
    priority: 'Must',
    sourceDoc: 'ClearShift Core Security Policy & SDS §7.2',
    category: 'Security',
    testType: 'security',
    testFile: 'apps/crm/modules/crm-1/tests/security/authorization.test.ts',
    testSuite: 'CRM-1 Security & Authorization (Issue #14 / [CRM1-09])',
    verificationEvidence: 'Exports and responses sanitize sensitive properties and prefix formula tokens with single quote.',
  },
  {
    reqId: 'MIG-01',
    requirement: 'Atomic commit: target domain record and per-row import receipt commit in one PostgreSQL transaction.',
    priority: 'Must',
    sourceDoc: 'ClearShift Core Migration Rules & KIT-08',
    category: 'Migration',
    testType: 'integration',
    testFile: 'apps/crm/modules/crm-1/tests/services/crm1-mutation.service.test.ts',
    testSuite: 'CRM-1 mutation service & idempotent imports',
    verificationEvidence: 'Failure in target insert aborts receipt; both commit together on success.',
  },
  {
    reqId: 'MIG-02',
    requirement: 'Row conservation balance sheet: source = loaded + rejected + merged + skipped (unaccounted = 0).',
    priority: 'Must',
    sourceDoc: 'ClearShift Core Migration Rules',
    category: 'Migration',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-1/tests/domain/qa-g1-design.test.ts',
    testSuite: 'CRM-1 QA Gate G1 Design Specifications',
    verificationEvidence: 'Mathematical conservation check validates zero unaccounted rows across all test batches.',
  },
  {
    reqId: 'MIG-03',
    requirement: 'Bounded 500-row chunking and stop migration when failures exceed 10% of attempted rows.',
    priority: 'Must',
    sourceDoc: 'ClearShift Core Migration Rules',
    category: 'Migration',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-1/tests/domain/qa-g1-design.test.ts',
    testSuite: 'CRM-1 QA Gate G1 Design Specifications',
    verificationEvidence: 'Excessive failure halts further processing, preserving committed rows and receipts.',
  },
];

// =============================================================================
// 4. DIRTY DATA PACK PLAN (100-Row Module Pack & 1,000-Row Canonical Pack)
// =============================================================================

export const CRM1_DIRTY_DATA_PACK_PLAN: DirtyDataPackPlan = {
  module: 'crm-1',
  targetEntities: ['crm1_companies', 'crm1_contacts', 'crm1_leads'],
  canonical1000Plan: {
    totalSourceRows: 1000,
    expectedLoaded: 780,
    expectedRejected: 140,
    expectedMerged: 80, // 80 known duplicates resolved under human review
    expectedSkipped: 0,
    unaccounted: 0,
  },
  module100Plan: {
    totalSourceRows: 100,
    expectedLoaded: 74,
    expectedRejected: 18,
    expectedMerged: 8, // 8 duplicate candidate rows merged into 4 target records
    expectedSkipped: 0,
    unaccounted: 0,
  },
  scenarios: [
    {
      scenarioId: 'SCENARIO-CRM1-01',
      category: 'golden_baseline',
      description: 'Clean, syntactically valid contacts with complete first/last name, valid email, and phone.',
      targetEntity: 'contact',
      expectedOutcome: 'loaded',
      expectedCountIn100: 50,
      expectedCountIn1000: 600,
      sampleRecord: {
        first_name: 'Marcus',
        last_name: 'Vance',
        email: 'marcus.vance@synthetic-corp.example',
        phone: '+1-555-010-4491',
        address: '123 Market St, San Francisco, CA',
      },
    },
    {
      scenarioId: 'SCENARIO-CRM1-02',
      category: 'golden_baseline',
      description: 'Clean company records with valid name, tax identifier, and headquarters address.',
      targetEntity: 'company',
      expectedOutcome: 'loaded',
      expectedCountIn100: 20,
      expectedCountIn1000: 150,
      sampleRecord: {
        name: 'Apex Robotics International',
        tax_number: 'US-EIN-123456789',
        email: 'info@apexrobotics.example',
        phone: '+1-555-019-3322',
        address: '500 Innovation Blvd, Austin, TX 78701',
      },
    },
    {
      scenarioId: 'SCENARIO-CRM1-03',
      category: 'golden_baseline',
      description: 'Clean leads linked to an existing golden contact in status New or Working.',
      targetEntity: 'lead',
      expectedOutcome: 'loaded',
      expectedCountIn100: 4,
      expectedCountIn1000: 30,
      sampleRecord: {
        contact_id: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
        status: 'New',
        source_system: 'web_form',
        source_id: 'wf_9921',
      },
    },
    {
      scenarioId: 'SCENARIO-CRM1-04',
      category: 'exact_duplicate',
      description: 'Exact normalized email duplicate candidates (case differences and surrounding whitespace).',
      targetEntity: 'contact',
      expectedOutcome: 'merged',
      reasonCode: 'EXACT_EMAIL_MATCH',
      expectedCountIn100: 4, // 2 duplicate pairs
      expectedCountIn1000: 40, // 20 duplicate pairs
      sampleRecord: {
        first_name: 'Sophia',
        last_name: 'Chen',
        email: '  sophia.chen@alpha-tech.example  ',
        phone: '+1-555-018-2200',
      },
    },
    {
      scenarioId: 'SCENARIO-CRM1-05',
      category: 'exact_duplicate',
      description: 'Exact compound key duplicate candidates (normalized phone + normalized full name).',
      targetEntity: 'contact',
      expectedOutcome: 'merged',
      reasonCode: 'EXACT_PHONE_NAME_MATCH',
      expectedCountIn100: 4, // 2 duplicate pairs
      expectedCountIn1000: 40, // 20 duplicate pairs
      sampleRecord: {
        first_name: 'David',
        last_name: 'Kim',
        email: 'david.personal@example.net',
        phone: ' (555) 012-7744 ',
      },
    },
    {
      scenarioId: 'SCENARIO-CRM1-06',
      category: 'malformed_syntax',
      description: 'Malformed email addresses violating RFC-5322 syntax (missing @, invalid domain, forbidden chars).',
      targetEntity: 'contact',
      expectedOutcome: 'rejected',
      reasonCode: 'INVALID_EMAIL',
      expectedCountIn100: 4,
      expectedCountIn1000: 35,
      sampleRecord: {
        first_name: 'Alice',
        last_name: 'Walker',
        email: 'alice.walker_at_invalid-domain',
        phone: '+1-555-011-3344',
      },
    },
    {
      scenarioId: 'SCENARIO-CRM1-07',
      category: 'malformed_syntax',
      description: 'Invalid phone numbers containing alphabetic characters or failing digit length checks.',
      targetEntity: 'contact',
      expectedOutcome: 'rejected',
      reasonCode: 'INVALID_PHONE',
      expectedCountIn100: 2,
      expectedCountIn1000: 25,
      sampleRecord: {
        first_name: 'Robert',
        last_name: 'Green',
        email: 'robert.green@example.org',
        phone: 'CALL-BOB-NOW-1234',
      },
    },
    {
      scenarioId: 'SCENARIO-CRM1-08',
      category: 'missing_required',
      description: 'Omitted mandatory fields: empty or pure whitespace first name or last name.',
      targetEntity: 'contact',
      expectedOutcome: 'rejected',
      reasonCode: 'EMPTY_MANDATORY_FIELD',
      expectedCountIn100: 4,
      expectedCountIn1000: 30,
      sampleRecord: {
        first_name: '   ',
        last_name: 'Montgomery',
        email: 'montgomery@example.com',
      },
    },
    {
      scenarioId: 'SCENARIO-CRM1-09',
      category: 'missing_required',
      description: 'Company records missing legal/trade name or containing only whitespace.',
      targetEntity: 'company',
      expectedOutcome: 'rejected',
      reasonCode: 'EMPTY_COMPANY_NAME',
      expectedCountIn100: 2,
      expectedCountIn1000: 20,
      sampleRecord: {
        name: '   \t  ',
        tax_number: 'US-EIN-999000111',
      },
    },
    {
      scenarioId: 'SCENARIO-CRM1-10',
      category: 'referential_orphan',
      description: 'Contacts referencing non-existent company UUIDs (foreign key restrict violation).',
      targetEntity: 'contact',
      expectedOutcome: 'rejected',
      reasonCode: 'REFERENCE_NOT_FOUND',
      expectedCountIn100: 2,
      expectedCountIn1000: 15,
      sampleRecord: {
        first_name: 'Clara',
        last_name: 'Oswald',
        email: 'clara.oswald@example.co.uk',
        company_id: '00000000-0000-0000-0000-000000000000',
      },
    },
    {
      scenarioId: 'SCENARIO-CRM1-11',
      category: 'lifecycle_violation',
      description: 'Leads with forbidden backward status transition (e.g. Qualified -> New or Closed -> Working).',
      targetEntity: 'lead',
      expectedOutcome: 'rejected',
      reasonCode: 'INVALID_LEAD_STATUS_TRANSITION',
      expectedCountIn100: 2,
      expectedCountIn1000: 10,
      sampleRecord: {
        contact_id: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
        status: 'Reopened', // Invalid status not in allowlist
      },
    },
    {
      scenarioId: 'SCENARIO-CRM1-12',
      category: 'formula_injection',
      description: 'Values starting with spreadsheet formula injection prefix characters (=, +, -, @).',
      targetEntity: 'contact',
      expectedOutcome: 'rejected',
      reasonCode: 'FORMULA_INJECTION_RISK',
      expectedCountIn100: 1,
      expectedCountIn1000: 3,
      sampleRecord: {
        first_name: '=cmd|"/C calc"!A0',
        last_name: 'VulnerabilityTest',
        email: 'injection.test@example.com',
      },
    },
    {
      scenarioId: 'SCENARIO-CRM1-13',
      category: 'encoding_boundary',
      description: 'Multilingual UTF-8 characters and maximum field length boundaries.',
      targetEntity: 'contact',
      expectedOutcome: 'rejected',
      reasonCode: 'FIELD_TOO_LONG',
      expectedCountIn100: 1,
      expectedCountIn1000: 2,
      sampleRecord: {
        first_name: 'A'.repeat(500),
        last_name: 'Schrödinger-Müller',
        email: 'schroedinger@example.de',
      },
    },
  ],
};

// =============================================================================
// 5. CONSERVATION & INVARIANT ASSERTION HELPERS
// =============================================================================

export function assertConservationEquation(
  source: number,
  loaded: number,
  rejected: number,
  merged: number,
  skipped: number
): { balanced: boolean; unaccounted: number; equation: string } {
  const accounted = loaded + rejected + merged + skipped;
  const unaccounted = source - accounted;
  return {
    balanced: unaccounted === 0,
    unaccounted,
    equation: `${source} (source) = ${loaded} (loaded) + ${rejected} (rejected) + ${merged} (merged) + ${skipped} (skipped)`,
  };
}
