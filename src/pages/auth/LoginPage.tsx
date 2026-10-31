import { useState } from "react";
import { Mail, Lock, ArrowRight, CircleAlert as AlertCircle, AtSign } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Button, Input, Logo } from "../../components/ui";

export function LoginPage({ onNavigate }: { onNavigate: (page: string) => void }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      // If the user typed a username (not an email), resolve it to the email
      // via the RPC so we can call signInWithPassword (which needs an email).
      let loginEmail = identifier.trim();
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail);
      if (!isEmail) {
        const { data, error: rpcError } = await supabase.rpc("get_email_by_username", { p_username: loginEmail });
        if (rpcError || !data) {
          setError("Incorrect username or password. Please try again.");
          return;
        }
        loginEmail = data as string;
      }

      const { data, error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
      if (error) throw error;
      if (data.user) {
        onNavigate("dashboard/dashboard");
      }
    } catch (err: any) {
      const msg = (err?.message || "").toLowerCase();
      if (msg.includes("email not confirmed") || msg.includes("not verified")) {
        setError("Your email hasn't been verified yet. Please check your inbox for the 6-digit code, or go to the verify page to resend it.");
      } else {
        setError("Incorrect email/username or password. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-navy-900 via-navy-800 to-royal-800 px-4 py-8">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-royal-500/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-royal-600/10 rounded-full blur-3xl" />
      </div>
      <div className="relative w-full max-w-md">
        <div className="flex justify-center mb-8"><Logo size="lg" /></div>
        <div className="bg-white rounded-2xl card-shadow-lg p-8 animate-slide-up">
          <h1 className="text-2xl font-bold text-navy-900 mb-1">Welcome back</h1>
          <p className="text-sm text-slate-500 mb-6">Sign in to your MONTEN SMS account</p>
          {error && (
            <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-error-50 border border-error-200 text-error-700 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /><span>{error}</span>
            </div>
          )}
          <form onSubmit={handleLogin} className="space-y-4">
            <Input label="Email or Username" value={identifier} onChange={setIdentifier} placeholder="you@example.com or johndoe" icon={<AtSign className="w-4 h-4" />} required />
            <div>
              <Input label="Password" type={showPassword ? "text" : "password"} value={password} onChange={setPassword} placeholder="Enter your password" icon={<Lock className="w-4 h-4" />} required />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="mt-1 text-xs text-royal-600 hover:text-royal-700 font-medium">
                {showPassword ? "Hide password" : "Show password"}
              </button>
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={() => onNavigate("forgot-password")} className="text-sm text-royal-600 hover:text-royal-700 font-medium">Forgot password?</button>
            </div>
            <Button type="submit" className="w-full" loading={loading} disabled={loading}>
              {loading ? "Signing in..." : "Sign In"}{!loading && <ArrowRight className="w-4 h-4" />}
            </Button>
            <div className="text-center">
              <button type="button" onClick={() => onNavigate("verify-otp")} className="text-sm text-slate-500 hover:text-navy-900 font-medium">Verify your email</button>
            </div>
          </form>
          <div className="mt-6 text-center text-sm text-slate-600">
            Don't have an account? <button onClick={() => onNavigate("register")} className="text-royal-600 hover:text-royal-700 font-semibold">Create account</button>
          </div>
        </div>
      </div>
    </div>
  );
}
