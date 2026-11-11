import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Capacitor } from "@capacitor/core";
import { User, Mail, AtSign, Wallet, Save, CircleCheck as CheckCircle, CircleAlert as AlertCircle, Smartphone, Bell, Camera, Trash2, ShieldCheck } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabase";
import { formatNaira, formatDate } from "../../lib/format";
import { Button, Card, Input } from "../../components/ui";
import { PageHeader } from "../../components/DashboardLayout";
import { DownloadAppButton } from "../../components/DownloadAppButton";
import { requestPushPermission } from "../../lib/native";
import { getProfileAvatarUrl, removeProfileAvatar, uploadProfileAvatar } from "../../lib/profileAvatar";

type PushPreferences = {
  wallet: boolean;
  sms: boolean;
  email_purchase: boolean;
  account_security: boolean;
  promotions: boolean;
  system_updates: boolean;
  low_balance_threshold: number;
};

const defaultPushPreferences: PushPreferences = {
  wallet: true,
  sms: true,
  email_purchase: true,
  account_security: true,
  promotions: false,
  system_updates: true,
  low_balance_threshold: 1000,
};

function PushNotificationSettings() {
  const { profile } = useAuth();
  const [preferences, setPreferences] = useState(defaultPushPreferences);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [permissionMessage, setPermissionMessage] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let active = true;
    if (!profile?.id) return;

    void supabase
      .from("notification_preferences")
      .select("wallet, sms, email_purchase, account_security, promotions, system_updates, low_balance_threshold")
      .eq("user_id", profile.id)
      .maybeSingle()
      .then(({ data, error: loadError }) => {
        if (!active) return;
        if (loadError) {
          setError("Could not load notification preferences.");
        } else if (data) {
          setPreferences({ ...defaultPushPreferences, ...data });
        }
        setLoading(false);
      });

    return () => { active = false; };
  }, [profile?.id]);

  const save = async (next: PushPreferences) => {
    if (!profile?.id) return;
    setSaving(true);
    setError("");
    setSuccess(false);
    const { error: saveError } = await supabase
      .from("notification_preferences")
      .upsert({ user_id: profile.id, ...next }, { onConflict: "user_id" });
    if (saveError) {
      setError("Could not save notification preferences. Please try again.");
    } else {
      setPreferences(next);
      setSuccess(true);
    }
    setSaving(false);
  };

  const categories: { key: keyof Omit<PushPreferences, "low_balance_threshold">; title: string; detail: string }[] = [
    { key: "wallet", title: "Wallet activity", detail: "Deposits, payments, refunds and low-balance alerts" },
    { key: "sms", title: "SMS purchases", detail: "Purchases, received codes, completed orders and cancellations" },
    { key: "email_purchase", title: "Email Purchase", detail: "Purchases, received codes, cancellations and refunds" },
    { key: "account_security", title: "Account security", detail: "Sign-ins and password changes" },
    { key: "promotions", title: "Promotions", detail: "Offers, discounts and announcements" },
    { key: "system_updates", title: "System updates", detail: "Maintenance, service interruptions and new features" },
  ];

  if (loading) return <Card className="p-6 mt-4"><p className="text-sm text-slate-500">Loading notification preferences...</p></Card>;

  return (
    <Card className="p-6 mt-4">
      <h3 className="font-bold text-navy-900 mb-1 flex items-center gap-2"><Bell className="w-5 h-5 text-royal-600" /> Push notifications</h3>
      <p className="text-sm text-slate-500 mb-4">Choose which alerts this Android device can receive. Verification codes are never included in lock-screen notifications.</p>
      {error && <div role="alert" className="mb-3 text-sm text-error-700">{error}</div>}
      {success && <div role="status" className="mb-3 text-sm text-success-700">Notification preferences saved.</div>}
      <div className="divide-y divide-slate-100">
        {categories.map(({ key, title, detail }) => (
          <label key={key} className="flex items-center justify-between gap-4 py-3 cursor-pointer">
            <span><span className="block text-sm font-semibold text-navy-900">{title}</span><span className="block text-xs text-slate-500 mt-0.5">{detail}</span></span>
            <input
              type="checkbox"
              className="h-5 w-5 shrink-0 accent-royal-600"
              checked={preferences[key]}
              disabled={saving}
              onChange={(event) => void save({ ...preferences, [key]: event.target.checked })}
            />
          </label>
        ))}
      </div>
      <div className="mt-4 max-w-xs">
        <Input
          label="Low balance alert threshold (₦)"
          type="number"
          value={String(preferences.low_balance_threshold)}
          onChange={(value) => {
            const threshold = Number(value);
            if (Number.isFinite(threshold) && threshold >= 0 && threshold <= 10000000) {
              setPreferences((current) => ({ ...current, low_balance_threshold: threshold }));
            }
          }}
        />
        <Button
          variant="outline"
          className="mt-2"
          disabled={saving}
          onClick={() => void save(preferences)}
        >
          <Save className="w-4 h-4" /> Save threshold
        </Button>
      </div>
      <Button
        variant="outline"
        className="mt-4"
        onClick={() => {
          setPermissionMessage("");
          void requestPushPermission().then((granted) => {
            setPermissionMessage(granted
              ? "Push notifications are enabled for this device."
              : "Notification permission was not granted. You can enable it in Android Settings.");
          });
        }}
      >
        <Bell className="w-4 h-4" /> Enable on this device
      </Button>
      {permissionMessage && <p role="status" className="mt-2 text-sm text-slate-500">{permissionMessage}</p>}
    </Card>
  );
}

export function ProfilePage() {
  const { profile, session, refreshProfile } = useAuth();
  const isAndroidNative = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [username, setUsername] = useState(profile?.username ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [avatarSuccess, setAvatarSuccess] = useState("");
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !profile?.id) return;

    setAvatarLoading(true);
    setAvatarError("");
    setAvatarSuccess("");
    let uploadedPath: string | null = null;
    try {
      uploadedPath = await uploadProfileAvatar(profile.id, file);
      const { error: saveError } = await supabase
        .from("profiles")
        .update({ avatar_url: uploadedPath })
        .eq("id", profile.id);
      if (saveError) {
        try {
          await removeProfileAvatar(profile.id, uploadedPath);
        } catch (cleanupError) {
          console.error("[profile] Could not clean up an unsaved avatar upload.", cleanupError);
        }
        throw saveError;
      }

      await refreshProfile();
      setAvatarSuccess("Profile photo updated.");
      if (profile.avatar_url) {
        try {
          await removeProfileAvatar(profile.id, profile.avatar_url);
        } catch (cleanupError) {
          console.error("[profile] New photo saved, but the previous avatar could not be removed.", cleanupError);
          setAvatarSuccess("");
          setAvatarError("Your new photo is saved, but the previous image could not be removed.");
        }
      }
    } catch (uploadError) {
      console.error("[profile] Avatar upload failed.", uploadError);
      if (!uploadedPath) {
        setAvatarError(uploadError instanceof Error && uploadError.message.startsWith("Choose ")
          ? uploadError.message
          : "Could not upload your profile photo. Please try again.");
      } else {
        setAvatarError("Could not save your profile photo. Please try again.");
      }
    } finally {
      setAvatarLoading(false);
    }
  };

  const handleAvatarRemove = async () => {
    if (!profile?.id || !profile.avatar_url) return;
    setAvatarLoading(true);
    setAvatarError("");
    setAvatarSuccess("");
    const previousAvatar = profile.avatar_url;
    try {
      const { error: saveError } = await supabase
        .from("profiles")
        .update({ avatar_url: null })
        .eq("id", profile.id);
      if (saveError) throw saveError;
      await refreshProfile();
      try {
        await removeProfileAvatar(profile.id, previousAvatar);
      } catch (cleanupError) {
        console.error("[profile] Avatar removed from profile, but its file could not be deleted.", cleanupError);
        setAvatarError("Your photo was removed from the profile, but its stored image could not be deleted.");
        return;
      }
      setAvatarSuccess("Profile photo removed.");
    } catch (removeError) {
      console.error("[profile] Avatar removal failed.", removeError);
      setAvatarError("Could not remove your profile photo. Please try again.");
    } finally {
      setAvatarLoading(false);
    }
  };

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

  if (isAndroidNative) {
    const avatarUrl = getProfileAvatarUrl(profile?.avatar_url);
    return (
      <div className="animate-fade-in space-y-5">
        <PageHeader title="Account Settings" subtitle="Your profile, account details and preferences" />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
          <Card className="overflow-hidden p-0 border-slate-200">
            <div className="h-28 bg-gradient-to-r from-navy-900 via-royal-800 to-royal-600" />
            <div className="px-5 pb-6 sm:px-7">
              <div className="-mt-12 flex flex-col items-center text-center">
                <div className="h-24 w-24 overflow-hidden rounded-full border-4 border-white bg-gradient-to-br from-navy-900 to-royal-600 text-3xl font-bold text-white shadow-lg flex items-center justify-center">
                  {avatarUrl
                    ? <img src={avatarUrl} alt={`${profile?.full_name ?? "Profile"} avatar`} className="h-full w-full object-cover" />
                    : profile?.full_name?.charAt(0).toUpperCase() ?? "U"}
                </div>
                <h2 className="mt-3 text-xl font-bold text-navy-900">{profile?.full_name || "Your profile"}</h2>
                <p className="mt-1 text-sm text-slate-500">{session?.user?.email}</p>
                <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-success-50 px-3 py-1 text-xs font-semibold text-success-700">
                  <ShieldCheck className="h-4 w-4" />
                  {profile?.email_verified ? "Verified account" : "Email verification required"}
                </span>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={(event) => void handleAvatarChange(event)}
                    aria-label="Choose a profile photo from your gallery"
                  />
                  <Button
                    variant="outline"
                    disabled={avatarLoading || !profile?.id}
                    onClick={() => avatarInputRef.current?.click()}
                  >
                    <Camera className="h-4 w-4" />
                    {avatarLoading ? "Saving photo..." : avatarUrl ? "Change photo" : "Add photo"}
                  </Button>
                  {avatarUrl && (
                    <Button variant="outline" disabled={avatarLoading} onClick={() => void handleAvatarRemove()}>
                      <Trash2 className="h-4 w-4" /> Remove
                    </Button>
                  )}
                </div>
                <p className="mt-2 text-xs text-slate-400">JPG, PNG or WebP · up to 5 MB</p>
                {avatarError && <p role="alert" className="mt-3 text-sm text-error-700">{avatarError}</p>}
                {avatarSuccess && <p role="status" className="mt-3 text-sm text-success-700">{avatarSuccess}</p>}
              </div>
            </div>
          </Card>

          <Card className="p-5 sm:p-6">
            <h3 className="mb-4 flex items-center gap-2 font-bold text-navy-900">
              <Wallet className="h-5 w-5 text-royal-600" /> Wallet balance
            </h3>
            <p className="text-3xl font-extrabold tracking-tight text-navy-900">{formatNaira(profile?.wallet_balance ?? 0)}</p>
            <p className="mt-2 text-sm text-slate-500">Available for SMS and Email Purchase orders.</p>
            <div className="mt-5 border-t border-slate-100 pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Member since</p>
              <p className="mt-1 text-sm font-semibold text-navy-900">{profile?.created_at ? formatDate(profile.created_at) : "—"}</p>
            </div>
          </Card>
        </div>

        <Card className="p-5 sm:p-6">
          <h3 className="mb-4 font-bold text-navy-900">Personal information</h3>
          {error && <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-error-200 bg-error-50 p-3 text-sm text-error-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
          {success && <div role="status" className="mb-4 flex items-start gap-2 rounded-lg border border-success-200 bg-success-50 p-3 text-sm text-success-700"><CheckCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>Profile updated successfully.</span></div>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Full name" value={fullName} onChange={setFullName} icon={<User className="h-4 w-4" />} />
            <Input label="Username" value={username} onChange={setUsername} icon={<AtSign className="h-4 w-4" />} />
            <div className="sm:col-span-2">
              <Input label="Email address" value={session?.user?.email ?? ""} onChange={() => {}} icon={<Mail className="h-4 w-4" />} />
              <p className="mt-1 text-xs text-slate-400">Your sign-in email cannot be changed here.</p>
            </div>
          </div>
          <Button className="mt-5" onClick={handleSave} loading={loading} disabled={loading}>
            <Save className="h-4 w-4" /> Save changes
          </Button>
        </Card>

        <PushNotificationSettings />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader title="Profile" subtitle="Manage your account information" />
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="p-6 text-center">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-navy-900 to-royal-600 flex items-center justify-center text-white text-3xl font-bold mx-auto mb-4 overflow-hidden">
            {profile?.avatar_url ? <img src={profile.avatar_url} alt={profile?.full_name ?? "Avatar"} className="w-full h-full object-cover" /> : profile?.full_name?.charAt(0).toUpperCase() ?? "U"}
          </div>
          <h2 className="text-lg font-bold text-navy-900">{profile?.full_name}</h2>
          <p className="text-sm text-slate-500">{session?.user?.email}</p>
          <div className="mt-3 inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-success-50 text-success-600"><CheckCircle className="w-3 h-3" /> Verified Account</div>
          <div className="mt-4 pt-4 border-t border-slate-100"><p className="text-xs text-slate-400">Member since</p><p className="text-sm font-medium text-navy-900">{profile?.created_at ? formatDate(profile.created_at) : "N/A"}</p></div>
        </Card>
        <div className="lg:col-span-2">
          <Card className="p-6">
            <h3 className="font-bold text-navy-900 mb-4">Edit Profile</h3>
            {error && <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-error-50 border border-error-200 text-error-700 text-sm"><AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /><span>{error}</span></div>}
            {success && <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-success-50 border border-success-200 text-success-700 text-sm"><CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /><span>Profile updated successfully</span></div>}
            <div className="space-y-4">
              <Input label="Full Name" value={fullName} onChange={setFullName} icon={<User className="w-4 h-4" />} />
              <Input label="Username" value={username} onChange={setUsername} icon={<AtSign className="w-4 h-4" />} />
              <Input label="Email" value={session?.user?.email ?? ""} onChange={() => {}} icon={<Mail className="w-4 h-4" />} />
              <p className="text-xs text-slate-400">Email cannot be changed</p>
              <div className="bg-slate-50 rounded-lg p-4">
                <div className="flex items-center gap-2 text-sm text-slate-500 mb-1"><Wallet className="w-4 h-4" /> Wallet Balance</div>
                <p className="text-2xl font-bold text-navy-900">{formatNaira(profile?.wallet_balance ?? 0)}</p>
              </div>
              <Button onClick={handleSave} loading={loading} disabled={loading}><Save className="w-4 h-4" /> Save Changes</Button>
            </div>
          </Card>
          <Card className="p-6 mt-4">
            <h3 className="font-bold text-navy-900 mb-2 flex items-center gap-2"><Smartphone className="w-5 h-5 text-royal-600" /> Mobile App</h3>
            <p className="text-sm text-slate-500 mb-4">Install MONTEN SMS as a real app on your phone. It runs on its own, outside the browser.</p>
            <DownloadAppButton />
          </Card>
          {Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android" && <PushNotificationSettings />}
        </div>
      </div>
    </div>
  );
}
