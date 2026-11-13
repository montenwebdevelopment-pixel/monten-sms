import { useEffect, useState } from "react";
import { adminFetch, fmtDate } from "../adminApi";
import { Send, Save, Eye, FlaskConical, Users, Clock, Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";

interface Campaign {
  id: string;
  subject: string;
  html: string;
  text_body: string;
  recipients: string[];
  recipient_count: number;
  status: string;
  is_test: boolean;
  scheduled_for: string | null;
  sent_at: string | null;
  stats: Record<string, number>;
  created_at: string;
  updated_at: string;
}

interface Eligible { users: { email: string; name: string }[]; total: number }

const EMPTY = { id: "", subject: "", html: "", text_body: "", recipient_mode: "all" as "all" | "custom", custom: "", is_test: true, schedule: "" };

export function AdminBulkEmail() {
  const [form, setForm] = useState({ ...EMPTY });
  const [eligible, setEligible] = useState<Eligible | null>(null);
  const [drafts, setDrafts] = useState<Campaign[]>([]);
  const [preview, setPreview] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgOk, setMsgOk] = useState(false);
  const [busy, setBusy] = useState("");
  const [confirmSend, setConfirmSend] = useState(false);

  const loadMeta = async () => {
    try {
      const [e, c] = await Promise.all([
        adminFetch<Eligible>("eligible-users"),
        adminFetch<{ campaigns: Campaign[] }>("campaigns?pageSize=50"),
      ]);
      setEligible(e);
      setDrafts(c.campaigns.filter((x) => x.status === "draft" || x.status === "scheduled"));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to load.");
      setMsgOk(false);
    }
  };

  useEffect(() => { loadMeta(); }, []);

  const recipientList = (): string[] => {
    if (form.recipient_mode === "all") return eligible?.users.map((u) => u.email) ?? [];
    return form.custom.split(/[\s,;]+/).map((s) => s.trim()).filter((s) => /.+@.+\..+/.test(s));
  };

  const count = recipientList().length;

  const save = async (status: "draft" | "scheduled") => {
    if (!form.subject.trim() || !form.html.trim()) {
      setMsg("Subject and message are required."); setMsgOk(false); return;
    }
    if (status === "scheduled" && (!form.schedule || Date.parse(form.schedule) <= Date.now())) {
      setMsg("Pick a future schedule time."); setMsgOk(false); return;
    }
    setBusy("save");
    try {
      await adminFetch("campaigns", { json: {
        id: form.id || undefined, subject: form.subject, html: form.html, text: form.text_body,
        recipients: recipientList(), isTest: form.is_test, status, scheduledFor: form.schedule || undefined,
      } });
      setMsg(status === "draft" ? "Draft saved." : "Campaign scheduled.");
      setMsgOk(true);
      await loadMeta();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed."); setMsgOk(false);
    } finally { setBusy(""); }
  };

  const sendTest = async () => {
    if (!form.subject.trim() || !form.html.trim()) { setMsg("Subject and message are required."); setMsgOk(false); return; }
    setBusy("test");
    try {
      // Save first so the test reflects persisted content, then send to admin email.
      const saved = await adminFetch<{ campaign: Campaign }>("campaigns", { json: {
        id: form.id || undefined, subject: form.subject, html: form.html, text: form.text_body,
        recipients: recipientList(), isTest: true, status: "draft",
      } });
      setForm((f) => ({ ...f, id: saved.campaign.id }));
      await adminFetch("campaigns/test-send", { json: { subject: form.subject, html: form.html } });
      setMsg("Test email sent to the admin address. Check the inbox."); setMsgOk(true);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Test send failed."); setMsgOk(false);
    } finally { setBusy(""); }
  };

  const queue = async () => {
    setBusy("queue"); setConfirmSend(false);
    try {
      const r = await adminFetch<{ queued: number; suppressed: number }>("campaigns/queue", { json: { id: form.id } });
      setMsg(`Campaign queued: ${r.queued} recipients accepted (${r.suppressed} skipped as unsubscribed/bounced). Delivery starts automatically.`); setMsgOk(true);
      await loadMeta();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Queue failed."); setMsgOk(false);
    } finally { setBusy(""); }
  };

  const deleteDraft = async (id: string) => {
    if (!window.confirm("Delete this draft/scheduled campaign? This cannot be undone.")) return;
    try { await adminFetch(`campaigns/${id}`, { method: "DELETE" }); await loadMeta(); } catch (e) { setMsg(e instanceof Error ? e.message : "Delete failed."); setMsgOk(false); }
  };

  const loadDraft = (c: Campaign) => {
    setForm({ id: c.id, subject: c.subject, html: c.html, text_body: c.text_body, recipient_mode: "custom", custom: (c.recipients ?? []).join(", "), is_test: c.is_test, schedule: c.scheduled_for ?? "" });
    setMsg("Draft loaded for editing."); setMsgOk(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Bulk Email</h1>
          <p className="text-sm text-slate-500 mt-0.5">Compose, test and schedule email campaigns. Real sending stays off until you queue a campaign yourself.</p>
        </div>
        {form.is_test && (
          <span className="inline-flex items-center gap-1.5 bg-amber-100 text-amber-800 text-xs font-bold px-3 py-1.5 rounded-full"><FlaskConical className="w-3.5 h-3.5" /> TEST MODE — nothing goes to customers</span>
        )}
      </div>

      {msg && (
        <div className={`rounded-xl p-3 text-sm mb-4 border ${msgOk ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-red-50 border-red-200 text-red-700"}`}>{msg}</div>
      )}

      <div className="grid lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Subject</label>
            <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="e.g. New lower prices on WhatsApp numbers"
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400" />
            <label className="block text-sm font-semibold text-slate-700 mt-4 mb-1.5">Message (HTML allowed: &lt;b&gt;, &lt;p&gt;, &lt;a&gt;, &lt;br&gt;)</label>
            <textarea value={form.html} onChange={(e) => setForm({ ...form, html: e.target.value })} rows={10}
              placeholder="<p>Dear customer,</p><p>We have news...</p>"
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-blue-400" />
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <p className="text-sm font-semibold text-slate-700 mb-3">Recipients</p>
            <div className="flex flex-wrap gap-2 mb-3">
              <button onClick={() => setForm({ ...form, recipient_mode: "all" })} className={`text-xs font-semibold px-3 py-2 rounded-lg border ${form.recipient_mode === "all" ? "bg-blue-600 text-white border-blue-600" : "bg-white border-slate-200"}`}>
                <Users className="w-3.5 h-3.5 inline mr-1" /> All eligible registered users {eligible ? `(${eligible.total})` : ""}
              </button>
              <button onClick={() => setForm({ ...form, recipient_mode: "custom" })} className={`text-xs font-semibold px-3 py-2 rounded-lg border ${form.recipient_mode === "custom" ? "bg-blue-600 text-white border-blue-600" : "bg-white border-slate-200"}`}>
                Custom list
              </button>
            </div>
            {form.recipient_mode === "custom" ? (
              <textarea value={form.custom} onChange={(e) => setForm({ ...form, custom: e.target.value })} rows={4}
                placeholder="One email per line, or comma-separated"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-400" />
            ) : (
              <p className="text-xs text-slate-500">Every registered customer with a verified email will receive this campaign. Unsubscribed and bounced addresses are skipped automatically at send time.</p>
            )}
            <p className="text-sm text-slate-900 font-bold mt-3">{count} recipient{count === 1 ? "" : "s"} will receive this email.</p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.is_test} onChange={(e) => setForm({ ...form, is_test: e.target.checked })} className="w-4 h-4 accent-amber-600" />
              <span className="text-sm font-medium text-slate-700">Test mode (recommended while composing — prevents real sending)</span>
            </label>
            <label className="block text-sm font-semibold text-slate-700 mt-4 mb-1.5">Schedule for later (optional)</label>
            <input type="datetime-local" value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value })}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={() => save("draft")} disabled={!!busy} className="inline-flex items-center gap-2 bg-slate-900 text-white text-sm font-semibold rounded-lg px-4 py-2.5 hover:bg-slate-800 disabled:opacity-50"><Save className="w-4 h-4" /> Save draft</button>
            <button onClick={() => save("scheduled")} disabled={!!busy} className="inline-flex items-center gap-2 bg-white border border-slate-200 text-slate-700 text-sm font-semibold rounded-lg px-4 py-2.5 hover:bg-slate-50 disabled:opacity-50"><Clock className="w-4 h-4" /> Schedule</button>
            <button onClick={sendTest} disabled={!!busy} className="inline-flex items-center gap-2 bg-white border border-blue-200 text-blue-700 text-sm font-semibold rounded-lg px-4 py-2.5 hover:bg-blue-50 disabled:opacity-50"><FlaskConical className="w-4 h-4" /> Send test to me</button>
            <button onClick={() => setPreview(!preview)} className="inline-flex items-center gap-2 bg-white border border-slate-200 text-slate-700 text-sm font-semibold rounded-lg px-4 py-2.5 hover:bg-slate-50"><Eye className="w-4 h-4" /> {preview ? "Hide preview" : "Preview"}</button>
            <button
              onClick={() => { if (!form.id) { setMsg("Save the draft first, then queue it for sending."); setMsgOk(false); return; } setConfirmSend(true); }}
              disabled={!!busy || form.is_test}
              className="inline-flex items-center gap-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg px-4 py-2.5 hover:bg-emerald-700 disabled:opacity-50"
              title={form.is_test ? "Turn off test mode to enable real sending" : ""}
            >
              <Send className="w-4 h-4" /> Queue for sending
            </button>
          </div>

          {preview && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Email preview</p>
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-slate-100 px-4 py-2 text-xs text-slate-500 border-b">To: {form.recipient_mode === "all" ? "eligible customers" : "custom list"} · Subject: <span className="font-semibold text-slate-800">{form.subject || "(no subject)"}</span></div>
                <div className="p-4 text-sm prose-sm" dangerouslySetInnerHTML={{ __html: form.html || "<i>(empty message)</i>" }} />
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <p className="font-bold text-slate-900 text-sm mb-3">Drafts & scheduled</p>
            {drafts.length === 0 ? <p className="text-xs text-slate-400">No drafts yet.</p> : (
              <div className="space-y-2">
                {drafts.map((c) => (
                  <div key={c.id} className="border border-slate-100 rounded-lg p-3">
                    <p className="text-sm font-semibold text-slate-800 truncate">{c.subject || "(no subject)"}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{c.status}{c.scheduled_for ? ` · ${fmtDate(c.scheduled_for)}` : ""} · {c.recipient_count} recipients</p>
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => loadDraft(c)} className="text-xs font-semibold text-blue-600 hover:underline">Edit</button>
                      <button onClick={() => deleteDraft(c.id)} className="text-xs font-semibold text-red-500 hover:underline inline-flex items-center gap-1"><Trash2 className="w-3 h-3" /> Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-800 space-y-2">
            <p className="font-bold">How sending works</p>
            <p>1. Compose and save a draft with test mode ON.</p>
            <p>2. Send a test to your own admin inbox and check it.</p>
            <p>3. Turn test mode OFF, save, then "Queue for sending".</p>
            <p>4. The queue delivers in small batches with automatic retries; progress shows on the Sent Emails page.</p>
          </div>
        </div>
      </div>

      {confirmSend && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={() => setConfirmSend(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="w-6 h-6 text-amber-500 flex-shrink-0" />
              <div>
                <h3 className="font-bold text-slate-900">Send this campaign for real?</h3>
                <p className="text-sm text-slate-500 mt-1">{count} real customers will receive "{form.subject}". This action cannot be undone after delivery starts.</p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmSend(false)} className="px-4 py-2 text-sm font-semibold rounded-lg border border-slate-200 hover:bg-slate-50">Cancel</button>
              <button onClick={queue} disabled={busy === "queue"} className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-2">
                {busy === "queue" ? "Queueing..." : <><CheckCircle2 className="w-4 h-4" /> Yes, send it</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
