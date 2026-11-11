# Android APK hosting

The signed APK is hosted in the Supabase Storage bucket `app-downloads`
(public read only). The website route /downloads/monten-sms.apk 301-redirects
to the storage object.

## Uploading the APK (via Supabase dashboard)

1. Open the Supabase dashboard for this project.
2. Go to Storage -> app-downloads.
3. Upload the signed release APK and rename it to exactly:
       monten-sms.apk
   (lowercase, no version suffix — the website links to this exact name.)
4. Verify: https://montensms.com/downloads/monten-sms.apk starts a download
   and the file installs on a real Android phone.

To publish a new version, upload the new file and replace the existing
object (dashboard-only action; the public can never write here).
