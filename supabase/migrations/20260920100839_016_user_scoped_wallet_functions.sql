/*
  # User-scoped wallet functions for the edge functions

  1. Problem
     `debit_wallet_atomic` / `refund_wallet_atomic` key on `auth.uid()`, but
     fivesim-proxy invokes them with the service-role key, where `auth.uid()`
     is NULL. The UPDATE matches no row, the function raises, and the purchase
     and refund paths cannot work. Now that the client can no longer write
     `profiles.wallet_balance` directly, the server path must be correct.

     Separately, `refund_wallet_atomic` had no dedup, so a repeated cancel for
     the same number could pay out more than once.

  2. Changes
     - `debit_wallet_for_user(p_user_id, p_amount, p_reference, p_description)`:
       atomic balance-checked debit against an explicit user id, rejecting a
       duplicate reference.
     - `refund_wallet_for_user(p_user_id, p_amount, p_reference, p_description)`:
       atomic refund against an explicit user id, no-op when a completed
       transaction already exists for that reference.
     - Both validate that the amount is positive.

  3. Security
     - SECURITY DEFINER with `SET search_path = public`.
     - EXECUTE revoked from PUBLIC/anon/authenticated and granted only to
       service_role, so they are not callable from the browser.
*/

CREATE OR REPLACE FUNCTION public.debit_wallet_for_user(
  p_user_id uuid,
  p_amount numeric,
  p_reference text,
  p_description text DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_balance numeric;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.transactions
    WHERE reference = p_reference AND status = 'completed'
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_REFERENCE';
  END IF;

  UPDATE public.profiles
  SET wallet_balance = wallet_balance - p_amount,
      updated_at = now()
  WHERE id = p_user_id AND wallet_balance >= p_amount
  RETURNING wallet_balance INTO new_balance;

  IF new_balance IS NULL THEN
    RAISE EXCEPTION 'Insufficient wallet balance or profile not found';
  END IF;

  INSERT INTO public.transactions (user_id, type, amount, status, reference, description)
  VALUES (p_user_id, 'purchase', p_amount, 'completed', p_reference, p_description);

  RETURN new_balance;
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_wallet_for_user(
  p_user_id uuid,
  p_amount numeric,
  p_reference text,
  p_description text DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_balance numeric;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  -- Single-use claim: a completed transaction with this reference means the
  -- refund already happened, so this call is a no-op.
  IF EXISTS (
    SELECT 1 FROM public.transactions
    WHERE reference = p_reference AND status = 'completed'
  ) THEN
    SELECT wallet_balance INTO new_balance FROM public.profiles WHERE id = p_user_id;
    RETURN new_balance;
  END IF;

  UPDATE public.profiles
  SET wallet_balance = wallet_balance + p_amount,
      updated_at = now()
  WHERE id = p_user_id
  RETURNING wallet_balance INTO new_balance;

  IF new_balance IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  INSERT INTO public.transactions (user_id, type, amount, status, reference, description)
  VALUES (p_user_id, 'refund', p_amount, 'completed', p_reference, p_description);

  RETURN new_balance;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.debit_wallet_for_user(uuid, numeric, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.debit_wallet_for_user(uuid, numeric, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debit_wallet_for_user(uuid, numeric, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.refund_wallet_for_user(uuid, numeric, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refund_wallet_for_user(uuid, numeric, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_wallet_for_user(uuid, numeric, text, text) TO service_role;
