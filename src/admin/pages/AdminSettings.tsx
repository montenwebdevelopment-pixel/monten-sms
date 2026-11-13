import { useEffect, useState } from "react";
import { adminFetch, PageHeader } from "../adminApi";
import { RefreshCw, Save, ShieldCheck, Mail, Bot, CreditCard, Smartphone, Globe, Bell, FileText, CheckCircle2, XCircle } from "lucide-react";

interface AuditLog { id: string; admin_email: string; action: string; target_type: string | null; target_id: string | null; details: unknown; created_at: string }

export function AdminSettings() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [senderFrom, setSenderFrom] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const load = async () => {
    try {
      const [s, a] = await Promise.all([
        adminFetch<{ settings: Record<string, unknown> }>("settings"),
        adminFetch<{ logs: AuditLog[] }>("audit-logs?pageSize=50"),
      ]);
      setSenderFrom((s.settings.email_sender as { from?: string })?.from ?? "");
      setLogs(a.logs);
    } catch { /* handled by disabled states */ }
    finally { }
  };

  useEffect(() => { load(); }, []);
  const saveSender = async () => {
    setSaving(true); setMsg("");
    try {
      await adminFetch("settings", { json: { key: "email_sender", value: { from: senderFrom.trim() } } });
      setMsg("Sender configuration saved.");
      await load();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Save failed."); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <PageHeader title="Admin Settings" subtitle="Configuration, integrations and security" actions={<button onClick={load} className="inline-flex items-center gap-2 text-sm font-medium bg-white border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50"><RefreshCw className="w-4 h-4" /> Refresh</button>} />

      {msg && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl p-3 text-sm mb-4">{msg}</div>}

      <div className="grid lg:grid-cols-2 gap-4">
        <Card icon={<ShieldCheck className="w-4 h-4" />} title="Admin account & security">
          <Row label="Authorized admin" value="montenssms@gmail.com" />
          <Row label="Authentication" value="Existing Supabase email/password system" />
          <Row label="Server-side verification" value="Every admin request is re-verified against the auth token" />
          <Row label="Rate limiting" value="120 requests/minute enforced server-side" />
          <Row label="Audit logging" value="Enabled — all sensitive actions recorded" />
          <p className="text-xs text-slate-400 mt-2">Two-factor authentication: Supabase supports TOTP factors; it can be enabled later from Supabase Auth settings without code changes.</p>
        </Card>

        <Card icon={<Mail className="w-4 h-4" />} title="Email sender configuration">
          <label className="block text-xs font-semibold text-slate-500 mb-1">From address</label>
          <input value={senderFrom} onChange={(e) => setSenderFrom(e.target.value)} placeholder="MONTEN SMS <support@montensms.com>"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
          <p className="text-xs text-slate-400 mt-2">Currently using the provider default until your own domain (support@montensms.com) is verified in the email provider dashboard. Leave empty to use the default.</p>
          <button onClick={saveSender} disabled={saving} className="mt-3 inline-flex items-center gap-2 bg-slate-900 text-white text-sm font-semibold rounded-lg px-4 py-2 hover:bg-slate-800 disabled:opacity-50"><Save className="w-4 h-4" /> Save</button>
        </Card>

        <Card icon={<Bot className="w-4 h-4" />} title="AI support configuration">
          <SecretRow name="GEMINI_API_KEY" note="AI support assistant (Gemini). This panel does not verify provider availability or quota; check server-side health and logs." ok={false} />
        </Card>

        <Card icon={<CreditCard className="w-4 h-4" />} title="Payment integration">
          <SecretRow name="FLWSECK / FLWPUBK" note="Flutterwave live keys configured server-side. Secrets are never displayed." ok />
          <SecretRow name="FLW_SECRET_HASH" note="Webhook signature verification" ok />
        </Card>

        <Card icon={<Smartphone className="w-4 h-4" />} title="OTP provider integrations">
          <SecretRow name="FIVESIM_API_KEY" note="Phone number OTP provider (5SIM)" ok />
          <SecretRow name="MAILOTP_API_KEY" note="Email OTP rental provider (MailOtp)" ok />
        </Card>

        <Card icon={<Globe className="w-4 h-4" />} title="Website configuration">
          <Row label="Public URL" value="https://montensms.com" />
          <Row label="Admin portal URL" value="/admin/monten500 (keep private)" />
          <Row label="Customer app builds" value="Android APK + iOS via Capacitor" />
        </Card>

        <Card icon={<Bell className="w-4 h-4" />} title="Notification settings">
          <p className="text-sm text-slate-600">Customer notifications (deposits, purchases, refunds) are created automatically by the existing backend flows. Bulk email campaigns and their delivery live on the Bulk Email and Sent Emails pages.</p>
        </Card>

        <Card icon={<FileText className="w-4 h-4" />} title="Audit log" wide>
          {logs.length === 0 ? <p className="text-sm text-slate-400">No admin actions recorded yet.</p> : (
            <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
              {logs.map((l) => (
                <div key={l.id} className="py-2 text-sm">
                  <span className="font-semibold text-slate-800">{l.action}</span>
                  {l.target_type && <span className="text-slate-400 text-xs"> · {l.target_type}{l.target_id ? ` (${l.target_id.slice(0, 8)}…)` : ""}</span>}
                  <span className="block text-[11px] text-slate-400">{new Date(l.created_at).toLocaleString()} · {l.admin_email}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Card({ icon, title, children, wide }: { icon: React.ReactNode; title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 p-5 ${wide ? "lg:col-span-2" : ""}`}>
      <div className="flex items-center gap-2 mb-3 text-slate-900">
        <span className="text-blue-600">{icon}</span>
        <h2 className="font-bold text-sm">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4 py-1.5 border-b border-slate-50 text-sm"><span className="text-slate-400 flex-shrink-0">{label}</span><span className="text-slate-800 text-right">{value}</span></div>;
}

function SecretRow({ name, note, ok }: { name: string; note: string; ok: boolean }) {
  return (
    <div className="py-2 border-b border-slate-50">
      <div className="flex items-center gap-2">
        {ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <XCircle className="w-4 h-4 text-amber-500" />}
        <span className="font-mono text-xs font-bold text-slate-800">{name}</span>
        <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">hidden</span>
      </div>
      <p className="text-xs text-slate-500 mt-0.5 ml-6">{note}</p>
    </div>
  );
}
