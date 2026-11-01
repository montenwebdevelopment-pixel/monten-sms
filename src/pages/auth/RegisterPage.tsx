import { useState } from "react";
import { Mail, Lock, User, AtSign, Eye, EyeOff, ArrowRight, CircleAlert as AlertCircle, Check, Bell } from "lucide-react";
import { supabase, callEmailFunction } from "../../lib/supabase";
import { Button, Input, Logo } from "../../components/ui";
import { requestPushPermission } from "../../lib/native";

export function RegisterPage({ onNavigate, setOtpEmail }: { onNavigate: (page: string) => void; setOtpEmail: (email: string) => void }) {
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState("");
  const [showNotificationPrompt, setShowNotificationPrompt] = useState(false);
  const [verificationRoute, setVerificationRoute] = useState("verify-otp");

  const passwordTooShort = password.length > 0 && password.length < 6;

  const checkUsername = async (val: string) => {
    setUsername(val);
    if (val.length < 3) { setUsernameAvailable(null); return; }
    const { data } = await supabase.from("profiles").select("username").eq("username", val).maybeSingle();
    setUsernameAvailable(!data);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setUnverifiedEmail("");
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (password !== confirmPassword) { setError("Passwords do not match"); return; }
    if (usernameAvailable === false) { setError("Username is already taken"); return; }

    setLoading(true);
    const normalizedEmail = email.trim().toLowerCase();
    const result = await callEmailFunction({ action: "register", fullName, username, email: normalizedEmail, password });
    setLoading(false);

    if (result.ok) {
      setOtpEmail(normalizedEmail);
      setVerificationRoute("verify-otp");
      setShowNotificationPrompt(true);
      return;
    }
    if (result.code === "send_failed") {
      setOtpEmail(normalizedEmail);
      setVerificationRoute("verify-otp?sendFailed=1");
      setShowNotificationPrompt(true);
      return;
    }
    if (result.code === "unverified") setUnverifiedEmail(normalizedEmail);
    if (result.code === "username_taken") setUsernameAvailable(false);
    setError(result.error);
  };

  const finishRegistration = async (allowNotifications: boolean) => {
    setShowNotificationPrompt(false);
    if (allowNotifications) await requestPushPermission();
    onNavigate(verificationRoute);
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
          <h1 className="text-2xl font-bold text-navy-900 mb-1">Create account</h1>
          <p className="text-sm text-slate-500 mb-6">Join MONTEN SMS and start verifying OTPs</p>
          {error && (
            <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-error-50 border border-error-200 text-error-700 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <span>{error}</span>
                {unverifiedEmail && (
                  <button
                    type="button"
                    onClick={() => { setOtpEmail(unverifiedEmail); onNavigate("verify-otp?resend=1"); }}
                    className="mt-1 block font-semibold text-royal-600 hover:text-royal-700"
                  >
                    Send me a new code
                  </button>
                )}
              </div>
            </div>
          )}
          <form onSubmit={handleRegister} className="space-y-4">
            <Input label="Full Name" value={fullName} onChange={setFullName} placeholder="John Doe" icon={<User className="w-4 h-4" />} required />
            <div>
              <Input label="Username" value={username} onChange={checkUsername} placeholder="johndoe" icon={<AtSign className="w-4 h-4" />} required />
              {usernameAvailable === true && <p className="mt-1 text-xs text-success-600 flex items-center gap-1"><Check className="w-3 h-3" /> Username available</p>}
              {usernameAvailable === false && <p className="mt-1 text-xs text-error-500">Username is taken</p>}
            </div>
            <Input label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com" icon={<Mail className="w-4 h-4" />} required />
            <div>
              <Input label="Password" type={showPassword ? "text" : "password"} value={password} onChange={setPassword} placeholder="At least 6 characters" icon={<Lock className="w-4 h-4" />} required />
              {passwordTooShort && <p className="mt-1 text-xs text-error-500">Password must be at least 6 characters.</p>}
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="mt-1 text-xs text-royal-600 hover:text-royal-700 font-medium">
                {showPassword ? <EyeOff className="w-3 h-3 inline" /> : <Eye className="w-3 h-3 inline" />} {showPassword ? "Hide" : "Show"} password
              </button>
            </div>
            <Input label="Confirm Password" type={showPassword ? "text" : "password"} value={confirmPassword} onChange={setConfirmPassword} placeholder="Re-enter password" icon={<Lock className="w-4 h-4" />} required />
            <Button type="submit" className="w-full" loading={loading} disabled={loading}>
              {loading ? "Creating account..." : "Create Account"}{!loading && <ArrowRight className="w-4 h-4" />}
            </Button>
          </form>
          <div className="mt-6 text-center text-sm text-slate-600">
            Already have an account? <button onClick={() => onNavigate("login")} className="text-royal-600 hover:text-royal-700 font-semibold">Sign in</button>
          </div>
        </div>
      </div>
      {showNotificationPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/60 p-4" role="dialog" aria-modal="true" aria-labelledby="notification-prompt-title">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-royal-100 text-royal-600">
              <Bell className="h-6 w-6" />
            </div>
            <h2 id="notification-prompt-title" className="text-lg font-bold text-navy-900">Get your verification codes</h2>
            <p className="mt-2 text-sm text-slate-500">Allow notifications to know when an SMS code arrives for your number.</p>
            <div className="mt-5 flex justify-center gap-3">
              <Button variant="outline" onClick={() => void finishRegistration(false)}>Deny</Button>
              <Button onClick={() => void finishRegistration(true)}>Allow</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
