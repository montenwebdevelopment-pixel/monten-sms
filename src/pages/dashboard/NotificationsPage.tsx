import { useEffect, useState } from "react";
import { Bell, Check, Wallet, ShoppingBag, MessageSquare } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { timeAgo } from "../../lib/format";
import { Card, EmptyState, Button } from "../../components/ui";
import { PageHeader, useDashboardRefreshKey } from "../../components/DashboardLayout";
import type { Notification } from "../../types";

export function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshKey = useDashboardRefreshKey();
  useEffect(() => { fetchNotifications(); }, [refreshKey]);
  const fetchNotifications = async () => {
    setLoading(true);
    const { data } = await supabase.from("notifications").select("*").order("created_at", { ascending: false });
    setNotifications((data ?? []) as Notification[]); setLoading(false);
  };

  const markAllRead = async () => { await supabase.from("notifications").update({ read: true }).eq("read", false); fetchNotifications(); };
  const getIcon = (type: string) => type === "deposit" ? <Wallet className="w-4 h-4" /> : type === "purchase" ? <ShoppingBag className="w-4 h-4" /> : type === "otp" ? <MessageSquare className="w-4 h-4" /> : <Bell className="w-4 h-4" />;
  const getColor = (type: string) => type === "deposit" ? "bg-success-100 text-success-600" : type === "purchase" ? "bg-royal-100 text-royal-600" : type === "otp" ? "bg-navy-100 text-navy-700" : "bg-slate-100 text-slate-600";

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-2xl font-bold text-navy-900">Notifications</h1><p className="text-sm text-slate-500 mt-1">Stay updated on your account activity</p></div>
        {notifications.some(n => !n.read) && <Button variant="outline" onClick={markAllRead} className="text-sm"><Check className="w-4 h-4" /> Mark all read</Button>}
      </div>
      <Card className="p-0 overflow-hidden">
        {loading ? <div className="p-8 text-center text-sm text-slate-400">Loading...</div> :
         notifications.length === 0 ? <EmptyState icon={<Bell className="w-7 h-7" />} title="No notifications" message="You'll receive notifications for deposits, purchases, and OTP arrivals here" /> : (
          <div className="divide-y divide-slate-50">
            {notifications.map(n => (
              <div key={n.id} className={`flex items-start gap-3 p-4 hover:bg-slate-50 transition-base ${!n.read ? "bg-royal-50/30" : ""}`}>
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${getColor(n.type)}`}>{getIcon(n.type)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2"><p className="text-sm font-semibold text-navy-900">{n.title}</p>{!n.read && <span className="w-2 h-2 bg-royal-500 rounded-full" />}</div>
                  {n.message && <p className="text-sm text-slate-500 mt-0.5">{n.message}</p>}
                  <p className="text-xs text-slate-400 mt-1">{timeAgo(n.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
