/*
  # Make the transaction ledger read-only for the browser

  1. Problem
     `authenticated` held INSERT/UPDATE/DELETE on `public.transactions` with
     owner-scoped policies, so any signed-in user could fabricate, edit or
     delete their own ledger entries — including inventing a completed deposit
     or erasing a purchase. The ledger must only be written by the server.

  2. Changes
     - Revoke INSERT, UPDATE, DELETE on `public.transactions` from `anon` and
       `authenticated`. SELECT is kept so the dashboard and transaction list
       keep working.
     - Drop the client write policies.

  3. Notes
     All legitimate writes go through SECURITY DEFINER wallet functions and
     edge functions using the service-role key, which are unaffected by these
     grants.
*/

REVOKE INSERT, UPDATE, DELETE ON public.transactions FROM anon, authenticated;

DROP POLICY IF EXISTS "insert_own_transactions" ON public.transactions;
DROP POLICY IF EXISTS "update_own_transactions" ON public.transactions;
DROP POLICY IF EXISTS "delete_own_transactions" ON public.transactions;
