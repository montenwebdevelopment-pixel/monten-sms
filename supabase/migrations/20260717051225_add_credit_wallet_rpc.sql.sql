/*
# Add credit_wallet RPC function

1. New Functions
- `credit_wallet(p_user_id uuid, p_amount numeric, p_reference text, p_description text)`
  - Atomically increments the user's `wallet_balance` in `profiles` and inserts a
    `deposit` row into `transactions` with status `completed`.
  - Designed to be called from the Flutterwave webhook edge function after a
    successful payment is verified.
  - Uses the service-role key (bypasses RLS), so no policy changes are needed.
  - Idempotent at the reference level: if a transaction with the same reference
    already exists and is completed, the function no-ops and returns its id.
2. Security
- No RLS changes. The function is `SECURITY DEFINER` so it runs with the
  service role's privileges regardless of the caller, which is appropriate
  because it is only invoked by the webhook edge function using the
  service-role key.
3. Important notes
- The `transactions.reference` column is UNIQUE, so duplicate webhook
  deliveries for the same `tx_ref` cannot create duplicate credits.
*/

CREATE OR REPLACE FUNCTION public.credit_wallet(
  p_user_id uuid,
  p_amount numeric,
  p_reference text,
  p_description text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
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
