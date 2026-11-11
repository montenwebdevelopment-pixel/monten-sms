import { useEffect, useState } from "react";
import {
  ArrowDownLeft, ArrowRight, ArrowUpRight, Bell, Bot, Check, ChevronRight,
  Clock3, MessageCircle, Plus, RefreshCw, Send, ShieldCheck, ShoppingBag,
  Smartphone, Wallet,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabase";
import { formatDate, formatNaira } from "../../lib/format";
import { useDashboardRefreshKey, type DashboardPage } from "../../components/DashboardLayout";
import type { Transaction } from "../../types";

type ActiveNumber = {
  id: string;
  phone_number: string | null;
  service_name: string | null;
  country_name: string | null;
  country_code: string | null;
  created_at: string;
  expires_at: string | null;
};

type DashboardStats = {
  totalPurchases: number | null;
  totalSpent: number | null;
};

const quickPurchase = [
  { code: "whatsapp", label: "WhatsApp", icon: MessageCircle, color: "bg-emerald-50 text-emerald-700" },
  { code: "telegram", label: "Telegram", icon: Send, color: "bg-sky-50 text-sky-700" },
  { code: "openai", label: "OpenAI", icon: Bot, color: "bg-violet-50 text-violet-700" },
];

async function loadPurchaseStats(since: string) {
  const pageSize = 500;
  let offset = 0;
  let count: number | null = null;
  let totalSpent = 0;

  while (true) {
    const { data, error, count: pageCount } = await supabase
      .from("transactions")
      .select("amount", { count: offset === 0 ? "exact" : undefined })
      .eq("type", "purchase")
      .eq("status", "completed")
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) return { count: null, totalSpent: 0, error };

    if (offset === 0) count = pageCount;
    for (const row of data ?? []) totalSpent += Number(row.amount);
    if (!data || data.length < pageSize) break;
    offset += pageSize;
  }

  return { count, totalSpent, error: null };
}

function ActiveCountdown({ expiresAt, createdAt }: { expiresAt: string | null; createdAt: string }) {
  const target = expiresAt ?? new Date(new Date(createdAt).getTime() + 5 * 60 * 1000).toISOString();
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((Date.parse(target) - Date.now()) / 1000)));

  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, Math.ceil((Date.parse(target) - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [target]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ${remaining > 0 ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
      <Clock3 className="h-3.5 w-3.5" />
      {remaining > 0 ? `${minutes}:${String(seconds).padStart(2, "0")} left` : "Expired"}
    </span>
  );
}

function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-base font-bold tracking-tight text-slate-900">{title}</h2>
        {subtitle && <p className="mt-1 text-xs leading-5 text-slate-500">{subtitle}</p>}
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-royal-700 transition-colors hover:bg-royal-50"
        >
          {action.label}
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function DashboardHomeNative({
  onNavigate,
  onQuickPurchase,
}: {
  onNavigate: (page: DashboardPage) => void;
  onQuickPurchase: (serviceCode: string) => void;
}) {
  const { profile } = useAuth();
  const refreshKey = useDashboardRefreshKey();
  const [recentTxns, setRecentTxns] = useState<Transaction[]>([]);
  const [activeNumbers, setActiveNumbers] = useState<ActiveNumber[]>([]);
  const [stats, setStats] = useState<DashboardStats>({ totalPurchases: null, totalSpent: null });
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState({ transactions: false, purchases: false, activeNumbers: false });

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadErrors({ transactions: false, purchases: false, activeNumbers: false });

    void (async () => {
      try {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const [txns, purchases, waiting] = await Promise.all([
          supabase.from("transactions").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(5),
          loadPurchaseStats(since),
          supabase.from("purchased_numbers").select("id, phone_number, service_name, country_name, country_code, created_at, expires_at").eq("status", "waiting").order("created_at", { ascending: false }).limit(3),
        ]);
        if (txns.error) console.error("[dashboard-native] recent transactions request failed", txns.error);
        if (purchases.error) console.error("[dashboard-native] weekly purchases request failed", purchases.error);
        if (waiting.error) console.error("[dashboard-native] active numbers request failed", waiting.error);
        if (!active) return;

        setRecentTxns((txns.data ?? []) as Transaction[]);
        setActiveNumbers((waiting.data ?? []) as ActiveNumber[]);
        setStats({
          totalPurchases: purchases.error ? null : purchases.count,
          totalSpent: purchases.error ? null : purchases.totalSpent,
        });
        setLoadErrors({
          transactions: Boolean(txns.error),
          purchases: Boolean(purchases.error),
          activeNumbers: Boolean(waiting.error),
        });
      } catch (error) {
        console.error("[dashboard-native] dashboard data request failed", error);
        if (!active) return;
        setRecentTxns([]);
        setActiveNumbers([]);
        setStats({ totalPurchases: null, totalSpent: null });
        setLoadErrors({ transactions: true, purchases: true, activeNumbers: true });
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [refreshKey]);

  const greeting = new Date().getHours() < 12
    ? "Good morning"
    : new Date().getHours() < 18
      ? "Good afternoon"
      : "Good evening";
  const firstName = profile?.full_name?.trim().split(/\s+/)[0];
  const today = new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date());

  return (
    <div className="-mx-4 -mt-4 min-h-full bg-[#f4f6fb] px-4 pb-8 pt-5 sm:-mx-6 sm:-mt-6 sm:px-6 sm:pt-7">
      <div className="mx-auto max-w-2xl animate-fade-in">
        <header className="mb-5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-royal-700">{today}</p>
            <h1 className="mt-1 text-[25px] font-extrabold leading-tight tracking-tight text-slate-950">
              {greeting}{firstName ? `, ${firstName}` : ""}
            </h1>
            <p className="mt-1 text-sm text-slate-500">Here’s your account at a glance.</p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate("notifications")}
            aria-label="View notifications"
            className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white bg-white text-slate-700 shadow-sm transition-transform active:scale-95"
          >
            <Bell className="h-5 w-5" />
          </button>
        </header>

        <section className="relative mb-5 overflow-hidden rounded-[26px] bg-gradient-to-br from-[#101a35] via-[#172b58] to-[#244ca0] p-5 text-white shadow-[0_16px_40px_-18px_rgba(24,52,111,0.65)] sm:p-6">
          <div aria-hidden="true" className="absolute -right-14 -top-20 h-56 w-56 rounded-full bg-blue-400/15 blur-3xl" />
          <div aria-hidden="true" className="absolute -bottom-24 right-16 h-44 w-44 rounded-full bg-indigo-300/10 blur-3xl" />
          <div className="relative">
            <div className="flex items-center justify-between">
              <p className="inline-flex items-center gap-2 text-xs font-medium text-blue-100/85">
                <Wallet className="h-4 w-4" />
                Wallet balance
              </p>
              <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[10px] font-bold tracking-[0.14em] text-blue-100">
                NGN
              </span>
            </div>
            <p className="mt-3 text-[34px] font-extrabold leading-none tracking-tight tabular-nums sm:text-[38px]">
              {formatNaira(profile?.wallet_balance ?? 0)}
            </p>
            <div className="mt-6 flex items-center justify-between gap-3 border-t border-white/15 pt-4">
              <span className="inline-flex items-center gap-1.5 text-[11px] text-blue-100/80">
                <ShieldCheck className="h-3.5 w-3.5" />
                Available to spend
              </span>
              <button
                type="button"
                onClick={() => onNavigate("fund-wallet")}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-slate-900 shadow-sm transition-all hover:bg-blue-50 active:scale-[0.98]"
              >
                <Plus className="h-4 w-4" />
                Fund wallet
              </button>
            </div>
          </div>
        </section>

        <section className="mb-6 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white bg-white p-4 shadow-[0_4px_18px_-12px_rgba(15,23,42,0.24)]">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
              <ShoppingBag className="h-[18px] w-[18px]" />
            </div>
            <p className="text-[11px] font-medium leading-4 text-slate-500">Numbers purchased</p>
            <p className="mt-1 text-xl font-extrabold tracking-tight text-slate-900">
              {loading ? <span className="text-slate-300">—</span> : stats.totalPurchases ?? "—"}
            </p>
            <p className="mt-0.5 text-[10px] font-medium text-slate-400">Last 7 days</p>
          </div>
          <div className="rounded-2xl border border-white bg-white p-4 shadow-[0_4px_18px_-12px_rgba(15,23,42,0.24)]">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
              <Wallet className="h-[18px] w-[18px]" />
            </div>
            <p className="text-[11px] font-medium leading-4 text-slate-500">Total spent</p>
            <p className="mt-1 truncate text-xl font-extrabold tracking-tight text-slate-900">
              {loading ? <span className="text-slate-300">—</span> : stats.totalSpent === null ? "—" : formatNaira(stats.totalSpent)}
            </p>
            <p className="mt-0.5 text-[10px] font-medium text-slate-400">Last 7 days</p>
          </div>
        </section>
        {!loading && loadErrors.purchases && (
          <p role="status" className="-mt-4 mb-5 text-xs text-amber-700">Weekly purchase totals couldn’t be loaded.</p>
        )}

        <section className="mb-6">
          <SectionTitle
            title="Quick purchase"
            subtitle="Jump back into a popular service."
            action={{ label: "Browse", onClick: () => onNavigate("buy-numbers") }}
          />
          <div className="grid grid-cols-3 gap-2.5">
            {quickPurchase.map(({ code, label, icon: Icon, color }) => (
              <button
                key={code}
                type="button"
                onClick={() => onQuickPurchase(code)}
                className="group flex min-h-[96px] flex-col items-start justify-between rounded-2xl border border-white bg-white p-3.5 text-left shadow-[0_4px_18px_-12px_rgba(15,23,42,0.24)] transition-all hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98]"
              >
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${color}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="flex w-full items-center justify-between gap-1 text-xs font-bold text-slate-800">
                  {label}
                  <ArrowRight className="h-3.5 w-3.5 text-slate-400 transition-transform group-hover:translate-x-0.5" />
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="mb-6 rounded-2xl border border-white bg-white p-4 shadow-[0_4px_18px_-12px_rgba(15,23,42,0.24)] sm:p-5">
          <SectionTitle
            title="Active numbers"
            subtitle="Waiting for a verification code."
            action={{ label: "View all", onClick: () => onNavigate("purchased-numbers") }}
          />
          {loading ? (
            <div className="space-y-2" aria-label="Loading active numbers">
              {[0, 1].map((item) => <div key={item} className="h-[68px] animate-pulse rounded-xl bg-slate-50" />)}
            </div>
          ) : loadErrors.activeNumbers ? (
            <p role="status" className="rounded-xl bg-amber-50 px-3 py-4 text-center text-xs text-amber-800">Active numbers couldn’t be loaded. Pull down to refresh.</p>
          ) : activeNumbers.length === 0 ? (
            <div className="rounded-xl bg-slate-50 px-4 py-6 text-center">
              <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-400 shadow-sm">
                <Smartphone className="h-5 w-5" />
              </span>
              <p className="mt-2 text-sm font-semibold text-slate-700">No active numbers</p>
              <p className="mt-1 text-xs text-slate-500">Your numbers waiting for a code will show here.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {activeNumbers.map((number) => (
                <div key={number.id} className="flex min-w-0 items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-royal-50 text-royal-700">
                    <Smartphone className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-900">{number.phone_number || "Number pending"}</p>
                    <p className="mt-0.5 truncate text-xs capitalize text-slate-500">
                      {[number.service_name, number.country_name || number.country_code].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <ActiveCountdown expiresAt={number.expires_at} createdAt={number.created_at} />
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-white bg-white p-4 shadow-[0_4px_18px_-12px_rgba(15,23,42,0.24)] sm:p-5">
          <SectionTitle
            title="Recent transactions"
            subtitle="Your latest wallet activity · 7 days"
            action={{ label: "See all", onClick: () => onNavigate("transactions") }}
          />
          {loading ? (
            <div className="space-y-2" aria-label="Loading recent transactions">
              {[0, 1, 2].map((item) => <div key={item} className="h-[58px] animate-pulse rounded-xl bg-slate-50" />)}
            </div>
          ) : loadErrors.transactions ? (
            <p role="status" className="rounded-xl bg-amber-50 px-3 py-4 text-center text-xs text-amber-800">Recent transactions couldn’t be loaded. Pull down to refresh.</p>
          ) : recentTxns.length === 0 ? (
            <div className="rounded-xl bg-slate-50 px-4 py-6 text-center">
              <p className="text-sm font-semibold text-slate-700">Nothing to show yet</p>
              <p className="mt-1 text-xs text-slate-500">Transactions from the last 7 days will appear here.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentTxns.map((transaction) => {
                const isCredit = transaction.type === "deposit" || transaction.type === "refund";
                const Icon = transaction.type === "deposit" ? ArrowDownLeft : transaction.type === "refund" ? RefreshCw : ArrowUpRight;
                const isComplete = transaction.status === "completed";
                return (
                  <div key={transaction.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isCredit ? "bg-emerald-50 text-emerald-700" : "bg-royal-50 text-royal-700"}`}>
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold capitalize text-slate-900">{transaction.description || transaction.type}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">{formatDate(transaction.created_at)}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`text-sm font-extrabold tabular-nums ${isCredit ? "text-emerald-700" : "text-slate-900"}`}>
                        {isCredit ? "+" : "−"}{formatNaira(transaction.amount)}
                      </p>
                      <span className={`mt-1 inline-flex items-center gap-1 text-[10px] font-semibold ${isComplete ? "text-emerald-700" : transaction.status === "pending" ? "text-amber-700" : "text-slate-400"}`}>
                        {isComplete && <Check className="h-3 w-3" />}
                        {transaction.status}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
