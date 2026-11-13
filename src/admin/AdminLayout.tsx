import { useState, type ReactNode } from "react";
import { useAdminAuth } from "./AdminAuth";
import { LayoutDashboard, Users, LogIn, Smartphone, Mail, Wallet, Send, Inbox, Trophy, LifeBuoy, Bot, Activity, Globe, Settings, LogOut, Menu, X, ShieldCheck, Code2, TrendingUp } from "lucide-react";

export type AdminPage =
  | "overview" | "users" | "logins" | "otp-orders" | "email-purchases"
  | "wallet" | "bulk-email" | "sent-emails" | "top-customers"
  | "developers" | "developer-performance"
  | "support" | "ai-monitoring" | "performance" | "live-website" | "app-management" | "settings";

const NAV: { id: AdminPage; label: string; icon: typeof LayoutDashboard; group: string }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, group: "Business" },
  { id: "users", label: "Users", icon: Users, group: "Business" },
  { id: "logins", label: "Login Activity", icon: LogIn, group: "Business" },
  { id: "top-customers", label: "Top Customers", icon: Trophy, group: "Business" },
  { id: "developers", label: "Developers", icon: Code2, group: "Business" },
  { id: "developer-performance", label: "Developer Performance", icon: TrendingUp, group: "Business" },
  { id: "otp-orders", label: "OTP Orders", icon: Smartphone, group: "Orders" },
  { id: "email-purchases", label: "Email Purchases", icon: Mail, group: "Orders" },
  { id: "wallet", label: "Wallet & Deposits", icon: Wallet, group: "Orders" },
  { id: "bulk-email", label: "Bulk Email", icon: Send, group: "Email" },
  { id: "sent-emails", label: "Sent Emails", icon: Inbox, group: "Email" },
  { id: "support", label: "Support Center", icon: LifeBuoy, group: "Service" },
  { id: "ai-monitoring", label: "AI Monitoring", icon: Bot, group: "Service" },
  { id: "performance", label: "Performance", icon: Activity, group: "System" },
  { id: "live-website", label: "Live Website", icon: Globe, group: "System" },
  { id: "app-management", label: "App Management", icon: Smartphone, group: "System" },
  { id: "settings", label: "Admin Settings", icon: Settings, group: "System" },
];

const GROUPS = ["Business", "Orders", "Email", "Service", "System"];

export function AdminLayout({ current, onNavigate, children }: { current: AdminPage; onNavigate: (p: AdminPage) => void; children: ReactNode }) {
  const { admin, signOut } = useAdminAuth();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-4">
      {GROUPS.map((g) => (
        <div key={g}>
          <p className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">{g}</p>
          <div className="space-y-0.5">
            {NAV.filter((n) => n.group === g).map((n) => {
              const Icon = n.icon;
              const active = current === n.id;
              return (
                <button
                  key={n.id}
                  onClick={() => { onNavigate(n.id); setOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    active ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate">{n.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  const header = (
    <div className="flex items-center gap-2.5 px-5 h-14 border-b border-slate-800 flex-shrink-0">
      <ShieldCheck className="w-6 h-6 text-blue-500" />
      <div className="leading-tight">
        <p className="text-white font-bold text-sm">MONTEN SMS</p>
        <p className="text-[10px] text-slate-500 uppercase tracking-wider">Super Admin</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-100 flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-60 bg-slate-900 fixed inset-y-0 left-0 z-40">
        {header}
        {nav}
        <div className="p-3 border-t border-slate-800 flex-shrink-0">
          <p className="text-xs text-slate-400 truncate mb-2 px-1">{admin?.email}</p>
          <button onClick={signOut} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-800 hover:text-red-400 transition-colors">
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="relative flex flex-col w-64 bg-slate-900 h-full">
            <div className="flex items-center justify-between pr-3">
              {header}
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            {nav}
            <div className="p-3 border-t border-slate-800">
              <button onClick={signOut} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-800 hover:text-red-400">
                <LogOut className="w-4 h-4" /> Sign out
              </button>
            </div>
          </aside>
        </div>
      )}

      <div className="flex-1 lg:ml-60 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <div className="lg:hidden sticky top-0 z-30 bg-slate-900 h-14 flex items-center justify-between px-4 flex-shrink-0">
          <button onClick={() => setOpen(true)} className="text-slate-300 hover:text-white"><Menu className="w-6 h-6" /></button>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-blue-500" />
            <span className="text-white font-bold text-sm">Super Admin</span>
          </div>
          <button onClick={signOut} className="text-slate-300 hover:text-red-400"><LogOut className="w-5 h-5" /></button>
        </div>
        <main className="flex-1 p-4 sm:p-6 lg:p-8 min-w-0">{children}</main>
      </div>
    </div>
  );
}
