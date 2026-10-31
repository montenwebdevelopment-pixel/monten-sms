/*
# Revert auto-confirm: enable email verification flow

The previous migration (027) made handle_new_user auto-set email_confirmed_at
and confirmed_at on every new signup, and set profiles.email_verified = true.
This bypassed the email verification flow entirely.

This migration reverts that so:
1. handle_new_user no longer touches auth.users confirmation columns.
2. New profiles get email_verified = false by default.
3. The send-otp edge function is the only thing that confirms emails
   (after the user enters the correct 6-digit code).

Existing users keep their current email_verified state — this only affects
new signups going forward.
*/

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name text;
  v_username text;
  v_avatar_url text;
  v_suffix text;
  v_email_verified boolean;
BEGIN
  v_full_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    ''
  );
  v_username := btrim(COALESCE(
    NEW.raw_user_meta_data->>'username',
    split_part(NEW.email, '@', 1)
  ));
  v_avatar_url := COALESCE(
    NEW.raw_user_meta_data->>'avatar_url',
    NEW.raw_user_meta_data->>'picture',
    NULL
  );

  -- Derived from auth-service columns only. New users start unverified;
  -- the send-otp edge function confirms them after they enter the code.
  v_email_verified := (NEW.email_confirmed_at IS NOT NULL) OR (NEW.confirmed_at IS NOT NULL);

  -- Keep the handle inside the bounds the CHECK constraint enforces.
  v_username := regexp_replace(v_username, '[^A-Za-z0-9._-]', '', 'g');
  IF length(v_username) < 3 THEN
    v_username := 'user_' || substr(replace(NEW.id::text, '-', ''), 1, 8);
  END IF;
  v_username := substr(v_username, 1, 24);

  -- Case-insensitive collision guard.
  WHILE EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(btrim(username)) = lower(v_username) AND id <> NEW.id
  ) LOOP
    v_suffix := substr(md5(random()::text), 1, 4);
    v_username := substr(v_username, 1, 24 - (length(v_suffix) + 1)) || '_' || v_suffix;
  END LOOP;

  INSERT INTO public.profiles (id, full_name, username, avatar_url, email_verified)
  VALUES (NEW.id, v_full_name, v_username, v_avatar_url, v_email_verified)
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(NULLIF(v_full_name, ''), profiles.full_name),
    avatar_url = COALESCE(v_avatar_url, profiles.avatar_url),
    email_verified = CASE WHEN v_email_verified THEN true ELSE profiles.email_verified END;

  RETURN NEW;
END;
$$;
