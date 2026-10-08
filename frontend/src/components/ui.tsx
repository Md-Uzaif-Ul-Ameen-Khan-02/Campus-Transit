import { createContext, useCallback, useContext, useState } from "react";
import { STATUS_BADGE } from "../lib/format";

export function Card({ children, className = "", onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={`bg-white rounded-2xl border border-slate-200 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-lg font-semibold text-slate-800">{children}</h2>
      {right}
    </div>
  );
}

export function Badge({ children, tone = "" }: { children: React.ReactNode; tone?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${tone || "bg-slate-100 text-slate-600 border-slate-200"}`}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={STATUS_BADGE[status] || ""}>
      {status === "active" && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 live-dot" />}
      {status.replace("_", " ").toUpperCase()}
    </Badge>
  );
}

type BtnVariant = "primary" | "ghost" | "danger" | "outline" | "success";
export function Button({
  children,
  variant = "primary",
  className = "",
  loading,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; loading?: boolean }) {
  const styles: Record<BtnVariant, string> = {
    primary: "bg-brand-600 hover:bg-brand-700 text-white shadow-sm",
    success: "bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm",
    danger: "bg-red-600 hover:bg-red-700 text-white shadow-sm",
    outline: "border border-slate-300 hover:bg-slate-50 text-slate-700 bg-white",
    ghost: "hover:bg-slate-100 text-slate-700",
  };
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
    >
      {loading && <Spinner className="w-4 h-4" />}
      {children}
    </button>
  );
}

export function Spinner({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-label="Loading">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function PageLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-500">
      <Spinner className="w-8 h-8 text-brand-600" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function EmptyState({ icon = "🚌", title, hint, action }: { icon?: string; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="text-center py-14 px-6">
      <div className="text-4xl mb-3">{icon}</div>
      <h3 className="font-semibold text-slate-700">{title}</h3>
      {hint && <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Modal({
  open, onClose, title, children, wide,
}: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center p-0 sm:p-6" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white w-full ${wide ? "sm:max-w-3xl" : "sm:max-w-md"} rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto`}>
        <div className="sticky top-0 bg-white px-5 py-4 border-b border-slate-100 flex items-center justify-between rounded-t-2xl">
          <h3 className="font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600 text-xl leading-none px-2">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
      <style>{`.leaflet-popup { z-index: 500 }`}</style>
    </div>
  );
}

export function Stat({ label, value, sub, tone = "text-slate-900" }: { label: string; value: React.ReactNode; sub?: string; tone?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tone}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </Card>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-600">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </label>
  );
}

export const inputCls =
  "w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500";

// ---------------- Toasts ----------------
type Toast = { id: number; kind: "info" | "success" | "error" | "alert"; title: string; body?: string };
const ToastCtx = createContext<{ push: (t: Omit<Toast, "id">) => void }>({ push: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts, { ...t, id }]);
    window.setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 6000);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[1100] flex flex-col gap-2 w-[min(92vw,360px)]">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast-in rounded-xl shadow-lg border p-3 text-sm ${
              t.kind === "error"
                ? "bg-red-50 border-red-200 text-red-700"
                : t.kind === "success"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                  : t.kind === "alert"
                    ? "bg-amber-50 border-amber-200 text-amber-800"
                    : "bg-white border-slate-200 text-slate-700"
            }`}
            role="status"
          >
            <p className="font-semibold">{t.title}</p>
            {t.body && <p className="mt-0.5 opacity-80">{t.body}</p>}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
