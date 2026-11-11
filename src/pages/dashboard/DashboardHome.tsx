import { useEffect, useState } from "react";
import {
  Wallet, ShoppingBag, Mail, CreditCard, History, ArrowRight,
  ArrowDownLeft, RefreshCw, TrendingDown,
} from "lucide-react";

import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabase";
import { formatNaira, formatDate } from "../../lib/format";
import { Card } from "../../components/ui";
import { useDashboardRefreshKey, type DashboardPage } from "../../components/DashboardLayout";
import type { Transaction } from "../../types";

export function DashboardHome({ onNavigate }: { onNavigate: (page: DashboardPage) => void }) {
  const { profile } = useAuth();
  const [txnsLoading, setTxnsLoading] = useState(true);
  const refreshKey = useDashboardRefreshKey();

  // The raw seven-day window is fetched once (newest first, RLS-scoped to the
  // signed-in user). Both the recent list and the spending total derive from it
  // in-memory, so a single fetch drives both and the calculation rolls forward
  // on the client clock without extra database calls.
  const [windowTxns, setWindowTxns] = useState<Transaction[]>([]);

  useEffect(() => {
    (async () => {
      setTxnsLoading(true);
      const { data: txns } = await supabase
        .from("transactions")
        .select("*")
        .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order("created_at", { ascending: false })
        .limit(200);
      setWindowTxns((txns ?? []) as Transaction[]);
      setTxnsLoading(false);
    })();
  }, [refreshKey]);

  // Rolling recompute: every 30s the boundary moves, so transactions crossing
  // the seven-day edge drop out and the displayed amount stays current without
  // a manual refresh. The window itself only re-fetches on dashboard refresh.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  const inWindow = windowTxns.filter((t) => new Date(t.created_at).getTime() >= cutoff);

  // Net spending: completed purchases minus completed refunds. Deposits and
  // failed/pending rows are excluded; the unique transaction id is the dedup
  // key (ids can't repeat), so no transaction is counted twice.
  const netSpent = inWindow.reduce((sum, t) => {
    if (t.status !== "completed") return sum;
    if (t.type === "purchase") return sum + Number(t.amount);
    if (t.type === "refund") return sum - Number(t.amount);
    return sum;
  }, 0);
  const weekSpend = Math.max(netSpent, 0);
  const recentTxns = inWindow.slice(0, 5);

  const quickActions = [
    { label: "Buy Number", icon: <ShoppingBag className="w-6 h-6" />, page: "buy-numbers" as DashboardPage, color: "bg-royal-600", hover: "group-hover:bg-royal-700" },
    { label: "Purchase Email", icon: <Mail className="w-6 h-6" />, page: "email-otp" as DashboardPage, color: "bg-success-600", hover: "group-hover:bg-success-700" },
    { label: "Fund Wallet", icon: <CreditCard className="w-6 h-6" />, page: "fund-wallet" as DashboardPage, color: "bg-navy-800", hover: "group-hover:bg-navy-900" },
    { label: "Transaction History", icon: <History className="w-6 h-6" />, page: "transactions" as DashboardPage, color: "bg-warning-600", hover: "group-hover:bg-warning-700" },
  ];

  const txnIcon = (type: string) =>
    type === "deposit" ? <ArrowDownLeft className="w-4 h-4" />
    : type === "refund" ? <RefreshCw className="w-4 h-4" />
    : <ShoppingBag className="w-4 h-4" />;

  return (
    <div className="animate-fade-in">
      {/* Wallet balance — the only thing in the hero band */}
      <div className="bg-gradient-to-br from-navy-900 to-royal-800 rounded-2xl p-6 sm:p-8 mb-6">
        <div className="flex items-center gap-2 text-royal-200 text-sm font-medium">
          <Wallet className="w-4 h-4" /> Wallet Balance
        </div>
        <p className="mt-2 text-4xl sm:text-5xl font-bold text-white tracking-tight">
          {formatNaira(profile?.wallet_balance ?? 0)}
        </p>
      </div>

      {/* Quick actions — exactly four */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        {quickActions.map((action) => (
          <button
            key={action.label}
            onClick={() => onNavigate(action.page)}
            className="group flex flex-col items-center gap-3 p-5 min-h-[124px] bg-white rounded-xl border border-slate-200 card-shadow hover:card-shadow-lg active:scale-[0.98] transition-base"
          >
            <div className={`w-12 h-12 rounded-xl ${action.color} ${action.hover} flex items-center justify-center text-white transition-colors`}>{action.icon}</div>
            <span className="text-sm font-semibold text-navy-900 text-center leading-snug">{action.label}</span>
          </button>
        ))}
      </div>

      {/* Seven-day spending summary — compact single-line card */}
      <Card className="p-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-warning-100 flex items-center justify-center flex-shrink-0">
            <TrendingDown className="w-5 h-5 text-warning-600" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-500">Last 7 Days Spending</p>
            <p className="text-xl font-bold text-navy-900 leading-tight">{formatNaira(weekSpend)}</p>
          </div>
          <p className="text-xs text-slate-400 text-right flex-shrink-0">net of refunds</p>
        </div>
      </Card>

      {/* Recent transactions — last 7 days, latest 5 */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-navy-900">Recent Transactions</h2>
          <button
            onClick={() => onNavigate("transactions")}
            className="text-sm text-royal-600 hover:text-royal-700 font-medium inline-flex items-center gap-1"
          >
            View All Transactions <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
        {txnsLoading ? (
          <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
        ) : recentTxns.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">No transactions in the last 7 days</p>
        ) : (
          <div className="divide-y divide-slate-50">
            {recentTxns.map((txn) => {
              const isCredit = txn.type === "deposit" || txn.type === "refund";
              return (
                <div key={txn.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${isCredit ? "bg-success-100 text-success-600" : "bg-royal-100 text-royal-600"}`}>
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
