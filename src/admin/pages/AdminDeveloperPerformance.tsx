import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, RefreshCw, Search } from "lucide-react";
import { adminFetch, fmtNaira, PageHeader, qs, StatCard } from "../adminApi";
import type { AccountStatus, DeveloperListResponse, DeveloperRow } from "../developer/types";
import { CopyButton, Empty, Pill, TableWrap, Td, Th, fmtCount, fmtDay, fmtDayTime } from "../developer/parts";
import { AdminDeveloperProfile } from "./AdminDeveloperProfile";

const PROFILE_BASE = "/admin/monten500/developer-performance";

type SortKey =
  | "name"
  | "registered_at"
  | "phone_success"
  | "email_success"
  | "successful_otp_orders"
  | "api_requests"
  | "api_success"
  | "api_failed"
  | "spent_success"
  | "last_api_at"
  | "account_status";

type SortDir = "asc" | "desc";

const PRESETS = [
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "90", label: "90 days" },
  { id: "all", label: "All time" },
] as const;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function presetRange(id: string): { from: string; to: string } {
  if (id === "all") return { from: "", to: "" };
  const days = Number(id);
  return { from: isoDay(new Date(Date.now() - (days - 1) * 86400000)), to: isoDay(new Date()) };
}

function sortValue(d: DeveloperRow, key: SortKey): number | string {
  if (key === "name") return (d.full_name || d.email).toLowerCase();
  if (key === "registered_at") return d.registered_at ?? "";
  if (key === "last_api_at") return d.last_api_at ?? "";
  if (key === "account_status") return d.account_status;
  return d[key];
}

function compareRows(a: DeveloperRow, b: DeveloperRow, key: SortKey, dir: SortDir): number {
  const av = sortValue(a, key);
  const bv = sortValue(b, key);
  const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
  return dir === "asc" ? cmp : -cmp;
}

function SortTh({ k, label, activeKey, dir, onSort }: { k: SortKey; label: string; activeKey: SortKey; dir: SortDir; onSort: (key: SortKey) => void }) {
  const active = activeKey === k;
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400 py-2.5 px-3 whitespace-nowrap bg-slate-50">
      <button type="button" onClick={() => onSort(k)} className={`inline-flex items-center gap-1 hover:text-slate-700 ${active ? "text-slate-700" : ""}`}>
        {label}
        <Icon size={12} className={active ? "" : "opacity-50"} />
      </button>
    </th>
  );
}

export function AdminDeveloperPerformance({ userId }: { userId?: string }) {
  if (userId) return <AdminDeveloperProfile userId={userId} />;
  return <DeveloperList />;
}

function DeveloperList() {
  const navigate = useNavigate();
  const [preset, setPreset] = useState<string>("all");
  const [range, setRange] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [data, setData] = useState<DeveloperListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | AccountStatus>("all");
  const [sortKey, setSortKey] = useState<SortKey>("api_requests");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const load = useCallback(async (r: { from: string; to: string }) => {
    setLoading(true);
    setError("");
    try {
      setData(await adminFetch<DeveloperListResponse>(`performance${qs({ from: r.from, to: r.to })}`, { fn: "admin-developers" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Developers could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(range);
  }, [load, range]);

  const choosePreset = (id: string) => {
    setPreset(id);
    setRange(presetRange(id));
  };

  const changeDate = (field: "from" | "to", value: string) => {
    setPreset("custom");
    setRange((prev) => ({ ...prev, [field]: value }));
  };

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" || key === "account_status" ? "asc" : "desc");
    }
  };

  const sortProps = { activeKey: sortKey, dir: sortDir, onSort: toggleSort };

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.developers ?? [])
      .filter((d) => statusFilter === "all" || d.account_status === statusFilter)
      .filter((d) => !term || d.email.toLowerCase().includes(term) || d.full_name.toLowerCase().includes(term) || d.user_id.toLowerCase().includes(term))
      .sort((a, b) => compareRows(a, b, sortKey, sortDir));
  }, [data, search, statusFilter, sortKey, sortDir]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, d) => ({
          otp: acc.otp + d.successful_otp_orders,
          requests: acc.requests + d.api_requests,
          failed: acc.failed + d.api_failed,
          spent: acc.spent + d.spent_success,
          pending: acc.pending + d.spent_pending,
        }),
        { otp: 0, requests: 0, failed: 0, spent: 0, pending: 0 },
      ),
    [rows],
  );

  return (
    <div className="min-w-0">
      <PageHeader
        title="Developer Performance"
        subtitle="Live figures from API orders, usage and wallet records. Successful counts only include completed, paid orders."
        actions={
          <button
            type="button"
            onClick={() => load(range)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        }
      />

      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-3 sm:p-4 flex flex-col gap-3">
        <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
          <div className="relative w-full lg:w-80">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email or ID"
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "all" | AccountStatus)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Account status"
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>
            <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => choosePreset(p.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                    preset === p.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <span className="text-xs font-medium text-slate-500">Activity from</span>
          <input
            type="date"
            value={range.from}
            max={range.to || undefined}
            onChange={(e) => changeDate("from", e.target.value)}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="From date"
          />
          <span className="text-xs font-medium text-slate-500">to</span>
          <input
            type="date"
            value={range.to}
            min={range.from || undefined}
            onChange={(e) => changeDate("to", e.target.value)}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="To date"
          />
          <span className="text-xs text-slate-400">Applies to orders and API requests. Last-activity dates are all-time.</span>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
        <StatCard label="Developers" value={fmtCount(rows.length)} sub={`${fmtCount(data?.developers.length ?? 0)} registered in total`} />
        <StatCard label="Successful OTP orders" value={fmtCount(totals.otp)} sub="Phone and email, paid" tone="success" />
        <StatCard label="API requests" value={fmtCount(totals.requests)} sub={`${fmtCount(totals.failed)} failed`} tone="info" />
        <StatCard label="Successful spend" value={fmtNaira(totals.spent)} sub={`${fmtNaira(totals.pending)} pending`} />
      </div>

      {error && (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex flex-wrap items-center justify-between gap-2">
          <span>{error}</span>
          <button type="button" onClick={() => load(range)} className="font-semibold hover:underline">
            Try again
          </button>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {loading && !data ? (
          <p className="p-8 text-center text-sm text-slate-500">Loading developers...</p>
        ) : !data || data.developers.length === 0 ? (
          <Empty text="No developers have registered yet. Developers appear here once they create an API key, buy through the API, or have a wallet transaction." />
        ) : rows.length === 0 ? (
          <Empty text="No developers match these filters." />
        ) : (
          <TableWrap minWidth={1240}>
            <thead>
              <tr>
                <SortTh k="name" label="Developer" {...sortProps} />
                <Th>Account ID</Th>
                <SortTh k="registered_at" label="Registered" {...sortProps} />
                <SortTh k="phone_success" label="Numbers bought" {...sortProps} />
                <SortTh k="email_success" label="Email OTPs" {...sortProps} />
                <SortTh k="successful_otp_orders" label="Successful OTPs" {...sortProps} />
                <SortTh k="api_requests" label="API requests" {...sortProps} />
                <SortTh k="api_success" label="Successful req." {...sortProps} />
                <SortTh k="api_failed" label="Failed req." {...sortProps} />
                <SortTh k="spent_success" label="Spent" {...sortProps} />
                <SortTh k="last_api_at" label="Last API activity" {...sortProps} />
                <SortTh k="account_status" label="Status" {...sortProps} />
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.user_id} className="border-t border-slate-100 hover:bg-slate-50/70 transition-colors">
                  <Td className="min-w-[220px]">
                    <p className="font-semibold text-slate-900">{d.full_name || "No name set"}</p>
                    <button
                      type="button"
                      onClick={() => navigate(`${PROFILE_BASE}/${d.user_id}`)}
                      className="text-left text-sm text-blue-600 hover:text-blue-700 hover:underline break-all"
                    >
                      {d.email || "No email"}
                    </button>
                  </Td>
                  <Td>
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-xs text-slate-500" title={d.user_id}>
                        {d.user_id.slice(0, 8)}...
                      </span>
                      <CopyButton text={d.user_id} />
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap">{fmtDay(d.registered_at)}</Td>
                  <Td>{fmtCount(d.phone_success)}</Td>
                  <Td>{fmtCount(d.email_success)}</Td>
                  <Td className="font-semibold text-slate-900">{fmtCount(d.successful_otp_orders)}</Td>
                  <Td>{fmtCount(d.api_requests)}</Td>
                  <Td className="text-emerald-700">{fmtCount(d.api_success)}</Td>
                  <Td className={d.api_failed > 0 ? "text-red-600 font-medium" : ""}>{fmtCount(d.api_failed)}</Td>
                  <Td className="whitespace-nowrap font-medium">{fmtNaira(d.spent_success)}</Td>
                  <Td className="whitespace-nowrap">{fmtDayTime(d.last_api_at)}</Td>
                  <Td>
                    <Pill tone={d.account_status === "active" ? "green" : "red"}>{d.account_status === "active" ? "Active" : "Suspended"}</Pill>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </div>
    </div>
  );
}
