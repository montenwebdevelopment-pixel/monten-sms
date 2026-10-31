/*
# Security Hardening Migration

1. FORCE ROW LEVEL SECURITY on all tables (prevents table owner from bypassing RLS)
2. Add missing DELETE policies on transactions and notifications
3. Lock down SECURITY DEFINER functions with search_path = public
4. Restrict get_user_id_by_email to authenticated only (prevent anon enumeration)
5. Revoke public execute on credit_wallet/debit_wallet/get_user_id_by_email
6. Ensure email_otps deny-all policy is in place
*/

-- 1. FORCE RLS on all tables
ALTER TABLE profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE purchased_numbers FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE email_otps FORCE ROW LEVEL SECURITY;

-- 2. Add missing DELETE policies
DROP POLICY IF EXISTS "delete_own_transactions" ON transactions;
CREATE POLICY "delete_own_transactions" ON transactions FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_notifications" ON notifications;
CREATE POLICY "delete_own_notifications" ON notifications FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- 3. Lock down SECURITY DEFINER functions with explicit search_path
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

  INSERT INTO public.profiles (id, full_name, username, avatar_url, email_verified)
  VALUES (NEW.id, v_full_name, v_username, v_avatar_url, v_email_verified)
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(NULLIF(v_full_name, ''), profiles.full_name),
    avatar_url = COALESCE(v_avatar_url, profiles.avatar_url),
    email_verified = CASE WHEN v_email_verified THEN true ELSE profiles.email_verified END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION credit_wallet(p_amount numeric, p_reference text, p_description text DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_balance numeric;
BEGIN
  UPDATE public.profiles
  SET wallet_balance = wallet_balance + p_amount
  WHERE id = auth.uid()
  RETURNING wallet_balance INTO new_balance;

  INSERT INTO public.transactions (user_id, type, amount, status, reference, description)
  VALUES (auth.uid(), 'deposit', p_amount, 'completed', p_reference, p_description);

  RETURN new_balance;
END;
$$;

CREATE OR REPLACE FUNCTION debit_wallet(p_amount numeric, p_reference text, p_description text DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_balance numeric;
  new_balance numeric;
BEGIN
  SELECT wallet_balance INTO current_balance FROM public.profiles WHERE id = auth.uid();
  IF current_balance IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;
  IF current_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient wallet balance';
  END IF;

  UPDATE public.profiles
  SET wallet_balance = wallet_balance - p_amount
  WHERE id = auth.uid()
  RETURNING wallet_balance INTO new_balance;

  INSERT INTO public.transactions (user_id, type, amount, status, reference, description)
  VALUES (auth.uid(), 'purchase', p_amount, 'completed', p_reference, p_description);

  RETURN new_balance;
END;
$$;

-- 4. Restrict get_user_id_by_email to authenticated only + search_path
CREATE OR REPLACE FUNCTION get_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT id INTO v_user_id FROM auth.users WHERE email = p_email LIMIT 1;
  RETURN v_user_id;
END;
$$;

-- 5. Revoke public/anon execute on sensitive functions, grant to authenticated only
REVOKE EXECUTE ON FUNCTION credit_wallet(numeric, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION debit_wallet(numeric, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_user_id_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION credit_wallet(numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION debit_wallet(numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_id_by_email(text) TO authenticated;

-- 6. Ensure email_otps deny-all policy exists (defense in depth)
DROP POLICY IF EXISTS "deny_all_email_otps" ON email_otps;
CREATE POLICY "deny_all_email_otps" ON email_otps
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);
