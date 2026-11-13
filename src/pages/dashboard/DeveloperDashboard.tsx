import { useCallback, useEffect, useState } from "react";
import {
  LayoutDashboard, KeyRound, Smartphone, Mail, BookOpen, FlaskConical, History, Webhook, ShieldCheck,
  Loader2, RefreshCw, DollarSign, ShoppingCart, Activity as ActivityIcon, CircleAlert as AlertCircle,
} from "lucide-react";
import { PageHeader } from "../../components/DashboardLayout";
import { useAuth } from "../../context/AuthContext";
import { formatNaira, timeAgo } from "../../lib/format";
import { devFetch } from "./developer/devFetch";
import type { DevStats, DevTxn, DevActivity } from "./developer/keys";
import { ApiKeysSection } from "./developer/ApiKeysSection";
import { WebhooksSection } from "./developer/WebhooksSection";
import { PlaygroundSection } from "./developer/PlaygroundSection";
import { DocsSection } from "./developer/DocsSection";

type Tab = "overview" | "keys" | "phone" | "email" | "docs" | "playground" | "usage" | "webhooks" | "security";

const TABS: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "keys", label: "API Keys", icon: KeyRound },
  { id: "phone", label: "Phone OTP API", icon: Smartphone },
  { id: "email", label: "Email OTP API", icon: Mail },
  { id: "docs", label: "Documentation", icon: BookOpen },
  { id: "playground", label: "Playground", icon: FlaskConical },
  { id: "usage", label: "Usage & History", icon: History },
  { id: "webhooks", label: "Webhooks", icon: Webhook },
  { id: "security", label: "Security", icon: ShieldCheck },
];

interface StatsResponse {
  stats: DevStats;
  transactions: DevTxn[];
  recentActivity: DevActivity[];
}

function StatTile({ label, value, icon: Icon }: { label: string; value: string; icon: typeof DollarSign }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center gap-2 text-xs text-slate-500 font-medium mb-1">
        <Icon className="w-3.5 h-3.5 text-royal-600" /> {label}
      </div>
      <p className="text-xl font-bold text-navy-900">{value}</p>
    </div>
  );
}

export function DeveloperDashboard() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [keyVersion, setKeyVersion] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await devFetch<StatsResponse>("stats"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load developer stats");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const stats = data?.stats;

  return (
    <div>
      <PageHeader title="Developer" subtitle="Build with the Monten SMS API — phone and email OTP, powered by your wallet." />

      <div className="flex gap-1 overflow-x-auto pb-1 mb-5 -mx-1 px-1" role="tablist">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-base ${tab === id ? "bg-navy-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : error ? (
            <div className="bg-error-50 border border-error-200 rounded-xl p-6 text-center">
              <AlertCircle className="w-6 h-6 text-error-500 mx-auto mb-2" />
              <p className="text-sm text-error-700">{error}</p>
              <button onClick={load} className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-royal-600 hover:bg-royal-700 text-white text-sm font-semibold">
                <RefreshCw className="w-4 h-4" /> Retry
              </button>
            </div>
          ) : stats ? (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatTile label="API requests" value={stats.totalRequests.toLocaleString()} icon={ActivityIcon} />
                <StatTile label="Successful" value={stats.successful.toLocaleString()} icon={ActivityIcon} />
                <StatTile label="Failed" value={stats.failed.toLocaleString()} icon={AlertCircle} />
                <StatTile label="Total spent" value={formatNaira(stats.totalSpent)} icon={DollarSign} />
                <StatTile label="Phone purchases" value={String(stats.phonePurchases)} icon={Smartphone} />
                <StatTile label="Email purchases" value={String(stats.emailPurchases)} icon={Mail} />
                <StatTile label="Wallet balance" value={formatNaira(stats.walletBalance)} icon={DollarSign} />
                <StatTile label="Site wallet" value={formatNaira(profile?.wallet_balance ?? 0)} icon={DollarSign} />
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <h3 className="font-semibold text-navy-900 text-sm mb-3">Recent API activity (last 24h)</h3>
                {!data || data.recentActivity.length === 0 ? (
                  <p className="text-sm text-slate-400 py-4 text-center">No API activity yet. Create a key in the API Keys tab and make your first call.</p>
                ) : (
                  <div className="divide-y divide-slate-50">
                    {data.recentActivity.map((a, i) => (
                      <div key={i} className="py-2 flex items-center gap-3 text-xs">
                        <span className={`font-bold ${a.status_code < 400 ? "text-emerald-600" : "text-red-500"}`}>{a.status_code}</span>
                        <span className="font-mono text-slate-600">{a.method} /{a.endpoint}</span>
                        <span className="text-slate-400">{a.response_ms ?? "—"} ms</span>
                        <span className="ml-auto text-slate-400">{timeAgo(a.created_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      )}

      {tab === "keys" && <ApiKeysSection changed={keyVersion} />}

      {tab === "phone" && <DocsSection subset="phone" />}

      {tab === "email" && <DocsSection subset="email" />}

      {tab === "docs" && <DocsSection />}

      {tab === "playground" && <PlaygroundSection />}

      {tab === "usage" && (
        <div className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-[11px] text-slate-400 uppercase tracking-wide border-b border-slate-100">
                  <th className="py-3 px-4 font-semibold">Order</th>
                  <th className="py-3 px-4 font-semibold">Type</th>
                  <th className="py-3 px-4 font-semibold">Service</th>
                  <th className="py-3 px-4 font-semibold">Amount</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold">Date</th>
                </tr>
              </thead>
              <tbody>
                {(data?.transactions ?? []).length === 0 ? (
                  <tr><td colSpan={6} className="py-10 text-center text-slate-400">No API transactions yet.</td></tr>
                ) : (
                  data?.transactions.map((t: DevTxn) => (
                    <tr key={t.order_ref} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="py-3 px-4 font-mono text-xs text-navy-900">{t.order_ref}</td>
                      <td className="py-3 px-4 capitalize">{t.kind}</td>
                      <td className="py-3 px-4">{t.service ?? "—"}</td>
                      <td className="py-3 px-4 font-semibold">{formatNaira(Number(t.amount))}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${t.status === "completed" ? "bg-emerald-100 text-emerald-700" : t.status === "failed" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-700"}`}>{t.status}</span>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-400">{new Date(t.created_at).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400">Purchases shown here were made with your API keys. Wallet funding happens on the normal Fund Wallet page — both share one balance.</p>
        </div>
      )}

      {tab === "webhooks" && <WebhooksSection />}

      {tab === "security" && (
        <div className="space-y-3">
          {[
            ["Hashed keys", "Your API keys are stored as SHA-256 hashes. Even a database leak can never reveal them — that's why the full key is shown only once at creation."],
            ["Per-key isolation", "Every request is scoped to your account. No key can see or spend another developer's orders, data or wallet."],
            ["Rate limiting", "Requests are rate-limited per account. Abuse from one key can never affect other developers."],
            ["Idempotent purchases", "Duplicate purchase calls with the same order_ref return the original order — never a double charge."],
            ["Atomic wallet debits", "Purchases debit your wallet in a single database transaction. Failed provider calls are auto-refunded."],
            ["Signed webhooks", "Every webhook is signed with HMAC-SHA256 so you can verify it really came from Monten."],
            ["Revocable keys", "Lose a key? Revoke it instantly from the API Keys tab and regenerate. Revoked keys stop working immediately."],
          ].map(([title, desc]) => (
            <div key={title} className="bg-white border border-slate-200 rounded-xl p-4 flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-emerald-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-navy-900">{title}</p>
                <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
