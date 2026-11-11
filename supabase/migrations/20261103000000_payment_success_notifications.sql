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
  existing_user_id uuid;
  existing_type text;
  existing_amount numeric;
  existing_status text;
  new_tx_id uuid;
  credited_amount numeric;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;

  IF p_reference IS NULL OR btrim(p_reference) = '' THEN
    RAISE EXCEPTION 'Reference is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_reference)::bigint);

  SELECT id, user_id, type, amount, status
  INTO existing_tx_id, existing_user_id, existing_type, existing_amount, existing_status
  FROM public.transactions
  WHERE reference = p_reference
  LIMIT 1;

  IF FOUND THEN
    IF existing_status <> 'completed'
      OR existing_user_id <> p_user_id
      OR existing_type <> 'deposit'
      OR existing_amount <> round(p_amount, 2)
    THEN
      RAISE EXCEPTION 'Reference is already associated with a different transaction';
    END IF;

    RETURN existing_tx_id;
  END IF;

  UPDATE public.profiles
  SET wallet_balance = wallet_balance + p_amount,
      updated_at = now()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet profile not found';
  END IF;

  INSERT INTO public.transactions (user_id, type, amount, status, reference, description)
  VALUES (p_user_id, 'deposit', p_amount, 'completed', p_reference, p_description)
  RETURNING id, amount INTO new_tx_id, credited_amount;

  INSERT INTO public.notifications (user_id, type, title, message)
  VALUES (
    p_user_id,
    'deposit',
    'Payment successful',
    'Your payment of ₦' || to_char(credited_amount, 'FM999,999,999,990.00')
      || ' was successful and has been added to your wallet balance.'
  );

  RETURN new_tx_id;
END;
$$;
