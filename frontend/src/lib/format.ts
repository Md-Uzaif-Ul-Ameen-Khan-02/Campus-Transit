export function fmtEta(eta: any): string {
  if (!eta || !eta.available) return eta?.passed ? "Passed your stop" : "—";
  const lo = Math.max(1, Math.round(eta.eta_low_sec / 60));
  const hi = Math.round(eta.eta_high_sec / 60);
  if (hi <= 1) return "Arriving now";
  return `${lo}–${hi} min`;
}

export function fmtDistance(m: number | undefined | null): string {
  if (m == null) return "—";
  if (m < 950) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "no data";
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${Math.round(sec)}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  return `${Math.round(sec / 3600)} h ago`;
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function occupancyColor(level: string): string {
  return level === "high"
    ? "bg-red-100 text-red-700 border-red-200"
    : level === "medium"
      ? "bg-amber-100 text-amber-700 border-amber-200"
      : "bg-emerald-100 text-emerald-700 border-emerald-200";
}

export const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700 border-emerald-200",
  live: "bg-emerald-100 text-emerald-700 border-emerald-200",
  delayed: "bg-amber-100 text-amber-700 border-amber-200",
  emergency: "bg-red-600 text-white border-red-700 animate-pulse",
  scheduled: "bg-slate-100 text-slate-600 border-slate-200",
  assigned: "bg-blue-100 text-blue-700 border-blue-200",
  ready: "bg-indigo-100 text-indigo-700 border-indigo-200",
  completed: "bg-slate-100 text-slate-500 border-slate-200",
  cancelled: "bg-red-100 text-red-600 border-red-200",
  interrupted: "bg-orange-100 text-orange-700 border-orange-200",
  available: "bg-emerald-100 text-emerald-700 border-emerald-200",
  maintenance: "bg-orange-100 text-orange-700 border-orange-200",
  unavailable: "bg-slate-200 text-slate-600 border-slate-300",
  inactive: "bg-slate-100 text-slate-400 border-slate-200",
  on_trip: "bg-emerald-100 text-emerald-700 border-emerald-200",
  offline: "bg-slate-100 text-slate-500 border-slate-200",
};
