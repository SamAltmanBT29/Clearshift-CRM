-- ClearShift CRM-2 — Deals, Pipeline and Quotes
-- V1 schema contract for issue #16. Forward-only migration.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE SCHEMA IF NOT EXISTS crm2;

CREATE TABLE crm2.crm2_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    position SMALLINT NOT NULL,
    is_won BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT crm2_stages_name_check
      CHECK (name IN ('New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost')),
    CONSTRAINT crm2_stages_position_check CHECK (position BETWEEN 1 AND 6),
    CONSTRAINT crm2_stages_won_check CHECK (is_won = (name = 'Won')),
    CONSTRAINT crm2_stages_name_key UNIQUE (name),
    CONSTRAINT crm2_stages_position_key UNIQUE (position)
);

CREATE TABLE crm2.crm2_deals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    contact_id UUID,
    value NUMERIC(14, 2) NOT NULL,
    currency TEXT NOT NULL,
    stage_id UUID NOT NULL REFERENCES crm2.crm2_stages(id) ON DELETE RESTRICT,
    close_date DATE,
    source_system TEXT,
    source_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT crm2_deals_name_nonempty_check CHECK (length(btrim(name)) > 0),
    CONSTRAINT crm2_deals_value_nonnegative_check CHECK (value >= 0),
    CONSTRAINT crm2_deals_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT crm2_deals_source_pair_check CHECK (
      (source_system IS NULL AND source_id IS NULL) OR
      (source_system IS NOT NULL AND source_id IS NOT NULL
       AND length(btrim(source_system)) > 0 AND length(btrim(source_id)) > 0)
    ),
    CONSTRAINT crm2_deals_source_key UNIQUE (source_system, source_id)
);

CREATE INDEX crm2_deals_name_search_idx ON crm2.crm2_deals (lower(name));
CREATE INDEX crm2_deals_contact_id_idx ON crm2.crm2_deals (contact_id);
CREATE INDEX crm2_deals_stage_id_idx ON crm2.crm2_deals (stage_id);
CREATE INDEX crm2_deals_close_date_idx ON crm2.crm2_deals (close_date);

CREATE TABLE crm2.crm2_quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_number TEXT NOT NULL,
    deal_id UUID NOT NULL REFERENCES crm2.crm2_deals(id) ON DELETE RESTRICT,
    quote_date DATE NOT NULL,
    amount NUMERIC(14, 2) NOT NULL,
    note TEXT,
    source_system TEXT,
    source_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT crm2_quotes_number_nonempty_check CHECK (length(btrim(quote_number)) > 0),
    CONSTRAINT crm2_quotes_amount_nonnegative_check CHECK (amount >= 0),
    CONSTRAINT crm2_quotes_source_pair_check CHECK (
      (source_system IS NULL AND source_id IS NULL) OR
      (source_system IS NOT NULL AND source_id IS NOT NULL
       AND length(btrim(source_system)) > 0 AND length(btrim(source_id)) > 0)
    ),
    CONSTRAINT crm2_quotes_quote_number_key UNIQUE (quote_number),
    CONSTRAINT crm2_quotes_source_key UNIQUE (source_system, source_id)
);

CREATE INDEX crm2_quotes_deal_id_idx ON crm2.crm2_quotes (deal_id);
CREATE INDEX crm2_quotes_quote_date_idx ON crm2.crm2_quotes (quote_date);

-- Prevent changing or deleting seeded stage rows. INSERT is reserved for migrations.
CREATE OR REPLACE FUNCTION crm2.reject_stage_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'CRM-2 stages are fixed V1 reference data'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER crm2_stages_no_update
BEFORE UPDATE OR DELETE ON crm2.crm2_stages
FOR EACH ROW EXECUTE FUNCTION crm2.reject_stage_mutation();

INSERT INTO crm2.crm2_stages (id, name, position, is_won) VALUES
  ('00000000-0000-4000-8000-000000000001', 'New', 1, false),
  ('00000000-0000-4000-8000-000000000002', 'Qualified', 2, false),
  ('00000000-0000-4000-8000-000000000003', 'Proposal', 3, false),
  ('00000000-0000-4000-8000-000000000004', 'Negotiation', 4, false),
  ('00000000-0000-4000-8000-000000000005', 'Won', 5, true),
  ('00000000-0000-4000-8000-000000000006', 'Lost', 6, false);
