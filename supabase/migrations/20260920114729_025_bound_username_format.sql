/*
# Bound the username column server-side

1. Problem
   `profiles.username` is plain text with only a uniqueness constraint. The
   only length/format guard in the product is `val.length < 3` in the
   registration screen, which is browser-side and skipped entirely by a
   direct Data API call. A signed-in caller can therefore store a username
   of arbitrary length, or one padded with whitespace and control
   characters to shadow another account's handle.

2. Fix
   Add a CHECK constraint bounding the handle to 3-24 characters drawn from
   letters, digits, dot, underscore and hyphen. This matches the handles the
   registration screen already produces and the value `handle_new_user()`
   now generates, so no existing row and no legitimate flow is affected
   (verified: 0 of 10 existing rows violate the pattern).

3. Security
   - No RLS, policy or grant changes.
*/

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_username_format_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_format_check
  CHECK (username IS NULL OR username ~ '^[A-Za-z0-9._-]{3,24}$');
