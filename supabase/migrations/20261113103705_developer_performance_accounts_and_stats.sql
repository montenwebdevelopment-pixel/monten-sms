/*
# Developer performance: account controls and aggregate statistics

1. New Tables
- `developer_accounts`: one optional row per developer holding admin controls.
  - `status` (active | suspended), `status_reason`
  - `rate_limit_per_min` (per-developer override of the API request limit)
  - `phone_margin_naira`, `email_price_naira` (per-developer pricing overrides)
  - `updated_at`, `updated_by` (admin email that made the last change)

2. New Functions (read-only, service role only)
- `admin_developer_summary(p_from, p_to, p_user)`: per-developer counts and money for a date window, split into successful, pending, failed and cancelled orders. Also returns last API activity, last order and last login.
- `admin_developer_usage_stats(p_user, p_days)`: daily API request counts (ok / failed), most used endpoints and all-time API totals for one developer.

3. Indexes
- Developer usage, orders, keys, webhook deliveries by user and time for fast per-developer lookups.

4. Security
- RLS enabled on `developer_accounts` with no client policies. Only the service role (used by the admin edge function) can read or write it.
- Both functions are callable by the service role only; PUBLIC, anon and authenticated are revoked.
- No secrets, OTP codes or password data are returned by either function.

5. Notes
- Pending orders are orders with status `pending` or `waiting` (paid, awaiting an OTP).
- Successful orders are orders with status `completed` (OTP delivered and charge kept).
*/

CREATE TABLE IF NOT EXISTS public.developer_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  status_reason text,
  rate_limit_per_min integer CHECK (rate_limit_per_min IS NULL OR rate_limit_per_min BETWEEN 1 AND 1000),
  phone_margin_naira numeric CHECK (phone_margin_naira IS NULL OR phone_margin_naira BETWEEN 0 AND 1000000),
  email_price_naira numeric CHECK (email_price_naira IS NULL OR email_price_naira BETWEEN 0 AND 1000000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

ALTER TABLE public.developer_accounts ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.developer_accounts TO service_role;

CREATE INDEX IF NOT EXISTS developer_api_usage_user_created_idx ON public.developer_api_usage (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS developer_api_transactions_user_created_idx ON public.developer_api_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS developer_api_keys_user_idx ON public.developer_api_keys (user_id);
CREATE INDEX IF NOT EXISTS developer_webhook_deliveries_user_status_idx ON public.developer_webhook_deliveries (user_id, status);

CREATE OR REPLACE FUNCTION public.admin_developer_summary(p_from timestamptz, p_to timestamptz, p_user uuid DEFAULT NULL)
RETURNS TABLE (
  user_id uuid,
  keys_total bigint,
  keys_active bigint,
  webhooks_active bigint,
  api_requests bigint,
  api_success bigint,
  api_failed bigint,
  phone_total bigint,
  phone_success bigint,
  phone_pending bigint,
  phone_failed bigint,
  phone_cancelled bigint,
  email_total bigint,
  email_success bigint,
  email_pending bigint,
  email_failed bigint,
  email_cancelled bigint,
  spent_success numeric,
  spent_pending numeric,
  last_api_at timestamptz,
  last_order_at timestamptz,
  last_login_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH devs AS (
    SELECT k.user_id FROM public.developer_api_keys k
    UNION
    SELECT a.user_id FROM public.developer_accounts a
    UNION
    SELECT t.user_id FROM public.developer_api_transactions t
  ),
  scoped AS (
    SELECT d.user_id FROM devs d WHERE p_user IS NULL OR d.user_id = p_user
  ),
  keys AS (
    SELECT k.user_id, count(*) AS total, count(*) FILTER (WHERE k.active) AS active
    FROM public.developer_api_keys k GROUP BY k.user_id
  ),
  hooks AS (
    SELECT w.user_id, count(*) FILTER (WHERE w.active) AS active
    FROM public.developer_webhooks w GROUP BY w.user_id
  ),
  usage AS (
    SELECT u.user_id,
      count(*) AS req,
      count(*) FILTER (WHERE u.status_code < 400) AS ok,
      count(*) FILTER (WHERE u.status_code >= 400) AS bad
    FROM public.developer_api_usage u
    WHERE u.created_at >= p_from AND u.created_at < p_to
    GROUP BY u.user_id
  ),
  orders AS (
    SELECT t.user_id,
      count(*) FILTER (WHERE t.kind = 'phone') AS phone_total,
      count(*) FILTER (WHERE t.kind = 'phone' AND t.status = 'completed') AS phone_success,
      count(*) FILTER (WHERE t.kind = 'phone' AND t.status IN ('pending', 'waiting')) AS phone_pending,
      count(*) FILTER (WHERE t.kind = 'phone' AND t.status = 'failed') AS phone_failed,
      count(*) FILTER (WHERE t.kind = 'phone' AND t.status = 'cancelled') AS phone_cancelled,
      count(*) FILTER (WHERE t.kind = 'email') AS email_total,
      count(*) FILTER (WHERE t.kind = 'email' AND t.status = 'completed') AS email_success,
      count(*) FILTER (WHERE t.kind = 'email' AND t.status IN ('pending', 'waiting')) AS email_pending,
      count(*) FILTER (WHERE t.kind = 'email' AND t.status = 'failed') AS email_failed,
      count(*) FILTER (WHERE t.kind = 'email' AND t.status = 'cancelled') AS email_cancelled,
      COALESCE(sum(t.amount) FILTER (WHERE t.status = 'completed'), 0) AS spent_success,
      COALESCE(sum(t.amount) FILTER (WHERE t.status IN ('pending', 'waiting')), 0) AS spent_pending
    FROM public.developer_api_transactions t
    WHERE t.created_at >= p_from AND t.created_at < p_to
    GROUP BY t.user_id
  )
  SELECT s.user_id,
    COALESCE(k.total, 0), COALESCE(k.active, 0), COALESCE(h.active, 0),
    COALESCE(u.req, 0), COALESCE(u.ok, 0), COALESCE(u.bad, 0),
    COALESCE(o.phone_total, 0), COALESCE(o.phone_success, 0), COALESCE(o.phone_pending, 0),
    COALESCE(o.phone_failed, 0), COALESCE(o.phone_cancelled, 0),
    COALESCE(o.email_total, 0), COALESCE(o.email_success, 0), COALESCE(o.email_pending, 0),
    COALESCE(o.email_failed, 0), COALESCE(o.email_cancelled, 0),
    COALESCE(o.spent_success, 0), COALESCE(o.spent_pending, 0),
    (SELECT max(x.created_at) FROM public.developer_api_usage x WHERE x.user_id = s.user_id),
    (SELECT max(x.created_at) FROM public.developer_api_transactions x WHERE x.user_id = s.user_id),
    (SELECT max(l.created_at) FROM public.login_activity l WHERE l.user_id = s.user_id AND l.event_type = 'login')
  FROM scoped s
  LEFT JOIN keys k ON k.user_id = s.user_id
  LEFT JOIN hooks h ON h.user_id = s.user_id
  LEFT JOIN usage u ON u.user_id = s.user_id
  LEFT JOIN orders o ON o.user_id = s.user_id;
$$;

CREATE OR REPLACE FUNCTION public.admin_developer_usage_stats(p_user uuid, p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH days AS (
    SELECT g::date AS day
    FROM generate_series(
      (now() AT TIME ZONE 'utc')::date - (p_days - 1),
      (now() AT TIME ZONE 'utc')::date,
      interval '1 day'
    ) g
  ),
  daily AS (
    SELECT (u.created_at AT TIME ZONE 'utc')::date AS day,
      count(*) AS req,
      count(*) FILTER (WHERE u.status_code < 400) AS ok,
      count(*) FILTER (WHERE u.status_code >= 400) AS bad
    FROM public.developer_api_usage u
    WHERE u.user_id = p_user AND u.created_at >= now() - make_interval(days => p_days)
    GROUP BY 1
  ),
  endpoints AS (
    SELECT u.method, u.endpoint,
      count(*) AS req,
      count(*) FILTER (WHERE u.status_code >= 400) AS bad,
      max(u.created_at) AS last_at
    FROM public.developer_api_usage u
    WHERE u.user_id = p_user
    GROUP BY u.method, u.endpoint
    ORDER BY count(*) DESC
    LIMIT 10
  ),
  totals AS (
    SELECT count(*) AS req,
      count(*) FILTER (WHERE u.status_code < 400) AS ok,
      count(*) FILTER (WHERE u.status_code >= 400) AS bad,
      max(u.created_at) AS last_at
    FROM public.developer_api_usage u
    WHERE u.user_id = p_user
  )
  SELECT jsonb_build_object(
    'daily', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'date', d.day, 'requests', COALESCE(x.req, 0), 'ok', COALESCE(x.ok, 0), 'failed', COALESCE(x.bad, 0)
      ) ORDER BY d.day), '[]'::jsonb)
      FROM days d LEFT JOIN daily x ON x.day = d.day
    ),
    'endpoints', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'method', e.method, 'endpoint', e.endpoint, 'requests', e.req, 'failed', e.bad, 'last_at', e.last_at
      )), '[]'::jsonb)
      FROM endpoints e
    ),
    'totals', (
      SELECT jsonb_build_object('requests', t.req, 'ok', t.ok, 'failed', t.bad, 'last_at', t.last_at)
      FROM totals t
    )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.admin_developer_summary(timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_developer_usage_stats(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_developer_summary(timestamptz, timestamptz, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_developer_usage_stats(uuid, integer) TO service_role;
