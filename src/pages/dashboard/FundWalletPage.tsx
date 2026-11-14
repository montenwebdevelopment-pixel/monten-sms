import { useState, useRef } from "react";
import { Wallet, CreditCard, Building2, Smartphone, CircleCheck as CheckCircle, CircleAlert as AlertCircle, Loader as Loader2, Clock } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { supabase, EDGE_FUNCTION_BASE } from "../../lib/supabase";
import { formatNaira } from "../../lib/format";
import { Button, Card, Input } from "../../components/ui";
import { PageHeader } from "../../components/DashboardLayout";

const QUICK_AMOUNTS = [500, 1000, 2000, 5000, 10000, 20000];
const PAYMENT_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 20;

declare global {
  interface Window {
    FlutterwaveCheckout?: any;
  }
}

export function FundWalletPage() {
  const { profile, refreshProfile } = useAuth();
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);
  // Set only when the confirmation window closed without the deposit being
  // confirmed. Never treated as success: nothing told us the money landed.
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [creditedAmount, setCreditedAmount] = useState(0);
  const timeoutRef = useRef<number | null>(null);
  const modalOpenedRef = useRef(false);

  const clearTimeoutTimer = () => {
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
  };

  const handleFund = async () => {
    const amt = Number(amount.toString().replace(/,/g, ""));
    if (!amt || amt < 100) { setError("Minimum funding amount is ₦100"); return; }
    setError(""); setLoading(true); modalOpenedRef.current = false;

    let publicKey = "";

    try {
      const { data: session } = await supabase.auth.getSession();
      const resp = await fetch(`${EDGE_FUNCTION_BASE}/flutterwave-config`, {
        headers: {
          Authorization: `Bearer ${session.session?.access_token ?? ""}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
      });
      const data = await resp.json();
      publicKey = data.public_key;
    } catch { /* fall through to error below */ }

    if (!publicKey) {
      setError("Flutterwave public key is not configured. Please contact support.");
      setLoading(false);
      return;
    }

    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session?.user) { setError("Please sign in to continue"); setLoading(false); return; }

      // Dynamic, unique transaction reference per attempt. Never reused.
      const txRef = `MONTEN_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      // Amount must be a pure number — strip any thousands separators so the
      // gateway never receives a formatted string like "1,000".
      const cleanAmount = Number(amount.toString().replace(/,/g, ""));

      await loadFlutterwaveScript();

      timeoutRef.current = window.setTimeout(() => {
        if (!modalOpenedRef.current) {
          setError("Payment initialization timed out. Please check your connection and try again.");
          setLoading(false);
        }
      }, PAYMENT_TIMEOUT_MS);

      window.FlutterwaveCheckout({
        public_key: publicKey,
        tx_ref: txRef,
        amount: cleanAmount,
        currency: "NGN",
        payment_options: "card,banktransfer,ussd",
        customer: {
          email: session.session.user.email ?? "",
          name: profile?.full_name ?? "User",
        },
        customizations: { title: "MONTEN SMS", description: "Wallet Funding" },
        callback: async (data: any) => {
          clearTimeoutTimer();
          const txId = data.transaction_id;
          if (!txId || data.status === "error" || data.status === "failed") {
            console.error("[fund-wallet] payment rejected by gateway");
            setError("Payment was rejected by the gateway. Please contact support if you were charged.");
            setLoading(false);
            return;
          }
          try {
            const verifyResp = await fetch(`${EDGE_FUNCTION_BASE}/flutterwave-verify`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${session.session?.access_token}`,
                apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
              },
              body: JSON.stringify({ transactionId: txId, txRef }),
            });
            const verifyData = await verifyResp.json();
            if (!verifyResp.ok) {
              console.error("[fund-wallet] verification rejected", verifyResp.status);
              setError("We couldn't verify this payment. If you were charged, please contact support with your payment reference.");
              setLoading(false);
              return;
            }
            setCreditedAmount(verifyData.amount || amt);
            // Verification now credits the wallet server-side and returns
            // "credited". Reflect it immediately instead of waiting on a webhook.
            if (verifyData.status === "credited") {
              setLoading(false);
              setSuccess(true);
              refreshProfile();
              return;
            }
            // Older/edge cases that still report "pending": fall back to polling
            // the deposit record until the webhook confirms it.
            setPending(true);
            setLoading(false);
            pollForConfirmation(txId, txRef);
          } catch (err: any) {
            console.error("[fund-wallet] verification failed", err);
            setError("Payment verification failed. Please contact support if you were charged.");
            setLoading(false);
          }
        },
        onclose: () => {
          clearTimeoutTimer();
          setLoading(false);
        },
      });

      modalOpenedRef.current = true;
    } catch (err: any) {
      clearTimeoutTimer();
      console.error("[fund-wallet] payment initiation failed", err);
      setError("We couldn't start the payment. Please check your connection and try again.");
      setLoading(false);
    }
  };

  const loadFlutterwaveScript = (): Promise<void> => new Promise((resolve, reject) => {
    if (window.FlutterwaveCheckout) { resolve(); return; }
    const existing = document.querySelector('script[src="https://checkout.flutterwave.com/v3.js"]');
    if (existing) {
      if (window.FlutterwaveCheckout) { resolve(); return; }
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load payment gateway")));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.flutterwave.com/v3.js";
    script.async = true;
    script.onload = () => {
      if (window.FlutterwaveCheckout) resolve();
      else reject(new Error("Payment gateway loaded but FlutterwaveCheckout is not available"));
    };
    script.onerror = () => reject(new Error("Failed to load Flutterwave payment gateway. Check your internet connection."));
    document.body.appendChild(script);
  });

  const pollForConfirmation = async (txId: string, txRef: string) => {
    for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
      await new Promise<void>(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      try {
        const { data: deposit, error: pollError } = await supabase
          .from("pending_deposits")
          .select("status, amount")
          .eq("tx_ref", txRef)
          .maybeSingle();
        if (pollError || !deposit) continue;
        if (deposit.status === "credited") {
          setCreditedAmount(deposit.amount);
          setPending(false);
          setSuccess(true);
          refreshProfile();
          return;
        }
        if (deposit.status === "failed") {
          setPending(false);
          setError("Payment was not confirmed by Flutterwave. If you were charged, please contact support.");
          return;
        }
      } catch { /* continue polling */ }
    }
    // The window closed with no confirmation either way. The deposit may still
    // land, so refresh the balance but never claim the payment succeeded.
    setPending(false);
    setUnconfirmed(true);
    refreshProfile();
  };

  if (pending) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Fund Wallet" />
        <Card className="p-8 max-w-md mx-auto text-center">
          <div className="w-16 h-16 rounded-full bg-royal-100 flex items-center justify-center mx-auto mb-4">
            <Loader2 className="w-8 h-8 text-royal-600 animate-spin" />
          </div>
          <h2 className="text-xl font-bold text-navy-900 mb-2">Confirming Payment...</h2>
          <p className="text-sm text-slate-500 mb-4">Your payment of <span className="font-bold text-royal-600">{formatNaira(creditedAmount)}</span> has been received. We're waiting for Flutterwave to confirm the transaction before crediting your wallet.</p>
          <p className="text-xs text-slate-400">This usually takes a few seconds. Please don't close this page.</p>
        </Card>
      </div>
    );
  }

  if (unconfirmed) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Fund Wallet" />
        <Card className="p-8 max-w-md mx-auto text-center">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
            <Clock className="w-8 h-8 text-amber-600" />
          </div>
          <h2 className="text-xl font-bold text-navy-900 mb-2">Still confirming your payment</h2>
          <p className="text-sm text-slate-500 mb-4">
            We haven't had confirmation for your payment of <span className="font-bold text-navy-900">{formatNaira(creditedAmount)}</span> yet.
            Deposits usually clear within a few minutes and your balance updates automatically once it does.
          </p>
          <div className="bg-slate-50 rounded-lg p-4 mb-4"><p className="text-sm text-slate-500">Current Balance</p><p className="text-2xl font-bold text-navy-900">{formatNaira(profile?.wallet_balance ?? 0)}</p></div>
          <p className="text-xs text-slate-400 mb-4">If your balance hasn't changed shortly and you were charged, contact support with your payment reference.</p>
          <Button onClick={() => { setUnconfirmed(false); setAmount(""); refreshProfile(); }} className="w-full">Back to Fund Wallet</Button>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Fund Wallet" />
        <Card className="p-8 max-w-md mx-auto text-center">
          <div className="w-16 h-16 rounded-full bg-success-100 flex items-center justify-center mx-auto mb-4"><CheckCircle className="w-8 h-8 text-success-600" /></div>
          <h2 className="text-xl font-bold text-navy-900 mb-2">Payment Successful!</h2>
          <p className="text-sm text-slate-500 mb-4">Your wallet has been credited with <span className="font-bold text-success-600">{formatNaira(creditedAmount)}</span></p>
          <div className="bg-slate-50 rounded-lg p-4 mb-4"><p className="text-sm text-slate-500">New Balance</p><p className="text-2xl font-bold text-navy-900">{formatNaira(profile?.wallet_balance ?? 0)}</p></div>
          <Button onClick={() => { setSuccess(false); setAmount(""); }} className="w-full">Fund Again</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader title="Fund Wallet" subtitle="Add funds to your wallet using Flutterwave" />
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card className="p-6">
            <div className="bg-gradient-to-br from-navy-900 to-royal-800 rounded-xl p-5 mb-6">
              <div className="flex items-center gap-2 text-royal-200 text-xs font-medium mb-1"><Wallet className="w-3.5 h-3.5" /> Current Balance</div>
              <p className="text-3xl font-bold text-white">{formatNaira(profile?.wallet_balance ?? 0)}</p>
            </div>
            {error && <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-error-50 border border-error-200 text-error-700 text-sm"><AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /><span>{error}</span></div>}
            <Input value={amount} onChange={(v) => setAmount(v.replace(/[^0-9]/g, ""))} placeholder="Enter amount" type="text" />
            <div className="grid grid-cols-3 gap-2 mt-3">
              {QUICK_AMOUNTS.map(amt => <button key={amt} onClick={() => setAmount(String(amt))} className="py-2 px-3 rounded-lg border border-slate-200 hover:border-royal-400 hover:bg-royal-50 text-sm font-medium text-navy-900 transition-base">₦{amt.toLocaleString()}</button>)}
            </div>
            <Button onClick={handleFund} loading={loading} disabled={loading || !amount} className="w-full mt-6">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</> : <><Wallet className="w-4 h-4" /> Fund Wallet</>}
            </Button>
            <p className="text-xs text-slate-400 text-center mt-3">Minimum: ₦100 · Secure payment via Flutterwave</p>
          </Card>
        </div>
        <Card className="p-6">
          <h3 className="font-bold text-navy-900 mb-4">Payment Methods</h3>
          <div className="space-y-4">
            {[{ icon: <CreditCard className="w-5 h-5" />, title: "Card Payment", desc: "Pay with your debit or credit card", color: "bg-royal-100 text-royal-600" },
              { icon: <Building2 className="w-5 h-5" />, title: "Bank Transfer", desc: "Transfer directly from your bank", color: "bg-success-100 text-success-600" },
              { icon: <Smartphone className="w-5 h-5" />, title: "USSD", desc: "Pay using USSD code", color: "bg-warning-100 text-warning-600" }].map(m => (
              <div key={m.title} className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${m.color}`}>{m.icon}</div>
                <div><p className="text-sm font-semibold text-navy-900">{m.title}</p><p className="text-xs text-slate-500">{m.desc}</p></div>
              </div>
            ))}
          </div>
          <div className="mt-6 p-3 rounded-lg bg-slate-50"><p className="text-xs text-slate-500">Your wallet is credited instantly after successful payment. All transactions are secure and encrypted.</p></div>
        </Card>
      </div>
    </div>
  );
}
