import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  ambiguousOtpOrdersReply,
  aiUnavailableReply,
  buyNumberReply,
  buildModelTurns,
  complaintOpening,
  customerNameReply,
  extractTransactionId,
  identityReply,
  missingDepositReply,
  missingOtpOrderReply,
  otpOrderReply,
  orderLookupReply,
  pricingReply,
  resolveSupportIntent,
  servicesReply,
} from "./assistant-logic.mjs";
import { redactSensitiveText } from "../_shared/sensitive-text.mjs";
// MONTEN SMS support agent — intent router with account tools + human escalation.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(status: number, message: string, code?: string) {
  return json({ error: message, ...(code ? { code } : {}) }, status);
}

const MAX_SAVED_LENGTH = 40;

function fmtNGN(n: number | null | undefined): string {
  if (n === null || n === undefined) return "NGN 0";
  return "NGN " + Number(n).toLocaleString("en-NG", { maximumFractionDigits: 2 });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "N/A";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "N/A";
  return d.toLocaleDateString("en-NG", { year: "numeric", month: "short", day: "numeric" });
}

function relTime(iso: string | null | undefined): string {
  if (!iso) return "recently";
  const d = new Date(iso).getTime();
  if (isNaN(d)) return "recently";
  const mins = Math.round((Date.now() - d) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

interface Turn {
  role: "user" | "assistant";
  text: string;
}

interface AgentResult {
  reply: string;
  kind?: "text" | "fallback" | "ticket_created" | "contact-human";
  ticket?: { case_ref: string; subject: string; status: string; priority: string };
  actions_taken?: string[];
}

// ---- Persistent conversation memory ----

async function getOrCreateConversation(admin: ReturnType<typeof createClient>, userId: string): Promise<string> {
  const { data, error: lookupError } = await admin
    .from("support_conversations")
    .select("id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (data?.id) return data.id as string;
  const { data: created, error } = await admin
    .from("support_conversations")
    .insert({ user_id: userId })
    .select("id")
    .single();
  if (error || !created) throw error ?? new Error("conversation create failed");
  return created.id as string;
}

async function loadStoredHistory(admin: ReturnType<typeof createClient>, conversationId: string): Promise<Turn[] | null> {
  const { data, error } = await admin
    .from("support_messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(24);
  if (error) {
    console.error("[support-agent] history query failed", error.code ?? "unknown");
    return null;
  }
  return (data ?? [])
    .map((m: any) => ({ ...m, role: m.role === "assistant" ? "assistant" : "user" as const }))
    .sort((a: any, b: any) => {
      const byTime = String(a.created_at).localeCompare(String(b.created_at));
      if (byTime) return byTime;
      return a.role === b.role ? 0 : a.role === "user" ? -1 : 1;
    })
    .map((m: any) => ({ role: m.role, text: redactSensitiveText(String(m.content ?? "").slice(0, 500)) }));
}

async function persistMessages(
  admin: ReturnType<typeof createClient>,
  conversationId: string,
  userId: string,
  userMsg: string,
  result: AgentResult,
) {
  const rows = [
    { conversation_id: conversationId, user_id: userId, role: "user", content: redactSensitiveText(userMsg).slice(0, 1000) },
    { conversation_id: conversationId, user_id: userId, role: "assistant", content: redactSensitiveText(result.reply).slice(0, 2000), meta: { kind: result.kind ?? "text", ...(result.ticket ? { ticket: result.ticket } : {}) } },
  ];
  try {
    const { error } = await admin.from("support_messages").insert(rows);
    if (error) throw error;
    const { error: updateError } = await admin.from("support_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
    if (updateError) throw updateError;
  } catch (err) {
    console.error("[support-agent] memory persist failed", err instanceof Error ? err.name : "unknown");
  }
}

// ---- Account tools ----

async function getAccountSummary(admin: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await admin
    .from("profiles")
    .select("full_name, username, wallet_balance, email_verified, created_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function getDeposits(admin: ReturnType<typeof createClient>, userId: string) {
  const [txRes, pendRes, webRes] = await Promise.all([
    admin.from("transactions").select("amount, status, reference, created_at").eq("user_id", userId).eq("type", "deposit").order("created_at", { ascending: false }).limit(10),
    admin.from("pending_deposits").select("transaction_id, amount, tx_ref, status, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(10),
    admin.from("webhook_deposits").select("tx_ref, amount, status, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(10),
  ]);
  if (txRes.error) throw txRes.error;
  if (pendRes.error) throw pendRes.error;
  if (webRes.error) throw webRes.error;
  return { wallet: txRes.data ?? [], pending: pendRes.data ?? [], webhook: webRes.data ?? [] };
}

async function getTransactions(admin: ReturnType<typeof createClient>, userId: string, limit = 20) {
  const { data, error } = await admin
    .from("transactions")
    .select("type, amount, status, reference, description, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

async function getNumberOrders(admin: ReturnType<typeof createClient>, userId: string, limit = 20) {
  const { data, error } = await admin
    .from("purchased_numbers")
    .select("id, fivesim_id, phone_number, country_name, service_name, selling_price, status, sms_code, failure_reason, expires_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

async function getEmailOrders(admin: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await admin
    .from("email_otp_orders")
    .select("id, mailotp_task_id, service, site, email_address, charge_naira, status, expires_at, last_code_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  return data ?? [];
}

async function getNotifications(admin: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await admin
    .from("notifications")
    .select("title, message, type, read, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  return data ?? [];
}

async function getSupportTickets(admin: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await admin
    .from("support_tickets")
    .select("case_ref, subject, status, priority, category, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) throw error;
  return data ?? [];
}

async function verifyFlwPayment(admin: ReturnType<typeof createClient>, userId: string, userEmail: string, txId: string): Promise<Record<string, unknown>> {
  const flwKey = Deno.env.get("FLWSECK") ?? "";
  if (!/^\d+$/.test(txId)) return { verified: false, reason: "invalid_id" };
  if (!flwKey) return { verified: false, reason: "not_configured" };
  const resp = await fetch(`https://api.flutterwave.com/v3/transactions/${txId}/verify`, {
    headers: { Authorization: `Bearer ${flwKey}`, "Content-Type": "application/json" },
  });
  if (!resp.ok) return { verified: false, reason: "verify_failed" };
  const body: any = await resp.json();
  if (body.status !== "success" || body.data?.status !== "successful") {
    return { verified: false, reason: "not_successful", flw_status: body.data?.status ?? "unknown" };
  }
  const txRef = String(body.data?.tx_ref || "");
  if (!txRef) return { verified: false, reason: "not_owned" };
  const payerEmail = String(body.data?.customer?.email ?? "").trim().toLowerCase();
  const emailMatches = Boolean(userEmail && payerEmail && userEmail.trim().toLowerCase() === payerEmail);

  const ownershipChecks = await Promise.all([
    admin.from("pending_deposits").select("transaction_id").eq("user_id", userId).eq("transaction_id", txId).maybeSingle(),
    admin.from("pending_deposits").select("tx_ref").eq("user_id", userId).eq("tx_ref", txRef).maybeSingle(),
    admin.from("webhook_deposits").select("flw_transaction_id").eq("user_id", userId).eq("flw_transaction_id", txId).maybeSingle(),
    admin.from("webhook_deposits").select("tx_ref").eq("user_id", userId).eq("tx_ref", txRef).maybeSingle(),
    admin.from("transactions").select("reference").eq("user_id", userId).eq("type", "deposit").eq("reference", txRef).maybeSingle(),
  ]);
  const ownershipError = ownershipChecks.find((check) => check.error)?.error;
  const hasOwnedRecord = ownershipChecks.some((check) => check.data);
  if (!hasOwnedRecord && ownershipError && !emailMatches) {
    console.error("[support-agent] payment ownership lookup failed", ownershipError.code ?? "unknown");
    return { verified: false, reason: "ownership_check_failed" };
  }
  if (!hasOwnedRecord && !emailMatches) return { verified: false, reason: "not_owned" };

  return { verified: true, tx_ref: txRef, amount: Number(body.data.amount), currency: body.data.currency, status: body.data.status };
}

// ---- Intent classification ----

function classify(msg: string, history: Turn[]): "casual" | "support" {
  const m = msg.toLowerCase().trim();
  const casual =
    /^(hi|hello|hey|good (morning|afternoon|evening|day)|greetings|howdy)\b/i.test(m) ||
    /how are you|how's it going|how do you do|what's up/i.test(m) ||
    /^(thank you|thanks|thx|appreciate|grateful|that's great|thats great|great|nice|cool|awesome|okay|ok|alright|got it|makes sense|understood|i see|sounds good)\b/i.test(m) ||
    /^(i'm fine|i am fine|im fine|i'm good|i am good|im good|i'm okay|doing fine|doing well|doing good|i'm great|im great|feeling good)\b/i.test(m) ||
    /^(can we talk|let's talk|lets talk|i want to talk|i just want to talk|someone to talk to|i just want someone to talk to|just want to chat|let's chat|lets chat)\b/i.test(m) ||
    /^(i have something to tell you|can i tell you|let me tell you|i want to tell you)\b/i.test(m) ||
    /^(i don't understand|i dont understand|i'm confused|im confused|i'm lost|im lost|i don't get it|i dont get it|what do you mean)\b/i.test(m) ||
    /^(i'm frustrated|im frustrated|i'm angry|im angry|i'm upset|im upset|i'm stressed|im stressed|this is annoying|so annoying|i'm tired|im tired|i'm exhausted)\b/i.test(m) ||
    /^(bye|goodbye|see you|talk later|catch you later|have a good day|have a nice day)\b/i.test(m) ||
    /^(what are you doing|what are you up to|who are you|what are you|what can you do|what do you do|are you a bot|are you real|are you human|are you ai)\b/i.test(m) ||
    /^(i'm bored|im bored|i'm happy|im happy|i'm sad|im sad|i feel|today is|today was)\b/i.test(m) ||
    /^(good job|well done|you're amazing|your amazing|you're great|your great|you're helpful|your helpful|love you|you're the best|your the best)\b/i.test(m) ||
    /^(sorry|my bad|apolog)/i.test(m) ||
    (m.length < 12 && !/\d/.test(m) && !/(deposit|wallet|balance|number|otp|payment|refund|login|password|account|fund|buy|order|verify|email|register|sign|transaction|statement|history|spending|spent|profile|username|notification|ticket|case|pricing|cost|price|charge|fee|safe|secure|privacy|trust|legit|scam)/i.test(m));

  if (casual) {
    const lastBot = [...history].reverse().find((h) => h.role === "assistant");
    if (lastBot && /deposit|wallet|balance|transaction|payment|number|otp|ticket|case|escalat|statement|spending|profile|notification/i.test(lastBot.text) && /^(ok|okay|alright|got it|thanks|thank you|yes|no|yeah|nope|sure)\b/i.test(m)) {
      return "support";
    }
    return "casual";
  }
  return "support";
}

// ---- Casual replies ----

function casualReply(msg: string, history: Turn[], firstName: string): AgentResult {
  const m = msg.toLowerCase().trim();

  if (/^(hi|hello|hey|howdy|greetings)\b/i.test(m)) {
    const greeted = history.some((h) => h.role === "user" && /^(hi|hello|hey|howdy|greetings)\b/i.test(h.text));
    if (greeted) return { reply: "Hi again! What's on your mind? I'm happy to help or just chat.", actions_taken: [] };
    return {
      reply: `${firstName ? "Hello " + firstName + "!" : "Hello!"} Welcome to MONTEN SMS. How are you doing today? I'm here if you need help with anything, or if you'd just like to chat.`,
      actions_taken: [],
    };
  }

  const timeGreet = m.match(/good (morning|afternoon|evening|day)/);
  if (timeGreet) {
    const cap = timeGreet[1].charAt(0).toUpperCase() + timeGreet[1].slice(1);
    return { reply: `${cap} to you too! How are you doing? I'm here if you need anything.`, actions_taken: [] };
  }

  if (/how are you|how's it going|how do you do|how you doing/i.test(m)) {
    return { reply: "I'm doing well, thank you for asking! I'm always here and ready to help. How are things going with you?", actions_taken: [] };
  }

  if (/i'm fine|i am fine|im fine|i'm good|i am good|im good|i'm okay|doing fine|doing well|doing good|i'm great|im great|feeling good/i.test(m)) {
    const askedHow = history.some((h) => h.role === "assistant" && /how are you|how are things|what.*on your mind/i.test(h.text));
    if (askedHow) return { reply: "Glad to hear you're doing well! What would you like to talk about? I can help with your account, or we can just chat.", actions_taken: [] };
    return { reply: "That's good to hear! Is there anything I can help you with today?", actions_taken: [] };
  }

  if (/^(thank you|thanks|thx|appreciate|grateful)\b/i.test(m)) {
    return { reply: "You're very welcome! Let me know if there's anything else I can help you with.", actions_taken: [] };
  }

  if (/^(that's great|thats great|great|nice|cool|awesome)\b/i.test(m)) {
    return { reply: "Glad you think so! Is there anything else you'd like to talk about?", actions_taken: [] };
  }

  if (/^(good job|well done|you're amazing|your amazing|you're great|your great|you're helpful|your helpful|love you|you're the best|your the best)\b/i.test(m)) {
    return { reply: "Thank you, that's very kind! I'm always here if you need me. Is there anything I can help with?", actions_taken: [] };
  }

  if (/^(sorry|my bad|apolog)/i.test(m)) {
    return { reply: "No need to apologize at all! We're all good. What can I help you with?", actions_taken: [] };
  }

  if (/can we talk|let's talk|lets talk|i want to talk|i just want to talk|someone to talk to|i just want someone to talk to|just want to chat|let's chat|lets chat/i.test(m)) {
    return { reply: "Of course! I'm here to chat. What's on your mind? You can talk to me about anything - whether it's about MONTEN SMS or just a casual conversation.", actions_taken: [] };
  }

  if (/i have something to tell you|can i tell you|let me tell you|i want to tell you/i.test(m)) {
    return { reply: "Sure, go ahead - I'm listening.", actions_taken: [] };
  }

  if (/i don't understand|i dont understand|i'm confused|im confused|i'm lost|im lost|i don't get it|i dont get it|what do you mean/i.test(m)) {
    return { reply: "No worries at all! Let me explain it more simply. What part was confusing? I'm happy to break it down.", actions_taken: [] };
  }

  if (/i'm frustrated|im frustrated|i'm angry|im angry|i'm upset|im upset|i'm stressed|im stressed|this is annoying|so annoying|i'm tired|im tired|i'm exhausted/i.test(m)) {
    return { reply: "I'm sorry you're feeling that way. That sounds frustrating, and I completely understand. Take a breath - I'm here to help make things easier. Would you like to tell me what's going on? I'll do my best to sort it out with you.", actions_taken: [] };
  }

  if (/i'm bored|im bored/i.test(m)) return { reply: "Sometimes that happens! Want to chat about something, or is there anything I can help you with on MONTEN SMS?", actions_taken: [] };
  if (/i'm happy|im happy/i.test(m)) return { reply: "That's wonderful to hear! I love hearing that. Anything you'd like to talk about?", actions_taken: [] };
  if (/i'm sad|im sad/i.test(m)) return { reply: "I'm sorry to hear that. I'm here if you'd like to talk about it, or if there's anything I can help with.", actions_taken: [] };

  if (/what are you doing|what are you up to/i.test(m)) return { reply: "I'm right here, ready to help you or just chat! What can I do for you?", actions_taken: [] };
  if (/who are you|what are you|are you a bot|are you real|are you human|are you ai/i.test(m)) {
    return { reply: "I'm the MONTEN SMS support assistant - an AI here to help you with your account and answer questions, or just have a friendly chat. I'm not a human, but I'm always happy to help. What would you like to talk about?", actions_taken: [] };
  }
  if (/what can you do|what do you do/i.test(m)) {
    return { reply: "I can help you with:\n- Checking your wallet balance and account details\n- Viewing your transaction history and spending summary\n- Looking into deposits and missing payments\n- Number orders, OTP issues, and SMS codes\n- Checking your notifications\n- Reviewing your support tickets\n- Refund and payment questions\n- Pricing and how MONTEN SMS works\n- Escalating to our human support team\n\nOr we can just chat! What would you like to do?", actions_taken: [] };
  }

  if (/^(bye|goodbye|see you|talk later|catch you later|have a good day|have a nice day)\b/i.test(m)) {
    return { reply: "Goodbye! Take care, and feel free to come back anytime. I'll be right here.", actions_taken: [] };
  }

  if (/^(ok|okay|alright|got it|makes sense|understood|i see|sounds good|sure)\b/i.test(m)) {
    return { reply: "Great! Is there anything else I can help you with?", actions_taken: [] };
  }

  return { reply: "I'm here and listening. Tell me more - what's on your mind? I can help with your account, transactions, numbers, payments, or just chat.", actions_taken: [] };
}

function extractAmount(msg: string): number | null {
  const m = msg.toLowerCase();
  const naira = m.match(/(?:naira|ngn)\s?([0-9][0-9,]*(?:\.[0-9]+)?)/);
  if (naira) return Number(naira[1].replace(/,/g, ""));
  const sym = m.match(/\u20a6\s?([0-9][0-9,]*(?:\.[0-9]+)?)/);
  if (sym) return Number(sym[1].replace(/,/g, ""));
  const k = m.match(/\b([0-9]+)k\b/);
  if (k) return Number(k[1]) * 1000;
  const plain = m.match(/(?:deposited|paid|sent|transfer(?:red)?)\s?(?:of)?\s?([0-9][0-9,]*(?:\.[0-9]+)?)/);
  if (plain) return Number(plain[1].replace(/,/g, ""));
  return null;
}

function extractOrderReference(msg: string): string | null {
  const uuid = msg.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i);
  if (uuid) return uuid[0];
  const phone = msg.match(/\+?\d[\d\s()-]{6,}\d/);
  return phone?.[0].trim() ?? null;
}

function findNumberOrder(orders: any[], message: string, reference: string | null) {
  const normalizedMessage = message.toLowerCase();
  const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
  if (reference) {
    const refDigits = digits(reference);
    return orders.find((order: any) =>
      String(order.id ?? "").toLowerCase().startsWith(reference.toLowerCase()) ||
      String(order.fivesim_id ?? "") === reference ||
      (refDigits.length >= 8 && digits(order.phone_number) === refDigits)
    ) ?? null;
  }

  const contextual = orders.filter((order: any) => {
    const service = String(order.service_name ?? "").toLowerCase();
    const country = String(order.country_name ?? "").toLowerCase();
    return (service.length > 2 && normalizedMessage.includes(service)) ||
      (country.length > 2 && normalizedMessage.includes(country));
  });
  return contextual.length === 1 ? contextual[0] : null;
}

async function handleSupport(msg: string, history: Turn[], admin: ReturnType<typeof createClient>, authedClient: ReturnType<typeof createClient>, userId: string): Promise<AgentResult> {
  const intent = resolveSupportIntent(msg, history);

  switch (intent) {
    case "identity":
      return { reply: identityReply(), actions_taken: [] };
    case "customer_name": {
      const s = await getAccountSummary(admin, userId);
      return { reply: customerNameReply(s?.full_name), actions_taken: ["read authenticated profile name"] };
    }
    case "balance": {
      const s = await getAccountSummary(admin, userId);
      if (!s) return { reply: "I couldn't find your account details right now. Please try again in a moment.", actions_taken: ["account lookup failed"] };
      return { reply: `Your current wallet balance is ${fmtNGN(s.wallet_balance)}. Your email is ${s.email_verified ? "verified" : "not verified yet"}. Would you like me to show your recent transactions, spending summary, or help with anything else?`, actions_taken: ["read wallet balance"] };
    }
    case "deposit_issue":
      return handleDeposit(msg, admin, userId);
    case "account_statement":
      return handleAccountStatement(admin, userId);
    case "spending_summary":
      return handleSpendingSummary(admin, userId);
    case "profile_info":
      return handleProfileInfo(admin, userId);
    case "notifications":
      return handleNotifications(admin, userId);
    case "ticket_status":
      return handleTicketStatus(admin, userId);
    case "number_issue":
    case "order_lookup":
      return handleNumberOrders(admin, userId, msg);
    case "otp_issue":
      return handleOtp(admin, userId, msg);
    case "email_otp_issue":
      return handleEmailOtp(admin, userId, msg);
    case "complaint":
      return handleComplaint(msg, history, admin, authedClient, userId);
    case "escalate":
      return handleEscalate(msg, history, authedClient);
    case "buy_number":
      return { reply: buyNumberReply(), actions_taken: [] };
    case "email_purchase":
      return { reply: "To rent an email for verification, open Email Purchase from your dashboard, choose the service, review the current price, and confirm the purchase. Your rented address and any received code appear on that page.", actions_taken: [] };
    case "login_issue":
      return { reply: "For login problems:\n- Double-check your email and password.\n- Forgot your password? Use the 'Forgot password' link on the login page.\n- If your email isn't verified yet, you'll need the OTP code we sent first.\n\nWhat error message are you seeing?", actions_taken: [] };
    case "password_issue":
      return { reply: "To reset your password, use the 'Forgot password' link on the login page. We'll email you a reset link. It works once and expires after a short time. Check your spam folder if you don't see it. Passwords need to be at least 6 characters.", actions_taken: [] };
    case "registration_issue":
      return { reply: "For registration and email verification:\n- After creating your account, we send a 6-digit code to your email.\n- Enter it within 10 minutes.\n- If it expired, tap 'Resend code'.\n- If you never got the email, check spam - Gmail sometimes filters our emails.\n\nAre you stuck at a particular step?", actions_taken: [] };
    case "refund":
      return { reply: "Refund policy:\n- Cancel a number before any SMS arrives -> automatically refunded to your wallet.\n- Number times out without SMS -> automatically refunded to your wallet.\n- Charged incorrectly due to a system error -> our team can review it.\n\nIf you think you were charged incorrectly, tell me what happened and I can create a support case.", actions_taken: [] };
    case "payment_failed":
      return { reply: "I'm sorry the payment failed. You can try again from Fund Wallet using an available payment method. If you were charged, send the Flutterwave transaction ID and I can check its provider status against your wallet record.", actions_taken: [] };
    case "pricing":
      return { reply: pricingReply(), actions_taken: [] };
    case "regions":
      return { reply: "Available countries and services change with provider inventory. Open Buy Numbers and check the current country and service lists to see what's available now. MONTEN SMS also offers email OTP rentals through Email Purchase.", actions_taken: [] };
    case "services":
      return { reply: servicesReply(), actions_taken: [] };
    case "navigation": {
      const lower = msg.toLowerCase();
      const page = /wallet|fund/.test(lower) ? "Fund Wallet"
        : /transaction|history/.test(lower) ? "Transaction History"
          : /email/.test(lower) ? "Email Purchase"
            : /notification/.test(lower) ? "Notifications"
              : /profile|setting/.test(lower) ? "Profile"
                : /developer/.test(lower) ? "Developer"
                  : /number|otp|order/.test(lower) ? "Buy Numbers or Purchased Numbers"
                    : "your dashboard";
      return { reply: `Open ${page} from the dashboard navigation.`, actions_taken: [] };
    }
    case "how_it_works":
      return { reply: "Create an account and verify your email, add funds from Fund Wallet, then choose a country and service in Buy Numbers or Email Purchase. Review the current offer and price before confirming. Orders and received codes are shown on their respective purchase pages.", actions_taken: [] };
    case "safety_privacy":
      return { reply: "Your safety and privacy on MONTEN SMS:\n\n- All transactions are encrypted and processed securely through Flutterwave, a licensed payment processor.\n- Your personal data (email, password) is stored securely and never shared with third parties.\n- Virtual numbers are temporary - they protect your real phone number from spam and unwanted tracking.\n- We don't store the content of SMS messages longer than needed to deliver them to you.\n- Wallet funds are tied to your account and cannot be accessed by anyone else.\n- MONTEN SMS is a legitimate service used by thousands of customers for SMS verification worldwide.\n\nIf you have specific security concerns, I can escalate them to our human team.", actions_taken: [] };
    default:
      return { reply: "I'm not sure I understood that. Could you rephrase or tell me what you're trying to do? I won't guess about your account or order.", kind: "fallback", actions_taken: [] };
  }
}

async function handleAccountStatement(admin: ReturnType<typeof createClient>, userId: string): Promise<AgentResult> {
  const [txns, summary] = await Promise.all([
    getTransactions(admin, userId, 15),
    getAccountSummary(admin, userId),
  ]);

  if (txns.length === 0) {
    return { reply: `I checked your transaction history and you don't have any transactions yet.${summary ? ` Your current wallet balance is ${fmtNGN(summary.wallet_balance)}.` : ""} Transactions appear here once you fund your wallet or buy a number. Would you like help getting started?`, actions_taken: ["no transactions found"] };
  }

  const lines = txns.map((t: any) => {
    const type = t.type === "deposit" ? "Deposit" : t.type === "purchase" ? "Purchase" : t.type === "refund" ? "Refund" : t.type;
    const status = t.status === "completed" ? "OK" : t.status === "pending" ? "Pending" : t.status === "failed" ? "Failed" : t.status;
    const desc = t.description ? ` - ${t.description}` : "";
    return `${fmtDate(t.created_at)} | ${type} | ${fmtNGN(t.amount)} | ${status}${desc}`;
  });

  const balance = summary ? `\n\nCurrent wallet balance: ${fmtNGN(summary.wallet_balance)}` : "";
  return {
    reply: `Here's your recent transaction history (last ${txns.length} transactions):\n\n${lines.join("\n")}${balance}\n\nWould you like a spending summary, or help with anything else?`,
    actions_taken: [`retrieved ${txns.length} transactions`],
  };
}

async function handleSpendingSummary(admin: ReturnType<typeof createClient>, userId: string): Promise<AgentResult> {
  const [txns, summary] = await Promise.all([
    getTransactions(admin, userId, 50),
    getAccountSummary(admin, userId),
  ]);

  if (txns.length === 0) {
    return { reply: `I couldn't find any transactions to summarize.${summary ? ` Your current wallet balance is ${fmtNGN(summary.wallet_balance)}.` : ""} Once you start funding your wallet and buying numbers, I can give you a detailed spending breakdown.`, actions_taken: ["no transactions for summary"] };
  }

  let totalDeposited = 0;
  let totalSpent = 0;
  let totalRefunded = 0;
  let depositCount = 0;
  let purchaseCount = 0;
  let refundCount = 0;
  let pendingDeposits = 0;
  let failedDeposits = 0;

  for (const t of txns as any[]) {
    if (t.type === "deposit") {
      depositCount++;
      if (t.status === "completed") totalDeposited += Number(t.amount);
      else if (t.status === "pending") pendingDeposits++;
      else if (t.status === "failed") failedDeposits++;
    } else if (t.type === "purchase") {
      purchaseCount++;
      if (t.status === "completed") totalSpent += Number(t.amount);
    } else if (t.type === "refund") {
      refundCount++;
      if (t.status === "completed") totalRefunded += Number(t.amount);
    }
  }

  const balance = summary ? fmtNGN(summary.wallet_balance) : "N/A";
  const netSpent = totalSpent - totalRefunded;

  const parts: string[] = [
    `Here's your spending summary:`,
    ``,
    `Current wallet balance: ${balance}`,
    `Total deposited: ${fmtNGN(totalDeposited)} (${depositCount} deposit${depositCount === 1 ? "" : "s"}${pendingDeposits > 0 ? `, ${pendingDeposits} pending` : ""}${failedDeposits > 0 ? `, ${failedDeposits} failed` : ""})`,
    `Total spent on numbers: ${fmtNGN(totalSpent)} (${purchaseCount} purchase${purchaseCount === 1 ? "" : "s"})`,
  ];

  if (totalRefunded > 0) {
    parts.push(`Total refunded: ${fmtNGN(totalRefunded)} (${refundCount} refund${refundCount === 1 ? "" : "s"})`);
    parts.push(`Net spending: ${fmtNGN(netSpent)}`);
  }

  parts.push(``, `Account created: ${summary ? fmtDate(summary.created_at) : "N/A"}`);

  if (summary && !summary.email_verified) {
    parts.push(``, `Note: Your email is not verified yet. Verify it to keep your account secure.`);
  }

  parts.push(``, `Would you like to see your full transaction history, or help with anything else?`);

  return { reply: parts.join("\n"), actions_taken: [`summarized ${txns.length} transactions: deposits=${depositCount} purchases=${purchaseCount} refunds=${refundCount}`] };
}

async function handleProfileInfo(admin: ReturnType<typeof createClient>, userId: string): Promise<AgentResult> {
  const s = await getAccountSummary(admin, userId);
  if (!s) return { reply: "I couldn't find your account details right now. Please try again in a moment.", actions_taken: ["account lookup failed"] };

  const lines: string[] = [
    `Here's your account overview:`,
    ``,
    `Name: ${s.full_name ?? "Not set"}`,
    `Username: ${s.username ?? "Not set"}`,
    `Email verified: ${s.email_verified ? "Yes" : "No"}`,
    `Wallet balance: ${fmtNGN(s.wallet_balance)}`,
    `Account created: ${fmtDate(s.created_at)}`,
  ];

  if (!s.email_verified) {
    lines.push(``, `Note: Your email isn't verified yet. Please verify it from your Profile page to keep your account secure.`);
  }

  lines.push(``, `Would you like to see your transaction history, spending summary, or help with anything else?`);

  return { reply: lines.join("\n"), actions_taken: ["read profile info"] };
}

async function handleNotifications(admin: ReturnType<typeof createClient>, userId: string): Promise<AgentResult> {
  const notifs = await getNotifications(admin, userId);

  if (notifs.length === 0) {
    return { reply: "You don't have any notifications right now. Notifications appear here when you receive deposits, buy numbers, or get support ticket updates. Is there anything else I can help with?", actions_taken: ["no notifications found"] };
  }

  const unread = notifs.filter((n: any) => !n.read);
  const lines = notifs.slice(0, 5).map((n: any) => {
    const mark = n.read ? "" : "[NEW] ";
    return `${mark}${fmtDate(n.created_at)} - ${n.title}: ${n.message}`;
  });

  const summary = unread.length > 0 ? `\n\nYou have ${unread.length} unread notification${unread.length === 1 ? "" : "s"}.` : "\n\nAll your notifications have been read.";
  return {
    reply: `Here are your recent notifications:\n\n${lines.join("\n")}${summary}\n\nYou can view all notifications on your Notifications page. Is there anything else I can help with?`,
    actions_taken: [`retrieved ${notifs.length} notifications, ${unread.length} unread`],
  };
}

async function handleTicketStatus(admin: ReturnType<typeof createClient>, userId: string): Promise<AgentResult> {
  const tickets = await getSupportTickets(admin, userId);

  if (tickets.length === 0) {
    return { reply: "You don't have any support tickets yet. If you need help with something, I can create a support case and escalate it to our human team. Would you like to do that?", actions_taken: ["no support tickets found"] };
  }

  const lines = tickets.map((t: any) => {
    return `${t.case_ref} | ${t.subject.length > 40 ? t.subject.slice(0, 37) + "..." : t.subject} | Status: ${t.status} | Priority: ${t.priority} | ${fmtDate(t.created_at)}`;
  });

  const open = tickets.filter((t: any) => t.status !== "closed" && t.status !== "resolved");
  const summary = open.length > 0 ? `\n\nYou have ${open.length} open case${open.length === 1 ? "" : "s"}. Our team will follow up with you.` : "\n\nAll your cases have been resolved.";

  return {
    reply: `Here are your support tickets:\n\n${lines.join("\n")}${summary}\n\nYou can also reach our human team on Telegram at @montensmssupport or by email at support@montensms.com. Is there anything else I can help with?`,
    actions_taken: [`retrieved ${tickets.length} tickets, ${open.length} open`],
  };
}

async function handleDeposit(msg: string, admin: ReturnType<typeof createClient>, userId: string): Promise<AgentResult> {
  const deposits = await getDeposits(admin, userId);
  const walletDeps = deposits.wallet;
  const mentionedAmount = extractAmount(msg);
  const mentionedTxId = extractTransactionId(msg);
  const empathy = "I'm sorry your deposit hasn't appeared yet. Let me check your records now. ";

  const latestWalletDeposit = walletDeps[0];
  const latestUncredited = [
    ...deposits.pending.filter((deposit: any) => deposit.status === "pending" || deposit.status === "failed"),
    ...deposits.webhook.filter((deposit: any) => deposit.status === "pending" || deposit.status === "failed"),
  ].filter((deposit: any) =>
    !walletDeps.some((walletDeposit: any) => walletDeposit.reference && walletDeposit.reference === (deposit.tx_ref ?? deposit.reference) && walletDeposit.status === "completed")
  ).sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  const matchesMentionedAmount = !mentionedAmount || Math.abs(Number(latestUncredited?.amount) - mentionedAmount) < 0.01;
  if (latestUncredited && matchesMentionedAmount &&
    (!latestWalletDeposit || String(latestUncredited.created_at) > String(latestWalletDeposit.created_at))) {
    const state = latestUncredited.status === "failed"
      ? "The payment record is marked failed in wallet-credit processing, so I can't confirm a completed wallet credit."
      : "The payment record is still pending in our deposit workflow, and I don't see a completed wallet credit for it yet.";
    return {
      reply: `${empathy}I found a payment record for ${fmtNGN(latestUncredited.amount)} from ${relTime(latestUncredited.created_at)}. ${state} If you have the Flutterwave transaction ID, share it and I can verify the payment; otherwise I can create a support case for reconciliation.`,
      actions_taken: [`found ${latestUncredited.status} payment record without completed wallet credit`],
    };
  }

  let matched: any = null;
  if (mentionedAmount) matched = walletDeps.find((t: any) => Math.abs(Number(t.amount) - mentionedAmount) < 0.01) ?? null;

  if (matched) {
    const amt = fmtNGN(matched.amount);
    const ref = matched.reference || "no reference";
    const when = relTime(matched.created_at);
    const actions = [`matched deposit ref=${ref} status=${matched.status}`];

    if (matched.status === "completed") {
      const s = await getAccountSummary(admin, userId);
      const bal = s ? fmtNGN(s.wallet_balance) : "unknown";
      actions.push("checked current wallet balance");
      return { reply: `${empathy}I found a deposit of ${amt} (ref: ${ref}) made ${when}. Its status is "completed" - it was credited to your wallet. Your current balance is ${bal}. If the balance looks lower than expected, a later purchase may have reduced it. Would you like me to check your recent transactions?`, actions_taken: actions };
    }
    if (matched.status === "pending") {
      const pend = deposits.pending.find((p: any) => p.tx_ref === matched.reference || p.amount === matched.amount);
      if (pend) {
        actions.push("found matching pending record");
        return { reply: `${empathy}I found a deposit of ${amt} (ref: ${ref}) made ${when}. It's currently "pending" - the payment has been received and is being processed. Your wallet will be credited automatically once confirmation completes, usually within a few minutes. If it's been more than 15 minutes, I can escalate this. Would you like me to?`, actions_taken: actions };
      }
      actions.push("no matching pending record");
      return { reply: `${empathy}I found a deposit of ${amt} (ref: ${ref}) made ${when} with status "pending", but I don't see a matching confirmation from the payment provider yet. Could you share the Flutterwave transaction reference or ID if you have it? I can verify it directly.`, actions_taken: actions };
    }
    if (matched.status === "failed") {
      actions.push("deposit marked failed");
      return { reply: `${empathy}I found a deposit record of ${amt} (ref: ${ref}) made ${when}, but its status is "failed". The payment wasn't completed, so your wallet wasn't credited. You can try funding again from the Fund Wallet page. If you believe this is an error and you were charged, share the transaction reference and I'll escalate it.`, actions_taken: actions };
    }
  }

  if (walletDeps.length === 0 && (deposits.pending.length > 0 || deposits.webhook.length > 0)) {
    const latest = deposits.pending[0] ?? deposits.webhook[0];
    return { reply: `${empathy}I don't see a completed deposit in your wallet yet, but I found a payment record of ${fmtNGN(latest.amount)} from ${relTime(latest.created_at)} that is currently "${latest.status}". Once the payment provider confirms it, your wallet will be credited automatically. If it's been more than 15 minutes, would you like me to escalate this?`, actions_taken: ["found in-flight payment, no wallet credit yet"] };
  }

  if (walletDeps.length === 0 && deposits.pending.length === 0 && deposits.webhook.length === 0) {
    return { reply: missingDepositReply({ amount: mentionedAmount, txId: mentionedTxId }), actions_taken: ["no deposit records found"] };
  }

  if (!matched && walletDeps.length > 0) {
    const latest = walletDeps[0];
    return {
      reply: `${empathy}The latest deposit record on your account is ${fmtNGN(latest.amount)}, ${relTime(latest.created_at)}, with status "${latest.status}". I can't confirm that this is the payment you're asking about. Is it the same deposit? If not, share its amount or Flutterwave transaction reference.`,
      actions_taken: ["listed latest deposit without assuming it matches"],
    };
  }

  const recentList = walletDeps.slice(0, 3).map((t: any) => `${fmtNGN(t.amount)} (${t.status}, ${relTime(t.created_at)})`).join("; ");
  return { reply: `${empathy}I checked your deposit history. Your most recent deposits are: ${recentList}. None of these match ${mentionedAmount ? fmtNGN(mentionedAmount) : "the amount you mentioned"}. Could you double-check the amount, or share the Flutterwave transaction reference?`, actions_taken: ["deposits exist, none matched"] };
}

async function handleNumberOrders(admin: ReturnType<typeof createClient>, userId: string, message: string): Promise<AgentResult> {
  const orders = await getNumberOrders(admin, userId);
  const reference = extractOrderReference(message);
  const matching = findNumberOrder(orders, message, reference);
  if (reference && !matching) {
    return { reply: "I couldn't find a number order with that reference under your account. Please check the reference or phone number on Purchased Numbers and send it again.", actions_taken: ["order reference not found for authenticated user"] };
  }
  const selected = matching ? [matching] : orders.slice(0, 5);
  return { reply: orderLookupReply(selected), actions_taken: [`retrieved ${selected.length} number orders for authenticated user`] };
}

async function handleOtp(admin: ReturnType<typeof createClient>, userId: string, message: string): Promise<AgentResult> {
  const orders = await getNumberOrders(admin, userId);
  const reference = extractOrderReference(message);
  const matching = findNumberOrder(orders, message, reference);
  if (reference && !matching) {
    return { reply: "I couldn't find a number order with that reference under your account. Please check the reference or phone number on Purchased Numbers and send it again.", actions_taken: ["OTP order reference not found for authenticated user"] };
  }
  const waiting = orders.filter((order: any) => order.status === "waiting");
  if (matching) return { reply: otpOrderReply(matching), actions_taken: [`checked OTP order ${String(matching.id).slice(0, 8)}`] };
  if (waiting.length === 1) return { reply: otpOrderReply(waiting[0]), actions_taken: [`checked waiting OTP order ${String(waiting[0].id).slice(0, 8)}`] };
  if (waiting.length > 1) return { reply: ambiguousOtpOrdersReply(waiting.length), actions_taken: [`found ${waiting.length} active OTP orders`] };
  if (orders.length > 0) return { reply: otpOrderReply(orders[0]), actions_taken: [`checked latest OTP order ${String(orders[0].id).slice(0, 8)}`] };
  return { reply: missingOtpOrderReply(), actions_taken: ["no number orders found for authenticated user"] };
}

async function handleEmailOtp(admin: ReturnType<typeof createClient>, userId: string, message: string): Promise<AgentResult> {
  const orders = await getEmailOrders(admin, userId);
  const reference = extractOrderReference(message);
  const matching = reference ? orders.find((order: any) => String(order.id).startsWith(reference) || String(order.mailotp_task_id ?? "") === reference) : null;
  if (reference && !matching) {
    return { reply: "I couldn't find an email OTP order with that reference under your account. Please check Email Purchase and send the order reference again.", actions_taken: ["email order reference not found for authenticated user"] };
  }
  const waiting = orders.filter((order: any) => order.status === "waiting");
  const order = matching ?? (waiting.length === 1 ? waiting[0] : orders[0]);
  if (!order) {
    return { reply: "I'm sorry the email code hasn't arrived. I couldn't find an email OTP order in your account. Could you share the order reference or service so I can check the right purchase?", actions_taken: ["no email OTP orders found for authenticated user"] };
  }
  if (!matching && waiting.length > 1) {
    return { reply: `I'm sorry the email OTP is delayed. I found ${waiting.length} email orders waiting for a code. Which service or order reference should I check?`, actions_taken: [`found ${waiting.length} waiting email OTP orders`] };
  }
  if (order.status === "waiting") {
    return { reply: `I'm sorry the email code hasn't arrived yet. I checked your ${order.service} email order, and its current status is waiting. The account has no recorded code for it yet. Check Email Purchase for updates; if it has expired, send me the order reference and I can help with next steps.`, actions_taken: [`checked email OTP order ${String(order.id).slice(0, 8)}`] };
  }
  if (order.status === "received") {
    return { reply: `I checked your ${order.service} email order; it is marked as received. Open Email Purchase to view the code. For security, I won't repeat OTP codes in chat.`, actions_taken: [`checked received email OTP order ${String(order.id).slice(0, 8)}`] };
  }
  return { reply: `I checked your ${order.service} email order. Its current status is "${order.status}". Please review the order on Email Purchase; if you believe the status is wrong, I can help create a support case.`, actions_taken: [`checked email OTP order ${String(order.id).slice(0, 8)}`] };
}

async function handleComplaint(msg: string, history: Turn[], admin: ReturnType<typeof createClient>, authedClient: ReturnType<typeof createClient>, userId: string): Promise<AgentResult> {
  const lower = msg.toLowerCase();
  if (/email/.test(lower) && /otp|code|order/.test(lower)) return handleEmailOtp(admin, userId, msg);
  if (/otp|sms|verification code/.test(lower)) return handleOtp(admin, userId, msg);
  if (/deposit|payment|wallet|charged/.test(lower)) return handleDeposit(msg, admin, userId);
  if (/order|number/.test(lower)) {
    const result = await handleNumberOrders(admin, userId, msg);
    return {
      ...result,
      reply: `${complaintOpening()} ${result.reply}`,
    };
  }
  return {
    reply: "I'm sorry you're having a frustrating experience. I want to help—what happened, or what order or payment should I check?",
    actions_taken: [],
  };
}

async function handleVerifyPayment(admin: ReturnType<typeof createClient>, userId: string, userEmail: string, txId: string): Promise<AgentResult> {
  const result: any = await verifyFlwPayment(admin, userId, userEmail, txId);
  if (result.verified) {
    const { data: match, error } = await admin.from("transactions")
      .select("status")
      .eq("user_id", userId)
      .eq("type", "deposit")
      .eq("reference", result.tx_ref)
      .maybeSingle();
    if (error) throw error;
    if (match && match.status === "completed") return { reply: `I verified your Flutterwave payment of ${fmtNGN(result.amount)} ${result.currency} (ref: ${result.tx_ref}). It's successful and your wallet was already credited. Would you like me to check your current balance?`, actions_taken: [`verified flutterwave tx=${txId}; wallet credit confirmed`] };
    if (match && match.status === "pending") return { reply: `I verified your Flutterwave payment of ${fmtNGN(result.amount)} ${result.currency} (ref: ${result.tx_ref}). The wallet transaction is still marked pending, so I can't confirm that the credit completed. I can create a support case to have the payment reconciled.`, actions_taken: [`verified flutterwave tx=${txId}; wallet transaction pending`] };
    if (match && match.status === "failed") return { reply: `I verified your Flutterwave payment of ${fmtNGN(result.amount)} ${result.currency} (ref: ${result.tx_ref}), but the wallet transaction is marked failed. I can't confirm that your balance was credited; this needs payment reconciliation. Would you like me to create a support case?`, actions_taken: [`verified flutterwave tx=${txId}; wallet transaction failed`] };
    return { reply: `I verified your Flutterwave payment of ${fmtNGN(result.amount)} ${result.currency} (ref: ${result.tx_ref}). Flutterwave confirms it as successful, but I don't see a matching credit in your wallet yet. This needs manual reconciliation. Would you like me to create a support case and escalate it?`, actions_taken: [`verified flutterwave tx=${txId}; no wallet credit - reconciliation gap`] };
  }
  if (result.reason === "not_owned") return { reply: "I wasn't able to verify that transaction because it doesn't appear to belong to your account. For security, I can only look up payments made from your own MONTEN SMS wallet. If you think this is an error, please contact human support.", actions_taken: [`tx=${txId} failed ownership check`] };
  if (result.reason === "not_successful") return { reply: `I checked that transaction with Flutterwave. Its status is "${result.flw_status}", which means the payment wasn't completed successfully. Your wallet wasn't credited. You can try funding again from the Fund Wallet page. If you believe this is wrong, I can escalate it.`, actions_taken: [`flutterwave tx=${txId} status=${result.flw_status}`] };
  return { reply: "I couldn't verify that payment right now. Could you double-check the transaction ID, or share the transaction reference as well? If the issue continues, I can create a support case.", actions_taken: [`flutterwave verify failed tx=${txId} reason=${result.reason}`] };
}

async function handleEscalate(msg: string, history: Turn[], authedClient: ReturnType<typeof createClient>): Promise<AgentResult> {
  const userMsgs = history.filter((h) => h.role === "user").map((h) => h.text);
  const lastUser = userMsgs[userMsgs.length - 1] ?? msg;
  const safeSubject = redactSensitiveText(lastUser);
  const subject = safeSubject.length > 120 ? safeSubject.slice(0, 117) + "..." : safeSubject;
  const contextSummary = history.slice(-8).map((h) => `${h.role === "user" ? "User" : "Assistant"}: ${redactSensitiveText(h.text)}`).join("\n").slice(0, 1200);
  const summary = `Summary of the user's complaint, with conversation context:\n${contextSummary}`;

  let ticket: any;
  try {
    const { data, error } = await authedClient.rpc("create_support_ticket", { p_subject: subject || "Support request", p_category: "general", p_priority: "normal", p_summary: summary });
    if (error) throw error;
    ticket = data;
  } catch (err) {
    console.error("[support-agent] ticket creation failed", err instanceof Error ? err.name : "unknown");
    return { reply: "I tried to create a support case for you but something went wrong on our side. You can reach our human team on Telegram at @montensmssupport or by email at support@montensms.com.", kind: "contact-human", actions_taken: ["ticket creation failed"] };
  }

  let escalated: any = null;
  try {
    const { data, error } = await authedClient.rpc("escalate_support_ticket", { p_ticket_id: ticket.id, p_conclusion: "User requested human escalation after AI troubleshooting." });
    if (!error) escalated = data;
  } catch (err) {
    console.error("[support-agent] escalation failed", err instanceof Error ? err.name : "unknown");
  }

  return {
    reply: `I've created a support case for you and flagged it for our human team.\n\nCase reference: ${ticket.case_ref}\nSubject: ${ticket.subject}\nStatus: ${escalated?.status ?? "open"}\n\nOur team will follow up with you. You can also reach us on Telegram at @montensmssupport or by email at support@montensms.com. Please keep your case reference handy.`,
    kind: "ticket_created",
    ticket: { case_ref: ticket.case_ref, subject: ticket.subject, status: escalated?.status ?? ticket.status, priority: ticket.priority },
    actions_taken: ["created support ticket", "escalated to human team"],
  };
}

// ---- LLM (Google Gemini — free tier) ----

const aiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
const GEMINI_MODEL = "gemini-3.8-flash";
const AI_TIMEOUT_MS = 30000;
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Enhanced support-agent system prompt: human-like, emotionally intelligent,
// honest about verified vs possible causes.
function buildSystemPrompt(accountContext: string, firstName: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `You are Monten SMS AI Support, the friendly and intelligent customer-support assistant for MONTEN SMS (montensms.com).
${firstName ? `The person you are talking to is ${firstName}.` : ""} Today's date is ${today}.

HOW YOU COMMUNICATE:
- Speak like an experienced, warm human customer-care agent: friendly, patient, polite, never robotic or scripted.
- Adapt to the customer's emotion. If they are angry or frustrated, first acknowledge the feeling and sincerely apologize for the experience ("I'm really sorry you're dealing with this..."), stay calm, never argue, never blame the customer, and focus on fixing the problem. Offer to investigate their actual records.
- If they are confused or new, welcome them and explain step by step in simple language.
- Answer the latest customer message directly. Treat earlier messages as context, not as the current question.
- Never answer an unrelated question with a description of MONTEN SMS. If you don't understand, ask one relevant clarifying question.
- Never make the customer repeat information you already have — check the account data below and the conversation history first.
- If a previous complaint exists in their history or account data, acknowledge it ("I can see you reported this before...").
- Keep replies concise (usually 2-6 sentences), in the customer's language (mostly English). Never reply with a list of canned questions unless genuinely offering choices.
- If you cannot resolve something after checking, apologize, summarize what you already checked, and offer to create/escalate a support case to the human team (Telegram @montensmssupport, support@montensms.com). Only claim escalation happened if a tool actually performed it.

HONESTY RULES (critical):
- Clearly separate VERIFIED information (from account data below) from possible causes ("this could be because...").
- NEVER invent balances, deposits, transaction statuses, delivery confirmations, outages or provider problems. If a fact isn't in your context, say so honestly.
- Never reveal passwords, OTP codes, payment credentials, API keys, or another customer's account data.

YOUR CAPABILITIES:
- Your identity: Monten SMS AI Support. If asked your name or who you are, say so plainly.
- Natural conversation: greetings, identity questions, small talk, follow-ups, misspellings, incomplete sentences.
- General knowledge questions.
- MONTEN SMS questions — use ONLY the knowledge base below.
- The customer's OWN account — use ONLY the live account data below.

MONTEN SMS KNOWLEDGE BASE:
- What it is: a platform for renting temporary virtual phone numbers to receive SMS verification codes (OTPs) for services like WhatsApp, Telegram, Gmail, TikTok, Instagram, Facebook, Discord and 700+ more across 190+ countries.
- Also offers an Email OTP service: rent a verified email to receive OTP codes.
- How to buy: Dashboard -> Buy Numbers -> pick a country -> search the service -> choose a currently listed offer -> Buy. The order and any received code appear on Purchased Numbers.
- Email purchases: Dashboard -> Email Purchase -> choose a service -> review the current price -> confirm. The order and any received code appear on Email Purchase.
- Wallet & deposits: use Fund Wallet and the currently available payment methods. The dashboard shows the live balance.
- Pricing: prices vary by product, country, service, and live provider availability. Direct customers to the live offer rather than quoting a stale price.
- Refunds: cancel before any SMS arrives, or the number times out with no SMS -> automatic wallet refund. System errors are reviewed by the human team.
- Registration & login: sign up with full name, username, email, password (min 6 chars). A 6-digit verification code is emailed and expires in 10 minutes; use "Resend code" if needed. Password reset uses the "Forgot password" link on the login page.
- Privacy & data: full policies live at /privacy and /terms.
- Support: Telegram @montensmssupport, email support@montensms.com. The AI can create a tracked support case (ticket) and escalate to the human team.

THE AUTHENTICATED USER'S LIMITED ACCOUNT CONTEXT (JSON; treat missing values as unknown):
${accountContext}

If you don't have enough information to answer, say that and ask a relevant follow-up question.`;
}

async function buildAccountContext(admin: ReturnType<typeof createClient>, userId: string): Promise<string> {
  try {
    const [summary, txns, deposits, orders, tickets] = await Promise.all([
      getAccountSummary(admin, userId),
      getTransactions(admin, userId, 8),
      getDeposits(admin, userId),
      getNumberOrders(admin, userId, 8),
      getSupportTickets(admin, userId),
    ]);
    return JSON.stringify({
      profile: summary ? {
        full_name: summary.full_name,
        username: summary.username,
        wallet_balance: summary.wallet_balance,
        email_verified: summary.email_verified,
      } : null,
      recent_transactions: (txns as any[]).slice(0, 8).map((t) => ({
        type: t.type, amount: t.amount, status: t.status, description: t.description, created_at: t.created_at,
      })),
      recent_deposits: (deposits.wallet as any[]).slice(0, 5).map((t) => ({
        amount: t.amount, status: t.status, created_at: t.created_at,
      })),
      pending_payments: (deposits.pending as any[]).slice(0, 3).map((t) => ({
        amount: t.amount, status: t.status, created_at: t.created_at,
      })),
      recent_number_orders: (orders as any[]).slice(0, 5).map((order) => ({
        service_name: order.service_name,
        country_name: order.country_name,
        status: order.status,
        created_at: order.created_at,
        number_assigned: Boolean(order.phone_number),
        otp_received: Boolean(order.sms_code),
        failure_reason: order.failure_reason,
      })),
      recent_support_tickets: (tickets as any[]).slice(0, 3).map((ticket) => ({
        subject: ticket.subject, status: ticket.status, priority: ticket.priority, created_at: ticket.created_at,
      })),
    });
  } catch (err) {
    console.error("[support-agent] account context query failed", err instanceof Error ? err.name : "unknown");
    return '{"account_data":"temporarily unavailable; do not infer or invent account details"}';
  }
}

// Free-tier rate-limit safety: simple per-instance spacing between calls.
let lastCallAt = 0;
const MIN_CALL_GAP_MS = 1500;

async function callLLM(systemPrompt: string, turns: Turn[]): Promise<string | null> {
  if (!aiKey) {
    console.error("[support-agent] GEMINI_API_KEY is not configured");
    return null;
  }
  const now = Date.now();
  const wait = lastCallAt + MIN_CALL_GAP_MS - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();

  const contents = turns.map((t) => ({
    role: t.role === "assistant" ? "model" : "user",
    parts: [{ text: t.text }],
  }));
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { temperature: 0.6, maxOutputTokens: 1024 },
  };
  try {
    const res = await fetch(`${GEMINI_BASE}/${GEMINI_MODEL}:generateContent`, {
      method: "POST",
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      headers: { "Content-Type": "application/json", "x-goog-api-key": aiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`[support-agent] gemini failed status=${res.status}`);
      return null;
    }
    const data: any = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const text = parts.filter((p: any) => p.text).map((p: any) => p.text).join("").trim();
    if (text) return text;
    console.error(`[support-agent] gemini returned no text; finish_reason=${data?.candidates?.[0]?.finishReason ?? "empty"}`);
    return null;
  } catch (err) {
    console.error("[support-agent] gemini call failed", err instanceof Error ? err.name : "unknown");
    return null;
  }
}

// ---- Main ----

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return fail(405, "Method not allowed");

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return fail(401, "Please sign in to use the support assistant.", "unauthenticated");
  const token = authHeader.replace("Bearer ", "");
  if (!token || token === "undefined") return fail(401, "Please sign in to use the support assistant.", "unauthenticated");

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user) return fail(401, "Please sign in to use the support assistant.", "unauthenticated");
  const userId = userData.user.id;
  const userEmail = userData.user.email ?? "";

  const authedClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });

  let body: any;
  try {
    body = await req.json();
  } catch (_e) {
    return fail(400, "Invalid request.");
  }

  const message = String(body.message ?? "").trim().slice(0, 1000);

  if (!message) {
    if (body.action === "history") {
      try {
        const conversationId = await getOrCreateConversation(admin, userId);
        const { data: metaRows, error: historyError } = await admin
          .from("support_messages")
          .select("role, content, meta, created_at")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true });
        if (historyError) throw historyError;
        const messages = (metaRows ?? [])        .map((m: any) => ({
          role: m.role === "assistant" ? "assistant" : "user",
              text: redactSensitiveText(String(m.content ?? "")),
          kind: m.meta?.kind,
          ticket: m.meta?.ticket,
          created_at: m.created_at,
        })).sort((a: any, b: any) => {
          const byTime = String(a.created_at).localeCompare(String(b.created_at));
          if (byTime) return byTime;
          return a.role === b.role ? 0 : a.role === "user" ? -1 : 1;
        }).slice(-MAX_SAVED_LENGTH);
        return json({ messages });
      } catch (err) {
        console.error("[support-agent] history load failed", err instanceof Error ? err.name : "unknown");
        return json({ messages: [] });
      }
    }
    return json({ reply: "Could you tell me a bit more about what you need?", actions_taken: [] });
  }

  let firstName = "";
  try {
    const s = await getAccountSummary(admin, userId);
    if (s?.full_name) firstName = s.full_name.split(" ")[0];
  } catch (_e) { /* non-critical */ }

  console.log(`[support-agent] message received msg_len=${message.length}`);

  try {
    // Use this account's persisted history as the source of truth when it is available.
    let conversationId = "";
    let storedTurns: Turn[] | null = null;
    try {
      conversationId = await getOrCreateConversation(admin, userId);
      storedTurns = await loadStoredHistory(admin, conversationId);
    } catch (memErr) {
      console.error("[support-agent] memory load failed", memErr instanceof Error ? memErr.name : "unknown");
    }

    const fullHistory = (storedTurns ?? []).slice(-24);

    let result: AgentResult;
    const intent = resolveSupportIntent(message, fullHistory);

    const transactionId = extractTransactionId(message, fullHistory);
    if (transactionId && (intent === "deposit_issue" || intent === "payment_failed" || /verify.*(payment|transaction|flutterwave)/i.test(message))) {
      result = await handleVerifyPayment(admin, userId, userEmail, transactionId);
    } else if (intent === "escalate" || /^(yes|yeah|sure|ok|okay|please do|go ahead)\b/i.test(message) && /escalat|human|agent|support case/i.test(fullHistory.slice(-3).map((h) => h.text).join(" "))) {
      result = await handleEscalate(message, fullHistory, authedClient);
    } else if (intent !== "general") {
      result = await handleSupport(message, fullHistory, admin, authedClient, userId);
    } else if (classify(message, fullHistory) === "casual") {
      result = casualReply(message, fullHistory, firstName);
    } else {
      const accountContext = await buildAccountContext(admin, userId);
      const systemPrompt = buildSystemPrompt(accountContext, firstName);
      const llmReply = await callLLM(systemPrompt, buildModelTurns(storedTurns, message));
      if (llmReply) {
        result = { reply: llmReply.slice(0, 2000), actions_taken: ["llm", `model=${GEMINI_MODEL}`] };
      } else {
        result = {
          reply: aiUnavailableReply(),
          kind: "fallback",
          actions_taken: ["ai_unavailable"],
        };
      }
    }

    if (conversationId) {
      await persistMessages(admin, conversationId, userId, message, result);
    }

    console.log(`[support-agent] reply sent actions=${(result.actions_taken ?? []).join("|")}`);
    return json(result);
  } catch (err) {
    console.error("[support-agent] error", err instanceof Error ? err.name : "unknown");
    return fail(500, "I ran into a problem looking that up. Please try again, or contact human support if it persists.");
  }
});
