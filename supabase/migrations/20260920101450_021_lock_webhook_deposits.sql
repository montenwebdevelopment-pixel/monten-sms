/*
  # Close the webhook deposit log off from the browser

  1. Problem
     `public.webhook_deposits` is exposed through the Data API with row level
     security enabled but no policy, and the `anon`/`authenticated` roles still
     hold table privileges. It records raw payment provider events for every
     user and should never be reachable from a browser.

  2. Changes
     - Revoke ALL privileges on `public.webhook_deposits` from `anon` and
       `authenticated`.
     - Add an explicit deny-all SELECT policy so the intent is recorded and the
       "RLS enabled, no policy" advisor finding is resolved.

  3. Notes
     flutterwave-webhook writes this table with the service-role key, which
     bypasses both grants and policies.
*/

REVOKE ALL ON public.webhook_deposits FROM anon, authenticated;

ALTER TABLE public.webhook_deposits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny_all_webhook_deposits" ON public.webhook_deposits;
CREATE POLICY "deny_all_webhook_deposits" ON public.webhook_deposits
  FOR SELECT TO anon, authenticated USING (false);
