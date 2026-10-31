/*
# Switch to Flutterwave Live Mode + Webhook-Based Crediting

1. New Tables
   - `pending_deposits` — tracks payments that have been verified but are awaiting
     webhook confirmation before the wallet is credited.
     Columns: id, user_id, transaction_id, amount, tx_ref, status, created_at, updated_at.
     Status flow: 'pending' (verified by verify endpoint) → 'credited' (webhook credits wallet)
     or 'failed' (webhook reports failure).

2. New Functions
   - `credit_wallet_for_user(p_user_id, p_amount, p_reference, p_description)` — credits a
     specific user's wallet. Used by the webhook edge function which has no user JWT.
     Same INSERT-first-then-UPDATE pattern as credit_wallet_atomic for race safety.

3. Security
   - RLS enabled on pending_deposits with owner-scoped SELECT and INSERT policies.
   - UPDATE/DELETE not exposed to authenticated users — only the service role (webhook)
     updates the status, and the service role bypasses RLS.
   - credit_wallet_for_user is SECURITY DEFINER, executable by authenticated (service role
     bypasses restrictions anyway).
*/

CREATE TABLE IF NOT EXISTS pending_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_id text NOT NULL UNIQUE,
  amount numeric NOT NULL,
  tx_ref text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'credited', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pending_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_deposits FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_pending_deposits" ON pending_deposits;
CREATE POLICY "select_own_pending_deposits" ON pending_deposits FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_pending_deposits" ON pending_deposits;
CREATE POLICY "insert_own_pending_deposits" ON pending_deposits FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_pending_deposits_user_id ON pending_deposits (user_id);
CREATE INDEX IF NOT EXISTS idx_pending_deposits_status ON pending_deposits (status);

-- Function for webhook to credit a specific user (no auth.uid() dependency)
CREATE OR REPLACE FUNCTION credit_wallet_for_user(p_user_id uuid, p_amount numeric, p_reference text, p_description text DEFAULT NULL)
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
  VALUES (p_user_id, 'deposit', p_amount, 'completed', p_reference, p_description)
  ON CONFLICT (reference) DO NOTHING
  RETURNING id INTO inserted_id;

  IF inserted_id IS NULL THEN
    RAISE EXCEPTION 'DUPLICATE_REFERENCE';
  END IF;

  UPDATE public.profiles
  SET wallet_balance = wallet_balance + p_amount
  WHERE id = p_user_id
  RETURNING wallet_balance INTO new_balance;

  IF new_balance IS NULL THEN
    DELETE FROM public.transactions WHERE id = inserted_id;
    RAISE EXCEPTION 'Profile not found';
  END IF;

  RETURN new_balance;
END;
$$;

REVOKE EXECUTE ON FUNCTION credit_wallet_for_user(uuid, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION credit_wallet_for_user(uuid, numeric, text, text) TO authenticated;
