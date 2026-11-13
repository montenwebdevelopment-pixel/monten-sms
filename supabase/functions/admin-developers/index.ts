import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Developer Performance API for the Super Admin Portal. Requires a Supabase
// access token belonging to ADMIN_EMAIL. Every figure is computed from the
// database; secrets, password hashes and OTP codes are never selected.
// Sensitive actions require confirm: true and are written to admin_audit_logs.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ADMIN_EMAIL = "montensms@gmail.com";
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;
const DAY_MS = 86_400_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EPOCH_ISO = "1970-01-01T00:00:00.000Z";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function fail(status: number, message: string): Response {
  return json({ error: message }, status);
}

function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
}

async function authenticate(req: Request, admin: any): Promise<{ userId: string; email: string } | null> {
  const header = req.headers.get("Authorization");
  const token = header?.replace("Bearer ", "").trim();
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const email = (data.user.email ?? "").toLowerCase();
  if (email !== ADMIN_EMAIL) return null;
  return { userId: data.user.id, email };
}

async function rateLimit(admin: any, key: string): Promise<boolean> {
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { count } = await admin.from("rate_limits").select("*", { count: "exact", head: true })
    .eq("user_id", key).eq("endpoint", "admin-developers").gte("created_at", since);
  if (count !== null && count >= RATE_LIMIT) return false;
  await admin.from("rate_limits").insert({ user_id: key, endpoint: "admin-developers" });
  return true;
}

async function audit(admin: any, email: string, action: string, targetId: string, details: unknown) {
  await admin.from("admin_audit_logs").insert({
    admin_email: email, action, target_type: "developer", target_id: targetId, details,
  });
}

async function getConfig(admin: any) {
  const { data } = await admin.from("developer_api_config").select("*").eq("id", 1).maybeSingle();
  return data ?? { phone_rate_limit_per_min: 30, email_rate_limit_per_min: 20, phone_margin_naira: 500, email_price_naira: 238, enabled: true };
}

// ---------- date helpers ----------

function dayBounds(q: URLSearchParams): { from: string; to: string } | null {
  const f = q.get("from") ?? "";
  const t = q.get("to") ?? "";
  if (f && !DATE_RE.test(f)) return null;
  if (t && !DATE_RE.test(t)) return null;
  const from = f ? `${f}T00:00:00.000Z` : EPOCH_ISO;
  const toMs = t ? Date.parse(`${t}T00:00:00.000Z`) + DAY_MS : Date.now() + DAY_MS;
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(toMs)) return null;
  return { from, to: new Date(toMs).toISOString() };
}

function mondayOf(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

const dayKeys = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.now() - (n - 1 - i) * DAY_MS).toISOString().slice(0, 10));
const weekKeys = (n: number) => Array.from({ length: n }, (_, i) => mondayOf(new Date(Date.now() - (n - 1 - i) * 7 * DAY_MS)));
const monthKeys = (n: number) => Array.from({ length: n }, (_, i) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - (n - 1 - i));
  return d.toISOString().slice(0, 7);
});

function bucket(keys: string[], items: { at: string; value: number }[], keyOf: (iso: string) => string) {
  const totals = new Map<string, number>(keys.map((k) => [k, 0]));
  for (const it of items) {
    const k = keyOf(it.at);
    if (totals.has(k)) totals.set(k, (totals.get(k) ?? 0) + it.value);
  }
  return keys.map((k) => ({ date: k, n: Math.round((totals.get(k) ?? 0) * 100) / 100 }));
}

const byDay = (iso: string) => iso.slice(0, 10);
const byWeek = (iso: string) => mondayOf(new Date(iso));
const byMonth = (iso: string) => iso.slice(0, 7);

// ---------- list ----------

async function listDevelopers(admin: any, q: URLSearchParams): Promise<Response> {
  const bounds = dayBounds(q);
  if (!bounds) return fail(400, "Invalid date filter.");

  const { data: rows, error } = await admin.rpc("admin_developer_summary", { p_from: bounds.from, p_to: bounds.to, p_user: null });
  if (error) return fail(500, "Could not load developer statistics.");
  const list: any[] = rows ?? [];
  const ids = list.map((r) => r.user_id);

  const [users, profiles, accounts, cfg] = await Promise.all([
    Promise.all(ids.map((id) => admin.auth.admin.getUserById(id))),
    ids.length ? admin.from("profiles").select("id,full_name,username").in("id", ids) : { data: [] },
    ids.length ? admin.from("developer_accounts").select("user_id,status,rate_limit_per_min,phone_margin_naira,email_price_naira").in("user_id", ids) : { data: [] },
    getConfig(admin),
  ]);
  const userMap = new Map<string, any>(ids.map((id, i) => [id, users[i]?.data?.user ?? null]));
  const profMap = new Map<string, any>((profiles.data ?? []).map((p: any) => [p.id, p]));
  const accMap = new Map<string, any>((accounts.data ?? []).map((a: any) => [a.user_id, a]));

  const developers = list.map((r) => {
    const u = userMap.get(r.user_id);
    const p = profMap.get(r.user_id);
    const a = accMap.get(r.user_id);
    return {
      user_id: r.user_id,
      email: u?.email ?? "",
      full_name: p?.full_name ?? "",
      username: p?.username ?? "",
      registered_at: u?.created_at ?? null,
      account_status: a?.status ?? "active",
      rate_limit_per_min: a?.rate_limit_per_min ?? null,
      phone_margin_naira: a?.phone_margin_naira ?? null,
      email_price_naira: a?.email_price_naira ?? null,
      keys_total: Number(r.keys_total),
      keys_active: Number(r.keys_active),
      webhooks_active: Number(r.webhooks_active),
      api_requests: Number(r.api_requests),
      api_success: Number(r.api_success),
      api_failed: Number(r.api_failed),
      phone_success: Number(r.phone_success),
      phone_pending: Number(r.phone_pending),
      phone_failed: Number(r.phone_failed),
      phone_cancelled: Number(r.phone_cancelled),
      email_success: Number(r.email_success),
      email_pending: Number(r.email_pending),
      email_failed: Number(r.email_failed),
      email_cancelled: Number(r.email_cancelled),
      successful_otp_orders: Number(r.phone_success) + Number(r.email_success),
      spent_success: Number(r.spent_success),
      spent_pending: Number(r.spent_pending),
      last_api_at: r.last_api_at ?? null,
      last_order_at: r.last_order_at ?? null,
      last_login_at: r.last_login_at ?? null,
    };
  });

  return json({
    developers,
    range: { from: q.get("from") || null, to: q.get("to") || null },
    defaults: { rate_limit_per_min: cfg.phone_rate_limit_per_min, phone_margin_naira: cfg.phone_margin_naira, email_price_naira: cfg.email_price_naira, enabled: cfg.enabled },
  });
}

// ---------- profile ----------

function orderRow(o: any) {
  const m = o.meta ?? {};
  return {
    id: o.id,
    order_ref: o.order_ref,
    kind: o.kind,
    service: o.service,
    country: o.country ?? null,
    amount: Number(o.amount),
    status: o.status,
    created_at: o.created_at,
    phone: o.kind === "phone" ? (m.phone ?? null) : null,
    address: o.kind === "email" ? (m.email ?? null) : null,
    error: m.error ?? null,
  };
}

function countBy(items: any[], key: (x: any) => string | null): { name: string; count: number }[] {
  const map = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    if (!k) continue;
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10);
}

async function developerProfile(admin: any, userId: string): Promise<Response> {
  if (!UUID_RE.test(userId)) return fail(400, "Invalid developer id.");
  const allFrom = EPOCH_ISO;
  const allTo = new Date(Date.now() + DAY_MS).toISOString();

  const [authRes, summaryRes, usageRes, profileRes, accountRes, keysRes, ordersRes, ledgerRes, hooksRes, ticketsRes, cfg, delivered, pending, failedDel, totalDel, lastLogin] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin.rpc("admin_developer_summary", { p_from: allFrom, p_to: allTo, p_user: userId }),
    admin.rpc("admin_developer_usage_stats", { p_user: userId, p_days: 30 }),
    admin.from("profiles").select("id,full_name,username,wallet_balance,created_at").eq("id", userId).maybeSingle(),
    admin.from("developer_accounts").select("*").eq("user_id", userId).maybeSingle(),
    admin.from("developer_api_keys").select("id,name,key_prefix,environment,active,created_at,last_used_at,revoked_at").eq("user_id", userId).order("created_at", { ascending: false }),
    admin.from("developer_api_transactions").select("id,order_ref,kind,service,country,amount,status,meta,created_at").eq("user_id", userId).order("created_at", { ascending: false }),
    admin.from("transactions").select("id,type,amount,status,reference,description,created_at").eq("user_id", userId).order("created_at", { ascending: false }),
    admin.from("developer_webhooks").select("id,url,active,created_at").eq("user_id", userId).order("created_at", { ascending: false }),
    admin.from("support_tickets").select("id,case_ref,subject,category,status,priority,escalated,created_at,updated_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(100),
    getConfig(admin),
    admin.from("developer_webhook_deliveries").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "delivered"),
    admin.from("developer_webhook_deliveries").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "pending"),
    admin.from("developer_webhook_deliveries").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "failed"),
    admin.from("developer_webhook_deliveries").select("id", { count: "exact", head: true }).eq("user_id", userId),
    admin.from("login_activity").select("created_at").eq("user_id", userId).eq("event_type", "login").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const authUser = authRes?.data?.user ?? null;
  if (!authUser) return fail(404, "Developer not found.");
  if (summaryRes.error || usageRes.error) return fail(500, "Could not load developer statistics.");

  const s: any = (summaryRes.data ?? [])[0] ?? {};
  const usage: any = usageRes.data ?? { daily: [], endpoints: [], totals: {} };
  const profile: any = profileRes.data ?? {};
  const account: any = accountRes.data ?? null;
  const orders: any[] = ordersRes.data ?? [];
  const ledger: any[] = ledgerRes.data ?? [];
  const now = Date.now();
  const sumOf = (items: any[], pred: (x: any) => boolean) => items.filter(pred).reduce((acc, x) => acc + Number(x.amount ?? 0), 0);

  const completedOrders = orders.filter((o) => o.status === "completed");
  const completedPhone = orders.filter((o) => o.kind === "phone" && o.status === "completed");
  const at = (rows: any[]) => rows.map((r) => ({ at: r.created_at, value: 1 }));

  const ledgerDeposits = ledger.filter((t) => t.type === "deposit");
  const apiLedger = ledger.filter((t) => String(t.reference ?? "").startsWith("devapi"));
  const apiCharges = apiLedger.filter((t) => t.type === "purchase" && t.status === "completed");
  const apiRefunds = apiLedger.filter((t) => t.type === "refund" && t.status === "completed");

  const countries = countBy(completedPhone, (o) => o.country);
  const services = countBy(orders.filter((o) => o.status === "completed"), (o) => `${o.kind === "phone" ? "Phone" : "Email"}: ${o.service}`);

  return json({
    developer: {
      user_id: userId,
      email: authUser.email ?? "",
      full_name: profile.full_name ?? "",
      username: profile.username ?? "",
      registered_at: authUser.created_at ?? null,
      last_sign_in_at: authUser.last_sign_in_at ?? null,
      last_login_at: lastLogin.data?.created_at ?? null,
      last_api_at: usage.totals?.last_at ?? null,
      account_status: account?.status ?? "active",
      status_reason: account?.status_reason ?? null,
      status_updated_at: account?.updated_at ?? null,
      rate_limit_per_min: account?.rate_limit_per_min ?? null,
      phone_margin_naira: account?.phone_margin_naira ?? null,
      email_price_naira: account?.email_price_naira ?? null,
    },
    defaults: { rate_limit_per_min: cfg.phone_rate_limit_per_min, phone_margin_naira: cfg.phone_margin_naira, email_price_naira: cfg.email_price_naira },
    summary: {
      keys_total: Number(s.keys_total ?? 0),
      keys_active: Number(s.keys_active ?? 0),
      webhooks_active: Number(s.webhooks_active ?? 0),
    },
    phone: {
      stats: {
        total: Number(s.phone_total ?? 0),
        success: Number(s.phone_success ?? 0),
        pending: Number(s.phone_pending ?? 0),
        failed: Number(s.phone_failed ?? 0),
        cancelled: Number(s.phone_cancelled ?? 0),
        spent_success: Number(s.spent_success ?? 0),
        spent_pending: Number(s.spent_pending ?? 0),
      },
      countries,
      services: services.filter((x) => x.name.startsWith("Phone:")),
      history: orders.filter((o) => o.kind === "phone").slice(0, 200).map(orderRow),
    },
    email: {
      stats: {
        total: Number(s.email_total ?? 0),
        success: Number(s.email_success ?? 0),
        pending: Number(s.email_pending ?? 0),
        failed: Number(s.email_failed ?? 0),
        cancelled: Number(s.email_cancelled ?? 0),
      },
      history: orders.filter((o) => o.kind === "email").slice(0, 200).map(orderRow),
    },
    api: {
      totals: {
        requests: Number(usage.totals?.requests ?? 0),
        ok: Number(usage.totals?.ok ?? 0),
        failed: Number(usage.totals?.failed ?? 0),
        last_at: usage.totals?.last_at ?? null,
      },
      endpoints: usage.endpoints ?? [],
      keys: keysRes.data ?? [],
      webhooks: {
        endpoints: hooksRes.data ?? [],
        counts: {
          total: totalDel.count ?? 0,
          delivered: delivered.count ?? 0,
          pending: pending.count ?? 0,
          failed: failedDel.count ?? 0,
        },
      },
    },
    finance: {
      wallet_balance: Number(profile.wallet_balance ?? 0),
      deposits: {
        completed_amount: sumOf(ledgerDeposits, (t) => t.status === "completed"),
        completed_count: ledgerDeposits.filter((t) => t.status === "completed").length,
        pending_count: ledgerDeposits.filter((t) => t.status === "pending").length,
        failed_count: ledgerDeposits.filter((t) => t.status === "failed").length,
      },
      api_charged: { amount: sumOf(apiCharges, () => true), count: apiCharges.length },
      api_refunded: { amount: sumOf(apiRefunds, () => true), count: apiRefunds.length },
      orders: {
        completed_amount: sumOf(orders, (o) => o.status === "completed"),
        pending_amount: sumOf(orders, (o) => o.status === "pending" || o.status === "waiting"),
        completed_count: orders.filter((o) => o.status === "completed").length,
        pending_count: orders.filter((o) => o.status === "pending" || o.status === "waiting").length,
        failed_count: orders.filter((o) => o.status === "failed").length,
        cancelled_count: orders.filter((o) => o.status === "cancelled").length,
      },
      ledger: ledger.slice(0, 150).map((t) => ({
        id: t.id, type: t.type, amount: Number(t.amount), status: t.status, reference: t.reference, description: t.description, created_at: t.created_at,
      })),
    },
    charts: {
      numbersDaily: bucket(dayKeys(30), at(completedPhone), byDay),
      numbersWeekly: bucket(weekKeys(12), at(completedPhone), byWeek),
      numbersMonthly: bucket(monthKeys(12), at(completedPhone), byMonth),
      spendDaily: bucket(dayKeys(30), completedOrders.map((o) => ({ at: o.created_at, value: Number(o.amount) })), byDay),
      apiDaily: (usage.daily ?? []).map((d: any) => ({ date: d.date, requests: d.requests, ok: d.ok, failed: d.failed })),
    },
    support: ticketsRes.data ?? [],
    generated_at: new Date(now).toISOString(),
  });
}

// ---------- admin actions ----------

async function applyAccountPatch(admin: any, auth: { email: string }, userId: string, patch: Record<string, unknown>, action: string) {
  const { data: before } = await admin.from("developer_accounts").select("*").eq("user_id", userId).maybeSingle();
  const { error } = await admin.from("developer_accounts").upsert(
    { user_id: userId, ...patch, updated_at: new Date().toISOString(), updated_by: auth.email },
    { onConflict: "user_id" },
  );
  if (error) return fail(500, "Could not save the change.");
  await audit(admin, auth.email, action, userId, { before: before ?? null, after: patch });
  return json({ ok: true });
}

async function developerExists(admin: any, userId: string): Promise<boolean> {
  const { data } = await admin.auth.admin.getUserById(userId);
  return !!data?.user;
}

async function setStatus(admin: any, auth: { email: string }, body: any): Promise<Response> {
  if (body?.confirm !== true) return fail(400, "Confirmation required.");
  if (!UUID_RE.test(body?.user_id ?? "")) return fail(400, "Invalid developer id.");
  if (body.status !== "active" && body.status !== "suspended") return fail(400, "Status must be active or suspended.");
  if (!(await developerExists(admin, body.user_id))) return fail(404, "Developer not found.");
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
  const patch = { status: body.status, status_reason: body.status === "suspended" ? (reason || null) : null };
  return await applyAccountPatch(admin, auth, body.user_id, patch, body.status === "suspended" ? "suspend_developer" : "activate_developer");
}

async function setLimit(admin: any, auth: { email: string }, body: any): Promise<Response> {
  if (body?.confirm !== true) return fail(400, "Confirmation required.");
  if (!UUID_RE.test(body?.user_id ?? "")) return fail(400, "Invalid developer id.");
  let value: number | null = null;
  if (body.rate_limit_per_min !== null) {
    value = Math.floor(Number(body.rate_limit_per_min));
    if (!Number.isFinite(value) || value < 1 || value > 1000) return fail(400, "Limit must be between 1 and 1000 requests per minute, or blank to use the default.");
  }
  if (!(await developerExists(admin, body.user_id))) return fail(404, "Developer not found.");
  return await applyAccountPatch(admin, auth, body.user_id, { rate_limit_per_min: value }, "set_developer_rate_limit");
}

function parsePrice(v: unknown): number | null | "invalid" {
  if (v === null || v === "" || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return "invalid";
  return Math.round(n);
}

async function setPricing(admin: any, auth: { email: string }, body: any): Promise<Response> {
  if (body?.confirm !== true) return fail(400, "Confirmation required.");
  if (!UUID_RE.test(body?.user_id ?? "")) return fail(400, "Invalid developer id.");
  const margin = parsePrice(body.phone_margin_naira);
  const emailPrice = parsePrice(body.email_price_naira);
  if (margin === "invalid" || emailPrice === "invalid") return fail(400, "Prices must be whole naira amounts between 0 and 1,000,000, or blank to use the default.");
  if (!(await developerExists(admin, body.user_id))) return fail(404, "Developer not found.");
  return await applyAccountPatch(admin, auth, body.user_id, { phone_margin_naira: margin, email_price_naira: emailPrice }, "set_developer_pricing");
}

// ---------- routing ----------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^.*\/admin-developers\/?/, "");
    const admin = adminClient();

    const auth = await authenticate(req, admin);
    if (!auth) return fail(403, "Admin access denied.");
    if (!(await rateLimit(admin, auth.userId))) return fail(429, "Too many requests. Slow down.");

    const seg = path.split("/").filter(Boolean);
    if (seg[0] !== "performance") return fail(404, "unknown endpoint");

    if (req.method === "GET") {
      if (seg[1]) return await developerProfile(admin, seg[1]);
      return await listDevelopers(admin, url.searchParams);
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (seg[1] === "status") return await setStatus(admin, auth, body);
      if (seg[1] === "limits") return await setLimit(admin, auth, body);
      if (seg[1] === "pricing") return await setPricing(admin, auth, body);
      return fail(404, "unknown endpoint");
    }

    return fail(405, "method not allowed");
  } catch (err) {
    console.error("[admin-developers]", err instanceof Error ? err.message : err);
    return fail(500, "Internal error. Check function logs.");
  }
});
