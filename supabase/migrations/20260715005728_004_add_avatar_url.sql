/*
# Add avatar_url to profiles + update trigger for Google OAuth

1. Changes
   - Add `avatar_url` column to `profiles` table (stores Google profile picture URL).
   - Update `handle_new_user()` trigger to:
     a) Save `avatar_url` from OAuth metadata (Google provides `avatar_url` or `picture`).
     b) Mark OAuth users as `email_verified = true` (Google already verified their email).
     c) Generate a username from the email prefix if none provided (Google users don't set a username).

2. Security
   - No RLS changes needed; the column is covered by existing owner-scoped policies.
*/

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url text;

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_full_name text;
  v_username text;
  v_avatar_url text;
  v_email_verified boolean;
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
  -- OAuth providers (Google) have already verified the email
  v_email_verified := COALESCE(
    (NEW.raw_user_meta_data->>'email_verified')::boolean,
    (NEW.confirmed_at IS NOT NULL)
  );

  INSERT INTO public.profiles (id, full_name, username, avatar_url, email_verified)
  VALUES (NEW.id, v_full_name, v_username, v_avatar_url, v_email_verified)
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(NULLIF(v_full_name, ''), profiles.full_name),
    avatar_url = COALESCE(v_avatar_url, profiles.avatar_url),
    email_verified = CASE WHEN v_email_verified THEN true ELSE profiles.email_verified END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
