/*
# Security Fixes: Atomic Wallet Operations + Function Hardening

1. Changes
   - Create `credit_wallet_atomic(p_amount, p_reference, p_description)` — atomically
     credits the wallet using UPDATE ... RETURNING, eliminating the read-then-write
     race condition in flutterwave-verify.
   - Create `debit_wallet_atomic(p_amount, p_reference, p_description)` — atomically
     debits the wallet with a balance check in a single UPDATE, eliminating the
     read-then-write race condition in fivesim-proxy purchase.
   - Create `refund_wallet_atomic(p_amount, p_reference, p_description)` — atomically
     refunds the wallet, eliminating the race condition in fivesim-proxy cancel.
   - Add `search_path = public` to `update_updated_at()` trigger function.
   - Add a unique constraint on `purchased_numbers.fivesim_id` to prevent duplicate
     purchases at the database level (defense-in-depth against race conditions).

2. Security
   - All new functions are SECURITY DEFINER with `search_path = public`.
   - Execute permissions revoked from PUBLIC, granted to authenticated only.
   - The atomic UPDATE ... RETURNING pattern ensures wallet balance changes are
     serialized at the row level — concurrent requests cannot interleave reads
     and writes to produce inconsistent balances.
   - The unique constraint on fivesim_id prevents double-purchase even if two
     concurrent requests pass the balance check.

3. Notes
   - The old credit_wallet/debit_wallet functions are kept for backward compatibility
     but edge functions are updated to use the new atomic versions.
   - All atomic functions raise an exception on failure (insufficient balance,
     profile not found) so the caller can handle the error.
*/

-- Atomic credit: single UPDATE eliminates TOCTOU race
CREATE OR REPLACE FUNCTION credit_wallet_atomic(p_amount numeric, p_reference text, p_description text DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_balance numeric;
BEGIN
  UPDATE public.profiles
  SET wallet_balance = wallet_balance + p_amount
  WHERE id = auth.uid()
  RETURNING wallet_balance INTO new_balance;

  IF new_balance IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  INSERT INTO public.transactions (user_id, type, amount, status, reference, description)
  VALUES (auth.uid(), 'deposit', p_amount, 'completed', p_reference, p_description);

  RETURN new_balance;
END;
$$;

-- Atomic debit: single UPDATE with balance check eliminates TOCTOU race
CREATE OR REPLACE FUNCTION debit_wallet_atomic(p_amount numeric, p_reference text, p_description text DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_balance numeric;
BEGIN
  UPDATE public.profiles
  SET wallet_balance = wallet_balance - p_amount
  WHERE id = auth.uid() AND wallet_balance >= p_amount
  RETURNING wallet_balance INTO new_balance;

  IF new_balance IS NULL THEN
    -- Either profile doesn't exist or insufficient balance
    RAISE EXCEPTION 'Insufficient wallet balance or profile not found';
  END IF;

  INSERT INTO public.transactions (user_id, type, amount, status, reference, description)
  VALUES (auth.uid(), 'purchase', p_amount, 'completed', p_reference, p_description);

  RETURN new_balance;
END;
$$;

-- Atomic refund: single UPDATE eliminates TOCTOU race
CREATE OR REPLACE FUNCTION refund_wallet_atomic(p_amount numeric, p_reference text, p_description text DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_balance numeric;
BEGIN
  UPDATE public.profiles
  SET wallet_balance = wallet_balance + p_amount
  WHERE id = auth.uid()
  RETURNING wallet_balance INTO new_balance;

  IF new_balance IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  INSERT INTO public.transactions (user_id, type, amount, status, reference, description)
  VALUES (auth.uid(), 'refund', p_amount, 'completed', p_reference, p_description);

  RETURN new_balance;
END;
$$;

-- Fix: add search_path to update_updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Re-apply triggers to pick up the new function definition
DROP TRIGGER IF EXISTS trigger_profiles_updated_at ON profiles;
CREATE TRIGGER trigger_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trigger_purchased_numbers_updated_at ON purchased_numbers;
CREATE TRIGGER trigger_purchased_numbers_updated_at BEFORE UPDATE ON purchased_numbers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Revoke public execute on new atomic functions, grant to authenticated
REVOKE EXECUTE ON FUNCTION credit_wallet_atomic(numeric, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION debit_wallet_atomic(numeric, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refund_wallet_atomic(numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION credit_wallet_atomic(numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION debit_wallet_atomic(numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION refund_wallet_atomic(numeric, text, text) TO authenticated;

-- Defense-in-depth: unique constraint on fivesim_id prevents double-purchase
-- Only apply to non-null values (partial index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchased_numbers_fivesim_id_unique
  ON purchased_numbers (fivesim_id)
  WHERE fivesim_id IS NOT NULL;
