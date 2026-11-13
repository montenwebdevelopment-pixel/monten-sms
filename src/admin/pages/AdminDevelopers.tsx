import { useCallback, useEffect, useState } from "react";
import { Search, Loader2, RefreshCw, ChevronRight, KeyRound, Ban, CheckCircle2, Settings2, AlertCircle, X } from "lucide-react";
import { adminFetch, qs, fmtNaira, fmtDate, PageHeader, StatCard, DataTable } from "../adminApi";

interface DevRow {
  user_id: string;
  email: string;
  full_name: string;
  wallet_balance: number;
  keys: number;
  activeKeys: number;
  liveKeys: number;
  requests: number;
  failed: number;
  spent: number;
  webhooks: number;
  lastUsed: string | null;
}

interface KeyRow {
  id: string;
  name: string;
  key_prefix: string;
  environment: string;
  active: boolean;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface UsageRow { endpoint: string; method: string; status_code: number; response_ms: number | null; created_at: string }
interface TxnRow { order_ref: string; kind: string; service: string | null; country: string | null; amount: number; status: string; created_at: string }
interface HookRow { id: string; url: string; active: boolean; created_at: string }
interface DeliveryRow { id: string; event: string; status: string; attempts: number; response_status: number | null; last_error: string | null; created_at: string }

interface Detail {
  profile: { email: string; full_name: string; wallet_balance: number } | null;
  keys: KeyRow[];
  usage: UsageRow[];
  transactions: TxnRow[];
  webhooks: HookRow[];
  deliveries: DeliveryRow[];
}

interface Config {
  phone_rate_limit_per_min: number;
  email_rate_limit_per_min: number;
  phone_margin_naira: number;
  email_price_naira: number;
  enabled: boolean;
}

export function AdminDevelopers() {
  const [rows, setRows] = useState<DevRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configMsg, setConfigMsg] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async (s: string) => {
    setLoading(true);
    setError("");
    try {
      const body = await adminFetch<{ developers: DevRow[] }>(`developers${qs({ search: s })}`);
      setRows(body.developers ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load developers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(""); }, [load]);

  const openDetail = async (userId: string) => {
    setDetailId(userId);
    setDetailLoading(true);
    setDetail(null);
    try {
      setDetail(await adminFetch<Detail>(`developers/${userId}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load developer");
    } finally {
      setDetailLoading(false);
    }
  };

  const loadConfig = useCallback(async () => {
    try {
      const body = await adminFetch<{ config: Config }>("developer-config");
      setConfig(body.config);
    } catch {
      // config panel simply stays hidden if unreachable
    }
  }, []);
  useEffect(() => { void loadConfig(); }, [loadConfig]);

  const saveConfig = async () => {
    if (!config) return;
    setSavingConfig(true);
    setConfigMsg("");
    try {
      await adminFetch("developer-config", { json: config });
      setConfigMsg("Saved.");
    } catch (err) {
      setConfigMsg(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavingConfig(false);
    }
  };

  const toggleKey = async (k: KeyRow) => {
    if (!detail) return;
    setBusyKey(k.id);
    try {
      await adminFetch(`developer-keys/${k.id}`, { json: { active: !k.active } });
      setDetail({ ...detail, keys: detail.keys.map((x) => (x.id === k.id ? { ...x, active: !k.active } : x)) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update key");
    } finally {
      setBusyKey(null);
    }
  };

  const totals = rows.reduce((a, r) => ({ requests: a.requests + r.requests, spent: a.spent + r.spent, keys: a.keys + r.keys }), { requests: 0, spent: 0, keys: 0 });

  return (
    <div>
      <PageHeader
        title="Developers"
        subtitle="API consumers: keys, usage, spending and webhook health."
        actions={
          <button onClick={() => load(search)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-50">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard label="Developers with keys" value={rows.length} />
        <StatCard label="API keys issued" value={totals.keys} />
        <StatCard label="API requests" value={totals.requests.toLocaleString()} />
        <StatCard label="API revenue (completed)" value={fmtNaira(totals.spent)} tone="success" />
      </div>

      {config && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Settings2 className="w-4 h-4 text-slate-500" />
            <h3 className="font-semibold text-slate-900 text-sm">Developer API settings</h3>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 items-end">
            {([
              ["phone_rate_limit_per_min", "Phone rate / min"],
              ["email_rate_limit_per_min", "Email rate / min"],
              ["phone_margin_naira", "Phone margin (₦)"],
              ["email_price_naira", "Email price (₦)"],
            ] as [keyof Config, string][]).map(([k, label]) => (
              <div key={k}>
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">{label}</label>
                <input
                  type="number"
                  min={0}
                  value={config[k] as number}
                  onChange={(e) => setConfig({ ...config, [k]: Number(e.target.value) })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            ))}
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">API enabled</label>
              <button
                onClick={() => setConfig({ ...config, enabled: !config.enabled })}
                className={`w-full px-3 py-2 rounded-lg text-sm font-semibold ${config.enabled ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}
              >
                {config.enabled ? "Enabled" : "Disabled"}
              </button>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button onClick={saveConfig} disabled={savingConfig} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-60">
              {savingConfig && <Loader2 className="w-4 h-4 animate-spin" />} Save settings
            </button>
            {configMsg && <span className="text-sm text-slate-500">{configMsg}</span>}
          </div>
        </div>
      )}

      {error && <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      <div className="flex gap-2 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void load(search); }}
            placeholder="Search developer email or name…"
            className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
        </div>
        <button onClick={() => load(search)} className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700">Search</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-400">No developers have created API keys yet.</div>
      ) : (
        <DataTable headers={["Developer", "Keys", "Requests", "Failures", "Spent", "Wallet", "Webhooks", "Last used", ""]}>
          {rows.map((r) => (
            <tr key={r.user_id} className="border-b border-slate-50 hover:bg-slate-50">
              <td className="py-3 px-4">
                <p className="text-sm font-medium text-slate-900">{r.full_name || r.email}</p>
                <p className="text-xs text-slate-400">{r.email}</p>
              </td>
              <td className="py-3 px-4 text-sm">{r.activeKeys}/{r.keys} active{r.liveKeys > 0 && <span className="ml-1 text-[10px] font-bold text-slate-500">(live)</span>}</td>
              <td className="py-3 px-4 text-sm">{r.requests.toLocaleString()}</td>
              <td className={`py-3 px-4 text-sm ${r.failed > 0 ? "text-red-600 font-semibold" : ""}`}>{r.failed.toLocaleString()}</td>
              <td className="py-3 px-4 text-sm font-semibold">{fmtNaira(r.spent)}</td>
              <td className="py-3 px-4 text-sm">{fmtNaira(r.wallet_balance)}</td>
              <td className="py-3 px-4 text-sm">{r.webhooks}</td>
              <td className="py-3 px-4 text-xs text-slate-400">{r.lastUsed ? fmtDate(r.lastUsed) : "never"}</td>
              <td className="py-3 px-4">
                <button onClick={() => openDetail(r.user_id)} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800">View <ChevronRight className="w-3.5 h-3.5" /></button>
              </td>
            </tr>
          ))}
        </DataTable>
      )}

      {(detailId || detailLoading) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => { setDetailId(null); setDetail(null); }}>
          <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {detailLoading || !detail ? (
              <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
            ) : (
              <div className="p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-bold text-slate-900">{detail.profile?.full_name || detail.profile?.email || "Developer"}</h3>
                    <p className="text-sm text-slate-500">{detail.profile?.email} · Wallet {fmtNaira(detail.profile?.wallet_balance ?? 0)}</p>
                  </div>
                  <button onClick={() => { setDetailId(null); setDetail(null); }} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-4 h-4" /></button>
                </div>

                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5"><KeyRound className="w-3.5 h-3.5" /> API keys</h4>
                <div className="space-y-2 mb-5">
                  {detail.keys.length === 0 && <p className="text-sm text-slate-400">No keys.</p>}
                  {detail.keys.map((k) => (
                    <div key={k.id} className="border border-slate-200 rounded-lg px-3 py-2 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900">{k.name} <span className="text-[10px] font-bold uppercase text-slate-400">{k.environment}</span></p>
                        <p className="text-xs font-mono text-slate-400">{k.key_prefix}•••• · created {fmtDate(k.created_at)} · last used {k.last_used_at ? fmtDate(k.last_used_at) : "never"}</p>
                      </div>
                      <button
                        onClick={() => toggleKey(k)}
                        disabled={busyKey === k.id}
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold ${k.active ? "bg-red-50 text-red-600 hover:bg-red-100" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}
                      >
                        {k.active ? <><Ban className="w-3.5 h-3.5" /> Revoke</> : <><CheckCircle2 className="w-3.5 h-3.5" /> Activate</>}
                      </button>
                    </div>
                  ))}
                </div>

                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Recent transactions</h4>
                <div className="space-y-1.5 mb-5">
                  {detail.transactions.length === 0 && <p className="text-sm text-slate-400">No API purchases.</p>}
                  {detail.transactions.slice(0, 10).map((t) => (
                    <div key={t.order_ref} className="flex items-center gap-3 text-sm border-b border-slate-50 pb-1.5">
                      <span className="font-mono text-xs text-slate-600">{t.order_ref}</span>
                      <span className="capitalize text-xs">{t.kind} · {t.service ?? "—"}{t.country ? ` (${t.country})` : ""}</span>
                      <span className="font-semibold text-sm">{fmtNaira(t.amount)}</span>
                      <span className={`ml-auto text-[10px] font-bold uppercase ${t.status === "completed" ? "text-emerald-600" : t.status === "failed" ? "text-red-500" : "text-amber-600"}`}>{t.status}</span>
                    </div>
                  ))}
                </div>

                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Recent API activity</h4>
                <div className="space-y-1 mb-5">
                  {detail.usage.length === 0 && <p className="text-sm text-slate-400">No API calls yet.</p>}
                  {detail.usage.slice(0, 10).map((u, i) => (
                    <div key={i} className="flex items-center gap-3 text-xs">
                      <span className={`font-bold ${u.status_code < 400 ? "text-emerald-600" : "text-red-500"}`}>{u.status_code}</span>
                      <span className="font-mono">{u.method} /{u.endpoint}</span>
                      <span className="text-slate-400">{u.response_ms ?? "—"} ms</span>
                      <span className="ml-auto text-slate-400">{fmtDate(u.created_at)}</span>
                    </div>
                  ))}
                </div>

                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> Webhook deliveries</h4>
                <div className="space-y-1">
                  {detail.deliveries.length === 0 && <p className="text-sm text-slate-400">No webhook deliveries.</p>}
                  {detail.deliveries.slice(0, 10).map((d) => (
                    <div key={d.id} className="flex items-center gap-3 text-xs">
                      <span className={`px-1.5 py-0.5 rounded font-bold uppercase text-[10px] ${d.status === "delivered" ? "bg-emerald-100 text-emerald-700" : d.status === "failed" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-700"}`}>{d.status}</span>
                      <span className="font-mono">{d.event}</span>
                      <span className="text-slate-400">{d.attempts} attempts{d.last_error ? ` · ${d.last_error.slice(0, 50)}` : ""}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
