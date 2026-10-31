import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// 5sim-order-watcher: scheduled worker that polls 5SIM for `purchased_numbers`
// rows still in `waiting`/`pending` and settles any that have reached a terminal
// non-delivered state (CANCELED / TIMEOUT / BANNED) by calling the atomic
// `settle_failed_number` RPC. RECEIVED rows are marked `received` with their
// SMS code so the dashboard can show them without polling 5SIM itself.
//
// Invoked every minute by pg_cron via the Supabase scheduled-function hook.
// No user session is involved; it runs entirely with the service-role key.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const FIVESIM_API_KEY = Deno.env.get("FIVESIM_API_KEY") ?? "";
const FIVESIM_BASE = "https://5sim.net/v1";

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

// 5SIM expires standard numbers after 5 minutes. Allow a grace period beyond\n// that so transient PENDING statuses have time to resolve before we force-cancel.
const STUCK_AFTER_MS = 10 * 60 * 1000;

type TerminalStatus = "canceled" | "failed";

interface PurchasedRow {
  id: string;
  user_id: string;
  fivesim_id: string | null;
  status: string;
  created_at: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mapTerminalStatus(raw: string): TerminalStatus | null {
  const s = raw.toUpperCase();
  if (s === "CANCELED") return "canceled";
  if (s === "TIMEOUT" || s === "BANNED") return "failed";
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // The function is public-facing on a schedule. A shared secret keeps random
  // browsers from triggering a poll burst. The cron job supplies it as a header.
  if (CRON_SECRET) {
    const provided = req.headers.get("x-cron-secret");
    if (provided !== CRON_SECRET) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const stats = { checked: 0, settled: 0, received: 0, errors: 0, already_terminal: 0 };

  try {
    // Pull a bounded batch of rows that still need a status check. Older first
    // so a stuck row doesn't sit behind newer ones forever. The `fivesim_id` IS
    // NOT NULL filter skips the legacy row that has no provider order id.
    const { data: pending, error: fetchError } = await supabaseAdmin
      .from("purchased_numbers")
      .select("id, user_id, fivesim_id, status, created_at")
      .in("status", ["waiting", "pending"])
      .not("fivesim_id", "is", null)
      .order("created_at", { ascending: true })
      .limit(50);

    if (fetchError) {
      console.error("[5sim-order-watcher] Failed to load pending rows:", fetchError.message);
      return jsonResponse({ ...stats, error: fetchError.message }, 500);
    }

    if (!pending || pending.length === 0) {
      return jsonResponse({ ...stats, message: "No pending orders" });
    }

    for (const row of pending as PurchasedRow[]) {
      stats.checked += 1;
      try {
        const resp = await fetch(`${FIVESIM_BASE}/user/check/${row.fivesim_id}`, {
          headers: { Authorization: `Bearer ${FIVESIM_API_KEY}`, Accept: "application/json" },
        });
        if (!resp.ok) {
          // 5SIM returning a non-2xx for a single order shouldn't abort the loop.
          console.error(`[5sim-order-watcher] 5SIM check failed for ${row.fivesim_id}: ${resp.status}`);
          stats.errors += 1;
          continue;
        }
        const data: any = await resp.json().catch(() => null);
        if (!data) {
          stats.errors += 1;
          continue;
        }

        const rawStatus = String(data.status || "PENDING").toUpperCase();
        let terminal = mapTerminalStatus(rawStatus);

        if (rawStatus === "RECEIVED" && Array.isArray(data.sms) && data.sms.length > 0) {
          const sms = data.sms[0];
          const { error: updErr } = await supabaseAdmin
            .from("purchased_numbers")
            .update({
              status: "received",
              sms_text: sms.text ?? null,
              sms_code: sms.code ?? null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id)
            .in("status", ["waiting", "pending"]);
          if (updErr) {
            console.error(`[5sim-order-watcher] Failed to mark received ${row.id}:`, updErr.message);
            stats.errors += 1;
          } else {
            stats.received += 1;
          }
          continue;
        }

        if (!terminal) {
          const ageMs = Date.now() - new Date(row.created_at).getTime();
          if (rawStatus !== "PENDING" || ageMs < STUCK_AFTER_MS) continue;
          // Still pending long after the window: cancel upstream so we are not
          // charged, and only refund once 5SIM confirms the cancel.
          const cancelResp = await fetch(`${FIVESIM_BASE}/user/cancel/${row.fivesim_id}`, {
            headers: { Authorization: `Bearer ${FIVESIM_API_KEY}`, Accept: "application/json" },
          });
          if (!cancelResp.ok) {
            console.error(`[5sim-order-watcher] Could not cancel stuck order ${row.fivesim_id}: ${cancelResp.status}`);
            stats.errors += 1;
            continue;
          }
          terminal = "canceled";
        }

        const { data: result, error: rpcErr } = await supabaseAdmin.rpc("settle_failed_number", {
          p_purchased_number_id: row.id,
          p_terminal_status: terminal,
          p_failure_reason: rawStatus,
        });

        if (rpcErr) {
          console.error(`[5sim-order-watcher] settle_failed_number errored for ${row.id}:`, rpcErr.message);
          stats.errors += 1;
          continue;
        }

        const r = result as { ok?: boolean; reason?: string; refunded?: number } | null;
        if (r && r.ok === true) {
          stats.settled += 1;
          console.log(`[5sim-order-watcher] Settled ${row.id} -> ${terminal}, refunded ${r.refunded ?? 0}`);
        } else if (r && r.reason === "already_terminal") {
          stats.already_terminal += 1;
        } else {
          console.warn(`[5sim-order-watcher] settle_failed_number declined ${row.id}:`, r);
        }
      } catch (err) {
        console.error(`[5sim-order-watcher] Unexpected error for ${row.id}:`, err);
        stats.errors += 1;
      }
    }

    return jsonResponse(stats);
  } catch (err) {
    console.error("[5sim-order-watcher] Loop failure:", err);
    return jsonResponse({ ...stats, error: String(err) }, 500);
  }
});
