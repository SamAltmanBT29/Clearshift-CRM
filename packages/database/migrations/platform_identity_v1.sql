-- [PLT-05] Platform Hub Identity, Credentials, Refresh Sessions and Signing Keys
-- Architecture Baseline: PostgreSQL 18.6 + Drizzle ORM

CREATE SCHEMA IF NOT EXISTS platform;

CREATE TABLE IF NOT EXISTS platform.hub_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  roles text[] NOT NULL,
  employee_ref uuid,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.hub_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES platform.hub_users(id) ON DELETE CASCADE,
  argon2_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.hub_refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES platform.hub_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  rotated_from text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.hub_signing_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kid text NOT NULL UNIQUE,
  public_jwk jsonb NOT NULL,
  private_enc text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_hub_users_username
  ON platform.hub_users (username);

CREATE INDEX IF NOT EXISTS idx_platform_hub_credentials_user_id
  ON platform.hub_credentials (user_id);

CREATE INDEX IF NOT EXISTS idx_platform_hub_refresh_tokens_hash
  ON platform.hub_refresh_tokens (token_hash);

CREATE INDEX IF NOT EXISTS idx_platform_hub_signing_keys_kid
  ON platform.hub_signing_keys (kid);
