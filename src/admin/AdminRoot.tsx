import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AdminAuthProvider, useAdminAuth } from "./AdminAuth";
import { AdminLayout, type AdminPage } from "./AdminLayout";
import { AdminOverview } from "./pages/AdminOverview";
import { AdminUsers } from "./pages/AdminUsers";
import { AdminLoginActivity } from "./pages/AdminLoginActivity";
import { AdminOtpOrders } from "./pages/AdminOtpOrders";
import { AdminEmailPurchases } from "./pages/AdminEmailPurchases";
import { AdminWallet } from "./pages/AdminWallet";
import { AdminBulkEmail } from "./pages/AdminBulkEmail";
import { AdminSentEmails } from "./pages/AdminSentEmails";
import { AdminTopCustomers } from "./pages/AdminTopCustomers";
import { AdminDevelopers } from "./pages/AdminDevelopers";
import { AdminDeveloperPerformance } from "./pages/AdminDeveloperPerformance";
import { AdminSupport } from "./pages/AdminSupport";
import { AdminAiMonitoring } from "./pages/AdminAiMonitoring";
import { AdminPerformance } from "./pages/AdminPerformance";
import { AdminLiveWebsite } from "./pages/AdminLiveWebsite";
import { AdminSettings } from "./pages/AdminSettings";
import { AdminLoginPage } from "./AdminLoginPage";
import { Spinner } from "../components/ui";

const VALID: AdminPage[] = ["overview", "users", "logins", "otp-orders", "email-purchases", "wallet", "bulk-email", "sent-emails", "top-customers", "developers", "developer-performance", "support", "ai-monitoring", "performance", "live-website", "settings"];

function AdminRouter() {
  const navigate = useNavigate();
  const location = useLocation();
  const basePath = location.pathname.startsWith("/admin/monten500") ? "/admin/monten500" : "";
  const pathSegments = location.pathname.slice(basePath.length).split("/").filter(Boolean);
  const pathPage = pathSegments[0] as AdminPage | undefined;
  const developerId = pathSegments[1] || undefined;
  const [page, setPage] = useState<AdminPage>(pathPage && VALID.includes(pathPage) ? pathPage : "overview");

  useEffect(() => {
    if (pathPage && VALID.includes(pathPage) && pathPage !== page) setPage(pathPage);
  }, [pathPage, page]);

  const handleNavigate = (p: AdminPage) => {
    setPage(p);
    navigate(`${basePath}/${p}`);
  };

  return (
    <AdminLayout current={page} onNavigate={handleNavigate}>
      {page === "overview" && <AdminOverview onNavigate={handleNavigate} />}
      {page === "users" && <AdminUsers />}
      {page === "logins" && <AdminLoginActivity />}
      {page === "otp-orders" && <AdminOtpOrders />}
      {page === "email-purchases" && <AdminEmailPurchases />}
      {page === "wallet" && <AdminWallet />}
      {page === "bulk-email" && <AdminBulkEmail />}
      {page === "sent-emails" && <AdminSentEmails />}
      {page === "top-customers" && <AdminTopCustomers />}
      {page === "developers" && <AdminDevelopers />}
      {page === "developer-performance" && <AdminDeveloperPerformance userId={developerId} />}
      {page === "support" && <AdminSupport />}
      {page === "ai-monitoring" && <AdminAiMonitoring />}
      {page === "performance" && <AdminPerformance />}
      {page === "live-website" && <AdminLiveWebsite />}
      {page === "settings" && <AdminSettings />}
    </AdminLayout>
  );
}

function AdminApplication() {
  const { admin, loading } = useAdminAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <Spinner className="w-8 h-8 text-blue-500" />
      </div>
    );
  }

  return admin ? <AdminRouter /> : <AdminLoginPage />;
}

export function AdminRoot() {
  return (
    <AdminAuthProvider>
      <AdminApplication />
    </AdminAuthProvider>
  );
}

export { useAdminAuth };
