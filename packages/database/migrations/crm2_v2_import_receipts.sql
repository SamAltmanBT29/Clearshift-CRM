-- ClearShift CRM — CRM-2 Migration Import Receipts & Quote Lines Schema
-- Version: v1.1.0 (Forward-only, idempotent migration for PostgreSQL 18+)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE SCHEMA IF NOT EXISTS crm2;

-- 1. Quote Lines
CREATE TABLE IF NOT EXISTS crm2.crm2_quote_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id UUID NOT NULL REFERENCES crm2.crm2_quotes(id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    product_id UUID,
    description TEXT NOT NULL,
    quantity NUMERIC(12, 4) NOT NULL DEFAULT 1.0000,
    unit_price NUMERIC(14, 2) NOT NULL,
    line_total NUMERIC(14, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT crm2_quote_lines_number_check CHECK (line_number > 0),
    CONSTRAINT crm2_quote_lines_description_nonempty_check CHECK (length(btrim(description)) > 0),
    CONSTRAINT crm2_quote_lines_quantity_positive_check CHECK (quantity > 0),
    CONSTRAINT crm2_quote_lines_unit_price_nonnegative_check CHECK (unit_price >= 0),
    CONSTRAINT crm2_quote_lines_line_total_nonnegative_check CHECK (line_total >= 0),
    CONSTRAINT crm2_quote_lines_quote_line_key UNIQUE (quote_id, line_number)
);

CREATE INDEX IF NOT EXISTS crm2_quote_lines_quote_id_idx ON crm2.crm2_quote_lines (quote_id);

-- 2. Migration Import Batches
CREATE TABLE IF NOT EXISTS crm2.crm2_import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_system TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    idempotency_key TEXT,
    request_hash TEXT,
    loaded_count INTEGER NOT NULL DEFAULT 0,
    rejected_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT crm2_import_batches_source_system_nonempty_check CHECK (length(btrim(source_system)) > 0),
    CONSTRAINT crm2_import_batches_status_check CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    CONSTRAINT crm2_import_batches_idempotency_pair_check CHECK (
      (idempotency_key IS NULL AND request_hash IS NULL) OR
      (idempotency_key IS NOT NULL AND length(btrim(idempotency_key)) > 0 AND
       request_hash IS NOT NULL AND length(btrim(request_hash)) > 0)
    ),
    CONSTRAINT crm2_import_batches_loaded_count_check CHECK (loaded_count >= 0),
    CONSTRAINT crm2_import_batches_rejected_count_check CHECK (rejected_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS crm2_import_batches_idempotency_key ON crm2.crm2_import_batches (idempotency_key);
CREATE INDEX IF NOT EXISTS crm2_import_batches_created_at_idx ON crm2.crm2_import_batches (created_at);

-- 3. Migration Import Receipts (Decision C4 & KIT-08)
CREATE TABLE IF NOT EXISTS crm2.crm2_import_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES crm2.crm2_import_batches(id) ON DELETE CASCADE,
    source_row INTEGER NOT NULL,
    entity TEXT NOT NULL,
    source_system TEXT NOT NULL,
    source_id TEXT NOT NULL,
    target_id UUID NOT NULL,
    idempotency_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT crm2_import_receipts_source_row_check CHECK (source_row > 0),
    CONSTRAINT crm2_import_receipts_entity_check CHECK (entity IN ('deal', 'quote', 'stage', 'quote_line')),
    CONSTRAINT crm2_import_receipts_source_system_nonempty_check CHECK (length(btrim(source_system)) > 0),
    CONSTRAINT crm2_import_receipts_source_id_nonempty_check CHECK (length(btrim(source_id)) > 0),
    CONSTRAINT crm2_import_receipts_idempotency_key_nonempty_check CHECK (length(btrim(idempotency_key)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS crm2_import_receipts_idempotency_key ON crm2.crm2_import_receipts (idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS crm2_import_receipts_batch_row_entity_key ON crm2.crm2_import_receipts (batch_id, source_row, entity);
CREATE INDEX IF NOT EXISTS crm2_import_receipts_target_id_idx ON crm2.crm2_import_receipts (target_id);

-- 4. Migration Import Rejects
CREATE TABLE IF NOT EXISTS crm2.crm2_import_rejects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES crm2.crm2_import_batches(id) ON DELETE CASCADE,
    source_row INTEGER NOT NULL,
    entity TEXT NOT NULL,
    source_system TEXT NOT NULL,
    source_id TEXT,
    reason_code TEXT NOT NULL,
    message TEXT NOT NULL,
    field TEXT,
    raw_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT crm2_import_rejects_source_row_check CHECK (source_row > 0),
    CONSTRAINT crm2_import_rejects_entity_check CHECK (entity IN ('deal', 'quote', 'stage', 'quote_line')),
    CONSTRAINT crm2_import_rejects_source_system_nonempty_check CHECK (length(btrim(source_system)) > 0),
    CONSTRAINT crm2_import_rejects_reason_code_nonempty_check CHECK (length(btrim(reason_code)) > 0),
    CONSTRAINT crm2_import_rejects_message_nonempty_check CHECK (length(btrim(message)) > 0)
);

CREATE INDEX IF NOT EXISTS crm2_import_rejects_batch_id_idx ON crm2.crm2_import_rejects (batch_id);
