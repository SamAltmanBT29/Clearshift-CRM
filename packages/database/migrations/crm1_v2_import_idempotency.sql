ALTER TABLE crm1.crm1_import_batches
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS request_hash text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'crm1_import_batches_idempotency_pair_check'
      AND conrelid = 'crm1.crm1_import_batches'::regclass
  ) THEN
    ALTER TABLE crm1.crm1_import_batches
      ADD CONSTRAINT crm1_import_batches_idempotency_pair_check
      CHECK (
        (idempotency_key IS NULL AND request_hash IS NULL) OR
        (
          idempotency_key IS NOT NULL
          AND length(btrim(idempotency_key)) > 0
          AND request_hash IS NOT NULL
          AND length(btrim(request_hash)) > 0
        )
      );
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS crm1_import_batches_idempotency_key
  ON crm1.crm1_import_batches (idempotency_key);
