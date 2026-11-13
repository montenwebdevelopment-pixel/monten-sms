# MONTEN SMS Admin Dashboard

This is a separate Vite application for the restricted dashboard at
`/admin/monten500`. Its entry point and build configuration live here; the
dashboard screens are kept in `src/admin` and are not included in the Android
customer build.

## Build

From the repository root, provide `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`, then run:

```sh
npm run typecheck
npm run build:admin:standalone
```

The static output is written to `dist-admin/`. The Admin Dashboard Build GitHub
Actions workflow packages this directory as `admin-dashboard.zip`.

The archive is built for the `/admin/monten500/` path. The main website build
also places the admin app at `dist/admin/monten500/` and its redirects support
direct navigation to dashboard pages.

## Security

The frontend uses only the Supabase anonymous key. Administrative data is
requested through the `admin-api` Edge Function, which validates the signed-in
administrator server-side and accesses protected tables with server-held
credentials. Never add a service-role key or other backend secret to this app.
