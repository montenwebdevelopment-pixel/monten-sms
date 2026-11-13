/*
  # Schedule the developer webhook dispatcher (every minute)

  1. Plain-English summary
  - Registers a `pg_cron` job named `dispatch_developer_webhooks` that fires
    every minute.
  - Each tick calls the deployed `webhook-dispatcher` edge function via
    `pg_net`. The dispatcher picks up pending developer webhook deliveries,
    signs them with HMAC-SHA256 (X-Monten-Signature) and POSTs them to the
    developer's endpoint, with retries after 1, 5 and 30 minutes.

  2. Security
  - `verify_jwt = false` on the function lets the cron caller reach it without
    a user JWT, matching the existing `order-watcher` pattern.
  - The dispatcher is idempotent: deliveries are claimed atomically before
    sending, so overlapping ticks cannot double-send.

  3. Notes
  - Safe to re-apply: any prior schedule with the same name is dropped first.
*/

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'dispatch_developer_webhooks';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    'dispatch_developer_webhooks',
    '* * * * *',
    $net$
      SELECT net.http_get(
        url := 'https://egalqcwprmlyukzwnqyn.supabase.co/functions/v1/webhook-dispatcher',
        headers := jsonb_build_object(
          'Content-Type', 'application/json'
        )
      )
    $net$
  );
END
$$;
