-- ClearShift CRM — CRM-5 Migration Control Center & Reports Schema
-- Version: v1.0.0
-- Forward-only, idempotent migration for PostgreSQL 18+

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Migration Run Projections
CREATE TABLE IF NOT EXISTS public.crm5_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id VARCHAR(128) NOT NULL,
    module VARCHAR(64) NOT NULL,
    step VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    records_in INTEGER NOT NULL DEFAULT 0,
    records_out INTEGER NOT NULL DEFAULT 0,
    records_rejected INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_crm5_runs_records_in CHECK (records_in >= 0),
    CONSTRAINT chk_crm5_runs_records_out CHECK (records_out >= 0),
    CONSTRAINT chk_crm5_runs_records_rejected CHECK (records_rejected >= 0),
    CONSTRAINT chk_crm5_runs_status CHECK (status IN ('pending', 'running', 'completed', 'failed', 'halted'))
);

CREATE INDEX IF NOT EXISTS idx_crm5_runs_batch_id ON public.crm5_runs(batch_id);
CREATE INDEX IF NOT EXISTS idx_crm5_runs_module ON public.crm5_runs(module);

-- 2. Data Quality Scores
CREATE TABLE IF NOT EXISTS public.crm5_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id VARCHAR(128) NOT NULL,
    module VARCHAR(64) NOT NULL,
    completeness NUMERIC(5, 4),
    validity NUMERIC(5, 4),
    duplicate_rate NUMERIC(5, 4),
    reject_rate NUMERIC(5, 4),
    link_integrity NUMERIC(5, 4),
    score NUMERIC(5, 2),
    is_fully_scored BOOLEAN NOT NULL DEFAULT false,
    scored_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_crm5_scores_completeness CHECK (completeness IS NULL OR (completeness >= 0 AND completeness <= 1)),
    CONSTRAINT chk_crm5_scores_validity CHECK (validity IS NULL OR (validity >= 0 AND validity <= 1)),
    CONSTRAINT chk_crm5_scores_duplicate_rate CHECK (duplicate_rate IS NULL OR (duplicate_rate >= 0 AND duplicate_rate <= 1)),
    CONSTRAINT chk_crm5_scores_reject_rate CHECK (reject_rate IS NULL OR (reject_rate >= 0 AND reject_rate <= 1)),
    CONSTRAINT chk_crm5_scores_link_integrity CHECK (link_integrity IS NULL OR (link_integrity >= 0 AND link_integrity <= 1)),
    CONSTRAINT chk_crm5_scores_score CHECK (score IS NULL OR (score >= 0 AND score <= 100))
);

CREATE INDEX IF NOT EXISTS idx_crm5_scores_batch_id ON public.crm5_scores(batch_id);
CREATE INDEX IF NOT EXISTS idx_crm5_scores_module ON public.crm5_scores(module);

-- 3. Migration Rejections
CREATE TABLE IF NOT EXISTS public.crm5_rejects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id VARCHAR(128) NOT NULL,
    module VARCHAR(64) NOT NULL,
    row_index INTEGER NOT NULL,
    error_code VARCHAR(64) NOT NULL,
    error_message TEXT NOT NULL,
    raw_payload_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_crm5_rejects_row_index CHECK (row_index >= 1)
);

CREATE INDEX IF NOT EXISTS idx_crm5_rejects_batch_id ON public.crm5_rejects(batch_id);
CREATE INDEX IF NOT EXISTS idx_crm5_rejects_module ON public.crm5_rejects(module);

-- 4. Reconciliation Balance Sheets
CREATE TABLE IF NOT EXISTS public.crm5_reconciliation_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id VARCHAR(128) NOT NULL UNIQUE,
    module VARCHAR(64) NOT NULL,
    source_count INTEGER NOT NULL DEFAULT 0,
    loaded_count INTEGER NOT NULL DEFAULT 0,
    rejected_count INTEGER NOT NULL DEFAULT 0,
    merged_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    unaccounted_count INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL,
    reconciled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_crm5_recon_source_count CHECK (source_count >= 0),
    CONSTRAINT chk_crm5_recon_loaded_count CHECK (loaded_count >= 0),
    CONSTRAINT chk_crm5_recon_rejected_count CHECK (rejected_count >= 0),
    CONSTRAINT chk_crm5_recon_merged_count CHECK (merged_count >= 0),
    CONSTRAINT chk_crm5_recon_skipped_count CHECK (skipped_count >= 0),
    CONSTRAINT chk_crm5_recon_unaccounted_count CHECK (unaccounted_count >= 0),
    CONSTRAINT chk_crm5_recon_status CHECK (status IN ('OK', 'UNBALANCED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm5_recon_batch_unique ON public.crm5_reconciliation_reports(batch_id);
CREATE INDEX IF NOT EXISTS idx_crm5_recon_module ON public.crm5_reconciliation_reports(module);
