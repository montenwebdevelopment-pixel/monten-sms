import { useEffect, useState } from "react";
import { adminFetch, PageHeader } from "../adminApi";
import { RefreshCw, CheckCircle2, XCircle, Loader2 } from "lucide-react";

interface Check { name: string; ok: boolean; ms: number; detail: string }

export function AdminPerformance() {
  const [checks, setChecks] = useState<Check[]>([]);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await adminFetch<{ checks: Check[]; checkedAt: string }>("performance");
      setChecks(res.checks);
      setCheckedAt(res.checkedAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Performance check failed.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div>
      <PageHeader
        title="Performance"
        subtitle="Real connectivity checks, run live when you open or refresh this page — no simulated data"
        actions={<button onClick={load} disabled={loading} className="inline-flex items-center gap-2 text-sm font-medium bg-white border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 disabled:opacity-50"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Run checks again</button>}
      />

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm mb-4">{error}</div>}

      {loading && checks.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 flex items-center gap-3 text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin text-blue-600" /> Running live connectivity checks...
        </div>
      ) : (
        <div className="space-y-3">
          {checks.map((c) => (
            <div key={c.name} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4">
              {loading ? <Loader2 className="w-5 h-5 animate-spin text-blue-600" /> : c.ok ? <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" /> : <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-900 text-sm">{c.name}</p>
                <p className="text-xs text-slate-500 truncate">{c.detail}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className={`text-sm font-bold ${c.ms < 500 ? "text-emerald-600" : c.ms < 2000 ? "text-amber-600" : "text-red-600"}`}>{c.ms} ms</p>
                <p className="text-[10px] text-slate-400">response time</p>
              </div>
            </div>
          ))}
          {checkedAt && <p className="text-xs text-slate-400 text-center pt-2">Last checked: {new Date(checkedAt).toLocaleString()}</p>}
        </div>
      )}

      <div className="mt-6 bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-500 space-y-1">
        <p className="font-bold text-slate-700">About these checks</p>
        <p>Each row is a genuine network request made from the backend at the moment you load this page. Response times vary with network conditions. A service shown as unreachable may be temporarily down or blocking the check — check again later before assuming an outage.</p>
      </div>
    </div>
  );
}
