import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  User, Mail, AtSign, Save, CircleCheck as CheckCircle, CircleAlert as AlertCircle,
  Camera, Trash2, KeyRound, ShieldCheck, Copy, Check,
  Clock, BadgeCheck, Sun, Moon, Monitor, ArrowRight,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabase";
import { formatNaira, formatDate } from "../../lib/format";
import { Button, Card, Input, Spinner } from "../../components/ui";
import { PageHeader } from "../../components/DashboardLayout";
import { useTheme, type ThemeMode } from "../../lib/theme";

const AVATAR_EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const;

export function ProfilePage() {
  const { profile, session, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [username, setUsername] = useState(profile?.username ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const [avatarPath, setAvatarPath] = useState(profile?.avatar_url ?? "");
  const [avatarObjectUrl, setAvatarObjectUrl] = useState<string>("");
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarMessage, setAvatarMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMessage, setPwMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [copied, setCopied] = useState(false);
  const { mode: themeMode, setTheme } = useTheme();

  useEffect(() => {
    let objectUrl = "";
    let stale = false;
    (async () => {
      if (!avatarPath) { setAvatarObjectUrl(""); return; }
      const { data, error } = await supabase.storage.from("avatars").createSignedUrl(avatarPath, 3600);
      if (!stale) {
        if (!error && data) {
          objectUrl = data.signedUrl;
          setAvatarObjectUrl(data.signedUrl);
        }
      }
    })();
    return () => { stale = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [avatarPath]);

  const handleSave = async () => {
    setLoading(true); setError(""); setSuccess(false);
    try {
      const { error } = await supabase.from("profiles").update({ full_name: fullName, username }).eq("id", profile?.id);
      if (error) {
        // Never surface raw database errors to the user.
        setError(error.code === "23505"
          ? "That username is already taken. Please choose another."
          : "Failed to update profile. Please try again.");
        return;
      }
      await refreshProfile(); setSuccess(true); setTimeout(() => setSuccess(false), 3000);
    } catch { setError("Failed to update profile. Please try again."); }
    finally { setLoading(false); }
  };

  const onAvatarChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file || !profile) return;

    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    if (!(AVATAR_EXTENSIONS as readonly string[]).includes(ext)) {
      setAvatarMessage({ kind: "err", text: "Choose a JPG, PNG, or WEBP image." });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarMessage({ kind: "err", text: "Image must be smaller than 5 MB." });
      return;
    }

    setAvatarUploading(true);
    setAvatarMessage(null);
    try {
      const path = `${profile.id}/avatar.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { contentType: file.type, upsert: true });
      if (upErr) {
        setAvatarMessage({ kind: "err", text: "Upload failed. Please try a different image." });
        return;
      }
      if (avatarPath && avatarPath !== path) {
        await supabase.storage.from("avatars").remove([avatarPath]);
      }
      const { error: dbErr } = await supabase.from("profiles").update({ avatar_url: path }).eq("id", profile.id);
      if (dbErr) {
        setAvatarMessage({ kind: "err", text: "Could not save your photo. Please try again." });
        return;
      }
      setAvatarPath(path);
      await refreshProfile();
      setAvatarMessage({ kind: "ok", text: "Profile photo updated." });
    } finally {
      setAvatarUploading(false);
    }
  };

  const removeAvatar = async () => {
    if (!profile) return;
    setAvatarUploading(true);
    setAvatarMessage(null);
    try {
      if (avatarPath) await supabase.storage.from("avatars").remove([avatarPath]);
      await supabase.from("profiles").update({ avatar_url: null }).eq("id", profile.id);
      setAvatarPath("");
      setAvatarObjectUrl("");
      await refreshProfile();
      setAvatarMessage({ kind: "ok", text: "Profile photo removed." });
    } finally {
      setAvatarUploading(false);
    }
  };

  const changePassword = async () => {
    setPwMessage(null);
    if (newPassword.length < 8) {
      setPwMessage({ kind: "err", text: "New password must be at least 8 characters." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwMessage({ kind: "err", text: "New passwords do not match." });
      return;
    }
    if (!session?.user?.email) return;
    setPwLoading(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: session.user.email,
        password: currentPassword,
      });
      if (signInError) {
        setPwMessage({ kind: "err", text: "Your current password is incorrect." });
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        setPwMessage({ kind: "err", text: "Could not change your password. Please try again." });
        return;
      }
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setPwMessage({ kind: "ok", text: "Password changed successfully." });
    } finally {
      setPwLoading(false);
    }
  };

  const copyEmail = async () => {
    const email = session?.user?.email ?? "";
    if (!email) return;
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };

  const dirty = fullName !== (profile?.full_name ?? "") || username !== (profile?.username ?? "");

  const initials = (profile?.full_name ?? "U").trim().charAt(0).toUpperCase() || "U";

  return (
    <div className="animate-fade-in">
      <PageHeader title="Profile" subtitle="Manage your account information" />

      {/* Identity banner */}
      <Card className="mb-4 overflow-hidden">
        <div className="bg-gradient-to-r from-navy-900 to-royal-800 p-5 sm:p-6">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
            <div className="relative group flex-shrink-0">
              <div className="w-20 h-20 rounded-full bg-white/10 border-2 border-white/25 flex items-center justify-center text-white text-3xl font-bold overflow-hidden">
                {avatarObjectUrl
                  ? <img src={avatarObjectUrl} alt="Your profile photo" className="w-full h-full object-cover" />
                  : initials}
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={avatarUploading}
                aria-label="Change profile photo"
                className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-white text-navy-900 border border-slate-200 flex items-center justify-center shadow-sm hover:bg-slate-100 transition-base disabled:opacity-60"
              >
                {avatarUploading ? <Spinner className="w-3.5 h-3.5" /> : <Camera className="w-4 h-4" />}
              </button>
              {avatarObjectUrl && (
                <button
                  type="button"
                  onClick={removeAvatar}
                  disabled={avatarUploading}
                  aria-label="Remove profile photo"
                  className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-white text-error-600 border border-slate-200 flex items-center justify-center shadow-sm hover:bg-error-50 transition-base disabled:opacity-60"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="text-center sm:text-left">
              <h2 className="text-xl font-bold text-white flex items-center justify-center gap-2 sm:justify-start">
                {profile?.full_name || "Your Name"}
                {profile?.email_verified && (
                  <span title="Verified account" className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                    <BadgeCheck className="w-3.5 h-3.5" /> Verified
                  </span>
                )}
              </h2>
              <button
                type="button"
                onClick={copyEmail}
                className="mt-1 inline-flex items-center gap-1.5 text-sm text-white/75 hover:text-white transition-base"
                title="Copy email address"
              >
                {session?.user?.email}
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <p className="mt-1.5 text-xs text-white/50 flex items-center justify-center gap-1.5 sm:justify-start">
                <Clock className="w-3.5 h-3.5" /> Member since {profile?.created_at ? formatDate(profile.created_at) : "N/A"}
              </p>
            </div>
          </div>
        </div>
        {/* Quick stats strip */}
        <div className="grid grid-cols-2 divide-x divide-slate-100 border-t border-slate-100">
          <div className="p-4 text-center">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Balance</p>
            <p className="mt-1 text-sm sm:text-base font-bold text-navy-900">{formatNaira(profile?.wallet_balance ?? 0)}</p>
          </div>
          <div className="p-4 text-center">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Purchases</p>
            <p className="mt-1 text-sm sm:text-base font-bold text-navy-900">{profile?.email_verified ? "Active" : "Pending"}</p>
          </div>
        </div>
      </Card>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={onAvatarChosen}
        className="hidden"
      />

      {avatarMessage && (
        <div className={`mb-4 flex items-start gap-2 p-3 rounded-lg border text-sm ${
          avatarMessage.kind === "ok"
            ? "bg-success-50 border-success-200 text-success-700"
            : "bg-error-50 border-error-200 text-error-700"
        }`}>
          {avatarMessage.kind === "ok" ? <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
          <span>{avatarMessage.text}</span>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        {/* Personal information */}
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-1">
            <User className="w-5 h-5 text-royal-600" />
            <h3 className="font-bold text-navy-900">Personal Information</h3>
          </div>
          <p className="text-sm text-slate-500 mb-5">This is how your account appears in the app.</p>

          {error && <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-error-50 border border-error-200 text-error-700 text-sm"><AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /><span>{error}</span></div>}
          {success && <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-success-50 border border-success-200 text-success-700 text-sm"><CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /><span>Profile updated successfully</span></div>}

          <div className="space-y-4">
            <Input label="Full Name" value={fullName} onChange={setFullName} icon={<User className="w-4 h-4" />} placeholder="Your full name" />
            <Input label="Username" value={username} onChange={setUsername} icon={<AtSign className="w-4 h-4" />} placeholder="Your username" />
            <div>
              <label className="block text-sm font-medium text-navy-800 mb-1.5">Email</label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"><Mail className="w-4 h-4" /></div>
                <input
                  type="email"
                  value={session?.user?.email ?? ""}
                  readOnly
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-500 text-sm cursor-not-allowed"
                />
              </div>
              <p className="mt-1 text-xs text-slate-400">Email cannot be changed</p>
            </div>
            <Button onClick={handleSave} loading={loading} disabled={loading || !dirty}>
              <Save className="w-4 h-4" /> Save Changes
            </Button>
          </div>
        </Card>

        <div className="space-y-4">
          {/* Security */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-royal-600" />
                <h3 className="font-bold text-navy-900">Password &amp; Security</h3>
              </div>
              {profile?.email_verified && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-success-50 text-success-600">
                  <ShieldCheck className="w-3 h-3" /> Email verified
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500 mb-5">Use at least 8 characters. A mix of letters, numbers and symbols is strongest.</p>

            {pwMessage && (
              <div className={`mb-4 flex items-start gap-2 p-3 rounded-lg border text-sm ${
                pwMessage.kind === "ok"
                  ? "bg-success-50 border-success-200 text-success-700"
                  : "bg-error-50 border-error-200 text-error-700"
              }`}>
                {pwMessage.kind === "ok" ? <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
                <span>{pwMessage.text}</span>
              </div>
            )}

            <div className="space-y-4">
              <Input label="Current Password" type="password" value={currentPassword} onChange={setCurrentPassword} placeholder="Enter current password" />
              <Input label="New Password" type="password" value={newPassword} onChange={setNewPassword} placeholder="At least 8 characters" />
              <Input label="Confirm New Password" type="password" value={confirmPassword} onChange={setConfirmPassword} placeholder="Repeat new password" />
              <Button
                variant="outline"
                onClick={changePassword}
                loading={pwLoading}
                disabled={pwLoading || !currentPassword || !newPassword || !confirmPassword}
              >
                <KeyRound className="w-4 h-4" /> Change Password
              </Button>
            </div>
          </Card>

          {/* Appearance */}
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-1">
              {themeMode === "dark" ? <Moon className="w-5 h-5 text-royal-600" /> : <Sun className="w-5 h-5 text-royal-600" />}
              <h3 className="font-bold text-navy-900">Appearance</h3>
            </div>
            <p className="text-sm text-slate-500 mb-4">Choose how MONTEN SMS looks to you. System follows your device setting.</p>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Theme">
              {([
                { mode: "light" as ThemeMode, label: "Light", icon: <Sun className="w-4 h-4" /> },
                { mode: "dark" as ThemeMode, label: "Dark", icon: <Moon className="w-4 h-4" /> },
                { mode: "system" as ThemeMode, label: "System", icon: <Monitor className="w-4 h-4" /> },
              ]).map(({ mode, label, icon }) => (
                <button
                  key={mode}
                  onClick={() => setTheme(mode)}
                  aria-pressed={themeMode === mode}
                  className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border text-sm font-medium transition-base ${
                    themeMode === mode
                      ? "border-royal-600 bg-royal-600 text-white shadow-sm"
                      : "border-slate-200 text-slate-600 hover:border-royal-400 hover:text-navy-900"
                  }`}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          </Card>

        </div>

        <button
          onClick={() => navigate("/dashboard/profile")}
          className="mt-6 mx-auto flex items-center gap-1.5 text-sm text-slate-500 hover:text-navy-900 font-medium transition-base"
        >
          <ArrowRight className="w-3.5 h-3.5 rotate-180" /> Back to Profile
        </button>
      </div>
    </div>
  );
}
