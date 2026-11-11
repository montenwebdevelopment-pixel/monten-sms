import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Mail, Search, Loader as Loader2, CircleCheck as CheckCircle, Clock, Copy, Check,
  RefreshCw, CircleAlert as AlertCircle, ShoppingBag, Inbox, RotateCcw, X, ArrowRight, History,
} from "lucide-react";
import { supabase, EDGE_FUNCTION_BASE } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { formatNaira } from "../../lib/format";
import { copyToClipboard, notifyOtpReceived } from "../../lib/native";
import { Button, Card, Input, EmptyState } from "../../components/ui";
import { PageHeader } from "../../components/DashboardLayout";

interface EmailOtpCode {
  code: string;
  sender: string | null;
  subject: string | null;
  receivedAt: string;
  wasFreeRepeat: boolean;
}

interface EmailOtpOrder {
  id: string;
  service: string;
  site: string | null;
  email: string | null;
  status: "waiting" | "received" | "timeout" | "cancelled" | "failed" | "charged_free" | "expired";
  charge: number;
  providerCostUsd: number | null;
  createdAt: string;
  expiresAt: string | null;
  lastCodeAt: string | null;
  codes: EmailOtpCode[];
}

interface CatalogService {
  slug: string;
  name: string;
  category?: string;
  providerUsd: number;
  ttlSec: number;
  priceNaira: number;
}

function newIdempotencyKey(): string {
  return `mo_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

const POPULAR_SLUGS = new Set(["instagram", "facebook", "tiktok", "x", "threads", "snapchat", "reddit", "pinterest", "quora", "medium", "substack", "tumblr"]);

export function EmailOtpPage() {
  const { profile, refreshProfile } = useAuth();
  const [view, setView] = useState<"buy" | "orders">("buy");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const [services, setServices] = useState<CatalogService[]>([]);
  const [serviceSearch, setServiceSearch] = useState("");
  const [servicesLoading, setServicesLoading] = useState(true);
  const [servicesError, setServicesError] = useState("");
  const [totalStock, setTotalStock] = useState<number | null>(null);
  const [orders, setOrders] = useState<EmailOtpOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  const [buying, setBuying] = useState<string | null>(null);
  const [resending, setResending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [activeOrder, setActiveOrder] = useState<EmailOtpOrder | null>(null);
  const [emailCopied, setEmailCopied] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState("");
  const [resendQuote, setResendQuote] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const lastRefreshRef = useRef(0);
  const pollRef = useRef<number | null>(null);
  const pollTargetRef = useRef<string | null>(null);

  useEffect(() => () => { if (pollRef.current) window.clearInterval(pollRef.current); }, []);

  const getHeaders = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return {
      Authorization: `Bearer ${data.session?.access_token ?? ""}`,
      "Content-Type": "application/json",
    };
  }, []);

  const fetchServices = useCallback(async () => {
    setServicesLoading(true);
    setServicesError("");
    try {
      const headers = await getHeaders();
      const resp = await fetch(`${EDGE_FUNCTION_BASE}/mailotp-proxy/services`, { headers });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        console.error("[email-otp] services request failed", resp.status, body?.error);
        setServicesError(body?.error ?? "We couldn't load the email services right now. Please try again in a moment.");
        setServices([]);
        return;
      }
      setServices(Array.isArray(body.services) ? body.services : []);
      setTotalStock(typeof body.totalStock === "number" ? body.totalStock : null);
      if (!Array.isArray(body.services) || body.services.length === 0) {
        setServicesError("The email service catalog is temporarily empty. Please try again in a moment.");
      }
    } catch (err) {
      console.error("[email-otp] services request failed", err);
      setServicesError("We couldn't load the email services. Please check your connection and try again.");
      setServices([]);
    } finally {
      setServicesLoading(false);
    }
  }, [getHeaders]);

  const fetchOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const headers = await getHeaders();
      const resp = await fetch(`${EDGE_FUNCTION_BASE}/mailotp-proxy/orders`, { headers });
      const body = await resp.json().catch(() => ({}));
      if (resp.ok && Array.isArray(body.orders)) setOrders(body.orders);
    } catch (err) {
      console.error("[email-otp] orders request failed", err);
    } finally {
      setOrdersLoading(false);
    }
  }, [getHeaders]);

  useEffect(() => { fetchServices(); }, [fetchServices]);
  useEffect(() => { if (view === "orders") fetchOrders(); }, [view, fetchOrders]);

  const stopPolling = () => {
    if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
    pollTargetRef.current = null;
  };

  const pollOnce = useCallback(async (orderId: string, wait: number) => {
    try {
      const headers = await getHeaders();
      const resp = await fetch(`${EDGE_FUNCTION_BASE}/mailotp-proxy/poll/${orderId}?wait=${wait}`, { headers });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        if (body?.code === "not_found") {
          // Provider deleted the task (>180 days). Refresh from orders view.
          stopPolling();
          setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: "failed" } : o)));
          if (activeOrder?.id === orderId) setActiveOrder((prev) => (prev && prev.id === orderId ? { ...prev, status: "failed" } : prev));
          refreshProfile();
          return true;
        }
        return false;
      }
      if (body.order) {
        setActiveOrder((prev) => (prev && prev.id === body.order.id ? body.order : prev));
        if (body.order.status !== "waiting") {
          stopPolling();
          refreshProfile();
          if (body.justRefunded) setNotice("Order expired – refund processing. Your wallet has been refunded.");
        }
        if (body.order.codes?.length > 0) {
          notifyOtpReceived();
        }
      }
      return true;
    } catch {
      return false;
    }
  }, [getHeaders, activeOrder?.id, refreshProfile]);

  const startPolling = useCallback((orderId: string) => {
    stopPolling();
    pollTargetRef.current = orderId;
    pollRef.current = window.setInterval(() => {
      void pollOnce(orderId, 5);
    }, 5000);
    void pollOnce(orderId, 10);
  }, [pollOnce]);

  const handleBuy = async (service: CatalogService) => {
    if ((profile?.wallet_balance ?? 0) < service.priceNaira) {
      setError("Insufficient wallet balance. Please fund your wallet first.");
      return;
    }
    setBuying(service.slug);
    setError("");
    setNotice("");
    try {
      const headers = await getHeaders();
      const resp = await fetch(`${EDGE_FUNCTION_BASE}/mailotp-proxy/buy`, {
        method: "POST", headers,
        body: JSON.stringify({ service: service.slug, idempotencyKey: newIdempotencyKey() }),
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        console.error("[email-otp] purchase rejected", resp.status, body?.error);
        setError(body?.error ?? "We couldn't complete this order. Your wallet has not been charged.");
        return;
      }
      setActiveOrder(body.order);
      refreshProfile();
      startPolling(body.order.id);
    } catch (err) {
      console.error("[email-otp] purchase failed", err);
      setError("We couldn't complete this order. Please try again in a moment.");
    } finally {
      setBuying(null);
    }
  };

  const handleAgain = async (order: EmailOtpOrder) => {
    setResending(order.id);
    setError("");
    setNotice("");
    try {
      const headers = await getHeaders();
      const resp = await fetch(`${EDGE_FUNCTION_BASE}/mailotp-proxy/again`, {
        method: "POST", headers,
        body: JSON.stringify({ orderId: order.id, idempotencyKey: newIdempotencyKey() }),
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setError(body?.error ?? "We couldn't reopen this address. Please try again in a moment.");
        return;
      }
      setActiveOrder(body.order);
      refreshProfile();
      startPolling(body.order.id);
    } catch (err) {
      console.error("[email-otp] resend failed", err);
      setError("We couldn't reopen this address. Please try again in a moment.");
    } finally {
      setResending(null);
    }
  };

  const handleResend = async () => {
    if (!activeOrder) return;
    setRefreshMsg("");
    await handleAgain(activeOrder);
  };

  const fetchResendQuote = useCallback(async (orderId: string) => {
    setResendQuote(null);
    try {
      const headers = await getHeaders();
      const resp = await fetch(`${EDGE_FUNCTION_BASE}/mailotp-proxy/again-quote/${orderId}`, { headers });
      const body = await resp.json().catch(() => ({}));
      if (resp.ok && typeof body.priceNaira === "number") setResendQuote(body.priceNaira);
    } catch {
      // quote is advisory; the resend itself always settles the provider's true price
    }
  }, [getHeaders]);

  useEffect(() => {
    if (!activeOrder) { setResendQuote(null); setRefreshMsg(""); return; }
    if (["received", "timeout", "charged_free", "expired"].includes(activeOrder.status)) void fetchResendQuote(activeOrder.id);
  }, [activeOrder, fetchResendQuote]);

  const handleRefresh = async () => {
    if (!activeOrder || refreshing) return;
    if (Date.now() - lastRefreshRef.current < 3000) return;
    lastRefreshRef.current = Date.now();
    setRefreshing(true);
    setRefreshMsg("");
    try {
      const headers = await getHeaders();
      const resp = await fetch(`${EDGE_FUNCTION_BASE}/mailotp-proxy/refresh/${activeOrder.id}`, { headers });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setRefreshMsg(body?.error ?? "Couldn't check for a new code. Please try again in a moment.");
        return;
      }
      if (body.order) {
        setActiveOrder(body.order);
        if (body.hasNewCode) {
          notifyOtpReceived();
          if (body.order.status !== "waiting") refreshProfile();
        } else {
          setRefreshMsg("No SMS received yet. Please try again.");
        }
      } else {
        setRefreshMsg("No SMS received yet. Please try again.");
      }
    } catch {
      setRefreshMsg("Couldn't check for a new code. Please try again in a moment.");
    } finally {
      setRefreshing(false);
    }
  };

  const handleCancelStart = (order: EmailOtpOrder) => {
    setConfirmCancelId(order.id);
  };

  const handleCancelConfirm = async (order: EmailOtpOrder) => {
    if (cancelling) return;
    setConfirmCancelId(null);
    setCancelling(order.id);
    setError("");
    setNotice("");
    try {
      const headers = await getHeaders();
      const resp = await fetch(`${EDGE_FUNCTION_BASE}/mailotp-proxy/cancel/${order.id}`, { method: "POST", headers });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setError(body?.error ?? "We couldn't cancel this order. Please try again in a moment.");
        return;
      }
      setActiveOrder(body.order);
      setOrders((prev) => prev.map((o) => (o.id === order.id ? body.order : o)));
      stopPolling();
      refreshProfile();
      setNotice(body.order.charge > 0 ? `Order cancelled — ${formatNaira(body.order.charge)} has been refunded to your wallet.` : "Order cancelled.");
    } catch {
      setError("We couldn't cancel this order. Please try again in a moment.");
    } finally {
      setCancelling(null);
    }
  };

  const handleCopyEmail = () => {
    if (!activeOrder?.email) return;
    copyToClipboard(activeOrder.email);
    setEmailCopied(true);
    setTimeout(() => setEmailCopied(false), 2000);
  };

  const handleCopyCode = (code: string) => {
    copyToClipboard(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const filteredServices = services.filter(
    (s) => s.name.toLowerCase().includes(serviceSearch.toLowerCase()) || s.slug.toLowerCase().includes(serviceSearch.toLowerCase())
  );
  const popular = filteredServices.filter((s) => POPULAR_SLUGS.has(s.slug));
  const rest = filteredServices.filter((s) => !POPULAR_SLUGS.has(s.slug));

  const statusLabel: Record<string, string> = {
    waiting: "Waiting", received: "Code received", timeout: "Timed out",
    cancelled: "Cancelled", failed: "Failed", charged_free: "No code",
    expired: "Expired – refunded",
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title="Email Purchase" subtitle="Buy a real email address and receive verification codes" />

      <div className="flex items-center gap-2 mb-5">
        <button
          onClick={() => setView("buy")}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-base ${view === "buy" ? "bg-royal-600 text-white" : "bg-white border border-slate-200 text-slate-600 hover:border-royal-300"}`}
        >
          <Mail className="w-4 h-4" /> Buy Address
        </button>
        <button
          onClick={() => setView("orders")}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-base ${view === "orders" ? "bg-royal-600 text-white" : "bg-white border border-slate-200 text-slate-600 hover:border-royal-300"}`}
        >
          <History className="w-4 h-4" /> My Orders
        </button>
      </div>

      {error && <div className="mb-4 p-3 rounded-lg bg-error-50 border border-error-200 text-error-700 text-sm">{error}</div>}
      {notice && <div className="mb-4 p-3 rounded-lg bg-warning-50 border border-warning-200 text-warning-700 text-sm">{notice}</div>}

      {view === "buy" && (
        <>
          {activeOrder ? (
            <EmailOtpResultCard
              order={activeOrder}
              emailCopied={emailCopied}
              copiedCode={copiedCode}
              onCopyEmail={handleCopyEmail}
              onCopyCode={handleCopyCode}
              onResend={handleResend}
              resending={resending === activeOrder.id}
              resendPrice={resendQuote}
              onRefresh={handleRefresh}
              refreshing={refreshing}
              refreshMsg={refreshMsg}
              now={now}
              cancelStage={cancelling === activeOrder.id ? "working" : confirmCancelId === activeOrder.id ? "confirm" : "idle"}
              onCancelStart={() => handleCancelStart(activeOrder)}
              onCancelConfirm={() => handleCancelConfirm(activeOrder)}
              onCancelDismiss={() => setConfirmCancelId(null)}
              onClose={() => { stopPolling(); setConfirmCancelId(null); setActiveOrder(null); }}
            />
          ) : (
            <Card className="p-6">
              <div className="flex items-center gap-2 mb-2"><Inbox className="w-5 h-5 text-royal-600" /><h2 className="font-bold text-navy-900">Choose a Service</h2></div>
              <p className="text-sm text-slate-500 mb-4">Pick the platform you need an email verification code for. You'll get a real email address to use at signup.{totalStock !== null && totalStock > 0 ? ` ${totalStock.toLocaleString()} mailboxes ready.` : ""}</p>
              {servicesLoading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="w-6 h-6 text-royal-600 animate-spin" />
                  <p className="text-sm text-slate-500">Loading services...</p>
                </div>
              ) : servicesError ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-2 p-3 bg-error-50 border border-error-200 rounded-lg">
                    <AlertCircle className="w-4 h-4 text-error-600 mt-0.5 shrink-0" />
                    <p className="text-sm font-medium text-error-700">{servicesError}</p>
                  </div>
                  <button onClick={() => fetchServices()} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-royal-700 bg-royal-50 rounded-lg hover:bg-royal-100 transition-colors">
                    <RefreshCw className="w-4 h-4" /> Retry
                  </button>
                </div>
              ) : services.length === 0 ? (
                <EmptyState icon={<Inbox className="w-7 h-7" />} title="No services right now" message="No email services are available at the moment. Please check back soon." />
              ) : (
                <>
                  <Input value={serviceSearch} onChange={setServiceSearch} placeholder="Search services..." icon={<Search className="w-4 h-4" />} />
                  <div className="mt-3 max-h-96 overflow-y-auto space-y-1">
                    {filteredServices.length === 0 && <p className="text-sm text-slate-400 text-center py-4">No services match your search</p>}
                    {popular.length > 0 && (
                      <div className="flex items-center gap-2 px-3 pt-2 pb-1">
                        <span className="text-xs font-bold text-royal-600 uppercase tracking-wide">Popular</span>
                      </div>
                    )}
                    {popular.map((s) => <ServiceRow key={s.slug} service={s} buying={buying === s.slug} balance={profile?.wallet_balance ?? 0} onBuy={handleBuy} />)}
                    {rest.length > 0 && (
                      <div className="flex items-center gap-2 px-3 pt-3 pb-1">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">All Services</span>
                      </div>
                    )}
                    {rest.map((s) => <ServiceRow key={s.slug} service={s} buying={buying === s.slug} balance={profile?.wallet_balance ?? 0} onBuy={handleBuy} />)}
                  </div>
                </>
              )}
            </Card>
          )}
        </>
      )}

      {view === "orders" && (
        <Card className="p-6">
          <h2 className="font-bold text-navy-900 mb-4">Order History</h2>
          {ordersLoading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="w-6 h-6 text-royal-600 animate-spin" />
              <p className="text-sm text-slate-500">Loading your orders...</p>
            </div>
          ) : orders.length === 0 ? (
            <EmptyState icon={<Mail className="w-7 h-7" />} title="No orders yet" message="Buy your first email address to see it here." />
          ) : (
            <div className="space-y-3">
              {orders.map((o) => (
                <div key={o.id} className="p-4 rounded-xl border border-slate-200">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-navy-900 capitalize">{o.service}</p>
                      <p className="text-sm text-royal-700 truncate">{o.email ?? "address pending…"}</p>
                      <p className="text-xs text-slate-400 mt-1">{new Date(o.createdAt).toLocaleString()}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${o.status === "received" ? "bg-success-100 text-success-700" : o.status === "waiting" ? "bg-royal-100 text-royal-700" : o.status === "timeout" || o.status === "charged_free" ? "bg-warning-100 text-warning-700" : "bg-error-100 text-error-700"}`}>
                        {statusLabel[o.status] ?? o.status}
                      </span>
                      <p className="text-sm font-bold text-navy-900 mt-1">{o.charge > 0 ? formatNaira(o.charge) : "Free repeat"}</p>
                      {o.codes.length > 0 && <p className="text-xs text-slate-400">{o.codes.length} code{o.codes.length > 1 ? "s" : ""}</p>}
                    </div>
                  </div>
                  {o.codes.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                      {o.codes.slice(0, 3).map((c, i) => (
                        <div key={i} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                          <span className="font-mono font-bold text-navy-900 tracking-wider">{c.code}</span>
                          <button onClick={() => handleCopyCode(c.code)} className="text-slate-400 hover:text-royal-600 p-1">
                            {copiedCode === c.code ? <Check className="w-4 h-4 text-success-600" /> : <Copy className="w-4 h-4" />}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {(o.status === "received" || o.status === "timeout" || o.status === "cancelled" || o.status === "charged_free" || o.status === "expired") && (
                    <button
                      onClick={() => { setView("buy"); setActiveOrder(o); }}
                      className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-royal-600 hover:text-royal-700"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Reuse this address <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function ServiceRow({ service, buying, balance, onBuy }: { service: CatalogService; buying: boolean; balance: number; onBuy: (s: CatalogService) => void }) {
  const affordable = balance >= service.priceNaira;
  return (
    <div className="flex items-center justify-between p-3 rounded-lg hover:bg-royal-50 transition-base">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-lg bg-royal-100 flex items-center justify-center flex-shrink-0">
          <Mail className="w-4 h-4 text-royal-600" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-navy-900 truncate">{service.name}</p>
          <p className="text-xs text-slate-400">{Math.round(service.ttlSec / 60)} min window</p>
        </div>
      </div>
      <div className="flex items-center gap-3 ml-auto flex-shrink-0">
        <span className="text-sm font-bold text-navy-900">{formatNaira(service.priceNaira)}</span>
        <Button onClick={() => onBuy(service)} loading={buying} disabled={buying || !affordable} className="min-h-[38px] px-4 text-sm">
          {affordable ? "Buy" : "Low balance"}
        </Button>
      </div>
    </div>
  );
}

function Countdown({ expiresAt, now, className = "" }: { expiresAt: string | null; now: number; className?: string }) {
  const remaining = useMemo(() => {
    if (!expiresAt) return null;
    const ms = new Date(expiresAt).getTime() - now;
    if (ms <= 0) return "expired";
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [expiresAt, now]);
  if (!remaining) return null;
  return (
    <span className={className}>
      {remaining === "expired" ? "Time expired" : `Expires in ${remaining}`}
    </span>
  );
}

function EmailOtpResultCard({
  order, emailCopied, copiedCode, onCopyEmail, onCopyCode, onResend, resending, resendPrice, onRefresh, refreshing, refreshMsg, onClose, now,
  cancelStage, onCancelStart, onCancelConfirm, onCancelDismiss,
}: {
  order: EmailOtpOrder;
  emailCopied: boolean;
  copiedCode: string | null;
  onCopyEmail: () => void;
  onCopyCode: (code: string) => void;
  onResend: () => void;
  resending: boolean;
  resendPrice: number | null;
  onRefresh: () => void;
  refreshing: boolean;
  refreshMsg: string;
  onClose: () => void;
  now: number;
  cancelStage: "idle" | "confirm" | "working";
  onCancelStart: () => void;
  onCancelConfirm: () => void;
  onCancelDismiss: () => void;
}) {
  const latest = order.codes[0];
  const resendPriceLabel = resendPrice === null ? null : resendPrice > 0 ? formatNaira(resendPrice) : "Free";
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2"><Mail className="w-5 h-5 text-royal-600" /><h2 className="font-bold text-navy-900 capitalize">{order.service} Email</h2></div>
        <button onClick={onClose} className="text-slate-400 hover:text-navy-900 p-1"><X className="w-5 h-5" /></button>
      </div>

      <div className="bg-gradient-to-br from-navy-900 to-royal-800 rounded-xl p-5 mb-4">
        <p className="text-royal-200 text-xs font-medium mb-1">Your Email Address</p>
        <div className="flex items-center gap-3">
          <p className="text-lg sm:text-xl font-bold text-white break-all">{order.email ?? "…"}</p>
          {order.email && (
            <button onClick={onCopyEmail} className="text-white/60 hover:text-white transition-colors flex-shrink-0">
              {emailCopied ? <Check className="w-4 h-4 text-success-400" /> : <Copy className="w-4 h-4" />}
            </button>
          )}
        </div>
        <div className="mt-3 flex items-center gap-4 text-xs text-royal-200 flex-wrap">
          <span className="capitalize">Service: <span className="text-white font-medium">{order.service}</span></span>
          {order.charge > 0 && <span>Charged: <span className="text-white font-medium">{formatNaira(order.charge)}</span></span>}
          <span className="inline-flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            <Countdown expiresAt={order.status === "waiting" ? order.expiresAt : null} now={now} className="text-white font-medium" />
          </span>
        </div>
      </div>

      {order.status === "waiting" && (
        <div className="flex flex-col items-center py-6 mb-2">
          <div className="relative">
            <div className="w-16 h-16 rounded-full bg-royal-100 flex items-center justify-center"><Clock className="w-8 h-8 text-royal-600" /></div>
            <div className="absolute inset-0 animate-ping"><div className="w-16 h-16 rounded-full bg-royal-100/60" /></div>
          </div>
          <p className="mt-4 font-semibold text-navy-900 text-lg">Waiting for your code...</p>
          <p className="text-sm text-slate-500 mt-1 text-center max-w-sm">Use the email address above on the platform, then the code appears here automatically.</p>
          <div className="mt-2 flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 text-royal-600 animate-spin" />
            <span className="text-xs text-slate-400">Auto-checking every 5 seconds</span>
          </div>
        </div>
      )}

      {order.status === "waiting" && (
        <div className="mt-2 mb-2 text-center">
          {cancelStage === "confirm" ? (
            <div className="inline-flex flex-col items-center gap-2 p-4 rounded-xl bg-error-50 border border-error-200">
              <p className="text-sm font-semibold text-error-800">Cancel this email order and refund {formatNaira(order.charge || 238)}?</p>
              <p className="text-xs text-slate-500">The money goes back to your wallet as soon as the provider confirms the cancellation.</p>
              <div className="flex items-center gap-2 mt-1">
                <button onClick={onCancelConfirm} className="px-4 py-2 rounded-lg bg-error-600 hover:bg-error-700 text-white text-sm font-semibold transition-colors">Yes, cancel and refund</button>
                <button onClick={onCancelDismiss} className="px-4 py-2 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium transition-colors">Keep waiting</button>
              </div>
            </div>
          ) : (
            <button
              onClick={onCancelStart}
              disabled={cancelStage === "working"}
              className="inline-flex items-center gap-2 text-sm font-medium text-error-600 hover:text-error-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {cancelStage === "working" ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
              Cancel Email
            </button>
          )}
        </div>
      )}

      {latest && (
        <div className="space-y-4 mb-2">
          <div className="flex items-center justify-between gap-3 p-4 rounded-xl bg-success-50 border border-success-200">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-full bg-success-100 flex items-center justify-center shrink-0">
                <CheckCircle className="w-5 h-5 text-success-600" />
              </div>
              <div>
                <p className="font-bold text-success-800">Code Received!</p>
                {latest.wasFreeRepeat && <p className="text-xs text-success-600">Free repeat within the 10-minute window</p>}
              </div>
            </div>
            <div className="text-right shrink-0">
              <Countdown expiresAt={order.expiresAt} now={now} className="text-sm font-semibold text-success-700" />
              <p className="text-xs text-slate-400 mt-0.5">Received {new Date(latest.receivedAt).toLocaleTimeString()}</p>
            </div>
          </div>
          <div className="bg-success-50 border-2 border-dashed border-success-300 rounded-xl px-6 py-5 text-center">
            <p className="text-xs font-medium text-success-600 mb-2 uppercase tracking-wide">Your Verification Code</p>
            <div className="flex items-center justify-center gap-3 mb-3">
              <p className="text-3xl sm:text-4xl font-bold text-success-700 tracking-[0.2em] break-all">{latest.code}</p>
              <button onClick={() => onCopyCode(latest.code)} className="p-2 rounded-lg bg-success-100 hover:bg-success-200 text-success-700 transition-colors">
                {copiedCode === latest.code ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
              </button>
            </div>
            <button onClick={() => onCopyCode(latest.code)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-success-600 hover:bg-success-700 text-white text-sm font-medium transition-colors">
              {copiedCode === latest.code ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copiedCode === latest.code ? "Copied!" : "Copy Code"}
            </button>
            {latest.subject && <p className="text-xs text-slate-500 mt-3">From: {latest.sender ?? "unknown"} — "{latest.subject}"</p>}
          </div>
        </div>
      )}

      {(order.status === "timeout" || order.status === "failed" || order.status === "charged_free" || order.status === "expired" || order.status === "cancelled") && (
        <div className="flex flex-col items-center py-8 mb-2">
          <div className="w-16 h-16 rounded-full bg-error-100 flex items-center justify-center mb-4"><AlertCircle className="w-8 h-8 text-error-600" /></div>
          <p className="font-bold text-navy-900">{order.status === "charged_free" ? "No code this time" : order.status === "cancelled" ? "Order Cancelled" : "Order expired – refund processing"}</p>
          <p className="text-sm text-slate-500 mt-1 text-center max-w-sm">
            {order.status === "cancelled"
              ? (order.charge > 0 ? `Your ${formatNaira(order.charge)} payment has been refunded to your wallet.` : "The order was cancelled — nothing was charged.")
              : order.charge > 0 ? "No code arrived in time. Your full payment will be refunded to your wallet automatically — you'll get a notification when it lands." : "No code arrived. Nothing was charged — the repeat was free."}
          </p>
        </div>
      )}

      {(order.status === "received" || order.status === "timeout" || order.status === "charged_free" || order.status === "expired" || order.status === "cancelled") && (
        <div className="pt-2">
          {resendPriceLabel && (
            <p className="text-center text-xs text-slate-500 mb-3">
              Resend price: <span className="font-semibold text-navy-900">{resendPriceLabel}</span>
              {resendPrice === null && " — checking…"}
            </p>
          )}
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-royal-300 text-royal-700 bg-white hover:bg-royal-50 font-semibold text-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Inbox className="w-4 h-4" />}
              {refreshing ? "Checking…" : "Check SMS"}
            </button>
            <button
              onClick={onResend}
              disabled={resending}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-royal-600 hover:bg-royal-700 text-white font-semibold text-sm transition-all hover:shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {resending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {resending ? "Requesting…" : "Resend OTP"}
            </button>
            <Button variant="outline" onClick={onClose}><ShoppingBag className="w-4 h-4" /> New Address</Button>
          </div>
          {refreshMsg && <p className="text-center text-sm text-slate-600 mt-3">{refreshMsg}</p>}
        </div>
      )}

      {order.codes.length > 1 && (
        <div className="mt-5 pt-4 border-t border-slate-100">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Previous codes on this address</p>
          <div className="space-y-2">
            {order.codes.slice(1).map((c, i) => (
              <div key={i} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                <div>
                  <span className="font-mono font-bold text-navy-900">{c.code}</span>
                  <span className="text-xs text-slate-400 ml-2">{new Date(c.receivedAt).toLocaleString()}</span>
                </div>
                <button onClick={() => onCopyCode(c.code)} className="text-slate-400 hover:text-royal-600 p-1">
                  {copiedCode === c.code ? <Check className="w-4 h-4 text-success-600" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
