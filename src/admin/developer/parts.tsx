import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

export function Card({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{children}</div>;
}

export function Empty({ text }: { text: string }) {
  return <p className="text-sm text-slate-400 py-6 text-center">{text}</p>;
}

export function TableWrap({ children, minWidth = 720 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0 border-y sm:border border-slate-200 sm:rounded-lg">
      <table className="w-full text-sm" style={{ minWidth }}>{children}</table>
    </div>
  );
}

export function Th({ children }: { children: ReactNode }) {
  return <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400 py-2.5 px-3 whitespace-nowrap bg-slate-50">{children}</th>;
}

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`py-2.5 px-3 text-slate-700 align-top ${className}`}>{children}</td>;
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      setDone(false);
    }
  };
  return (
    <button type="button" onClick={copy} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900 transition-colors">
      {done ? <Check size={13} /> : <Copy size={13} />}
      {done ? "Copied" : label}
    </button>
  );
}

export function Pill({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "red" | "amber" | "blue" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    green: "bg-emerald-100 text-emerald-700",
    red: "bg-red-100 text-red-700",
    amber: "bg-amber-100 text-amber-700",
    blue: "bg-blue-100 text-blue-700",
  };
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

export const fmtCount = (n: number | null | undefined) => Number(n ?? 0).toLocaleString("en-NG");

export const fmtDay = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "Never";

export const fmtDayTime = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("en-NG", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Never";
