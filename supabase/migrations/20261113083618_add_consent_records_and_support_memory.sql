/*
# Consent records + persistent support chat memory

1. New Tables
- `consent_records`
  - `id` (uuid, primary key)
  - `user_id` (uuid, links to auth.users, nullable — set right after the account is created)
  - `email` (text, not null) — the email that accepted the terms
  - `accepted_at` (timestamptz, not null) — exact moment consent was given
  - `policy_version` (text, not null, default '2024-12') — version of Privacy Policy / Terms accepted
  - `user_agent` (text) — browser/device info for audit purposes
- `support_conversations`
  - `id` (uuid, primary key)
  - `user_id` (uuid, not null, defaults to the authenticated user)
  - `topic` (text) — last detected topic (deposit, complaint, numbers, etc.)
  - `created_at` / `updated_at` (timestamptz)
- `support_messages`
  - `id` (uuid, primary key)
  - `conversation_id` (uuid, not null, FK to support_conversations, cascade delete)
  - `user_id` (uuid, not null, defaults to the authenticated user)
  - `role` (text, not null) — 'user' or 'assistant'
  - `content` (text, not null)
  - `meta` (jsonb) — optional structured context (kind, ticket ref, etc.)
  - `created_at` (timestamptz)

2. Security
- RLS enabled on all three tables.
- consent_records: users can read their own rows; inserts happen server-side only (service role).
- support_conversations / support_messages: owner-scoped SELECT, INSERT, UPDATE, DELETE for authenticated.
- service_role granted on all tables for the support-agent edge function.
- Indexes on user_id and conversation_id + created_at for fast history retrieval.

3. Notes
- Deposit/transaction/complaint memory is NOT duplicated here — the assistant reads the
  existing `transactions`, `pending_deposits`, `webhook_deposits` and `support_tickets`
  tables directly, so it always reflects real account state.
*/

CREATE TABLE IF NOT EXISTS consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  policy_version text NOT NULL DEFAULT '2024-12',
  user_agent text
);
CREATE INDEX IF NOT EXISTS idx_consent_records_email ON consent_records (email);
CREATE INDEX IF NOT EXISTS idx_consent_records_user ON consent_records (user_id);

CREATE TABLE IF NOT EXISTS support_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  topic text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_conversations_user ON support_conversations (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_messages_conversation ON support_messages (conversation_id, created_at);

ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON consent_records TO authenticated;
GRANT ALL ON consent_records TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON support_conversations TO authenticated;
GRANT ALL ON support_conversations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON support_messages TO authenticated;
GRANT ALL ON support_messages TO service_role;

DROP POLICY IF EXISTS "consent_read_own" ON consent_records;
CREATE POLICY "consent_read_own" ON consent_records
FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "conversations_select_own" ON support_conversations;
CREATE POLICY "conversations_select_own" ON support_conversations
FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "conversations_insert_own" ON support_conversations;
CREATE POLICY "conversations_insert_own" ON support_conversations
FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "conversations_update_own" ON support_conversations;
CREATE POLICY "conversations_update_own" ON support_conversations
FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "conversations_delete_own" ON support_conversations;
CREATE POLICY "conversations_delete_own" ON support_conversations
FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "messages_select_own" ON support_messages;
CREATE POLICY "messages_select_own" ON support_messages
FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "messages_insert_own" ON support_messages;
CREATE POLICY "messages_insert_own" ON support_messages
FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "messages_update_own" ON support_messages;
CREATE POLICY "messages_update_own" ON support_messages
FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "messages_delete_own" ON support_messages;
CREATE POLICY "messages_delete_own" ON support_messages
FOR DELETE TO authenticated USING (auth.uid() = user_id);
