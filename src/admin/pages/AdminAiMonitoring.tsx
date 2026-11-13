import { useEffect, useState } from "react";
import { adminFetch, fmtDate, PageHeader, DataTable } from "../adminApi";
import { RefreshCw, Bot, Users, MessageSquare, ArrowUpRight } from "lucide-react";

interface Res {
  summary: { conversations: number; messages: number; customersHelped: number; escalated: number; recent: number };
  conversations: { id: string; customer_email: string; topic: string; created_at: string }[];
  recentMessages: { id: string; role: string; content: string; meta: Record<string, unknown> | null; created_at: string }[];
}

export function AdminAiMonitoring() {
  const [res, setRes] = useState<Res | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setRes(await adminFetch<Res>("ai-monitoring?pageSize=50"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load AI monitoring data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div>
      <PageHeader title="AI Monitoring" subtitle="Support assistant conversations and health. Sensitive data (passwords, OTP codes, payment details) is never stored in chats." actions={<button onClick={load} className="inline-flex items-center gap-2 text-sm font-medium bg-white border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50"><RefreshCw className="w-4 h-4" /> Refresh</button>} />

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm mb-4">{error}</div>}

      {res && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <Stat icon={<MessageSquare className="w-4 h-4" />} label="AI conversations" value={res.summary.conversations} />
            <Stat icon={<Users className="w-4 h-4" />} label="Customers helped" value={res.summary.customersHelped} />
            <Stat icon={<Bot className="w-4 h-4" />} label="Messages exchanged" value={res.summary.messages} />
            <Stat icon={<ArrowUpRight className="w-4 h-4" />} label="Escalated issues" value={res.summary.escalated} tone={res.summary.escalated > 0 ? "text-red-600" : "text-emerald-600"} />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div>
              <h2 className="font-bold text-slate-900 mb-2 text-sm">Recent questions and answers</h2>
              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                {res.recentMessages.length === 0 && <p className="text-sm text-slate-400">No AI conversations recorded yet.</p>}
                {res.recentMessages.map((m) => (
                  <div key={m.id} className="bg-white rounded-xl border border-slate-200 p-3">
                    <p className="text-[10px] font-bold uppercase text-slate-400 mb-1">{m.role === "user" ? "Customer asked" : "Assistant replied"} · {fmtDate(m.created_at)}</p>
                    <p className="text-sm text-slate-800 whitespace-pre-wrap line-clamp-4">{m.content.slice(0, 400)}</p>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h2 className="font-bold text-slate-900 mb-2 text-sm">Conversations by customer</h2>
              <DataTable headers={["Customer", "Topic", "Started"]} empty={res.conversations.length === 0}>
                {res.conversations.map((c) => (
                  <tr key={c.id} className="border-b border-slate-50">
                    <td className="py-3 px-4 text-slate-700 max-w-[180px] truncate">{c.customer_email}</td>
                    <td className="py-3 px-4 text-slate-600">{c.topic}</td>
                    <td className="py-3 px-4 text-slate-500 text-xs">{fmtDate(c.created_at)}</td>
                  </tr>
                ))}
              </DataTable>
              <div className="mt-4 bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-500 space-y-1">
                <p className="font-bold text-slate-700">AI service status</p>
                <p>The assistant falls back to built-in support answers whenever the AI provider is unavailable, so customers are never left without help. Live API usage and cost reporting appear here once the Gemini quota is active on your key.</p>
              </div>
            </div>
          </div>
        </>
      )}

      {loading && <div className="flex justify-center py-20"><RefreshCw className="w-6 h-6 animate-spin text-blue-600" /></div>}
    </div>
  );
}

function Stat({ icon, label, value, tone = "text-slate-900" }: { icon: React.ReactNode; label: string; value: number; tone?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-2 text-slate-400 mb-1">{icon}<p className="text-xs font-medium">{label}</p></div>
      <p className={`text-2xl font-bold ${tone}`}>{value.toLocaleString()}</p>
    </div>
  );
}
