-- Fix email_otps RLS: lock down so only the edge function (service role) can access
-- The edge function uses the service role key which bypasses RLS entirely.
-- Client-side never needs direct access to this table.

-- Drop the insecure policies
DROP POLICY IF EXISTS "select_otp" ON email_otps;
DROP POLICY IF EXISTS "insert_otp" ON email_otps;
DROP POLICY IF EXISTS "update_otp" ON email_otps;

-- No policies needed: only the service role (edge functions) accesses this table.
-- With RLS enabled and no policies, client-side access is fully blocked.
-- Service role bypasses RLS, so edge functions still work.

-- Add a restrictive policy as defense-in-depth (deny by default, no explicit allow)
-- This ensures even if someone tries to query via anon key, nothing is returned.
CREATE POLICY "deny_all_email_otps" ON email_otps
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);
