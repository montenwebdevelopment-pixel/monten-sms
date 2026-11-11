import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// email-otp-watcher: scheduled worker that force-expires `email_otp_orders`
// rows still `waiting` past their 5-minute window. Before settling an order it
// checks the LIVE MailOtp task status, so a customer is only refunded after the
// provider has actually released its payment hold. Received orders are left
// untouched — a delivered code is never cancelled or refunded.
//
// Invoked every minute by pg_cron via the Supabase scheduled-function hook.
// Runs entirely with the service-role key; no user session involved.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Watcher-Secret",
};

const MAILOTP_API_KEY = Deno.env.get("MAILOTP_API_KEY") ?? "";
const MAILOTP_BASE = "https://api.mailotp.org";
const WATCHER_SECRET = Deno.env.get("EMAIL_OTP_WATCHER_SECRET") ?? "";

// The customer-facing window is 5 minutes. A short grace period beyond the
// provider's own TTL lets a last-second delivery land before we force-cancel.
const EXPIRY_MS = 5 * 60 * 1000;
const GRACE_MS = 30 * 1000;

interface WaitingOrder {
  id: string;
  user_id: string;
  service: string;
  mailotp_task_id: string | null;
  charge_naira: number | string | null;
  provider_price_usd: number | string | null;
  created_at: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (!WATCHER_SECRET) {
    console.error("[email-otp-watcher] EMAIL_OTP_WATCHER_SECRET is not configured");
    return jsonResponse({ error: "Watcher is not configured" }, 503);
  }
  if (req.headers.get("x-watcher-secret") !== WATCHER_SECRET) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const stats = { checked: 0, expired: 0, received: 0, skipped: 0, errors: 0, firstErrors: [] as string[] };
  const noteError = (msg: string) => {
    stats.errors += 1;
    if (stats.firstErrors.length < 3) stats.firstErrors.push(msg.slice(0, 200));
  };

  try {
    const { data: waiting, error: fetchError } = await supabaseAdmin
      .from("email_otp_orders")
      .select("id, user_id, service, mailotp_task_id, charge_naira, provider_price_usd, created_at")
      .eq("status", "waiting")
      .order("created_at", { ascending: true })
      .limit(50);

    if (fetchError) {
      console.error("[email-otp-watcher] Failed to load waiting orders:", fetchError.message);
      return jsonResponse({ ...stats, error: fetchError.message }, 500);
    }
    if (!waiting || waiting.length === 0) {
      return jsonResponse({ ...stats, message: "No waiting email orders" });
    }

    for (const row of waiting as WaitingOrder[]) {
      stats.checked += 1;
      try {
        if (!row.mailotp_task_id) {
          const ageMs = Date.now() - Date.parse(row.created_at);
          if (!Number.isFinite(ageMs) || ageMs < EXPIRY_MS + GRACE_MS) {
            stats.skipped += 1;
            continue;
          }

          // A taskless row can be left behind if provisioning failed after the
          // wallet debit. Recover the debit by its idempotent reference so the
          // watcher can retry a refund instead of silently expiring the order.
          const { data: debit, error: debitError } = await supabaseAdmin
            .from("transactions")
            .select("amount")
            .eq("user_id", row.user_id)
            .eq("type", "purchase")
            .eq("status", "completed")
            .eq("reference", `mo_charge_${row.id}`)
            .maybeSingle();
          if (debitError) {
            noteError(`debit lookup ${row.id}: ${debitError.message}`);
            continue;
          }
          const charge = Number(row.charge_naira ?? 0) || Number(debit?.amount ?? 0);
          if (charge > 0) {
            const { error: refundError } = await supabaseAdmin.rpc("refund_wallet_for_user", {
              p_user_id: row.user_id,
              p_amount: charge,
              p_reference: `mo_refund_${row.id}`,
              p_description: "Refund: email purchase could not be completed",
            });
            if (refundError) {
              noteError(`refund ${row.id}: ${refundError.message}`);
              continue;
            }
          }

          const { error } = await supabaseAdmin.rpc("settle_email_otp_order", {
            p_order_id: row.id, p_user_id: row.user_id, p_status: "expired", p_refund_reference: null,
          });
          if (error) { noteError(`settle ${row.id}: ${error.message}`); continue; }
          if (charge > 0) {
            await supabaseAdmin.from("notifications").insert({
              user_id: row.user_id, type: "email_otp", title: "Refund Completed",
              message: `Your ₦${charge} was refunded to your wallet because the email order could not be completed.`,
            });
          }
          stats.expired += 1;
          continue;
        }

        const resp = await fetch(
          `${MAILOTP_BASE}/v1/tasks/${encodeURIComponent(row.mailotp_task_id)}?wait=0`,
          { headers: { Authorization: `Bearer ${MAILOTP_API_KEY}`, Accept: "application/json" } },
        );
        if (!resp.ok) {
          // Transient provider hiccup: leave the row for the next tick rather
          // than guessing a status we have not confirmed.
          console.error(`[email-otp-watcher] Provider check failed for ${row.mailotp_task_id}: ${resp.status}`);
          noteError(`check ${row.mailotp_task_id}: HTTP ${resp.status}`);
          continue;
        }
        const task: any = await resp.json().catch(() => null);
        if (!task || typeof task.id !== "string") {
          noteError(`bad task body ${row.mailotp_task_id}`);
          continue;
        }

        // A code landed after all — record it and leave the order alone.
        const code = task?.result?.code ? String(task.result.code).trim() : "";
        if (code) {
          const { error: recordError } = await supabaseAdmin.rpc("record_email_otp_code", {
            p_order_id: row.id,
            p_user_id: row.user_id,
            p_code: code,
            p_sender: task.result.from ?? null,
            p_subject: task.result.subject ?? null,
            p_provider_received_at: task.result.received_at ?? new Date().toISOString(),
            p_was_free_repeat: Number(task.price) === 0,
          });
          if (recordError) {
            noteError(`record code ${row.id}: ${recordError.message}`);
            continue;
          }
          await supabaseAdmin.from("notifications").insert({
            user_id: row.user_id, type: "email_otp", title: "Email OTP Received",
            message: `A code arrived for your ${row.service} email address.`,
          });
          stats.received += 1;
          continue;
        }

        const pastWindow = Date.now() - new Date(row.created_at).getTime() >= EXPIRY_MS + GRACE_MS;
        const providerTerminal = ["timeout", "cancelled", "failed"].includes(String(task.status ?? ""));

        if (!pastWindow && !providerTerminal) {
          stats.skipped += 1;
          continue;
        }

        // Provider still reports waiting but the window is past: cancel at the
        // provider first so its hold is released. MailOtp rejects cancellations
        // that are too early — then we simply wait for the next tick, and the
        // provider's own auto-release will mark it terminal shortly anyway.
        if (!providerTerminal && String(task.status) === "waiting") {
          const cancelResp = await fetch(
            `${MAILOTP_BASE}/v1/tasks/${encodeURIComponent(row.mailotp_task_id)}/cancel`,
            { method: "POST", headers: { Authorization: `Bearer ${MAILOTP_API_KEY}`, Accept: "application/json" } },
          );
          if (!cancelResp.ok) {
            console.error(`[email-otp-watcher] Provider cancel failed for ${row.mailotp_task_id}: ${cancelResp.status}`);
            noteError(`cancel ${row.mailotp_task_id}: HTTP ${cancelResp.status}`);
            continue;
          }
          const cancelled: any = await cancelResp.json().catch(() => null);
          if (cancelled && String(cancelled.status) === "waiting") {
            // Cancel not accepted yet (too-early window) — retry next tick.
            stats.skipped += 1;
            continue;
          }
        }

        // Provider confirmed terminal (or released the task). Refund before
        // settling: the refund RPC dedups on the reference (a second call with
        // the same reference is a no-op), so if we crash between the two steps
        // the next tick re-runs the refund harmlessly and then settles. Settle
        // flips status only when the row is still 'waiting', which is the
        // atomic claim that stops a browser poll from refunding again.
        const holdReleased = Number(task.price ?? 0) === 0 || providerTerminal;
        const charge = Number(row.charge_naira ?? 0);
        if (!holdReleased) {
          stats.skipped += 1;
          continue;
        }

        if (charge > 0) {
          const { error: refundError } = await supabaseAdmin.rpc("refund_wallet_for_user", {
            p_user_id: row.user_id,
            p_amount: charge,
            p_reference: `mo_refund_${row.id}`,
            p_description: "Refund: email order expired without a code",
          });
          if (refundError) {
            console.error(`[email-otp-watcher] refund failed for ${row.id}:`, refundError.message);
            noteError(`refund ${row.id}: ${refundError.message}`);
            continue;
          }
          await supabaseAdmin.from("notifications").insert({
            user_id: row.user_id, type: "email_otp", title: "Refund Completed",
            message: `Your ₦${charge} was refunded to your wallet — no code arrived for your ${row.service} email order.`,
          });
        }

        const { error: settleError } = await supabaseAdmin.rpc("settle_email_otp_order", {
          p_order_id: row.id,
          p_user_id: row.user_id,
          p_status: "expired",
          p_refund_reference: null,
        });

        if (settleError) {
          console.error(`[email-otp-watcher] settle failed for ${row.id}:`, settleError.message);
          noteError(`settle2 ${row.id}: ${settleError.message}`);
          continue;
        }
        stats.expired += 1;
      } catch (err) {
        console.error(`[email-otp-watcher] Unexpected error for ${row.id}:`, err);
        noteError(`row ${row.id}: ${String(err)}`);
      }
    }

    return jsonResponse(stats);
  } catch (err) {
    console.error("[email-otp-watcher] Loop failure:", err);
    return jsonResponse({ ...stats, error: String(err) }, 500);
  }
});
