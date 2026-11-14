import { useNavigate, Link } from "react-router-dom";
import {
  Shield, Zap, Globe, Smartphone, ArrowRight, Check, Send, Megaphone, Music, LogIn,
  Lock, Clock, TrendingUp,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Logo } from "../components/ui";

export function LandingPage() {
  const navigate = useNavigate();
  const { session } = useAuth();

  const features = [
    { icon: <Globe className="w-6 h-6" />, title: "190+ Countries", description: "Access temporary phone numbers from over 190 countries worldwide." },
    { icon: <Zap className="w-6 h-6" />, title: "Instant Delivery", description: "Receive OTP codes in seconds. No waiting, no delays." },
    { icon: <Shield className="w-6 h-6" />, title: "Secure & Private", description: "Your transactions are encrypted and your data stays private." },
    { icon: <Smartphone className="w-6 h-6" />, title: "700+ Services", description: "WhatsApp, Telegram, Gmail, TikTok, Instagram and hundreds more." },
    { icon: <Clock className="w-6 h-6" />, title: "24/7 Support", description: "Our support team is available around the clock on Telegram." },
    { icon: <TrendingUp className="w-6 h-6" />, title: "Best Prices", description: "Competitive pricing with instant wallet funding via Flutterwave." },
  ];

  const steps = [
    { num: "1", title: "Create an account", description: "Sign up with your email and verify with a 6-digit OTP code." },
    { num: "2", title: "Fund your wallet", description: "Add funds instantly using card, bank transfer, or USSD via Flutterwave." },
    { num: "3", title: "Buy a number", description: "Choose a country, search for your service, and pick an offer." },
    { num: "4", title: "Receive your OTP", description: "Your SMS code arrives automatically. Copy and use it anywhere." },
  ];

  const socialLinks = [
    { icon: <Megaphone className="w-5 h-5" />, label: "WhatsApp", href: "https://whatsapp.com/channel/0029VbC5FycGehEPOnXIme2f" },
    { icon: <Send className="w-5 h-5" />, label: "Telegram", href: "https://t.me/montensms" },
    { icon: <Music className="w-5 h-5" />, label: "TikTok", href: "https://tiktok.com/@montensms" },
  ];

  return (
    <div className="min-h-screen bg-white">
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-1">
          <div className="[&>div>span]:text-lg sm:[&>div>span]:text-2xl">
            <Logo size="md" />
          </div>
          <div className="flex items-center gap-1.5 sm:gap-3">
            {session ? (
              <button onClick={() => navigate("/dashboard")} className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg bg-royal-600 text-white text-xs sm:text-sm font-semibold hover:bg-royal-700 transition-colors">
                Dashboard <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <>
                <button onClick={() => navigate("/login")} aria-label="Sign in" className="inline-flex items-center justify-center text-sm font-semibold text-navy-900 hover:text-royal-600 transition-colors px-2 sm:px-3 py-2">
                  <LogIn className="w-4 h-4 sm:hidden" />
                  <span className="hidden sm:inline">Sign in</span>
                </button>
                <button onClick={() => navigate("/register")} className="inline-flex items-center gap-1 px-3 sm:px-4 py-2 rounded-lg bg-royal-600 text-white text-xs sm:text-sm font-semibold hover:bg-royal-700 transition-colors">
                  Get Started <ArrowRight className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </nav>

      <section className="relative overflow-hidden bg-gradient-to-br from-navy-900 via-navy-800 to-royal-800">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-96 h-96 bg-royal-500/20 rounded-full blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-royal-600/10 rounded-full blur-3xl" />
        </div>
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 text-royal-200 text-xs font-medium mb-6">
            <Lock className="w-3.5 h-3.5" /> Secure OTP Verification Platform
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white tracking-tight leading-tight mb-6">
            Receive OTP Codes from<br /><span className="text-royal-400">Any Service, Anywhere</span>
          </h1>
          <p className="text-lg text-slate-300 max-w-2xl mx-auto mb-8 leading-relaxed">
            Buy temporary phone numbers from 190+ countries and receive SMS verification codes instantly. WhatsApp, Telegram, Gmail, TikTok and 700+ more services.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button onClick={() => navigate("/register")} className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-royal-600 text-white font-semibold hover:bg-royal-700 transition-all hover:scale-105 shadow-lg">
              Start Verifying <ArrowRight className="w-5 h-5" />
            </button>
            <button onClick={() => navigate("/login")} className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white/10 text-white font-semibold hover:bg-white/20 transition-all border border-white/20">
              Sign In
            </button>
          </div>
          <p className="mt-3 text-xs text-royal-200">Create your account to start receiving OTP codes instantly</p>
          <div className="mt-12 flex items-center justify-center gap-6 text-slate-400 text-sm flex-wrap">
            <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-success-400" /> No hidden fees</span>
            <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-success-400" /> Instant delivery</span>
            <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-success-400" /> 24/7 support</span>
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-navy-900 mb-3">Why MONTEN SMS?</h2>
            <p className="text-slate-500 max-w-xl mx-auto">Everything you need for fast, reliable OTP verification</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f) => (
              <div key={f.title} className="p-6 rounded-2xl border border-slate-200 hover:border-royal-200 hover:shadow-lg transition-all bg-white">
                <div className="w-12 h-12 rounded-xl bg-royal-100 flex items-center justify-center text-royal-600 mb-4">{f.icon}</div>
                <h3 className="font-bold text-navy-900 mb-2">{f.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 bg-slate-50">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-navy-900 mb-3">How It Works</h2>
            <p className="text-slate-500">Get started in under 2 minutes</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {steps.map((s) => (
              <div key={s.num} className="text-center">
                <div className="w-12 h-12 rounded-full bg-royal-600 text-white text-xl font-bold flex items-center justify-center mx-auto mb-4">{s.num}</div>
                <h3 className="font-bold text-navy-900 mb-2">{s.title}</h3>
                <p className="text-sm text-slate-500">{s.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="bg-gradient-to-br from-navy-900 to-royal-800 rounded-3xl p-10 sm:p-14">
            <h2 className="text-3xl font-bold text-white mb-4">Ready to get started?</h2>
            <p className="text-slate-300 mb-8 max-w-lg mx-auto">Join MONTEN SMS today and start receiving OTP codes from anywhere in the world.</p>
            <button onClick={() => navigate("/register")} className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl bg-white text-navy-900 font-bold hover:bg-slate-100 transition-all hover:scale-105 shadow-lg">
              Create Free Account <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </section>

      <footer className="bg-navy-900 text-slate-400 py-12 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
            <Logo size="md" />
            <div className="flex items-center gap-4">
              {socialLinks.map((link) => (
                <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-lg bg-navy-800 hover:bg-royal-600 flex items-center justify-center text-slate-300 hover:text-white transition-colors" aria-label={link.label}>
                  {link.icon}
                </a>
              ))}
            </div>
          </div>
          <div className="mt-8 pt-8 border-t border-navy-800 text-center text-sm">
            <p className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
              <Link to="/privacy" className="hover:text-slate-200 transition-colors">Privacy Policy</Link>
              <Link to="/delete-account" className="hover:text-slate-200 transition-colors">Delete Account</Link>
            </p>
            <p className="mt-2">&copy; 2025 MONTEN SMS. All rights reserved.</p>
            <p className="mt-2">Support: <a href="https://t.me/montensmssupport" target="_blank" rel="noopener noreferrer" className="text-royal-400 hover:text-royal-300">@montensmssupport</a></p>
          </div>
        </div>
      </footer>
    </div>
  );
}
