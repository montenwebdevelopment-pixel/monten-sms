import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const authorization = req.headers.get("Authorization");
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return jsonResponse({ error: "Unauthorized." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[push-device] Supabase server configuration is missing.");
    return jsonResponse({ error: "Push registration is unavailable." }, 503);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await admin.auth.getUser(accessToken);
  if (authError || !authData.user) return jsonResponse({ error: "Unauthorized." }, 401);

  const body = await req.json().catch(() => null);
  if (!body || typeof body.action !== "string") {
    return jsonResponse({ error: "Invalid request." }, 400);
  }

  if (body.action === "register") {
    if (typeof body.token !== "string" || body.token.length < 20 || body.token.length > 4096 || /[\s\u0000-\u001f]/.test(body.token)) {
      return jsonResponse({ error: "Invalid device token." }, 400);
    }

    const { error } = await admin.from("push_device_tokens").upsert(
      { token: body.token, user_id: authData.user.id, platform: "android", updated_at: new Date().toISOString() },
      { onConflict: "token" },
    );
    if (error) {
      console.error("[push-device] Device registration failed:", error.message);
      return jsonResponse({ error: "Could not register this device." }, 500);
    }
    return jsonResponse({ ok: true });
  }

  if (body.action === "unregister") {
    if (typeof body.token !== "string" || body.token.length < 20 || body.token.length > 4096) {
      return jsonResponse({ error: "Invalid device token." }, 400);
    }
    const { error } = await admin.from("push_device_tokens")
      .delete()
      .eq("user_id", authData.user.id)
      .eq("token", body.token);
    if (error) {
      console.error("[push-device] Device unregistration failed:", error.message);
      return jsonResponse({ error: "Could not unregister this device." }, 500);
    }
    return jsonResponse({ ok: true });
  }

  if (body.action === "security_event") {
    if (body.event !== "login" && body.event !== "password_changed") {
      return jsonResponse({ error: "Invalid security event." }, 400);
    }
    const sessionHash = await digest(accessToken);
    const isLogin = body.event === "login";
    const eventKey = `security:${body.event}:${sessionHash}`;
    const { data: existing, error: lookupError } = await admin
      .from("notifications")
      .select("id")
      .eq("user_id", authData.user.id)
      .eq("event_key", eventKey)
      .maybeSingle();
    if (lookupError) {
      console.error("[push-device] Security alert lookup failed:", lookupError.message);
      return jsonResponse({ error: "Could not record this security alert." }, 500);
    }

    if (existing) return jsonResponse({ ok: true });

    const { error } = await admin.from("notifications").insert({
      user_id: authData.user.id,
      type: "account_security",
      title: isLogin ? "New sign-in" : "Password changed",
      message: isLogin
        ? "Your MONTEN SMS account was signed in to."
        : "Your MONTEN SMS account password was changed.",
      push_category: "account_security",
      push_route: "/dashboard/account-settings",
      event_key: eventKey,
    });
    if (error) {
      if (error.code === "23505") return jsonResponse({ ok: true });
      console.error("[push-device] Security alert could not be recorded:", error.message);
      return jsonResponse({ error: "Could not record this security alert." }, 500);
    }
    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: "Unsupported action." }, 400);
});
