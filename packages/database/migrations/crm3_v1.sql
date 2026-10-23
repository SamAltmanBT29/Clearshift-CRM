-- ClearShift CRM — CRM-3 Support Tickets & Activities Schema
-- Version: v1.0.0
-- Forward-only, idempotent migration for PostgreSQL 18+

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS crm3;

-- 1. Support Tickets Table
CREATE TABLE IF NOT EXISTS crm3.crm3_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'New',
    priority TEXT NOT NULL DEFAULT 'Normal',
    contact_id UUID NOT NULL,
    order_ref TEXT,
    source_system TEXT,
    source_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT crm3_tickets_subject_nonempty_check CHECK (length(btrim(subject)) > 0),
    CONSTRAINT crm3_tickets_status_check CHECK (status IN ('New', 'Open', 'Waiting', 'Solved', 'Closed')),
    CONSTRAINT crm3_tickets_priority_check CHECK (priority IN ('Low', 'Normal', 'High', 'Urgent')),
    CONSTRAINT crm3_tickets_source_pair_check CHECK (
        (source_system IS NULL AND source_id IS NULL) OR
        (source_system IS NOT NULL AND source_id IS NOT NULL AND
         length(btrim(source_system)) > 0 AND length(btrim(source_id)) > 0)
    ),
    CONSTRAINT crm3_tickets_source_key UNIQUE (source_system, source_id)
);

CREATE INDEX IF NOT EXISTS crm3_tickets_contact_id_idx ON crm3.crm3_tickets (contact_id);
CREATE INDEX IF NOT EXISTS crm3_tickets_status_idx ON crm3.crm3_tickets (status);
CREATE INDEX IF NOT EXISTS crm3_tickets_priority_idx ON crm3.crm3_tickets (priority);
CREATE INDEX IF NOT EXISTS crm3_tickets_created_at_idx ON crm3.crm3_tickets (created_at DESC);

-- 2. Ticket Notes Table (Append-only)
CREATE TABLE IF NOT EXISTS crm3.crm3_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES crm3.crm3_tickets(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL,
    note_text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT crm3_notes_author_id_nonempty_check CHECK (length(btrim(author_id)) > 0),
    CONSTRAINT crm3_notes_note_text_nonempty_check CHECK (length(btrim(note_text)) > 0)
);

CREATE INDEX IF NOT EXISTS crm3_notes_ticket_id_idx ON crm3.crm3_notes (ticket_id);
CREATE INDEX IF NOT EXISTS crm3_notes_ticket_created_at_idx ON crm3.crm3_notes (ticket_id, created_at DESC);

-- 3. CRM-3 Import Batches (Migration Kit integration)
CREATE TABLE IF NOT EXISTS crm3.crm3_import_batches (
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
    CONSTRAINT crm3_import_batches_source_system_nonempty_check CHECK (length(btrim(source_system)) > 0),
    CONSTRAINT crm3_import_batches_status_check CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    CONSTRAINT crm3_import_batches_loaded_count_check CHECK (loaded_count >= 0),
    CONSTRAINT crm3_import_batches_rejected_count_check CHECK (rejected_count >= 0),
    CONSTRAINT crm3_import_batches_idempotency_pair_check CHECK (
        (idempotency_key IS NULL AND request_hash IS NULL) OR
        (idempotency_key IS NOT NULL AND length(btrim(idempotency_key)) > 0 AND
         request_hash IS NOT NULL AND length(btrim(request_hash)) > 0)
    ),
    CONSTRAINT crm3_import_batches_idempotency_key UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS crm3_import_batches_created_at_idx ON crm3.crm3_import_batches (created_at DESC);

-- 4. CRM-3 Import Receipts (Durable idempotency receipts)
CREATE TABLE IF NOT EXISTS crm3.crm3_import_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES crm3.crm3_import_batches(id) ON DELETE CASCADE,
    source_row INTEGER NOT NULL,
    entity TEXT NOT NULL,
    source_system TEXT NOT NULL,
    source_id TEXT NOT NULL,
    target_id UUID NOT NULL,
    idempotency_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT crm3_import_receipts_source_row_check CHECK (source_row > 0),
    CONSTRAINT crm3_import_receipts_entity_check CHECK (entity IN ('ticket', 'note')),
    CONSTRAINT crm3_import_receipts_source_system_nonempty_check CHECK (length(btrim(source_system)) > 0),
    CONSTRAINT crm3_import_receipts_source_id_nonempty_check CHECK (length(btrim(source_id)) > 0),
    CONSTRAINT crm3_import_receipts_idempotency_key_nonempty_check CHECK (length(btrim(idempotency_key)) > 0),
    CONSTRAINT crm3_import_receipts_idempotency_key UNIQUE (idempotency_key),
    CONSTRAINT crm3_import_receipts_batch_row_entity_key UNIQUE (batch_id, source_row, entity)
);

CREATE INDEX IF NOT EXISTS crm3_import_receipts_target_id_idx ON crm3.crm3_import_receipts (target_id);
