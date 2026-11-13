import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Developer dashboard API (browser, authenticated session). Manages API keys
// (secret shown exactly once), usage stats, transaction history, webhook
// registration and delivery logs. All queries are scoped to auth.uid().

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function fail(status: number, message: string): Response {
  return json({ error: message }, status);
}

function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
}

async function authenticate(req: Request, admin: any): Promise<{ userId: string } | null> {
  const header = req.headers.get("Authorization");
  if (!header) return null;
  const token = header.replace("Bearer ", "").trim();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return { userId: data.user.id };
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateKey(env: string): { full: string; prefix: string; hash: string } {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const rand = [...bytes].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 40);
  const full = `mk_${env}_${rand}`;
  return { full, prefix: full.slice(0, 14), hash: "" };
}

async function keys(admin: any, userId: string, req: Request, seg: string[]): Promise<Response> {
  if (req.method === "GET") {
    const { data, error } = await admin.from("developer_api_keys").select("id,name,key_prefix,environment,active,created_at,last_used_at,revoked_at").eq("user_id", userId).order("created_at", { ascending: false });
    if (error) return fail(500, error.message);
    return json({ keys: data ?? [] });
  }
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const env = body?.environment === "production" ? "live" : "test";
    const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim().slice(0, 50) : `${env === "live" ? "Production" : "Test"} key`;
    const { count } = await admin.from("developer_api_keys").select("*", { count: "exact", head: true }).eq("user_id", userId);
    if ((count ?? 0) >= 5) return fail(400, "Maximum of 5 API keys reached. Revoke one first.");
    const k = generateKey(env);
    const hash = await sha256Hex(k.full);
    const { data, error } = await admin.from("developer_api_keys").insert({
      user_id: userId, name, key_prefix: k.prefix, key_hash: hash, environment: env === "live" ? "production" : "test",
    }).select("id,name,key_prefix,environment,active,created_at").single();
    if (error) return fail(500, error.message);
    return json({ key: data, secret: k.full });
  }
  if (req.method === "DELETE" && seg[1]) {
    if (!/^[0-9a-f-]{36}$/i.test(seg[1])) return fail(400, "invalid id");
    const body = await req.json().catch(() => ({}));
    if (body?.regenerate) {
      const { data: existing } = await admin.from("developer_api_keys").select("name,environment").eq("id", seg[1]).eq("user_id", userId).maybeSingle();
      if (!existing) return fail(404, "Key not found.");
      const env = existing.environment === "production" ? "live" : "test";
      const k = generateKey(env);
      const hash = await sha256Hex(k.full);
      const { data, error } = await admin.from("developer_api_keys").update({
        key_hash: hash, key_prefix: k.prefix, active: true, revoked_at: null,
      }).eq("id", seg[1]).eq("user_id", userId).select("id,name,key_prefix,environment,active").single();
      if (error) return fail(500, error.message);
      return json({ key: data, secret: k.full });
    }
    const { error } = await admin.from("developer_api_keys").update({ active: false, revoked_at: new Date().toISOString() }).eq("id", seg[1]).eq("user_id", userId);
    if (error) return fail(500, error.message);
    return json({ ok: true });
  }
  if (req.method === "PUT" && seg[1]) {
    const body = await req.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};
    if (typeof body?.active === "boolean") {
      patch.active = body.active;
      patch.revoked_at = body.active ? null : new Date().toISOString();
    }
    if (Object.keys(patch).length === 0) return fail(400, "nothing to update");
    const { error } = await admin.from("developer_api_keys").update(patch).eq("id", seg[1]).eq("user_id", userId);
    if (error) return fail(500, error.message);
    return json({ ok: true });
  }
  return fail(405, "method not allowed");
}

async function stats(admin: any, userId: string): Promise<Response> {
  const since24 = new Date(Date.now() - 86_400_000).toISOString();
  const [total, ok, failed, orders, wallet, recent] = await Promise.all([
    admin.from("developer_api_usage").select("*", { count: "exact", head: true }).eq("user_id", userId),
    admin.from("developer_api_usage").select("*", { count: "exact", head: true }).eq("user_id", userId).lt("status_code", 400),
    admin.from("developer_api_usage").select("*", { count: "exact", head: true }).eq("user_id", userId).gte("status_code", 400),
    admin.from("developer_api_transactions").select("kind,amount,status,order_ref,service,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
    admin.from("profiles").select("wallet_balance").eq("id", userId).maybeSingle(),
    admin.from("developer_api_usage").select("endpoint,method,status_code,response_ms,created_at").eq("user_id", userId).gte("created_at", since24).order("created_at", { ascending: false }).limit(20),
  ]);
  const ordersRows = orders.data ?? [];
  const phonePurchases = ordersRows.filter((o: any) => o.kind === "phone").length;
  const emailPurchases = ordersRows.filter((o: any) => o.kind === "email").length;
  const spent = ordersRows.reduce((s: number, o: any) => s + Number(o.amount ?? 0), 0);
  return json({
    stats: {
      totalRequests: total.count ?? 0,
      successful: ok.count ?? 0,
      failed: failed.count ?? 0,
      phonePurchases,
      emailPurchases,
      totalSpent: spent,
      walletBalance: Number(wallet.data?.wallet_balance ?? 0),
    },
    transactions: ordersRows,
    recentActivity: recent.data ?? [],
  });
}

async function webhooks(admin: any, userId: string, req: Request, seg: string[]): Promise<Response> {
  if (req.method === "GET") {
    const { data, error } = await admin.from("developer_webhooks").select("id,url,active,created_at").eq("user_id", userId).order("created_at", { ascending: false });
    if (error) return fail(500, error.message);
    const ids = (data ?? []).map((d: any) => d.id);
    const { data: dels } = ids.length
      ? await admin.from("developer_webhook_deliveries").select("id,webhook_id,event,status,attempts,response_status,last_error,created_at,delivered_at").in("webhook_id", ids).order("created_at", { ascending: false }).limit(50)
      : { data: [] };
    return json({ webhooks: data ?? [], deliveries: dels ?? [] });
  }
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    let parsed: URL;
    try { parsed = new URL(url); } catch { return fail(400, "Enter a valid URL."); }
    if (!["http:", "https:"].includes(parsed.protocol)) return fail(400, "URL must start with http:// or https://");
    if (/(^|\.)localhost($|:)|^127\.|0\.0\.0\.0|\[::1\]/.test(parsed.hostname)) return fail(400, "Local addresses are not allowed.");
    const { count } = await admin.from("developer_webhooks").select("*", { count: "exact", head: true }).eq("user_id", userId);
    if ((count ?? 0) >= 3) return fail(400, "Maximum of 3 webhooks. Delete one first.");
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const secret = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    const { data, error } = await admin.from("developer_webhooks").insert({ user_id: userId, url, secret }).select("id,url,active,created_at").single();
    if (error) return fail(500, error.message);
    return json({ webhook: data, secret });
  }
  if (req.method === "PUT" && seg[1]) {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.active !== "boolean") return fail(400, "active boolean required");
    const { error } = await admin.from("developer_webhooks").update({ active: body.active }).eq("id", seg[1]).eq("user_id", userId);
    if (error) return fail(500, error.message);
    return json({ ok: true });
  }
  if (req.method === "DELETE" && seg[1]) {
    const { error } = await admin.from("developer_webhooks").delete().eq("id", seg[1]).eq("user_id", userId);
    if (error) return fail(500, error.message);
    return json({ ok: true });
  }
  return fail(405, "method not allowed");
}

// Playground: executes a real call against public-api using one of the
// developer's own active keys, only for safe (non-purchase) endpoints unless
// explicitly confirmed.
const SAFE_GET = [/^phone\/countries$/, /^phone\/services\/.+$/, /^phone\/inventory\/.+\/.+$/, /^phone\/orders$/, /^email\/services$/, /^wallet$/];

async function playground(admin: any, userId: string, req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint.replace(/^\//, "").trim() : "";
  const method = body?.method === "POST" ? "POST" : "GET";
  const payload = body?.payload ?? {};
  const confirmPurchase = body?.confirm === true;

  if (method === "GET" && !SAFE_GET.some((re) => re.test(endpoint))) {
    return fail(400, "This endpoint is not available in the playground. Use your API key from your own code for order detail endpoints.");
  }
  if (method === "POST" && !/^phone\/purchase$/.test(endpoint) && !/^email\/purchase$/.test(endpoint)) {
    return fail(400, "Unknown POST endpoint.");
  }
  if (method === "POST" && !confirmPurchase) {
    return fail(400, "CONFIRM_REQUIRED: this endpoint makes a real purchase and debits your wallet. Re-run with confirm: true after reviewing the price.");
  }

  // Keys are stored hashed, so the raw secret can't be replayed. Mint a
  // short-lived one-off key for this single playground call, use it, then
  // delete it — the developer's real keys are never touched.
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const rand = [...bytes].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 40);
  const tempSecret = `mk_test_${rand}`;
  const tempHash = await sha256Hex(tempSecret);
  const { data: inserted, error: insertErr } = await admin.from("developer_api_keys").insert({
    user_id: userId, name: "playground-temp", key_prefix: tempSecret.slice(0, 14), key_hash: tempHash, environment: "test",
  }).select("id").single();
  if (insertErr) return fail(500, "Failed to prepare playground call.");

  try {
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/public-api/${endpoint}`;
    const t0 = Date.now();
    const resp = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tempSecret}` },
      body: method === "POST" ? JSON.stringify(payload) : undefined,
    });
    const text = await resp.text();
    return json({
      status: resp.status,
      response_ms: Date.now() - t0,
      body: (() => { try { return JSON.parse(text); } catch { return text.slice(0, 2000); } })(),
    });
  } finally {
    await admin.from("developer_api_keys").delete().eq("id", inserted.id);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    const admin = adminClient();
    const auth = await authenticate(req, admin);
    if (!auth) return fail(401, "Sign in required.");
    const url = new URL(req.url);
    const seg = url.pathname.replace(/^.*\/developer-api\/?/, "").split("/").filter(Boolean);

    if (req.method === "GET" && seg[0] === "stats") return await stats(admin, auth.userId);
    if (seg[0] === "keys") return await keys(admin, auth.userId, req, seg);
    if (seg[0] === "webhooks") return await webhooks(admin, auth.userId, req, seg);
    if (req.method === "POST" && seg[0] === "playground") return await playground(admin, auth.userId, req);
    return fail(404, "unknown endpoint");
  } catch (err) {
    console.error("[developer-api]", err instanceof Error ? err.message : err);
    return fail(500, "Internal error.");
  }
});
