/*
  # Make the rate limit ledger server-only

  1. Problem
     `public.rate_limits` was reachable from the browser with owner-scoped
     policies, so a signed-in user could delete their own rate limit rows and
     defeat the purchase and lookup throttles the server relies on.

  2. Changes
     - Revoke ALL privileges on `public.rate_limits` from `anon` and
       `authenticated`.
     - Drop the client policies and add an explicit deny-all policy.

  3. Notes
     The only writer is fivesim-proxy, which uses the service-role key and
     bypasses both grants and policies.
*/

REVOKE ALL ON public.rate_limits FROM anon, authenticated;

DROP POLICY IF EXISTS "select_own_rate_limits" ON public.rate_limits;
DROP POLICY IF EXISTS "insert_own_rate_limits" ON public.rate_limits;
DROP POLICY IF EXISTS "update_own_rate_limits" ON public.rate_limits;
DROP POLICY IF EXISTS "delete_own_rate_limits" ON public.rate_limits;

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny_all_rate_limits" ON public.rate_limits;
CREATE POLICY "deny_all_rate_limits" ON public.rate_limits
  FOR SELECT TO anon, authenticated USING (false);
