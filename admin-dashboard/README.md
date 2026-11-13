# MONTEN SMS Admin Dashboard

This is a separate Vite application for the restricted dashboard at
`/admin/monten500`. Its entry point, browser-only Supabase client, styles and
build configuration live here. The admin screens are kept in `src/admin` and
are not included in the customer web or Android bundles.

## Build

From the repository root, provide `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`, then run:

```sh
npx tsc --noEmit -p admin-dashboard/tsconfig.json
npm run build:admin:standalone
```

The static output is written to `dist-admin/`. The Admin Dashboard Build GitHub
Actions workflow packages this directory as `admin-dashboard.zip`.

The standalone archive is built for `/admin/monten500/`. Extract its contents
to that path on the static host and configure the host to serve `index.html`
for dashboard routes. The separate Admin Dashboard Build workflow creates the
ZIP artifact; it does not deploy to or rebuild the customer website.

The existing production redirect for `/admin/monten500` is in place, but the
live route currently falls back to the customer website because the published
site does not contain the admin `index.html` and assets at that path. Deploy
the contents of the admin ZIP to the host's `/admin/monten500/` directory to
serve the admin app there. This is an admin-only static-file deployment; do not
replace the customer site's root build.

## Android app releases

The private App Management page uploads `.apk` and `.aab` releases into the
private `app-release-files` Storage bucket. Uploads are validated and saved as
drafts; publishing requires an explicit confirmation and only updates the
dashboard release catalog. It does not submit a bundle to Google Play. AAB
files are intended for Play distribution and are not directly installable.

Apply the `app_release_management` database migration before using release
management. The admin API issues short-lived upload/download URLs only after
server-side administrator verification.

## Security

The frontend uses only the Supabase anonymous key. Administrative data is
requested through the `admin-api` Edge Function, which validates the signed-in
administrator server-side and accesses protected tables with server-held
credentials. Never add a service-role key or other backend secret to this app.
