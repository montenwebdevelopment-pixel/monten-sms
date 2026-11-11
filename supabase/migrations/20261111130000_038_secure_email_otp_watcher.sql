/*
  Secure the scheduled email OTP watcher.

  Store the same random value as:
  - the Edge Function secret `EMAIL_OTP_WATCHER_SECRET`; and
  - a Supabase Vault secret named `email_otp_watcher_secret`.
*/

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

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
      SELECT net.http_post(
        url := 'https://egalqcwprmlyukzwnqyn.supabase.co/functions/v1/email-otp-watcher',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-watcher-secret', COALESCE(
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_otp_watcher_secret' LIMIT 1),
            ''
          )
        ),
        body := '{}'::jsonb
      )
    $net$
  );
END
$$;
