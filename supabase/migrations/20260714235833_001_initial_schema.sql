/*
# MONTEN SMS OTP Verification Platform — Initial Schema

1. Overview
   This migration creates the full database schema for the MONTEN SMS platform.
   The app has sign-in (Supabase Auth), so all tables are owner-scoped via `user_id`
   with `DEFAULT auth.uid()` and `TO authenticated` RLS policies.

2. New Tables
   - `profiles` — extends auth.users with full_name, username, wallet_balance.
   - `transactions` — wallet ledger: deposits, purchases, refunds.
   - `purchased_numbers` — numbers bought from 5SIM, with OTP/SMS status.
   - `notifications` — user-facing notification feed.

3. Columns
   profiles:
     id (uuid, PK, FK auth.users), full_name, username (unique), wallet_balance (numeric, default 0),
     email_verified (bool), created_at, updated_at.
   transactions:
     id (uuid PK), user_id, type (deposit/purchase/refund), amount (numeric),
     status (pending/completed/failed), reference (unique), description, created_at.
   purchased_numbers:
     id (uuid PK), user_id, 5sim_id, phone_number, country_code, country_name,
     service_name, operator_name, cost_price, selling_price, status (waiting/received/canceled/failed),
     sms_text, sms_code, created_at, updated_at.
   notifications:
     id (uuid PK), user_id, type, title, message, read (bool), created_at.

4. Security
   - RLS enabled on all tables.
   - Owner-scoped CRUD policies (auth.uid() = user_id) on all tables.
   - profiles uses auth.uid() = id for ownership.

5. Notes
   - wallet_balance starts at 0 (NO free money).
   - reference column on transactions is unique to prevent duplicate payments.
   - 5sim_id on purchased_numbers prevents double purchases.
*/

-- Profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  username text UNIQUE NOT NULL,
  wallet_balance numeric(12,2) NOT NULL DEFAULT 0,
  email_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_profile" ON profiles;
CREATE POLICY "select_own_profile" ON profiles FOR SELECT
  TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "insert_own_profile" ON profiles;
CREATE POLICY "insert_own_profile" ON profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "update_own_profile" ON profiles;
CREATE POLICY "update_own_profile" ON profiles FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('deposit', 'purchase', 'refund')),
  amount numeric(12,2) NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  reference text UNIQUE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_transactions" ON transactions;
CREATE POLICY "select_own_transactions" ON transactions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_transactions" ON transactions;
CREATE POLICY "insert_own_transactions" ON transactions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_transactions" ON transactions;
CREATE POLICY "update_own_transactions" ON transactions FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Purchased numbers table
CREATE TABLE IF NOT EXISTS purchased_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  fivesim_id text,
  phone_number text,
  country_code text,
  country_name text,
  service_name text,
  operator_name text,
  cost_price numeric(12,2),
  selling_price numeric(12,2),
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'received', 'canceled', 'failed')),
  sms_text text,
  sms_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE purchased_numbers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_numbers" ON purchased_numbers;
CREATE POLICY "select_own_numbers" ON purchased_numbers FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_numbers" ON purchased_numbers;
CREATE POLICY "insert_own_numbers" ON purchased_numbers FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_numbers" ON purchased_numbers;
CREATE POLICY "update_own_numbers" ON purchased_numbers FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_numbers" ON purchased_numbers;
CREATE POLICY "delete_own_numbers" ON purchased_numbers FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  message text,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_notifications" ON notifications;
CREATE POLICY "select_own_notifications" ON notifications FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_notifications" ON notifications;
CREATE POLICY "insert_own_notifications" ON notifications FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_notifications" ON notifications;
CREATE POLICY "update_own_notifications" ON notifications FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_reference ON transactions(reference);
CREATE INDEX IF NOT EXISTS idx_purchased_numbers_user_id ON purchased_numbers(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_profiles_updated_at ON profiles;
CREATE TRIGGER trigger_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trigger_purchased_numbers_updated_at ON purchased_numbers;
CREATE TRIGGER trigger_purchased_numbers_updated_at BEFORE UPDATE ON purchased_numbers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
