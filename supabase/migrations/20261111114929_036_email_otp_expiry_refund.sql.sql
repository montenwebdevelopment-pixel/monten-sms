/*
  # Email OTP: server-side 5-minute expiry + automatic refund

  ## What this does
  - `settle_email_otp_order` gains the `expired` status: set by the
    `email-otp-watcher` edge function when it force-cancels a `waiting` order
    whose 5-minute window lapsed. The WHERE status = 'waiting' clause is the
    single atomic claim, so a browser poll and the cron watcher can never both
    settle the same order. The wallet refund itself is deduped by the
    `refund_wallet_for_user` reference check (`mo_refund_<order_id>`), so a
    refund can never fire twice for one order.
  - Registers the `poll_email_otp_orders` pg_cron job (every minute) that calls
    the `email-otp-watcher` edge function. The function checks the LIVE MailOtp
    status before settling: a refund only fires after the provider confirms the
    order is terminal (timeout / cancelled / failed / deleted), so Monten SMS
    never refunds money the provider still holds.

  ## Notes
  - `pg_cron` and `pg_net` are installed in this project.
  - `verify_jwt = false` on the watcher lets the cron caller reach it.
*/

CREATE OR REPLACE FUNCTION public.settle_email_otp_order(
  p_order_id uuid,
  p_user_id uuid,
  p_status text,
  p_refund_reference text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('received','timeout','cancelled','failed','charged_free','expired') THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;
  UPDATE public.email_otp_orders
  SET status = p_status,
      updated_at = now()
  WHERE id = p_order_id
    AND user_id = p_user_id
    AND status = 'waiting';
  IF NOT FOUND THEN
    -- Already settled (or already has a code): safe to no-op for idempotency.
    RETURN;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.settle_email_otp_order(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_email_otp_order(uuid, uuid, text, text) TO service_role;

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'poll_email_otp_orders';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    'poll_email_otp_orders',
    '* * * * *',
    $net$
      SELECT net.http_get(
        url := 'https://egalqcwprmlyukzwnqyn.supabase.co/functions/v1/email-otp-watcher',
        headers := jsonb_build_object(
          'Content-Type', 'application/json'
        )
      )
    $net$
  );
END
$$;
