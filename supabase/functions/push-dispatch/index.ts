import { createClient } from "npm:@supabase/supabase-js@2";

const PUSH_SECRET = Deno.env.get("PUSH_NOTIFICATION_WEBHOOK_SECRET") ?? "";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const FCM_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_UNREGISTERED = "UNREGISTERED";

type PushCategory = "wallet" | "sms" | "email_purchase" | "account_security" | "promotions" | "system_updates";

interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string | null;
  push_category: PushCategory | null;
  push_route: string | null;
}

let cachedAccessToken: { value: string; expiresAt: number } | null = null;

function equalSecret(actual: string, expected: string): boolean {
  const length = Math.max(actual.length, expected.length);
  let difference = actual.length ^ expected.length;
  for (let i = 0; i < length; i++) {
    difference |= (actual.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  }
  return difference === 0;
}

function base64Url(value: Uint8Array | string): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function getGoogleAccessToken(clientEmail: string, privateKeyPem: string): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.value;
  }

  const privateKeyBase64 = privateKeyPem.replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const keyBytes = Uint8Array.from(atob(privateKeyBase64), (char) => char.charCodeAt(0));
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(JSON.stringify({
    iss: clientEmail,
    scope: FCM_SCOPE,
    aud: FCM_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }))}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(unsigned),
  );
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch(FCM_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) {
    console.error("[push-dispatch] Google OAuth token request failed:", response.status);
    throw new Error("Could not authenticate with Firebase Cloud Messaging.");
  }
  const result = await response.json();
  if (typeof result.access_token !== "string" || typeof result.expires_in !== "number") {
    throw new Error("Firebase returned an invalid OAuth response.");
  }
  cachedAccessToken = {
    value: result.access_token,
    expiresAt: Date.now() + result.expires_in * 1000,
  };
  return cachedAccessToken.value;
}

async function sha256(value: string): Promise<string> {
  const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function categoryEnabled(
  category: PushCategory,
  preferences: Record<string, unknown> | null,
): boolean {
  if (!preferences) return category !== "promotions";
  return preferences[category] !== false;
}

function safePushContent(notification: NotificationRow): { title: string; body: string; sensitive: boolean } {
  const content = `${notification.title} ${notification.message ?? ""}`;
  const sensitive = (["sms_otp", "email_otp"].includes(notification.type)
    && /received/i.test(notification.title))
    || /\b(?:otp|verification code|code)\b[^\d]{0,20}\d{4,8}\b/i.test(content)
    || /\b(?:code|otp)\s+received\b/i.test(notification.title);
  if (sensitive) {
    return {
      title: "Verification code ready",
      body: "A verification code is ready. Open MONTEN SMS to view it.",
      sensitive: true,
    };
  }
  return {
    title: notification.title.slice(0, 100),
    body: (notification.message || "You have a new update.").slice(0, 240),
    sensitive: false,
  };
}

async function sendToDevice(
  admin: ReturnType<typeof createClient>,
  notification: NotificationRow,
  token: string,
  accessToken: string,
  projectId: string,
): Promise<void> {
  const tokenHash = await sha256(token);
  const { data: existingDelivery, error: lookupError } = await admin
    .from("push_notification_deliveries")
    .select("status, updated_at, attempts")
    .eq("notification_id", notification.id)
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existingDelivery?.status === "sent") return;
  const maxAttempts = 8;
  if (existingDelivery?.status === "pending") {
    const pendingAge = Date.now() - Date.parse(existingDelivery.updated_at);
    if (!Number.isFinite(pendingAge) || pendingAge < 5 * 60_000) return;
    if (existingDelivery.attempts >= maxAttempts) {
      const { error } = await admin.from("push_notification_deliveries")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("notification_id", notification.id)
        .eq("token_hash", tokenHash)
        .eq("status", "pending")
        .eq("attempts", existingDelivery.attempts);
      if (error) throw error;
      return;
    }
    const { data: claimed, error } = await admin.from("push_notification_deliveries")
      .update({ attempts: existingDelivery.attempts + 1, updated_at: new Date().toISOString() })
      .eq("notification_id", notification.id)
      .eq("token_hash", tokenHash)
      .eq("status", "pending")
      .eq("attempts", existingDelivery.attempts)
      .select("notification_id")
      .maybeSingle();
    if (error) throw error;
    if (!claimed) return;
  } else {
    const { error: claimError } = await admin.from("push_notification_deliveries").insert({
      notification_id: notification.id,
      token_hash: tokenHash,
      status: "pending",
      attempts: 1,
    });
    if (claimError?.code === "23505") return;
    if (claimError) {
      console.error("[push-dispatch] Could not claim notification delivery:", claimError.message);
      throw claimError;
    }
  }

  const content = safePushContent(notification);
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: content.title, body: content.body },
          data: {
            notificationId: notification.id,
            category: notification.push_category ?? "system_updates",
            route: notification.push_route ?? "/dashboard/notifications",
            sensitive: String(content.sensitive),
          },
          android: {
            priority: "HIGH",
            notification: {
              channel_id: "monten_updates",
              tag: notification.id,
              visibility: "PRIVATE",
            },
          },
        },
      }),
    },
  );

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const details = Array.isArray(errorBody?.error?.details) ? errorBody.error.details : [];
    const unregistered = response.status === 404
      || details.some((detail: { errorCode?: string }) => detail.errorCode === FCM_UNREGISTERED);
    if (unregistered) {
      const { error } = await admin.from("push_device_tokens")
        .delete()
        .eq("user_id", notification.user_id)
        .eq("token", token);
      if (error) console.error("[push-dispatch] Could not remove an expired FCM token:", error.message);
    } else {
      console.error("[push-dispatch] FCM delivery failed:", response.status);
    }
    if (unregistered) {
      const { error: cleanupError } = await admin.from("push_notification_deliveries")
        .delete()
        .eq("notification_id", notification.id)
        .eq("token_hash", tokenHash);
      if (cleanupError) throw cleanupError;
      return;
    }
    const { error: retryUpdateError } = await admin.from("push_notification_deliveries")
      .update({ updated_at: new Date().toISOString() })
      .eq("notification_id", notification.id)
      .eq("token_hash", tokenHash)
      .eq("status", "pending");
    if (retryUpdateError) throw retryUpdateError;
    throw new Error(`FCM delivery failed with status ${response.status}.`);
  }

  const { error } = await admin.from("push_notification_deliveries")
    .update({ status: "sent", updated_at: new Date().toISOString() })
    .eq("notification_id", notification.id)
    .eq("token_hash", tokenHash);
  if (error) throw error;
}

async function dispatchNotification(
  admin: ReturnType<typeof createClient>,
  notificationId: string,
  accessToken: string,
  projectId: string,
): Promise<void> {
  const { data: notification, error: notificationError } = await admin
    .from("notifications")
    .select("id, user_id, type, title, message, push_category, push_route")
    .eq("id", notificationId)
    .maybeSingle();
  if (notificationError) throw notificationError;
  if (!notification?.push_category) return;

  const { data: preferences, error: preferencesError } = await admin
    .from("notification_preferences")
    .select("wallet, sms, email_purchase, account_security, promotions, system_updates")
    .eq("user_id", notification.user_id)
    .maybeSingle();
  if (preferencesError) throw preferencesError;
  if (!categoryEnabled(notification.push_category as PushCategory, preferences)) return;

  const { data: devices, error: devicesError } = await admin
    .from("push_device_tokens")
    .select("token")
    .eq("user_id", notification.user_id)
    .eq("platform", "android");
  if (devicesError) throw devicesError;
  if (!devices?.length) return;

  const row = notification as NotificationRow;
  const results = await Promise.allSettled(
    devices.map(({ token }) => sendToDevice(admin, row, token, accessToken, projectId)),
  );
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) throw new Error(`Push delivery failed for ${failures.length} device(s).`);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed.", { status: 405 });
  if (!PUSH_SECRET || !equalSecret(req.headers.get("x-push-secret") ?? "", PUSH_SECRET)) {
    return new Response("Unauthorized.", { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const projectId = Deno.env.get("FIREBASE_PROJECT_ID");
  const clientEmail = Deno.env.get("FIREBASE_CLIENT_EMAIL");
  const privateKey = Deno.env.get("FIREBASE_PRIVATE_KEY");
  if (!supabaseUrl || !serviceRoleKey || !projectId || !clientEmail || !privateKey) {
    console.error("[push-dispatch] Required server-side push configuration is missing.");
    return new Response("Push delivery is not configured.", { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const retryBatch = body?.retry === true;
  if (!retryBatch && (typeof body?.notificationId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.notificationId))) {
    return new Response("Invalid notification.", { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  try {
    const accessToken = await getGoogleAccessToken(clientEmail, privateKey);
    if (!retryBatch) {
      await dispatchNotification(admin, body.notificationId, accessToken, projectId);
      return new Response(null, { status: 204 });
    }

    const { data: pending, error } = await admin
      .from("push_notification_deliveries")
      .select("notification_id")
      .eq("status", "pending")
      .lte("updated_at", new Date(Date.now() - 5 * 60_000).toISOString())
      .order("updated_at", { ascending: true })
      .limit(100);
    if (error) throw error;

    const notificationIds = [...new Set((pending ?? []).map(({ notification_id }) => notification_id))];
    const results = await Promise.allSettled(
      notificationIds.map((id) => dispatchNotification(admin, id, accessToken, projectId)),
    );
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length) throw new Error(`Retry failed for ${failures.length} notification(s).`);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("[push-dispatch] Push dispatch failed:", error instanceof Error ? error.message : "unknown error");
    return new Response("Push dispatch failed.", { status: 502 });
  }
});
