# Android push notifications

The Android client uses Firebase Cloud Messaging through Capacitor. Supabase
stores authenticated device tokens and preferences; the `push-dispatch` Edge
Function sends messages with the Firebase HTTP v1 API. OTP values are never
included in push payloads.

## Firebase setup

1. Create or select a Firebase project and register an Android app with package
   name `com.montensms.app`.
2. Enable the Firebase Cloud Messaging API and download that app's
   `google-services.json` into `android/app/google-services.json`. Do not commit
   this file; it is local Firebase client configuration.
3. Create a dedicated Firebase service account with permission to send FCM
   messages. Store its project ID, client email, and private key as Supabase
   Edge Function secrets named `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
   and `FIREBASE_PRIVATE_KEY`. Never put the service-account key in the app or
   repository. Preserve or convert escaped `\n` sequences in the private key
   to line breaks when saving the secret.
4. Generate a long random webhook secret. Store it as the Edge Function secret
   `PUSH_NOTIFICATION_WEBHOOK_SECRET`, and create a Supabase Vault secret with
   the same value and name `push_notification_webhook_secret`. The database
   trigger uses this secret to authenticate calls to `push-dispatch`.

## Supabase deployment

Apply the migrations, deploy `push-device` and `push-dispatch`, and set the
secrets above. `push-device` requires JWT verification; `push-dispatch` has
JWT verification disabled because the database webhook authenticates with the
Vault-backed shared secret. The migration schedules a one-minute retry worker
for transient delivery failures; a device notification is retried up to eight
times with a five-minute delay between attempts.

Build and install a new Android app after adding `google-services.json`.
Users must allow notifications in Android and can control categories under
**Account Settings → Push notifications**. Promotions are off by default.
