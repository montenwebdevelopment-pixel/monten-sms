/*
  # Lock down failed-number refunds and remove a dead scheduled job

  1. Security
    - `settle_failed_number` refunds a wallet. Signed-in customers could call it
      directly on their own still-active number and get a refund while keeping
      the number. Only the server (service role) may run it now.
  2. Cleanup
    - Removes the scheduled job that calls `refund_failed_purchases()`, a routine
      that no longer exists, so the job was failing every minute. Refunds are
      handled by the order-watcher job and the live status check.
*/

REVOKE EXECUTE ON FUNCTION public.settle_failed_number(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_failed_number(uuid, text, text) TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE command ILIKE '%refund_failed_purchases%';
END $$;