/*
# Fix handle_new_user trigger for Google OAuth username collisions

1. Problem
   The `handle_new_user()` trigger sets `username` to
   `COALESCE(raw_user_meta_data->>'username', split_part(email, '@', 1))`.
   For Google OAuth users there is no `username` in user_metadata, so it
   falls back to the email prefix (e.g. "john" from "[email protected]").
   The `profiles.username` column has a UNIQUE constraint. If two users
   share the same email prefix, the second INSERT fails with a unique
   violation, which prevents the profile row from being created and breaks
   the Google sign-in flow for that user.

2. Fix
   When the fallback username collides with an existing one, append a
   short random suffix (4 hex chars) to make it unique. This only applies
   to OAuth users who don't supply an explicit username — email/password
   registrations pass their own `username` in user_metadata and are
   unaffected.

3. Security
   - No RLS or policy changes.
   - Trigger function remains SECURITY DEFINER with search_path = public.
*/

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name text;
  v_username text;
  v_avatar_url text;
  v_email_verified boolean;
  v_username_taken boolean;
  v_suffix text;
BEGIN
  v_full_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    ''
  );
  v_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    split_part(NEW.email, '@', 1)
  );
  v_avatar_url := COALESCE(
    NEW.raw_user_meta_data->>'avatar_url',
    NEW.raw_user_meta_data->>'picture',
    NULL
  );
  v_email_verified := COALESCE(
    (NEW.raw_user_meta_data->>'email_verified')::boolean,
    (NEW.confirmed_at IS NOT NULL)
  );

  -- If this username already exists and the user is not the owner, append a suffix
  SELECT EXISTS(
    SELECT 1 FROM public.profiles
    WHERE username = v_username AND id <> NEW.id
  ) INTO v_username_taken;

  IF v_username_taken THEN
    v_suffix := substr(md5(random()::text), 1, 4);
    v_username := v_username || '_' || v_suffix;
  END IF;

  INSERT INTO public.profiles (id, full_name, username, avatar_url, email_verified)
  VALUES (NEW.id, v_full_name, v_username, v_avatar_url, v_email_verified)
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(NULLIF(v_full_name, ''), profiles.full_name),
    avatar_url = COALESCE(v_avatar_url, profiles.avatar_url),
    email_verified = CASE WHEN v_email_verified THEN true ELSE profiles.email_verified END;
  RETURN NEW;
END;
$$;
