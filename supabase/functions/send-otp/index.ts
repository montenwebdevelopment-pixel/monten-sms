import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const FROM_ADDRESS = "MONTEN SMS <support@montensms.com>";
const SITE_URL = "https://montensms.com";
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 3;
const MAX_VERIFY_ATTEMPTS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[A-Za-z0-9._-]{3,24}$/;

const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);

class EmailSendError extends Error {}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function fail(status: number, message: string, code?: string) {
  return json({ error: message, ...(code ? { code } : {}) }, status);
}

function generateCode(): string {
  const buf = new Uint32Array(1);
  let n: number;
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= 4294000000);
  return (n % 1000000).toString().padStart(6, "0");
}

async function hashCode(email: string, code: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(serviceKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${email}:${code}`));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function emailShell(title: string, intro: string, body: string, footer: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f172a;">
<tr><td align="center" style="padding:40px 20px;">
<table width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:16px;overflow:hidden;max-width:480px;width:100%;">
<tr><td style="background-color:#0f172a;padding:24px 32px;text-align:center;">
<h1 style="color:#ffffff;font-size:20px;font-weight:700;margin:0;letter-spacing:0.5px;">MONTEN SMS</h1>
</td></tr>
<tr><td style="padding:32px 40px 8px 40px;">
<h2 style="color:#0f172a;font-size:22px;font-weight:700;margin:0 0 8px 0;">${title}</h2>
<p style="color:#64748b;font-size:15px;line-height:1.6;margin:0 0 24px 0;">${intro}</p>
</td></tr>
<tr><td align="center" style="padding:8px 40px 24px 40px;">${body}</td></tr>
<tr><td style="padding:0 40px 32px 40px;">
<p style="color:#64748b;font-size:14px;line-height:1.6;margin:0;">${footer}</p>
</td></tr>
<tr><td style="background-color:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;">
<p style="color:#94a3b8;font-size:12px;margin:0;text-align:center;">&copy; ${new Date().getFullYear()} MONTEN SMS &middot; support@montensms.com</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "[invalid]";
  const masked = local.length <= 2 ? local[0] + "***" : local[0] + "***" + local.slice(-1);
  return `${masked}@${domain}`;
}

async function sendEmail(to: string, subject: string, html: string, text: string, action: string): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.error(`[send-otp] action=${action} RESEND_API_KEY is not configured`);
    throw new EmailSendError("Email service is not configured.");
  }
  console.log(`[send-otp] action=${action} from=${FROM_ADDRESS} to=${maskEmail(to)} subject="${subject}" — sending to Resend`);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_ADDRESS, to: [to], subject, html, text }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    console.error(`[send-otp] action=${action} to=${maskEmail(to)} Resend REJECTED status=${res.status} name=${errBody?.name ?? ""} message=${errBody?.message ?? ""}`);
    throw new EmailSendError("Email provider rejected the message.");
  }
  const body = await res.json().catch(() => ({}));
  console.log(`[send-otp] action=${action} to=${maskEmail(to)} Resend ACCEPTED id=${body?.id ?? "unknown"} subject="${subject}"`);
}

async function findUserId(email: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_user_id_by_email_service", { p_email: email });
  if (error) throw error;
  return (data as string | null) ?? null;
}

async function issueCode(email: string): Promise<"sent" | "rate_limited"> {
  const since = new Date(Date.now() - CODE_TTL_MS).toISOString();
  const { count, error: countError } = await supabase
    .from("email_otps")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .gte("created_at", since);
  if (countError) throw countError;
  if ((count ?? 0) >= MAX_SENDS_PER_WINDOW) return "rate_limited";

  const code = generateCode();
  const { error: retireError } = await supabase.from("email_otps").update({ verified: true }).eq("email", email).eq("verified", false);
  if (retireError) throw retireError;
  const { error: insertError } = await supabase.from("email_otps").insert({
    email,
    code: await hashCode(email, code),
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });
  if (insertError) throw insertError;

  const html = emailShell(
    "Verify your email",
    "Use the 6-digit code below to finish creating your MONTEN SMS account. This code expires in 10 minutes.",
    `<div style="background-color:#f1f5f9;border:1px solid #e2e8f0;border-radius:12px;padding:24px 40px;display:inline-block;">
<span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#0f172a;font-family:'Courier New',monospace;">${code}</span></div>`,
    "If you didn't create a MONTEN SMS account, you can safely ignore this email.",
  );
  const text = `Your MONTEN SMS verification code is ${code}. It expires in 10 minutes. If you didn't create an account, ignore this email.`;
  await sendEmail(email, "Your MONTEN SMS verification code", html, text, "register");
  return "sent";
}

async function handleRegister(body: Record<string, unknown>) {
  const fullName = String(body.fullName ?? "").trim();
  const username = String(body.username ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!fullName || fullName.length > 100) return fail(400, "Please enter your full name.");
  if (!USERNAME_RE.test(username)) return fail(400, "Username must be 3-24 characters: letters, numbers, dots, dashes or underscores.");
  if (!EMAIL_RE.test(email)) return fail(400, "Please enter a valid email address.");
  if (password.length < 6 || password.length > 72) return fail(400, "Password must be between 6 and 72 characters.");
  if (body.consentAccepted !== true) return fail(400, "Please read and accept the Privacy Policy and Terms & Conditions to continue.", "consent_required");

  const existingId = await findUserId(email);
  if (existingId) {
    const { data } = await supabase.auth.admin.getUserById(existingId);
    if (data?.user && !data.user.email_confirmed_at) {
      return fail(409, "This email is registered but not verified yet. Verify it to continue.", "unverified");
    }
    return fail(409, "An account with this email already exists. Please sign in instead.", "exists");
  }

  const escaped = username.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data: taken, error: takenError } = await supabase.from("profiles").select("id").ilike("username", escaped).limit(1);
  if (takenError) throw takenError;
  if (taken && taken.length > 0) return fail(409, "That username is already taken.", "username_taken");

  const first = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
    user_metadata: { full_name: fullName, username },
  });
  if (first.error) {
    const msg = first.error.message.toLowerCase();
    console.error(`[send-otp] createUser failed for ${maskEmail(email)}: ${first.error.message} (code=${first.error.code ?? "?"})`);
    if (msg.includes("already")) return fail(409, "An account with this email already exists. Please sign in instead.", "exists");
    if (msg.includes("password")) return fail(400, "That password appears in public breach lists, so it isn't allowed while leak protection is enabled. Please pick a less common password.", "weak_password");
    return fail(500, "We couldn't create your account. Please try again.");
  }

  try {
    const userId = first.data.user.id;
    await supabase.from("consent_records").insert({ user_id: userId, email, user_agent: String(body.userAgent ?? "").slice(0, 300) });
  } catch (consentErr) {
    console.error("[send-otp] Consent record failed (account still created):", consentErr instanceof Error ? consentErr.message : consentErr);
  }

  try {
    await issueCode(email);
  } catch (err) {
    if (err instanceof EmailSendError) {
      return fail(502, "Your account was created, but we couldn't send the verification code. Please tap Resend on the next screen.", "send_failed");
    }
    throw err;
  }
  return json({ success: true });
}

async function handleSend(email: string) {
  const userId = await findUserId(email);
  if (!userId) return fail(404, "No account found with that email. Please register first.");
  const { data } = await supabase.auth.admin.getUserById(userId);
  if (data?.user?.email_confirmed_at) return fail(409, "This email is already verified. Please sign in.", "already_verified");
  try {
    const result = await issueCode(email);
    if (result === "rate_limited") return fail(429, "Too many code requests. Please wait 10 minutes before asking for another.");
  } catch (err) {
    if (err instanceof EmailSendError) return fail(502, "We couldn't send the code right now. Please try again shortly.");
    throw err;
  }
  return json({ success: true });
}

async function handleVerify(email: string, code: unknown) {
  if (!/^\d{6}$/.test(String(code ?? ""))) return fail(400, "Please enter the 6-digit code.");
  const userId = await findUserId(email);
  if (!userId) return fail(400, "No valid code found. Please request a new one.");

  const { data: record, error } = await supabase
    .from("email_otps")
    .select("id, code, expires_at, attempts")
    .eq("email", email)
    .eq("verified", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!record) return fail(400, "No valid code found. Please request a new one.");
  if (new Date(record.expires_at) < new Date()) return fail(400, "Code expired. Please request a new one.");

  const attempts = Number(record.attempts) + 1;
  if (attempts > MAX_VERIFY_ATTEMPTS) {
    await supabase.from("email_otps").update({ verified: true }).eq("id", record.id);
    return fail(400, "Too many failed attempts. Please request a new code.");
  }
  if (record.code !== (await hashCode(email, String(code)))) {
    await supabase.from("email_otps").update({ attempts }).eq("id", record.id);
    const left = MAX_VERIFY_ATTEMPTS - attempts;
    return fail(400, left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many failed attempts. Please request a new code.");
  }

  await supabase.from("email_otps").update({ verified: true }).eq("id", record.id);
  const { error: confirmError } = await supabase.auth.admin.updateUserById(userId, { email_confirm: true });
  if (confirmError) {
    console.error("[send-otp] Confirming email failed:", confirmError.message);
    return fail(500, "We couldn't complete verification. Please try again.");
  }
  await supabase.from("profiles").update({ email_verified: true }).eq("id", userId);
  return json({ success: true });
}

async function handleReset(email: string) {
  const userId = await findUserId(email);
  if (!userId) return json({ success: true });

  const since = new Date(Date.now() - CODE_TTL_MS).toISOString();
  const { count } = await supabase
    .from("rate_limits")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("endpoint", "password_reset")
    .gte("created_at", since);
  if ((count ?? 0) >= MAX_SENDS_PER_WINDOW) return json({ success: true });
  await supabase.from("rate_limits").insert({ user_id: userId, endpoint: "password_reset" });

  const { data, error } = await supabase.auth.admin.generateLink({ type: "recovery", email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    console.error("[send-otp] Generating reset link failed:", error?.message ?? "no token");
    return fail(500, "We couldn't send the reset email right now. Please try again shortly.");
  }
  const link = `${SITE_URL}/update-password?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;
  const safeLink = escapeHtml(link);

  const html = emailShell(
    "Reset your password",
    "We received a request to reset your MONTEN SMS password. Click the button below to choose a new one. This link can only be used once.",
    `<a href="${safeLink}" style="display:inline-block;background-color:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 32px;border-radius:10px;">Reset password</a>
<p style="color:#94a3b8;font-size:12px;line-height:1.6;margin:16px 0 0 0;word-break:break-all;">Or paste this link into your browser:<br>${safeLink}</p>`,
    "If you didn't ask to reset your password, you can ignore this email. Your password won't change.",
  );
  const text = `Reset your MONTEN SMS password: ${link}\n\nIf you didn't ask for this, ignore this email.`;
  try {
    await sendEmail(email, "Reset your MONTEN SMS password", html, text, "reset");
  } catch (err) {
    if (err instanceof EmailSendError) return fail(502, "We couldn't send the reset email right now. Please try again shortly.");
    throw err;
  }
  return json({ success: true });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return fail(405, "Method not allowed");

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return fail(400, "Invalid request.");
    const action = body.action;

    if (action === "register") return await handleRegister(body);

    const email = String(body.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return fail(400, "Please enter a valid email address.");

    if (action === "send") return await handleSend(email);
    if (action === "verify") return await handleVerify(email, body.code);
    if (action === "reset") return await handleReset(email);
    return fail(400, "Invalid action.");
  } catch (err) {
    console.error(`[send-otp] Unhandled error action=${String(body?.action ?? "?")}:`, err instanceof Error ? err.message : "unknown");
    return fail(500, "Something went wrong. Please try again shortly.");
  }
});
