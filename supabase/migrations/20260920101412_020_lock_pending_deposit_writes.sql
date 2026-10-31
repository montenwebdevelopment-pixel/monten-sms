/*
  # Make deposit records server-written only

  1. Problem
     `authenticated` could INSERT and UPDATE `public.pending_deposits`, so a
     signed-in user could invent a deposit row (or flip one to "credited")
     without any money having been received.

  2. Changes
     - Revoke INSERT, UPDATE, DELETE on `public.pending_deposits` from `anon`
       and `authenticated`; SELECT is kept so the funding screen can poll its
       own deposit status.
     - Drop the client write policies.

  3. Notes
     flutterwave-verify and flutterwave-webhook write this table with the
     service-role key and are unaffected.
*/

REVOKE INSERT, UPDATE, DELETE ON public.pending_deposits FROM anon, authenticated;

DROP POLICY IF EXISTS "insert_own_pending_deposits" ON public.pending_deposits;
DROP POLICY IF EXISTS "update_own_pending_deposits" ON public.pending_deposits;
DROP POLICY IF EXISTS "delete_own_pending_deposits" ON public.pending_deposits;
