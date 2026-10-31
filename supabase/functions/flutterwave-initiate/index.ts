import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const FLW_SECRET_KEY = Deno.env.get("FLWSECK") ?? "";
const FLW_ENCRYPTION_KEY = Deno.env.get("FLW_ENCRYPTION_KEY") ?? "";
const FLW_BASE_URL = "https://api.flutterwave.com/v3";

if (!FLW_SECRET_KEY) console.error("[flutterwave-initiate] WARNING: FLWSECK is not configured — payment initiation will fail");
if (!FLW_ENCRYPTION_KEY) console.error("[flutterwave-initiate] WARNING: FLW_ENCRYPTION_KEY is not configured — encrypted charges will be unavailable");

// Only these origins may be used as the post-payment redirect target. Without
// an allowlist, any caller could mint a genuine Flutterwave payment link,
// branded as MONTEN SMS, that lands the payer on a site of their choosing.
const ALLOWED_REDIRECT_ORIGINS = [
  "https://montensms.com",
  "https://www.montensms.com",
];

function isAllowedRedirect(rawUrl: unknown): boolean {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (ALLOWED_REDIRECT_ORIGINS.includes(parsed.origin)) return true;
  // Local development hosts, http or https, any port.
  return (
    (parsed.protocol === "http:" || parsed.protocol === "https:") &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
  );
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse(401, "Unauthorized");

    const token = authHeader.replace("Bearer ", "");
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData.user) return errorResponse(401, "Invalid token");
    const userId = userData.user.id;
    const userEmail = userData.user.email ?? "";

    const body = await req.json();
    const { amount, redirect_url } = body;

    if (!FLW_SECRET_KEY) {
      console.error("[flutterwave-initiate] FLWSECK secret key is not configured");
      return errorResponse(500, "Payment gateway is not configured. Please contact support.");
    }
    if (!amount || amount < 100) return errorResponse(400, "Minimum funding amount is ₦100");
    if (!redirect_url) return errorResponse(400, "Redirect URL is required");
    if (!isAllowedRedirect(redirect_url)) return errorResponse(400, "Redirect URL is not allowed");

    // Dynamic, unique transaction reference per attempt. Never reused or hardcoded.
    const txRef = `MONTEN_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    // Amount must be a pure number — strip any thousands separators so the
    // gateway never receives a formatted string like "1,000".
    const cleanAmount = Number(String(amount).replace(/,/g, ""));

    const initiateResp = await fetch(`${FLW_BASE_URL}/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FLW_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tx_ref: txRef,
        amount: cleanAmount,
        currency: "NGN",
        payment_options: "card,banktransfer,ussd",
        redirect_url,
        customer: {
          email: userEmail,
          name: userData.user.user_metadata?.full_name ?? "MONTEN User",
        },
        customizations: {
          title: "MONTEN SMS",
          description: "Wallet Funding",
        },
      }),
    });

    const initiateData = await initiateResp.json();

    if (!initiateResp.ok || initiateData.status !== "success" || !initiateData.data?.link) {
      // Log the full error response so parameter errors are easy to diagnose.
      console.error("[flutterwave-initiate] gateway rejected request", {
        status: initiateResp.status,
        body: initiateData,
        txRef,
        amount: cleanAmount,
        customerEmail: userEmail,
      });
      return errorResponse(initiateResp.status, initiateData.message || "Failed to create payment link");
    }

    return jsonResponse({ payment_link: initiateData.data.link, tx_ref: txRef });
  } catch (err) {
    console.error("[flutterwave-initiate] Error:", err);
    return errorResponse(500, "Internal server error");
  }
});
