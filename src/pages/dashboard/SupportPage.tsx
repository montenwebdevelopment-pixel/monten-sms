import { MessageCircle, Mail, Send, Megaphone, Music } from "lucide-react";
import { Card } from "../../components/ui";
import { PageHeader } from "../../components/DashboardLayout";

const SUPPORT_LINKS = {
  whatsapp: "https://whatsapp.com/channel/0029VbC5FycGehEPOnXIme2f",
  email: "mailto:support@montensms.com",
  telegram: "https://t.me/montensms",
  telegramSupport: "https://t.me/montensmssupport",
  tiktok: "https://tiktok.com/@montensms",
};

export function SupportPage() {
  const channels = [
    { icon: <Send className="w-6 h-6" />, title: "Telegram Support", description: "Chat with our support team directly on Telegram", action: "Chat on Telegram", handle: "@montensmssupport", href: SUPPORT_LINKS.telegramSupport, color: "bg-royal-100 text-royal-600" },
    { icon: <Mail className="w-6 h-6" />, title: "Email", description: "Send us an email and we'll respond within 24 hours", action: "Send Email", handle: "support@montensms.com", href: SUPPORT_LINKS.email, color: "bg-success-100 text-success-600" },
  ];
  const socialChannels = [
    { icon: <Megaphone className="w-5 h-5" />, title: "WhatsApp Channel", description: "Join our WhatsApp channel for updates", href: SUPPORT_LINKS.whatsapp, color: "bg-success-100 text-success-600" },
    { icon: <Send className="w-5 h-5" />, title: "Telegram Channel", description: "Follow us on Telegram for news and updates", href: SUPPORT_LINKS.telegram, color: "bg-royal-100 text-royal-600" },
    { icon: <Music className="w-5 h-5" />, title: "TikTok", description: "Follow us on TikTok @montensms", href: SUPPORT_LINKS.tiktok, color: "bg-navy-100 text-navy-700" },
  ];

  return (
    <div className="animate-fade-in">
      <PageHeader title="Customer Support" subtitle="We're here to help you 24/7" />
      <p className="text-sm text-slate-500 mb-3">Choose how you'd like to reach us — pick whichever is most convenient for you.</p>
      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        {channels.map(channel => (
          <Card key={channel.title} className="p-6 hover:card-shadow-lg transition-base">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${channel.color}`}>{channel.icon}</div>
            <h3 className="font-bold text-navy-900 mb-1">{channel.title}</h3>
            <p className="text-sm text-slate-500 mb-2">{channel.description}</p>
            {channel.handle && (
              <a href={channel.href} target="_blank" rel="noopener noreferrer" className="inline-block text-sm font-semibold text-navy-900 bg-slate-100 rounded-lg px-3 py-1.5 mb-4 hover:bg-slate-200 transition-base">{channel.handle}</a>
            )}
            <a href={channel.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-royal-600 hover:text-royal-700">{channel.action} <span aria-hidden>→</span></a>
          </Card>
        ))}
      </div>
      <h3 className="font-bold text-navy-900 mb-3">Our Channels</h3>
      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        {socialChannels.map(channel => (
          <Card key={channel.title} className="p-5 hover:card-shadow-lg transition-base">
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${channel.color}`}>{channel.icon}</div>
              <div><h4 className="font-semibold text-navy-900 text-sm">{channel.title}</h4></div>
            </div>
            <p className="text-xs text-slate-500 mb-3">{channel.description}</p>
            <a href={channel.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-royal-600 hover:text-royal-700">Open {channel.title}</a>
          </Card>
        ))}
      </div>
      <Card className="p-6">
        <h3 className="font-bold text-navy-900 mb-4">Frequently Asked Questions</h3>
        <div className="space-y-4">
          {[{q:"How do I buy a number?",a:"Navigate to Buy Numbers, select a country, search for your service, choose an offer, and click Buy. Your number will be displayed instantly."},
            {q:"How long does it take to receive an OTP?",a:"OTP delivery typically takes 30 seconds to 2 minutes. The page will automatically check for new SMS every 5 seconds."},
            {q:"What happens if I don't receive an OTP?",a:"If no SMS is received within the timeout period, the number will be marked as failed. You can cancel the number at any time while waiting."},
            {q:"How do I fund my wallet?",a:"Go to Fund Wallet, enter the amount, and pay via Flutterwave using card, bank transfer, or USSD. Your wallet is credited instantly."},
            {q:"Are my payments secure?",a:"Wallet payments are processed by Flutterwave, and MONTEN SMS verifies payment transactions before crediting your wallet. For information about data handled by payment providers, see our Privacy Policy."},
            {q:"How do I request a refund for unused wallet funds?",a:"Email support@montensms.com with your registered email address, username, and any additional details reasonably needed to verify the request. Once the required information is received and verified, refunds are to be processed within 2–3 working days. A pending refund does not prevent an account-deletion request."}].map(faq => (
            <div key={faq.q} className="border-b border-slate-100 pb-4 last:border-0 last:pb-0">
              <h4 className="font-semibold text-navy-900 text-sm mb-1">{faq.q}</h4>
              <p className="text-sm text-slate-500">{faq.a}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
