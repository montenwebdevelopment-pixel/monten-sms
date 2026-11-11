import { ArrowRight, UserMinus, Mail, Send, CircleAlert } from "lucide-react";
import { Logo } from "../components/ui";
import { useNavigate } from "react-router-dom";

const steps = [
  {
    num: "1",
    title: "Contact support",
    description: "Send a deletion request to our support team by email at support@montensms.com or on Telegram at @montensmssupport.",
  },
  {
    num: "2",
    title: "Include your details",
    description: "Use the email address registered to your MONTEN SMS account so we can verify that the request comes from you.",
  },
  {
    num: "3",
    title: "We confirm and delete",
    description: "Our team confirms your identity, then deletes your account and the personal data associated with it.",
  },
];

export function AccountDeletionPage() {
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
          <UserMinus className="w-3.5 h-3.5" /> Account Deletion
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-navy-900 tracking-tight mb-3">Delete Your Account</h1>
        <p className="text-sm text-slate-500 mb-10">
          You can request permanent deletion of your MONTEN SMS account and the personal data associated with it at any time. Deletion is handled by our support team.
        </p>

        <div className="grid sm:grid-cols-3 gap-4 mb-10">
          {steps.map((s) => (
            <div key={s.num} className="p-5 rounded-2xl border border-slate-200 bg-white">
              <div className="w-10 h-10 rounded-full bg-royal-600 text-white text-base font-bold flex items-center justify-center mb-3">{s.num}</div>
              <h2 className="font-bold text-navy-900 mb-1">{s.title}</h2>
              <p className="text-sm text-slate-500 leading-relaxed">{s.description}</p>
            </div>
          ))}
        </div>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-navy-900 mb-2">Request deletion now</h2>
          <p className="text-sm text-slate-600 leading-relaxed mb-4">
            Choose whichever channel is easiest for you. Include the words &ldquo;delete my account&rdquo; and the email address on the account:
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <a
              href="mailto:support@montensms.com?subject=Account%20Deletion%20Request&body=Please%20delete%20my%20MONTEN%20SMS%20account.%0A%0ARegistered%20email%3A%20"
              className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 hover:border-royal-300 hover:shadow-md transition-all"
            >
              <div className="w-10 h-10 rounded-lg bg-royal-100 flex items-center justify-center flex-shrink-0"><Mail className="w-5 h-5 text-royal-600" /></div>
              <div>
                <p className="text-sm font-bold text-navy-900">Email support</p>
                <p className="text-xs text-slate-500">support@montensms.com</p>
              </div>
            </a>
            <a
              href="https://t.me/montensmssupport"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 hover:border-royal-300 hover:shadow-md transition-all"
            >
              <div className="w-10 h-10 rounded-lg bg-royal-100 flex items-center justify-center flex-shrink-0"><Send className="w-5 h-5 text-royal-600" /></div>
              <div>
                <p className="text-sm font-bold text-navy-900">Telegram support</p>
                <p className="text-xs text-slate-500">@montensmssupport</p>
              </div>
            </a>
          </div>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-navy-900 mb-2">What gets deleted</h2>
          <ul className="text-sm text-slate-600 leading-relaxed space-y-1.5 list-disc pl-5">
            <li>Your profile: name, username, email address and account settings.</li>
            <li>Your wallet balance access — wallet funds are tied to your account and cannot be accessed by anyone else, so spend or request a resolution of any remaining balance before deleting.</li>
            <li>Your purchase and notification history as shown in your dashboard.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-navy-900 mb-2">What we may retain</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            We may keep minimal financial records (such as payment references) for as long as required by law. These records are not used to contact you and are never shared with third parties. We don't store the content of SMS messages longer than needed to deliver them to you.
          </p>
        </section>

        <section className="bg-warning-50 border border-warning-200 rounded-2xl p-5">
          <h2 className="text-base font-bold text-navy-900 mb-2 flex items-center gap-2"><CircleAlert className="w-5 h-5 text-warning-600" /> Before you delete</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Deletion is permanent and cannot be undone. If you change your mind after requesting deletion, contact support quickly — once removal is complete, the account cannot be restored. If you only want a break, you can simply stop using the account; it stays safe and untouched.
          </p>
        </section>

        <div className="mt-10 pt-6 border-t border-slate-100 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <a href="/privacy" className="text-royal-600 hover:text-royal-700 font-medium">Privacy Policy</a>
          <a href="/delete-account" className="text-royal-600 hover:text-royal-700 font-medium">Delete Account</a>
          <button onClick={() => navigate("/")} className="text-slate-500 hover:text-navy-900 font-medium inline-flex items-center gap-1">
            Back to Home <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <footer className="bg-navy-900 text-slate-400 py-8 px-4 sm:px-6 text-center text-sm">
        <p>&copy; 2025 MONTEN SMS. All rights reserved.</p>
      </footer>
    </div>
  );
}
