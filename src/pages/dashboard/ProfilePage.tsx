import { useState } from "react";
import { User, Mail, AtSign, Wallet, Save, CircleCheck as CheckCircle, CircleAlert as AlertCircle } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabase";
import { formatNaira, formatDate } from "../../lib/format";
import { Button, Card, Input } from "../../components/ui";
import { PageHeader } from "../../components/DashboardLayout";

export function ProfilePage() {
  const { profile, session, refreshProfile } = useAuth();
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [username, setUsername] = useState(profile?.username ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

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
        </div>
      </div>
    </div>
  );
}
