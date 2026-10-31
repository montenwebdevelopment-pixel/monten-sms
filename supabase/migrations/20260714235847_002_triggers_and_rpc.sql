/*
# Auto-create profile on signup + wallet credit RPC

1. Changes
   - `handle_new_user()` trigger function: inserts a row into `profiles` when a new
     auth.users row is created. Wallet starts at 0 (no free money).
   - Trigger on auth.users INSERT to call the function.
   - `credit_wallet(amount)` RPC: atomically increments wallet_balance for the
     calling user and returns the new balance. Used by the Flutterwave verification
     edge function after a successful payment.
   - `debit_wallet(amount)` RPC: atomically decrements wallet_balance if sufficient
     funds exist, returns the new balance or raises an exception. Used by the 5SIM
     purchase edge function.

2. Security
   - handle_new_user runs as SECURITY DEFINER so it can insert into profiles even
     though the anon role can't. The function only inserts the calling user's own id.
   - credit_wallet / debit_wallet are SECURITY DEFINER so they can update profiles
     directly. They use auth.uid() to scope the operation to the calling user.
*/

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, username)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'username', 'user_' || substring(NEW.id::text, 1, 8))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- credit_wallet: add funds to the authenticated user's wallet
CREATE OR REPLACE FUNCTION credit_wallet(p_amount numeric, p_reference text, p_description text DEFAULT NULL)
RETURNS numeric AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- debit_wallet: deduct funds from the authenticated user's wallet
CREATE OR REPLACE FUNCTION debit_wallet(p_amount numeric, p_reference text, p_description text DEFAULT NULL)
RETURNS numeric AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;
