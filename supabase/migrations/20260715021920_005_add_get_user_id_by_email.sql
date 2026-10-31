/*
# Add get_user_id_by_email RPC function

1. New Functions
   - `get_user_id_by_email(text)` — returns the auth.users id for a given email address.
   - Used by the send-otp edge function to look up the user_id from an email
     so it can update the profile's email_verified flag after OTP verification.

2. Security
   - SECURITY DEFINER so it can read from auth.users (which is not accessible by anon).
   - No RLS changes needed.
*/

CREATE OR REPLACE FUNCTION public.get_user_id_by_email(p_email text)
RETURNS uuid AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = p_email LIMIT 1;
  RETURN v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
