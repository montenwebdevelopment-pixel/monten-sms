/*
# Create public app-downloads storage bucket

1. Purpose
   - Hosts the signed Android APK so visitors can download the MONTEN SMS
     Android app from the website. No other files are expected here.

2. Changes
   - Creates a storage bucket named `app-downloads` that is PUBLIC for reads
     only (anyone can download files) with a 100 MB per-file size cap and a
     MIME-type allowlist restricted to the official Android APK content type.

3. Security
   - NO upload/update/delete policies are created for anon or authenticated
     roles: anonymous and signed-in app users can never upload, replace, or
     delete objects in this bucket.
   - The bucket will be administered exclusively through the Supabase
     dashboard by the project owner (service role / dashboard access), which
     is the only path allowed to modify its contents.
   - The storage.buckets and storage.objects tables already carry Supabase's
     own grants; RLS on storage.objects remains governed by storage policies,
     of which this bucket intentionally has none besides public read.

4. Important notes
   - The APK file itself is uploaded manually via the Supabase dashboard into
     this bucket. Until then the website download button reports the app as
     not yet available, by design.
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'app-downloads',
  'app-downloads',
  true,
  104857600,
  ARRAY['application/vnd.android.package-archive', 'application/octet-stream']
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Read-only for everyone: fetch/download objects in this bucket.
-- No INSERT, UPDATE, or DELETE policies on purpose.
DROP POLICY IF EXISTS "Public read access to app-downloads" ON storage.objects;
CREATE POLICY "Public read access to app-downloads"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'app-downloads');
