import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// MailOtp Email OTP Rental proxy. All provider calls happen here with the
// secret key; the browser and the APK never see it.
//
// Billing model (per MailOtp's docs): the service price is HELD at task
// creation, captured when a code lands, and refunded automatically by
// MailOtp if the window passes with no mail. We mirror that on the customer
// wallet: debit at task creation, refund when the task settles without a
// code. Customers pay a flat price for every billable delivery; /again within
// MailOtp's free-repeat window returns price "0" and is not charged.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const MAILOTP_API_KEY = Deno.env.get("MAILOTP_API_KEY") ?? "";
const MAILOTP_BASE = "https://api.mailotp.org";

// Customer price for every email service, first purchase or billable repeat.
// Provider USD cost is recorded per order for profit monitoring, never sold on.
const FLAT_PRICE_NAIRA = 238;

// Customer-facing waiting window. Passed to the provider at task creation so
// the provider's own hold expires on the same clock the customer sees.
const WINDOW_SEC = 300;

const OWNER_EMAIL = "montensms@gmail.com";

interface Task {
  id: string;
  status: "waiting" | "received" | "cancelled" | "timeout" | "failed";
  service: string;
  site: string;
  email: string;
  price: string;
  created_at: string;
  expires_at: string;
  cancellable_at: string;
  result: null | {
    code?: string;
    link?: string;
    from: string;
    subject: string;
    received_at: string;
    confidence: string;
  };
}
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function errorResponse(status: number, message: string, code?: string): Response {
  return jsonResponse({ error: message, ...(code ? { code } : {}) }, status);
}

async function authenticate(req: Request): Promise<{ userId: string; email: string } | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return { userId: data.user.id, email: (data.user.email ?? "").toLowerCase() };
}

async function checkRateLimit(admin: any, userId: string, endpoint: string, maxRequests: number, windowMs: number): Promise<boolean> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count } = await admin.from("rate_limits").select("*", { count: "exact", head: true }).eq("user_id", userId).eq("endpoint", endpoint).gte("created_at", since);
  if (count !== null && count >= maxRequests) return false;
  await admin.from("rate_limits").insert({ user_id: userId, endpoint });
  return true;
}

function providerHeaders(): HeadersInit {
  return { Authorization: `Bearer ${MAILOTP_API_KEY}`, Accept: "application/json", "Content-Type": "application/json" };
}

async function getConfig(admin: any): Promise<{ usd_to_naira: number; margin_naira: number; service_overrides: Record<string, number> }> {
  const { data } = await admin.from("email_otp_config").select("usd_to_naira, margin_naira, service_overrides").eq("id", 1).maybeSingle();
  return {
    usd_to_naira: Number(data?.usd_to_naira ?? 1600),
    margin_naira: Number(data?.margin_naira ?? 500),
    service_overrides: (data?.service_overrides ?? {}) as Record<string, number>,
  };
}

function sellPriceNaira(): number {
  return FLAT_PRICE_NAIRA;
}

interface TaskPrice { usd: number; ttlSec: number; name: string; category: string; codeFormat: string }

// GET /v1/services returns { "services": [ { slug, name, category, price, ttl_sec, code_format } ] }.
// Also fetches GET /v1/domains for ready mailbox counts (per-service when a slug is given).
async function fetchDomainsStock(service?: string): Promise<Map<string, number>> {
  const stock = new Map<string, number>();
  try {
    const url = service ? `${MAILOTP_BASE}/v1/domains?service=${encodeURIComponent(service)}` : `${MAILOTP_BASE}/v1/domains`;
    const resp = await fetch(url, { headers: providerHeaders() });
    if (!resp.ok) return stock;
    const body = await resp.json().catch(() => null);
    for (const d of Array.isArray(body?.domains) ? body.domains : []) {
      if (d && typeof d.domain === "string") stock.set(d.domain, Number(d.ready_count ?? 0));
    }
  } catch {
    // stock is advisory; never fail the catalog over it
  }
  return stock;
}

async function fetchCatalog(): Promise<{ services: Map<string, TaskPrice>; totalStock: number } | null> {
  const resp = await fetch(`${MAILOTP_BASE}/v1/services`, { headers: providerHeaders() });
  if (!resp.ok) {
    console.error("[mailotp-proxy] /v1/services failed:", resp.status, await resp.text().catch(() => ""));
    return null;
  }
  const body = await resp.json().catch(() => null);
  const raw: any[] = Array.isArray(body) ? body : Array.isArray(body?.services) ? body.services : [];
  if (raw.length === 0) {
    console.error("[mailotp-proxy] /v1/services returned no parseable list; head:", JSON.stringify(body)?.slice(0, 300));
  }
  const map = new Map<string, TaskPrice>();
  for (const s of raw) {
    if (s && typeof s.slug === "string") {
      map.set(s.slug, {
        usd: Number(s.price ?? 0),
        ttlSec: Number(s.ttl_sec ?? 300),
        name: String(s.name ?? s.slug),
        category: String(s.category ?? "other"),
        codeFormat: String(s.code_format ?? "unknown"),
      });
    }
  }
  const stock = await fetchDomainsStock();
  let totalStock = 0;
  for (const n of stock.values()) totalStock += n;
  return { services: map, totalStock };
}

class ProviderError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// Translate a MailOtp error into a customer-safe message. Branches on the
// stable error code, never the message text.
async function providerError(resp: Response): Promise<ProviderError> {
  const body = await resp.json().catch(() => null);
  const code = String(body?.error?.code ?? "");
  if (resp.status === 402) return new ProviderError("insufficient_provider_balance", "This service is temporarily unavailable. Your wallet was not charged. Please try again shortly.");
  if (code === "no_stock") return new ProviderError(code, "No email addresses are available for this service right now. Please try again shortly.");
  if (code === "low_success_limit") return new ProviderError(code, "This service is temporarily limited. Please try again in a few minutes.");
  if (code === "validation_error") return new ProviderError(code, "That service is not available for email verification.", 400);
  if (resp.status === 429) return new ProviderError(code || "rate_limited", "The email service is busy. Please wait a moment and try again.", 429);
  if (resp.status === 503) return new ProviderError("maintenance", "The email service is under maintenance. Please try again shortly.");
  return new ProviderError(code || "provider_error", "We couldn't reach the email service. Please try again shortly.", 502);
}

async function createMailOtpTask(service: string, domain: string | null, ttl: number | null, idempotencyKey: string): Promise<Task> {
  const payload: Record<string, unknown> = { service, ttl: WINDOW_SEC };
  if (domain) payload.domain = domain;
  const resp = await fetch(`${MAILOTP_BASE}/v1/tasks`, {
    method: "POST",
    headers: { ...providerHeaders(), "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw await providerError(resp);
  const task = await resp.json().catch(() => null);
  if (!task || typeof task.id !== "string") throw new ProviderError("invalid_provider_response", "We couldn't complete this order. Please try again shortly.");
  return task as Task;
}

async function getTask(taskId: string, waitSec: number): Promise<Task> {
  const resp = await fetch(`${MAILOTP_BASE}/v1/tasks/${encodeURIComponent(taskId)}?wait=${waitSec}`, { headers: providerHeaders() });
  if (!resp.ok) {
    if (resp.status === 404) throw new ProviderError("not_found", "This email order has expired on the provider and can no longer be used.", 404);
    throw await providerError(resp);
  }
  const task = await resp.json().catch(() => null);
  if (!task || typeof task.id !== "string") throw new ProviderError("invalid_provider_response", "We couldn't read this order. Please try again shortly.");
  return task as Task;
}

async function cancelTask(taskId: string): Promise<Task> {
  const resp = await fetch(`${MAILOTP_BASE}/v1/tasks/${encodeURIComponent(taskId)}/cancel`, { method: "POST", headers: providerHeaders() });
  if (!resp.ok) throw await providerError(resp);
  const task = await resp.json().catch(() => null);
  if (!task) throw new ProviderError("invalid_provider_response", "We couldn't cancel this order. Please try again shortly.");
  return task as Task;
}

async function againTask(sourceTaskId: string): Promise<Task> {
  const resp = await fetch(`${MAILOTP_BASE}/v1/tasks/${encodeURIComponent(sourceTaskId)}/again`, { method: "POST", headers: providerHeaders() });
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    const code = String(body?.error?.code ?? "");
    if (resp.status === 409 && code === "mailbox_busy") {
      const raw = String(body?.error?.message ?? "");
      if (/active/i.test(raw)) throw new ProviderError(code, "This email address is no longer active. Please buy a new email address.");
      throw new ProviderError(code, "This email address is busy right now. Please try again in a minute.");
    }
    if (resp.status === 404) throw new ProviderError("not_found", "This email order has expired (older than 180 days) and can no longer be reused.");
    throw await providerError(resp);
  }
  const task = await resp.json().catch(() => null);
  if (!task || typeof task.id !== "string") throw new ProviderError("invalid_provider_response", "We couldn't reopen this email address. Please try again shortly.");
  return task as Task;
}

async function refundWallet(admin: any, userId: string, amount: number, reference: string, description: string): Promise<void> {
  if (amount <= 0) return;
  const { error } = await admin.rpc("refund_wallet_for_user", {
    p_user_id: userId,
    p_amount: amount,
    p_reference: reference,
    p_description: description,
  });
  if (error) {
    console.error("[mailotp-proxy] wallet refund failed", error.message);
    throw new ProviderError("refund_failed", "The refund could not be completed yet. Please try again shortly.", 500);
  }
}

async function debitWallet(admin: any, userId: string, amount: number, reference: string, description: string): Promise<boolean> {
  const { error } = await admin.rpc("debit_wallet_for_user", { p_user_id: userId, p_amount: amount, p_reference: reference, p_description: description });
  if (!error) return true;
  const msg = error.message || "";
  if (msg.includes("DUPLICATE_REFERENCE")) return true; // already charged for this order
  if (msg.includes("Insufficient")) throw new ProviderError("insufficient_wallet", "Insufficient wallet balance. Please fund your wallet first.", 400);
  throw new ProviderError("wallet_error", "Failed to process payment. Please try again shortly.", 500);
}

function mapOrder(row: any, codes: any[] | null) {
  return {
    id: row.id,
    service: row.service,
    site: row.site,
    email: row.email_address,
    status: row.status,
    charge: Number(row.charge_naira ?? 0),
    providerCostUsd: row.provider_price_usd !== null ? Number(row.provider_price_usd) : null,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastCodeAt: row.last_code_at,
    codes: (codes ?? []).map((c) => ({
      code: c.code,
      sender: c.sender,
      subject: c.subject,
      receivedAt: c.provider_received_at ?? c.created_at,
      wasFreeRepeat: c.was_free_repeat,
    })),
  };
}

async function loadOrder(admin: any, orderId: string, userId: string) {
  const { data: order, error } = await admin.from("email_otp_orders").select("*").eq("id", orderId).eq("user_id", userId).maybeSingle();
  if (error) throw new ProviderError("db_error", "Something went wrong. Please try again shortly.", 500);
  if (!order) return null;
  return order;
}

async function loadCodes(admin: any, orderId: string) {
  const { data, error } = await admin.from("email_otp_codes").select("code, sender, subject, provider_received_at, was_free_repeat, created_at").eq("order_id", orderId).order("created_at", { ascending: false });
  if (error) throw new ProviderError("db_error", "Something went wrong. Please try again shortly.", 500);
  return data ?? [];
}

async function syncTaskToOrder(admin: any, order: any, task: Task): Promise<{ order: any; newCodes: any[]; justRefunded: boolean }> {
  const userId = order.user_id;
  const priorCodeCount = (await loadCodes(admin, order.id)).length;
  const newCodes: any[] = [];
  let justRefunded = false;

  if (task.result && task.result.code && String(task.result.code).trim().length > 0) {
    const receivedAt = task.result.received_at ?? new Date().toISOString();
    const { error: recordError } = await admin.rpc("record_email_otp_code", {
      p_order_id: order.id,
      p_user_id: userId,
      p_code: String(task.result.code).trim(),
      p_sender: task.result.from ?? null,
      p_subject: task.result.subject ?? null,
      p_provider_received_at: receivedAt,
      p_was_free_repeat: Number(task.price) === 0,
    });
    if (recordError) throw new ProviderError("db_error", "We couldn't save the received code. Please try again shortly.", 500);
    newCodes.push({ code: String(task.result.code).trim(), sender: task.result.from, subject: task.result.subject, receivedAt, wasFreeRepeat: Number(task.price) === 0 });
    await admin.from("notifications").insert({
      user_id: userId, type: "email_otp", title: "Email OTP Received",
      message: `A code arrived for your ${order.service} email address.`,
    });
  }

  if (task.status !== "waiting" && order.status === "waiting") {
    const refundable = ["timeout", "cancelled", "failed", "expired"].includes(task.status) && Number(order.charge_naira) > 0;
    if (refundable) {
      await refundWallet(admin, userId, Number(order.charge_naira), `mo_refund_${order.id}`, "Refund: no email code arrived");
      justRefunded = true;
      await admin.from("notifications").insert({
        user_id: userId, type: "email_otp", title: "Refund Completed",
        message: `Your ₦${Number(order.charge_naira)} was refunded to your wallet — no code arrived for your ${order.service} email order.`,
      });
    }
    const { error: settleError } = await admin.rpc("settle_email_otp_order", {
      p_order_id: order.id,
      p_user_id: userId,
      p_status: task.status,
      p_refund_reference: refundable ? `mo_refund_${order.id}` : null,
    });
    if (settleError) throw new ProviderError("db_error", "We couldn't update the email order. Please try again shortly.", 500);
  }

  const updated = await loadOrder(admin, order.id, userId);
  const codes = await loadCodes(admin, order.id);
  return {
    order: updated ?? order,
    newCodes: codes.slice(0, Math.max(codes.length - priorCodeCount, newCodes.length)),
    justRefunded,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    if (!MAILOTP_API_KEY) return errorResponse(503, "Email OTP service is not configured yet.");

    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const seg = (i: number) => (segments[0] === "mailotp-proxy" ? segments[i + 1] : segments[i]);
    const resource = seg(0);
    const param1 = seg(1);

    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

// ---- Public catalog (any signed-in user) ----
    if (resource === "services" && req.method === "GET") {
      const auth = await authenticate(req);
      if (!auth) return errorResponse(401, "Unauthorized");
      const catalog = await fetchCatalog();
      if (!catalog) {
        return errorResponse(502, "The email service is unreachable right now. Please try again in a moment.", "provider_unreachable");
      }
      const list = Array.from(catalog.services.entries()).map(([slug, p]) => ({
        slug,
        name: p.name,
        category: p.category,
        codeFormat: p.codeFormat,
        providerUsd: p.usd,
        ttlSec: p.ttlSec,
        priceNaira: sellPriceNaira(),
      }));
      list.sort((a, b) => a.name.localeCompare(b.name));
      return jsonResponse({ services: list, totalStock: catalog.totalStock });
    }

    const auth = await authenticate(req);
    if (!auth) return errorResponse(401, "Unauthorized");

    // ---- POST /buy { service, domain? } ----
    if (resource === "buy" && req.method === "POST") {
      if (!await checkRateLimit(admin, auth.userId, "mo_buy", 10, 60_000)) return errorResponse(429, "Too many purchase attempts. Please wait a minute.");
      const body = await req.json().catch(() => null);
      const service = String(body?.service ?? "").trim().toLowerCase();
      const domain = body?.domain ? String(body.domain).trim().toLowerCase() : null;
      const idempotencyKey = String(body?.idempotencyKey ?? "").trim();
      if (!service || service.length > 120 || !/^[a-z0-9._-]+$/.test(service)) return errorResponse(400, "Please choose a valid service.");
      if (!idempotencyKey || idempotencyKey.length > 100 || !/^[A-Za-z0-9._-]+$/.test(idempotencyKey)) return errorResponse(400, "Invalid request.");

      const { data: claim, error: claimError } = await admin.rpc("claim_email_otp_order", {
        p_user_id: auth.userId, p_idempotency_key: idempotencyKey, p_service: service,
      });
      if (claimError) return errorResponse(500, "Something went wrong. Please try again shortly.");
      if (claim && claim.length > 0 && claim[0].created === false) {
        // Idempotent replay: return the order already created for this click.
        const existing = await loadOrder(admin, claim[0].order_id, auth.userId);
        if (existing) return jsonResponse({ order: mapOrder(existing, await loadCodes(admin, existing.id)), replay: true });
      }
      const orderId = claim[0].order_id as string;

      const catalog = await fetchCatalog();
      const priced = catalog?.services.get(service);
      const usd = priced ? priced.usd : Number((await getProviderOtherPrice()) ?? 0);
      if (!(usd > 0)) {
        await admin.from("email_otp_orders").delete().eq("id", orderId).eq("user_id", auth.userId).eq("mailotp_task_id", null);
        return errorResponse(502, "Pricing for this service is unavailable right now. Please try again shortly.");
      }
      const charge = sellPriceNaira();

      try {
        await debitWallet(admin, auth.userId, charge, `mo_charge_${orderId}`, `Email OTP rental: ${service}`);
      } catch (err) {
        await admin.from("email_otp_orders").delete().eq("id", orderId).eq("user_id", auth.userId).eq("mailotp_task_id", null);
        if (err instanceof ProviderError) return errorResponse(err.status, err.message, err.code);
        throw err;
      }

      let task: Task;
      try {
        task = await createMailOtpTask(service, domain, null, `monten_${orderId}`);
      } catch (err) {
        await refundWallet(admin, auth.userId, charge, `mo_refund_${orderId}`, "Refund: email purchase failed");
        await admin.from("email_otp_orders").delete().eq("id", orderId).eq("user_id", auth.userId).eq("mailotp_task_id", null);
        if (err instanceof ProviderError) return errorResponse(err.status, err.message, err.code);
        throw err;
      }

      const { error: finalizeError } = await admin.rpc("finalize_email_otp_order", {
        p_order_id: orderId, p_user_id: auth.userId, p_mailotp_task_id: task.id,
        p_email_address: task.email ?? null, p_provider_price_usd: Number(task.price),
        p_charge_naira: charge, p_charge_reference: `mo_charge_${orderId}`,
        p_mailotp_created_at: task.created_at ?? null, p_expires_at: task.expires_at ?? null,
      });
      if (finalizeError) {
        try { await cancelTask(task.id); } catch { /* provider will auto-timeout and refund itself */ }
        await refundWallet(admin, auth.userId, charge, `mo_refund_${orderId}`, "Refund: email purchase failed");
        await admin.from("email_otp_orders").delete().eq("id", orderId).eq("user_id", auth.userId);
        return errorResponse(500, "Failed to save your order. Your wallet has been refunded.");
      }

      await admin.from("notifications").insert({
        user_id: auth.userId, type: "email_otp", title: "Email Address Purchased",
        message: `Your ${service} email address is ready. Waiting for your code...`,
      });

      const order = await loadOrder(admin, orderId, auth.userId);
      return jsonResponse({ order: mapOrder(order, await loadCodes(admin, orderId)) });
    }

    // ---- POST /again { orderId } — reuse an existing address ----
    if (resource === "again" && req.method === "POST") {
      if (!await checkRateLimit(admin, auth.userId, "mo_again", 10, 60_000)) return errorResponse(429, "Too many requests. Please wait a minute.");
      const body = await req.json().catch(() => null);
      const orderIdRaw = String(body?.orderId ?? "").trim();
      const idempotencyKey = String(body?.idempotencyKey ?? "").trim();
      if (!/^[0-9a-fA-F-]{36}$/.test(orderIdRaw)) return errorResponse(400, "Invalid request.");
      if (!idempotencyKey || idempotencyKey.length > 100 || !/^[A-Za-z0-9._-]+$/.test(idempotencyKey)) return errorResponse(400, "Invalid request.");

      const sourceOrder = await loadOrder(admin, orderIdRaw, auth.userId);
      if (!sourceOrder) return errorResponse(403, "You don't own this email order.");
      if (!sourceOrder.mailotp_task_id) return errorResponse(409, "This order has no active email yet.");
      // Restore the email address too — /again reuses the same address, so an
      // expired order can still be reopened the same way an order that timed
      // out naturally can.
      if (sourceOrder.status !== "received" && sourceOrder.status !== "timeout" && sourceOrder.status !== "cancelled" && sourceOrder.status !== "charged_free" && sourceOrder.status !== "expired") {
        return errorResponse(409, "This address is still waiting for a code. Please wait for it to finish first.");
      }
      const sourceTaskId = String(sourceOrder.mailotp_task_id);

      const { data: claim, error: claimError } = await admin.rpc("claim_email_otp_order", {
        p_user_id: auth.userId, p_idempotency_key: idempotencyKey, p_service: sourceOrder.service, p_source_task_id: sourceTaskId,
      });
      if (claimError) return errorResponse(500, "Something went wrong. Please try again shortly.");
      if (claim && claim.length > 0 && claim[0].created === false) {
        // Idempotent replay: return the order already created for this click.
        const existing = await loadOrder(admin, claim[0].order_id, auth.userId);
        if (existing) return jsonResponse({ order: mapOrder(existing, await loadCodes(admin, existing.id)), replay: true });
      }
      const orderId = claim[0].order_id as string;

      // MailOtp decides the charge: "0" inside its free-repeat window,
      // otherwise billable. Customers pay the flat price only when billable.
      let task: Task;
      try {
        task = await againTask(sourceTaskId);
      } catch (err) {
        await admin.from("email_otp_orders").delete().eq("id", orderId).eq("user_id", auth.userId).eq("mailotp_task_id", null);
        if (err instanceof ProviderError) return errorResponse(err.status, err.message, err.code);
        throw err;
      }

      const providerUsd = Number(task.price);
      let charge = 0;
      if (providerUsd > 0) {
        charge = sellPriceNaira();
        try {
          await debitWallet(admin, auth.userId, charge, `mo_charge_${orderId}`, `Email OTP rental: ${sourceOrder.service}`);
        } catch (err) {
          try { await cancelTask(task.id); } catch { /* will auto-timeout and self-refund */ }
          await admin.from("email_otp_orders").delete().eq("id", orderId).eq("user_id", auth.userId).eq("mailotp_task_id", null);
          if (err instanceof ProviderError) return errorResponse(err.status, err.message, err.code);
          throw err;
        }
      }

      const { error: finalizeError } = await admin.rpc("finalize_email_otp_order", {
        p_order_id: orderId, p_user_id: auth.userId, p_mailotp_task_id: task.id,
        p_email_address: task.email ?? sourceOrder.email_address, p_provider_price_usd: providerUsd,
        p_charge_naira: charge, p_charge_reference: charge > 0 ? `mo_charge_${orderId}` : null,
        p_mailotp_created_at: task.created_at ?? null, p_expires_at: task.expires_at ?? null,
      });
      if (finalizeError) {
        if (charge > 0) {
          try { await cancelTask(task.id); } catch { /* provider auto-refund */ }
          await refundWallet(admin, auth.userId, charge, `mo_refund_${orderId}`, "Refund: email purchase failed");
        }
        await admin.from("email_otp_orders").delete().eq("id", orderId).eq("user_id", auth.userId);
        return errorResponse(500, "Failed to save your order. Your wallet has been refunded if charged.");
      }

      const order = await loadOrder(admin, orderId, auth.userId);
      return jsonResponse({ order: mapOrder(order, await loadCodes(admin, orderId)) });
    }

    // ---- GET /refresh/:orderId — check for a newer code on demand. Never charges. ----
    if (resource === "refresh" && req.method === "GET" && param1) {
      if (!/^[0-9a-fA-F-]{36}$/.test(param1)) return errorResponse(400, "Invalid request.");
      if (!await checkRateLimit(admin, auth.userId, "mo_refresh", 30, 60_000)) return errorResponse(429, "Too many refresh requests. Please wait a moment.");
      const order = await loadOrder(admin, param1, auth.userId);
      if (!order) return errorResponse(403, "You don't own this email order.");
      if (!order.mailotp_task_id) return errorResponse(409, "This order has no active email yet.");
      const beforeLatest = (await loadCodes(admin, order.id))[0]?.provider_received_at ?? null;
      const task = await getTask(order.mailotp_task_id, 0);
      const { order: updated } = await syncTaskToOrder(admin, order, task);
      const codes = await loadCodes(admin, order.id);
      const latestAt = codes[0]?.provider_received_at ?? null;
      const hasNewCode = latestAt !== null && latestAt !== beforeLatest;
      return jsonResponse({ order: mapOrder(updated, codes), hasNewCode });
    }

    // ---- GET /again-quote/:orderId — price preview for a resend (no provider call, no charge) ----
    if (resource === "again-quote" && req.method === "GET" && param1) {
      if (!/^[0-9a-fA-F-]{36}$/.test(param1)) return errorResponse(400, "Invalid request.");
      const order = await loadOrder(admin, param1, auth.userId);
      if (!order) return errorResponse(403, "You don't own this email order.");
      if (!order.mailotp_task_id) return errorResponse(409, "This order has no active email yet.");
      return jsonResponse({ priceNaira: sellPriceNaira() });
    }

    // ---- GET /poll/:orderId — long-poll the provider for this order ----
    if (resource === "poll" && req.method === "GET" && param1) {
      if (!/^[0-9a-fA-F-]{36}$/.test(param1)) return errorResponse(400, "Invalid request.");
      if (!await checkRateLimit(admin, auth.userId, "mo_poll", 30, 60_000)) return errorResponse(429, "Too many requests. Please slow down.");
      const order = await loadOrder(admin, param1, auth.userId);
      if (!order) return errorResponse(403, "You don't own this email order.");
      if (!order.mailotp_task_id) return errorResponse(409, "This order has no active email yet.");
      if (order.status !== "waiting") return jsonResponse({ order: mapOrder(order, await loadCodes(admin, order.id)) });

      const wait = Math.min(Math.max(Number(url.searchParams.get("wait") ?? 10), 0), 25);
      const task = await getTask(order.mailotp_task_id, wait);
      const { order: updated, justRefunded } = await syncTaskToOrder(admin, order, task);
      return jsonResponse({ order: mapOrder(updated, await loadCodes(admin, order.id)), justRefunded });
    }

    // ---- GET /orders — history ----
    if (resource === "orders" && req.method === "GET") {
      const { data: orders, error } = await admin.from("email_otp_orders").select("*").eq("user_id", auth.userId).order("created_at", { ascending: false }).limit(50);
      if (error) return errorResponse(500, "Something went wrong. Please try again shortly.");
      const withCodes = await Promise.all((orders ?? []).map(async (o: any) => mapOrder(o, await loadCodes(admin, o.id))));
      return jsonResponse({ orders: withCodes });
    }

    // ---- POST /cancel/:orderId — customer-initiated cancellation with refund ----
    if (resource === "cancel" && req.method === "POST" && param1) {
      if (!/^[0-9a-fA-F-]{36}$/.test(param1)) return errorResponse(400, "Invalid request.");
      if (!await checkRateLimit(admin, auth.userId, "mo_cancel", 15, 60_000)) return errorResponse(429, "Too many cancel attempts. Please wait a moment.");
      const order = await loadOrder(admin, param1, auth.userId);
      if (!order) return errorResponse(403, "You don't own this email order.");
      // Only a still-waiting order can be cancelled. Terminal statuses (received,
      // timeout, expired, cancelled) are rejected here, which both disables the
      // button after auto-expiry and makes a second manual cancel a no-op.
      if (order.status !== "waiting") return errorResponse(409, "This order is no longer active.");
      try {
        const task = await cancelTask(order.mailotp_task_id);
        // Provider confirmed. syncTaskToOrder settles the status (atomic claim on
        // 'waiting') and issues the refund via refundWallet — deduped by the
        // mo_refund_<orderId> reference, so neither a second click nor the
        // expiry worker can ever refund twice. If the provider still reports
        // waiting (cancel not yet accepted), nothing is settled or refunded.
        const { order: updated, justRefunded } = await syncTaskToOrder(admin, order, task);
        if (updated.status === "waiting") {
          return errorResponse(409, "The provider hasn't confirmed the cancellation yet. Please try again in a moment.");
        }
        return jsonResponse({ order: mapOrder(updated, await loadCodes(admin, order.id)), refunded: justRefunded });
      } catch (err) {
        if (err instanceof ProviderError && err.code === "cancel_too_early") {
          return errorResponse(409, "This order can't be canceled yet — please wait a few seconds.");
        }
        throw err;
      }
    }

    // ---- Admin: owner account only ----
    if (resource === "admin") {
      if (auth.email !== OWNER_EMAIL) return errorResponse(403, "Owner account only.");
      const sub = param1;

      if (sub === "orders" && req.method === "GET") {
        const { data: orders, error } = await admin.from("email_otp_orders").select("*").order("created_at", { ascending: false }).limit(200);
        if (error) return errorResponse(500, "Failed to load orders.");
        const withCodes = await Promise.all((orders ?? []).map(async (o: any) => mapOrder(o, await loadCodes(admin, o.id))));
        return jsonResponse({ orders: withCodes });
      }

      if (sub === "config" && req.method === "GET") {
        const cfg = await getConfig(admin);
        return jsonResponse({ config: cfg });
      }

      if (sub === "config" && req.method === "POST") {
        const body = await req.json().catch(() => null);
        const usd = Number(body?.usdToNaira);
        const margin = Number(body?.marginNaira);
        const overrides = body?.serviceOverrides;
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (Number.isFinite(usd) && usd > 0) patch.usd_to_naira = usd;
        if (Number.isFinite(margin) && margin >= 0) patch.margin_naira = margin;
        if (overrides && typeof overrides === "object" && !Array.isArray(overrides)) {
          const clean: Record<string, number> = {};
          for (const [k, v] of Object.entries(overrides as Record<string, unknown>)) {
            const n = Number(v);
            if (/^[a-z0-9._-]{1,120}$/.test(k) && Number.isFinite(n) && n >= 0) clean[k] = n;
          }
          patch.service_overrides = clean;
        }
        const { error } = await admin.from("email_otp_config").update(patch).eq("id", 1);
        if (error) return errorResponse(500, "Failed to save settings.");
        return jsonResponse({ config: await getConfig(admin) });
      }

      if (sub === "provider" && req.method === "GET") {
        try {
          const me = await fetch(`${MAILOTP_BASE}/v1/me`, { headers: providerHeaders() });
          if (!me.ok) return errorResponse(502, "Provider status unavailable.");
          return jsonResponse({ provider: await me.json() });
        } catch {
          return errorResponse(502, "Provider status unavailable.");
        }
      }

      return errorResponse(404, "Not found");
    }

    return errorResponse(404, "Not found");
  } catch (err) {
    console.error("[mailotp-proxy] Unhandled error:", err instanceof Error ? err.message : err);
    if (err instanceof ProviderError) return errorResponse(err.status, err.message, err.code);
    return errorResponse(500, "Something went wrong. Please try again shortly.");
  }
});

// MailOtp prices every catalog service the same, but the "other" catch-all has
// no catalog entry — read its live price from the docs default by ordering
// with a dry lookup. The API exposes no dedicated price endpoint for it, so we
// use the task response price as the source of truth after creation; this
// helper only covers the pre-debit estimate for domain orders.
async function getProviderOtherPrice(): Promise<number | null> {
  try {
    const resp = await fetch(`${MAILOTP_BASE}/v1/services`, { headers: providerHeaders() });
    if (!resp.ok) return null;
    const body = await resp.json().catch(() => null);
    const raw: any[] = Array.isArray(body) ? body : Array.isArray(body?.services) ? body.services : [];
    const other = raw.find((s: any) => s?.slug === "other");
    if (other) return Number(other.price ?? 0) || null;
    return null;
  } catch {
    return null;
  }
}
