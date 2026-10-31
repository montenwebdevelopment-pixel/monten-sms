-- Allow the anon/authenticated roles to resolve a username to an email
-- for the login page (which accepts either email or username). This does
-- NOT expose the email to the client — it only accepts a username and
-- returns the corresponding email so signInWithPassword can be called.
-- SECURITY DEFINER so it can read auth.users via the profiles join.
CREATE OR REPLACE FUNCTION public.get_email_by_username(p_username text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  SELECT u.email INTO v_email
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE lower(p.username) = lower(p_username)
  LIMIT 1;
  RETURN v_email;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_email_by_username(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_email_by_username(text) TO anon, authenticated;
