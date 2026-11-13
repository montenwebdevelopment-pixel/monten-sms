import { useState } from "react";
import { PageHeader } from "../adminApi";
import { ExternalLink, Globe, ShieldCheck, AlertTriangle } from "lucide-react";

export function AdminLiveWebsite() {
  const [status, setStatus] = useState<"unknown" | "ok" | "down">("unknown");

  const checkSite = async () => {
    setStatus("unknown");
    try {
      await fetch("https://montensms.com", { mode: "no-cors" });
      setStatus("ok");
    } catch {
      setStatus("down");
    }
  };

  return (
    <div>
      <PageHeader
        title="Live Website"
        subtitle="Preview of the public customer-facing website"
        actions={<a href="https://montensms.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-semibold bg-blue-600 text-white rounded-lg px-4 py-2 hover:bg-blue-700"><ExternalLink className="w-4 h-4" /> Open website</a>}
      />

      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 text-slate-400 mb-1"><Globe className="w-4 h-4" /><p className="text-xs font-medium">Website</p></div>
          <p className="text-sm font-bold text-slate-900">montensms.com</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 text-slate-400 mb-1"><ShieldCheck className="w-4 h-4" /><p className="text-xs font-medium">Status</p></div>
          <p className={`text-sm font-bold ${status === "ok" ? "text-emerald-600" : status === "down" ? "text-red-600" : "text-slate-500"}`}>
            {status === "unknown" ? "Not verified yet" : status === "ok" ? "Reachable" : "Unreachable"}
          </p>
          <button onClick={checkSite} className="text-xs text-blue-600 font-semibold hover:underline mt-1">Check now</button>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 text-slate-400 mb-1"><AlertTriangle className="w-4 h-4" /><p className="text-xs font-medium">Privacy note</p></div>
          <p className="text-xs text-slate-500">The preview below runs the public site in an isolated frame — your admin session is never shared with it.</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-100 border-b border-slate-200 px-4 py-2 flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
          <span className="ml-3 text-xs text-slate-500 bg-white rounded-md px-3 py-1 flex-1">https://montensms.com</span>
        </div>
        <iframe
          src="https://montensms.com"
          title="Monten SMS live preview"
          className="w-full h-[70vh] bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      </div>
      <p className="text-xs text-slate-400 mt-2">If the frame stays blank, montensms.com may send headers that block embedding. Use the "Open website" button in that case — some sites disallow being framed.</p>
    </div>
  );
}
