/*
# Super Admin Portal: audit log, login activity, email campaigns

1. New Tables
- `admin_audit_logs` — audit trail of sensitive admin operations.
  - `id` uuid PK, `admin_email` text NOT NULL, `action` text NOT NULL,
    `target_type` text, `target_id` text, `details` jsonb, `ip_address` text,
    `created_at` timestamptz default now()
- `login_activity` — login event log for the Login Activity page.
  - `id` uuid PK, `user_id` uuid (nullable), `email` text NOT NULL,
    `event_type` text NOT NULL CHECK ('login' | 'login_failed' | 'logout'),
    `user_agent` text, `ip_address` text, `created_at` timestamptz default now()
- `email_campaigns` — bulk email campaigns (drafts, scheduled, sent).
  - `id` uuid PK, `created_by` text, `subject` text NOT NULL default '',
    `html` text NOT NULL default '', `text` text NOT NULL default '',
    `recipients` jsonb NOT NULL default '[]' (array of email strings),
    `recipient_count` int NOT NULL default 0,
    `status` text NOT NULL default 'draft' CHECK in
      ('draft','scheduled','queued','sending','sent','failed','cancelled'),
    `is_test` boolean NOT NULL default true,
    `scheduled_for` timestamptz, `sent_at` timestamptz,
    `stats` jsonb NOT NULL default '{}' (delivered/failed/queued counts),
    `created_at`, `updated_at`
- `email_messages` — per-recipient message records for campaigns.
  - `id` uuid PK, `campaign_id` uuid FK -> email_campaigns ON DELETE CASCADE,
    `to_email` text NOT NULL, `subject` text NOT NULL default '',
    `sender` text, `provider_id` text, `status` text NOT NULL default 'queued'
      CHECK in ('queued','sending','sent','failed','cancelled'),
    `error` text, `sent_at` timestamptz, `created_at`
- `email_suppressions` — unsubscribes/bounces; campaigns skip these.
  - `id` uuid PK, `email` text UNIQUE NOT NULL,
    `reason` text CHECK in ('unsubscribed','bounced','complained','manual'),
    `created_at`
- `app_settings` — key/value admin settings (sender identity, toggles).
  - `key` text PK, `value` jsonb, `updated_at`

2. Indexes
- login_activity(email), login_activity(created_at), login_activity(user_id)
- email_messages(campaign_id), email_messages(status), email_messages(to_email)
- email_campaigns(status), email_suppressions(email)
- admin_audit_logs(created_at)

3. Security
- RLS enabled on ALL five new tables.
- NO direct policies for anon/authenticated: customer data (emails) lives in
  these tables, so the browser never talks to them directly. The `admin-api`
  edge function reads/writes with service_role (bypasses RLS) after verifying
  the caller is the authorized admin server-side.
- No GRANTs to anon/authenticated — tables are invisible to normal users.
- GRANT SELECT, INSERT, UPDATE, DELETE to service_role (used by edge function).
- Trigger: on auth.users insert/update, sync profile email_verified etc. is
  NOT touched here. Login activity is written by the admin-api edge function
  using service_role, and by AuthContext via an RPC `record_login_event`
  that only logs (email, event_type, user_agent) for the signed-in user.

4. Functions
- `record_login_event(p_event text)` — SECURITY DEFINER, callable by
  authenticated only; inserts into login_activity with auth.uid()/email.
  Used by the client after successful/failed login attempts to build the
  Login Activity page without exposing the table via the Data API.

5. Important notes
- No existing tables are modified. No data is deleted.
- email_messages rows cascade with their campaign (campaign delete = removing
  admin history only, never customer data).
*/

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email text NOT NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  details jsonb,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS login_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('login','login_failed','logout')),
  user_agent text,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by text NOT NULL,
  subject text NOT NULL DEFAULT '',
  html text NOT NULL DEFAULT '',
  text_body text NOT NULL DEFAULT '',
  recipients jsonb NOT NULL DEFAULT '[]',
  recipient_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','scheduled','queued','sending','sent','failed','cancelled')),
  is_test boolean NOT NULL DEFAULT true,
  scheduled_for timestamptz,
  sent_at timestamptz,
  stats jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  to_email text NOT NULL,
  subject text NOT NULL DEFAULT '',
  sender text,
  provider_id text,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sending','sent','failed','cancelled')),
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  reason text NOT NULL CHECK (reason IN ('unsubscribed','bounced','complained','manual')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_activity_email ON login_activity(email);
CREATE INDEX IF NOT EXISTS idx_login_activity_created ON login_activity(created_at);
CREATE INDEX IF NOT EXISTS idx_login_activity_user ON login_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_campaign ON email_messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_status ON email_messages(status);
CREATE INDEX IF NOT EXISTS idx_email_messages_to_email ON email_messages(to_email);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_status ON email_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON admin_audit_logs(created_at);

ALTER TABLE admin_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON admin_audit_logs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON login_activity TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON email_campaigns TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON email_messages TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON email_suppressions TO service_role;
GRANT SELECT, UPDATE, INSERT ON app_settings TO service_role;

CREATE OR REPLACE FUNCTION record_login_event(p_event text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_event NOT IN ('login','login_failed','logout') THEN
    RAISE EXCEPTION 'invalid event type';
  END IF;
  INSERT INTO login_activity (user_id, email, event_type)
  VALUES (auth.uid(), (SELECT email FROM auth.users WHERE id = auth.uid()), p_event);
END;
$$;

REVOKE EXECUTE ON FUNCTION record_login_event(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION record_login_event(text) TO authenticated;
