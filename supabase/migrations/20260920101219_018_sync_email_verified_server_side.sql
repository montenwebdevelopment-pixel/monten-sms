/*
  # Set email_verified from the real confirmation, not from the browser

  1. Problem
     `profiles.email_verified` was set by the browser after the confirmation
     redirect, so any signed-in user could mark themselves verified without
     ever receiving a confirmation email. Column writes are already revoked;
     this migration supplies the trustworthy server-side source.

  2. Changes
     - `public.sync_email_verified()`: trigger function that mirrors
       `auth.users.email_confirmed_at` onto `public.profiles.email_verified`.
     - Trigger `on_auth_user_email_confirmed` on `auth.users` AFTER UPDATE.
     - Backfill existing rows from `auth.users.email_confirmed_at`.

  3. Security
     SECURITY DEFINER with `SET search_path = public`; it is a trigger function
     and is not callable from the Data API.
*/

CREATE OR REPLACE FUNCTION public.sync_email_verified()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL
     AND (OLD.email_confirmed_at IS NULL OR OLD.email_confirmed_at <> NEW.email_confirmed_at) THEN
    UPDATE public.profiles SET email_verified = true, updated_at = now() WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_email_confirmed
AFTER UPDATE ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.sync_email_verified();

UPDATE public.profiles p
SET email_verified = true
FROM auth.users u
WHERE u.id = p.id AND u.email_confirmed_at IS NOT NULL AND p.email_verified IS DISTINCT FROM true;
