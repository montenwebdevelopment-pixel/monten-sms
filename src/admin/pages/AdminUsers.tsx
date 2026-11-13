import { useEffect, useState } from "react";
import { adminFetch, qs, fmtNaira, fmtDate, StatusBadge, DataTable, PageHeader } from "../adminApi";
import { Search, RefreshCw, X } from "lucide-react";

interface UserRow {
  id: string;
  full_name: string | null;
  username: string | null;
  wallet_balance: string | number;
  email_verified: boolean;
  created_at: string;
  updated_at: string;
}

interface AuthInfo {
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
}

interface Detail {
  profile: UserRow;
  auth: AuthInfo | null;
  transactions: { id: string; type: string; amount: string | number; status: string; description: string | null; created_at: string }[];
  numbers: { id: string; service_name: string; country_name: string; status: string; selling_price: string | number; created_at: string }[];
  emailOrders: { id: string; service: string; email_address: string | null; status: string; charge_naira: string | number; created_at: string }[];
  tickets: { id: string; case_ref: string; subject: string; status: string; priority: string; created_at: string }[];
  lastLogin: string | null;
}

export function AdminUsers() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const pageSize = 25;

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await adminFetch<{ users: UserRow[]; total: number }>(`users${qs({ page, pageSize, search: activeSearch })}`);
      setRows(res.users);
      setTotal(res.total);
      // Resolve emails for these users via the detail API cache-free: one call per row is heavy,
      // so fetch emails in a single pass through the auth list endpoint when present.
      const map: Record<string, string> = { ...emails };
      await Promise.all(res.users.slice(0, 25).map(async (u) => {
        if (map[u.id]) return;
        try {
          const d = await adminFetch<{ auth: AuthInfo | null }>(`users/${u.id}`);
          map[u.id] = d.auth?.email ?? "";
        } catch { map[u.id] = ""; }
      }));
      setEmails(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, activeSearch]);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setActiveSearch(search.trim());
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <PageHeader title="Users" subtitle={`${total.toLocaleString()} registered customers`} />
      <form onSubmit={submitSearch} className="flex gap-2 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-blue-400"
          />
        </div>
        <button type="submit" className="bg-blue-600 text-white text-sm font-medium rounded-lg px-4 hover:bg-blue-700">Search</button>
        {activeSearch && (
          <button type="button" onClick={() => { setSearch(""); setActiveSearch(""); setPage(1); }} className="border border-slate-200 rounded-lg px-3 text-slate-500 hover:bg-slate-50"><X className="w-4 h-4" /></button>
        )}
      </form>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm mb-4">{error}</div>}
      {loading ? (
        <div className="flex justify-center py-20"><RefreshCw className="w-6 h-6 animate-spin text-blue-600" /></div>
      ) : (
        <>
          <DataTable headers={["Customer", "Email", "Status", "Wallet", "Registered", "Last login", ""]} empty={rows.length === 0}>
            {rows.map((u) => (
              <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                <td className="py-3 px-4 font-medium text-slate-900">{u.full_name ?? "—"}<span className="block text-xs text-slate-400">@{u.username ?? "—"}</span></td>
                <td className="py-3 px-4 text-slate-600 max-w-[220px] truncate">{emails[u.id] || "—"}</td>
                <td className="py-3 px-4"><StatusBadge status={u.email_verified ? "verified" : "unverified"} /></td>
                <td className="py-3 px-4 font-semibold text-slate-900">{fmtNaira(u.wallet_balance)}</td>
                <td className="py-3 px-4 text-slate-500 text-xs">{fmtDate(u.created_at)}</td>
                <td className="py-3 px-4 text-slate-500 text-xs">—</td>
                <td className="py-3 px-4 text-right">
                  <button onClick={() => openDetail(u.id)} className="text-blue-600 text-xs font-semibold hover:underline">View</button>
                </td>              </tr>
            ))}
          </DataTable>
          <div className="flex items-center justify-between mt-4 text-sm text-slate-500">
            <span>Page {page} of {pages}</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40 hover:bg-slate-50">Previous</button>
              <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40 hover:bg-slate-50">Next</button>
            </div>
          </div>
        </>
      )}

      {detail && <UserDetailModal detail={detail} onClose={() => setDetail(null)} />}
    </div>
  );

  function openDetail(id: string) {
    adminFetch<Detail>(`users/${id}`).then(setDetail).catch(() => setError("Failed to load customer profile."));
  }
}

function UserDetailModal({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-6" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-slate-900">{detail.profile.full_name ?? "Customer"}</h2>
            <p className="text-sm text-slate-500">{detail.auth?.email ?? ""}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Field label="Wallet balance" value={fmtNaira(detail.profile.wallet_balance)} />
            <Field label="Email verified" value={detail.profile.email_verified ? "Yes" : "No"} />
            <Field label="Registered" value={fmtDate(detail.profile.created_at)} />
            <Field label="Last login" value={detail.lastLogin ? fmtDate(detail.lastLogin) : detail.auth?.last_sign_in_at ? fmtDate(detail.auth.last_sign_in_at) : "Never recorded"} />
          </div>

          <Section title={`Transactions (${detail.transactions.length})`}>
            {detail.transactions.length === 0 ? <p className="text-sm text-slate-400">None.</p> : detail.transactions.slice(0, 10).map((t) => (
              <div key={t.id} className="flex items-center justify-between py-2 border-b border-slate-50 text-sm">
                <span className="capitalize text-slate-700">{t.type} <span className="text-slate-400 text-xs">{fmtDate(t.created_at)}</span></span>
                <span className="flex items-center gap-2"><span className="font-semibold">{fmtNaira(t.amount)}</span><StatusBadge status={t.status} /></span>
              </div>
            ))}
          </Section>

          <Section title={`Phone number purchases (${detail.numbers.length})`}>
            {detail.numbers.length === 0 ? <p className="text-sm text-slate-400">None.</p> : detail.numbers.slice(0, 10).map((n) => (
              <div key={n.id} className="flex items-center justify-between py-2 border-b border-slate-50 text-sm">
                <span className="text-slate-700">{n.service_name} · {n.country_name} <span className="text-slate-400 text-xs">{fmtDate(n.created_at)}</span></span>
                <span className="flex items-center gap-2"><span className="font-semibold">{fmtNaira(n.selling_price)}</span><StatusBadge status={n.status} /></span>
              </div>
            ))}
          </Section>

          <Section title={`Email purchases (${detail.emailOrders.length})`}>
            {detail.emailOrders.length === 0 ? <p className="text-sm text-slate-400">None.</p> : detail.emailOrders.slice(0, 10).map((o) => (
              <div key={o.id} className="flex items-center justify-between py-2 border-b border-slate-50 text-sm">
                <span className="text-slate-700">{o.service} <span className="text-slate-400 text-xs">{fmtDate(o.created_at)}</span></span>
                <span className="flex items-center gap-2"><span className="font-semibold">{fmtNaira(o.charge_naira)}</span><StatusBadge status={o.status} /></span>
              </div>
            ))}
          </Section>

          <Section title={`Support tickets (${detail.tickets.length})`}>
            {detail.tickets.length === 0 ? <p className="text-sm text-slate-400">None.</p> : detail.tickets.map((t) => (
              <div key={t.id} className="flex items-center justify-between py-2 border-b border-slate-50 text-sm">
                <span className="text-slate-700">{t.case_ref} · {t.subject}</span>
                <StatusBadge status={t.status} />
              </div>
            ))}
          </Section>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return <div className="bg-slate-50 rounded-lg p-3"><p className="text-xs text-slate-400">{label}</p><p className="font-semibold text-slate-900 mt-0.5">{value}</p></div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-bold text-slate-900 mb-2">{title}</h3>
      <div>{children}</div>
    </div>
  );
}
