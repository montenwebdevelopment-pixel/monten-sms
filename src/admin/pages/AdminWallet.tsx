import { useEffect, useState } from "react";
import { adminFetch, qs, fmtNaira, fmtDate, StatusBadge, DataTable, PageHeader } from "../adminApi";
import { Search, RefreshCw, X } from "lucide-react";

interface Txn {
  id: string;
  customer_email: string;
  type: string;
  amount: string | number;
  status: string;
  reference: string | null;
  description: string | null;
  created_at: string;
}

interface Res {
  transactions: Txn[];
  total: number;
  page: number;
  size: number;
  summary: { deposits: number; depSuccess: number; depPending: number; depFailed: number; depositTotal: number; walletTotal: number };
}

const TYPES = ["all", "deposit", "purchase", "refund"] as const;
const STATUSES = ["all", "completed", "pending", "failed"] as const;

export function AdminWallet() {
  const [res, setRes] = useState<Res | null>(null);
  const [page, setPage] = useState(1);
  const [type, setType] = useState<(typeof TYPES)[number]>("all");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setRes(await adminFetch<Res>(`wallet${qs({ page, type, status, search: activeSearch, pageSize: 25 })}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load wallet data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, type, status, activeSearch]);

  return (
    <div>
      <PageHeader title="Wallet & Deposits" subtitle="All wallet transactions and payment records" actions={<button onClick={load} className="inline-flex items-center gap-2 text-sm font-medium bg-white border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50"><RefreshCw className="w-4 h-4" /> Refresh</button>} />

      {res && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
          <SumCard label="Total deposited" value={fmtNaira(res.summary.depositTotal)} />
          <SumCard label="Successful deposits" value={res.summary.depSuccess} tone="text-emerald-600" />
          <SumCard label="Pending deposits" value={res.summary.depPending} tone="text-amber-600" />
          <SumCard label="Failed deposits" value={res.summary.depFailed} tone="text-red-600" />
          <SumCard label="Wallet balances held" value={fmtNaira(res.summary.walletTotal)} tone="text-blue-600" />
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        {TYPES.map((t) => (
          <button key={t} onClick={() => { setType(t); setPage(1); }} className={`text-xs font-semibold px-3 py-1.5 rounded-full border capitalize ${type === t ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>{t}</button>
        ))}
        <span className="w-px bg-slate-200 mx-1" />
        {STATUSES.map((s) => (
          <button key={s} onClick={() => { setStatus(s); setPage(1); }} className={`text-xs font-semibold px-3 py-1.5 rounded-full border capitalize ${status === s ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>{s}</button>
        ))}
        <form onSubmit={(e) => { e.preventDefault(); setPage(1); setActiveSearch(search.trim()); }} className="relative ml-auto">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search reference..." className="w-56 bg-white border border-slate-200 rounded-lg pl-9 pr-8 py-2 text-sm focus:outline-none focus:border-blue-400" />
          {activeSearch && <button type="button" onClick={() => { setSearch(""); setActiveSearch(""); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"><X className="w-4 h-4" /></button>}
        </form>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm mb-4">{error}</div>}
      {loading ? <div className="flex justify-center py-20"><RefreshCw className="w-6 h-6 animate-spin text-blue-600" /></div> : (
        <>
          <DataTable headers={["Customer", "Type", "Amount", "Status", "Reference", "Description", "Date"]} empty={!res || res.transactions.length === 0}>
            {res?.transactions.map((t) => (
              <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                <td className="py-3 px-4 text-slate-700 max-w-[200px] truncate">{t.customer_email || "—"}</td>
                <td className="py-3 px-4 capitalize font-medium text-slate-900">{t.type}</td>
                <td className={`py-3 px-4 font-semibold ${t.type === "deposit" ? "text-emerald-600" : t.type === "refund" ? "text-amber-600" : "text-slate-900"}`}>{fmtNaira(t.amount)}</td>
                <td className="py-3 px-4"><StatusBadge status={t.status} /></td>
                <td className="py-3 px-4 font-mono text-xs text-slate-500 max-w-[180px] truncate">{t.reference ?? "—"}</td>
                <td className="py-3 px-4 text-slate-500 text-xs max-w-[220px] truncate">{t.description ?? "—"}</td>
                <td className="py-3 px-4 text-slate-500 text-xs">{fmtDate(t.created_at)}</td>
              </tr>
            ))}
          </DataTable>
          {res && res.total > res.size && (
            <div className="flex items-center justify-between mt-4 text-sm text-slate-500">
              <span>Page {page} of {Math.max(1, Math.ceil(res.total / res.size))}</span>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40 hover:bg-slate-50">Previous</button>
                <button disabled={page >= Math.ceil(res.total / res.size)} onClick={() => setPage(page + 1)} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40 hover:bg-slate-50">Next</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SumCard({ label, value, tone = "text-slate-900" }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-xl font-bold ${tone}`}>{value}</p>
    </div>
  );
}
