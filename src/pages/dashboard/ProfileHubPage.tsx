import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  User, ShieldCheck, FileText, LifeBuoy, MessageCircle, ChevronRight,
  KeyRound, Palette, Smartphone, ArrowRight, Code2,
} from "lucide-react";
import { Card } from "../../components/ui";
import { PageHeader } from "../../components/DashboardLayout";
import { useAuth } from "../../context/AuthContext";

interface HubItem {
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
  external?: boolean;
}

export function ProfileHubPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const initials = (profile?.full_name ?? "U").trim().charAt(0).toUpperCase() || "U";

  const [cameFromHub, setCameFromHub] = useState(false);
  useEffect(() => {
    try {
      setCameFromHub(sessionStorage.getItem("monten_nav_source") === "profile-hub");
    } catch { /* storage unavailable */ }
  }, []);

  const settings: HubItem[] = [
    {
      title: "Account Settings",
      description: "Name, username, profile photo, password & security",
      icon: <User className="w-5 h-5 text-royal-600" />,
      onClick: () => navigate("/dashboard/account-settings"),
    },
  ];

  const developer: HubItem[] = [
    {
      title: "Developer",
      description: "API keys, documentation, playground and webhooks",
      icon: <Code2 className="w-5 h-5 text-royal-600" />,
      onClick: () => navigate("/dashboard/developer"),
    },
  ];

  const privacy: HubItem[] = [
    {
      title: "Privacy Policy",
      description: "How your data is collected, used and protected",
      icon: <ShieldCheck className="w-5 h-5 text-royal-600" />,
      onClick: () => {
        try { sessionStorage.setItem("monten_nav_source", "profile-hub"); } catch { /* ignore */ }
        navigate("/privacy");
      },
      external: true,
    },
    {
      title: "Terms & Conditions",
      description: "The rules that govern your use of MONTEN SMS",
      icon: <FileText className="w-5 h-5 text-royal-600" />,
      onClick: () => {
        try { sessionStorage.setItem("monten_nav_source", "profile-hub"); } catch { /* ignore */ }
        navigate("/terms");
      },
      external: true,
    },
  ];

  const help: HubItem[] = [
    {
      title: "AI Support Assistant",
      description: "Instant answers about your account, deposits and orders",
      icon: <MessageCircle className="w-5 h-5 text-royal-600" />,
      onClick: () => navigate("/dashboard/support"),
    },
    {
      title: "Support Channels",
      description: "Reach our human team on Telegram, email and socials",
      icon: <LifeBuoy className="w-5 h-5 text-royal-600" />,
      onClick: () => navigate("/dashboard/support"),
    },
  ];

  const Row = ({ item }: { item: HubItem }) => (
    <button
      onClick={item.onClick}
      className="w-full flex items-center gap-3 p-3.5 rounded-xl hover:bg-slate-50 transition-base text-left group"
    >
      <span className="w-10 h-10 rounded-lg bg-royal-50 flex items-center justify-center flex-shrink-0">
        {item.icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-navy-900">{item.title}</span>
        <span className="block text-xs text-slate-500 truncate">{item.description}</span>
      </span>
      <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-royal-600 transition-base flex-shrink-0" />
    </button>
  );

  return (
    <div className="animate-fade-in">
      <PageHeader title="Profile" subtitle="Your account, privacy and help — all in one place" />

      {/* Identity banner */}
      <Card className="mb-5 overflow-hidden">
        <div className="bg-gradient-to-r from-navy-900 to-royal-800 p-5 sm:p-6 flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-white/10 border-2 border-white/25 flex items-center justify-center text-white text-xl font-bold overflow-hidden flex-shrink-0">
            {profile?.avatar_url ? <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" /> : initials}
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-white truncate">{profile?.full_name || "Your Name"}</h2>
            <p className="text-sm text-white/60 truncate">{profile?.username ? `@${profile.username}` : ""}</p>
          </div>
        </div>
      </Card>

      <div className="space-y-5">
        <Card className="p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-2 mb-1 flex items-center gap-1.5">
            <KeyRound className="w-3.5 h-3.5" /> Account Settings
          </h3>
          {settings.map((item) => <Row key={item.title} item={item} />)}
          {developer.map((item) => <Row key={item.title} item={item} />)}
        </Card>

        <Card className="p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-2 mb-1 flex items-center gap-1.5">
            <Palette className="w-3.5 h-3.5" /> Privacy
          </h3>
          {privacy.map((item) => <Row key={item.title} item={item} />)}
        </Card>
        <Card className="p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-2 mb-1 flex items-center gap-1.5">
            <Smartphone className="w-3.5 h-3.5" /> Help Center &amp; Support
          </h3>
          {help.map((item) => <Row key={item.title} item={item} />)}
        </Card>

        <button
          onClick={() => navigate("/dashboard/dashboard")}
          className="mx-auto flex items-center gap-1.5 text-sm text-slate-500 hover:text-navy-900 font-medium transition-base"
        >
          <ArrowRight className="w-3.5 h-3.5 rotate-180" /> Back to Dashboard
        </button>
      </div>
    </div>
  );
}
