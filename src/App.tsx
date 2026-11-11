import { useState, useEffect } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/auth/LoginPage";
import { RegisterPage } from "./pages/auth/RegisterPage";
import { VerifyOtpPage } from "./pages/auth/VerifyOtpPage";
import { ForgotPasswordPage } from "./pages/auth/ForgotPasswordPage";
import { UpdatePasswordPage } from "./pages/auth/UpdatePasswordPage";
import { DashboardLayout, type DashboardPage } from "./components/DashboardLayout";
import { DashboardHome } from "./pages/dashboard/DashboardHome";
import { BuyNumbersPage } from "./pages/dashboard/BuyNumbersPage";
import { FundWalletPage } from "./pages/dashboard/FundWalletPage";
import { TransactionsPage } from "./pages/dashboard/TransactionsPage";
import { PurchasedNumbersPage } from "./pages/dashboard/PurchasedNumbersPage";
import { NotificationsPage } from "./pages/dashboard/NotificationsPage";
import { ProfilePage } from "./pages/dashboard/ProfilePage";
import { SupportPage } from "./pages/dashboard/SupportPage";
import { SupportChatbot } from "./components/SupportChatbot";
import { Spinner } from "./components/ui";
import { PrivacyPolicyPage } from "./pages/PrivacyPolicyPage";
import { AccountDeletionPage } from "./pages/AccountDeletionPage";

function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, loading, profile } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Spinner className="w-8 h-8 text-royal-600" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (profile && !profile.email_verified) {
    return <Navigate to="/verify-otp" replace />;
  }

  return <>{children}</>;
}

function DashboardRouter() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathPage = location.pathname.split("/dashboard/")[1]?.split("/")[0] as DashboardPage;
  const [page, setPage] = useState<DashboardPage>(pathPage || "dashboard");

  useEffect(() => {
    if (pathPage && pathPage !== page) setPage(pathPage);
  }, [pathPage]);

  const handleNavigate = (p: DashboardPage) => {
    setPage(p);
    navigate(`/dashboard/${p}`);
  };

  const handleQuickPurchase = (serviceCode: string) => {
    setPage("buy-numbers");
    navigate("/dashboard/buy-numbers", { state: { quickPurchaseService: serviceCode } });
  };

  return (
    <DashboardLayout current={page} onNavigate={handleNavigate}>
      {page === "dashboard" && <DashboardHome onNavigate={handleNavigate} onQuickPurchase={handleQuickPurchase} />}
      {(page === "buy-numbers" || page === "services") && <BuyNumbersPage />}
      {page === "fund-wallet" && <FundWalletPage />}
      {page === "transactions" && <TransactionsPage />}
      {(page === "purchased-numbers" || page === "active-numbers") && <PurchasedNumbersPage view={page === "active-numbers" ? "active" : "all"} />}
      {page === "sms-inbox" && <PurchasedNumbersPage view="inbox" />}
      {page === "notifications" && <NotificationsPage />}
      {(page === "profile" || page === "account-settings") && <ProfilePage />}
      {page === "support" && <SupportPage />}
    </DashboardLayout>
  );
}

function AuthFlow() {
  const [otpEmail, setOtpEmail] = useState("");
  const navigate = useNavigate();

  const handleNavigate = (page: string) => navigate(`/${page}`);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage onNavigate={handleNavigate} />} />
      <Route path="/register" element={<RegisterPage onNavigate={handleNavigate} setOtpEmail={setOtpEmail} />} />
      <Route path="/verify-otp" element={<VerifyOtpPage email={otpEmail} onNavigate={handleNavigate} />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage onNavigate={handleNavigate} />} />
    </Routes>
  );
}

function AppRoutes() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!CapApp || !Capacitor.isNativePlatform?.()) return;
    const listener = CapApp.addListener("backButton", () => {
      if (location.pathname !== "/") {
        navigate(-1);
      } else {
        CapApp.exitApp();
      }
    });
    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, [location.pathname, navigate]);

  return (
    <>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
        <Route path="/delete-account" element={<AccountDeletionPage />} />
        <Route path="/update-password" element={<UpdatePasswordPage />} />
        <Route path="/dashboard" element={<Navigate to="/dashboard/dashboard" replace />} />
        <Route path="/dashboard/*" element={<AuthGate><DashboardRouter /></AuthGate>} />
      </Routes>
      <AuthFlow />
      <SupportChatbot />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
