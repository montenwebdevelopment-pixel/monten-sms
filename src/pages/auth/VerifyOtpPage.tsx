import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { CircleAlert as AlertCircle, Mail, ArrowRight, RefreshCw } from "lucide-react";
import { supabase, callEmailFunction } from "../../lib/supabase";
import { Button, Logo } from "../../components/ui";

export function VerifyOtpPage({ email: emailProp, onNavigate }: { email: string; onNavigate: (page: string) => void }) {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState(emailProp || "");
  const [askForEmail] = useState(!emailProp);
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(
    searchParams.get("sendFailed") ? "Your account was created, but we couldn't send the code. Tap Resend code below." : ""
  );
  const [notice, setNotice] = useState("");
  const [success, setSuccess] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!email) {
      supabase.auth.getSession().then(({ data }) => {
        if (data.session?.user?.email) setEmail(data.session.user.email);
      });
    }
    if (!askForEmail) inputsRef.current[0]?.focus();
    if (searchParams.get("resend") && emailProp) handleResend();
  }, []);

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  const handleCodeChange = (index: number, value: string) => {
    if (!/^\d?$/.test(value)) return;
    const newCode = [...code];
    newCode[index] = value;
    setCode(newCode);
    if (value && index < 5) inputsRef.current[index + 1]?.focus();
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !code[index] && index > 0) inputsRef.current[index - 1]?.focus();
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const otp = code.join("");
    if (otp.length !== 6) { setError("Please enter the full 6-digit code"); return; }
    if (!email) { setError("Please enter your email address first."); return; }
    setLoading(true);
    const result = await callEmailFunction({ action: "verify", code: otp, email: email.trim().toLowerCase() });
    setLoading(false);
    if (result.ok) {
      setSuccess(true);
      setTimeout(() => onNavigate("login"), 2000);
      return;
    }
    setError(result.error);
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || !email) return;
    setError("");
    setNotice("");
    setResendCooldown(60);
    const result = await callEmailFunction({ action: "send", email: email.trim().toLowerCase() });
    if (result.ok) {
      setCode(["", "", "", "", "", ""]);
      setNotice("A new code is on its way. Check your inbox and spam folder.");
      return;
    }
    if (result.code === "already_verified") {
      setNotice("This email is already verified. You can sign in now.");
      return;
    }
    setError(result.error);
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-navy-900 via-navy-800 to-royal-800 px-4">
        <div className="bg-white rounded-2xl card-shadow-lg p-8 max-w-md w-full text-center animate-slide-up">
          <div className="w-16 h-16 rounded-full bg-success-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-success-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-navy-900 mb-2">Email Verified!</h2>
          <p className="text-sm text-slate-500">Redirecting you to sign in...</p>
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
          <div className="w-14 h-14 rounded-full bg-royal-100 flex items-center justify-center mx-auto mb-4">
            <Mail className="w-7 h-7 text-royal-600" />
          </div>
          <h1 className="text-2xl font-bold text-navy-900 mb-1 text-center">Verify your email</h1>
          <p className="text-sm text-slate-500 mb-6 text-center">
            Enter the 6-digit code sent to {email ? <span className="font-semibold text-navy-900">{email}</span> : "your email"}
          </p>
          {error && (
            <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-error-50 border border-error-200 text-error-700 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /><span>{error}</span>
            </div>
          )}
          {notice && !error && (
            <div className="mb-4 p-3 rounded-lg bg-success-50 border border-success-200 text-success-700 text-sm">{notice}</div>
          )}
          {askForEmail && (
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your email" className="w-full px-4 py-2.5 rounded-lg border border-slate-300 input-focus text-sm mb-4" />
          )}
          <form onSubmit={handleVerify} className="space-y-6">
            <div className="flex gap-2 justify-center">
              {code.map((digit, i) => (
                <input key={i} ref={(el) => { inputsRef.current[i] = el; }} type="text" inputMode="numeric" maxLength={1} value={digit} onChange={(e) => handleCodeChange(i, e.target.value)} onKeyDown={(e) => handleKeyDown(i, e)} className="w-12 h-14 text-center text-xl font-bold rounded-lg border border-slate-300 input-focus text-navy-900 bg-white" />
              ))}
            </div>
            <Button type="submit" className="w-full" loading={loading} disabled={loading}>
              {loading ? "Verifying..." : "Verify Email"}{!loading && <ArrowRight className="w-4 h-4" />}
            </Button>
          </form>
          <div className="mt-6 text-center">
            <button onClick={handleResend} disabled={resendCooldown > 0} className="text-sm text-royal-600 hover:text-royal-700 font-medium disabled:text-slate-400 disabled:cursor-not-allowed inline-flex items-center gap-1">
              <RefreshCw className="w-3 h-3" />{resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
            </button>
          </div>
          <div className="mt-4 text-center text-sm text-slate-600">
            <button onClick={() => onNavigate("login")} className="text-slate-500 hover:text-navy-900 font-medium">Back to login</button>
          </div>
        </div>
      </div>
    </div>
  );
}
