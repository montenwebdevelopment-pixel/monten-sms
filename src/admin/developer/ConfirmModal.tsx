import type { ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  tone?: "default" | "danger";
  busy?: boolean;
  error?: string;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}

export function ConfirmModal({ open, title, description, confirmLabel, tone = "default", busy = false, error, confirmDisabled = false, onConfirm, onClose, children }: ConfirmModalProps) {
  if (!open) return null;
  const danger = tone === "danger";
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 sm:p-4" role="dialog" aria-modal="true" onClick={busy ? undefined : onClose}>
      <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-5 sm:p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            {danger && (
              <span className="mt-0.5 shrink-0 rounded-full bg-red-100 p-2 text-red-600">
                <AlertTriangle size={16} />
              </span>
            )}
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-slate-900">{title}</h3>
              <div className="text-sm text-slate-500 mt-1">{description}</div>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="text-slate-400 hover:text-slate-700 disabled:opacity-40">
            <X size={18} />
          </button>
        </div>
        {children && <div className="mt-4 space-y-3">{children}</div>}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
            className={`px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50 ${danger ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"}`}
          >
            {busy ? "Saving..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
