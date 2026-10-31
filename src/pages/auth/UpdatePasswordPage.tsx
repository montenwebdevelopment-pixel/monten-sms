import { useEffect, useRef, useState } from "react";
import { Lock, ArrowRight, CircleAlert as AlertCircle, CircleCheck as CheckCircle, Eye, EyeOff } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { Button, Input, Logo, Spinner } from "../../components/ui";

export function UpdatePasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [linkState, setLinkState] = useState<"checking" | "ready" | "invalid">("checking");
  const linkChecked = useRef(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (linkChecked.current) return;
    linkChecked.current = true;
    const tokenHash = searchParams.get("token_hash");
    (async () => {
      if (tokenHash && searchParams.get("type") === "recovery") {
        const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
        setLinkState(!error && data.session ? "ready" : "invalid");
        if (!error) navigate("/update-password", { replace: true });
        return;
      }
      const { data } = await supabase.auth.getSession();
      setLinkState(data.session ? "ready" : "invalid");
    })();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) { setError("Passwords do not match"); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      await supabase.auth.signOut();
      setSuccess(true);
      setTimeout(() => navigate("/login", { replace: true }), 2000);
    } catch (err: any) {
      const msg = (err?.message || "").toLowerCase();
      if (msg.includes("different from the old")) {
        setError("Your new password must be different from your current one.");
      } else if (msg.includes("password") && (msg.includes("weak") || msg.includes("leaked") || msg.includes("common") || msg.includes("breach"))) {
        setError("That password is too common or has been found in a data breach. Please choose a different one.");
      } else if (msg.includes("session") || msg.includes("token") || msg.includes("expired")) {
        setError("Your reset link has expired. Please request a new one.");
      } else if (err?.message) {
        setError(err.message);
      } else {
        setError("We couldn't update your password. Please request a new reset link and try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  if (linkState === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-navy-900 via-navy-800 to-royal-800 px-4">
        <Spinner className="w-8 h-8 text-white" />
      </div>
    );
  }

  if (linkState === "invalid") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-navy-900 via-navy-800 to-royal-800 px-4 py-8">
        <div className="bg-white rounded-2xl card-shadow-lg p-8 max-w-md w-full text-center animate-slide-up">
          <div className="flex justify-center mb-6"><Logo size="lg" /></div>
          <div className="w-16 h-16 rounded-full bg-error-100 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-error-600" />
          </div>
          <h2 className="text-xl font-bold text-navy-900 mb-2">Reset link expired</h2>
          <p className="text-sm text-slate-500 mb-6">This password reset link is invalid or has already been used. Please request a new one.</p>
          <Button onClick={() => navigate("/forgot-password")} className="w-full">Request a new link</Button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-navy-900 via-navy-800 to-royal-800 px-4 py-8">
        <div className="bg-white rounded-2xl card-shadow-lg p-8 max-w-md w-full text-center animate-slide-up">
          <div className="flex justify-center mb-6"><Logo size="lg" /></div>
          <div className="w-16 h-16 rounded-full bg-success-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-success-600" />
          </div>
          <h2 className="text-xl font-bold text-navy-900 mb-2">Password Updated</h2>
          <p className="text-sm text-slate-500">Your password has been changed. Redirecting to login...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-navy-900 via-navy-800 to-royal-800 px-4 py-8">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-royal-500/20 rounded-full blur-3xl" />
      </div>
      <div className="relative w-full max-w-md">
        <div className="flex justify-center mb-8"><Logo size="lg" /></div>
        <div className="bg-white rounded-2xl card-shadow-lg p-8 animate-slide-up">
          <h1 className="text-2xl font-bold text-navy-900 mb-1">Set a new password</h1>
          <p className="text-sm text-slate-500 mb-6">Enter your new password below</p>
          {error && (
            <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-error-50 border border-error-200 text-error-700 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /><span>{error}</span>
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Input label="New Password" type={showPassword ? "text" : "password"} value={password} onChange={setPassword} placeholder="At least 6 characters" icon={<Lock className="w-4 h-4" />} required />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="mt-1 text-xs text-royal-600 hover:text-royal-700 font-medium">
                {showPassword ? <EyeOff className="w-3 h-3 inline" /> : <Eye className="w-3 h-3 inline" />} {showPassword ? "Hide" : "Show"} password
              </button>
            </div>
            <Input label="Confirm Password" type={showPassword ? "text" : "password"} value={confirmPassword} onChange={setConfirmPassword} placeholder="Re-enter password" icon={<Lock className="w-4 h-4" />} required />
            <Button type="submit" className="w-full" loading={loading} disabled={loading}>
              {loading ? "Updating..." : "Update Password"}{!loading && <ArrowRight className="w-4 h-4" />}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
