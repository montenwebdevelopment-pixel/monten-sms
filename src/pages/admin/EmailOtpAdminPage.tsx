import { useEffect, useState } from "react";
import { supabase, EDGE_FUNCTION_BASE } from "../../lib/supabase";
import { Card, Button, Input, Spinner } from "../../components/ui";
import { Mail, RefreshCw, Save, Activity } from "lucide-react";
import { formatNaira } from "../../lib/format";

interface AdminOrder {
  id: string;
  user_id: string;
  service: string;
  email_address: string | null;
  status: string;
  charge_naira: number | string | null;
  provider_price_usd: number | string | null;
  created_at: string;
}

export function EmailOtpAdminPage() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [config, setConfig] = useState<{ usdToNaira: number; marginNaira: number; serviceOverrides: Record<string, number> } | null>(null);
  const [usd, setUsd] = useState("1600");
  const [margin, setMargin] = useState("500");
  const [overridesText, setOverridesText] = useState("{}");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [provider, setProvider] = useState<{ balance?: string; paused_until?: string } | null>(null);

  const getHeaders = async () => {
    const { data } = await supabase.auth.getSession();
    return {
      Authorization: `Bearer ${data.session?.access_token ?? ""}`,
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    };
  };

  const loadAll = async () => {
    setLoading(true);
    setError("");
    try {
      const headers = await getHeaders();
      const [ordersRes, configRes, providerRes] = await Promise.all([
        fetch(`${EDGE_FUNCTION_BASE}/mailotp-proxy/admin/orders`, { headers }),
        fetch(`${EDGE_FUNCTION_BASE}/mailotp-proxy/admin/config`, { headers }),
        fetch(`${EDGE_FUNCTION_BASE}/mailotp-proxy/admin/provider`, { headers }),
      ]);
      if (!ordersRes.ok || !configRes.ok) {
        setError("Failed to load admin data. Owner account only.");
        return;
      }
      const ordersBody = await ordersRes.json();
      setOrders(ordersBody.orders ?? []);
      const configBody = await configRes.json();
      if (configBody.config) {
        setConfig(configBody.config);
        setUsd(String(configBody.config.usdToNaira));
        setMargin(String(configBody.config.marginNaira));
        setOverridesText(JSON.stringify(configBody.config.serviceOverrides ?? {}, null, 2));
      }
      if (providerRes.ok) {
        const providerBody = await providerRes.json();
        setProvider(providerBody.provider ?? null);
      }
    } catch {
      setError("Failed to load admin data. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const saveConfig = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      let overrides: unknown;
      try { overrides = JSON.parse(overridesText); } catch {
        setSaveMsg("Service overrides must be valid JSON, e.g. {\"instagram\": 1500}");
        return;
      }
      const headers = await getHeaders();
      const resp = await fetch(`${EDGE_FUNCTION_BASE}/mailotp-proxy/admin/config`, {
        method: "POST", headers,
        body: JSON.stringify({ usdToNaira: Number(usd), marginNaira: Number(margin), serviceOverrides: overrides }),
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setSaveMsg(body?.error ?? "Failed to save settings.");
        return;
      }
      setSaveMsg("Settings saved.");
    } catch {
      setSaveMsg("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  const stats = {
    total: orders.length,
    received: orders.filter((o) => o.status === "received").length,
    waiting: orders.filter((o) => o.status === "waiting").length,
    refunded: orders.filter((o) => ["timeout", "cancelled", "failed"].includes(o.status)).length,
    revenue: orders.reduce((sum, o) => sum + Number(o.charge_naira ?? 0), 0),
    cost: orders.reduce((sum, o) => sum + Number(o.provider_price_usd ?? 0) * (config?.usdToNaira ?? 1600), 0),
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail className="w-6 h-6 text-royal-600" />
            <h1 className="text-2xl font-bold text-navy-900">Email OTP Admin</h1>
          </div>
          <Button variant="outline" onClick={loadAll} disabled={loading}><RefreshCw className="w-4 h-4" /> Refresh</Button>
        </div>

        {error && <Card className="p-4 text-sm text-error-700 bg-error-50 border border-error-200">{error}</Card>}
        {loading ? (
          <Card className="p-8 flex justify-center"><Spinner className="w-8 h-8 text-royal-600" /></Card>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Card className="p-4"><p className="text-xs text-slate-500">Total Orders</p><p className="text-xl font-bold text-navy-900">{stats.total}</p></Card>
              <Card className="p-4"><p className="text-xs text-slate-500">Successful</p><p className="text-xl font-bold text-success-600">{stats.received}</p></Card>
              <Card className="p-4"><p className="text-xs text-slate-500">Refunded</p><p className="text-xl font-bold text-warning-600">{stats.refunded}</p></Card>
              <Card className="p-4"><p className="text-xs text-slate-500">Revenue</p><p className="text-xl font-bold text-navy-900">{formatNaira(stats.revenue)}</p></Card>
            </div>

            <Card className="p-6">
              <h2 className="font-bold text-navy-900 mb-4 flex items-center gap-2"><Activity className="w-5 h-5 text-royal-600" /> Pricing Settings</h2>
              <div className="grid sm:grid-cols-2 gap-4 mb-4">
                <Input label="USD to Naira rate" value={usd} onChange={setUsd} />
                <Input label="Margin per code (₦)" value={margin} onChange={setMargin} />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-1">Per-service price overrides (₦, JSON)</label>
                <textarea
                  value={overridesText}
                  onChange={(e) => setOverridesText(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  placeholder='{"instagram": 1500}'
                />
              </div>
              {saveMsg && <p className={`text-sm mb-3 ${saveMsg === "Settings saved." ? "text-success-600" : "text-error-600"}`}>{saveMsg}</p>}
              <Button onClick={saveConfig} loading={saving} disabled={saving}><Save className="w-4 h-4" /> Save Settings</Button>
              {provider && (
                <p className="text-xs text-slate-400 mt-3">
                  Provider balance: {provider.balance ? `$${provider.balance}` : "unknown"}
                  {provider.paused_until ? ` · paused until ${provider.paused_until}` : ""}
                </p>
              )}
            </Card>

            <Card className="p-6">
              <h2 className="font-bold text-navy-900 mb-4">Recent Orders</h2>
              {orders.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">No email OTP orders yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-400 uppercase border-b border-slate-100">
                        <th className="py-2 pr-4">Service</th><th className="py-2 pr-4">Email</th><th className="py-2 pr-4">Status</th>
                        <th className="py-2 pr-4">Charge</th><th className="py-2 pr-4">Cost (USD)</th><th className="py-2">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.slice(0, 50).map((o) => (
                        <tr key={o.id} className="border-b border-slate-50">
                          <td className="py-2 pr-4 font-medium text-navy-900 capitalize">{o.service}</td>
                          <td className="py-2 pr-4 text-royal-700 max-w-[200px] truncate">{o.email_address ?? "—"}</td>
                          <td className="py-2 pr-4"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${o.status === "received" ? "bg-success-100 text-success-700" : o.status === "waiting" ? "bg-royal-100 text-royal-700" : "bg-slate-100 text-slate-600"}`}>{o.status}</span></td>
                          <td className="py-2 pr-4 font-bold text-navy-900">{formatNaira(Number(o.charge_naira ?? 0))}</td>
                          <td className="py-2 pr-4 text-slate-500">{o.provider_price_usd !== null ? `$${Number(o.provider_price_usd).toFixed(4)}` : "—"}</td>
                          <td className="py-2 text-slate-500">{new Date(o.created_at).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
