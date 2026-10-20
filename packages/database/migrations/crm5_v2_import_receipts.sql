-- ClearShift CRM — CRM-5 Migration Import Receipts Schema
-- Version: v1.1.0 (Forward-only, idempotent migration for PostgreSQL 18+)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 5. Migration Import Receipts (Decision C4 & KIT-08)
CREATE TABLE IF NOT EXISTS public.crm5_import_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id VARCHAR(128) NOT NULL,
    source_row INTEGER NOT NULL,
    source_system VARCHAR(64),
    source_id VARCHAR(128),
    entity VARCHAR(64) NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    idempotency_key VARCHAR(256) NOT NULL,
    payload_hash VARCHAR(64) NOT NULL,
    target_id UUID NOT NULL,
    kind VARCHAR(32) NOT NULL DEFAULT 'created',
    outcome VARCHAR(32) NOT NULL DEFAULT 'created',
    response_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_crm5_receipts_source_row CHECK (source_row >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm5_receipts_idempotency_key ON public.crm5_import_receipts(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_crm5_receipts_batch_row ON public.crm5_import_receipts(batch_id, source_row);
CREATE INDEX IF NOT EXISTS idx_crm5_receipts_target_id ON public.crm5_import_receipts(target_id);
