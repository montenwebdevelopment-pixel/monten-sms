import { useEffect, useState } from "react";
import { adminFetch, qs, fmtDate, StatusBadge, DataTable, PageHeader, MiniChart } from "../adminApi";
import { Search, RefreshCw, X } from "lucide-react";

interface Event {
  id: string;
  email: string;
  event_type: string;
  user_agent: string | null;
  created_at: string;
}

interface Res {
  events: Event[];
  total: number;
  page: number;
  size: number;
  summary: { totalEvents: number; uniqueUsers: number; failed: number; daily: { date: string; n: number }[] };
}

const TYPES = ["all", "login", "login_failed", "logout"] as const;

export function AdminLoginActivity() {
  const [res, setRes] = useState<Res | null>(null);
  const [page, setPage] = useState(1);
  const [type, setType] = useState<(typeof TYPES)[number]>("all");
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setRes(await adminFetch<Res>(`login-activity${qs({ page, type, search: activeSearch, pageSize: 25 })}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load login activity.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, type, activeSearch]);

  return (
    <div>
      <PageHeader title="Login Activity" subtitle="Every recorded customer sign-in event" actions={<button onClick={load} className="inline-flex items-center gap-2 text-sm font-medium bg-white border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50"><RefreshCw className="w-4 h-4" /> Refresh</button>} />

      {res && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs text-slate-500">Unique users who logged in</p>
            <p className="text-2xl font-bold text-emerald-600">{res.summary.uniqueUsers.toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs text-slate-500">Total login events</p>
            <p className="text-2xl font-bold text-slate-900">{res.summary.totalEvents.toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs text-slate-500">Failed attempts</p>
            <p className="text-2xl font-bold text-red-600">{res.summary.failed.toLocaleString()}</p>
          </div>
        </div>
      )}

      {res && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
          <p className="text-sm font-semibold text-slate-800 mb-2">Login activity over time (last 30 days)</p>
          <MiniChart data={res.summary.daily} color="#059669" />
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        {TYPES.map((t) => (
          <button key={t} onClick={() => { setType(t); setPage(1); }}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${type === t ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>
            {t.replace("_", " ")}
          </button>
        ))}
        <form onSubmit={(e) => { e.preventDefault(); setPage(1); setActiveSearch(search.trim()); }} className="relative ml-auto">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search email..." className="w-56 bg-white border border-slate-200 rounded-lg pl-9 pr-8 py-2 text-sm focus:outline-none focus:border-blue-400" />
          {activeSearch && <button type="button" onClick={() => { setSearch(""); setActiveSearch(""); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"><X className="w-4 h-4" /></button>}
        </form>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm mb-4">{error}</div>}
      {loading ? <div className="flex justify-center py-20"><RefreshCw className="w-6 h-6 animate-spin text-blue-600" /></div> : (
        <>
          <DataTable headers={["Email", "Event", "When", "Device"]} empty={!res || res.events.length === 0}>
            {res?.events.map((ev) => (
              <tr key={ev.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                <td className="py-3 px-4 text-slate-700">{ev.email}</td>
                <td className="py-3 px-4"><StatusBadge status={ev.event_type === "login" ? "login" : ev.event_type} /></td>
                <td className="py-3 px-4 text-slate-500 text-xs">{fmtDate(ev.created_at)}</td>
                <td className="py-3 px-4 text-slate-400 text-xs max-w-[240px] truncate">{ev.user_agent ?? "—"}</td>
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
