/*
  # Schedule the 5SIM order watcher (every minute)

  ## What this does
  - Registers a `pg_cron` job named `poll_5sim_orders` that fires every minute.
  - Each tick calls the deployed `order-watcher` edge function via `pg_net`
    (`net.http_get`). The edge function polls 5SIM for `purchased_numbers` rows
    still in `waiting`/`pending`, marks any that received an SMS code as
    `received`, and atomically refunds + flips the status of any that 5SIM
    reports as CANCELED / TIMEOUT / BANNED via the `settle_failed_number` RPC.
  - Safe to re-apply: any prior schedule with the same name is dropped first,
    guarded so a missing job does not raise.

  ## Notes
  - `verify_jwt = false` on the function lets the cron caller reach it without
    a user JWT.
  - `pg_cron` and `pg_net` are both installed in this project.
*/

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  -- Drop the prior schedule if it exists (idempotent re-apply).
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'poll_5sim_orders';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    'poll_5sim_orders',
    '* * * * *',
    $net$
      SELECT net.http_get(
        url := 'https://egalqcwprmlyukzwnqyn.supabase.co/functions/v1/order-watcher',
        headers := jsonb_build_object(
          'Content-Type', 'application/json'
        )
      )
    $net$
  );
END
$$;
