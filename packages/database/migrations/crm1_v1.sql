CREATE SCHEMA crm1;

CREATE TABLE crm1.crm1_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  tax_number text,
  email text,
  phone text,
  address text,
  source_system text,
  source_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm1_companies_name_nonempty_check CHECK (length(btrim(name)) > 0),
  CONSTRAINT crm1_companies_source_pair_check CHECK (
    (source_system IS NULL AND source_id IS NULL) OR
    (source_system IS NOT NULL AND source_id IS NOT NULL
      AND length(btrim(source_system)) > 0 AND length(btrim(source_id)) > 0)
  ),
  CONSTRAINT crm1_companies_source_key UNIQUE (source_system, source_id)
);
CREATE INDEX crm1_companies_name_search_idx ON crm1.crm1_companies (lower(name));

CREATE TABLE crm1.crm1_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text,
  phone text,
  address text,
  company_id uuid REFERENCES crm1.crm1_companies(id) ON DELETE RESTRICT,
  lead_status text,
  golden_id text NOT NULL,
  source_system text,
  source_id text,
  consent_status text NOT NULL DEFAULT 'unknown',
  consent_updated_at timestamptz,
  unsubscribed boolean NOT NULL DEFAULT false,
  unsubscribed_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm1_contacts_first_name_nonempty_check CHECK (length(btrim(first_name)) > 0),
  CONSTRAINT crm1_contacts_last_name_nonempty_check CHECK (length(btrim(last_name)) > 0),
  CONSTRAINT crm1_contacts_golden_id_nonempty_check CHECK (length(btrim(golden_id)) > 0),
  CONSTRAINT crm1_contacts_lead_status_check CHECK (
    lead_status IS NULL OR lead_status IN ('New', 'Working', 'Qualified', 'Closed')
  ),
  CONSTRAINT crm1_contacts_consent_status_check CHECK (
    consent_status IN ('unknown', 'granted', 'withdrawn')
  ),
  CONSTRAINT crm1_contacts_consent_timestamp_check CHECK (
    (consent_status = 'unknown' AND consent_updated_at IS NULL) OR
    (consent_status <> 'unknown' AND consent_updated_at IS NOT NULL)
  ),
  CONSTRAINT crm1_contacts_unsubscribed_timestamp_check CHECK (
    unsubscribed = false OR unsubscribed_updated_at IS NOT NULL
  ),
  CONSTRAINT crm1_contacts_source_pair_check CHECK (
    (source_system IS NULL AND source_id IS NULL) OR
    (source_system IS NOT NULL AND source_id IS NOT NULL
      AND length(btrim(source_system)) > 0 AND length(btrim(source_id)) > 0)
  ),
  CONSTRAINT crm1_contacts_golden_id_key UNIQUE (golden_id),
  CONSTRAINT crm1_contacts_source_key UNIQUE (source_system, source_id)
);
CREATE INDEX crm1_contacts_name_search_idx
  ON crm1.crm1_contacts (lower(first_name), lower(last_name));
CREATE INDEX crm1_contacts_email_search_idx ON crm1.crm1_contacts (lower(email));
CREATE INDEX crm1_contacts_company_id_idx ON crm1.crm1_contacts (company_id);

CREATE FUNCTION crm1.reject_stale_contact_preference_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.consent_updated_at IS NOT NULL
      AND (NEW.consent_updated_at IS NULL
        OR NEW.consent_updated_at < OLD.consent_updated_at
        OR (NEW.consent_status IS DISTINCT FROM OLD.consent_status
          AND NEW.consent_updated_at = OLD.consent_updated_at)) THEN
    RAISE EXCEPTION 'Consent state cannot be replaced by an older or equal import event'
      USING ERRCODE = '23514', CONSTRAINT = 'crm1_contacts_consent_freshness_check';
  END IF;

  IF OLD.unsubscribed_updated_at IS NOT NULL
      AND (NEW.unsubscribed_updated_at IS NULL
        OR NEW.unsubscribed_updated_at < OLD.unsubscribed_updated_at
        OR (NEW.unsubscribed IS DISTINCT FROM OLD.unsubscribed
          AND NEW.unsubscribed_updated_at = OLD.unsubscribed_updated_at)) THEN
    RAISE EXCEPTION 'Unsubscribe state cannot be replaced by an older or equal import event'
      USING ERRCODE = '23514', CONSTRAINT = 'crm1_contacts_unsubscribe_freshness_check';
  END IF;

  RETURN NEW;
END;
$$;
CREATE TRIGGER crm1_contacts_preference_freshness_trigger
  BEFORE UPDATE OF consent_status, consent_updated_at, unsubscribed, unsubscribed_updated_at
  ON crm1.crm1_contacts
  FOR EACH ROW
  EXECUTE FUNCTION crm1.reject_stale_contact_preference_update();

CREATE TABLE crm1.crm1_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES crm1.crm1_contacts(id) ON DELETE RESTRICT,
  status text NOT NULL,
  source_system text,
  source_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm1_leads_status_check CHECK (
    status IN ('New', 'Working', 'Qualified', 'Closed')
  ),
  CONSTRAINT crm1_leads_source_pair_check CHECK (
    (source_system IS NULL AND source_id IS NULL) OR
    (source_system IS NOT NULL AND source_id IS NOT NULL
      AND length(btrim(source_system)) > 0 AND length(btrim(source_id)) > 0)
  ),
  CONSTRAINT crm1_leads_source_key UNIQUE (source_system, source_id)
);
CREATE INDEX crm1_leads_contact_id_idx ON crm1.crm1_leads (contact_id);
CREATE INDEX crm1_leads_status_idx ON crm1.crm1_leads (status);

CREATE TABLE crm1.crm1_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  loaded_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT crm1_import_batches_source_system_nonempty_check
    CHECK (length(btrim(source_system)) > 0),
  CONSTRAINT crm1_import_batches_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  CONSTRAINT crm1_import_batches_loaded_count_check CHECK (loaded_count >= 0),
  CONSTRAINT crm1_import_batches_rejected_count_check CHECK (rejected_count >= 0)
);
CREATE INDEX crm1_import_batches_created_at_idx ON crm1.crm1_import_batches (created_at DESC);

CREATE TABLE crm1.crm1_import_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES crm1.crm1_import_batches(id) ON DELETE CASCADE,
  source_row integer NOT NULL,
  entity text NOT NULL,
  source_system text NOT NULL,
  source_id text NOT NULL,
  target_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm1_import_receipts_source_row_check CHECK (source_row > 0),
  CONSTRAINT crm1_import_receipts_entity_check CHECK (entity IN ('contact', 'company', 'lead')),
  CONSTRAINT crm1_import_receipts_source_system_nonempty_check
    CHECK (length(btrim(source_system)) > 0),
  CONSTRAINT crm1_import_receipts_source_id_nonempty_check
    CHECK (length(btrim(source_id)) > 0),
  CONSTRAINT crm1_import_receipts_idempotency_key_nonempty_check
    CHECK (length(btrim(idempotency_key)) > 0),
  CONSTRAINT crm1_import_receipts_idempotency_key UNIQUE (idempotency_key),
  CONSTRAINT crm1_import_receipts_batch_row_entity_key UNIQUE (batch_id, source_row, entity)
);
CREATE INDEX crm1_import_receipts_target_id_idx ON crm1.crm1_import_receipts (target_id);

CREATE TABLE crm1.crm1_import_rejects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES crm1.crm1_import_batches(id) ON DELETE CASCADE,
  source_row integer NOT NULL,
  entity text NOT NULL,
  reason_code text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm1_import_rejects_source_row_check CHECK (source_row > 0),
  CONSTRAINT crm1_import_rejects_entity_check CHECK (entity IN ('contact', 'company', 'lead')),
  CONSTRAINT crm1_import_rejects_reason_code_nonempty_check
    CHECK (length(btrim(reason_code)) > 0),
  CONSTRAINT crm1_import_rejects_message_nonempty_check
    CHECK (length(btrim(message)) > 0)
);
CREATE INDEX crm1_import_rejects_batch_id_idx ON crm1.crm1_import_rejects (batch_id);

CREATE VIEW crm1.crm1_import_summary AS
SELECT
  batch.id,
  batch.source_system,
  batch.status,
  batch.loaded_count,
  batch.rejected_count,
  batch.created_at,
  batch.updated_at,
  batch.completed_at
FROM crm1.crm1_import_batches AS batch;

CREATE VIEW crm1.crm1_reject_view AS
SELECT
  reject.id,
  reject.batch_id,
  reject.source_row,
  reject.entity,
  reject.reason_code,
  reject.message,
  reject.created_at
FROM crm1.crm1_import_rejects AS reject;
