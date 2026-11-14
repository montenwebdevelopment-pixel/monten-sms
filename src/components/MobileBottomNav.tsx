import {
  ShoppingBag, User, Wallet, Mail,
  type LucideIcon,
} from "lucide-react";
import type { DashboardPage } from "./DashboardLayout";

const items: { id: DashboardPage; label: string; icon: LucideIcon }[] = [
  { id: "email-otp", label: "Email Purchase", icon: Mail },
  { id: "buy-numbers", label: "Buy Number", icon: ShoppingBag },
  { id: "fund-wallet", label: "Funds Wallet", icon: Wallet },
  { id: "profile", label: "Profile", icon: User },
];

export function MobileBottomNav({ current, onNavigate }: { current: DashboardPage; onNavigate: (page: DashboardPage) => void }) {
  return (
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 lg:hidden bg-white/95 backdrop-blur border-t border-slate-200 pb-[env(safe-area-inset-bottom)]">
      <ul className="grid grid-cols-4">
        {items.map(({ id, label, icon: Icon }) => {
          const active = current === id || (id === "profile" && current === "account-settings");
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => onNavigate(id)}
                aria-current={active ? "page" : undefined}
                className={`w-full min-h-[64px] flex flex-col items-center justify-center gap-1 transition-base active:scale-95 ${active ? "text-royal-700" : "text-slate-500"}`}
              >
                <span className={`flex items-center justify-center w-12 h-7 rounded-full transition-colors duration-200 ${active ? "bg-royal-100" : ""}`}>
                  <Icon className="w-5 h-5" strokeWidth={active ? 2.5 : 2} />
                </span>
                <span className={`whitespace-nowrap text-[10px] sm:text-[11px] leading-none ${active ? "font-semibold" : "font-medium"}`}>{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
