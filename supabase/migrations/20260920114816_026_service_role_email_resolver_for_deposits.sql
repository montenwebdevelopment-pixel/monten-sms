/*
# Add a service-role-only email resolver for deposit crediting

1. Problem
   The Flutterwave webhook tries to identify the depositing account with
   `profiles.email`, but `public.profiles` has no `email` column. The error
   is discarded, so the branch silently yields NULL on every call and every
   non-checkout deposit falls through to a weaker 8-character id-prefix
   match to choose which wallet to credit.

   The existing `get_user_id_by_email()` cannot serve this path: it requires
   `auth.uid()` to be present and equal to the address being looked up,
   which is never true for a webhook running as the service role.

2. Fix
   Add `resolve_deposit_user_by_email()`, which returns an account id only
   when exactly one confirmed auth user holds that address
   (case-insensitive). Ambiguous or unconfirmed addresses return NULL so the
   caller refuses rather than guessing a wallet.

3. Security
   - SECURITY DEFINER with a fixed search_path.
   - EXECUTE revoked from PUBLIC, anon and authenticated: only the service
     role (the webhook) can call it. It is never reachable from a browser.
   - An unconfirmed address is a claim, not an identity, so it never
     resolves to an account here.
*/

CREATE OR REPLACE FUNCTION public.resolve_deposit_user_by_email(p_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_matches integer;
  v_email text;
BEGIN
  v_email := lower(btrim(COALESCE(p_email, '')));
  IF v_email = '' THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO v_matches
  FROM auth.users
  WHERE lower(email) = v_email
    AND (email_confirmed_at IS NOT NULL OR confirmed_at IS NOT NULL);

  -- Exactly one confirmed holder, or nothing. Never guess.
  IF v_matches <> 1 THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = v_email
    AND (email_confirmed_at IS NOT NULL OR confirmed_at IS NOT NULL);

  RETURN v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_deposit_user_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_deposit_user_by_email(text) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_deposit_user_by_email(text) FROM authenticated;
