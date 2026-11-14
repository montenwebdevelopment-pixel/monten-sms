import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const FLW_SECRET_KEY = Deno.env.get("FLWSECK") ?? "";
const FLW_SECRET_HASH = Deno.env.get("FLW_SECRET_HASH") ?? "";
const FLW_BASE_URL = "https://api.flutterwave.com/v3";

if (!FLW_SECRET_KEY) console.error("[flutterwave-webhook] WARNING: FLWSECK is not configured — transaction verification will fail");
if (!FLW_SECRET_HASH) console.error("[flutterwave-webhook] WARNING: FLW_SECRET_HASH is not configured — webhook signature verification is disabled");

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    console.log("[flutterwave-webhook] webhook received");
    // 1. Verify webhook signature (verif-hash header)
    const verifHash = req.headers.get("verif-hash") ?? "";
    // Always acknowledge delivery with HTTP 200 so Flutterwave does not mark it
    // as a failed delivery and retry forever. A failed signature check simply
    // means we do not process/credit; every payment is independently
    // re-verified against Flutterwave's API below before any wallet is touched.
    if (!FLW_SECRET_HASH) {
      console.error("[flutterwave-webhook] FLW_SECRET_HASH not configured; acknowledging without processing");
      return jsonResponse({ status: "acknowledged", reason: "secret not configured" }, 200);
    }
    if (!verifHash || verifHash !== FLW_SECRET_HASH) {
      console.error("[flutterwave-webhook] verif-hash mismatch; acknowledging without processing");
      return jsonResponse({ status: "acknowledged", reason: "invalid signature" }, 200);
    }

    // 2. Parse payload
    const payload = await req.json();
    const event = payload?.event;
    const data = payload?.data;

    if (event !== "charge.completed") {
      return jsonResponse({ status: "ignored", event });
    }

    const txRef = data?.tx_ref;
    const flwRef = data?.flw_ref;
    const transactionId = data?.id;
    const status = data?.status;
    const paymentType = data?.payment_type;
    const customerEmail = data?.customer?.email ?? "";

    if (!transactionId || status !== "successful") {
      return jsonResponse({ status: "ignored", reason: "not successful" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 3. Dedup: check if this Flutterwave transaction was already processed
    const { data: existing } = await supabase
      .from("webhook_deposits")
      .select("id, status")
      .eq("flw_transaction_id", String(transactionId))
      .maybeSingle();

    if (existing?.status === "credited") {
      console.log("[flutterwave-webhook] duplicate transaction already credited");
      return jsonResponse({ status: "duplicate", reason: "already credited" });
    }

    // 4. Re-verify the transaction with Flutterwave's v3 API
    const verifyResp = await fetch(`${FLW_BASE_URL}/transactions/${transactionId}/verify`, {
      headers: { Authorization: `Bearer ${FLW_SECRET_KEY}`, "Content-Type": "application/json" },
    });

    if (!verifyResp.ok) {
      console.error("[flutterwave-webhook] verification request failed", verifyResp.status);
      return jsonResponse({ status: "acknowledged", reason: "verification failed" }, 200);
    }

    const verifyData = await verifyResp.json();

    if (verifyData.status !== "success" || verifyData.data.status !== "successful") {
      console.error("[flutterwave-webhook] payment not confirmed by API");
      return jsonResponse({ status: "ignored", reason: "payment not confirmed by API" });
    }

    const verifiedAmount = Number(verifyData.data.amount);
    const currency = verifyData.data.currency;
    const verifiedTxRef = String(verifyData.data.tx_ref || txRef || "");
    const verifiedEmail = verifyData.data.customer?.email ?? customerEmail;

    console.log("[flutterwave-webhook] transaction verified");

    if (currency !== "NGN") {
      console.error("[flutterwave-webhook] refusing unsupported currency");
      return jsonResponse({ status: "ignored", reason: "unsupported currency" });
    }

    if (!Number.isFinite(verifiedAmount) || verifiedAmount < 100) {
      return jsonResponse({ status: "ignored", reason: "invalid amount" });
    }

    // 5. Identify the MONTEN-SMS user.
    //    The destination wallet must never be chosen from a string the payer
    //    composed, so the session-derived record is tried first and each
    //    weaker fallback has to resolve to exactly one account or refuse.
    let userId: string | null = null;

    //    First: the pending_deposits row written by flutterwave-verify, whose
    //    user_id came from a verified access token. This is authoritative.
    //    Two rows can share a tx_ref, so resolve explicitly instead of letting
    //    maybeSingle() collapse ambiguity into a silent null.
    if (verifiedTxRef) {
      const { data: pendingRows, error: pendingLookupError } = await supabase
        .from("pending_deposits")
        .select("user_id")
        .eq("tx_ref", verifiedTxRef)
        .limit(2);
      if (pendingLookupError) {
        console.error("[flutterwave-webhook] pending_deposits lookup failed", pendingLookupError.code ?? "unknown");
      } else if (pendingRows && pendingRows.length === 1 && pendingRows[0].user_id) {
        userId = pendingRows[0].user_id as string;
      } else if (pendingRows && pendingRows.length > 1) {
        console.error("[flutterwave-webhook] ambiguous transaction reference; refusing to guess a wallet");
        return jsonResponse({ status: "ignored", reason: "ambiguous reference" });
      }
    }

    //    Second: the confirmed account holding the payer's email address.
    //    Resolved against the auth user record, which is where email actually
    //    lives; returns null unless exactly one confirmed account matches.
    if (!userId && verifiedEmail) {
      const { data: resolvedId, error: resolveError } = await supabase.rpc(
        "resolve_deposit_user_by_email",
        { p_email: verifiedEmail }
      );
      if (resolveError) {
        console.error("[flutterwave-webhook] email resolve failed", resolveError.code ?? "unknown");
      } else if (resolvedId) {
        userId = resolvedId as string;
      }
    }

    //    Third: no longer applicable. The new tx_ref format (MONTEN_<ts>_<rand>)
    //    does not embed a user id prefix, so there is nothing to match against.
    //    The email-resolution path above is the fallback when no pending row exists.

    if (!userId) {
      console.error("[flutterwave-webhook] could not identify payment owner");
      return jsonResponse({ status: "ignored", reason: "user not identified" });
    }

    console.log("[flutterwave-webhook] payment owner identified");

    // 6. Create or update webhook_deposits row (dedup via unique flw_transaction_id)
    const { error: upsertErr } = await supabase
      .from("webhook_deposits")
      .upsert({
        flw_transaction_id: String(transactionId),
        tx_ref: verifiedTxRef,
        flw_ref: flwRef,
        user_id: userId,
        amount: verifiedAmount,
        currency: currency || "",
        payment_type: paymentType || "",
        status: "pending",
      }, { onConflict: "flw_transaction_id" });

    if (upsertErr) {
      console.error("[flutterwave-webhook] deposit record failed", upsertErr.code ?? "unknown");
      return jsonResponse({ status: "acknowledged", reason: "record failed" }, 200);
    }

    // 7. Credit the wallet via the existing credit_wallet RPC
    //    credit_wallet has built-in dedup: it checks transactions.reference
    //    for an existing completed entry before crediting.
    const creditReference = verifiedTxRef || `flw-${transactionId}`;

    const { data: creditedTxId, error: rpcErr } = await supabase.rpc("credit_wallet", {
      p_user_id: userId,
      p_amount: verifiedAmount,
      p_reference: creditReference,
      p_description: `Flutterwave deposit (${currency || ""})`,
    });

    if (rpcErr || !creditedTxId) {
      console.error("[flutterwave-webhook] credit_wallet failed", rpcErr?.code ?? "unknown");
      await supabase
        .from("webhook_deposits")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("flw_transaction_id", String(transactionId));
      return jsonResponse({ status: "acknowledged", reason: "credit failed" }, 200);
    }

    // 8. Mark webhook deposit as credited
    await supabase
      .from("webhook_deposits")
      .update({
        status: "credited",
        credited_tx_id: creditedTxId,
        updated_at: new Date().toISOString(),
      })
      .eq("flw_transaction_id", String(transactionId));

    // Also update pending_deposits if it exists (for the checkout flow)
    if (verifiedTxRef) {
      await supabase
        .from("pending_deposits")
        .update({ status: "credited", updated_at: new Date().toISOString() })
        .eq("tx_ref", verifiedTxRef);
    }

    console.log("[flutterwave-webhook] wallet credited");

    return jsonResponse({ status: "success" });
  } catch (err) {
    console.error("[flutterwave-webhook] unhandled error", err instanceof Error ? err.name : "unknown");
    return jsonResponse({ status: "acknowledged", reason: "internal error" }, 200);
  }
});
