-- [PLT-09] Platform Transactional Outbox and Consumed Events Tables
-- Architecture Baseline: PostgreSQL 18.6 + Drizzle ORM

CREATE SCHEMA IF NOT EXISTS platform;

CREATE TABLE IF NOT EXISTS platform.outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  retry_count integer NOT NULL DEFAULT 0,
  last_error text
);

CREATE TABLE IF NOT EXISTS platform.consumed_events (
  consumer text NOT NULL,
  event_id uuid NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);

-- Index for the relay worker to fetch unpublished records in FIFO order
CREATE INDEX IF NOT EXISTS idx_platform_outbox_unpublished
  ON platform.outbox (created_at)
  WHERE published_at IS NULL;

-- Index for retention window purging (30-day retention)
CREATE INDEX IF NOT EXISTS idx_platform_outbox_retention
  ON platform.outbox (published_at)
  WHERE published_at IS NOT NULL;

-- Index for event replay queries filtered by event type
CREATE INDEX IF NOT EXISTS idx_platform_outbox_event_type
  ON platform.outbox (event_type);
