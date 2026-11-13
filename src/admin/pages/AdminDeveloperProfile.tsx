import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Mail, RefreshCw } from "lucide-react";
import { adminFetch } from "../adminApi";
import type { DeveloperProfileResponse } from "../developer/types";
import { ProfileActions } from "../developer/ProfileActions";
import { InfoSection, PhoneSection, EmailSection, FinanceSection } from "../developer/ProfileSections";
import { ApiSection, SupportSection } from "../developer/ProfileApiSections";
import { ChartsSection } from "../developer/ProfileCharts";
import { CopyButton, Pill } from "../developer/parts";

const LIST_PATH = "/admin/monten500/developer-performance";

export function AdminDeveloperProfile({ userId }: { userId: string }) {
  const navigate = useNavigate();
  const [data, setData] = useState<DeveloperProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await adminFetch<DeveloperProfileResponse>(`performance/${encodeURIComponent(userId)}`, { fn: "admin-developers" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "This developer profile could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const back = (
    <button type="button" onClick={() => navigate(LIST_PATH)} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">
      <ArrowLeft size={16} />
      All developers
    </button>
  );

  if (!data) {
    return (
      <div className="space-y-4">
        {back}
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          {loading ? "Loading developer profile..." : error || "This developer profile could not be loaded."}
          {!loading && (
            <button type="button" onClick={load} className="ml-3 font-semibold text-blue-600 hover:underline">
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  const dev = data.developer;
  const suspended = dev.account_status === "suspended";

  return (
    <div className="space-y-5 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {back}
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <header className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 break-words">{dev.full_name || "Unnamed developer"}</h1>
              <Pill tone={suspended ? "red" : "green"}>{suspended ? "Suspended" : "Active"}</Pill>
            </div>
            {dev.email && (
              <a href={`mailto:${dev.email}`} className="mt-1 inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline break-all">
                <Mail size={14} className="shrink-0" />
                {dev.email}
              </a>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span className="font-mono break-all">{dev.user_id}</span>
              <CopyButton text={dev.user_id} label="Copy ID" />
            </div>
          </div>
          <div className="text-xs text-slate-500 sm:text-right">
            <p>Registered {dev.registered_at ? new Date(dev.registered_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "-"}</p>
            <p className="mt-0.5">Data generated {new Date(data.generated_at).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}</p>
          </div>
        </div>
      </header>

      <ProfileActions developer={dev} defaults={data.defaults} onChanged={load} />
      <InfoSection developer={dev} summary={data.summary} />
      <PhoneSection phone={data.phone} />
      <EmailSection email={data.email} />
      <ApiSection api={data.api} onChanged={load} />
      <FinanceSection finance={data.finance} />
      <ChartsSection charts={data.charts} />
      <SupportSection tickets={data.support} />
    </div>
  );
}
