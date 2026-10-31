-- Service-role-only function to look up a user ID by email.
-- The edge function (send-otp) calls this with the service role key to
-- resolve a user's UUID from their email address without requiring a
-- user session. SECURITY DEFINER + no EXECUTE grant to anon/authenticated
-- means only the service role can call it.
CREATE OR REPLACE FUNCTION public.get_user_id_by_email_service(p_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = lower(p_email) LIMIT 1;
  RETURN v_user_id;
END;
$$;

-- Only the service role (postgres) can execute this — not anon or authenticated.
REVOKE EXECUTE ON FUNCTION public.get_user_id_by_email_service(text) FROM anon, authenticated;
