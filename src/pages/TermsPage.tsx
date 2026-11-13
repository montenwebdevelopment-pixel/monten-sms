import { useState, useEffect } from "react";
import { ArrowRight, FileText, Mail, Send } from "lucide-react";
import { Logo } from "../components/ui";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

const sections = [
  {
    title: "1. Acceptance of Terms",
    body: [
      "By creating a MONTEN SMS account or using the service, you agree to these Terms & Conditions and our Privacy Policy. If you do not agree, please do not use the service.",
    ],
  },
  {
    title: "2. What MONTEN SMS Provides",
    body: [
      "MONTEN SMS lets you rent temporary virtual phone numbers from 190+ countries to receive SMS verification codes (OTPs) for services like WhatsApp, Telegram, Gmail and many more.",
      "Each number is rented for a single service and a limited activation window, typically a few minutes to receive one SMS code.",
    ],
  },
  {
    title: "3. Your Account",
    body: [
      "You must provide a valid email address and keep your login details safe. You are responsible for all activity that happens on your account.",
      "One person may maintain one account. Accounts used for fraud, abuse of the payment system, or attempts to exploit number refunds may be suspended.",
    ],
  },
  {
    title: "4. Wallet and Payments",
    body: [
      "Wallet funding is handled securely through Flutterwave (card, bank transfer or USSD). The minimum deposit is NGN 100.",
      "Wallet funds never expire and can be used any time to buy numbers. Wallet balances are not withdrawable as cash unless a refund policy below applies.",
      "Prices per number vary by country and service and are shown before you confirm a purchase.",
    ],
  },
  {
    title: "5. Refund Policy",
    body: [
      "If a number is canceled before any SMS arrives, or the activation times out without receiving an SMS, the amount is automatically refunded to your wallet.",
      "If you were charged incorrectly due to a system error, contact support and our team will review and refund it where appropriate.",
    ],
  },
  {
    title: "6. Acceptable Use",
    body: [
      "You agree not to use MONTEN SMS for fraud, harassment, spam, or any activity that is illegal under Nigerian law or the law of your country.",
      "You agree not to attempt to hack, overload, resell access to, or reverse engineer the service.",
    ],
  },
  {
    title: "7. Service Availability",
    body: [
      "Number availability and SMS delivery depend on third-party telecom providers, so we cannot guarantee every number or service will always be available. We work continuously to keep availability high.",
    ],
  },
  {
    title: "8. Limitation of Liability",
    body: [
      "MONTEN SMS is provided 'as is'. To the maximum extent permitted by law, we are not liable for indirect or consequential losses arising from your use of the service, including outcomes of the accounts you verify with rented numbers.",
    ],
  },
  {
    title: "9. Changes to These Terms",
    body: [
      "We may update these terms from time to time. Material changes will be announced in the app or by email. Continuing to use the service after an update means you accept the revised terms.",
    ],
  },
];

export function TermsPage() {
  const navigate = useNavigate();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session))).catch(() => {});
  }, []);

  const backToDashboard = () => {
    try { sessionStorage.removeItem("monten_nav_source"); } catch { /* ignore */ }
    navigate("/dashboard/dashboard");
  };

  return (
    <div className="min-h-screen bg-white">
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Logo size="md" />
          <button
            onClick={() => {
              if (signedIn) backToDashboard();
              else navigate("/");
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-royal-600 text-white text-sm font-semibold hover:bg-royal-700 transition-colors"
          >
            {signedIn ? "Back to Dashboard" : "Back to Home"} <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-royal-50 text-royal-700 text-xs font-medium mb-4">
          <FileText className="w-3.5 h-3.5" /> Terms &amp; Conditions
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-navy-900 tracking-tight mb-3">Terms &amp; Conditions</h1>
        <p className="text-sm text-slate-500 mb-10">Last updated: November 2026</p>

        <div className="space-y-8">
          {sections.map((s) => (
            <section key={s.title}>
              <h2 className="text-lg font-bold text-navy-900 mb-2">{s.title}</h2>
              <div className="space-y-2">
                {s.body.map((p, i) => (
                  <p key={i} className="text-sm text-slate-600 leading-relaxed">{p}</p>
                ))}
              </div>
            </section>
          ))}

          <section className="bg-slate-50 rounded-2xl p-5 sm:p-6">
            <h2 className="text-lg font-bold text-navy-900 mb-2 flex items-center gap-2">Contact Us</h2>
            <p className="text-sm text-slate-600 leading-relaxed mb-3">
              Questions about these terms? Reach our support team on Telegram at{" "}
              <a href="https://t.me/montensmssupport" target="_blank" rel="noopener noreferrer" className="font-semibold text-royal-600 hover:text-royal-700 underline underline-offset-2">@montensmssupport</a>{" "}
              or by email at{" "}
              <a href="mailto:support@montensms.com" className="font-semibold text-royal-600 hover:text-royal-700 underline underline-offset-2">support@montensms.com</a>.
            </p>
            <p className="text-xs text-slate-400">MONTEN SMS &mdash; support@montensms.com</p>
          </section>
        </div>

        <div className="mt-10 pt-6 border-t border-slate-100 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <a href="/privacy" className="text-royal-600 hover:text-royal-700 font-medium">Privacy Policy</a>
          <a href="/delete-account" className="text-royal-600 hover:text-royal-700 font-medium">Delete Account</a>
          {signedIn && (
            <button onClick={backToDashboard} className="text-royal-600 hover:text-royal-700 font-medium">Back to Dashboard</button>
          )}
          <button onClick={() => (signedIn ? backToDashboard() : navigate("/"))} className="text-slate-500 hover:text-navy-900 font-medium inline-flex items-center gap-1">
            {signedIn ? "Back to Dashboard" : "Back to Home"} <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <footer className="bg-navy-900 text-slate-400 py-8 px-4 sm:px-6 text-center text-sm">
        <div className="flex items-center justify-center gap-4 mb-4">
          <a href="mailto:support@montensms.com" className="w-10 h-10 rounded-lg bg-navy-800 hover:bg-royal-600 flex items-center justify-center text-slate-300 hover:text-white transition-colors" aria-label="Email support">
            <Mail className="w-5 h-5" />
          </a>
          <a href="https://t.me/montensmssupport" target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-lg bg-navy-800 hover:bg-royal-600 flex items-center justify-center text-slate-300 hover:text-white transition-colors" aria-label="Telegram support">
            <Send className="w-5 h-5" />
          </a>
        </div>
        <p>&copy; 2025 MONTEN SMS. All rights reserved.</p>
      </footer>
    </div>
  );
}
