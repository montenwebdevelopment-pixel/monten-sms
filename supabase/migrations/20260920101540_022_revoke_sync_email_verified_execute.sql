/*
  # Make the verification sync trigger non-callable from the API

  1. Problem
     `public.sync_email_verified()` was created as a SECURITY DEFINER trigger
     function and, by default, EXECUTE was granted to PUBLIC, making it
     reachable at /rest/v1/rpc/sync_email_verified.

  2. Changes
     - Revoke EXECUTE from PUBLIC, anon and authenticated. The trigger itself
       still fires, because triggers do not require an EXECUTE grant.
*/

REVOKE EXECUTE ON FUNCTION public.sync_email_verified() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_email_verified() FROM anon, authenticated;
