import { lazy, Suspense, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AdminAuthProvider, useAdminAuth } from "./AdminAuth";
import { AdminLayout, type AdminPage } from "./AdminLayout";
import { AdminLoginPage } from "./AdminLoginPage";

const AdminOverview = lazy(() => import("./pages/AdminOverview").then((m) => ({ default: m.AdminOverview })));
const AdminUsers = lazy(() => import("./pages/AdminUsers").then((m) => ({ default: m.AdminUsers })));
const AdminLoginActivity = lazy(() => import("./pages/AdminLoginActivity").then((m) => ({ default: m.AdminLoginActivity })));
const AdminOtpOrders = lazy(() => import("./pages/AdminOtpOrders").then((m) => ({ default: m.AdminOtpOrders })));
const AdminEmailPurchases = lazy(() => import("./pages/AdminEmailPurchases").then((m) => ({ default: m.AdminEmailPurchases })));
const AdminWallet = lazy(() => import("./pages/AdminWallet").then((m) => ({ default: m.AdminWallet })));
const AdminBulkEmail = lazy(() => import("./pages/AdminBulkEmail").then((m) => ({ default: m.AdminBulkEmail })));
const AdminSentEmails = lazy(() => import("./pages/AdminSentEmails").then((m) => ({ default: m.AdminSentEmails })));
const AdminTopCustomers = lazy(() => import("./pages/AdminTopCustomers").then((m) => ({ default: m.AdminTopCustomers })));
const AdminDevelopers = lazy(() => import("./pages/AdminDevelopers").then((m) => ({ default: m.AdminDevelopers })));
const AdminDeveloperPerformance = lazy(() => import("./pages/AdminDeveloperPerformance").then((m) => ({ default: m.AdminDeveloperPerformance })));
const AdminSupport = lazy(() => import("./pages/AdminSupport").then((m) => ({ default: m.AdminSupport })));
const AdminAiMonitoring = lazy(() => import("./pages/AdminAiMonitoring").then((m) => ({ default: m.AdminAiMonitoring })));
const AdminPerformance = lazy(() => import("./pages/AdminPerformance").then((m) => ({ default: m.AdminPerformance })));
const AdminLiveWebsite = lazy(() => import("./pages/AdminLiveWebsite").then((m) => ({ default: m.AdminLiveWebsite })));
const AdminSettings = lazy(() => import("./pages/AdminSettings").then((m) => ({ default: m.AdminSettings })));
const AdminAppManagement = lazy(() => import("./pages/AdminAppManagement").then((m) => ({ default: m.AdminAppManagement })));

function AdminSpinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-label="Loading">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

const VALID: AdminPage[] = ["overview", "users", "logins", "otp-orders", "email-purchases", "wallet", "bulk-email", "sent-emails", "top-customers", "developers", "developer-performance", "support", "ai-monitoring", "performance", "live-website", "app-management", "settings"];

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
      <Suspense fallback={<div className="flex min-h-48 items-center justify-center"><AdminSpinner className="h-8 w-8 text-blue-600" /></div>}>
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
        {page === "app-management" && <AdminAppManagement />}
        {page === "settings" && <AdminSettings />}
      </Suspense>
    </AdminLayout>
  );
}

function AdminApplication() {
  const { admin, loading } = useAdminAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <AdminSpinner className="w-8 h-8 text-blue-500" />
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
