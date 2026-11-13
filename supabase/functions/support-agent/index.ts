import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
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

function maskEmail(email: string): string {
  const parts = (email || "").split("@");
  if (parts.length < 2) return "[unknown]";
  const local = parts[0];
  const masked = local.length <= 2 ? local[0] + "***" : local[0] + "***" + local.slice(-1);
  return `${masked}@${parts[1]}`;
}

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
  const { data } = await admin
    .from("support_conversations")
    .select("id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.id) return data.id as string;
  const { data: created, error } = await admin
    .from("support_conversations")
    .insert({ user_id: userId })
    .select("id")
    .single();
  if (error || !created) throw error ?? new Error("conversation create failed");
  return created.id as string;
}

async function loadStoredHistory(admin: ReturnType<typeof createClient>, conversationId: string): Promise<Turn[]> {
  const { data, error } = await admin
    .from("support_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(24);
  if (error) return [];
  return (data ?? [])
    .reverse()
    .map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", text: String(m.content ?? "").slice(0, 500) }));
}

async function persistMessages(
  admin: ReturnType<typeof createClient>,
  conversationId: string,
  userId: string,
  userMsg: string,
  result: AgentResult,
) {
  const rows = [
    { conversation_id: conversationId, user_id: userId, role: "user", content: userMsg.slice(0, 1000) },
    { conversation_id: conversationId, user_id: userId, role: "assistant", content: result.reply.slice(0, 2000), meta: { kind: result.kind ?? "text", ...(result.ticket ? { ticket: result.ticket } : {}) } },
  ];
  try {
    const { error } = await admin.from("support_messages").insert(rows);
    if (error) throw error;
    await admin.from("support_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
  } catch (err) {
    console.error("[support-agent] memory persist failed:", err instanceof Error ? err.message : err);
  }
}

// Follow-up detection: refers to the previous topic without naming it.
function isFollowUp(msg: string): boolean {
  const m = msg.toLowerCase().trim();
  return (
    /^(yes|yeah|yep|yup|sure|ok|okay|please do|go ahead|do it|escalate it|yes please|check it|check again)\b/i.test(m) ||
    /\b(it|that|this|they|them)\b/i.test(m) && m.length < 80 && !/(deposit|wallet|balance|number|otp|payment|refund|ticket|case|transaction|price|fee)/i.test(m)
  );
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

async function getNumberOrders(admin: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await admin
    .from("purchased_numbers")
    .select("phone_number, country_name, service_name, selling_price, status, sms_code, created_at")
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

async function verifyFlwPayment(userId: string, txId: string): Promise<Record<string, unknown>> {
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
  if (!txRef.includes(userId.slice(0, 8))) return { verified: false, reason: "not_owned" };
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

// ---- Support intent router ----

function supportIntent(msg: string): string {
  const m = msg.toLowerCase();
  if (/(deposit|funded|funding|credited|money (has|did)not|money not|balance (not|didnt|didn|has not)|wallet not|payment (not|didnt|didn)|paid (but|and)|i paid|i deposited|i sent|missing (deposit|funds|money|payment))/i.test(m)) return "deposit_issue";
  if (/(statement|transaction history|transaction list|my transactions|recent transactions|all my transactions|show me my transactions|what have i (done|bought|spent)|history)/i.test(m)) return "account_statement";
  if (/(pricing|how much.*cost|cost of|price of|how much.*number|fee|fees|charge|charges|how much.*sms|how much.*otp|expensive|cheap|afford)/i.test(m)) return "pricing";
  if (/(spending|spent|how much.*spent|total spent|total (spent|used|bought)|money spent|how much have i (spent|used)|spending summary|spending history)/i.test(m)) return "spending_summary";
  if (/(my profile|my account (details|info)|profile (info|details)|my username|who am i|account (overview|summary|info)|tell me about my (account|profile))/i.test(m)) return "profile_info";
  if (/(notification|notifications|unread|alerts|messages from.*system|any (new )?notifications|check.*notifications)/i.test(m)) return "notifications";
  if (/(my (ticket|tickets|case|cases)|ticket status|case status|support (ticket|case)|check.*(ticket|case)|my support|open ticket|open case)/i.test(m)) return "ticket_status";
  if (/(balance|wallet|how much (do|money|funds)|current (balance|wallet)|my (balance|wallet|funds))/i.test(m)) return "balance";
  if (/(otp|code|sms).*(not|didn|didnt|haven|no ).*(receiv|arriv|come|got)|no (otp|code|sms)|otp not received|not receiv/i.test(m)) return "otp_issue";
  if (/(my (number|numbers|order|orders)|number|order).*(fail|cancel|expired|not work|broken|dead|inactive|list|show|what)|expired|not working number|my (number|numbers)|show.*number|list.*number/i.test(m)) return "number_issue";
  if (/(login|sign in|signin|can.t log|cannot log|locked out)/i.test(m)) return "login_issue";
  if (/(password|reset password|forgot password|change password|recover)/i.test(m)) return "password_issue";
  if (/(register|sign ?up|signup|create account|verify email|verification (code|email|otp)|email (verification|verified))/i.test(m)) return "registration_issue";
  if (/(refund|money back|reimburse|chargeback|wrong charge|overcharg)/i.test(m)) return "refund";
  if (/((payment|card|flutterwave|transaction).*(fail|declin|reject|error)|payment (fail|issue|error|declin)|card (declin|reject))/i.test(m)) return "payment_failed";
  if (/(how.*buy|how.*get|buy.*number|purchase.*number|new number|order number)/i.test(m)) return "buy_number";
  if (/(country|countries|supported|available (countries|services))/i.test(m)) return "regions";
  if (/(how.*(work|use)|getting started|how do.*use|guide|tutorial|what.*monten|what is.*monten|how.*sms|how.*otp|how.*virtual)/i.test(m)) return "how_it_works";
  if (/(safe|secure|security|privacy|private|trust|legit|scam|legitimate|reliable|is.*safe|is.*legit|is.*trusted|data (safe|secure|protected))/i.test(m)) return "safety_privacy";
  if (/(ticket|case|reference number|escalat|human|agent|talk to (someone|human|support))/i.test(m)) return "escalate";
  return "general";
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

function extractTxId(msg: string): string | null {
  const m = msg.match(/\b(\d{6,})\b/);
  return m ? m[1] : null;
}

async function handleSupport(msg: string, history: Turn[], admin: ReturnType<typeof createClient>, authedClient: ReturnType<typeof createClient>, userId: string): Promise<AgentResult> {
  let intent = supportIntent(msg);

  // Follow-up handling: "yes please" / "check it" after a deposit or ticket
  // question should continue the earlier topic using stored memory.
  const lastAssistant = [...history].reverse().find((h) => h.role === "assistant")?.text ?? "";
  if (intent === "general" && isFollowUp(msg) && history.length > 0) {
    if (/escalate|support case|create a support case/i.test(lastAssistant)) {
      return handleEscalate(msg, history, authedClient);
    }
    if (/pending|wallet|deposit/i.test(lastAssistant)) {
      intent = "deposit_issue";
    } else if (/balance/i.test(lastAssistant)) {
      intent = "balance";
    } else if (/ticket|case/i.test(lastAssistant)) {
      intent = "ticket_status";
    } else if (/transaction/i.test(lastAssistant)) {
      intent = "account_statement";
    }
  }

  if (extractTxId(msg) && (intent === "deposit_issue" || intent === "payment_failed" || /verify.*(payment|transaction|flutterwave)/i.test(msg))) {
    return handleVerifyPayment(msg, admin, userId);
  }

  switch (intent) {
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
      return handleNumberOrders(admin, userId);
    case "otp_issue":
      return handleOtp(admin, userId);
    case "escalate":
      return handleEscalate(msg, history, authedClient);
    case "buy_number":
      return { reply: "To buy a virtual number:\n1. Go to 'Buy Numbers' from your dashboard.\n2. Select a country.\n3. Search for the service you need (WhatsApp, Telegram, Gmail, etc.).\n4. Choose an offer and click 'Buy'.\n\nMake sure your wallet has enough balance. Would you like me to check your balance?", actions_taken: [] };
    case "login_issue":
      return { reply: "For login problems:\n- Double-check your email and password.\n- Forgot your password? Use the 'Forgot password' link on the login page.\n- If your email isn't verified yet, you'll need the OTP code we sent first.\n\nWhat error message are you seeing?", actions_taken: [] };
    case "password_issue":
      return { reply: "To reset your password, use the 'Forgot password' link on the login page. We'll email you a reset link. It works once and expires after a short time. Check your spam folder if you don't see it. Passwords need to be at least 6 characters.", actions_taken: [] };
    case "registration_issue":
      return { reply: "For registration and email verification:\n- After creating your account, we send a 6-digit code to your email.\n- Enter it within 10 minutes.\n- If it expired, tap 'Resend code'.\n- If you never got the email, check spam - Gmail sometimes filters our emails.\n\nAre you stuck at a particular step?", actions_taken: [] };
    case "refund":
      return { reply: "Refund policy:\n- Cancel a number before any SMS arrives -> automatically refunded to your wallet.\n- Number times out without SMS -> automatically refunded to your wallet.\n- Charged incorrectly due to a system error -> our team can review it.\n\nIf you think you were charged incorrectly, tell me what happened and I can create a support case.", actions_taken: [] };
    case "payment_failed":
      return { reply: "If your payment failed:\n- Check your card has enough funds.\n- Try a different method - Flutterwave supports card, bank transfer, and USSD.\n- If you were charged but your wallet wasn't credited, wait a few minutes.\n- If it's been more than 10 minutes, share the Flutterwave transaction ID and I'll verify it directly.\n\nMinimum deposit is NGN 100. Do you have a transaction reference?", actions_taken: [] };
    case "pricing":
      return { reply: "Pricing on MONTEN SMS:\n- Virtual numbers start from as low as NGN 50, depending on the country and service.\n- Popular services like WhatsApp, Telegram, and Gmail typically range from NGN 50 to NGN 500 per number.\n- Each number rental includes a window to receive one SMS/OTP (usually 5-20 minutes).\n- Minimum wallet deposit is NGN 100.\n- There are no subscription fees or hidden charges - you only pay per number you buy.\n- Wallet funds never expire and can be used anytime.\n\nWould you like me to check your current balance or help you buy a number?", actions_taken: [] };
    case "regions":
      return { reply: "MONTEN SMS supports 190+ countries and 700+ services, including WhatsApp, Telegram, Gmail, TikTok, Instagram, Facebook, Discord, and many more. Go to 'Buy Numbers', select a country, and search for your service to see what's available.", actions_taken: [] };
    case "how_it_works":
      return { reply: "How MONTEN SMS works:\n\n1. Create an account with your email and verify it with the OTP code we send.\n2. Fund your wallet using Flutterwave (card, bank transfer, or USSD) - minimum NGN 100.\n3. Go to 'Buy Numbers', select a country, search for your service (WhatsApp, Telegram, Gmail, etc.), and buy a number.\n4. Use that virtual number on the service you're verifying.\n5. The SMS/OTP code arrives on your 'Purchased Numbers' page - usually within 30 seconds to 2 minutes.\n6. Copy the code and use it to complete your verification.\n\nEach number is for one service only and has a rental window. The whole process takes under 2 minutes!", actions_taken: [] };
    case "safety_privacy":
      return { reply: "Your safety and privacy on MONTEN SMS:\n\n- All transactions are encrypted and processed securely through Flutterwave, a licensed payment processor.\n- Your personal data (email, password) is stored securely and never shared with third parties.\n- Virtual numbers are temporary - they protect your real phone number from spam and unwanted tracking.\n- We don't store the content of SMS messages longer than needed to deliver them to you.\n- Wallet funds are tied to your account and cannot be accessed by anyone else.\n- MONTEN SMS is a legitimate service used by thousands of customers for SMS verification worldwide.\n\nIf you have specific security concerns, I can escalate them to our human team.", actions_taken: [] };
    default:
      return { reply: "I want to make sure I help you with the right thing. I can look into:\n- Your wallet balance and account details\n- Your transaction history and spending summary\n- Deposits and missing payments\n- Number orders, OTP issues, and SMS codes\n- Your notifications and support tickets\n- Pricing, refunds, and how MONTEN SMS works\n- Escalating to our human support team\n\nCould you tell me a bit more about what's going on?", kind: "fallback", actions_taken: [] };
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
  const mentionedTxId = extractTxId(msg);
  const empathy = "I'm sorry your deposit hasn't appeared yet. Let me check your records now. ";

  let matched: any = null;
  if (mentionedAmount) matched = walletDeps.find((t: any) => Math.abs(Number(t.amount) - mentionedAmount) < 0.01) ?? null;
  if (!matched && walletDeps.length > 0) matched = walletDeps[0];

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
    const missing: string[] = [];
    if (!mentionedAmount) missing.push("the amount you deposited");
    if (!mentionedTxId) missing.push("the approximate time of the payment");
    const ask = missing.length > 0 ? ` To help me investigate, could you share: ${missing.join(", ")}${!mentionedTxId ? ", and the Flutterwave transaction reference if you have it" : ""}?` : " Do you have the Flutterwave transaction reference or ID? I can verify it directly.";
    return { reply: `${empathy}I've checked your wallet, pending deposits, and payment records, and I couldn't find any deposit under your account.${ask} If you paid but no record exists on our side, I can create a support case for our team to reconcile it manually.`, actions_taken: ["no deposit records found"] };
  }

  const recentList = walletDeps.slice(0, 3).map((t: any) => `${fmtNGN(t.amount)} (${t.status}, ${relTime(t.created_at)})`).join("; ");
  return { reply: `${empathy}I checked your deposit history. Your most recent deposits are: ${recentList}. None of these match ${mentionedAmount ? fmtNGN(mentionedAmount) : "the amount you mentioned"}. Could you double-check the amount, or share the Flutterwave transaction reference?`, actions_taken: ["deposits exist, none matched"] };
}

async function handleNumberOrders(admin: ReturnType<typeof createClient>, userId: string): Promise<AgentResult> {
  const orders = await getNumberOrders(admin, userId);
  if (orders.length === 0) return { reply: "I checked your number orders and you don't have any yet. To buy a virtual number, go to 'Buy Numbers', pick a country and service, and choose an offer. Would you like help with anything specific?", actions_taken: ["no number orders found"] };

  const recent = orders.slice(0, 5);
  const lines = recent.map((o: any) => {
    const status = o.status === "waiting" ? "Waiting for SMS" : o.status === "received" ? "SMS received" : o.status === "failed" ? "Failed" : o.status === "canceled" ? "Canceled" : o.status;
    return `${o.service_name ?? "Unknown"} in ${o.country_name ?? "Unknown"} - ${o.phone_number ?? "pending"} - ${status} - ${relTime(o.created_at)}`;
  });

  const waiting = orders.filter((o: any) => o.status === "waiting");
  const received = orders.filter((o: any) => o.status === "received");

  let extra = "";
  if (waiting.length > 0) {
    const o: any = waiting[0];
    extra = `\n\nYou have ${waiting.length} number${waiting.length === 1 ? "" : "s"} waiting for SMS. The most recent is for ${o.service_name ?? "a service"} in ${o.country_name ?? "a country"} (${o.phone_number ?? "pending"}), placed ${relTime(o.created_at)}. OTP delivery usually takes 30 seconds to 2 minutes. If it's been more than 5 minutes, the service may be blocking virtual numbers - try a different country or offer.`;
  } else if (received.length > 0) {
    const o: any = received[0];
    extra = `\n\nYour most recent SMS was received for ${o.service_name ?? "a service"} - the code is on your Purchased Numbers page.`;
  }

  return {
    reply: `Here are your recent number orders:\n\n${lines.join("\n")}${extra}\n\nWould you like help with anything else?`,
    actions_taken: [`retrieved ${orders.length} number orders, ${waiting.length} waiting, ${received.length} received`],
  };
}

async function handleOtp(admin: ReturnType<typeof createClient>, userId: string): Promise<AgentResult> {
  const orders = await getNumberOrders(admin, userId);
  const waiting = orders.filter((o: any) => o.status === "waiting");
  if (waiting.length > 0) {
    const o: any = waiting[0];
    const codeInfo = o.sms_code ? `\n\nI can see a code has been received: ${o.sms_code}. You can also find it on your Purchased Numbers page.` : "";
    return { reply: `I see you have a number (${o.phone_number ?? "pending"}) waiting for an SMS for ${o.service_name ?? "your service"} in ${o.country_name ?? "your country"}, placed ${relTime(o.created_at)}. OTP delivery usually takes 30 seconds to 2 minutes.\n1. Make sure you entered the exact number on the service you're verifying.\n2. The Purchased Numbers page refreshes automatically.\n3. If it's been more than 5 minutes, the service may be blocking virtual numbers - try a different country or offer.${codeInfo}\n\nWould you like me to check if the number is still active?`, actions_taken: ["found waiting number order"] };
  }
  const received = orders.filter((o: any) => o.status === "received");
  if (received.length > 0) {
    const o: any = received[0];
    return { reply: `Your most recent number for ${o.service_name ?? "a service"} in ${o.country_name ?? "a country"} has already received an SMS${o.sms_code ? ` with code: ${o.sms_code}` : ""}. You can find all your received codes on the Purchased Numbers page. Do you need help with anything else?`, actions_taken: ["latest order already received"] };
  }
  return { reply: "For OTPs that haven't arrived:\n1. Go to 'Purchased Numbers' and confirm the number status is still 'Waiting' - if it shows 'Expired' or 'Canceled', you'll need a new number.\n2. Make sure you used the correct number on the service you're verifying.\n3. Some services block virtual numbers; try a different country or offer.\n4. OTP delivery typically takes 30 seconds to 2 minutes.\n\nIf you don't have an active number, you can buy one from the Buy Numbers page. Would you like help with that?", actions_taken: ["no waiting orders; provided OTP guidance"] };
}

async function handleVerifyPayment(msg: string, admin: ReturnType<typeof createClient>, userId: string): Promise<AgentResult> {
  const txId = extractTxId(msg);
  if (!txId) return { reply: "I can verify your Flutterwave payment directly. Could you share the Flutterwave transaction ID? It's a long number (usually 6+ digits) from your payment receipt.", actions_taken: ["asked for transaction id"] };
  const result: any = await verifyFlwPayment(userId, txId);
  if (result.verified) {
    const deposits = await getDeposits(admin, userId);
    const match = deposits.wallet.find((d: any) => d.reference === result.tx_ref);
    if (match && match.status === "completed") return { reply: `I verified your Flutterwave payment of ${fmtNGN(result.amount)} ${result.currency} (ref: ${result.tx_ref}). It's successful and your wallet was already credited. Would you like me to check your current balance?`, actions_taken: [`verified flutterwave tx=${txId}; wallet credit confirmed`] };
    return { reply: `I verified your Flutterwave payment of ${fmtNGN(result.amount)} ${result.currency} (ref: ${result.tx_ref}). Flutterwave confirms it as successful, but I don't see a matching credit in your wallet yet. This needs manual reconciliation. Would you like me to create a support case and escalate it?`, actions_taken: [`verified flutterwave tx=${txId}; no wallet credit - reconciliation gap`] };
  }
  if (result.reason === "not_owned") return { reply: "I wasn't able to verify that transaction because it doesn't appear to belong to your account. For security, I can only look up payments made from your own MONTEN SMS wallet. If you think this is an error, please contact human support.", actions_taken: [`tx=${txId} failed ownership check`] };
  if (result.reason === "not_successful") return { reply: `I checked that transaction with Flutterwave. Its status is "${result.flw_status}", which means the payment wasn't completed successfully. Your wallet wasn't credited. You can try funding again from the Fund Wallet page. If you believe this is wrong, I can escalate it.`, actions_taken: [`flutterwave tx=${txId} status=${result.flw_status}`] };
  return { reply: "I couldn't verify that payment right now. Could you double-check the transaction ID, or share the transaction reference as well? If the issue continues, I can create a support case.", actions_taken: [`flutterwave verify failed tx=${txId} reason=${result.reason}`] };
}

async function handleEscalate(msg: string, history: Turn[], authedClient: ReturnType<typeof createClient>): Promise<AgentResult> {
  const userMsgs = history.filter((h) => h.role === "user").map((h) => h.text);
  const lastUser = userMsgs[userMsgs.length - 1] ?? msg;
  const subject = lastUser.length > 120 ? lastUser.slice(0, 117) + "..." : lastUser;
  const contextSummary = history.slice(-8).map((h) => `${h.role === "user" ? "User" : "Assistant"}: ${h.text}`).join("\n").slice(0, 1200);
  const summary = `Summary of the user's complaint, with conversation context:\n${contextSummary}`;

  let ticket: any;
  try {
    const { data, error } = await authedClient.rpc("create_support_ticket", { p_subject: subject || "Support request", p_category: "general", p_priority: "normal", p_summary: summary });
    if (error) throw error;
    ticket = data;
  } catch (err) {
    console.error("[support-agent] ticket creation failed:", err instanceof Error ? err.message : err);
    return { reply: "I tried to create a support case for you but something went wrong on our side. You can reach our human team on Telegram at @montensmssupport or by email at support@montensms.com.", kind: "contact-human", actions_taken: ["ticket creation failed"] };
  }

  let escalated: any = null;
  try {
    const { data, error } = await authedClient.rpc("escalate_support_ticket", { p_ticket_id: ticket.id, p_conclusion: "User requested human escalation after AI troubleshooting." });
    if (!error) escalated = data;
  } catch (err) {
    console.error(`[support-agent] escalate failed ticket=${ticket.id}:`, err instanceof Error ? err.message : err);
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
  return `You are "Monten", the friendly and intelligent AI support assistant for MONTEN SMS (montensms.com).
${firstName ? `The person you are talking to is ${firstName}.` : ""} Today's date is ${today}.

HOW YOU COMMUNICATE:
- Speak like an experienced, warm human customer-care agent: friendly, patient, polite, never robotic or scripted.
- Adapt to the customer's emotion. If they are angry or frustrated, first acknowledge the feeling and sincerely apologize for the experience ("I'm really sorry you're dealing with this..."), stay calm, never argue, never blame the customer, and focus on fixing the problem. Offer to investigate their actual records.
- If they are confused or new, welcome them and explain step by step in simple language.
- Never make the customer repeat information you already have — check the account data below and the conversation history first.
- If a previous complaint exists in their history or account data, acknowledge it ("I can see you reported this before...").
- Keep replies concise (usually 2-6 sentences), in the customer's language (mostly English). Never reply with a list of canned questions unless genuinely offering choices.
- If you cannot resolve something after checking, apologize, summarize what you already checked, and offer to create/escalate a support case to the human team (Telegram @montensmssupport, support@montensms.com). Only claim escalation happened if a tool actually performed it.

HONESTY RULES (critical):
- Clearly separate VERIFIED information (from account data or web search results below) from possible causes ("this could be because...").
- NEVER invent balances, deposits, transaction statuses, delivery confirmations, outages or provider problems. If a fact isn't in your context, say so honestly.
- If you used web search, you may summarize what you found with source links. If you did not search, never pretend you did.

YOUR CAPABILITIES:
- Natural conversation: greetings, identity questions ("What is your name?", "How are you?"), small talk, follow-ups, misspellings, incomplete sentences.
- General knowledge questions.
- MONTEN SMS questions — use ONLY the knowledge base below.
- The customer's OWN account — use ONLY the live account data below.
- Web search (built-in) for current external information: OTP/service disruptions, telecom network problems, verification service outages. Prefer official provider announcements and reputable sources, and say how findings relate to the customer's issue.

MONTEN SMS KNOWLEDGE BASE:
- What it is: a platform for renting temporary virtual phone numbers to receive SMS verification codes (OTPs) for services like WhatsApp, Telegram, Gmail, TikTok, Instagram, Facebook, Discord and 700+ more across 190+ countries.
- Also offers an Email OTP service: rent a verified email to receive OTP codes.
- How to buy: Dashboard -> Buy Numbers -> pick a country -> search the service -> choose an offer -> Buy. The number appears on "Purchased Numbers"; the SMS/OTP code arrives there usually within 30 seconds to 2 minutes. Each number is for one service with a limited rental window.
- Wallet & deposits: fund with Flutterwave (card, bank transfer, USSD). Minimum deposit NGN 100. Wallet funds never expire.
- Pricing: numbers start from about NGN 50, varying by country and service; no subscription or hidden fees.
- Refunds: cancel before any SMS arrives, or the number times out with no SMS -> automatic wallet refund. System errors are reviewed by the human team.
- Registration & login: sign up with full name, username, email, password (min 6 chars). A 6-digit verification code is emailed and expires in 10 minutes; use "Resend code" if needed. Password reset uses the "Forgot password" link on the login page.
- Privacy & data: personal data is stored securely and never sold or shared; payments are processed by Flutterwave (licensed); account deletion is available on the Delete Account page. The full policies live at /privacy and /terms.
- Support: Telegram @montensmssupport, email support@montensms.com. The AI can create a tracked support case (ticket) and escalate to the human team.

THE USER'S LIVE ACCOUNT DATA (JSON; "null" = none/unknown. Treat as the only source of truth for their account):
${accountContext}

If a question needs very current world information you cannot verify, say what you know and note it may have changed.`;
}

async function buildAccountContext(admin: ReturnType<typeof createClient>, userId: string): Promise<string> {
  try {
    const [summary, txns, deposits, orders, tickets] = await Promise.all([
      getAccountSummary(admin, userId).catch(() => null),
      getTransactions(admin, userId, 8).catch(() => []),
      getDeposits(admin, userId).catch(() => ({ wallet: [], pending: [], webhook: [] })),
      getNumberOrders(admin, userId).catch(() => []),
      getSupportTickets(admin, userId).catch(() => []),
    ]);
    return JSON.stringify({
      profile: summary,
      recent_transactions: (txns as any[]).slice(0, 8),
      recent_deposits: (deposits.wallet as any[]).slice(0, 5),
      pending_payments: (deposits.pending as any[]).slice(0, 3),
      recent_number_orders: (orders as any[]).slice(0, 5),
      recent_support_tickets: (tickets as any[]).slice(0, 3),
    });
  } catch {
    return "{} (account data temporarily unavailable — do not invent any account details)";
  }
}

const lastDiag: Record<string, unknown> = {};

// Free-tier rate-limit safety: simple per-instance spacing between calls.
let lastCallAt = 0;
const MIN_CALL_GAP_MS = 1500;

async function callLLM(systemPrompt: string, turns: Turn[]): Promise<string | null> {
  if (!aiKey) {
    lastDiag.key = "missing";
    console.error("[support-agent] GEMINI_API_KEY not visible; fallback");
    return null;
  }
  lastDiag.key = "present";
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
    tools: [{ google_search: {} }],
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
      const errBody = await res.text().catch(() => "");
      lastDiag.status = res.status;
      lastDiag.error = errBody.slice(0, 300);
      console.error(`[support-agent] gemini failed status=${res.status} body=${errBody.slice(0, 300)}`);
      return null;
    }
    const data: any = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const text = parts.filter((p: any) => p.text).map((p: any) => p.text).join("").trim();
    if (text) return text;
    lastDiag.finish_reason = data?.candidates?.[0]?.finishReason ?? "empty";
    console.error(`[support-agent] gemini empty reply: ${JSON.stringify(lastDiag).slice(0, 200)}`);
    return null;
  } catch (err) {
    lastDiag.exception = err instanceof Error ? err.message.slice(0, 120) : "unknown";
    console.error("[support-agent] gemini call failed:", lastDiag.exception);
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
  const history: Turn[] = Array.isArray(body.history) ? body.history.slice(-12).map((h: any) => ({ role: h.role === "assistant" ? "assistant" : "user", text: String(h.text ?? "").slice(0, 500) })) : [];

  if (!message) {
    if (body.action === "history") {
      try {
        const conversationId = await getOrCreateConversation(admin, userId);
        const stored = await loadStoredHistory(admin, conversationId);
        const { data: metaRows } = await admin
          .from("support_messages")
          .select("role, content, meta, created_at")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true });
        const messages = (metaRows ?? []).map((m: any) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          text: String(m.content ?? ""),
          kind: m.meta?.kind,
          ticket: m.meta?.ticket,
          created_at: m.created_at,
        })).slice(-MAX_SAVED_LENGTH);
        return json({ messages });
      } catch (err) {
        console.error("[support-agent] history load failed:", err instanceof Error ? err.message : err);
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

  console.log(`[support-agent] user=${maskEmail(userEmail)} msg_len=${message.length}`);

  try {
    // Persistent memory: merge stored history from previous sessions with
    // what the client sent, then remember this exchange afterwards.
    let conversationId = "";
    let storedTurns: Turn[] = [];
    try {
      conversationId = await getOrCreateConversation(admin, userId);
      storedTurns = await loadStoredHistory(admin, conversationId);
    } catch (memErr) {
      console.error("[support-agent] memory load failed:", memErr instanceof Error ? memErr.message : memErr);
    }

    const storedTexts = new Set(storedTurns.map((t) => `${t.role}:${t.text.toLowerCase()}`));
    const freshTurns = history.filter((t) => !storedTexts.has(`${t.role}:${t.text.toLowerCase()}`));
    const fullHistory = [...storedTurns, ...freshTurns].slice(-24);

    let result: AgentResult;

    // Fast paths that need real actions or exact data: payment verification
    // and escalation. Everything else goes through the LLM for genuinely
    // intelligent replies; the rule engine is the fallback when no AI key is
    // configured or the model call fails.
    if (extractTxId(message) && (supportIntent(message) === "deposit_issue" || /verify.*(payment|transaction|flutterwave)/i.test(message))) {
      result = await handleVerifyPayment(message, admin, userId);
    } else if (supportIntent(message) === "escalate" || /^(yes|yeah|sure|ok|okay|please do|go ahead)\b/i.test(message) && /escalat|human|agent|support case/i.test(fullHistory.slice(-3).map((h) => h.text).join(" "))) {
      result = await handleEscalate(message, fullHistory, authedClient);
    } else {
      const [accountContext] = await Promise.all([buildAccountContext(admin, userId)]);
      const systemPrompt = buildSystemPrompt(accountContext, firstName);
      const llmReply = await callLLM(systemPrompt, [...fullHistory, { role: "user", text: message }]);
      if (llmReply) {
        result = { reply: llmReply.slice(0, 2000), actions_taken: ["llm", `model=${GEMINI_MODEL}`] };
      } else {
        const category = classify(message, fullHistory);
        result = category === "casual" ? casualReply(message, fullHistory, firstName) : await handleSupport(message, fullHistory, admin, authedClient, userId);
        result.actions_taken = [...(result.actions_taken ?? []), "ai_fallback", JSON.stringify(lastDiag).slice(0, 300)];
      }
    }

    if (conversationId) {
      await persistMessages(admin, conversationId, userId, message, result);
    }

    console.log(`[support-agent] reply sent user=${maskEmail(userEmail)} actions=${(result.actions_taken ?? []).join("|")}`);
    return json(result);
  } catch (err) {
    console.error(`[support-agent] error user=${maskEmail(userEmail)}:`, err instanceof Error ? err.message : err);
    return fail(500, "I ran into a problem looking that up. Please try again, or contact human support if it persists.");
  }
});
