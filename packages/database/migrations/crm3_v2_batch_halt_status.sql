-- ClearShift CRM — CRM-3 Import Batch Halted Status (CRM3-13 / #146)
-- Version: v1.1.0 (Forward-only, idempotent migration for PostgreSQL 18+)
--
-- Adds 'stopped_excessive_failures' to the allowed crm3_import_batches.status values so a load
-- that halts on the 10% row-failure threshold (decision C9) can record that state durably.
-- Existing rows keep their status; no data is changed. Re-running this file is safe.

DO $$
BEGIN
    IF to_regclass('crm3.crm3_import_batches') IS NULL THEN
        RAISE EXCEPTION 'crm3_v1 must be applied before crm3_v2_batch_halt_status';
    END IF;
END
$$;

ALTER TABLE crm3.crm3_import_batches
    DROP CONSTRAINT IF EXISTS crm3_import_batches_status_check;

ALTER TABLE crm3.crm3_import_batches
    ADD CONSTRAINT crm3_import_batches_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'stopped_excessive_failures'));
