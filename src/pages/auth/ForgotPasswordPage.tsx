import { useState } from "react";
import { Mail, ArrowRight, CircleAlert as AlertCircle, ArrowLeft, CircleCheck as CheckCircle } from "lucide-react";
import { callEmailFunction } from "../../lib/supabase";
import { Button, Input, Logo } from "../../components/ui";

export function ForgotPasswordPage({ onNavigate }: { onNavigate: (page: string) => void }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const result = await callEmailFunction({ action: "reset", email: email.trim().toLowerCase() });
    setLoading(false);
    if (result.ok) {
      setSent(true);
      return;
    }
    setError(result.error);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-navy-900 via-navy-800 to-royal-800 px-4 py-8">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-royal-500/20 rounded-full blur-3xl" />
      </div>
      <div className="relative w-full max-w-md">
        <div className="flex justify-center mb-8"><Logo size="lg" /></div>
        <div className="bg-white rounded-2xl card-shadow-lg p-8 animate-slide-up">
          {sent ? (
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-success-100 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-7 h-7 text-success-600" />
              </div>
              <h1 className="text-2xl font-bold text-navy-900 mb-2">Check your email</h1>
              <p className="text-sm text-slate-500 mb-6">If an account exists for <span className="font-semibold text-navy-900">{email}</span>, we've sent a password reset link from support@montensms.com. Check your inbox and spam folder.</p>
              <Button onClick={() => onNavigate("login")} className="w-full">Back to Login</Button>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-navy-900 mb-1">Forgot password?</h1>
              <p className="text-sm text-slate-500 mb-6">Enter your email and we'll send you a reset link</p>
              {error && (
                <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-error-50 border border-error-200 text-error-700 text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /><span>{error}</span>
                </div>
              )}
              <form onSubmit={handleSubmit} className="space-y-4">
                <Input label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com" icon={<Mail className="w-4 h-4" />} required />
                <Button type="submit" className="w-full" loading={loading} disabled={loading}>
                  {loading ? "Sending..." : "Send Reset Link"}{!loading && <ArrowRight className="w-4 h-4" />}
                </Button>
              </form>
              <div className="mt-6 text-center">
                <button onClick={() => onNavigate("login")} className="text-sm text-slate-600 hover:text-navy-900 font-medium inline-flex items-center gap-1">
                  <ArrowLeft className="w-3 h-3" /> Back to login
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
