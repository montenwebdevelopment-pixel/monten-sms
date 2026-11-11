import { useEffect, useState } from "react";
import { Smartphone, MessageSquare, CircleCheck as CheckCircle, Circle as XCircle, Clock, X, Copy, Check, RefreshCw } from "lucide-react";
import { supabase, EDGE_FUNCTION_BASE } from "../../lib/supabase";
import { formatDate, formatNaira } from "../../lib/format";
import { Card, EmptyState, Button } from "../../components/ui";
import { PageHeader, useDashboardRefreshKey } from "../../components/DashboardLayout";
import { notifyOtpReceived } from "../../lib/native";
import type { PurchasedNumber } from "../../types";

export function PurchasedNumbersPage({ view = "all" }: { view?: "all" | "active" | "inbox" }) {
  const [numbers, setNumbers] = useState<PurchasedNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const refreshKey = useDashboardRefreshKey();

  useEffect(() => { fetchNumbers(); }, [refreshKey]);
  const fetchNumbers = async () => {
    setLoading(true);
    setActionError("");
    try {
      const { data, error } = await supabase.from("purchased_numbers").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      setNumbers((data ?? []) as PurchasedNumber[]);
    } catch (error) {
      console.error("[purchased-numbers] failed to load numbers", error);
      setActionError("We couldn't load your numbers. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (text: string, id: string) => { navigator.clipboard.writeText(text); setCopiedId(id); setTimeout(() => setCopiedId(null), 2000); };

  const handleCheckSMS = async (number: PurchasedNumber) => {
    if (!number.fivesim_id) return;
    setCheckingId(number.id);
    try {
      const { data: session } = await supabase.auth.getSession();
      const resp = await fetch(`${EDGE_FUNCTION_BASE}/fivesim-proxy/sms/${number.fivesim_id}`, { headers: { Authorization: `Bearer ${session.session?.access_token}` } });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error ?? `SMS check failed (${resp.status})`);
      if (data.status === "received" && typeof data.smsCode === "string" && data.smsCode.trim()) {
        void notifyOtpReceived(number.fivesim_id);
      }
      // The server records the SMS/status change; just refresh from the server.
      await fetchNumbers();
    } catch (error) {
      console.error("[purchased-numbers] SMS check failed", error);
      setActionError("We couldn't check for your SMS right now. Please try again.");
    } finally {
      setCheckingId(null);
    }
  };

  const handleCancel = async (number: PurchasedNumber) => {
    if (!number.fivesim_id) return;
    setActionError("");
    try {
    const { data: session } = await supabase.auth.getSession();
    const cancelResponse = await fetch(`${EDGE_FUNCTION_BASE}/fivesim-proxy/cancel/${number.fivesim_id}`, { method: "POST", headers: { Authorization: `Bearer ${session.session?.access_token}` } });
    if (!cancelResponse.ok) throw new Error("Number cancellation failed.");
    await fetchNumbers();
    } catch (error) {
      console.error("[purchased-numbers] cancel failed", error);
      setActionError("We couldn't cancel this number. Please try again.");
    }
  };

  const visibleNumbers = numbers.filter((number) => (
    view === "active" ? number.status === "waiting"
      : view === "inbox" ? number.status === "received"
        : true
  ));
  const title = view === "active" ? "Active Numbers" : view === "inbox" ? "SMS Inbox" : "Purchased Numbers";
  const subtitle = view === "inbox" ? "View SMS verification codes received on your numbers" : "Manage your purchased phone numbers and OTPs";

  const getStatusBadge = (status: string) => {
    const styles: Record<string, { bg: string; icon: any; label: string }> = {
      waiting: { bg: "bg-royal-50 text-royal-600", icon: <Clock className="w-3 h-3" />, label: "Waiting" },
      received: { bg: "bg-success-50 text-success-600", icon: <CheckCircle className="w-3 h-3" />, label: "OTP Received" },
      canceled: { bg: "bg-warning-50 text-warning-600", icon: <XCircle className="w-3 h-3" />, label: "Canceled · Refunded" },
      failed: { bg: "bg-error-50 text-error-600", icon: <XCircle className="w-3 h-3" />, label: "Timed Out · Refunded" },
    };
    const s = styles[status] || styles.waiting;
    return <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium ${s.bg}`}>{s.icon}{s.label}</span>;
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title={title} subtitle={subtitle} />
      <Card className="p-0 overflow-hidden">
        {actionError && <p role="alert" className="m-4 rounded-lg bg-error-50 border border-error-200 px-3 py-2 text-sm text-error-700">{actionError}</p>}
        {loading ? <div className="p-8 text-center text-sm text-slate-400">Loading...</div> :
         visibleNumbers.length === 0 ? <EmptyState icon={<Smartphone className="w-7 h-7" />} title={view === "inbox" ? "No messages yet" : view === "active" ? "No active numbers" : "No purchased numbers"} message={view === "inbox" ? "Received verification codes will appear here." : "Buy a number to see it here. Your purchased numbers and received OTPs will be listed on this page."} /> : (
          <div className="divide-y divide-slate-50">
            {visibleNumbers.map(number => (
              <div key={number.id} className="p-4 hover:bg-slate-50 transition-base">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="w-10 h-10 rounded-lg bg-navy-100 flex items-center justify-center flex-shrink-0"><Smartphone className="w-5 h-5 text-navy-700" /></div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-navy-900 text-lg">{number.phone_number || "N/A"}</p>
                        {number.phone_number && <button onClick={() => handleCopy(number.phone_number!, number.id)} className="text-slate-400 hover:text-navy-900">{copiedId === number.id ? <Check className="w-3.5 h-3.5 text-success-600" /> : <Copy className="w-3.5 h-3.5" />}</button>}
                      </div>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        <span className="text-xs text-slate-500">Service: <span className="font-medium text-navy-900 capitalize">{number.service_name}</span></span>
                        <span className="text-xs text-slate-500">Country: <span className="font-medium text-navy-900">{number.country_name || number.country_code}</span></span>
                        <span className="text-xs text-slate-500">Operator: <span className="font-medium text-navy-900 capitalize">{number.operator_name}</span></span>
                      </div>
                      <div className="flex items-center gap-3 mt-2">{getStatusBadge(number.status)}<span className="text-xs text-slate-400">{formatDate(number.created_at)}</span>{number.selling_price && <span className="text-xs text-slate-500">{formatNaira(number.selling_price)}</span>}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto sm:flex-shrink-0 justify-end">
                    {number.status === "waiting" && (<>
                      <Button variant="outline" className="text-xs min-h-[44px] flex-1 sm:flex-none" loading={checkingId === number.id} onClick={() => handleCheckSMS(number)}><RefreshCw className="w-3.5 h-3.5" /> Check SMS</Button>
                      <Button variant="danger" className="text-xs min-h-[44px] flex-1 sm:flex-none" onClick={() => handleCancel(number)}><X className="w-3.5 h-3.5" /> Cancel</Button>
                    </>)}
                  </div>
                </div>
                {number.sms_code && (
                  <div className="mt-3 bg-success-50 border border-success-200 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1"><MessageSquare className="w-4 h-4 text-success-600" /><span className="text-xs font-medium text-success-700">OTP Code</span></div>
                    <div className="flex items-center gap-3">
                      <p className="text-xl font-bold text-success-700 tracking-widest">{number.sms_code}</p>
                      <button onClick={() => handleCopy(number.sms_code!, number.id)} className="text-success-600 hover:text-success-700">{copiedId === number.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}</button>
                    </div>
                    {number.sms_text && <p className="text-xs text-slate-600 mt-2">{number.sms_text}</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
