import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Badge, Button, Card, EmptyState, PageLoader } from "../../components/ui";
import { fmtAgo } from "../../lib/format";

const ICONS: Record<string, string> = {
  approaching: "🔔",
  delay: "⏰",
  replacement: "🔁",
  cancellation: "🚫",
  alert: "📣",
  emergency: "🚨",
  trip_update: "ℹ️",
};

export default function Notifications() {
  const [items, setItems] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [n, a] = await Promise.all([api.get("/notifications"), api.get("/alerts")]);
    setItems(n);
    setAlerts(a);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(() => setLoading(false));
    const iv = window.setInterval(load, 12000);
    return () => window.clearInterval(iv);
  }, [load]);

  useEffect(() => {
    const sock = (window as any).__ctSocket;
    if (!sock) return;
    return sock.on((topic: string) => {
      if (topic === "notifications.new") load();
    });
  }, [load]);

  async function markAll() {
    await api.post("/notifications/read-all");
    load();
  }

  if (loading) return <PageLoader label="Loading notifications…" />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Notifications & alerts</h1>
          <p className="text-sm text-slate-500">Bus approach alerts, delays, replacements and service announcements.</p>
        </div>
        <Button variant="outline" onClick={markAll}>Mark all read</Button>
      </div>

      {alerts.length > 0 && (
        <Card className="p-4">
          <h2 className="font-semibold text-slate-700 mb-3">Service alerts</h2>
          <div className="space-y-2">
            {alerts.map((a) => (
              <div
                key={a.id}
                className={`rounded-xl border p-3 ${
                  a.kind === "critical" || a.kind === "emergency"
                    ? "bg-red-50 border-red-200"
                    : a.kind === "warning" || a.kind === "delay"
                      ? "bg-amber-50 border-amber-200"
                      : "bg-slate-50 border-slate-200"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-sm text-slate-800">{a.title}</p>
                  <span className="text-[11px] text-slate-400 whitespace-nowrap">{fmtAgo(a.createdAt)}</span>
                </div>
                {a.body && <p className="text-sm text-slate-600 mt-0.5">{a.body}</p>}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-4">
        <h2 className="font-semibold text-slate-700 mb-3">My notifications</h2>
        {items.length === 0 ? (
          <EmptyState icon="🔕" title="No notifications yet" hint="You'll be notified when your bus is approaching, delayed, or replaced." />
        ) : (
          <div className="space-y-2">
            {items.map((n) => (
              <div
                key={n.id}
                className={`flex gap-3 rounded-xl border p-3 ${n.read ? "border-slate-100 bg-white" : "border-brand-200 bg-brand-50/40"}`}
              >
                <span className="text-xl">{ICONS[n.type] || "ℹ️"}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm text-slate-800">{n.title}</p>
                    {!n.read && <Badge tone="bg-brand-100 text-brand-700 border-brand-200">NEW</Badge>}
                  </div>
                  <p className="text-sm text-slate-600">{n.body}</p>
                  <p className="text-[11px] text-slate-400 mt-1">{fmtAgo(n.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
