import { supabase } from "./adminSupabase";
import type { ReactNode } from "react";

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export async function adminFetch<T>(path: string, init?: RequestInit & { json?: unknown; fn?: string }): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const { json, fn, ...requestInit } = init ?? {};
  const headers = new Headers(requestInit.headers);
  headers.set("Authorization", `Bearer ${data.session?.access_token ?? ""}`);
  headers.set("apikey", import.meta.env.VITE_SUPABASE_ANON_KEY);
  if (json !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${FUNCTIONS_BASE}/${fn ?? "admin-api"}/${path}`, {
    ...requestInit,
    method: requestInit.method ?? (json !== undefined ? "POST" : "GET"),
    headers,
    body: json !== undefined ? JSON.stringify(json) : requestInit.body,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export function qs(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "" && v !== "all");
  if (entries.length === 0) return "";
  return `?${entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&")}`;
}

export const fmtNaira = (n: number | string | null | undefined) => {
  const v = Number(n ?? 0);
  return `₦${v.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
};

export const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }) : "—");

export const fmtShortDate = (s: string) => new Date(s).toLocaleDateString("en-NG", { day: "numeric", month: "short" });

export const StatusBadge = ({ status }: { status: string }) => {
  const tone: Record<string, string> = {
    received: "bg-emerald-100 text-emerald-700",
    completed: "bg-emerald-100 text-emerald-700",
    sent: "bg-emerald-100 text-emerald-700",
    resolved: "bg-emerald-100 text-emerald-700",
    waiting: "bg-blue-100 text-blue-700",
    pending: "bg-amber-100 text-amber-700",
    queued: "bg-blue-100 text-blue-700",
    sending: "bg-blue-100 text-blue-700",
    scheduled: "bg-indigo-100 text-indigo-700",
    draft: "bg-slate-100 text-slate-600",
    open: "bg-amber-100 text-amber-700",
    failed: "bg-red-100 text-red-700",
    cancelled: "bg-slate-100 text-slate-500",
    closed: "bg-slate-100 text-slate-500",
    timeout: "bg-orange-100 text-orange-700",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${tone[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status}
    </span>
  );
};

export function MiniChart({ data, color = "#2563eb", height = 120 }: { data: { date: string; n: number }[]; color?: string; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  return (
    <div className="flex items-end gap-[3px]" style={{ height }}>
      {data.map((d) => (
        <div key={d.date} className="flex-1 min-w-[4px] group relative flex items-end" style={{ height: "100%" }}>
          <div
            className="w-full rounded-t transition-all"
            style={{ height: `${Math.max(2, (d.n / max) * 100)}%`, backgroundColor: color, opacity: d.n === 0 ? 0.15 : 0.85 }}
            title={`${d.date}: ${d.n}`}
          />
        </div>
      ))}
    </div>
  );
}

export function StatCard({ label, value, sub, tone = "default" }: { label: string; value: string | number; sub?: string; tone?: "default" | "success" | "warning" | "danger" | "info" }) {
  const tones: Record<string, string> = {
    default: "text-slate-900",
    success: "text-emerald-600",
    warning: "text-amber-600",
    danger: "text-red-600",
    info: "text-blue-600",
  };
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-xs text-slate-500 font-medium">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tones[tone]}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function DataTable({ headers, children, empty }: { headers: string[]; children: React.ReactNode; empty?: boolean }) {
  if (empty) return <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-400">No records found.</div>;
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead>
          <tr className="text-left text-[11px] text-slate-400 uppercase tracking-wide border-b border-slate-100">
            {headers.map((h) => <th key={h} className="py-3 px-4 font-semibold whitespace-nowrap">{h}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
