import { ArrowRight, Lock, ShieldCheck, Mail, Send } from "lucide-react";
import { Logo } from "../components/ui";
import { useNavigate } from "react-router-dom";

const sections = [
  {
    title: "Information We Collect",
    body: [
      "When you create a MONTEN SMS account we collect your email address, your chosen username and full name, and a securely hashed password. We never see or store your password in readable form.",
      "We also keep a record of your wallet balance, your deposits, your number purchases and refunds, and the virtual numbers you rent, so your account history works correctly.",
    ],
  },
  {
    title: "How We Use Your Information",
    body: [
      "Your information is used only to operate your account: processing wallet funding through Flutterwave, delivering the SMS codes you purchase, providing support when you contact us, and keeping your transaction records accurate.",
      "All transactions are encrypted and processed securely through Flutterwave, a licensed payment processor. Your card details are handled entirely by Flutterwave and never reach our servers.",
    ],
  },
  {
    title: "What We Never Do",
    body: [
      "Your personal data (email, password) is stored securely and never shared with third parties. We do not sell your data, and we do not use it for advertising.",
      "Virtual numbers are temporary — they protect your real phone number from spam and unwanted tracking. We don't store the content of SMS messages longer than needed to deliver them to you.",
    ],
  },
  {
    title: "Security",
    body: [
      "Your account is protected by secure authentication and email verification. Wallet funds are tied to your account and cannot be accessed by anyone else. All traffic between your device and MONTEN SMS is encrypted.",
    ],
  },
  {
    title: "Your Choices and Data Removal",
    body: [
      "You can request deletion of your account and the personal data associated with it at any time. See our Delete Account page for the exact steps — our support team processes these requests directly.",
    ],
  },
];

export function PrivacyPolicyPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white">
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Logo size="md" />
          <button onClick={() => navigate("/")} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-royal-600 text-white text-sm font-semibold hover:bg-royal-700 transition-colors">
            Back to Home <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-royal-50 text-royal-700 text-xs font-medium mb-4">
          <Lock className="w-3.5 h-3.5" /> Privacy Policy
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-navy-900 tracking-tight mb-3">Privacy Policy</h1>
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
            <h2 className="text-lg font-bold text-navy-900 mb-2 flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-royal-600" /> Contact Us</h2>
            <p className="text-sm text-slate-600 leading-relaxed mb-3">
              Questions about this policy or how your data is handled? Reach our support team on Telegram at{" "}
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
          <button onClick={() => navigate("/")} className="text-slate-500 hover:text-navy-900 font-medium inline-flex items-center gap-1">
            Back to Home <ArrowRight className="w-3.5 h-3.5" />
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
