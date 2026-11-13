import { useEffect, useState } from "react";
import { adminFetch, qs, fmtDate, StatusBadge, DataTable, PageHeader } from "../adminApi";
import { Search, RefreshCw, X, Trash2, Eye, Ban, XCircle } from "lucide-react";

interface Msg {
  id: string;
  campaign_id: string;
  to_email: string;
  subject: string;
  sender: string | null;
  provider_id: string | null;
  status: string;
  error: string | null;
  sent_at: string | null;
  created_at: string;
  campaign: { subject: string; is_test: boolean; created_by: string } | null;
}

interface Res {
  messages: Msg[];
  total: number;
  page: number;
  size: number;
  summary: { total: number; sent: number; failed: number; queued: number; cancelled: number };
}

const STATUSES = ["all", "sent", "queued", "sending", "failed", "cancelled"] as const;

export function AdminSentEmails() {
  const [res, setRes] = useState<Res | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState<Msg | null>(null);
  const [confirming, setConfirming] = useState<null | { type: "one" | "all"; id?: string }>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setRes(await adminFetch<Res>(`sent-emails${qs({ page, status, search: activeSearch, pageSize: 25 })}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sent emails.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, status, activeSearch]);

  const deleteOne = async (id: string) => {
    try { await adminFetch(`sent-emails/${id}`, { method: "DELETE" }); setConfirming(null); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Delete failed."); }
  };

  const clearAll = async () => {
    try { await adminFetch("sent-emails/clear", { method: "DELETE" }); setConfirming(null); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Clear failed."); }
  };

  const cancelQueued = async (id: string) => {
    try {
      await adminFetch("campaigns/cancel", { json: { id } });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Cancel failed."); }
  };

  return (
    <div>
      <PageHeader
        title="Sent Emails"
        subtitle="Every email sent through Monten SMS campaigns"
        actions={
          <>
            <button onClick={load} className="inline-flex items-center gap-2 text-sm font-medium bg-white border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50"><RefreshCw className="w-4 h-4" /> Refresh</button>
            <button onClick={() => setConfirming({ type: "all" })} className="inline-flex items-center gap-2 text-sm font-medium bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 hover:bg-red-100"><Trash2 className="w-4 h-4" /> Clear history</button>
          </>
        }
      />

      {res && (
        <div className="grid grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
          <Sum label="Total records" value={res.summary.total} />
          <Sum label="Delivered" value={res.summary.sent} tone="text-emerald-600" />
          <Sum label="In queue" value={res.summary.queued} tone="text-blue-600" />
          <Sum label="Failed / bounced" value={res.summary.failed} tone="text-red-600" />
          <Sum label="Cancelled" value={res.summary.cancelled} tone="text-slate-500" />
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        {STATUSES.map((s) => (
          <button key={s} onClick={() => { setStatus(s); setPage(1); }} className={`text-xs font-semibold px-3 py-1.5 rounded-full border capitalize ${status === s ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>{s}</button>
        ))}
        <form onSubmit={(e) => { e.preventDefault(); setPage(1); setActiveSearch(search.trim()); }} className="relative ml-auto">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search recipient or subject..." className="w-64 bg-white border border-slate-200 rounded-lg pl-9 pr-8 py-2 text-sm focus:outline-none focus:border-blue-400" />
          {activeSearch && <button type="button" onClick={() => { setSearch(""); setActiveSearch(""); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"><X className="w-4 h-4" /></button>}
        </form>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm mb-4">{error}</div>}
      {loading ? <div className="flex justify-center py-20"><RefreshCw className="w-6 h-6 animate-spin text-blue-600" /></div> : (
        <>
          <DataTable headers={["Recipient", "Subject", "Status", "Sent", "Campaign", "Actions"]} empty={!res || res.messages.length === 0}>
            {res?.messages.map((m) => (
              <tr key={m.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                <td className="py-3 px-4 text-slate-700 max-w-[200px] truncate">{m.to_email}</td>
                <td className="py-3 px-4 font-medium text-slate-900 max-w-[220px] truncate">{m.subject || m.campaign?.subject || "—"}</td>
                <td className="py-3 px-4">
                  <StatusBadge status={m.status} />
                  {m.error && <span className="block text-[10px] text-red-400 mt-0.5 max-w-[200px] truncate" title={m.error}>{m.error}</span>}
                </td>
                <td className="py-3 px-4 text-slate-500 text-xs">{m.sent_at ? fmtDate(m.sent_at) : fmtDate(m.created_at)}</td>
                <td className="py-3 px-4 text-slate-500 text-xs">{m.campaign?.is_test ? <span className="text-amber-600 font-semibold">TEST </span> : ""}{fmtDate(m.created_at)}</td>
                <td className="py-3 px-4">
                  <div className="flex gap-2">
                    <button onClick={() => setViewing(m)} className="text-slate-500 hover:text-blue-600" title="View details"><Eye className="w-4 h-4" /></button>
                    {m.status === "queued" && <button onClick={() => cancelQueued(m.campaign_id)} className="text-slate-500 hover:text-amber-600" title="Cancel queued email"><Ban className="w-4 h-4" /></button>}
                    <button onClick={() => setConfirming({ type: "one", id: m.id })} className="text-slate-500 hover:text-red-600" title="Delete record"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </td>
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

      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={() => setViewing(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <h3 className="font-bold text-slate-900">Email details</h3>
              <button onClick={() => setViewing(null)} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 text-sm space-y-2">
              <Row label="Recipient" value={viewing.to_email} />
              <Row label="Subject" value={viewing.subject} />
              <Row label="Sender" value={viewing.sender ?? "MONTEN SMS"} />
              <Row label="Provider ID" value={viewing.provider_id ?? "—"} />
              <Row label="Status" value={viewing.status} />
              <Row label="Queued at" value={fmtDate(viewing.created_at)} />
              <Row label="Sent at" value={viewing.sent_at ? fmtDate(viewing.sent_at) : "Not delivered yet"} />
              {viewing.error && <Row label="Error" value={viewing.error} />}
            </div>
          </div>
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={() => setConfirming(null)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <XCircle className="w-6 h-6 text-red-500 flex-shrink-0" />
              <div>
                <h3 className="font-bold text-slate-900">{confirming.type === "all" ? "Clear the entire email history?" : "Delete this email record?"}</h3>
                <p className="text-sm text-slate-500 mt-1">
                  {confirming.type === "all"
                    ? "All sent/failed/queued email records will be removed from the admin view. Customer accounts and transactional logs are not touched. Already-delivered emails cannot be recalled."
                    : "This removes the email history record only. Customer accounts and essential records are untouched."}
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirming(null)} className="px-4 py-2 text-sm font-semibold rounded-lg border border-slate-200 hover:bg-slate-50">Cancel</button>
              <button onClick={() => (confirming.type === "all" ? clearAll() : deleteOne(confirming.id!))} className="px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700">Yes, delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4 border-b border-slate-50 py-1.5"><span className="text-slate-400 flex-shrink-0">{label}</span><span className="text-slate-800 text-right break-all">{value}</span></div>;
}

function Sum({ label, value, tone = "text-slate-900" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-2xl font-bold ${tone}`}>{value.toLocaleString()}</p>
    </div>
  );
}
