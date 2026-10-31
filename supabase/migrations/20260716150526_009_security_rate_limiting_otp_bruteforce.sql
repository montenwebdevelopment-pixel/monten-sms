/*
# Security Fixes: Rate Limiting, OTP Brute-Force Protection, Atomic Credit Fix

1. New Tables
   - `rate_limits` — tracks API call timestamps per user+endpoint for rate limiting.

2. Changes
   - Add `attempts` column to `email_otps` — tracks failed OTP verification attempts.
   - Fix credit_wallet_atomic: INSERT transaction first (ON CONFLICT DO NOTHING), then UPDATE wallet.
   - Fix debit_wallet_atomic: INSERT first, then UPDATE. Delete transaction if insufficient balance.
   - Fix refund_wallet_atomic: INSERT first, then UPDATE.
   - Restrict get_user_id_by_email to only return caller's own user ID.
   - Add RLS on rate_limits (owner-scoped).
*/

-- 1. Rate limits table
CREATE TABLE IF NOT EXISTS rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_rate_limits" ON rate_limits;
CREATE POLICY "select_own_rate_limits" ON rate_limits FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_rate_limits" ON rate_limits;
CREATE POLICY "insert_own_rate_limits" ON rate_limits FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_rate_limits" ON rate_limits;
CREATE POLICY "delete_own_rate_limits" ON rate_limits FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_rate_limits_user_endpoint_time
  ON rate_limits (user_id, endpoint, created_at);

-- 2. Add attempts column to email_otps
ALTER TABLE email_otps ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

-- 3. Fix credit_wallet_atomic: INSERT first, then UPDATE
CREATE OR REPLACE FUNCTION credit_wallet_atomic(p_amount numeric, p_reference text, p_description text DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_balance numeric;
  inserted_id uuid;
BEGIN
  INSERT INTO public.transactions (user_id, type, amount, status, reference, description)
  VALUES (auth.uid(), 'deposit', p_amount, 'completed', p_reference, p_description)
  ON CONFLICT (reference) DO NOTHING
  RETURNING id INTO inserted_id;

  IF inserted_id IS NULL THEN
    RAISE EXCEPTION 'DUPLICATE_REFERENCE';
  END IF;

  UPDATE public.profiles
  SET wallet_balance = wallet_balance + p_amount
  WHERE id = auth.uid()
  RETURNING wallet_balance INTO new_balance;

  IF new_balance IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  RETURN new_balance;
END;
$$;

-- 4. Fix debit_wallet_atomic: INSERT first, then UPDATE
CREATE OR REPLACE FUNCTION debit_wallet_atomic(p_amount numeric, p_reference text, p_description text DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_balance numeric;
  inserted_id uuid;
BEGIN
  INSERT INTO public.transactions (user_id, type, amount, status, reference, description)
  VALUES (auth.uid(), 'purchase', p_amount, 'completed', p_reference, p_description)
  ON CONFLICT (reference) DO NOTHING
  RETURNING id INTO inserted_id;

  IF inserted_id IS NULL THEN
    RAISE EXCEPTION 'DUPLICATE_REFERENCE';
  END IF;

  UPDATE public.profiles
  SET wallet_balance = wallet_balance - p_amount
  WHERE id = auth.uid() AND wallet_balance >= p_amount
  RETURNING wallet_balance INTO new_balance;

  IF new_balance IS NULL THEN
    DELETE FROM public.transactions WHERE id = inserted_id;
    RAISE EXCEPTION 'Insufficient wallet balance';
  END IF;

  RETURN new_balance;
END;
$$;

-- 5. Fix refund_wallet_atomic: INSERT first, then UPDATE
CREATE OR REPLACE FUNCTION refund_wallet_atomic(p_amount numeric, p_reference text, p_description text DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_balance numeric;
  inserted_id uuid;
BEGIN
  INSERT INTO public.transactions (user_id, type, amount, status, reference, description)
  VALUES (auth.uid(), 'refund', p_amount, 'completed', p_reference, p_description)
  ON CONFLICT (reference) DO NOTHING
  RETURNING id INTO inserted_id;

  IF inserted_id IS NULL THEN
    RAISE EXCEPTION 'DUPLICATE_REFERENCE';
  END IF;

  UPDATE public.profiles
  SET wallet_balance = wallet_balance + p_amount
  WHERE id = auth.uid()
  RETURNING wallet_balance INTO new_balance;

  IF new_balance IS NULL THEN
    DELETE FROM public.transactions WHERE id = inserted_id;
    RAISE EXCEPTION 'Profile not found';
  END IF;

  RETURN new_balance;
END;
$$;

-- 6. Restrict get_user_id_by_email: only return own user ID
CREATE OR REPLACE FUNCTION get_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_caller_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT email INTO v_caller_email FROM auth.users WHERE id = auth.uid();
  IF v_caller_email IS NULL OR v_caller_email <> p_email THEN
    RAISE EXCEPTION 'Not authorized to look up this email';
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE email = p_email LIMIT 1;
  RETURN v_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_user_id_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_user_id_by_email(text) TO authenticated;
