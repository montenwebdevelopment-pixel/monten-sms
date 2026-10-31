/*
  # Restrict which profile columns the client may write

  1. Problem
     `profiles` granted INSERT/UPDATE/DELETE on ALL columns to `anon` and
     `authenticated`. RLS restricts which ROWS a user reaches, not which
     COLUMNS they write, so the `update_own_profile` policy
     (USING auth.uid() = id) let any signed-in user set their own
     `wallet_balance` and `email_verified` straight through the Data API.
     This defeated migration 011, which revoked EXECUTE on the wallet
     RPCs precisely to stop self-crediting.

  2. Changes
     - Revoke INSERT, UPDATE, DELETE on public.profiles from anon, authenticated.
     - Re-grant UPDATE on only (full_name, username, avatar_url) to authenticated,
       which is exactly what the profile screen writes.
     - Drop insert_own_profile: rows are created by the handle_new_user trigger
       (SECURITY DEFINER), never by the client.

  3. Security
     - wallet_balance and email_verified become server-only columns. The wallet
       functions are SECURITY DEFINER owned by postgres and are unaffected.
     - SELECT is untouched, so every existing read keeps working.
*/

REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM authenticated;

GRANT UPDATE (full_name, username, avatar_url) ON public.profiles TO authenticated;

DROP POLICY IF EXISTS "insert_own_profile" ON public.profiles;
