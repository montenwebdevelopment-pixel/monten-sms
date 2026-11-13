import { useEffect, useState } from "react";
import {
  Wallet, ChevronRight, Smartphone, MessageCircle, Send, Bot,
  ShoppingBag, RefreshCw, ArrowDownLeft,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabase";
import { formatNaira, formatDate } from "../../lib/format";
import { Card } from "../../components/ui";
import { useDashboardRefreshKey, type DashboardPage } from "../../components/DashboardLayout";
import type { Transaction } from "../../types";

type ActiveNumber = {
  id: string;
  phone_number: string | null;
  service_name: string | null;
  country_name: string | null;
  country_code: string | null;
  created_at: string;
  expires_at: string | null;
};

const quickPurchase = [
  { code: "whatsapp", label: "WhatsApp", icon: MessageCircle, style: "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" },
  { code: "telegram", label: "Telegram", icon: Send, style: "bg-sky-50 text-sky-700 hover:bg-sky-100" },
  { code: "openai", label: "OpenAI", icon: Bot, style: "bg-slate-100 text-slate-800 hover:bg-slate-200" },
];

function ActiveCountdown({ expiresAt, createdAt }: { expiresAt: string | null; createdAt: string }) {
  const target = expiresAt ?? new Date(new Date(createdAt).getTime() + 5 * 60 * 1000).toISOString();
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((Date.parse(target) - Date.now()) / 1000)));

  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, Math.ceil((Date.parse(target) - Date.now()) / 1000)));
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [target]);

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  return (
    <span className="text-xs font-semibold text-royal-600 flex-shrink-0">
      {mins}:{String(secs).padStart(2, "0")}
    </span>
  );
}

export function DashboardHomeNative({ onNavigate }: { onNavigate: (page: DashboardPage) => void }) {
  const { profile } = useAuth();
  const refreshKey = useDashboardRefreshKey();
  const [recentTxns, setRecentTxns] = useState<Transaction[]>([]);
  const [activeNumbers, setActiveNumbers] = useState<ActiveNumber[]>([]);
  const [stats, setStats] = useState({ totalPurchases: 0, totalSpent: 0 });

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const [txns, purchases, waiting] = await Promise.all([
        supabase.from("transactions").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(5),
        supabase.from("transactions").select("amount", { count: "exact" }).eq("type", "purchase").eq("status", "completed").gte("created_at", since),
        supabase.from("purchased_numbers").select("id, phone_number, service_name, country_name, country_code, created_at, expires_at").eq("status", "waiting").order("created_at", { ascending: false }).limit(3),
      ]);
      if (txns.error) console.error("[dashboard-native] recent transactions request failed", txns.error);
      if (purchases.error) console.error("[dashboard-native] weekly purchases request failed", purchases.error);
      if (waiting.error) console.error("[dashboard-native] active numbers request failed", waiting.error);
      const purchaseRows = purchases.data ?? [];
      setRecentTxns((txns.data ?? []) as Transaction[]);
      setActiveNumbers((waiting.data ?? []) as ActiveNumber[]);
      setStats({
        totalPurchases: purchases.count ?? purchaseRows.length,
        totalSpent: purchaseRows.reduce((sum, row) => sum + Number(row.amount), 0),
      });
    })();
  }, [refreshKey]);

  const txnIcon = (type: string) =>
    type === "deposit" ? <ArrowDownLeft className="w-4 h-4" />
    : type === "refund" ? <RefreshCw className="w-4 h-4" />
    : <ShoppingBag className="w-4 h-4" />;

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <p className="text-sm font-semibold text-royal-600">MONTEN SMS</p>
        <h1 className="text-2xl font-bold text-navy-900 mt-1">Last 7 days</h1>
        <p className="text-sm text-slate-500 mt-1">Your recent number purchases and transactions.</p>
      </div>

      <Card className="mb-6 overflow-hidden bg-gradient-to-r from-navy-900 to-royal-800 p-5 text-white sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-white/75">
              <Wallet className="h-4 w-4" /> Wallet Balance
            </div>
            <p className="mt-1 text-3xl font-bold">{formatNaira(profile?.wallet_balance ?? 0)}</p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate("fund-wallet")}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-navy-900 transition-base hover:bg-slate-100"
          >
            <Wallet className="h-4 w-4" /> Fund Wallet
          </button>
        </div>
      </Card>

      <Card className="mb-6 p-5 sm:p-6">
        <div className="mb-4">
          <h2 className="font-bold text-navy-900">Quick Purchase</h2>
          <p className="mt-1 text-sm text-slate-500">Jump straight to available offers for a popular service.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {quickPurchase.map(({ code, label, icon: Icon, style }) => (
            <button
              key={code}
              type="button"
              onClick={() => onNavigate("buy-numbers")}
              className={`flex min-h-14 items-center justify-between rounded-xl px-4 py-3 text-sm font-semibold transition-base ${style}`}
            >
              <span className="flex items-center gap-3">
                <Icon className="h-5 w-5" /> {label}
              </span>
              <ChevronRight className="h-4 w-4" />
            </button>
          ))}
        </div>
      </Card>

      <Card className="mb-6 p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-navy-900">Active Numbers</h2>
            <p className="mt-1 text-sm text-slate-500">Numbers currently waiting for an SMS code.</p>
          </div>
          <Smartphone className="h-5 w-5 text-royal-600" />
        </div>
        {activeNumbers.length === 0 ? (
          <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">No active numbers right now.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {activeNumbers.map((num) => (
              <div key={num.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-navy-900">{num.phone_number || "Number pending"}</p>
                  <p className="mt-0.5 text-xs capitalize text-slate-500">{num.service_name} · {num.country_name || num.country_code}</p>
                </div>
                <ActiveCountdown expiresAt={num.expires_at} createdAt={num.created_at} />
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => onNavigate("purchased-numbers")}
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-royal-600 hover:text-royal-700"
        >
          View active numbers <ChevronRight className="h-4 w-4" />
        </button>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-6">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-success-100 flex items-center justify-center">
              <ShoppingBag className="w-5 h-5 text-success-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Numbers Purchased (7 days)</p>
              <p className="text-lg font-bold text-navy-900">{stats.totalPurchases}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-warning-100 flex items-center justify-center">
              <RefreshCw className="w-5 h-5 text-warning-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Total Spent (7 days)</p>
              <p className="text-lg font-bold text-navy-900">{formatNaira(stats.totalSpent)}</p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-navy-900">Recent Transactions (7 days)</h2>
          <button
            onClick={() => onNavigate("transactions")}
            className="text-sm text-royal-600 hover:text-royal-700 font-medium inline-flex items-center gap-1"
          >
            View All <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
        {recentTxns.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">No transactions in the last 7 days.</p>
        ) : (
          <div className="space-y-3">
            {recentTxns.map((txn) => {
              const isCredit = txn.type === "deposit" || txn.type === "refund";
              return (
                <div key={txn.id} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isCredit ? "bg-success-100 text-success-600" : "bg-royal-100 text-royal-600"}`}>
                      {txnIcon(txn.type)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-navy-900 capitalize">{txn.type}</p>
                      <p className="text-xs text-slate-400">{formatDate(txn.created_at)}</p>
                    </div>
                  </div>
                  <p className={`text-sm font-bold flex-shrink-0 ${isCredit ? "text-success-600" : "text-navy-900"}`}>
                    {isCredit ? "+" : "-"}{formatNaira(txn.amount)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
