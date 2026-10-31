/*
# Enforce case-insensitive uniqueness for profile usernames

1. Problem
   `profiles_username_key` is UNIQUE on the raw `username` column and the
   `handle_new_user()` collision guard compares with `username = v_username`.
   Both are case-sensitive, so two accounts can hold the same effective
   handle differing only by capitalisation or surrounding whitespace. This
   already happened in live data: `monet500` and `MONET500` are two
   different accounts.

2. Fix
   - Trim whitespace from existing usernames.
   - Resolve existing case-insensitive duplicates by keeping the handle on
     the oldest account and appending a short id-derived suffix to the
     newer ones. No account is deleted and no other column is touched.
   - Add a unique index on `lower(btrim(username))` so the collision can
     never be created again.
   - Rewrite `handle_new_user()` so its collision guard is case-insensitive
     and the existing suffix path actually fires.

3. Security
   - No RLS or policy changes. No grant changes.
   - Trigger stays SECURITY DEFINER with a fixed search_path, and continues
     to derive email_verified from auth-service columns only.
*/

-- 1. Normalise surrounding whitespace.
UPDATE public.profiles
SET username = btrim(username)
WHERE username IS NOT NULL AND username <> btrim(username);

-- 2. Resolve existing case-insensitive duplicates, keeping the oldest holder.
DO $$
DECLARE
  r RECORD;
  v_candidate text;
BEGIN
  FOR r IN
    SELECT id, username
    FROM (
      SELECT id, username,
             row_number() OVER (
               PARTITION BY lower(username)
               ORDER BY created_at, id
             ) AS rn
      FROM public.profiles
      WHERE username IS NOT NULL
    ) ranked
    WHERE rn > 1
  LOOP
    -- Deterministic, collision-checked suffix derived from the account id.
    v_candidate := r.username || '_' || substr(replace(r.id::text, '-', ''), 1, 4);
    WHILE EXISTS (
      SELECT 1 FROM public.profiles
      WHERE lower(username) = lower(v_candidate)
    ) LOOP
      v_candidate := r.username || '_' || substr(md5(random()::text), 1, 6);
    END LOOP;

    UPDATE public.profiles SET username = v_candidate WHERE id = r.id;
  END LOOP;
END $$;

-- 3. Make the collision unrepresentable.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_key
  ON public.profiles (lower(btrim(username)));

-- 4. Make the trigger's collision guard case-insensitive.
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
  v_suffix text;
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

  -- Derived from auth-service columns only. raw_user_meta_data is written by
  -- the browser and must never decide verification state.
  v_email_verified := (NEW.email_confirmed_at IS NOT NULL) OR (NEW.confirmed_at IS NOT NULL);

  -- Keep the handle inside the bounds the CHECK constraint enforces.
  v_username := regexp_replace(v_username, '[^A-Za-z0-9._-]', '', 'g');
  IF length(v_username) < 3 THEN
    v_username := 'user_' || substr(replace(NEW.id::text, '-', ''), 1, 8);
  END IF;
  v_username := substr(v_username, 1, 24);

  -- Case-insensitive collision guard: compare the way the unique index does.
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
