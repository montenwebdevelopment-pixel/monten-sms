import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Webhook dispatcher. Sends pending developer_webhook_deliveries rows to the
// developer's registered URL, signed with HMAC-SHA256 (X-Monten-Signature).
// Retry schedule: 1min, 5min, 30min, then permanent failure. Safe to invoke
// repeatedly (cron or manual); each delivery row is claimed atomically.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const BATCH = 20;
const BACKOFF_MIN = [1, 5, 30];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async () => {
  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  try {
    const { data: batch } = await admin.from("developer_webhook_deliveries")
      .select("id,webhook_id,user_id,event,payload,attempts")
      .eq("status", "pending")
      .or(`next_retry_at.is.null,next_retry_at.lte.${new Date().toISOString()}`)
      .order("created_at", { ascending: true })
      .limit(BATCH);

    let delivered = 0, failed = 0, scheduled = 0;

    for (const d of batch ?? []) {
      const { data: claimed } = await admin.from("developer_webhook_deliveries")
        .update({ status: "pending", attempts: d.attempts + 1 })
        .eq("id", d.id)
        .eq("status", "pending")
        .eq("attempts", d.attempts)
        .select()
        .single();
      if (!claimed) continue;

      const { data: hook } = await admin.from("developer_webhooks").select("url,secret,active").eq("id", d.webhook_id).maybeSingle();
      if (!hook || !hook.active) {
        await admin.from("developer_webhook_deliveries").update({ status: "failed", last_error: "webhook removed or disabled" }).eq("id", d.id);
        failed++;
        continue;
      }

      const body = JSON.stringify({ event: d.event, data: d.payload, delivered_at: new Date().toISOString() });
      const signature = await hmacHex(hook.secret, body);
      try {
        const resp = await fetch(hook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Monten-Signature": `sha256=${signature}`,
            "X-Monten-Event": d.event,
          },
          body,
        });
        await admin.from("developer_webhook_deliveries").update({
          response_status: resp.status,
          status: resp.ok ? "delivered" : "pending",
          delivered_at: resp.ok ? new Date().toISOString() : null,
          last_error: resp.ok ? null : `HTTP ${resp.status}`,
          next_retry_at: resp.ok ? null : new Date(Date.now() + (BACKOFF_MIN[Math.min(d.attempts, BACKOFF_MIN.length - 1)] * 60_000)).toISOString(),
        }).eq("id", d.id);
        if (resp.ok) delivered++; else scheduled++;
      } catch (e) {
        const giveUp = d.attempts >= BACKOFF_MIN.length + 1;
        await admin.from("developer_webhook_deliveries").update({
          status: giveUp ? "failed" : "pending",
          last_error: (e instanceof Error ? e.message : "network error").slice(0, 300),
          next_retry_at: giveUp ? null : new Date(Date.now() + (BACKOFF_MIN[Math.min(d.attempts, BACKOFF_MIN.length - 1)] * 60_000)).toISOString(),
        }).eq("id", d.id);
        if (giveUp) failed++; else scheduled++;
      }
    }

    return json({ ok: true, delivered, scheduled_for_retry: scheduled, failed });
  } catch (err) {
    console.error("[webhook-dispatcher]", err instanceof Error ? err.message : err);
    return json({ error: "internal" }, 500);
  }
});
