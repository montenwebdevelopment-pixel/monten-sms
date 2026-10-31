import { ReactNode } from "react";

export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizes = {
    sm: "text-lg",
    md: "text-2xl",
    lg: "text-4xl",
  };
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-navy-900 to-royal-600">
        <span className="text-white font-bold text-lg">M</span>
      </div>
      <span className={`font-extrabold tracking-tight text-navy-900 ${sizes[size]}`}>
        MONTEN<span className="text-royal-600">SMS</span>
      </span>
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export function Button({
  children,
  onClick,
  type = "button",
  variant = "primary",
  className = "",
  disabled = false,
  loading = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  className?: string;
  disabled?: boolean;
  loading?: boolean;
}) {
  const variants = {
    primary: "bg-royal-600 text-white hover:bg-royal-700 shadow-sm",
    secondary: "bg-navy-900 text-white hover:bg-navy-800 shadow-sm",
    outline: "border border-slate-300 text-navy-900 hover:bg-slate-50 bg-white",
    ghost: "text-navy-700 hover:bg-slate-100",
    danger: "bg-error-600 text-white hover:bg-error-700 shadow-sm",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-sm transition-base btn-lift disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {loading && <Spinner className="w-4 h-4" />}
      {children}
    </button>
  );
}

export function Input({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  error,
  icon,
  required = false,
}: {
  label?: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
  icon?: ReactNode;
  required?: boolean;
}) {
  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-navy-800 mb-1.5">
          {label} {required && <span className="text-error-500">*</span>}
        </label>
      )}
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
            {icon}
          </div>
        )}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          className={`w-full px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-navy-900 placeholder-slate-400 input-focus transition-base text-sm ${icon ? "pl-10" : ""} ${error ? "border-error-400" : ""}`}
        />
      </div>
      {error && <p className="mt-1 text-xs text-error-500">{error}</p>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 card-shadow ${className}`}>
      {children}
    </div>
  );
}

export function EmptyState({ icon, title, message }: { icon: ReactNode; title: string; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-navy-900 mb-1">{title}</h3>
      <p className="text-sm text-slate-500 max-w-sm">{message}</p>
    </div>
  );
}
