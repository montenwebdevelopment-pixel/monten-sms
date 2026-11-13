/*
# Developer API system: keys, usage, transactions, webhooks, pricing

1. New Tables
- `developer_api_keys` — hashed API keys. Secret values are NEVER stored; only
  a SHA-256 hash used for lookup, plus a short prefix for display.
  - `id` uuid PK, `user_id` uuid FK -> auth.users ON DELETE CASCADE NOT NULL
    DEFAULT auth.uid(), `name` text NOT NULL default 'Default key',
  - `key_prefix` text NOT NULL (first 12 chars, shown in UI),
    `key_hash` text NOT NULL UNIQUE (sha256 hex of full secret),
    `environment` text CHECK ('test','production') default 'test',
    `active` boolean default true, `created_at`, `last_used_at`, `revoked_at`
- `developer_api_usage` — one row per authenticated public API request.
  - `id` uuid PK, `user_id` FK, `key_id` FK, `endpoint` text, `method` text,
    `status_code` int, `response_ms` int, `created_at`
- `developer_api_transactions` — API-driven purchases (phone + email OTP).
  - `id` uuid PK, `user_id` FK, `order_ref` text UNIQUE (idempotency ref),
    `kind` text CHECK ('phone','email'), `service`, `country`, `amount` numeric,
    `order_id` text (5sim/mailotp id), `internal_order_id` uuid,
    `status` text, `meta` jsonb, `created_at`
- `developer_webhooks` — registered webhook endpoints.
  - `id` uuid PK, `user_id` FK DEFAULT auth.uid(), `url` text NOT NULL,
    `secret` text NOT NULL (used for HMAC signatures; shown once at creation),
    `active` boolean default true, `created_at`
- `developer_webhook_deliveries` — delivery log with retries.
  - `id` uuid PK, `webhook_id` FK, `user_id` FK, `event` text, `payload` jsonb,
    `status` text CHECK ('pending','delivered','failed'),
    `attempts` int default 0, `last_error` text, `next_retry_at` timestamptz,
    `response_status` int, `created_at`, `delivered_at`
- `developer_api_config` — single-row admin configuration (id = 1).
  - `phone_rate_limit_per_min` int default 30, `email_rate_limit_per_min` int
    default 20, `phone_margin_naira` numeric default 500,
    `email_price_naira` numeric default 238, `enabled` boolean default true

2. RLS
- RLS enabled on all six tables; owner-scoped policies for
  developer_api_keys / developer_webhooks / developer_webhook_deliveries /
  developer_api_transactions (TO authenticated, auth.uid() = user_id).
- developer_api_usage and developer_api_config have NO client policies:
  usage is inserted only by the public API (service_role); config read via
  the developer-api edge function. No grants to anon/authenticated on usage.

3. Functions
- `find_api_key(p_hash text)` SECURITY DEFINER: looks up an active key by
  hash, returns user_id/key id, updates last_used_at. EXECUTE revoked from
  PUBLIC/anon, granted to service_role only (public API uses service role).

4. Notes
- Developers spend from the EXISTING profiles.wallet_balance via the existing
  debit_wallet_for_user / refund_wallet_for_user RPCs — no new wallet table.
- Email OTP orders reuse email_otp_orders via the existing mailotp-proxy
  claim/billing flow at the API layer.
*/

CREATE TABLE IF NOT EXISTS developer_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Default key',
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  environment text NOT NULL DEFAULT 'test' CHECK (environment IN ('test','production')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS developer_api_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_id uuid REFERENCES developer_api_keys(id) ON DELETE SET NULL,
  endpoint text NOT NULL,
  method text NOT NULL DEFAULT 'GET',
  status_code int NOT NULL,
  response_ms int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS developer_api_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_ref text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('phone','email')),
  service text NOT NULL,
  country text,
  amount numeric NOT NULL DEFAULT 0,
  order_id text,
  internal_order_id uuid,
  status text NOT NULL DEFAULT 'pending',
  meta jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS developer_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  url text NOT NULL,
  secret text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS developer_webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id uuid NOT NULL REFERENCES developer_webhooks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  next_retry_at timestamptz,
  response_status int,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);

CREATE TABLE IF NOT EXISTS developer_api_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  phone_rate_limit_per_min int NOT NULL DEFAULT 30,
  email_rate_limit_per_min int NOT NULL DEFAULT 20,
  phone_margin_naira numeric NOT NULL DEFAULT 500,
  email_price_naira numeric NOT NULL DEFAULT 238,
  enabled boolean NOT NULL DEFAULT true
);
INSERT INTO developer_api_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_dev_keys_hash ON developer_api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_dev_keys_user ON developer_api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_dev_usage_user ON developer_api_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_dev_usage_created ON developer_api_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_dev_tx_user ON developer_api_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_dev_tx_created ON developer_api_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_dev_hooks_user ON developer_webhooks(user_id);
CREATE INDEX IF NOT EXISTS idx_dev_deliv_pending ON developer_webhook_deliveries(status, next_retry_at);

ALTER TABLE developer_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE developer_api_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE developer_api_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE developer_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE developer_webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE developer_api_config ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON developer_api_keys TO authenticated;
GRANT SELECT ON developer_api_usage TO authenticated;
GRANT SELECT, INSERT ON developer_api_transactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON developer_webhooks TO authenticated;
GRANT SELECT, DELETE ON developer_webhook_deliveries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON developer_api_keys TO service_role;
GRANT ALL ON developer_api_usage TO service_role;
GRANT ALL ON developer_api_transactions TO service_role;
GRANT ALL ON developer_webhooks TO service_role;
GRANT ALL ON developer_webhook_deliveries TO service_role;
GRANT SELECT, UPDATE ON developer_api_config TO service_role;

DROP POLICY IF EXISTS "dev_keys_owner" ON developer_api_keys;
CREATE POLICY "dev_keys_owner" ON developer_api_keys FOR ALL
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "dev_usage_owner" ON developer_api_usage;
CREATE POLICY "dev_usage_owner" ON developer_api_usage FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "dev_tx_owner" ON developer_api_transactions;
CREATE POLICY "dev_tx_owner" ON developer_api_transactions FOR ALL
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "dev_hooks_owner" ON developer_webhooks;
CREATE POLICY "dev_hooks_owner" ON developer_webhooks FOR ALL
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "dev_deliv_owner" ON developer_webhook_deliveries;
CREATE POLICY "dev_deliv_owner" ON developer_webhook_deliveries FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "dev_deliv_owner_del" ON developer_webhook_deliveries;
CREATE POLICY "dev_deliv_owner_del" ON developer_webhook_deliveries FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Key lookup used ONLY by the public API (service_role context).
CREATE OR REPLACE FUNCTION find_api_key(p_hash text)
RETURNS TABLE (key_id uuid, user_id uuid, environment text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE developer_api_keys SET last_used_at = now()
  WHERE key_hash = p_hash AND active = true AND revoked_at IS NULL
  RETURNING id, user_id, environment;
$$;

REVOKE EXECUTE ON FUNCTION find_api_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION find_api_key(text) TO service_role;
