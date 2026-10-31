import { useState, useEffect, ReactNode, createContext, useContext } from "react";
import {
  Menu, X, Wallet, Bell, User, LifeBuoy, LayoutDashboard, ShoppingBag,
  CreditCard, History, Smartphone, LogOut, Megaphone, Send, Music, RefreshCw
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { formatNaira, timeAgo } from "../lib/format";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { Logo } from "./ui";
import { MobileBottomNav } from "./MobileBottomNav";
import type { Notification } from "../types";
import { useOtpNotifications } from "../hooks/useOtpNotifications";

export type DashboardPage =
  | "dashboard" | "buy-numbers" | "fund-wallet" | "transactions"
  | "purchased-numbers" | "notifications" | "profile" | "support"
  | "services" | "active-numbers" | "sms-inbox" | "account-settings";

interface NavItem {
  id: DashboardPage;
  label: string;
  icon: ReactNode;
}

const navItems: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="w-5 h-5" /> },
  { id: "buy-numbers", label: "Buy Numbers", icon: <ShoppingBag className="w-5 h-5" /> },
  { id: "fund-wallet", label: "Fund Wallet", icon: <CreditCard className="w-5 h-5" /> },
  { id: "transactions", label: "Transaction History", icon: <History className="w-5 h-5" /> },
  { id: "purchased-numbers", label: "Purchased Numbers", icon: <Smartphone className="w-5 h-5" /> },
  { id: "notifications", label: "Notifications", icon: <Bell className="w-5 h-5" /> },
  { id: "profile", label: "Profile", icon: <User className="w-5 h-5" /> },
  { id: "support", label: "Customer Support", icon: <LifeBuoy className="w-5 h-5" /> },
];

const socialLinks = [
  { label: "WhatsApp Channel", icon: <Megaphone className="w-5 h-5" />, href: "https://whatsapp.com/channel/0029VbC5FycGehEPOnXIme2f" },
  { label: "Telegram Channel", icon: <Send className="w-5 h-5" />, href: "https://t.me/montensms" },
  { label: "TikTok", icon: <Music className="w-5 h-5" />, href: "https://tiktok.com/@montensms" },
];

const DashboardRefreshContext = createContext(0);

export function useDashboardRefreshKey() {
  return useContext(DashboardRefreshContext);
}

export function DashboardLayout({
  current,
  onNavigate,
  children,
}: {
  current: DashboardPage;
  onNavigate: (page: DashboardPage) => void;
  children: ReactNode;
}) {
  const { profile, signOut, refreshProfile } = useAuth();
  useOtpNotifications();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    fetchNotifications();
  }, [current]);

  const fetchNotifications = async () => {
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);
    if (data) {
      setNotifications(data as Notification[]);
      setUnreadCount(data.filter((n) => !n.read).length);
    }
  };

  const refreshDashboard = async () => {
    await Promise.all([refreshProfile(), fetchNotifications()]);
    setRefreshKey((k) => k + 1);
  };

  const { pull, refreshing } = usePullToRefresh(refreshDashboard);

  const handleNavClick = (page: DashboardPage) => {
    onNavigate(page);
    setSidebarOpen(false);
  };

  const markAllRead = async () => {
    await supabase.from("notifications").update({ read: true }).eq("read", false);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  const indicatorVisible = refreshing || pull > 8;
  const indicatorSettled = pull === 0 || refreshing;

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-navy-900/50 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`fixed lg:sticky top-0 left-0 h-screen w-72 bg-navy-900 z-40 transform transition-transform duration-300 ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}>
        <div className="flex items-center justify-between px-5 pb-5 pt-[calc(env(safe-area-inset-top)_+_1.25rem)] border-b border-navy-700">
          <Logo size="md" />
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-slate-400 hover:text-white p-2 -mr-2">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4">
          <div className="bg-gradient-to-br from-royal-600 to-royal-800 rounded-xl p-4">
            <div className="flex items-center gap-2 text-royal-100 text-xs font-medium mb-1">
              <Wallet className="w-3.5 h-3.5" /> Wallet Balance
            </div>
            <p className="text-2xl font-bold text-white">{formatNaira(profile?.wallet_balance ?? 0)}</p>
            <button onClick={() => handleNavClick("fund-wallet")} className="mt-3 w-full bg-white/15 hover:bg-white/25 text-white text-xs font-semibold py-2.5 rounded-lg transition-base">
              Fund Wallet
            </button>
          </div>
        </div>

        <nav className="px-3 pb-4 overflow-y-auto" style={{ maxHeight: "calc(100vh - 280px)" }}>
          {navItems.map((item) => (
            <button key={item.id} onClick={() => handleNavClick(item.id)} className={`w-full flex items-center gap-3 px-4 py-3.5 lg:py-3 rounded-lg text-sm font-medium transition-base mb-1 ${current === item.id ? "bg-royal-600 text-white" : "text-slate-300 hover:bg-navy-800 hover:text-white"}`}>
              {item.icon}
              {item.label}
              {item.id === "notifications" && unreadCount > 0 && (
                <span className="ml-auto bg-error-500 text-white text-xs px-1.5 py-0.5 rounded-full">{unreadCount}</span>
              )}
            </button>
          ))}

          <div className="pt-3 mt-3 border-t border-navy-700">
            <p className="px-4 mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Our Channels</p>
            {socialLinks.map((link) => (
              <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer" className="w-full flex items-center gap-3 px-4 py-3.5 lg:py-3 rounded-lg text-sm font-medium text-slate-300 hover:bg-navy-800 hover:text-white transition-base mb-1">
                {link.icon}
                {link.label}
              </a>
            ))}
          </div>

          <button onClick={signOut} className="w-full flex items-center gap-3 px-4 py-3.5 lg:py-3 rounded-lg text-sm font-medium text-slate-300 hover:bg-error-600 hover:text-white transition-base mt-4">
            <LogOut className="w-5 h-5" /> Logout
          </button>
        </nav>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 bg-white border-b border-slate-200 px-4 pb-3 pt-[calc(env(safe-area-inset-top)_+_0.75rem)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={() => setSidebarOpen(true)} aria-label="Open menu" className="lg:hidden text-navy-900 p-2 -ml-2 rounded-lg hover:bg-slate-100 transition-base">
              <Menu className="w-6 h-6" />
            </button>
            <button onClick={() => onNavigate("dashboard")} className="lg:hidden" aria-label="Go to dashboard">
              <Logo size="sm" />
            </button>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="lg:hidden flex items-center gap-1.5 bg-royal-50 px-3 py-1.5 rounded-lg">
              <Wallet className="w-4 h-4 text-royal-600" />
              <span className="text-sm font-bold text-navy-900">{formatNaira(profile?.wallet_balance ?? 0)}</span>
            </div>

            <button onClick={() => onNavigate("support")} className="hidden sm:flex items-center gap-0.5 text-[10px] text-slate-600 hover:text-navy-900 px-1.5 py-1 rounded-md hover:bg-slate-100 transition-base">
              <LifeBuoy className="w-3 h-3" /> Support
            </button>

            <div className="relative">
              <button onClick={() => setNotifOpen(!notifOpen)} aria-label="Notifications" className="relative p-2 rounded-lg hover:bg-slate-100 transition-base">
                <Bell className="w-5 h-5 text-navy-700" />
                {unreadCount > 0 && <span className="absolute top-1 right-1 w-2 h-2 bg-error-500 rounded-full" />}
              </button>
              {notifOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setNotifOpen(false)} />
                  <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white rounded-xl border border-slate-200 card-shadow-lg z-40 animate-fade-in max-h-96 overflow-y-auto">
                    <div className="flex items-center justify-between p-3 border-b border-slate-100">
                      <h3 className="font-semibold text-navy-900 text-sm">Notifications</h3>
                      {unreadCount > 0 && <button onClick={markAllRead} className="text-xs text-royal-600 hover:text-royal-700 font-medium">Mark all read</button>}
                    </div>
                    {notifications.length === 0 ? (
                      <div className="p-6 text-center text-sm text-slate-400">No notifications yet</div>
                    ) : (
                      notifications.map((n) => (
                        <div key={n.id} className={`p-3 border-b border-slate-50 hover:bg-slate-50 cursor-pointer ${!n.read ? "bg-royal-50/50" : ""}`}>
                          <div className="flex items-start gap-2">
                            {!n.read && <span className="w-2 h-2 bg-royal-500 rounded-full mt-1.5 flex-shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-navy-900">{n.title}</p>
                              {n.message && <p className="text-xs text-slate-500 mt-0.5">{n.message}</p>}
                              <p className="text-xs text-slate-400 mt-1">{timeAgo(n.created_at)}</p>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                    <button onClick={() => { onNavigate("notifications"); setNotifOpen(false); }} className="w-full p-3 text-center text-sm text-royal-600 hover:bg-slate-50 font-medium">View all notifications</button>
                  </div>
                </>
              )}
            </div>

            <button onClick={() => onNavigate("profile")} className="hidden lg:flex items-center gap-2 p-1 pr-2 rounded-lg hover:bg-slate-100 transition-base">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-navy-900 to-royal-600 flex items-center justify-center text-white text-sm font-bold overflow-hidden">
                {profile?.avatar_url ? <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" /> : profile?.full_name?.charAt(0).toUpperCase() ?? "U"}
              </div>
              <span className="hidden sm:block text-sm font-medium text-navy-900 max-w-[120px] truncate">{profile?.full_name?.split(" ")[0] ?? "User"}</span>
            </button>
          </div>
        </header>

        <div
          aria-hidden="true"
          className={`pointer-events-none fixed left-1/2 z-40 lg:hidden ${indicatorSettled ? "transition-[opacity,transform] duration-200" : ""}`}
          style={{
            top: "calc(env(safe-area-inset-top) + 4.5rem)",
            opacity: indicatorVisible ? 1 : 0,
            transform: `translate(-50%, ${refreshing ? 0 : Math.max(pull - 40, -40)}px)`,
          }}
        >
          <div className="w-10 h-10 rounded-full bg-white border border-slate-200 card-shadow-lg flex items-center justify-center">
            <RefreshCw
              className={`w-4 h-4 text-royal-600 ${refreshing ? "animate-spin" : ""}`}
              style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }}
            />
          </div>
        </div>

        <main className="flex-1 p-4 sm:p-6 max-w-6xl w-full mx-auto pb-[calc(6rem_+_env(safe-area-inset-bottom))] lg:pb-6">
          <DashboardRefreshContext.Provider value={refreshKey}>
            {children}
          </DashboardRefreshContext.Provider>
        </main>
      </div>

      <MobileBottomNav current={current} onNavigate={onNavigate} />
    </div>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold text-navy-900">{title}</h1>
      {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
    </div>
  );
}
