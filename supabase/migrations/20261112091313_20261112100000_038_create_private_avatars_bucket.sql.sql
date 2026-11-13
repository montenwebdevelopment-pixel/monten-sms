/*
# Create private avatars storage bucket for profile photos

1. Purpose
   - Lets each signed-in user upload a profile photo from the account
     settings (Profile) page. Photos are stored per-user in a PRIVATE
     storage bucket and served through short-lived signed URLs, so other
     users and anonymous visitors can never browse someone's uploads.

2. Changes
   - Creates a storage bucket named `avatars` that is PRIVATE (no public
     reads) with a 5 MB per-file size cap and a MIME-type allowlist
     restricted to real image types (jpeg, png, webp).

3. Security
   - Owner-only access, enforced by row-level policies on storage.objects:
     - SELECT: a signed-in user may read/list only files whose path starts
       with their own auth.uid().
     - INSERT: a signed-in user may upload only into their own folder
       (path starts with auth.uid()) and only the allowed image types
       (also enforced by the bucket allowlist).
     - UPDATE / DELETE: a signed-in user may modify or remove only their
       own files.
   - No anon policies: signed-out visitors have zero access to the bucket.
   - Database grant note: profiles.avatar_url was already made writable by
     the owner in an earlier migration (014), so no profile change is
     needed here — the client writes only the avatar_url column.

4. Important notes
   - Files are stored at `<user_id>/<filename>` so the path prefix is a
     reliable ownership boundary.
   - The app generates a signed URL for display; signed URLs expire, so
     the stored avatar_url remains the storage path, not the URL.
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Read/list only own folder (needed to mint signed URLs for own files).
DROP POLICY IF EXISTS "select_own_avatars" ON storage.objects;
CREATE POLICY "select_own_avatars"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Upload only into own folder, images only.
DROP POLICY IF EXISTS "insert_own_avatars" ON storage.objects;
CREATE POLICY "insert_own_avatars"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND (metadata->>'mimetype') IN ('image/jpeg', 'image/png', 'image/webp')
);

-- Replace own avatar file (upsert of the same path).
DROP POLICY IF EXISTS "update_own_avatars" ON storage.objects;
CREATE POLICY "update_own_avatars"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Remove own avatar file.
DROP POLICY IF EXISTS "delete_own_avatars" ON storage.objects;
CREATE POLICY "delete_own_avatars"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
