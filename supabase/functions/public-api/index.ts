import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Public Monten SMS Developer API. Developers authenticate with their own
// API key (Authorization: Bearer mk_live_xxx). Keys are stored as SHA-256
// hashes; requests are rate-limited per key; purchases debit the developer's
// existing Monten SMS wallet transactionally and are idempotent by order_ref.
// This function never exposes provider credentials.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Apikey",
};

const FIVESIM_BASE = "https://5sim.net";
const MAILOTP_BASE = "https://api.mailotp.org";

function json(body: unknown, status = 200, start = 0): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "X-Response-Time-Ms": String(Date.now() - start) },
  });
}

function apiError(status: number, code: string, message: string, start = 0): Response {
  return json({ error: { code, message } }, status, start);
}

interface Ctx {
  userId: string;
  keyId: string;
  environment: string;
  admin: any;
  start: number;
  suspended: boolean;
  overrides: { rate_limit_per_min: number | null; phone_margin_naira: number | null; email_price_naira: number | null };
}

function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function authenticate(req: Request, admin: any): Promise<Ctx | null> {
  const header = req.headers.get("Authorization") ?? "";
  const key = header.replace(/^Bearer\s+/i, "").trim();
  if (!key || !/^mk_(test|live)_[A-Za-z0-9]{32,64}$/.test(key)) return null;
  const hash = await sha256Hex(key);
  const { data, error } = await admin.rpc("find_api_key", { p_hash: hash });
  if (error || !data || data.length === 0) return null;
  const row = data[0];
  const { data: account } = await admin.from("developer_accounts")
    .select("status,rate_limit_per_min,phone_margin_naira,email_price_naira").eq("user_id", row.user_id).maybeSingle();
  return {
    userId: row.user_id,
    keyId: row.key_id,
    environment: row.environment,
    admin,
    start: Date.now(),
    suspended: account?.status === "suspended",
    overrides: {
      rate_limit_per_min: account?.rate_limit_per_min ?? null,
      phone_margin_naira: account?.phone_margin_naira ?? null,
      email_price_naira: account?.email_price_naira ?? null,
    },
  };
}

async function usage(admin: any, userId: string, endpoint: string, status: number, start: number, keyId: string) {
  await admin.from("developer_api_usage").insert({
    user_id: userId, key_id: keyId, endpoint, method: "GET", status_code: status, response_ms: Date.now() - start,
  });
}

async function getConfig(admin: any) {
  const { data } = await admin.from("developer_api_config").select("*").eq("id", 1).maybeSingle();
  return data ?? { phone_rate_limit_per_min: 30, email_rate_limit_per_min: 20, phone_margin_naira: 500, email_price_naira: 238, enabled: true };
}

async function ctxConfig(ctx: Ctx) {
  const cfg = await ctxConfig(ctx);
  const o = ctx.overrides;
  return {
    ...cfg,
    phone_rate_limit_per_min: o.rate_limit_per_min ?? cfg.phone_rate_limit_per_min,
    phone_margin_naira: o.phone_margin_naira ?? cfg.phone_margin_naira,
    email_price_naira: o.email_price_naira ?? cfg.email_price_naira,
  };
}

async function checkRate(admin: any, userId: string, maxPerMin: number): Promise<boolean> {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await admin.from("developer_api_usage").select("*", { count: "exact", head: true })
    .eq("user_id", userId).gte("created_at", since);
  return count === null || count < maxPerMin * 3;
}

// ---- webhook queueing ----

async function queueWebhookEvent(admin: any, userId: string, event: string, payload: Record<string, unknown>) {
  const { data: hooks } = await admin.from("developer_webhooks").select("id").eq("user_id", userId).eq("active", true);
  if (!hooks || hooks.length === 0) return;
  await admin.from("developer_webhook_deliveries").insert(
    hooks.map((h: any) => ({ webhook_id: h.id, user_id: userId, event, payload, status: "pending" })),
  );
}

// ---- phone endpoints ----

async function listCountries(ctx: Ctx): Promise<Response> {
  const resp = await fetch(`${FIVESIM_BASE}/guest/countries`, { headers: { Authorization: `Bearer ${Deno.env.get("FIVESIM_API_KEY") ?? ""}`, Accept: "application/json" } });
  if (!resp.ok) return apiError(502, "UPSTREAM_ERROR", "Failed to fetch countries", ctx.start);
  const data = await resp.json();
  const renames: Record<string, string> = { england: "United Kingdom", usa: "United States" };
  const countries = Object.entries(data).map(([code, info]: [string, any]) => ({ code, name: renames[code] || info.text_en || info.text || code }));
  return json({ countries }, 200, ctx.start);
}

async function listServices(ctx: Ctx, country: string): Promise<Response> {
  const resp = await fetch(`${FIVESIM_BASE}/guest/products/${encodeURIComponent(country)}/any`, { headers: { Authorization: `Bearer ${Deno.env.get("FIVESIM_API_KEY") ?? ""}`, Accept: "application/json" } });
  if (!resp.ok) return apiError(502, "UPSTREAM_ERROR", "Failed to fetch services", ctx.start);
  const data = await resp.json();
  const services = Object.entries(data)
    .filter(([, info]: [string, any]) => info.Category === "activation" && info.Qty > 0)
    .map(([code]: [string, any]) => ({ code, name: code.charAt(0).toUpperCase() + code.slice(1) }));
  return json({ services }, 200, ctx.start);
}

async function checkInventory(ctx: Ctx, country: string, service: string): Promise<Response> {
  const FIVESIM_API_KEY = Deno.env.get("FIVESIM_API_KEY") ?? "";
  const resp = await fetch(`${FIVESIM_BASE}/guest/prices?country=${encodeURIComponent(country)}&product=${encodeURIComponent(service)}`, {
    headers: { Authorization: `Bearer ${FIVESIM_API_KEY}`, Accept: "application/json" },
  });
  if (!resp.ok) return apiError(502, "UPSTREAM_ERROR", "Failed to check inventory", ctx.start);
  const data = await resp.json();
  const serviceData = (data[country] ?? {})[service] ?? {};
  let available = 0, maxCostUsd = 0;
  for (const [, info] of Object.entries(serviceData)) {
    const i = info as any;
    if (Number(i.count ?? 0) > 0) {
      available += Number(i.count);
      maxCostUsd = Math.max(maxCostUsd, Number(i.cost ?? 0));
    }
  }
  const cfg = await ctxConfig(ctx);
  // Public price = provider USD price converted to naira at the configured
  // rate (1600) plus the admin-configured margin.
  const priceNaira = Math.ceil(maxCostUsd * 1600) + Number(cfg.phone_margin_naira);
  return json({ country, service, available_numbers: available, price_naira: available > 0 ? priceNaira : null, currency: "NGN" }, 200, ctx.start);
}

async function purchasePhone(ctx: Ctx, body: any): Promise<Response> {
  const cfg = await ctxConfig(ctx);
  if (!cfg.enabled) return apiError(503, "API_DISABLED", "The Developer API is currently disabled.", ctx.start);

  const country = typeof body?.country === "string" ? body.country.trim().toLowerCase().slice(0, 24) : "";
  const service = typeof body?.service === "string" ? body.service.trim().toLowerCase().slice(0, 32) : "";
  const orderRef = typeof body?.order_ref === "string" ? body.order_ref.trim().slice(0, 64) : "";
  if (!country || !service) return apiError(400, "VALIDATION_ERROR", "country and service are required", ctx.start);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(orderRef)) return apiError(400, "VALIDATION_ERROR", "order_ref is required (8-64 chars, letters/numbers/dashes)", ctx.start);

  // Idempotency: the same order_ref always returns the same result.
  const { data: existing } = await ctx.admin.from("developer_api_transactions").select("*").eq("order_ref", orderRef).eq("user_id", ctx.userId).maybeSingle();
  if (existing) return json({ order_ref: existing.order_ref, status: existing.status, order_id: existing.order_id, amount: Number(existing.amount), duplicate: true }, 200, ctx.start);

  // Real price from the provider, converted like the customer flow.
  const FIVESIM_API_KEY = Deno.env.get("FIVESIM_API_KEY") ?? "";
  const priceResp = await fetch(`${FIVESIM_BASE}/guest/prices?country=${encodeURIComponent(country)}&product=${encodeURIComponent(service)}`, {
    headers: { Authorization: `Bearer ${FIVESIM_API_KEY}`, Accept: "application/json" },
  });
  if (!priceResp.ok) return apiError(502, "UPSTREAM_ERROR", "Failed to verify price", ctx.start);
  const priceData = await priceResp.json();
  const serviceData = (priceData[country] ?? {})[service] ?? {};
  let eurPrice = 0;
  for (const [, info] of Object.entries(serviceData)) {
    const i = info as any;
    if (Number(i.count ?? 0) > 0) eurPrice = Math.max(eurPrice, Number(i.cost ?? 0));
  }
  if (eurPrice <= 0) return apiError(404, "OUT_OF_STOCK", "No numbers available for this service/country", ctx.start);
  const price = Math.ceil(eurPrice * 1600) + Number(cfg.phone_margin_naira);

  // Record the transaction first (unique order_ref = idempotency lock), then
  // debit the wallet, then buy. On failure: refund + mark failed.
  const { data: txn, error: txnErr } = await ctx.admin.from("developer_api_transactions").insert({
    user_id: ctx.userId, order_ref: orderRef, kind: "phone", service, country, amount: price, status: "pending",
  }).select().single();
  if (txnErr) {
    if ((txnErr.message ?? "").includes("duplicate key")) {
      const { data: dupe } = await ctx.admin.from("developer_api_transactions").select("*").eq("order_ref", orderRef).maybeSingle();
      return json({ order_ref: dupe?.order_ref, status: dupe?.status, order_id: dupe?.order_id, duplicate: true }, 200, ctx.start);
    }
    return apiError(500, "INTERNAL", "Failed to start order", ctx.start);
  }

  const { error: debitError } = await ctx.admin.rpc("debit_wallet_for_user", {
    p_user_id: ctx.userId, p_amount: price, p_reference: `devapi_${orderRef}`, p_description: `API phone purchase: ${service} (${country})`,
  });
  if (debitError) {
    await ctx.admin.from("developer_api_transactions").update({ status: "failed", meta: { error: "insufficient_funds" } }).eq("id", txn.id);
    return apiError(402, "INSUFFICIENT_FUNDS", "Wallet balance is too low for this purchase", ctx.start);
  }

  const resp = await fetch(`${FIVESIM_BASE}/user/buy/activation/${country}/any/${service}`, {
    headers: { Authorization: `Bearer ${FIVESIM_API_KEY}`, Accept: "application/json" },
  });
  const rawText = await resp.text();
  if (!resp.ok) {
    await ctx.admin.rpc("refund_wallet_for_user", { p_user_id: ctx.userId, p_amount: price, p_reference: `devapi_refund_${orderRef}`, p_description: "API refund: purchase failed" });
    await ctx.admin.from("developer_api_transactions").update({ status: "failed", meta: { error: `upstream_${resp.status}` } }).eq("id", txn.id);
    await queueWebhookEvent(ctx.admin, ctx.userId, "order.failed", { order_ref: orderRef, reason: "provider_purchase_failed" });
    return apiError(502, "PURCHASE_FAILED", "The provider could not complete this purchase. Your wallet was refunded.", ctx.start);
  }
  let data: any;
  try { data = JSON.parse(rawText); } catch {
    await ctx.admin.rpc("refund_wallet_for_user", { p_user_id: ctx.userId, p_amount: price, p_reference: `devapi_refund_${orderRef}`, p_description: "API refund: invalid provider data" });
    await ctx.admin.from("developer_api_transactions").update({ status: "failed", meta: { error: "invalid_provider_data" } }).eq("id", txn.id);
    return apiError(502, "PURCHASE_FAILED", "Provider returned invalid data. Your wallet was refunded.", ctx.start);
  }

  await ctx.admin.from("developer_api_transactions").update({
    order_id: String(data.id), status: "waiting", meta: { phone: data.phone, expires: data.expires ?? null },
  }).eq("id", txn.id);
  await queueWebhookEvent(ctx.admin, ctx.userId, "order.created", { order_ref: orderRef, order_id: String(data.id), phone: data.phone, service, country, amount: price });

  return json({ order_ref: orderRef, order_id: String(data.id), phone: data.phone, status: "waiting", amount: price, expires_at: data.expires ?? null }, 200, ctx.start);
}

async function getOrder(ctx: Ctx, orderRef: string): Promise<Response> {
  const { data: txn } = await ctx.admin.from("developer_api_transactions").select("*").eq("order_ref", orderRef).eq("user_id", ctx.userId).maybeSingle();
  if (!txn) return apiError(404, "NOT_FOUND", "No order found with this order_ref", ctx.start);
  let otp: string | null = null;
  if (txn.internal_order_id) {
    const { data: num } = await ctx.admin.from("purchased_numbers").select("sms_code,sms_text,status,phone_number").eq("id", txn.internal_order_id).maybeSingle();
    if (num) { otp = num.sms_code; }
  }
  if (!otp && txn.order_id) {
    const FIVESIM_API_KEY = Deno.env.get("FIVESIM_API_KEY") ?? "";
    const resp = await fetch(`${FIVESIM_BASE}/user/check/${txn.order_id}`, { headers: { Authorization: `Bearer ${FIVESIM_API_KEY}`, Accept: "application/json" } });
    if (resp.ok) {
      const data = await resp.json();
      otp = data.sms?.[0]?.code ?? null;
      if (otp) {
        await ctx.admin.from("developer_api_transactions").update({ status: "completed", meta: { phone: data.phone ?? null, otp_received: true } }).eq("id", txn.id);
        await queueWebhookEvent(ctx.admin, ctx.userId, "otp.received", { order_ref: txn.order_ref, order_id: txn.order_id, otp });
      }
    }
  }
  return json({
    order_ref: txn.order_ref, order_id: txn.order_id, status: otp ? "completed" : txn.status,
    service: txn.service, country: txn.country, amount: Number(txn.amount),
    otp: otp ?? null, created_at: txn.created_at,
  }, 200, ctx.start);
}

async function listOrders(ctx: Ctx): Promise<Response> {
  const { data } = await ctx.admin.from("developer_api_transactions")
    .select("order_ref,order_id,kind,service,country,amount,status,created_at").eq("user_id", ctx.userId).order("created_at", { ascending: false }).limit(100);
  return json({ orders: data ?? [] }, 200, ctx.start);
}

async function cancelOrder(ctx: Ctx, orderRef: string): Promise<Response> {
  const { data: txn } = await ctx.admin.from("developer_api_transactions").select("*").eq("order_ref", orderRef).eq("user_id", ctx.userId).maybeSingle();
  if (!txn) return apiError(404, "NOT_FOUND", "No order found with this order_ref", ctx.start);
  if (txn.status !== "waiting") return apiError(400, "NOT_CANCELLABLE", `Orders in status '${txn.status}' cannot be cancelled`, ctx.start);
  const FIVESIM_API_KEY = Deno.env.get("FIVESIM_API_KEY") ?? "";
  const resp = await fetch(`${FIVESIM_BASE}/user/cancel/${txn.order_id}`, { headers: { Authorization: `Bearer ${FIVESIM_API_KEY}` } });
  if (!resp.ok) return apiError(502, "CANCEL_FAILED", "The provider rejected this cancellation (an OTP may already have arrived)", ctx.start);
  await ctx.admin.rpc("refund_wallet_for_user", { p_user_id: ctx.userId, p_amount: Number(txn.amount), p_reference: `devapi_cancel_${txn.order_ref}`, p_description: "API refund: order cancelled" });
  await ctx.admin.from("developer_api_transactions").update({ status: "cancelled" }).eq("id", txn.id);
  await queueWebhookEvent(ctx.admin, ctx.userId, "order.cancelled", { order_ref: txn.order_ref, order_id: txn.order_id });
  return json({ order_ref: txn.order_ref, status: "cancelled", refunded: Number(txn.amount) }, 200, ctx.start);
}

// ---- email endpoints ----

async function emailServices(ctx: Ctx): Promise<Response> {
  const MAILOTP_API_KEY = Deno.env.get("MAILOTP_API_KEY") ?? "";
  const resp = await fetch(`${MAILOTP_BASE}/v1/services`, { headers: { Authorization: `Bearer ${MAILOTP_API_KEY}`, Accept: "application/json" } });
  if (!resp.ok) return apiError(502, "UPSTREAM_ERROR", "Failed to fetch email services", ctx.start);
  const body = await resp.json().catch(() => null);
  const services = (Array.isArray(body?.services) ? body.services : []).map((s: any) => ({ code: s.slug, name: s.name, category: s.category }));
  const cfg = await ctxConfig(ctx);
  return json({ services, price_per_order_naira: Number(cfg.email_price_naira), currency: "NGN" }, 200, ctx.start);
}

async function emailPurchase(ctx: Ctx, body: any): Promise<Response> {
  const cfg = await ctxConfig(ctx);
  if (!cfg.enabled) return apiError(503, "API_DISABLED", "The Developer API is currently disabled.", ctx.start);
  const service = typeof body?.service === "string" ? body.service.trim().toLowerCase().slice(0, 32) : "";
  const orderRef = typeof body?.order_ref === "string" ? body.order_ref.trim().slice(0, 64) : "";
  if (!service) return apiError(400, "VALIDATION_ERROR", "service is required", ctx.start);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(orderRef)) return apiError(400, "VALIDATION_ERROR", "order_ref is required (8-64 chars)", ctx.start);

  const { data: existing } = await ctx.admin.from("developer_api_transactions").select("*").eq("order_ref", orderRef).eq("user_id", ctx.userId).maybeSingle();
  if (existing) return json({ order_ref: existing.order_ref, status: existing.status, email: (existing.meta as any)?.email ?? null, duplicate: true }, 200, ctx.start);

  const price = Number(cfg.email_price_naira);
  const { data: txn, error: txnErr } = await ctx.admin.from("developer_api_transactions").insert({
    user_id: ctx.userId, order_ref: orderRef, kind: "email", service, amount: price, status: "pending",
  }).select().single();
  if (txnErr) {
    if ((txnErr.message ?? "").includes("duplicate key")) {
      const { data: dupe } = await ctx.admin.from("developer_api_transactions").select("*").eq("order_ref", orderRef).maybeSingle();
      return json({ order_ref: dupe?.order_ref, status: dupe?.status, duplicate: true }, 200, ctx.start);
    }
    return apiError(500, "INTERNAL", "Failed to start order", ctx.start);
  }

  const { error: debitError } = await ctx.admin.rpc("debit_wallet_for_user", {
    p_user_id: ctx.userId, p_amount: price, p_reference: `devapi_email_${orderRef}`, p_description: `API email OTP: ${service}`,
  });
  if (debitError) {
    await ctx.admin.from("developer_api_transactions").update({ status: "failed", meta: { error: "insufficient_funds" } }).eq("id", txn.id);
    return apiError(402, "INSUFFICIENT_FUNDS", "Wallet balance is too low for this purchase", ctx.start);
  }

  // Provider exposes task creation at /v1/tasks (same endpoint the site's own
  // email flow uses); the /v1/emails path does not exist on this account.
  const MAILOTP_API_KEY = Deno.env.get("MAILOTP_API_KEY") ?? "";
  const idemKey = `monten_devapi_${orderRef}`;
  const resp = await fetch(`${MAILOTP_BASE}/v1/tasks`, {
    method: "POST",
    headers: { Authorization: `Bearer ${MAILOTP_API_KEY}`, "Content-Type": "application/json", Accept: "application/json", "Idempotency-Key": idemKey },
    body: JSON.stringify({ service, ttl: 300 }),
  });
  const raw = await resp.text();
  if (!resp.ok) {
    await ctx.admin.rpc("refund_wallet_for_user", { p_user_id: ctx.userId, p_amount: price, p_reference: `devapi_email_refund_${orderRef}`, p_description: "API refund: email purchase failed" });
    await ctx.admin.from("developer_api_transactions").update({ status: "failed", meta: { error: `upstream_${resp.status}` } }).eq("id", txn.id);
    await queueWebhookEvent(ctx.admin, ctx.userId, "order.failed", { order_ref: orderRef, reason: "provider_purchase_failed" });
    return apiError(502, "PURCHASE_FAILED", "The email provider could not complete this order. Your wallet was refunded.", ctx.start);
  }
  let data: any;
  try { data = JSON.parse(raw); } catch {
    await ctx.admin.rpc("refund_wallet_for_user", { p_user_id: ctx.userId, p_amount: price, p_reference: `devapi_email_refund_${orderRef}`, p_description: "API refund: invalid provider data" });
    await ctx.admin.from("developer_api_transactions").update({ status: "failed", meta: { error: "invalid_provider_data" } }).eq("id", txn.id);
    return apiError(502, "PURCHASE_FAILED", "Provider returned invalid data. Your wallet was refunded.", ctx.start);
  }
  await ctx.admin.from("developer_api_transactions").update({
    order_id: String(data.id ?? ""), status: "waiting", meta: { email: data.email ?? data.address ?? null, expires_at: data.expires_at ?? null },
  }).eq("id", txn.id);
  await queueWebhookEvent(ctx.admin, ctx.userId, "order.created", { order_ref: orderRef, email: data.email ?? data.address ?? null, service, amount: price });

  return json({ order_ref: orderRef, email: data.email ?? data.address ?? null, status: "waiting", amount: price }, 200, ctx.start);
}

async function emailStatus(ctx: Ctx, orderRef: string): Promise<Response> {
  const { data: txn } = await ctx.admin.from("developer_api_transactions").select("*").eq("order_ref", orderRef).eq("user_id", ctx.userId).maybeSingle();
  if (!txn || txn.kind !== "email") return apiError(404, "NOT_FOUND", "No email order found with this order_ref", ctx.start);
  let code: string | null = null;
  if (txn.order_id) {
    const MAILOTP_API_KEY = Deno.env.get("MAILOTP_API_KEY") ?? "";
    const resp = await fetch(`${MAILOTP_BASE}/v1/tasks/${txn.order_id}`, { headers: { Authorization: `Bearer ${MAILOTP_API_KEY}`, Accept: "application/json" } });
    if (resp.ok) {
      const data = await resp.json();
      if (data?.status === "received" && data?.result?.code) {
        code = String(data.result.code);
        await ctx.admin.from("developer_api_transactions").update({ status: "completed", meta: { email: data.email ?? null, otp: code } }).eq("id", txn.id);
        await queueWebhookEvent(ctx.admin, ctx.userId, "otp.received", { order_ref: txn.order_ref, email: data.email ?? null, otp: code });
      }
    }
  }
  return json({ order_ref: txn.order_ref, status: code ? "completed" : txn.status, email: (txn.meta as any)?.email ?? null, otp: code, amount: Number(txn.amount) }, 200, ctx.start);
}

// ---- wallet ----

async function walletInfo(ctx: Ctx): Promise<Response> {
  const { data } = await ctx.admin.from("profiles").select("wallet_balance").eq("id", ctx.userId).maybeSingle();
  return json({ wallet_balance: Number(data?.wallet_balance ?? 0), currency: "NGN" }, 200, ctx.start);
}

// ---- router ----

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const admin = adminClient();
  const start = Date.now();
  try {
    const url = new URL(req.url);
    const seg = url.pathname.replace(/^.*\/public-api\/?/, "").split("/").filter(Boolean);

    // Health check without a key (for the docs page).
    if (seg[0] === "health" && req.method === "GET") {
      return json({ ok: true, service: "montensms-developer-api", version: "1.0" }, 200, start);
    }

    const ctx = await authenticate(req, admin);
    if (!ctx) return apiError(401, "UNAUTHORIZED", "Missing or invalid API key. Send it as: Authorization: Bearer mk_live_...", start);

    if (ctx.suspended) return apiError(403, "ACCOUNT_SUSPENDED", "This developer account is suspended. Contact Monten SMS support.", ctx.start);

    const cfg = await ctxConfig(ctx);
    if (!cfg.enabled) return apiError(503, "API_DISABLED", "The Developer API is currently disabled.", ctx.start);
    if (!(await checkRate(admin, ctx.userId, cfg.phone_rate_limit_per_min))) {
      return apiError(429, "RATE_LIMITED", `Too many requests. Limit: ${cfg.phone_rate_limit_per_min * 3} per minute.`, ctx.start);
    }

    let resp: Response;
    if (req.method === "GET") {
      if (seg[0] === "phone" && seg[1] === "countries") resp = await listCountries(ctx);
      else if (seg[0] === "phone" && seg[1] === "services" && seg[2]) resp = await listServices(ctx, seg[2]);
      else if (seg[0] === "phone" && seg[1] === "inventory" && seg[2] && seg[3]) resp = await checkInventory(ctx, seg[2], seg[3]);
      else if (seg[0] === "phone" && seg[1] === "orders" && seg[2]) resp = await getOrder(ctx, seg[2]);
      else if (seg[0] === "phone" && seg[1] === "orders") resp = await listOrders(ctx);
      else if (seg[0] === "email" && seg[1] === "services") resp = await emailServices(ctx);
      else if (seg[0] === "email" && seg[1] === "orders" && seg[2]) resp = await emailStatus(ctx, seg[2]);
      else if (seg[0] === "wallet") resp = await walletInfo(ctx);
      else resp = apiError(404, "NOT_FOUND", "Unknown endpoint. See the API documentation.", ctx.start);
    } else if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (seg[0] === "phone" && seg[1] === "purchase") resp = await purchasePhone(ctx, body);
      else if (seg[0] === "phone" && seg[1] === "cancel" && seg[2]) resp = await cancelOrder(ctx, seg[2]);
      else if (seg[0] === "email" && seg[1] === "purchase") resp = await emailPurchase(ctx, body);
      else resp = apiError(404, "NOT_FOUND", "Unknown endpoint.", ctx.start);
    } else {
      resp = apiError(405, "METHOD_NOT_ALLOWED", "Use GET or POST.", ctx.start);
    }

    // Fire-and-forget usage log (don't block the response).
    ctx.admin.from("developer_api_usage").insert({
      user_id: ctx.userId, key_id: ctx.keyId, endpoint: seg.join("/"), method: req.method,
      status_code: resp.status, response_ms: Date.now() - ctx.start,
    }).then(() => {}, () => {});

    return resp;
  } catch (err) {
    console.error("[public-api]", err instanceof Error ? err.message : err);
    return apiError(500, "INTERNAL", "Unexpected error. Try again.", start);
  }
});
