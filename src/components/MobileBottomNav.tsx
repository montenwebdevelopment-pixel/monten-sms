import {
  ShoppingBag, Smartphone, MessageSquare, Settings, Wallet, Mail,
  type LucideIcon,
} from "lucide-react";
import type { DashboardPage } from "./DashboardLayout";
import { isNativeApp } from "../lib/native";

const nativeItems: { id: DashboardPage; label: string; icon: LucideIcon }[] = [
  { id: "email-otp", label: "Email Purchase", icon: Mail },
  { id: "buy-numbers", label: "Buy Numbers", icon: ShoppingBag },
  { id: "fund-wallet", label: "Wallet", icon: Wallet },
  { id: "account-settings", label: "Account Settings", icon: Settings },
];

const webItems: { id: DashboardPage; label: string; icon: LucideIcon }[] = [
  { id: "services", label: "Services", icon: ShoppingBag },
  { id: "active-numbers", label: "Active Numbers", icon: Smartphone },
  { id: "sms-inbox", label: "SMS Inbox", icon: MessageSquare },
  { id: "account-settings", label: "Account Settings", icon: Settings },
];

export function MobileBottomNav({ current, onNavigate }: { current: DashboardPage; onNavigate: (page: DashboardPage) => void }) {
  const items = isNativeApp() ? nativeItems : webItems;
  return (
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 lg:hidden bg-white/95 backdrop-blur border-t border-slate-200 pb-[env(safe-area-inset-bottom)]">
      <ul className="grid grid-cols-4">
        {items.map(({ id, label, icon: Icon }) => {
          const active = current === id;
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
                <span className={`text-[11px] leading-none ${active ? "font-semibold" : "font-medium"}`}>{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
