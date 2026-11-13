import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const FIVESIM_API_KEY = Deno.env.get("FIVESIM_API_KEY") ?? "";
const FIVESIM_BASE = "https://5sim.net/v1";

const EUR_TO_NGN = 1250;
const PROFIT_MARGIN_NGN = 1000;

const ALLOWED_PARAM = /^[a-zA-Z0-9_-]+$/;

function convertPrice(eurPrice: number): number {
  const ngnPrice = eurPrice * EUR_TO_NGN;
  const withProfit = ngnPrice + PROFIT_MARGIN_NGN;
  return Math.ceil(withProfit / 10) * 10;
}

// 5SIM returns `expires` as an ISO 8601 string ("2026-10-28T14:32:00.000Z");
// older payloads used epoch seconds or milliseconds. Normalise every shape to
// epoch milliseconds so the client countdown has a number to tick against.
function parseExpires(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      return n < 1e12 ? n * 1000 : n;
    }
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function errorResponse(status: number, message: string): Response {
  return jsonResponse({ error: message }, status);
}

function sanitizeParam(value: string | undefined, name: string): string {
  if (!value || !ALLOWED_PARAM.test(value)) {
    throw new Error(`Invalid ${name} parameter`);
  }
  return value;
}

async function authenticate(req: Request): Promise<{ userId: string; token: string } | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return { userId: data.user.id, token };
}

function getUserDb(token: string) {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

async function checkRateLimit(supabase: any, userId: string, endpoint: string, maxRequests: number, windowMs: number): Promise<boolean> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count } = await supabase.from("rate_limits").select("*", { count: "exact", head: true }).eq("user_id", userId).eq("endpoint", endpoint).gte("created_at", since);
  if (count !== null && count >= maxRequests) return false;
  await supabase.from("rate_limits").insert({ user_id: userId, endpoint });
  return true;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const resource = segments[0] === "fivesim-proxy" ? segments[1] : segments[0];
    const param1 = segments[0] === "fivesim-proxy" ? segments[2] : segments[1];
    const param2 = segments[0] === "fivesim-proxy" ? segments[3] : segments[2];

    // GET /countries — public, no auth needed
    if (resource === "countries" && req.method === "GET") {
      const resp = await fetch(`${FIVESIM_BASE}/guest/countries`, { headers: { Authorization: `Bearer ${FIVESIM_API_KEY}`, Accept: "application/json" } });
      const rawText = await resp.text();
      if (!resp.ok) return errorResponse(502, "Failed to fetch countries");
      let data: Record<string, any>;
      try { data = JSON.parse(rawText); } catch { return errorResponse(502, "5SIM returned invalid data"); }
      const COUNTRY_RENAMES: Record<string, string> = { england: "United Kingdom", usa: "United States" };
      const countries = Object.entries(data).map(([code, info]: [string, any]) => ({
        code,
        name: COUNTRY_RENAMES[code] || info.text_en || info.text || code,
      }));
      return jsonResponse({ countries });
    }

    const auth = await authenticate(req);
    if (!auth) return errorResponse(401, "Unauthorized");

    // Rate limit for all authenticated endpoints
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

    // GET /services/:country
    if (resource === "services" && req.method === "GET" && param1) {
      const allowed = await checkRateLimit(supabaseAdmin, auth.userId, "services", 30, 60_000);
      if (!allowed) return errorResponse(429, "Too many requests. Please slow down.");
      let country: string;
      try { country = sanitizeParam(param1, "country"); } catch (e) { return errorResponse(400, e.message); }
      const resp = await fetch(`${FIVESIM_BASE}/guest/products/${country}/any`, { headers: { Authorization: `Bearer ${FIVESIM_API_KEY}`, Accept: "application/json" } });
      const rawText = await resp.text();
      if (!resp.ok) return errorResponse(502, "Failed to fetch services");
      let data: Record<string, any>;
      try { data = JSON.parse(rawText); } catch { return errorResponse(502, "5SIM returned invalid data"); }
      const services = Object.entries(data)
        .filter(([, info]: [string, any]) => info.Category === "activation" && info.Qty > 0)
        .map(([code]: [string, any]) => ({ code, name: code.charAt(0).toUpperCase() + code.slice(1) }));
      return jsonResponse({ services });
    }

    // GET /offers/:country/:service
    if (resource === "offers" && req.method === "GET" && param1 && param2) {
      const allowed = await checkRateLimit(supabaseAdmin, auth.userId, "offers", 60, 60_000);
      if (!allowed) return errorResponse(429, "Too many requests. Please slow down.");
      let country: string, service: string;
      try { country = sanitizeParam(param1, "country"); service = sanitizeParam(param2, "service"); }
      catch (e) { return errorResponse(400, e.message); }
      const resp = await fetch(`${FIVESIM_BASE}/guest/prices?country=${encodeURIComponent(country)}&product=${encodeURIComponent(service)}`, { headers: { Authorization: `Bearer ${FIVESIM_API_KEY}`, Accept: "application/json" } });
      const rawText = await resp.text();
      if (!resp.ok) return errorResponse(502, "Failed to fetch offers");
      let data: any;
      try { data = JSON.parse(rawText); } catch { return errorResponse(502, "5SIM returned invalid data"); }
      const offers: { operator: string; stock: number; price: number; rate: number }[] = [];
      let totalStock = 0, maxCost = 0, avgRate = 0, rateCount = 0;
      try {
        const countryData = data[country] || {};
        const serviceData = countryData[service] || {};
        for (const [operator, info] of Object.entries(serviceData)) {
          const cost = Number((info as any).cost ?? 0);
          const count = Number((info as any).count ?? 0);
          const rate = Number((info as any).rate ?? 0);
          if (count > 0 && cost > 0) {
            offers.push({ operator, stock: count, price: convertPrice(cost), rate });
            totalStock += count;
            if (cost > maxCost) maxCost = cost;
            if (rate > 0) { avgRate += rate; rateCount++; }
          }
        }
      } catch (e) { console.error("[fivesim-proxy] Error parsing offers:", e); }

      // Show all operators including virtual51, virtual59, and "any".
      // The "any" option is computed from all available operators so customers
      // can let 5SIM pick the cheapest supplier.
      let anyStock = 0, anyMaxCost = 0, anyAvgRate = 0, anyRateCount = 0;
      const individual = offers.filter(o => o.operator !== "any");
      for (const o of individual) {
        anyStock += o.stock;
        if (o.price > anyMaxCost) anyMaxCost = o.price;
        if (o.rate > 0) { anyAvgRate += o.rate; anyRateCount++; }
      }
      individual.sort((a, b) => a.price - b.price);
      if (anyStock > 0 && individual.length > 0) {
        individual.push({
          operator: "any",
          stock: anyStock,
          price: anyMaxCost,
          rate: anyRateCount > 0 ? Math.round((anyAvgRate / anyRateCount) * 100) / 100 : 0,
        });
      }
      return jsonResponse({ offers: individual.slice(0, 4) });
    }

    // POST /purchase — buy a number
    if (resource === "purchase" && req.method === "POST") {
      const allowed = await checkRateLimit(supabaseAdmin, auth.userId, "purchase", 5, 60_000);
      if (!allowed) return errorResponse(429, "Too many purchase attempts. Please wait a minute.");

      const supabase = getUserDb(auth.token);
      const body = await req.json();
      let country: string, service: string, operator: string;
      try {
        country = sanitizeParam(body.country, "country");
        service = sanitizeParam(body.service, "service");
        operator = sanitizeParam(body.operator, "operator");
      } catch (e) { return errorResponse(400, e.message); }

      // Look up the real price from 5SIM — never trust client-sent price
      const priceResp = await fetch(`${FIVESIM_BASE}/guest/prices?country=${encodeURIComponent(country)}&product=${encodeURIComponent(service)}`, { headers: { Authorization: `Bearer ${FIVESIM_API_KEY}`, Accept: "application/json" } });
      if (!priceResp.ok) return errorResponse(502, "Failed to verify price");
      const priceData = await priceResp.json();

      const actualOperator = operator;

      let eurPrice = 0;
      try {
        const countryData = priceData[country] || {};
        const serviceData = countryData[service] || {};
        if (actualOperator === "any") {
          let maxCost = 0;
          for (const [, info] of Object.entries(serviceData)) {
            const cost = Number((info as any).cost ?? 0);
            const count = Number((info as any).count ?? 0);
            if (count > 0 && cost > maxCost) maxCost = cost;
          }
          eurPrice = maxCost;
        } else {
          const operatorData = serviceData[actualOperator] || {};
          eurPrice = Number(operatorData.cost ?? 0);
        }
      } catch { return errorResponse(502, "Failed to parse price"); }
      if (eurPrice <= 0) return errorResponse(400, "No price available for this service/operator");
      const price = convertPrice(eurPrice);

      // Debit wallet BEFORE buying from 5SIM — prevents orphaned numbers.
      // Uses the admin client because wallet RPCs are not executable by authenticated users.
      const { data: _debitResult, error: debitError } = await supabaseAdmin.rpc("debit_wallet_for_user", {
        p_user_id: auth.userId,
        p_amount: price,
        p_reference: `5sim_prepay_${auth.userId}_${Date.now()}`,
        p_description: `Number purchase: ${service} (${country})`,
      });
      if (debitError) {
        const msg = debitError.message || "";
        if (msg.includes("DUPLICATE_REFERENCE")) return errorResponse(409, "Duplicate request");
        return errorResponse(400, msg.includes("Insufficient") ? "Insufficient wallet balance" : "Failed to process payment");
      }

      const apiUrl = `${FIVESIM_BASE}/user/buy/activation/${country}/${actualOperator}/${service}`;
      const resp = await fetch(apiUrl, { headers: { Authorization: `Bearer ${FIVESIM_API_KEY}`, Accept: "application/json" } });
      const rawText = await resp.text();
      if (!resp.ok) {
        // Refund the debit since 5SIM purchase failed
        await supabaseAdmin.rpc("refund_wallet_for_user", {
          p_user_id: auth.userId,
          p_amount: price,
          p_reference: `5sim_refund_${auth.userId}_${Date.now()}`,
          p_description: "Refund: 5SIM purchase failed",
        });
        return errorResponse(502, "5SIM purchase failed");
      }
      let data: any;
      try { data = JSON.parse(rawText); } catch {
        await supabaseAdmin.rpc("refund_wallet_for_user", {
          p_user_id: auth.userId,
          p_amount: price,
          p_reference: `5sim_refund_${auth.userId}_${Date.now()}`,
          p_description: "Refund: 5SIM returned invalid data",
        });
        return errorResponse(502, "5SIM returned invalid data");
      }

      const { data: purchased, error: insertError } = await supabaseAdmin.from("purchased_numbers").insert({
        user_id: auth.userId, fivesim_id: String(data.id), phone_number: data.phone,
        country_code: country, country_name: country, service_name: service, operator_name: actualOperator,
        cost_price: price, selling_price: price, status: "waiting",
      }).select().single();

      if (insertError) {
        // Number was bought but DB insert failed — cancel on 5SIM and refund
        await fetch(`${FIVESIM_BASE}/user/cancel/${data.id}`, { headers: { Authorization: `Bearer ${FIVESIM_API_KEY}` } });
        await supabaseAdmin.rpc("refund_wallet_for_user", {
          p_user_id: auth.userId,
          p_amount: price,
          p_reference: `5sim_refund_${auth.userId}_${Date.now()}`,
          p_description: "Refund: DB insert failed",
        });
        return errorResponse(500, "Failed to save purchased number");
      }

      await supabaseAdmin.from("notifications").insert({
        user_id: auth.userId, type: "purchase", title: "Number Purchased",
        message: `Your number ${data.phone} is ready. Waiting for OTP...`,
      });
      // 5SIM's `expires` is an ISO 8601 timestamp. Some payloads also include
      // `created_at`; we use whichever is present so the countdown matches
      // 5SIM's real 5-minute window. The 5-minute fallback only applies if
      // neither field is present.
      const fiveSimExpires = parseExpires(data.expires);
      const fiveSimCreated = parseExpires(data.created_at);
      const expiresAt = fiveSimExpires ?? fiveSimCreated ?? (Date.now() + 5 * 60 * 1000);
      return jsonResponse({ id: String(data.id), phone: data.phone, operator: actualOperator, purchasedId: purchased?.id, expiresAt });
    }

    // GET /sms/:id — check SMS status
    if (resource === "sms" && req.method === "GET" && param1) {
      // The dashboard polls this every 5s (12/min) for the active number, so the
      // ceiling leaves normal polling untouched while bounding the paid
      // upstream requests a single account can drive.
      const allowed = await checkRateLimit(supabaseAdmin, auth.userId, "sms", 60, 60_000);
      if (!allowed) return errorResponse(429, "Too many requests. Please slow down.");
      let fivesimId: string;
      try { fivesimId = sanitizeParam(param1, "id"); } catch (e) { return errorResponse(400, e.message); }

      const supabase = getUserDb(auth.token);
      const { data: owned } = await supabase.from("purchased_numbers").select("id").eq("fivesim_id", fivesimId).eq("user_id", auth.userId).maybeSingle();
      if (!owned) return errorResponse(403, "You don't own this number");

      const resp = await fetch(`${FIVESIM_BASE}/user/check/${fivesimId}`, { headers: { Authorization: `Bearer ${FIVESIM_API_KEY}`, Accept: "application/json" } });
      const rawText = await resp.text();
      if (!resp.ok) return errorResponse(502, "Failed to check SMS status");
      let data: any;
      try { data = JSON.parse(rawText); } catch { return errorResponse(502, "5SIM returned invalid data"); }

      const rawStatus = (data.status || "PENDING").toUpperCase();
      let status: "waiting" | "received" | "canceled" | "failed" = "waiting";
      if (rawStatus === "RECEIVED") status = "received";
      else if (rawStatus === "CANCELED") status = "canceled";
      else if (rawStatus === "TIMEOUT" || rawStatus === "BANNED") status = "failed";

      let smsText: string | null = null;
      let smsCode: string | null = null;
      if (data.sms && Array.isArray(data.sms) && data.sms.length > 0) {
        smsText = data.sms[0].text || null;
        smsCode = data.sms[0].code || null;
      }
      if (status === "received" && smsCode) {
        await supabaseAdmin.from("purchased_numbers").update({ sms_text: smsText, sms_code: smsCode, status: "received" }).eq("fivesim_id", fivesimId).eq("user_id", auth.userId).in("status", ["waiting", "pending"]);
      } else if (status === "canceled" || status === "failed") {
        // Settle atomically via the RPC so the refund happens in the same
        // transaction as the status flip. A bare UPDATE here would mark the
        // row terminal before the order-watcher can refund it, losing the
        // refund — the watcher would then see `already_terminal` and skip.
        // If the watcher already settled it, the RPC returns already_terminal
        // and no double refund occurs.
        await supabaseAdmin.rpc("settle_failed_number", {
          p_purchased_number_id: (owned as any).id,
          p_terminal_status: status,
          p_failure_reason: rawStatus,
        });
      }
      const fiveSimExpires = parseExpires(data.expires);
      const fiveSimCreated = parseExpires(data.created_at);
      const expiresAt = fiveSimExpires ?? fiveSimCreated ?? (Date.now() + 5 * 60 * 1000);
      return jsonResponse({ status, smsText, smsCode, expiresAt });
    }

    // POST /cancel/:id — cancel a number
    if (resource === "cancel" && req.method === "POST" && param1) {
      const allowed = await checkRateLimit(supabaseAdmin, auth.userId, "cancel", 15, 60_000);
      if (!allowed) return errorResponse(429, "Too many cancel attempts. Please wait a moment.");
      let fivesimId: string;
      try { fivesimId = sanitizeParam(param1, "id"); } catch (e) { return errorResponse(400, e.message); }

      const supabase = getUserDb(auth.token);
      const { data: owned } = await supabase.from("purchased_numbers").select("id, selling_price, status, sms_code").eq("fivesim_id", fivesimId).eq("user_id", auth.userId).maybeSingle();
      if (!owned) return errorResponse(403, "You don't own this number");

      const previousStatus = String((owned as any).status || "");
      // A number whose code has already been delivered has been consumed and is
      // NOT refundable, whatever the UI happens to be showing. Enforced here
      // because this route is reachable without the UI.
      if (previousStatus === "received" || (owned as any).sms_code) {
        return errorResponse(409, "This number already received its code and can no longer be canceled");
      }
      if (previousStatus === "canceled") {
        return errorResponse(409, "This number has already been canceled");
      }
      // `failed` is excluded: failed numbers are already refunded automatically.
      const REFUNDABLE_STATUSES = ["waiting", "pending"];
      if (!REFUNDABLE_STATUSES.includes(previousStatus)) {
        return errorResponse(409, "This number can no longer be canceled");
      }

      // Atomic single-use claim: only the caller that actually flips the row away
      // from a refundable state proceeds to the refund. The status and sms_code
      // filters make the claim re-check delivery at write time.
      const { data: claimed } = await supabaseAdmin
        .from("purchased_numbers")
        .update({ status: "canceled" })
        .eq("fivesim_id", fivesimId)
        .eq("user_id", auth.userId)
        .in("status", REFUNDABLE_STATUSES)
        .is("sms_code", null)
        .select("id, selling_price")
        .maybeSingle();
      if (!claimed) return errorResponse(409, "This number can no longer be canceled");

      const resp = await fetch(`${FIVESIM_BASE}/user/cancel/${fivesimId}`, { headers: { Authorization: `Bearer ${FIVESIM_API_KEY}`, Accept: "application/json" } });
      if (!resp.ok) {
        // Restore the status the row actually had, never a hardcoded one.
        await supabaseAdmin.from("purchased_numbers").update({ status: previousStatus }).eq("fivesim_id", fivesimId).eq("user_id", auth.userId);
        return errorResponse(502, "Failed to cancel number on 5SIM");
      }

      const refundAmount = Number((claimed as any).selling_price) || 0;
      if (refundAmount > 0) {
        const { error: refundError } = await supabaseAdmin.rpc("refund_wallet_for_user", {
          p_user_id: auth.userId,
          p_amount: refundAmount,
          p_reference: `5sim_cancel_${fivesimId}`,
          p_description: "Refund for canceled number",
        });
        if (refundError) {
          console.error("[fivesim-proxy] Refund failed:", refundError.message);
        }
      }
      return jsonResponse({ success: true, status: "canceled", refund: refundAmount });
    }

    return errorResponse(404, "Not found");
  } catch (err) {
    console.error("[fivesim-proxy] Unhandled error:", err);
    return errorResponse(500, "Internal server error");
  }
});
