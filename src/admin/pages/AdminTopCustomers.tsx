import { useEffect, useState } from "react";
import { adminFetch, qs, fmtNaira, fmtDate, DataTable, PageHeader } from "../adminApi";
import { Search, RefreshCw, Trophy } from "lucide-react";

interface Customer {
  rank: number;
  id: string;
  name: string;
  email: string;
  wallet: string | number;
  email_verified: boolean;
  count: number;
  spent: number;
  last: string;
}

const LIMITS = [10, 20, 50, 0] as const;
const PERIODS = ["all", "today", "week", "month"] as const;

export function AdminTopCustomers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [limit, setLimit] = useState<(typeof LIMITS)[number]>(10);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>("all");
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await adminFetch<{ customers: Customer[] }>(`top-customers${qs({ limit, period })}`);
      let list = res.customers;
      if (activeSearch) {
        const t = activeSearch.toLowerCase();
        list = list.filter((c) => c.email.toLowerCase().includes(t) || c.name.toLowerCase().includes(t));
      }
      setCustomers(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load rankings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [limit, period, activeSearch]);

  return (
    <div>
      <PageHeader title="Top Customers" subtitle="Ranked by successful, paid phone-number purchases. Failed, cancelled and refunded orders are excluded." actions={<button onClick={load} className="inline-flex items-center gap-2 text-sm font-medium bg-white border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50"><RefreshCw className="w-4 h-4" /> Refresh</button>} />

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <Trophy className="w-4 h-4 text-amber-500" />
        {LIMITS.map((l) => (
          <button key={l} onClick={() => setLimit(l)} className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${limit === l ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>
            {l === 0 ? "All" : `Top ${l}`}
          </button>
        ))}
        <span className="w-px bg-slate-200 mx-1" />
        {PERIODS.map((p) => (
          <button key={p} onClick={() => setPeriod(p)} className={`text-xs font-semibold px-3 py-1.5 rounded-full border capitalize ${period === p ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>
            {p === "all" ? "All time" : p}
          </button>
        ))}
        <form onSubmit={(e) => { e.preventDefault(); setActiveSearch(search.trim()); }} className="relative ml-auto">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or email..." className="w-56 bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
        </form>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm mb-4">{error}</div>}
      {loading ? <div className="flex justify-center py-20"><RefreshCw className="w-6 h-6 animate-spin text-blue-600" /></div> : (
        <DataTable headers={["#", "Customer", "Email", "Numbers bought", "Total spent", "Last purchase", "Account status"]} empty={customers.length === 0}>
          {customers.map((c) => (
            <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50/60">
              <td className="py-3 px-4">
                <span className={`inline-flex w-7 h-7 items-center justify-center rounded-full text-xs font-bold ${c.rank === 1 ? "bg-amber-100 text-amber-700" : c.rank <= 3 ? "bg-slate-200 text-slate-700" : "bg-slate-100 text-slate-500"}`}>{c.rank}</span>
              </td>
              <td className="py-3 px-4 font-medium text-slate-900">{c.name || "—"}</td>
              <td className="py-3 px-4 text-slate-600 max-w-[220px] truncate">{c.email}</td>
              <td className="py-3 px-4 font-bold text-blue-700">{c.count}</td>
              <td className="py-3 px-4 font-semibold text-slate-900">{fmtNaira(c.spent)}</td>
              <td className="py-3 px-4 text-slate-500 text-xs">{fmtDate(c.last)}</td>
              <td className="py-3 px-4"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${c.email_verified ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{c.email_verified ? "Verified" : "Unverified"}</span></td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
