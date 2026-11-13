import { useEffect, useState } from "react";
import { adminFetch, StatCard, MiniChart, PageHeader, fmtNaira } from "../adminApi";
import { RefreshCw, Users, LogIn, Smartphone, Wallet, Ticket, Mail, TrendingUp } from "lucide-react";
import type { AdminPage } from "../AdminLayout";

interface Overview {
  users: { total: number; today: number; week: number; month: number };
  logins: { totalEvents: number; uniqueUsers: number };
  numbers: { total: number; success: number };
  emailOrders: { total: number; success: number; waiting: number; failed: number };
  payments: { deposits: number; depositsSuccess: number; depositsPending: number; depositsFailed: number; purchases: number; purchasesSuccess: number; pending: number; failed: number };
  revenue: number;
  depositTotal: number;
  walletTotal: number;
  tickets: { total: number; open: number };
}

export function AdminOverview({ onNavigate }: { onNavigate: (p: AdminPage) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [regs, setRegs] = useState<{ date: string; n: number }[]>([]);
  const [loginsChart, setLoginsChart] = useState<{ date: string; n: number }[]>([]);
  const [purchasesChart, setPurchasesChart] = useState<{ date: string; n: number }[]>([]);
  const [revenueChart, setRevenueChart] = useState<{ date: string; n: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [o, r1, r2, r3, r4] = await Promise.all([
        adminFetch<Overview>("overview"),
        adminFetch<{ series: { date: string; n: number }[] }>("chart/profiles?days=30"),
        adminFetch<{ series: { date: string; n: number }[] }>("chart/login_activity?days=30"),
        adminFetch<{ series: { date: string; n: number }[] }>("chart/purchased_numbers?days=30&successful=1"),
        adminFetch<{ series: { date: string; n: number }[] }>("chart/transactions?days=30"),
      ]);
      setData(o);
      setRegs(r1.series);
      setLoginsChart(r2.series);
      setPurchasesChart(r3.series);
      // Revenue & deposits chart: daily completed deposits sum is in transactions chart as counts; show deposits count.
      setRevenueChart(r4.series);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="flex justify-center py-20"><RefreshCw className="w-6 h-6 animate-spin text-blue-600" /></div>;
  if (error) return <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">{error}</div>;
  if (!data) return null;

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle="Live business statistics from the real Monten SMS database"
        actions={<button onClick={load} className="inline-flex items-center gap-2 text-sm font-medium bg-white border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50"><RefreshCw className="w-4 h-4" /> Refresh</button>}
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total users" value={data.users.total.toLocaleString()} sub={`${data.users.today} today · ${data.users.week} this week`} />
        <StatCard label="Revenue (successful sales)" value={fmtNaira(data.revenue)} tone="success" />
        <StatCard label="Deposits received" value={fmtNaira(data.depositTotal)} sub={`${data.payments.depositsSuccess} successful payments`} />
        <StatCard label="Wallet balances held" value={fmtNaira(data.walletTotal)} tone="info" />
        <StatCard label="Phone numbers purchased" value={data.numbers.total.toLocaleString()} sub={`${data.numbers.success} successful (SMS received)`} />
        <StatCard label="Email OTP orders" value={data.emailOrders.total.toLocaleString()} sub={`${data.emailOrders.success} successful`} />
        <StatCard label="Login events / unique users" value={`${data.logins.totalEvents.toLocaleString()} / ${data.logins.uniqueUsers.toLocaleString()}`} />
        <StatCard label="Open support requests" value={data.tickets.open} tone={data.tickets.open > 0 ? "warning" : "success"} sub={`${data.tickets.total} total tickets`} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Registrations this month" value={data.users.month} />
        <StatCard label="Payments pending" value={data.payments.depositsPending} tone="warning" sub="deposits awaiting confirmation" />
        <StatCard label="Failed payments" value={data.payments.depositsFailed} tone="danger" />
        <StatCard label="OTP orders waiting/failed" value={`${data.emailOrders.waiting} / ${data.emailOrders.failed}`} tone="warning" />
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <ChartCard icon={<TrendingUp className="w-4 h-4 text-blue-600" />} title="User registrations" sub="last 30 days" data={regs} color="#2563eb" />
        <ChartCard icon={<LogIn className="w-4 h-4 text-emerald-600" />} title="Login activity" sub="last 30 days" data={loginsChart} color="#059669" />
        <ChartCard icon={<Smartphone className="w-4 h-4 text-indigo-600" />} title="Successful OTP purchases" sub="last 30 days" data={purchasesChart} color="#4f46e5" />
        <ChartCard icon={<Wallet className="w-4 h-4 text-amber-600" />} title="Transactions" sub="all types, last 30 days" data={revenueChart} color="#d97706" />
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <QuickLink icon={<Users className="w-5 h-5" />} label="Manage users" onClick={() => onNavigate("users")} />
        <QuickLink icon={<Ticket className="w-5 h-5" />} label="Support center" onClick={() => onNavigate("support")} />
        <QuickLink icon={<Mail className="w-5 h-5" />} label="Send bulk email" onClick={() => onNavigate("bulk-email")} />
      </div>
    </div>
  );
}

function ChartCard({ icon, title, sub, data, color }: { icon: React.ReactNode; title: string; sub: string; data: { date: string; n: number }[]; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <div>
          <p className="font-semibold text-slate-900 text-sm">{title}</p>
          <p className="text-[11px] text-slate-400">{sub}</p>
        </div>
      </div>
      <MiniChart data={data} color={color} />
    </div>
  );
}

function QuickLink({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 hover:bg-blue-50/50 transition-colors text-left">
      <div className="text-blue-600">{icon}</div>
      <span className="font-semibold text-sm text-slate-800">{label}</span>
    </button>
  );
}
