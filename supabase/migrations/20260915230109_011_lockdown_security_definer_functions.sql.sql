/*
# Lockdown SECURITY DEFINER Functions

1. Problem
   The Supabase security advisor flagged 21 issues: every SECURITY DEFINER
   function in the public schema was callable by the `anon` and `authenticated`
   roles via the REST API (`/rest/v1/rpc/...`). This meant any unauthenticated
   user could invoke `credit_wallet`, `debit_wallet`, `refund_wallet_atomic`,
   etc. directly and manipulate wallet balances. Additionally, one overload of
   `credit_wallet` had a mutable `search_path`.

2. Changes
   - Fix `credit_wallet(uuid, numeric, text, text)` to set `search_path = public`.
   - Revoke EXECUTE from PUBLIC (covers anon + authenticated) on ALL
     SECURITY DEFINER functions:
       * credit_wallet(numeric, text, text)
       * credit_wallet(uuid, numeric, text, text)
       * credit_wallet_atomic(numeric, text, text)
       * credit_wallet_for_user(uuid, numeric, text, text)
       * debit_wallet(numeric, text, text)
       * debit_wallet_atomic(numeric, text, text)
       * refund_wallet_atomic(numeric, text, text)
       * get_user_id_by_email(text)
       * handle_new_user()
       * update_updated_at()
   - Do NOT re-grant EXECUTE to `authenticated`. The edge functions that call
     these RPCs use the service-role key, which bypasses permission checks.
     Trigger functions (handle_new_user, update_updated_at) are invoked by
     PostgreSQL internally, not via RPC, so they don't need EXECUTE grants.

3. Security
   - After this migration, none of these functions are callable via the REST
     API by any client. Only the service-role key (used in edge functions) and
     internal triggers can invoke them.
   - This closes all 21 security advisor findings.
*/

-- 1. Fix the credit_wallet(uuid,...) overload that has a mutable search_path
CREATE OR REPLACE FUNCTION public.credit_wallet(
  p_user_id uuid,
  p_amount numeric,
  p_reference text,
  p_description text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_tx_id uuid;
  new_tx_id uuid;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;

  SELECT id INTO existing_tx_id
  FROM public.transactions
  WHERE reference = p_reference AND status = 'completed'
  LIMIT 1;

  IF existing_tx_id IS NOT NULL THEN
    RETURN existing_tx_id;
  END IF;

  UPDATE public.profiles
  SET wallet_balance = wallet_balance + p_amount,
      updated_at = now()
  WHERE id = p_user_id;

  INSERT INTO public.transactions (user_id, type, amount, status, reference, description)
  VALUES (p_user_id, 'deposit', p_amount, 'completed', p_reference, p_description)
  RETURNING id INTO new_tx_id;

  RETURN new_tx_id;
END;
$$;

-- 2. Revoke EXECUTE from PUBLIC on ALL SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.credit_wallet(numeric, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.credit_wallet(uuid, numeric, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.credit_wallet_atomic(numeric, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.credit_wallet_for_user(uuid, numeric, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.debit_wallet(numeric, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.debit_wallet_atomic(numeric, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refund_wallet_atomic(numeric, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_id_by_email(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_updated_at() FROM PUBLIC;

-- Also explicitly revoke from anon and authenticated to be thorough
REVOKE EXECUTE ON FUNCTION public.credit_wallet(numeric, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.credit_wallet(uuid, numeric, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.credit_wallet_atomic(numeric, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.credit_wallet_for_user(uuid, numeric, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.debit_wallet(numeric, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.debit_wallet_atomic(numeric, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refund_wallet_atomic(numeric, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_user_id_by_email(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at() FROM anon, authenticated;
