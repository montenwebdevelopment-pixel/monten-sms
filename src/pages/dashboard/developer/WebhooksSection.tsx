import { useEffect, useState } from "react";
import { Webhook, Plus, Trash2, Loader2, Check, X, Activity, Copy } from "lucide-react";
import { devFetch, copyText } from "./devFetch";
import type { DevWebhook, DevDelivery } from "./keys";

export function WebhooksSection() {
  const [webhooks, setWebhooks] = useState<DevWebhook[]>([]);
  const [deliveries, setDeliveries] = useState<DevDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [newSecret, setNewSecret] = useState<{ id: string; url: string; secret: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    try {
      const body = await devFetch<{ webhooks: DevWebhook[]; deliveries: DevDelivery[] }>("webhooks");
      setWebhooks(body.webhooks ?? []);
      setDeliveries(body.deliveries ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load webhooks");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const add = async () => {
    setAdding(true);
    setError("");
    try {
      const body = await devFetch<{ webhook: DevWebhook; secret: string }>("webhooks", { json: { url: url.trim() } });
      setWebhooks((prev) => [body.webhook, ...prev]);
      setNewSecret({ id: body.webhook.id, url: body.webhook.url, secret: body.secret });
      setUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add webhook");
    } finally {
      setAdding(false);
    }
  };

  const toggle = async (w: DevWebhook) => {
    setBusyId(w.id);
    try {
      await devFetch(`webhooks/${w.id}`, { method: "PUT", json: { active: !w.active } });
      setWebhooks((prev) => prev.map((x) => (x.id === w.id ? { ...x, active: !w.active } : x)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update webhook");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (w: DevWebhook) => {
    setBusyId(w.id);
    try {
      await devFetch(`webhooks/${w.id}`, { method: "DELETE", json: {} });
      setWebhooks((prev) => prev.filter((x) => x.id !== w.id));
      setDeliveries((prev) => prev.filter((d) => d.webhook_id !== w.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete webhook");
    } finally {
      setBusyId(null);
    }
  };

  const copySecret = async () => {
    if (newSecret && (await copyText(newSecret.secret))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      {newSecret && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <div className="text-emerald-800 font-semibold text-sm mb-1">Webhook signing secret (shown once)</div>
          <p className="text-xs text-emerald-700 mb-2">Verify deliveries by hashing the raw request body with HMAC-SHA256 using this secret and comparing it to the X-Monten-Signature header.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white border border-emerald-200 rounded-lg px-3 py-2 text-xs font-mono break-all text-navy-900">{newSecret.secret}</code>
            <button onClick={copySecret} className="flex-shrink-0 p-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white" aria-label="Copy secret">
              {copied ? <Check className="w-4 h-4" /> : <X className="w-4 h-4 hidden" />}
              {!copied && <Copy className="w-4 h-4" />}
            </button>
          </div>
          <button onClick={() => setNewSecret(null)} className="text-xs font-medium text-emerald-700 hover:text-emerald-900 mt-2 underline">Done</button>
        </div>
      )}

      {error && <p className="text-sm text-error-600 bg-error-50 border border-error-200 rounded-lg px-3 py-2">{error}</p>}

      <div>
        <h3 className="font-semibold text-navy-900 mb-2">Your webhook endpoints</h3>
        <div className="flex gap-2 mb-3">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://yourapp.com/monten-webhook"
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-royal-500"
          />
          <button onClick={add} disabled={adding || !url.trim() || webhooks.length >= 3} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-royal-600 hover:bg-royal-700 disabled:bg-slate-300 text-white text-sm font-semibold transition-base flex-shrink-0">
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add
          </button>
        </div>
        {webhooks.length === 0 ? (
          <p className="text-sm text-slate-400 bg-slate-50 border border-slate-200 rounded-lg p-4">
            No webhooks yet. We POST JSON events (order.created, otp.received, order.cancelled, order.failed) to your URL — signed with X-Monten-Signature.
          </p>
        ) : (
          <div className="space-y-2">
            {webhooks.map((w) => (
              <div key={w.id} className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3">
                <Webhook className={`w-4 h-4 flex-shrink-0 ${w.active ? "text-emerald-600" : "text-slate-300"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-navy-900 font-mono truncate">{w.url}</p>
                  <p className="text-[11px] text-slate-400">Added {new Date(w.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}</p>
                </div>
                <button onClick={() => toggle(w)} disabled={busyId === w.id} aria-label={w.active ? "Pause webhook" : "Resume webhook"} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-base">
                  {w.active ? "Pause" : "Resume"}
                </button>
                <button onClick={() => remove(w)} disabled={busyId === w.id} aria-label="Delete webhook" className="p-2 rounded-lg hover:bg-red-50 text-red-500 transition-base">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="font-semibold text-navy-900 mb-2 flex items-center gap-2"><Activity className="w-4 h-4 text-royal-600" /> Delivery log</h3>
        {deliveries.length === 0 ? (
          <p className="text-sm text-slate-400 bg-slate-50 border border-slate-200 rounded-lg p-4">No deliveries yet. Events appear here once your keys start making purchases.</p>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            {deliveries.map((d) => (
              <div key={d.id} className="px-4 py-3 flex items-center gap-3 text-sm">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${d.status === "delivered" ? "bg-emerald-100 text-emerald-700" : d.status === "failed" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-700"}`}>{d.status}</span>
                <span className="font-mono text-xs text-navy-900">{d.event}</span>
                <span className="text-xs text-slate-400 hidden sm:inline">attempts: {d.attempts}{d.response_status ? ` · HTTP ${d.response_status}` : ""}{d.last_error ? ` · ${d.last_error.slice(0, 60)}` : ""}</span>
                <span className="ml-auto text-[11px] text-slate-400 flex-shrink-0">{new Date(d.created_at).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-slate-400 mt-2">Retries: 1 min, 5 min, then 30 min. Orders that keep failing are marked failed after ~4 attempts.</p>
      </div>
    </div>
  );
}
