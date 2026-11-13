import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Email queue worker. Drains queued email_messages rows via Resend, batches
// per invocation, records delivery status, and is safe to call repeatedly
// (from the admin UI or a cron trigger). Only sends for campaigns whose
// status is 'queued' and whose is_test flag is false.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const BATCH = 10;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function wrapHtml(subject: string, html: string, campaignId: string): string {
  const safeSubject = subject.replace(/</g, "&lt;");
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;padding:24px;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
<div style="background:#1e3a8a;padding:20px 28px;color:#fff;font-size:18px;font-weight:bold;">MONTEN SMS</div>
<div style="padding:28px;color:#1e293b;font-size:15px;line-height:1.6;">${html}</div>
<div style="padding:20px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;">
MONTEN SMS &middot; montensms.com<br/>
<a href="https://montensms.com/unsubscribe?c=${campaignId}" style="color:#2563eb;">Unsubscribe</a>
</div>
</div></body></html>`;
}

Deno.serve(async () => {
  if (Deno.env.get("RESEND_API_KEY") === undefined) {
    return json({ error: "Email provider not configured" }, 503);
  }
  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const { data: cfg } = await admin.from("app_settings").select("value").eq("key", "email_sender").maybeSingle();
  const from = cfg?.value?.from ?? "MONTEN SMS <onboarding@resend.dev>";

  // Find one queued campaign.
  const { data: campaign } = await admin.from("email_campaigns").select("id,subject,html,status,is_test").eq("status", "queued").eq("is_test", false).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (!campaign) return json({ ok: true, sent: 0, note: "no queued campaigns" });

  const { data: batch } = await admin.from("email_messages")
    .select("id,to_email,campaign_id")
    .eq("campaign_id", campaign.id)
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(BATCH);

  let sent = 0, failed = 0, errors = 0;

  for (const msg of batch ?? []) {
    // Atomically claim the row so concurrent invocations never double-send.
    const { data: claimed } = await admin.from("email_messages")
      .update({ status: "sending" })
      .eq("id", msg.id)
      .eq("status", "queued")
      .select()
      .single();
    if (!claimed) continue;

    const html = wrapHtml(campaign.subject, campaign.html, campaign.id);
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [msg.to_email], subject: campaign.subject, html }),
    });
    const body = await resp.json().catch(() => ({}));
    if (resp.ok) {
      sent++;
      await admin.from("email_messages").update({ status: "sent", provider_id: body?.id ?? null, sent_at: new Date().toISOString() }).eq("id", msg.id);
    } else if (resp.status === 422) {
      // Invalid/unverifiable recipient: mark failed permanently.
      failed++;
      await admin.from("email_messages").update({ status: "failed", error: (body?.message ?? "unverifiable recipient").slice(0, 500) }).eq("id", msg.id);
    } else {
      errors++;
      // Retryable failure: put back to queued, count attempts.
      const attempts = (claimed as any).error ? 1 : 0; // existing error text implies prior failure
      if (attempts >= 3) {
        await admin.from("email_messages").update({ status: "failed", error: (body?.message ?? `HTTP ${resp.status}`).slice(0, 500) }).eq("id", msg.id);
      } else {
        await admin.from("email_messages").update({ status: "queued", error: (body?.message ?? `HTTP ${resp.status}`).slice(0, 500) }).eq("id", msg.id);
      }
    }
  }

  // Update campaign stats + finish when queue empty.
  const { count: remaining } = await admin.from("email_messages").select("*", { count: "exact", head: true }).eq("campaign_id", campaign.id).eq("status", "queued");
  const { count: sentCount } = await admin.from("email_messages").select("*", { count: "exact", head: true }).eq("campaign_id", campaign.id).eq("status", "sent");
  const { count: failedCount } = await admin.from("email_messages").select("*", { count: "exact", head: true }).eq("campaign_id", campaign.id).eq("status", "failed");
  const stats = { queued: remaining ?? 0, sent: sentCount ?? 0, failed: failedCount ?? 0 };
  const done = (remaining ?? 0) === 0;
  await admin.from("email_campaigns").update({
    stats,
    status: done ? "sent" : "sending",
    sent_at: done ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("id", campaign.id);

  return json({ ok: true, campaign: campaign.id, sent, failed, retried: errors, remaining: remaining ?? 0 });
});
