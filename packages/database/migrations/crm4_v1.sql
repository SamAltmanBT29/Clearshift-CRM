-- ClearShift CRM — CRM-4 Marketing Lists and Campaign History Schema
-- Version: v1.0.0
-- Forward-only, idempotent migration for PostgreSQL 18+

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS crm4;

-- ---------------------------------------------------------------------------
-- 1. Marketing Lists Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm4.crm4_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    campaign_count INTEGER NOT NULL DEFAULT 0,
    member_count INTEGER NOT NULL DEFAULT 0,
    source_system TEXT,
    source_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT crm4_lists_name_nonempty_check CHECK (length(btrim(name)) > 0),
    CONSTRAINT crm4_lists_campaign_count_check CHECK (campaign_count >= 0),
    CONSTRAINT crm4_lists_member_count_check CHECK (member_count >= 0),
    CONSTRAINT crm4_lists_source_pair_check CHECK (
        (source_system IS NULL AND source_id IS NULL) OR
        (source_system IS NOT NULL AND source_id IS NOT NULL AND
         length(btrim(source_system)) > 0 AND length(btrim(source_id)) > 0)
    ),
    CONSTRAINT crm4_lists_source_key UNIQUE (source_system, source_id)
);

CREATE INDEX IF NOT EXISTS crm4_lists_name_idx ON crm4.crm4_lists (lower(name));
CREATE INDEX IF NOT EXISTS crm4_lists_created_at_idx ON crm4.crm4_lists (created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. Campaigns Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm4.crm4_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    campaign_date DATE NOT NULL,
    list_id UUID NOT NULL REFERENCES crm4.crm4_lists(id) ON DELETE RESTRICT,
    member_count INTEGER NOT NULL DEFAULT 0,
    source_system TEXT,
    source_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT crm4_campaigns_name_nonempty_check CHECK (length(btrim(name)) > 0),
    CONSTRAINT crm4_campaigns_member_count_check CHECK (member_count >= 0),
    CONSTRAINT crm4_campaigns_source_pair_check CHECK (
        (source_system IS NULL AND source_id IS NULL) OR
        (source_system IS NOT NULL AND source_id IS NOT NULL AND
         length(btrim(source_system)) > 0 AND length(btrim(source_id)) > 0)
    ),
    CONSTRAINT crm4_campaigns_source_key UNIQUE (source_system, source_id)
);

CREATE INDEX IF NOT EXISTS crm4_campaigns_list_id_idx ON crm4.crm4_campaigns (list_id);
CREATE INDEX IF NOT EXISTS crm4_campaigns_date_idx ON crm4.crm4_campaigns (campaign_date);
CREATE INDEX IF NOT EXISTS crm4_campaigns_created_at_idx ON crm4.crm4_campaigns (created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Campaign Members Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm4.crm4_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES crm4.crm4_campaigns(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent',
    unsubscribed BOOLEAN NOT NULL DEFAULT false,
    source_system TEXT,
    source_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT crm4_members_status_check CHECK (status IN ('sent', 'opened', 'clicked')),
    CONSTRAINT crm4_members_source_pair_check CHECK (
        (source_system IS NULL AND source_id IS NULL) OR
        (source_system IS NOT NULL AND source_id IS NOT NULL AND
         length(btrim(source_system)) > 0 AND length(btrim(source_id)) > 0)
    ),
    CONSTRAINT crm4_members_campaign_contact_key UNIQUE (campaign_id, contact_id),
    CONSTRAINT crm4_members_source_key UNIQUE (source_system, source_id)
);

CREATE INDEX IF NOT EXISTS crm4_members_campaign_id_idx ON crm4.crm4_members (campaign_id);
CREATE INDEX IF NOT EXISTS crm4_members_contact_id_idx ON crm4.crm4_members (contact_id);
CREATE INDEX IF NOT EXISTS crm4_members_status_idx ON crm4.crm4_members (status);
CREATE INDEX IF NOT EXISTS crm4_members_created_at_idx ON crm4.crm4_members (created_at DESC);

-- ---------------------------------------------------------------------------
-- 4. Contact Consent Records Table (BR-CRM4-01 monotonic opt-out)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm4.crm4_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID NOT NULL,
    status TEXT NOT NULL,
    consent_date TIMESTAMPTZ NOT NULL DEFAULT now(),
    source TEXT NOT NULL,
    source_system TEXT,
    source_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT crm4_consents_status_check CHECK (status IN ('subscribed', 'unsubscribed')),
    CONSTRAINT crm4_consents_source_nonempty_check CHECK (length(btrim(source)) > 0),
    CONSTRAINT crm4_consents_source_pair_check CHECK (
        (source_system IS NULL AND source_id IS NULL) OR
        (source_system IS NOT NULL AND source_id IS NOT NULL AND
         length(btrim(source_system)) > 0 AND length(btrim(source_id)) > 0)
    ),
    CONSTRAINT crm4_consents_contact_id_key UNIQUE (contact_id),
    CONSTRAINT crm4_consents_source_key UNIQUE (source_system, source_id)
);

CREATE INDEX IF NOT EXISTS crm4_consents_status_idx ON crm4.crm4_consents (status);
CREATE INDEX IF NOT EXISTS crm4_consents_updated_at_idx ON crm4.crm4_consents (updated_at DESC);

-- ---------------------------------------------------------------------------
-- 5. CRM-4 Import Batches (Migration Kit integration)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm4.crm4_import_batches (
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
    CONSTRAINT crm4_import_batches_source_system_nonempty_check CHECK (length(btrim(source_system)) > 0),
    CONSTRAINT crm4_import_batches_status_check CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    CONSTRAINT crm4_import_batches_loaded_count_check CHECK (loaded_count >= 0),
    CONSTRAINT crm4_import_batches_rejected_count_check CHECK (rejected_count >= 0),
    CONSTRAINT crm4_import_batches_idempotency_pair_check CHECK (
        (idempotency_key IS NULL AND request_hash IS NULL) OR
        (idempotency_key IS NOT NULL AND length(btrim(idempotency_key)) > 0 AND
         request_hash IS NOT NULL AND length(btrim(request_hash)) > 0)
    ),
    CONSTRAINT crm4_import_batches_idempotency_key UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS crm4_import_batches_created_at_idx ON crm4.crm4_import_batches (created_at DESC);

-- ---------------------------------------------------------------------------
-- 6. CRM-4 Import Receipts (Durable idempotency receipts)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm4.crm4_import_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES crm4.crm4_import_batches(id) ON DELETE CASCADE,
    source_row INTEGER NOT NULL,
    entity TEXT NOT NULL,
    source_system TEXT NOT NULL,
    source_id TEXT NOT NULL,
    target_id UUID NOT NULL,
    idempotency_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT crm4_import_receipts_source_row_check CHECK (source_row > 0),
    CONSTRAINT crm4_import_receipts_entity_check CHECK (entity IN ('list', 'campaign', 'member', 'consent')),
    CONSTRAINT crm4_import_receipts_source_system_nonempty_check CHECK (length(btrim(source_system)) > 0),
    CONSTRAINT crm4_import_receipts_source_id_nonempty_check CHECK (length(btrim(source_id)) > 0),
    CONSTRAINT crm4_import_receipts_idempotency_key_nonempty_check CHECK (length(btrim(idempotency_key)) > 0),
    CONSTRAINT crm4_import_receipts_idempotency_key UNIQUE (idempotency_key),
    CONSTRAINT crm4_import_receipts_batch_row_entity_key UNIQUE (batch_id, source_row, entity)
);

CREATE INDEX IF NOT EXISTS crm4_import_receipts_target_id_idx ON crm4.crm4_import_receipts (target_id);
CREATE INDEX IF NOT EXISTS crm4_import_receipts_created_at_idx ON crm4.crm4_import_receipts (created_at DESC);
