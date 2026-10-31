import { useEffect, useState } from "react";
import { Wallet, ArrowDownLeft, ArrowUpRight, RefreshCw } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatNaira, formatDate } from "../../lib/format";
import { Card, EmptyState } from "../../components/ui";
import { PageHeader, useDashboardRefreshKey } from "../../components/DashboardLayout";
import type { Transaction } from "../../types";

export function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "deposit" | "purchase" | "refund">("all");

  const refreshKey = useDashboardRefreshKey();
  useEffect(() => { fetchTransactions(); }, [refreshKey]);
  const fetchTransactions = async () => {
    setLoading(true);
    const { data } = await supabase.from("transactions").select("*").order("created_at", { ascending: false });
    setTransactions((data ?? []) as Transaction[]); setLoading(false);
  };

  const filtered = filter === "all" ? transactions : transactions.filter(t => t.type === filter);
  const getIcon = (type: string) => type === "deposit" ? <ArrowDownLeft className="w-4 h-4" /> : type === "refund" ? <RefreshCw className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />;
  const getColor = (type: string) => type === "deposit" ? "bg-success-100 text-success-600" : type === "refund" ? "bg-warning-100 text-warning-600" : "bg-royal-100 text-royal-600";

  return (
    <div className="animate-fade-in">
      <PageHeader title="Transaction History" subtitle="View all your wallet transactions" />
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {[{ id: "all", label: "All" }, { id: "deposit", label: "Deposits" }, { id: "purchase", label: "Purchases" }, { id: "refund", label: "Refunds" }].map(tab => (
          <button key={tab.id} onClick={() => setFilter(tab.id as any)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-base whitespace-nowrap ${filter === tab.id ? "bg-royal-600 text-white" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"}`}>{tab.label}</button>
        ))}
      </div>
      <Card className="p-0 overflow-hidden">
        {loading ? <div className="p-8 text-center text-sm text-slate-400">Loading transactions...</div> :
         filtered.length === 0 ? <EmptyState icon={<Wallet className="w-7 h-7" />} title="No transactions yet" message="Your transaction history will appear here once you start using your wallet" /> : (
          <div className="divide-y divide-slate-50">
            {filtered.map(txn => (
              <div key={txn.id} className="flex items-center justify-between gap-3 p-4 hover:bg-slate-50 transition-base">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${getColor(txn.type)}`}>{getIcon(txn.type)}</div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-navy-900 capitalize">{txn.type}</p>
                    <p className="text-xs text-slate-400 truncate">{txn.description || txn.reference || "Transaction"}</p>
                    <p className="text-xs text-slate-400">{formatDate(txn.created_at)}</p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`text-sm font-bold ${txn.type === "deposit" || txn.type === "refund" ? "text-success-600" : "text-navy-900"}`}>{txn.type === "deposit" || txn.type === "refund" ? "+" : "-"}{formatNaira(txn.amount)}</p>
                  <span className={`inline-block text-xs px-2 py-0.5 rounded-full mt-1 ${txn.status === "completed" ? "bg-success-50 text-success-600" : txn.status === "pending" ? "bg-warning-50 text-warning-600" : "bg-error-50 text-error-600"}`}>{txn.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
