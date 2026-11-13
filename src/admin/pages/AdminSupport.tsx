import { useEffect, useState } from "react";
import { adminFetch, qs, fmtDate, StatusBadge, DataTable, PageHeader } from "../adminApi";
import { Search, RefreshCw, X, Reply, ArrowLeft, Loader2 } from "lucide-react";

interface Ticket {
  id: string;
  customer_email: string;
  subject: string;
  category: string | null;
  priority: string;
  status: string;
  case_ref: string;
  summary: string | null;
  escalated: boolean;
  created_at: string;
  updated_at: string;
}

interface TicketRes {
  tickets: Ticket[];
  total: number;
  page: number;
  size: number;
  summary: { total: number; open: number; pending: number; resolved: number };
}

interface Msg { id: string; role: string; content: string; meta: Record<string, unknown> | null; created_at: string }

const STATUSES = ["all", "open", "pending", "resolved", "closed"] as const;

export function AdminSupport() {
  const [res, setRes] = useState<TicketRes | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<{ ticket: Ticket; messages: Msg[]; customer_email: string } | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [view, setView] = useState<"tickets" | "conversations">("tickets");
  const [convos, setConvos] = useState<{ id: string; customer_email: string; topic: string; created_at: string }[]>([]);
  const [convoDetail, setConvoDetail] = useState<{ messages: Msg[]; customer_email: string } | null>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      if (view === "tickets") {
        setRes(await adminFetch<TicketRes>(`tickets${qs({ page, status, search: activeSearch, pageSize: 25 })}`));
      } else {
        const c = await adminFetch<{ conversations: { id: string; customer_email: string; topic: string; created_at: string }[] }>("ai-monitoring?pageSize=100");
        setConvos(c.conversations);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load support data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, status, activeSearch, view]);

  const openTicket = async (id: string) => {
    try {
      const d = await adminFetch<{ ticket: Ticket; messages: Msg[]; customer_email: string }>(`tickets/${id}`);
      setDetail(d);
      setReply("");
    } catch { setError("Failed to open ticket."); }
  };

  const sendReply = async () => {
    if (!detail || !reply.trim()) return;
    setSending(true);
    try {
      await adminFetch("tickets/reply", { json: { ticket_id: detail.ticket.id, message: reply.trim() } });
      await openTicket(detail.ticket.id);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Reply failed."); }
    finally { setSending(false); }
  };

  const changeStatus = async (id: string, newStatus: string) => {
    try {
      await adminFetch(`tickets/${id}`, { json: { status: newStatus } });
      await load();
      if (detail?.ticket.id === id) await openTicket(id);
    } catch (e) { setError(e instanceof Error ? e.message : "Status update failed."); }
  };

  return (
    <div>
      <PageHeader title="Support Center" subtitle="Customer complaints, requests and conversations" actions={<button onClick={load} className="inline-flex items-center gap-2 text-sm font-medium bg-white border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50"><RefreshCw className="w-4 h-4" /> Refresh</button>} />

      <div className="flex gap-2 mb-4">
        <button onClick={() => { setView("tickets"); setPage(1); }} className={`text-sm font-semibold px-4 py-2 rounded-lg ${view === "tickets" ? "bg-blue-600 text-white" : "bg-white border border-slate-200 text-slate-600"}`}>Support tickets</button>
        <button onClick={() => { setView("conversations"); setPage(1); }} className={`text-sm font-semibold px-4 py-2 rounded-lg ${view === "conversations" ? "bg-blue-600 text-white" : "bg-white border border-slate-200 text-slate-600"}`}>Chat conversations</button>
      </div>

      {view === "tickets" && res && (
        <div className="grid grid-cols-4 gap-3 mb-4">
          <Sum label="Total" value={res.summary.total} />
          <Sum label="Open" value={res.summary.open} tone="text-amber-600" />
          <Sum label="Pending" value={res.summary.pending} tone="text-blue-600" />
          <Sum label="Resolved" value={res.summary.resolved} tone="text-emerald-600" />
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        {view === "tickets" && STATUSES.map((s) => (
          <button key={s} onClick={() => { setStatus(s); setPage(1); }} className={`text-xs font-semibold px-3 py-1.5 rounded-full border capitalize ${status === s ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>{s}</button>
        ))}
        <form onSubmit={(e) => { e.preventDefault(); setPage(1); setActiveSearch(search.trim()); }} className="relative ml-auto">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={view === "tickets" ? "Search subject or case ref..." : ""} className="w-60 bg-white border border-slate-200 rounded-lg pl-9 pr-8 py-2 text-sm focus:outline-none focus:border-blue-400" />
          {activeSearch && <button type="button" onClick={() => { setSearch(""); setActiveSearch(""); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"><X className="w-4 h-4" /></button>}
        </form>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm mb-4">{error}</div>}

      {loading ? <div className="flex justify-center py-20"><RefreshCw className="w-6 h-6 animate-spin text-blue-600" /></div> : (
        view === "tickets" ? (
          <>
            <DataTable headers={["Case", "Customer", "Subject", "Priority", "Status", "Date", "Actions"]} empty={!res || res.tickets.length === 0}>
              {res?.tickets.map((t) => (
                <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                  <td className="py-3 px-4 font-mono text-xs text-slate-600">{t.case_ref}</td>
                  <td className="py-3 px-4 text-slate-700 max-w-[180px] truncate">{t.customer_email || "—"}</td>
                  <td className="py-3 px-4 font-medium text-slate-900 max-w-[220px] truncate">{t.subject}{t.escalated && <span className="ml-1 text-[10px] font-bold text-red-500">ESCALATED</span>}</td>
                  <td className="py-3 px-4 capitalize text-slate-600 text-xs">{t.priority}</td>
                  <td className="py-3 px-4"><StatusBadge status={t.status} /></td>
                  <td className="py-3 px-4 text-slate-500 text-xs">{fmtDate(t.created_at)}</td>
                  <td className="py-3 px-4">
                    <select value={t.status} onChange={(e) => changeStatus(t.id, e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white">
                      <option value="open">open</option><option value="pending">pending</option><option value="resolved">resolved</option><option value="closed">closed</option>
                    </select>
                    <button onClick={() => openTicket(t.id)} className="ml-2 text-blue-600 text-xs font-semibold hover:underline">Open</button>
                  </td>
                </tr>
              ))}
            </DataTable>
            {res && res.total > res.size && (
              <div className="flex items-center justify-between mt-4 text-sm text-slate-500">
                <span>Page {page} of {Math.max(1, Math.ceil(res.total / res.size))}</span>
                <div className="flex gap-2">
                  <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40">Previous</button>
                  <button disabled={page >= Math.ceil(res.total / res.size)} onClick={() => setPage(page + 1)} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40">Next</button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            <DataTable headers={["Customer", "Topic", "Started"]} empty={convos.length === 0}>
              {convos.map((c) => (
                <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50/60 cursor-pointer" onClick={async () => {
                  try { setConvoDetail(await adminFetch(`conversations/${c.id}`)); } catch { setError("Failed to load conversation."); }
                }}>
                  <td className="py-3 px-4 text-slate-700 max-w-[180px] truncate">{c.customer_email}</td>
                  <td className="py-3 px-4 text-slate-600">{c.topic}</td>
                  <td className="py-3 px-4 text-slate-500 text-xs">{fmtDate(c.created_at)}</td>
                </tr>
              ))}
            </DataTable>
            {convoDetail && (
              <div className="bg-white rounded-xl border border-slate-200 p-4 max-h-[70vh] overflow-y-auto">
                <p className="font-bold text-slate-900 text-sm mb-3">{convoDetail.customer_email}</p>
                {convoDetail.messages.map((m) => (
                  <div key={m.id} className={`mb-2 p-3 rounded-lg text-sm ${m.role === "user" ? "bg-slate-100" : "bg-blue-50"}`}>
                    <p className="text-[10px] font-bold uppercase text-slate-400 mb-1">{m.role === "user" ? "Customer" : "Assistant"} · {fmtDate(m.created_at)}</p>
                    <p className="whitespace-pre-wrap text-slate-800">{m.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-6" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-slate-100 px-6 py-4 flex items-center gap-3">
              <button onClick={() => setDetail(null)} className="text-slate-400 hover:text-slate-700"><ArrowLeft className="w-5 h-5" /></button>
              <div className="min-w-0">
                <h3 className="font-bold text-slate-900 truncate">{detail.ticket.subject}</h3>
                <p className="text-xs text-slate-500">{detail.ticket.case_ref} · {detail.customer_email} · {fmtDate(detail.ticket.created_at)}</p>
              </div>
              <div className="ml-auto"><StatusBadge status={detail.ticket.status} /></div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {detail.ticket.summary && <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800"><b>Summary:</b> {detail.ticket.summary}</div>}
              {detail.messages.length === 0 ? <p className="text-sm text-slate-400">No messages.</p> : detail.messages.map((m) => (
                <div key={m.id} className={`p-3 rounded-lg text-sm max-w-[85%] ${m.role === "user" ? "bg-slate-100" : m.meta?.kind === "admin_reply" ? "bg-emerald-50 border border-emerald-200 ml-auto" : "bg-blue-50"}`}>
                  <p className="text-[10px] font-bold uppercase text-slate-400 mb-1">{m.role === "user" ? "Customer" : m.meta?.kind === "admin_reply" ? "Admin reply" : "AI assistant"} · {fmtDate(m.created_at)}</p>
                  <p className="whitespace-pre-wrap text-slate-800">{m.content}</p>
                </div>
              ))}
            </div>
            <div className="border-t border-slate-100 p-4 flex gap-2">
              <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} placeholder="Write a reply to the customer..."
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 resize-none" />
              <button onClick={sendReply} disabled={sending || !reply.trim()} className="self-end inline-flex items-center gap-2 bg-blue-600 text-white text-sm font-semibold rounded-lg px-4 py-2.5 hover:bg-blue-700 disabled:opacity-50">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Reply className="w-4 h-4" />} Reply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Sum({ label, value, tone = "text-slate-900" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-2xl font-bold ${tone}`}>{value.toLocaleString()}</p>
    </div>
  );
}
