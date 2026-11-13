import { useState } from "react";
import { ShieldAlert, ShieldCheck, Gauge, Coins } from "lucide-react";
import { adminFetch, fmtNaira } from "../adminApi";
import type { DeveloperDefaults, DeveloperProfileResponse } from "./types";
import { ConfirmModal } from "./ConfirmModal";
import { Card, fmtCount } from "./parts";

type Developer = DeveloperProfileResponse["developer"];
type ModalKind = "status" | "limit" | "pricing";

interface ProfileActionsProps {
  developer: Developer;
  defaults: DeveloperDefaults;
  onChanged: () => void;
}

const FN = "admin-developers";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500";

function parseOptionalNumber(raw: string): number | null {
  return raw.trim() === "" ? null : Number(raw);
}

export function ProfileActions({ developer, defaults, onChanged }: ProfileActionsProps) {
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [typedEmail, setTypedEmail] = useState("");
  const [limitInput, setLimitInput] = useState("");
  const [marginInput, setMarginInput] = useState("");
  const [emailPriceInput, setEmailPriceInput] = useState("");

  const isActive = developer.account_status === "active";
  const nextStatus = isActive ? "suspended" : "active";

  const open = (kind: ModalKind) => {
    setError("");
    setTypedEmail("");
    setReason("");
    setLimitInput(developer.rate_limit_per_min?.toString() ?? "");
    setMarginInput(developer.phone_margin_naira?.toString() ?? "");
    setEmailPriceInput(developer.email_price_naira?.toString() ?? "");
    setModal(kind);
  };

  const close = () => {
    if (!busy) setModal(null);
  };

  const run = async (path: string, body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      await adminFetch(path, { fn: FN, json: { ...body, user_id: developer.user_id, confirm: true } });
      setModal(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The change could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const submitStatus = () => {
    const reasonText = reason.trim() || undefined;
    return run("performance/status", { status: nextStatus, reason: reasonText });
  };

  const submitLimit = () => {
    const value = parseOptionalNumber(limitInput);
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > 1000)) {
      setError("Enter a whole number between 1 and 1000, or leave blank to use the default.");
      return;
    }
    return run("performance/limits", { rate_limit_per_min: value });
  };

  const submitPricing = () => {
    const margin = parseOptionalNumber(marginInput);
    const emailPrice = parseOptionalNumber(emailPriceInput);
    const invalid = (v: number | null) => v !== null && (!Number.isFinite(v) || v < 0 || v > 1000000);
    if (invalid(margin) || invalid(emailPrice)) {
      setError("Prices must be between 0 and 1,000,000 naira, or left blank to use the default.");
      return;
    }
    return run("performance/pricing", { phone_margin_naira: margin, email_price_naira: emailPrice });
  };

  const emailMatches = typedEmail.trim().toLowerCase() === developer.email.toLowerCase();

  return (
    <>
      <Card title="Admin actions" subtitle="Every change is confirmed and written to the audit log">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => open("status")}
            className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
              isActive ? "border-red-200 bg-red-50/40 hover:bg-red-50" : "border-emerald-200 bg-emerald-50/40 hover:bg-emerald-50"
            }`}
          >
            {isActive ? <ShieldAlert size={18} className="text-red-600 shrink-0" /> : <ShieldCheck size={18} className="text-emerald-600 shrink-0" />}
            <span>
              <span className="block text-sm font-semibold text-slate-900">{isActive ? "Suspend developer" : "Reactivate developer"}</span>
              <span className="block text-xs text-slate-500">{isActive ? "Blocks all API purchases" : "Restores API access"}</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => open("limit")}
            className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 text-left transition-colors hover:bg-slate-50"
          >
            <Gauge size={18} className="text-blue-600 shrink-0" />
            <span>
              <span className="block text-sm font-semibold text-slate-900">Set API rate limit</span>
              <span className="block text-xs text-slate-500">
                {developer.rate_limit_per_min ? `${developer.rate_limit_per_min} per minute` : `Default (${defaults.rate_limit_per_min} per minute)`}
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => open("pricing")}
            className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 text-left transition-colors hover:bg-slate-50"
          >
            <Coins size={18} className="text-blue-600 shrink-0" />
            <span>
              <span className="block text-sm font-semibold text-slate-900">Set pricing</span>
              <span className="block text-xs text-slate-500">
                Phone margin {fmtNaira(developer.phone_margin_naira ?? defaults.phone_margin_naira)} / Email {fmtNaira(developer.email_price_naira ?? defaults.email_price_naira)}
              </span>
            </span>
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          API keys can be revoked from the API performance section below.
        </p>
      </Card>

      <ConfirmModal
        open={modal === "status"}
        title={isActive ? "Suspend this developer?" : "Reactivate this developer?"}
        description={
          isActive
            ? "Suspended developers cannot buy numbers or OTPs through the API until reactivated. Existing orders are not changed."
            : "This developer will be able to use the API again with their existing keys."
        }
        confirmLabel={isActive ? "Suspend developer" : "Reactivate developer"}
        tone={isActive ? "danger" : "default"}
        busy={busy}
        error={error}
        confirmDisabled={isActive && !emailMatches}
        onConfirm={submitStatus}
        onClose={close}
      >
        {isActive && (
          <>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Reason (shown in the audit log)</span>
              <input className={`${inputClass} mt-1`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. suspicious usage" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">
                Type <span className="font-mono">{developer.email}</span> to confirm
              </span>
              <input className={`${inputClass} mt-1`} value={typedEmail} onChange={(e) => setTypedEmail(e.target.value)} autoComplete="off" />
            </label>
          </>
        )}
      </ConfirmModal>

      <ConfirmModal
        open={modal === "limit"}
        title="Set API rate limit"
        description={
          <>
            Base requests per minute for this developer. Leave blank to use the platform default of {fmtCount(defaults.rate_limit_per_min)}. The enforced ceiling is three times this base value to allow short bursts.
          </>
        }
        confirmLabel="Save rate limit"
        busy={busy}
        error={error}
        onConfirm={submitLimit}
        onClose={close}
      >
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Requests per minute</span>
          <input
            className={`${inputClass} mt-1`}
            inputMode="numeric"
            value={limitInput}
            onChange={(e) => setLimitInput(e.target.value)}
            placeholder={`Default: ${defaults.rate_limit_per_min}`}
          />
        </label>
      </ConfirmModal>

      <ConfirmModal
        open={modal === "pricing"}
        title="Set developer pricing"
        description="Changes apply to the next order this developer places. Leave a field blank to use the platform default."
        confirmLabel="Save pricing"
        busy={busy}
        error={error}
        onConfirm={submitPricing}
        onClose={close}
      >
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Phone number margin (naira)</span>
          <input className={`${inputClass} mt-1`} inputMode="decimal" value={marginInput} onChange={(e) => setMarginInput(e.target.value)} placeholder={`Default: ${defaults.phone_margin_naira}`} />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Email OTP price (naira)</span>
          <input className={`${inputClass} mt-1`} inputMode="decimal" value={emailPriceInput} onChange={(e) => setEmailPriceInput(e.target.value)} placeholder={`Default: ${defaults.email_price_naira}`} />
        </label>
      </ConfirmModal>
    </>
  );
}
