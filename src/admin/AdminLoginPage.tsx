import { useState } from "react";
import { useAdminAuth } from "./AdminAuth";
import { ShieldCheck, Lock, Mail, Eye, EyeOff } from "lucide-react";

export function AdminLoginPage() {
  const { signIn } = useAdminAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await signIn(email, password);
      if (res.error) setError(res.error);
    } catch (error) {
      console.error("[admin-auth] Sign-in failed.", error);
      setError("Unable to verify your sign-in. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-xl font-bold text-white">Super Admin Portal</h1>
          <p className="text-sm text-slate-500 mt-1">Restricted area. Authorized personnel only.</p>
        </div>
        <form onSubmit={submit} className="bg-slate-900 rounded-2xl border border-slate-800 p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Email</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                placeholder="admin email"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-10 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                placeholder="••••••••"
              />
              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          {error && <p className="text-sm text-red-400 bg-red-950/40 border border-red-900 rounded-lg px-3 py-2">{error}</p>}
          <button
            type="submit" disabled={busy}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors"
          >
            {busy ? "Verifying..." : "Sign in to Admin Portal"}
          </button>
        </form>
        <p className="text-center text-xs text-slate-600 mt-6">Access is verified server-side and all activity is logged.</p>
      </div>
    </div>
  );
}
