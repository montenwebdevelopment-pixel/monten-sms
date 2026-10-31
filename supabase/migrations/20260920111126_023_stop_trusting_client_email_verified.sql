/*
  # 023 — Stop trusting client-supplied email_verified at signup

  ## Problem
  `handle_new_user()` read `email_verified` from `NEW.raw_user_meta_data`, which is
  the `options.data` object the browser passes to `supabase.auth.signUp()`. Any
  caller could therefore create an account that is recorded as having a verified
  email address without a code ever being sent or entered.

  ## Change
  `email_verified` is now derived only from columns the auth service controls:
  `NEW.email_confirmed_at`, falling back to `NEW.confirmed_at`. Google sign-ins
  keep working because Supabase sets `email_confirmed_at` for them, so no
  legitimate user loses the verified state they have today.

  Everything else in the function (full name, username de-collision, avatar,
  conflict handling) is unchanged.
*/

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- Derived from auth-service columns only. raw_user_meta_data is written by the
  -- browser and must never decide verification state.
  v_email_verified := (NEW.email_confirmed_at IS NOT NULL) OR (NEW.confirmed_at IS NOT NULL);

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
$function$;
