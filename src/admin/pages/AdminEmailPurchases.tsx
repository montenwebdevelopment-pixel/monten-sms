import { useEffect, useState } from "react";
import { adminFetch, qs, fmtNaira, fmtDate, StatusBadge, DataTable, PageHeader } from "../adminApi";
import { Search, RefreshCw, X } from "lucide-react";

interface Order {
  id: string;
  customer_email: string;
  service: string;
  site: string | null;
  email_address: string | null;
  charge_naira: string | number;
  provider_price_usd: string | number | null;
  status: string;
  created_at: string;
}

interface Res {
  orders: Order[];
  total: number;
  page: number;
  size: number;
  summary: { total: number; success: number; pending: number; failed: number; cancelled: number };
}

const STATUSES = ["all", "received", "waiting", "failed", "cancelled", "timeout"] as const;

export function AdminEmailPurchases() {
  const [res, setRes] = useState<Res | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setRes(await adminFetch<Res>(`email-orders${qs({ page, status, search: activeSearch, pageSize: 25 })}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load email purchases.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, status, activeSearch]);

  return (
    <div>
      <PageHeader title="Email Purchases" subtitle="Email OTP rental orders (MailOtp provider)" actions={<button onClick={load} className="inline-flex items-center gap-2 text-sm font-medium bg-white border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50"><RefreshCw className="w-4 h-4" /> Refresh</button>} />

      {res && (
        <div className="grid grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
          <SumCard label="Total purchases" value={res.summary.total} />
          <SumCard label="Successful" value={res.summary.success} tone="text-emerald-600" />
          <SumCard label="Pending" value={res.summary.pending} tone="text-blue-600" />
          <SumCard label="Failed" value={res.summary.failed} tone="text-red-600" />
          <SumCard label="Cancelled" value={res.summary.cancelled} tone="text-slate-500" />
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        {STATUSES.map((s) => (
          <button key={s} onClick={() => { setStatus(s); setPage(1); }}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border capitalize transition-colors ${status === s ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>
            {s}
          </button>
        ))}
        <form onSubmit={(e) => { e.preventDefault(); setPage(1); setActiveSearch(search.trim()); }} className="relative ml-auto">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search email or service..." className="w-60 bg-white border border-slate-200 rounded-lg pl-9 pr-8 py-2 text-sm focus:outline-none focus:border-blue-400" />
          {activeSearch && <button type="button" onClick={() => { setSearch(""); setActiveSearch(""); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"><X className="w-4 h-4" /></button>}
        </form>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm mb-4">{error}</div>}
      {loading ? <div className="flex justify-center py-20"><RefreshCw className="w-6 h-6 animate-spin text-blue-600" /></div> : (
        <>
          <DataTable headers={["Customer", "Service", "Rented email", "Charge", "Cost (USD)", "Status", "Date"]} empty={!res || res.orders.length === 0}>
            {res?.orders.map((o) => (
              <tr key={o.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                <td className="py-3 px-4 text-slate-700 max-w-[200px] truncate">{o.customer_email || "—"}</td>
                <td className="py-3 px-4 font-medium text-slate-900 capitalize">{o.service}</td>
                <td className="py-3 px-4 text-royal-700 text-xs max-w-[200px] truncate font-mono">{o.email_address ?? "—"}</td>
                <td className="py-3 px-4 font-semibold text-slate-900">{fmtNaira(o.charge_naira)}</td>
                <td className="py-3 px-4 text-slate-500">{o.provider_price_usd !== null ? `$${Number(o.provider_price_usd).toFixed(4)}` : "—"}</td>
                <td className="py-3 px-4"><StatusBadge status={o.status} /></td>
                <td className="py-3 px-4 text-slate-500 text-xs">{fmtDate(o.created_at)}</td>
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

function SumCard({ label, value, tone = "text-slate-900" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-2xl font-bold ${tone}`}>{value.toLocaleString()}</p>
    </div>
  );
}
