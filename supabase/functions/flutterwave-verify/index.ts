import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const FLW_SECRET_KEY = Deno.env.get("FLWSECK") ?? "";
const FLW_BASE_URL = "https://api.flutterwave.com/v3";

if (!FLW_SECRET_KEY) console.error("[flutterwave-verify] WARNING: FLWSECK is not configured — transaction verification will fail");

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
    // Only the transaction id is taken from the caller. The reference this
    // deposit is filed under comes from Flutterwave's verify response below,
    // so the credit is keyed on a server-confirmed value, never a client one.
    const { transactionId } = body;

    if (!transactionId) return errorResponse(400, "Transaction ID is required");
    if (!/^\d+$/.test(String(transactionId))) return errorResponse(400, "Invalid transaction ID format");
    if (!FLW_SECRET_KEY) {
      console.error("[flutterwave-verify] FLWSECK secret key is not configured");
      return errorResponse(500, "Payment gateway is not configured. Please contact support.");
    }

    console.log(`[flutterwave-verify] verification requested tx=${transactionId} user=${userId}`);

    // Verify the transaction directly with Flutterwave. The wallet is NEVER
    // credited on the strength of the client saying the payment worked.
    const verifyResp = await fetch(`${FLW_BASE_URL}/transactions/${transactionId}/verify`, {
      headers: { Authorization: `Bearer ${FLW_SECRET_KEY}`, "Content-Type": "application/json" },
    });

    if (!verifyResp.ok) {
      const errBody = await verifyResp.text();
      console.error(`[flutterwave-verify] Flutterwave verify HTTP ${verifyResp.status} tx=${transactionId} body=${errBody}`);
      return errorResponse(502, "Flutterwave verification failed");
    }

    const verifyData = await verifyResp.json();

    if (verifyData.status !== "success" || verifyData.data?.status !== "successful") {
      console.error(`[flutterwave-verify] payment not successful tx=${transactionId} status=${verifyData.data?.status}`);
      return errorResponse(400, "Payment was not successful");
    }

    const verifiedAmount = Number(verifyData.data.amount);
    const currency = verifyData.data.currency;

    if (currency !== "NGN") return errorResponse(400, "Only NGN payments are supported");
    if (!Number.isFinite(verifiedAmount) || verifiedAmount < 100) return errorResponse(400, "Invalid payment amount (minimum ₦100)");

    const verifiedTxRef = String(verifyData.data.tx_ref || "");
    // The reference we generate (MONTEN_<timestamp>_<rand>) no longer embeds
    // the user id. Ownership is proven by matching the payer's email to the
    // authenticated caller's email — the one Flutterwave confirmed on charge.
    const verifiedEmail = String(verifyData.data.customer?.email ?? "").toLowerCase();
    if (!verifiedEmail || verifiedEmail !== userEmail.toLowerCase()) {
      console.error(`[flutterwave-verify] customer email mismatch tx=${transactionId} ref=${verifiedTxRef} payer=${verifiedEmail} caller=${userEmail}`);
      return errorResponse(403, "Transaction does not belong to this user");
    }

    console.log(`[flutterwave-verify] transaction verified tx=${transactionId} ref=${verifiedTxRef} amount=${verifiedAmount} user=${userId}`);

    // Record the deposit. Written with the service-role client: the browser has
    // no write grant on this table and the user id comes from the verified token.
    const { error: pendingError } = await supabaseAdmin.from("pending_deposits").upsert({
      user_id: userId,
      transaction_id: String(transactionId),
      amount: verifiedAmount,
      tx_ref: verifiedTxRef,
      status: "pending",
    }, { onConflict: "transaction_id" });

    if (pendingError) {
      console.error(`[flutterwave-verify] failed to record pending deposit tx=${transactionId}: ${pendingError.message}`);
      return errorResponse(500, "Failed to record transaction");
    }

    // Credit the wallet now, from the server, using the confirmed reference.
    // credit_wallet is idempotent: transactions.reference is UNIQUE and the
    // function returns the existing transaction id if this reference was
    // already credited, so the webhook firing later can never double-credit.
    const { data: creditedTxId, error: creditError } = await supabaseAdmin.rpc("credit_wallet", {
      p_user_id: userId,
      p_amount: verifiedAmount,
      p_reference: verifiedTxRef,
      p_description: `Flutterwave deposit (${currency})`,
    });

    if (creditError || !creditedTxId) {
      console.error(`[flutterwave-verify] credit_wallet failed tx=${transactionId} ref=${verifiedTxRef}: ${creditError?.message ?? "no credited transaction returned"}`);
      return errorResponse(500, "Failed to credit wallet");
    }

    // Mark the deposit credited for the polling path and the webhook dedup.
    await supabaseAdmin
      .from("pending_deposits")
      .update({ status: "credited", updated_at: new Date().toISOString() })
      .eq("tx_ref", verifiedTxRef);

    const { data: profileRow } = await supabaseAdmin
      .from("profiles")
      .select("wallet_balance")
      .eq("id", userId)
      .maybeSingle();

    console.log(`[flutterwave-verify] wallet credited tx=${transactionId} ref=${verifiedTxRef} amount=${verifiedAmount} user=${userId} credit_tx=${creditedTxId}`);

    return jsonResponse({
      success: true,
      status: "credited",
      amount: verifiedAmount,
      balance: profileRow?.wallet_balance ?? null,
      message: "Payment verified and your wallet has been credited.",
    });
  } catch (err) {
    console.error("[flutterwave-verify] Unhandled error:", err);
    return errorResponse(500, "Internal server error");
  }
});
