/*
  # Record why 5SIM ended a number

  1. Modified Tables
    - `purchased_numbers`: new nullable column `failure_reason` (text). It holds the
      exact status 5SIM reported (e.g. TIMEOUT, BANNED, CANCELED) when a number
      was ended without an SMS. Existing rows stay NULL.
  2. Modified Functions
    - `settle_failed_number` now saves `p_failure_reason` into that column in the
      same step as the refund. Refund logic, guards and permissions are unchanged
      (server-only).
  3. Security
    - No grant changes. Customers cannot write this column; only the server
      routine sets it.
*/

ALTER TABLE public.purchased_numbers ADD COLUMN IF NOT EXISTS failure_reason text;

CREATE OR REPLACE FUNCTION public.settle_failed_number(
  p_purchased_number_id uuid,
  p_terminal_status text,
  p_failure_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row RECORD;
  v_refund_amount numeric;
  v_reference text;
  v_new_balance numeric;
  v_tx_reference text;
BEGIN
  IF p_terminal_status NOT IN ('canceled', 'failed') THEN
    RAISE EXCEPTION 'INVALID_TERMINAL_STATUS';
  END IF;

  SELECT id, user_id, fivesim_id, selling_price, status, sms_code
    INTO v_row
    FROM public.purchased_numbers
    WHERE id = p_purchased_number_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_such_row');
  END IF;

  IF v_row.status IN ('received', 'canceled', 'failed') OR v_row.sms_code IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_terminal', 'status', v_row.status);
  END IF;

  IF v_row.status NOT IN ('waiting', 'pending') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_refundable', 'status', v_row.status);
  END IF;

  v_refund_amount := v_row.selling_price;
  v_reference := '5sim_refund_' || COALESCE(v_row.fivesim_id, v_row.id::text);

  IF v_refund_amount IS NOT NULL AND v_refund_amount > 0 THEN
    SELECT refund_wallet_for_user(v_row.user_id, v_refund_amount, v_reference, 'Auto-refund for failed 5SIM order')
      INTO v_new_balance;
    v_tx_reference := v_reference;
  END IF;

  UPDATE public.purchased_numbers
    SET status = p_terminal_status,
        failure_reason = left(p_failure_reason, 64),
        updated_at = now()
    WHERE id = v_row.id
      AND status IN ('waiting', 'pending')
      AND sms_code IS NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'refunded', COALESCE(v_refund_amount, 0),
    'terminal_status', p_terminal_status,
    'tx_reference', v_tx_reference
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.settle_failed_number(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_failed_number(uuid, text, text) TO service_role;