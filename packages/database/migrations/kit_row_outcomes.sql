-- ClearShift Migration Kit — Terminal Outcome Ledger Schema (KIT-09)
-- Version: v1.0.0
-- Forward-only, idempotent migration for PostgreSQL 18+

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.kit_row_outcomes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES public.kit_batches(id) ON DELETE CASCADE,
    source_row INTEGER NOT NULL,
    outcome VARCHAR(32) NOT NULL,
    target_id UUID,
    reason_code VARCHAR(64),
    reason_message TEXT,
    actor VARCHAR(128),
    policy_code VARCHAR(64),
    approved_by VARCHAR(128),
    approved_at TIMESTAMPTZ,
    idempotency_key VARCHAR(256),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_kit_row_outcomes_batch_source_row UNIQUE (batch_id, source_row),
    CONSTRAINT chk_kit_row_outcomes_source_row CHECK (source_row > 0),
    CONSTRAINT chk_kit_row_outcomes_outcome CHECK (outcome IN ('loaded', 'rejected', 'merged', 'skipped')),
    CONSTRAINT chk_kit_row_outcomes_skip_reason CHECK (
        outcome != 'skipped' OR (
            reason_message IS NOT NULL AND
            length(btrim(reason_message)) >= 10 AND
            policy_code = 'operator_approved_skip' AND
            approved_by IS NOT NULL
        )
    )
);

CREATE INDEX IF NOT EXISTS idx_kit_row_outcomes_batch_outcome ON public.kit_row_outcomes(batch_id, outcome);
CREATE INDEX IF NOT EXISTS idx_kit_row_outcomes_idempotency_key ON public.kit_row_outcomes(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_kit_row_outcomes_target_id ON public.kit_row_outcomes(target_id);

-- Trigger to enforce strict append-only immutability
CREATE OR REPLACE FUNCTION public.fn_guard_kit_row_outcomes_immutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Illegal operation: kit_row_outcomes entries are append-only and cannot be modified or deleted (batch_id=%, source_row=%)',
        OLD.batch_id, OLD.source_row
        USING ERRCODE = '22000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_kit_row_outcomes_immutable ON public.kit_row_outcomes;
CREATE TRIGGER trg_guard_kit_row_outcomes_immutable
    BEFORE UPDATE OR DELETE ON public.kit_row_outcomes
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_guard_kit_row_outcomes_immutable();
