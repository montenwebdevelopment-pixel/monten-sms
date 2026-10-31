/*
  # Make purchased_numbers server-written only

  1. Problem
     `purchased_numbers` granted INSERT/UPDATE/DELETE on ALL columns to the
     client roles. Two consequences:
       a) `selling_price` is the amount the cancel endpoint refunds
          (fivesim-proxy reads it back out of the row), so a user could set it
          to any value and then cancel to be paid that amount.
       b) `status` is the "already cancelled" guard in the same endpoint, so a
          user could reset it to 'waiting' and re-enter the refund path.

  2. Changes
     - Revoke INSERT, UPDATE, DELETE on public.purchased_numbers from
       anon, authenticated. SELECT is retained.
     - Drop the now-unreachable client write policies.

  3. Security
     - All writes move to the edge function's service-role client, which
       bypasses RLS and grants. Ownership is still checked there against the
       authenticated caller's id before any row is touched.
*/

REVOKE INSERT, UPDATE, DELETE ON public.purchased_numbers FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.purchased_numbers FROM authenticated;

DROP POLICY IF EXISTS "insert_own_numbers" ON public.purchased_numbers;
DROP POLICY IF EXISTS "update_own_numbers" ON public.purchased_numbers;
DROP POLICY IF EXISTS "delete_own_numbers" ON public.purchased_numbers;
