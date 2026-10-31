/*
  # Atomic refund RPC for failed 5SIM orders

  ## Background
  A background worker periodically polls 5SIM for `purchased_numbers` rows whose
  status is still `waiting`. When 5SIM reports a terminal non-delivered state
  (CANCELED / TIMEOUT / BANNED), the worker must:
    1. Flip the row to a terminal status (`canceled` or `failed`).
    2. Refund `selling_price` to the owner's wallet.
    3. Record a `transactions` row of type `refund`.

  Today only the *user-initiated* cancel path (fivesim-proxy `POST /cancel/:id`)
  can do this, and it is split across two client round-trips (status update,
  then `refund_wallet_for_user`). The worker cannot reuse that path because the
  user is not present to call it. Doing the same two steps from the worker
  leaves a race window: a second worker run (or a user cancel in flight) could
  see the row still `waiting` between the status flip and the refund, causing a
  double refund, or could refund without ever flipping the status, leaving a
  refunded row that still looks "waiting".

  ## What this migration adds

  1. New SECURITY DEFINER function `public.settle_failed_number(
       p_purchased_number_id uuid,
       p_terminal_status text,
       p_failure_reason text DEFAULT NULL
     ) RETURNS jsonb`

     - Locks the `purchased_numbers` row with `FOR UPDATE`.
     - Refuses to act if the row is already in a terminal status
       (`received`, `canceled`, `failed`) or if an SMS code was already
       delivered (`sms_code IS NOT NULL`).
     - Only proceeds when the current status is a refundable state
       (`waiting`, `pending`).
     - Validates `p_terminal_status` is one of `canceled` / `failed`.
     - Computes a single idempotency reference `5sim_refund_<fivesim_id>` and
       calls the existing `refund_wallet_for_user` to credit the wallet and
       insert the `transactions` row. `refund_wallet_for_user` is itself
       idempotent on that reference, so re-runs from the worker are a no-op
       rather than a double refund.
     - Flips the row's `status` (and stores `p_failure_reason` nowhere yet —
       there is no column for it, so the value is accepted but unused; see
       note below) in the SAME transaction as the refund. The row update uses
       a guard (`status` still refundable AND `sms_code` IS NULL) so a
       concurrent user cancel cannot win the race: whichever call flips the
       row first proceeds to its own refund; the other sees a terminal status
       and bails out.
     - Returns a small JSONB result describing what happened:
         { ok: true, refunded: <amount>, terminal_status: <status>, tx_reference: <ref> }
       or
         { ok: false, reason: "already_terminal" | "not_refundable" | "no_such_row", status: <current_status> }

  2. Grants EXECUTE on `settle_failed_number` to the `authenticated` role is
     intentionally NOT added — the function is only for server-side use
     (the cron-triggered edge function runs with the service-role key, which
     bypasses RLS and grants). We revoke EXECUTE from PUBLIC/anon so a
     browser cannot call it directly.

  ## Notes
  - No new table, no new column. `p_failure_reason` is accepted for forward
    compatibility but is not persisted because adding a column is out of
    scope for this change; the worker can still log it on the function call
    side.
  - The function is safe to re-run: the `FOR UPDATE` lock plus the status
    guard plus the idempotent reference in `refund_wallet_for_user` mean a
    duplicate worker run credits the wallet exactly once and flips the row
    exactly once.
*/

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

  BEGIN
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
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.settle_failed_number(uuid, text, text) FROM PUBLIC, anon;
