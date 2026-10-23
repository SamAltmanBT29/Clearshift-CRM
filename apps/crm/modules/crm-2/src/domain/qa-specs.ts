/**
 * ClearShift CRM — CRM-2 Quality Assurance & Design Specifications
 *
 * Implements canonical QA & Data Lead specifications for CRM-2:
 * - Field-level Data Dictionary (all core tables: stages, deals, quotes, quote_lines, import_batches, receipts, rejects)
 * - Entity-Relationship Diagram (ERD) relationship metadata and cardinality
 * - Requirement-to-Test Traceability Matrix (mapping SDS §4.2 Must requirements to automated tests)
 * - Synthetic Dirty Data Pack Plan with defect distributions and conservation balance sheet
 *
 * Traceability:
 * - Issue: #137 [CRM2-24] CRM-2 Deals, Pipeline and Quotes: Data dictionary, ERD, traceability and Dirty Data Pack plan
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
    | 'formula_injection'
    | 'encoding_boundary';
  description: string;
  targetEntity: 'deal' | 'quote' | 'stage' | 'quote_line';
  expectedOutcome: 'loaded' | 'rejected' | 'merged' | 'skipped';
  reasonCode?: string;
  expectedCountIn100: number;
  expectedCountIn1000: number;
  sampleRecord: Record<string, unknown>;
}

export interface DirtyDataPackPlan {
  module: 'crm-2';
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
// 1. DATA DICTIONARY (All CRM-2 Core & Migration Tables)
// =============================================================================

export const CRM2_DATA_DICTIONARY: TableDefinition[] = [
  {
    tableName: 'crm2_stages',
    entityName: 'Stage',
    owner: 'CRM-2 (Group 2)',
    description: 'Fixed 6 sales pipeline stages. Seeded by migration, read-only at runtime.',
    columns: [
      {
        name: 'id',
        pgType: 'uuid',
        nullable: false,
        default: 'gen_random_uuid()',
        constraints: ['Primary Key'],
        businessRule: 'Immutable surrogate UUID primary key.',
        example: '11111111-1111-4000-8000-000000000001',
      },
      {
        name: 'name',
        pgType: 'text',
        nullable: false,
        default: null,
        constraints: ['crm2_stages_name_check', 'crm2_stages_name_key (UNIQUE)'],
        businessRule: 'Fixed stage name allowlist: "New", "Qualified", "Proposal", "Negotiation", "Won", "Lost".',
        example: 'Proposal',
      },
      {
        name: 'position',
        pgType: 'smallint',
        nullable: false,
        default: null,
        constraints: ['crm2_stages_position_check', 'crm2_stages_position_key (UNIQUE)'],
        businessRule: 'Display sequence integer strictly between 1 and 6.',
        example: 3,
      },
      {
        name: 'is_won',
        pgType: 'boolean',
        nullable: false,
        default: 'false',
        constraints: ['crm2_stages_won_check'],
        businessRule: 'Flag indicating successful closed deal; strictly true if and only if name = "Won".',
        example: false,
      },
    ],
    indexes: [
      'crm2_stages_name_key: UNIQUE (name)',
      'crm2_stages_position_key: UNIQUE (position)',
    ],
    checkConstraints: [
      'crm2_stages_name_check: name IN ("New", "Qualified", "Proposal", "Negotiation", "Won", "Lost")',
      'crm2_stages_position_check: position BETWEEN 1 AND 6',
      'crm2_stages_won_check: is_won = (name = "Won")',
    ],
  },
  {
    tableName: 'crm2_deals',
    entityName: 'Deal',
    owner: 'CRM-2 (Group 2)',
    description: 'Sales opportunities owned by CRM-2. Monetary amounts use decimal precision.',
    columns: [
      {
        name: 'id',
        pgType: 'uuid',
        nullable: false,
        default: 'gen_random_uuid()',
        constraints: ['Primary Key'],
        businessRule: 'Immutable surrogate UUID primary key.',
        example: 'd1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a',
      },
      {
        name: 'name',
        pgType: 'text',
        nullable: false,
        default: null,
        constraints: ['crm2_deals_name_nonempty_check'],
        businessRule: 'Deal title; trimmed length must be greater than 0 characters (max 255 chars).',
        example: 'Acme Cloud Infrastructure Expansion',
      },
      {
        name: 'contact_id',
        pgType: 'uuid',
        nullable: true,
        default: null,
        constraints: ['Indexed', 'Application Cross-Module Guard'],
        businessRule: 'Optional reference to CRM-1 contact. Nullable so orphan deals can be displayed and warned about.',
        example: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
      },
      {
        name: 'value',
        pgType: 'numeric(14,2)',
        nullable: false,
        default: null,
        constraints: ['crm2_deals_value_nonnegative_check'],
        businessRule: 'Monetary opportunity value. Non-negative decimal precision; floating point prohibited.',
        example: '45000.00',
      },
      {
        name: 'currency',
        pgType: 'text',
        nullable: false,
        default: null,
        constraints: ['crm2_deals_currency_check'],
        businessRule: 'ISO 4217 currency code: exactly 3 uppercase letters (e.g. USD, EUR, GBP, INR).',
        example: 'USD',
      },
      {
        name: 'stage_id',
        pgType: 'uuid',
        nullable: false,
        default: null,
        constraints: ['Foreign Key -> crm2_stages(id)', 'ON DELETE RESTRICT', 'Indexed'],
        businessRule: 'Mandatory reference to current stage. Cannot delete stage while referenced by deals.',
        example: '11111111-1111-4000-8000-000000000001',
      },
      {
        name: 'close_date',
        pgType: 'date',
        nullable: true,
        default: null,
        constraints: ['Indexed', 'YYYY-MM-DD date format'],
        businessRule: 'Anticipated or actual deal closing date. Form-level required in V1.',
        example: '2026-11-30',
      },
      {
        name: 'source_system',
        pgType: 'text',
        nullable: true,
        default: null,
        constraints: ['crm2_deals_source_pair_check', 'crm2_deals_source_key (UNIQUE)'],
        businessRule: 'Origin system identifier for migration ingest. Must pair with source_id.',
        example: 'pipedrive_legacy',
      },
      {
        name: 'source_id',
        pgType: 'text',
        nullable: true,
        default: null,
        constraints: ['crm2_deals_source_pair_check', 'crm2_deals_source_key (UNIQUE)'],
        businessRule: 'Primary key in legacy source system. (source_system, source_id) is unique.',
        example: 'deal_89412',
      },
      {
        name: 'created_at',
        pgType: 'timestamptz',
        nullable: false,
        default: 'now()',
        constraints: ['UTC timestamp'],
        businessRule: 'Audit timestamp set once when deal is created.',
        example: '2026-10-23T08:00:00.000Z',
      },
      {
        name: 'updated_at',
        pgType: 'timestamptz',
        nullable: false,
        default: 'now()',
        constraints: ['UTC timestamp'],
        businessRule: 'Audit timestamp refreshed on every deal mutation.',
        example: '2026-10-23T08:30:00.000Z',
      },
    ],
    indexes: [
      'crm2_deals_source_key: UNIQUE (source_system, source_id)',
      'crm2_deals_name_search_idx: INDEX (lower(name))',
      'crm2_deals_contact_id_idx: INDEX (contact_id)',
      'crm2_deals_stage_id_idx: INDEX (stage_id)',
      'crm2_deals_close_date_idx: INDEX (close_date)',
    ],
    checkConstraints: [
      'crm2_deals_name_nonempty_check: length(btrim(name)) > 0',
      'crm2_deals_value_nonnegative_check: value >= 0',
      'crm2_deals_currency_check: currency ~ "^[A-Z]{3}$"',
      'crm2_deals_source_pair_check: (source_system IS NULL AND source_id IS NULL) OR (both NOT NULL and length > 0)',
    ],
  },
  {
    tableName: 'crm2_quotes',
    entityName: 'Quote',
    owner: 'CRM-2 (Group 2)',
    description: 'Commercial quotes linked to deals. Amount is verified via decimal arithmetic.',
    columns: [
      {
        name: 'id',
        pgType: 'uuid',
        nullable: false,
        default: 'gen_random_uuid()',
        constraints: ['Primary Key'],
        businessRule: 'Immutable surrogate UUID primary key.',
        example: 'q1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c',
      },
      {
        name: 'quote_number',
        pgType: 'text',
        nullable: false,
        default: null,
        constraints: ['crm2_quotes_number_nonempty_check', 'crm2_quotes_quote_number_key (UNIQUE)'],
        businessRule: 'Unique human-readable quote reference number (e.g. Q-2026-001).',
        example: 'Q-2026-001',
      },
      {
        name: 'deal_id',
        pgType: 'uuid',
        nullable: false,
        default: null,
        constraints: ['Foreign Key -> crm2_deals(id)', 'ON DELETE RESTRICT', 'Indexed'],
        businessRule: 'Parent deal reference. Deletion of deal is restricted while linked quotes exist.',
        example: 'd1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a',
      },
      {
        name: 'quote_date',
        pgType: 'date',
        nullable: false,
        default: null,
        constraints: ['Indexed', 'YYYY-MM-DD date format'],
        businessRule: 'Issuance date of quote.',
        example: '2026-10-23',
      },
      {
        name: 'amount',
        pgType: 'numeric(14,2)',
        nullable: false,
        default: null,
        constraints: ['crm2_quotes_amount_nonnegative_check'],
        businessRule: 'Total quoted amount. Server-computed decimal precision; non-negative.',
        example: '45000.00',
      },
      {
        name: 'note',
        pgType: 'text',
        nullable: true,
        default: null,
        constraints: ['Free text'],
        businessRule: 'Optional commercial notes or payment term details.',
        example: 'Standard Net 30 payment terms with 12 months SaaS subscription.',
      },
      {
        name: 'source_system',
        pgType: 'text',
        nullable: true,
        default: null,
        constraints: ['crm2_quotes_source_pair_check', 'crm2_quotes_source_key (UNIQUE)'],
        businessRule: 'Origin system tag for migrated quotes.',
        example: 'salesforce_quotes',
      },
      {
        name: 'source_id',
        pgType: 'text',
        nullable: true,
        default: null,
        constraints: ['crm2_quotes_source_pair_check', 'crm2_quotes_source_key (UNIQUE)'],
        businessRule: 'Primary key in source system. Pair is unique.',
        example: 'sf_quote_10294',
      },
      {
        name: 'created_at',
        pgType: 'timestamptz',
        nullable: false,
        default: 'now()',
        constraints: ['UTC timestamp'],
        businessRule: 'Creation timestamp.',
        example: '2026-10-23T08:10:00.000Z',
      },
      {
        name: 'updated_at',
        pgType: 'timestamptz',
        nullable: false,
        default: 'now()',
        constraints: ['UTC timestamp'],
        businessRule: 'Last updated timestamp.',
        example: '2026-10-23T08:20:00.000Z',
      },
    ],
    indexes: [
      'crm2_quotes_quote_number_key: UNIQUE (quote_number)',
      'crm2_quotes_source_key: UNIQUE (source_system, source_id)',
      'crm2_quotes_deal_id_idx: INDEX (deal_id)',
      'crm2_quotes_quote_date_idx: INDEX (quote_date)',
    ],
    checkConstraints: [
      'crm2_quotes_number_nonempty_check: length(btrim(quote_number)) > 0',
      'crm2_quotes_amount_nonnegative_check: amount >= 0',
      'crm2_quotes_source_pair_check: (source_system IS NULL AND source_id IS NULL) OR (both NOT NULL and length > 0)',
    ],
  },
  {
    tableName: 'crm2_quote_lines',
    entityName: 'QuoteLine',
    owner: 'CRM-2 (Group 2)',
    description: 'Line items belonging to a quote. Line totals computed with decimal arithmetic.',
    columns: [
      {
        name: 'id',
        pgType: 'uuid',
        nullable: false,
        default: 'gen_random_uuid()',
        constraints: ['Primary Key'],
        businessRule: 'Immutable surrogate UUID primary key.',
        example: 'l1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c',
      },
      {
        name: 'quote_id',
        pgType: 'uuid',
        nullable: false,
        default: null,
        constraints: ['Foreign Key -> crm2_quotes(id)', 'ON DELETE CASCADE', 'Indexed'],
        businessRule: 'Parent quote. Cascade deleted if quote is removed.',
        example: 'q1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c',
      },
      {
        name: 'line_number',
        pgType: 'integer',
        nullable: false,
        default: null,
        constraints: ['crm2_quote_lines_number_check (> 0)'],
        businessRule: '1-indexed display order of line item within quote.',
        example: 1,
      },
      {
        name: 'product_id',
        pgType: 'uuid',
        nullable: true,
        default: null,
        constraints: ['Application Cross-Module Guard (ERP-1 Product)'],
        businessRule: 'Optional product catalog reference from ERP-1.',
        example: 'e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b',
      },
      {
        name: 'description',
        pgType: 'text',
        nullable: false,
        default: null,
        constraints: ['crm2_quote_lines_description_nonempty_check'],
        businessRule: 'Item description or service scope.',
        example: 'Enterprise Cloud Host Instance (Annual)',
      },
      {
        name: 'quantity',
        pgType: 'numeric(12,4)',
        nullable: false,
        default: '1.0000',
        constraints: ['crm2_quote_lines_quantity_positive_check (> 0)'],
        businessRule: 'Ordered quantity with up to 4 decimal places.',
        example: '3.0000',
      },
      {
        name: 'unit_price',
        pgType: 'numeric(14,2)',
        nullable: false,
        default: null,
        constraints: ['crm2_quote_lines_unit_price_nonnegative_check (>= 0)'],
        businessRule: 'Unit price in deal currency.',
        example: '15000.00',
      },
      {
        name: 'line_total',
        pgType: 'numeric(14,2)',
        nullable: false,
        default: null,
        constraints: ['crm2_quote_lines_line_total_nonnegative_check (>= 0)'],
        businessRule: 'Server-computed line amount: quantity * unit_price with bankers rounding.',
        example: '45000.00',
      },
      {
        name: 'created_at',
        pgType: 'timestamptz',
        nullable: false,
        default: 'now()',
        constraints: ['UTC timestamp'],
        businessRule: 'Creation timestamp.',
        example: '2026-10-23T08:15:00.000Z',
      },
      {
        name: 'updated_at',
        pgType: 'timestamptz',
        nullable: false,
        default: 'now()',
        constraints: ['UTC timestamp'],
        businessRule: 'Last update timestamp.',
        example: '2026-10-23T08:15:00.000Z',
      },
    ],
    indexes: [
      'crm2_quote_lines_quote_id_idx: INDEX (quote_id)',
      'crm2_quote_lines_quote_line_key: UNIQUE (quote_id, line_number)',
    ],
    checkConstraints: [
      'crm2_quote_lines_number_check: line_number > 0',
      'crm2_quote_lines_description_nonempty_check: length(btrim(description)) > 0',
      'crm2_quote_lines_quantity_positive_check: quantity > 0',
      'crm2_quote_lines_unit_price_nonnegative_check: unit_price >= 0',
      'crm2_quote_lines_line_total_nonnegative_check: line_total >= 0',
    ],
  },
  {
    tableName: 'crm2_import_batches',
    entityName: 'ImportBatch',
    owner: 'CRM-2 (Group 2)',
    description: 'Migration batch ledger tracking loaded and rejected counters per run.',
    columns: [
      {
        name: 'id',
        pgType: 'uuid',
        nullable: false,
        default: 'gen_random_uuid()',
        constraints: ['Primary Key'],
        businessRule: 'Surrogate UUID identifying the migration execution run.',
        example: 'b2a3c4d5-0000-4000-8000-222233334444',
      },
      {
        name: 'source_system',
        pgType: 'text',
        nullable: false,
        default: null,
        constraints: ['crm2_import_batches_source_system_nonempty_check'],
        businessRule: 'Source system name (e.g. pipedrive_deals, hubspot_deals).',
        example: 'pipedrive_deals',
      },
      {
        name: 'status',
        pgType: 'text',
        nullable: false,
        default: "'pending'",
        constraints: ['crm2_import_batches_status_check'],
        businessRule: 'Batch execution state: "pending", "processing", "completed", "failed".',
        example: 'completed',
      },
      {
        name: 'idempotency_key',
        pgType: 'text',
        nullable: true,
        default: null,
        constraints: ['crm2_import_batches_idempotency_key (UNIQUE)'],
        businessRule: 'Batch idempotency key provided by Migration Kit orchestrator.',
        example: 'mig-crm2-batch-2026-001',
      },
      {
        name: 'request_hash',
        pgType: 'text',
        nullable: true,
        default: null,
        constraints: ['crm2_import_batches_idempotency_pair_check'],
        businessRule: 'SHA-256 payload digest for detecting parameter tampering on retry.',
        example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
      {
        name: 'loaded_count',
        pgType: 'integer',
        nullable: false,
        default: '0',
        constraints: ['crm2_import_batches_loaded_count_check (>= 0)'],
        businessRule: 'Number of successfully committed business records.',
        example: 75,
      },
      {
        name: 'rejected_count',
        pgType: 'integer',
        nullable: false,
        default: '0',
        constraints: ['crm2_import_batches_rejected_count_check (>= 0)'],
        businessRule: 'Number of rejected rows with recorded reject audits.',
        example: 17,
      },
      {
        name: 'created_at',
        pgType: 'timestamptz',
        nullable: false,
        default: 'now()',
        constraints: ['UTC timestamp'],
        businessRule: 'Timestamp when batch execution began.',
        example: '2026-10-23T08:00:00.000Z',
      },
      {
        name: 'updated_at',
        pgType: 'timestamptz',
        nullable: false,
        default: 'now()',
        constraints: ['UTC timestamp'],
        businessRule: 'Timestamp when batch was last mutated.',
        example: '2026-10-23T08:02:15.000Z',
      },
      {
        name: 'completed_at',
        pgType: 'timestamptz',
        nullable: true,
        default: null,
        constraints: ['Set upon terminal state'],
        businessRule: 'Timestamp when batch reached terminal status.',
        example: '2026-10-23T08:02:15.000Z',
      },
    ],
    indexes: [
      'crm2_import_batches_idempotency_key: UNIQUE (idempotency_key)',
      'crm2_import_batches_created_at_idx: INDEX (created_at)',
    ],
    checkConstraints: [
      'crm2_import_batches_source_system_nonempty_check: length(btrim(source_system)) > 0',
      'crm2_import_batches_status_check: status IN ("pending", "processing", "completed", "failed")',
      'crm2_import_batches_idempotency_pair_check: (idempotency_key IS NULL AND request_hash IS NULL) OR (both NOT NULL and length > 0)',
      'crm2_import_batches_loaded_count_check: loaded_count >= 0',
      'crm2_import_batches_rejected_count_check: rejected_count >= 0',
    ],
  },
  {
    tableName: 'crm2_import_receipts',
    entityName: 'ImportReceipt',
    owner: 'CRM-2 (Group 2)',
    description: 'Durable receipts written atomically with target records. Enforces per-row idempotency.',
    columns: [
      {
        name: 'id',
        pgType: 'uuid',
        nullable: false,
        default: 'gen_random_uuid()',
        constraints: ['Primary Key'],
        businessRule: 'Surrogate UUID for the receipt.',
        example: 'r2e3f4a5-b6c7-4d8e-9f0a-1b2c3d4e5f6a',
      },
      {
        name: 'batch_id',
        pgType: 'uuid',
        nullable: false,
        default: null,
        constraints: ['Foreign Key -> crm2_import_batches(id)', 'ON DELETE CASCADE'],
        businessRule: 'Owning migration batch. Cascade-deleted if batch record is purged.',
        example: 'b2a3c4d5-0000-4000-8000-222233334444',
      },
      {
        name: 'source_row',
        pgType: 'integer',
        nullable: false,
        default: null,
        constraints: ['crm2_import_receipts_source_row_check (> 0)'],
        businessRule: '1-indexed source row number in raw upload file.',
        example: 12,
      },
      {
        name: 'entity',
        pgType: 'text',
        nullable: false,
        default: null,
        constraints: ['crm2_import_receipts_entity_check'],
        businessRule: 'Target entity type: "deal", "quote", "stage", or "quote_line".',
        example: 'deal',
      },
      {
        name: 'source_system',
        pgType: 'text',
        nullable: false,
        default: null,
        constraints: ['crm2_import_receipts_source_system_nonempty_check'],
        businessRule: 'Origin legacy system tag.',
        example: 'csv_upload_deals',
      },
      {
        name: 'source_id',
        pgType: 'text',
        nullable: false,
        default: null,
        constraints: ['crm2_import_receipts_source_id_nonempty_check'],
        businessRule: 'Legacy primary key or synthetic row key.',
        example: 'row_deal_12',
      },
      {
        name: 'target_id',
        pgType: 'uuid',
        nullable: false,
        default: null,
        constraints: ['Indexed'],
        businessRule: 'UUID of committed target domain record (deal, quote, stage, quote_line).',
        example: 'd1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a',
      },
      {
        name: 'idempotency_key',
        pgType: 'text',
        nullable: false,
        default: null,
        constraints: ['crm2_import_receipts_idempotency_key (UNIQUE)', 'crm2_import_receipts_idempotency_key_nonempty_check'],
        businessRule: 'Deterministic key: `${batchId}:${sourceRow}:${entity}`. Guarantees idempotent retries.',
        example: 'b2a3c4d5-0000-4000-8000-222233334444:12:deal',
      },
      {
        name: 'created_at',
        pgType: 'timestamptz',
        nullable: false,
        default: 'now()',
        constraints: ['UTC timestamp'],
        businessRule: 'Timestamp when receipt and target mutation committed together.',
        example: '2026-10-23T08:01:00.000Z',
      },
    ],
    indexes: [
      'crm2_import_receipts_idempotency_key: UNIQUE (idempotency_key)',
      'crm2_import_receipts_batch_row_entity_key: UNIQUE (batch_id, source_row, entity)',
      'crm2_import_receipts_target_id_idx: INDEX (target_id)',
    ],
    checkConstraints: [
      'crm2_import_receipts_source_row_check: source_row > 0',
      'crm2_import_receipts_entity_check: entity IN ("deal", "quote", "stage", "quote_line")',
      'crm2_import_receipts_source_system_nonempty_check: length(btrim(source_system)) > 0',
      'crm2_import_receipts_source_id_nonempty_check: length(btrim(source_id)) > 0',
      'crm2_import_receipts_idempotency_key_nonempty_check: length(btrim(idempotency_key)) > 0',
    ],
  },
  {
    tableName: 'crm2_import_rejects',
    entityName: 'ImportReject',
    owner: 'CRM-2 (Group 2)',
    description: 'Audit log of rejected source rows with structured reason codes and privacy-safe messages.',
    columns: [
      {
        name: 'id',
        pgType: 'uuid',
        nullable: false,
        default: 'gen_random_uuid()',
        constraints: ['Primary Key'],
        businessRule: 'Surrogate UUID for the reject record.',
        example: 'j2a3b4c5-d6e7-4f8a-9b0c-1d2e3f4a5b6c',
      },
      {
        name: 'batch_id',
        pgType: 'uuid',
        nullable: false,
        default: null,
        constraints: ['Foreign Key -> crm2_import_batches(id)', 'ON DELETE CASCADE', 'Indexed'],
        businessRule: 'Owning migration batch identifier.',
        example: 'b2a3c4d5-0000-4000-8000-222233334444',
      },
      {
        name: 'source_row',
        pgType: 'integer',
        nullable: false,
        default: null,
        constraints: ['crm2_import_rejects_source_row_check (> 0)'],
        businessRule: '1-indexed source row number in raw file.',
        example: 33,
      },
      {
        name: 'entity',
        pgType: 'text',
        nullable: false,
        default: null,
        constraints: ['crm2_import_rejects_entity_check'],
        businessRule: 'Attempted target entity: "deal", "quote", "stage", or "quote_line".',
        example: 'deal',
      },
      {
        name: 'reason_code',
        pgType: 'text',
        nullable: false,
        default: null,
        constraints: ['crm2_import_rejects_reason_code_nonempty_check'],
        businessRule: 'Stable machine-readable reject code (e.g. NEGATIVE_VALUE, INVALID_CURRENCY, INVALID_STAGE).',
        example: 'NEGATIVE_VALUE',
      },
      {
        name: 'message',
        pgType: 'text',
        nullable: false,
        default: null,
        constraints: ['crm2_import_rejects_message_nonempty_check'],
        businessRule: 'Privacy-safe, non-sensitive explanation of rejection cause.',
        example: 'Deal monetary value must be a non-negative decimal quantity',
      },
      {
        name: 'created_at',
        pgType: 'timestamptz',
        nullable: false,
        default: 'now()',
        constraints: ['UTC timestamp'],
        businessRule: 'Timestamp when reject audit was stored.',
        example: '2026-10-23T08:01:10.000Z',
      },
    ],
    indexes: ['crm2_import_rejects_batch_id_idx: INDEX (batch_id)'],
    checkConstraints: [
      'crm2_import_rejects_source_row_check: source_row > 0',
      'crm2_import_rejects_entity_check: entity IN ("deal", "quote", "stage", "quote_line")',
      'crm2_import_rejects_reason_code_nonempty_check: length(btrim(reason_code)) > 0',
      'crm2_import_rejects_message_nonempty_check: length(btrim(message)) > 0',
    ],
  },
];

// =============================================================================
// 2. ERD RELATIONSHIPS & CARDINALITY (Primary Keys, Foreign Keys, Boundaries)
// =============================================================================

export const CRM2_ERD_RELATIONSHIPS: RelationshipDefinition[] = [
  {
    relationshipId: 'REL-CRM2-01',
    fromTable: 'crm2_deals',
    fromColumn: 'stage_id',
    toTable: 'crm2_stages',
    toColumn: 'id',
    cardinality: 'N:1',
    onDelete: 'RESTRICT',
    enforcement: 'Database Foreign Key',
    description: 'Deals must belong to one of 6 fixed stages. Deletion of stage is restricted while deals exist.',
  },
  {
    relationshipId: 'REL-CRM2-02',
    fromTable: 'crm2_quotes',
    fromColumn: 'deal_id',
    toTable: 'crm2_deals',
    toColumn: 'id',
    cardinality: 'N:1',
    onDelete: 'RESTRICT',
    enforcement: 'Database Foreign Key',
    description: 'Quotes must belong to an existing Deal. Deletion of deal is restricted while quotes exist.',
  },
  {
    relationshipId: 'REL-CRM2-03',
    fromTable: 'crm2_quote_lines',
    fromColumn: 'quote_id',
    toTable: 'crm2_quotes',
    toColumn: 'id',
    cardinality: 'N:1',
    onDelete: 'CASCADE',
    enforcement: 'Database Foreign Key',
    description: 'Quote lines belong to a parent Quote; cascade deleted if the quote is removed.',
  },
  {
    relationshipId: 'REL-CRM2-04',
    fromTable: 'crm2_deals',
    fromColumn: 'contact_id',
    toTable: 'crm1_contacts',
    toColumn: 'id',
    cardinality: 'N:1',
    onDelete: 'RESTRICT',
    enforcement: 'Domain Application Guard',
    description: 'Deals optionally reference a CRM-1 contact. No cross-schema foreign key (PLT-03); orphan deals are allowed and visibly flagged.',
  },
  {
    relationshipId: 'REL-CRM2-05',
    fromTable: 'crm2_quote_lines',
    fromColumn: 'product_id',
    toTable: 'erp1_products',
    toColumn: 'id',
    cardinality: 'N:1',
    onDelete: 'RESTRICT',
    enforcement: 'Domain Application Guard',
    description: 'Quote line items optionally reference products via ERP-1 catalog API. No direct cross-module database writes.',
  },
  {
    relationshipId: 'REL-CRM2-06',
    fromTable: 'crm2_import_receipts',
    fromColumn: 'batch_id',
    toTable: 'crm2_import_batches',
    toColumn: 'id',
    cardinality: 'N:1',
    onDelete: 'CASCADE',
    enforcement: 'Database Foreign Key',
    description: 'Per-row import receipts belong to an Import Batch; cascade deleted if batch is purged.',
  },
  {
    relationshipId: 'REL-CRM2-07',
    fromTable: 'crm2_import_rejects',
    fromColumn: 'batch_id',
    toTable: 'crm2_import_batches',
    toColumn: 'id',
    cardinality: 'N:1',
    onDelete: 'CASCADE',
    enforcement: 'Database Foreign Key',
    description: 'Row-level rejections belong to an Import Batch; cascade deleted if batch is purged.',
  },
  {
    relationshipId: 'REL-CRM2-08',
    fromTable: 'crm2_import_receipts',
    fromColumn: 'target_id',
    toTable: 'crm2_deals / crm2_quotes / crm2_stages / crm2_quote_lines',
    toColumn: 'id',
    cardinality: 'N:1',
    onDelete: 'RESTRICT',
    enforcement: 'Domain Application Guard',
    description: 'Polymorphic target record reference recorded at transaction commit time without cross-table foreign key.',
  },
];

// =============================================================================
// 3. REQUIREMENT-TO-TEST TRACEABILITY MATRIX (SDS §4.2 Must Requirements)
// =============================================================================

export const CRM2_TRACEABILITY_MATRIX: TraceabilityEntry[] = [
  {
    reqId: 'FR-CRM2-01',
    requirement: 'Show paginated deals list with search by name, stage filtering, and bounded pagination (25 per page, max 100).',
    priority: 'Must',
    sourceDoc: 'SDS ClearShift CRM v2.0 §4.2',
    category: 'API',
    testType: 'contract',
    testFile: 'apps/crm/modules/crm-2/tests/api/crm2-routes.test.ts',
    testSuite: 'CRM-2 List/Read API & Contracts (Issue #17 / [CRM2-02])',
    verificationEvidence: 'GET /deals returns paginated deals with items array, pagination metadata (page, limit, total), and stage filter.',
  },
  {
    reqId: 'FR-CRM2-02',
    requirement: 'Create and edit deal: name, monetary value (decimal arithmetic), currency (ISO-4217), stage, close date, optional contact link.',
    priority: 'Must',
    sourceDoc: 'SDS ClearShift CRM v2.0 §4.2',
    category: 'API',
    testType: 'regression',
    testFile: 'apps/crm/modules/crm-2/tests/api/crm2-routes.test.ts',
    testSuite: 'CRM-2 Mutation API & Domain Validation (Issue #18 / [CRM2-03])',
    verificationEvidence: 'POST /deals validates non-empty name, non-negative decimal value, 3-letter currency; PATCH /deals/:id updates mutable fields.',
  },
  {
    reqId: 'FR-CRM2-03',
    requirement: 'Enforce strict 6-stage sales pipeline state transitions: New -> Qualified -> Proposal -> Negotiation -> Won; active stages can transition to Lost; Won and Lost are terminal.',
    priority: 'Must',
    sourceDoc: 'SDS ClearShift CRM v2.0 §4.2 & Master Architecture Spec',
    category: 'Domain',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-2/tests/domain/relationships.test.ts',
    testSuite: 'CRM-2 Relationships & State Transitions (Issue #21 / [CRM2-06])',
    verificationEvidence: 'assertDealStageTransition validates legal forward moves; backward or skip transitions throw INVALID_DEAL_STAGE_TRANSITION (422).',
  },
  {
    reqId: 'FR-CRM2-04',
    requirement: 'Allow orphan deals with nullable contact_id; render visible orphan warning in UI without silently hiding records.',
    priority: 'Must',
    sourceDoc: 'SDS ClearShift CRM v2.0 §4.2',
    category: 'Web',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-2/web/tests/deals-table.test.ts',
    testSuite: 'CRM-2 Deals List Screen & Table (Issue #19 / [CRM2-04])',
    verificationEvidence: 'Orphan badge displayed when contact_id is null; table rows remain accessible and searchable.',
  },
  {
    reqId: 'FR-CRM2-05',
    requirement: 'Create, read, and manage quotes linked to deals: unique quote_number, quote_date, amount, currency, note, deal link.',
    priority: 'Must',
    sourceDoc: 'SDS ClearShift CRM v2.0 §4.2',
    category: 'API',
    testType: 'contract',
    testFile: 'apps/crm/modules/crm-2/tests/api/crm2-routes.test.ts',
    testSuite: 'CRM-2 List/Read API & Contracts',
    verificationEvidence: 'POST /quotes creates quote with deal linkage; unique index rejects duplicate quote numbers with HTTP 409.',
  },
  {
    reqId: 'FR-CRM2-06',
    requirement: 'Calculate quote totals and deal sums using server-computed decimal arithmetic (NUMERIC 14,2); never IEEE-754 floats.',
    priority: 'Must',
    sourceDoc: 'ClearShift Core Rules & SDS §4.2',
    category: 'Domain',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-2/tests/domain/relationships.test.ts',
    testSuite: 'CRM-2 Relationships & Domain Invariants',
    verificationEvidence: 'Monetary sums maintain exact decimal precision without floating point roundoff errors.',
  },
  {
    reqId: 'FR-CRM2-07',
    requirement: 'Provide fixed stage seed dataset (New, Qualified, Proposal, Negotiation, Won, Lost); runtime stage renaming and deletion are rejected.',
    priority: 'Must',
    sourceDoc: 'SDS ClearShift CRM v2.0 §4.2',
    category: 'Database',
    testType: 'schema',
    testFile: 'apps/crm/modules/crm-2/tests/schema.test.sql',
    testSuite: 'CRM-2 Schema & Guarded Migrations (Issue #16 / [CRM2-01])',
    verificationEvidence: 'SQL schema checks and constraints reject custom stage additions or modifications.',
  },
  {
    reqId: 'FR-CRM2-08',
    requirement: 'Emit deal.won domain event through transactional outbox with approved event contract when deal reaches Won stage.',
    priority: 'Must',
    sourceDoc: 'SDS ClearShift CRM v2.0 §8 & Project Plan §8',
    category: 'Domain',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-2/tests/domain/relationships.test.ts',
    testSuite: 'CRM-2 Won Event Schema & Contracts',
    verificationEvidence: 'Event payload conforms to contract with dealId, customerId, amount, currency, and correlationId.',
  },
  {
    reqId: 'BR-CRM2-DUP-01',
    requirement: 'Deterministic deal duplicate candidate key based on normalized source_system + source_id.',
    priority: 'Must',
    sourceDoc: 'SDS v2.0 §4.11 & Master Architecture Spec',
    category: 'Domain',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-2/tests/domain/relationships.test.ts',
    testSuite: 'CRM-2 Deduplication & Exact Keys',
    verificationEvidence: 'Pair uniqueness enforced at database and application layer; identical pairs resolve to single master record.',
  },
  {
    reqId: 'BR-CRM2-DUP-02',
    requirement: 'Deterministic deal business duplicate candidate key: ${normalizedName}#${stageId}#${contactId || "orphan"}. No fuzzy matching.',
    priority: 'Must',
    sourceDoc: 'ClearShift Core Rules & SDS §4.11',
    category: 'Domain',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-2/tests/domain/relationships.test.ts',
    testSuite: 'CRM-2 Deduplication & Exact Keys',
    verificationEvidence: 'Exact normalized key identifies duplicate deals for explicit human review; zero fuzzy auto-merge.',
  },
  {
    reqId: 'BR-CRM2-DUP-03',
    requirement: 'Quote unique key normalization: quote_number trimmed and uppercase.',
    priority: 'Must',
    sourceDoc: 'SDS ClearShift CRM v2.0 §4.2',
    category: 'Domain',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-2/tests/domain/relationships.test.ts',
    testSuite: 'CRM-2 Deduplication & Exact Keys',
    verificationEvidence: 'Database unique constraint crm2_quotes_quote_number_key guarantees quote uniqueness.',
  },
  {
    reqId: 'MIG-CRM2-01',
    requirement: 'Target domain mutation and migration import receipt commit together in one local database transaction.',
    priority: 'Must',
    sourceDoc: 'ClearShift Core Migration Rules & KIT-08',
    category: 'Migration',
    testType: 'integration',
    testFile: 'apps/crm/modules/crm-2/tests/api/crm2-routes.test.ts',
    testSuite: 'CRM-2 Target Adapter & Durable Receipts (Issue #22 / [CRM2-07])',
    verificationEvidence: 'Transaction rollbacks abort both target mutation and receipt; successful imports store durable receipt with targetId.',
  },
  {
    reqId: 'MIG-CRM2-02',
    requirement: 'Row conservation balance sheet: source = loaded + rejected + merged + skipped (unaccounted = 0).',
    priority: 'Must',
    sourceDoc: 'ClearShift Core Migration Rules',
    category: 'Migration',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-2/tests/domain/qa-g1-design.test.ts',
    testSuite: 'CRM-2 QA Gate G1 Design Specifications',
    verificationEvidence: 'Conservation arithmetic asserts 0 unaccounted rows across all migration test runs.',
  },
  {
    reqId: 'MIG-CRM2-03',
    requirement: 'Stop migration execution when failure count exceeds 10% of attempted rows in a batch.',
    priority: 'Must',
    sourceDoc: 'ClearShift Core Migration Rules',
    category: 'Migration',
    testType: 'unit',
    testFile: 'apps/crm/modules/crm-2/tests/domain/qa-g1-design.test.ts',
    testSuite: 'CRM-2 QA Gate G1 Design Specifications',
    verificationEvidence: 'Failure threshold trigger safely halts batch processing, preserving already-committed receipts.',
  },
];

// =============================================================================
// 4. DIRTY DATA PACK PLAN (100-Row Module Pack & 1,000-Row Canonical Pack)
// =============================================================================

export const CRM2_DIRTY_DATA_PACK_PLAN: DirtyDataPackPlan = {
  module: 'crm-2',
  targetEntities: ['crm2_stages', 'crm2_deals', 'crm2_quotes', 'crm2_quote_lines'],
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
    expectedLoaded: 75,
    expectedRejected: 17,
    expectedMerged: 8, // 8 duplicate candidate rows merged into 4 target records
    expectedSkipped: 0,
    unaccounted: 0,
  },
  scenarios: [
    {
      scenarioId: 'SCENARIO-CRM2-01',
      category: 'golden_baseline',
      description: 'Clean, syntactically valid deals with positive decimal values, valid ISO currency, and valid stage.',
      targetEntity: 'deal',
      expectedOutcome: 'loaded',
      expectedCountIn100: 55,
      expectedCountIn1000: 620,
      sampleRecord: {
        name: 'Enterprise Cloud Migration Package',
        contact_id: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
        value: '75000.00',
        currency: 'USD',
        stage: 'Proposal',
        close_date: '2026-11-15',
      },
    },
    {
      scenarioId: 'SCENARIO-CRM2-02',
      category: 'golden_baseline',
      description: 'Clean orphan deals with null contact_id, valid amount, and valid stage.',
      targetEntity: 'deal',
      expectedOutcome: 'loaded',
      expectedCountIn100: 10,
      expectedCountIn1000: 80,
      sampleRecord: {
        name: 'Inbound Web Deal (Unassigned Contact)',
        contact_id: null,
        value: '12500.00',
        currency: 'EUR',
        stage: 'New',
        close_date: '2026-12-01',
      },
    },
    {
      scenarioId: 'SCENARIO-CRM2-03',
      category: 'golden_baseline',
      description: 'Clean quotes linked to existing deals with valid quote numbers and non-negative amounts.',
      targetEntity: 'quote',
      expectedOutcome: 'loaded',
      expectedCountIn100: 10,
      expectedCountIn1000: 80,
      sampleRecord: {
        quote_number: 'Q-2026-8801',
        deal_id: 'd1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a',
        quote_date: '2026-10-23',
        amount: '75000.00',
        note: 'Fixed pricing valid for 30 calendar days.',
      },
    },
    {
      scenarioId: 'SCENARIO-CRM2-04',
      category: 'exact_duplicate',
      description: 'Exact duplicate deals matching by name, stage, and contact_id for human review.',
      targetEntity: 'deal',
      expectedOutcome: 'merged',
      reasonCode: 'EXACT_DEAL_DUPLICATE',
      expectedCountIn100: 4, // 2 duplicate pairs
      expectedCountIn1000: 40, // 20 duplicate pairs
      sampleRecord: {
        name: '  Enterprise Cloud Migration Package  ',
        contact_id: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
        value: '75000.00',
        currency: 'USD',
        stage: 'Proposal',
      },
    },
    {
      scenarioId: 'SCENARIO-CRM2-05',
      category: 'exact_duplicate',
      description: 'Exact duplicate quote numbers submitted in batch upload.',
      targetEntity: 'quote',
      expectedOutcome: 'merged',
      reasonCode: 'EXACT_QUOTE_NUMBER_MATCH',
      expectedCountIn100: 4, // 2 duplicate pairs
      expectedCountIn1000: 40, // 20 duplicate pairs
      sampleRecord: {
        quote_number: 'Q-2026-8801',
        deal_id: 'd1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a',
        amount: '75000.00',
      },
    },
    {
      scenarioId: 'SCENARIO-CRM2-06',
      category: 'malformed_syntax',
      description: 'Deals with negative monetary values violating non-negative domain invariant.',
      targetEntity: 'deal',
      expectedOutcome: 'rejected',
      reasonCode: 'NEGATIVE_VALUE',
      expectedCountIn100: 3,
      expectedCountIn1000: 25,
      sampleRecord: {
        name: 'Corrupted Legacy Opportunity',
        value: '-1500.00',
        currency: 'USD',
        stage: 'New',
      },
    },
    {
      scenarioId: 'SCENARIO-CRM2-07',
      category: 'malformed_syntax',
      description: 'Invalid ISO 4217 currency format (non-3-letter, lowercase, or numeric string).',
      targetEntity: 'deal',
      expectedOutcome: 'rejected',
      reasonCode: 'INVALID_CURRENCY',
      expectedCountIn100: 3,
      expectedCountIn1000: 25,
      sampleRecord: {
        name: 'European Distributor Expansion',
        value: '30000.00',
        currency: 'euros',
        stage: 'Qualified',
      },
    },
    {
      scenarioId: 'SCENARIO-CRM2-08',
      category: 'missing_required',
      description: 'Deals missing required name field (blank, null, or whitespace-only).',
      targetEntity: 'deal',
      expectedOutcome: 'rejected',
      reasonCode: 'EMPTY_MANDATORY_FIELD',
      expectedCountIn100: 3,
      expectedCountIn1000: 25,
      sampleRecord: {
        name: '   ',
        value: '5000.00',
        currency: 'USD',
        stage: 'New',
      },
    },
    {
      scenarioId: 'SCENARIO-CRM2-09',
      category: 'lifecycle_violation',
      description: 'Deals specifying unapproved or non-existent pipeline stages (e.g. "Draft", "In Review", "Cancelled").',
      targetEntity: 'deal',
      expectedOutcome: 'rejected',
      reasonCode: 'INVALID_STAGE',
      expectedCountIn100: 3,
      expectedCountIn1000: 25,
      sampleRecord: {
        name: 'Custom Pipeline Deal',
        value: '10000.00',
        currency: 'USD',
        stage: 'Under Contract',
      },
    },
    {
      scenarioId: 'SCENARIO-CRM2-10',
      category: 'malformed_syntax',
      description: 'Malformed close dates that fail ISO YYYY-MM-DD parsing (e.g. US date formats or arbitrary text).',
      targetEntity: 'deal',
      expectedOutcome: 'rejected',
      reasonCode: 'INVALID_DATE_FORMAT',
      expectedCountIn100: 3,
      expectedCountIn1000: 20,
      sampleRecord: {
        name: 'Legacy Deal with Broken Date',
        value: '18000.00',
        currency: 'USD',
        stage: 'Proposal',
        close_date: '31/12/2026',
      },
    },
    {
      scenarioId: 'SCENARIO-CRM2-11',
      category: 'referential_orphan',
      description: 'Quotes referencing a parent deal_id that does not exist in target database.',
      targetEntity: 'quote',
      expectedOutcome: 'rejected',
      reasonCode: 'PARENT_DEAL_NOT_FOUND',
      expectedCountIn100: 2,
      expectedCountIn1000: 20,
      sampleRecord: {
        quote_number: 'Q-2026-9999',
        deal_id: '00000000-0000-0000-0000-000000000000',
        quote_date: '2026-10-23',
        amount: '12000.00',
      },
    },
  ],
};

// =============================================================================
// 5. HELPER FUNCTIONS: Deduplication Keys & Conservation Formula Validation
// =============================================================================

export interface ConservationEquationResult {
  valid: boolean;
  sourceCount: number;
  terminalSum: number;
  unaccounted: number;
  breakdown: {
    loaded: number;
    rejected: number;
    merged: number;
    skipped: number;
  };
}

/**
 * Asserts the ClearShift migration conservation balance sheet equation:
 * source = loaded + rejected + merged + skipped AND unaccounted = 0
 */
export function assertConservationEquation(counts: {
  sourceCount: number;
  loadedCount: number;
  rejectedCount: number;
  mergedCount: number;
  skippedCount: number;
}): ConservationEquationResult {
  const terminalSum =
    counts.loadedCount + counts.rejectedCount + counts.mergedCount + counts.skippedCount;
  const unaccounted = counts.sourceCount - terminalSum;

  return {
    valid: unaccounted === 0,
    sourceCount: counts.sourceCount,
    terminalSum,
    unaccounted,
    breakdown: {
      loaded: counts.loadedCount,
      rejected: counts.rejectedCount,
      merged: counts.mergedCount,
      skipped: counts.skippedCount,
    },
  };
}

/**
 * Normalizes a deal business duplicate key:
 * ${trimmedDealName}#${stageId}#${contactId || 'orphan'}
 */
export function buildDealExactBusinessKey(deal: {
  name: string;
  stageId: string;
  contactId?: string | null;
}): string {
  const normName = deal.name.trim().toLowerCase().replace(/\s+/g, ' ');
  const contact = deal.contactId?.trim().toLowerCase() || 'orphan';
  return `${normName}#${deal.stageId.trim().toLowerCase()}#${contact}`;
}

/**
 * Normalizes quote unique reference:
 * Trimmed uppercase quote number
 */
export function buildQuoteExactKey(quoteNumber: string): string {
  return quoteNumber.trim().toUpperCase();
}
