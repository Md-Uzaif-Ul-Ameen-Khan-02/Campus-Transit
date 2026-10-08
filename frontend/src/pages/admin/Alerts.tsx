import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Badge, Button, Card, Field, PageLoader, inputCls, useToast, EmptyState } from "../../components/ui";
import { fmtAgo } from "../../lib/format";

export default function AlertsPage() {
  const { push } = useToast();
  const [alerts, setAlerts] = useState<any[] | null>(null);
  const [routes, setRoutes] = useState<any[]>([]);
  const [trips, setTrips] = useState<any[]>([]);
  const [form, setForm] = useState({ title: "", body: "", kind: "info", scope: "all", route_id: "", trip_id: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setAlerts(await api.get("/alerts"));
  }, []);

  useEffect(() => {
    load().catch(() => setAlerts([]));
    api.get("/routes").then(setRoutes).catch(() => {});
    api.get("/trips").then(setTrips).catch(() => {});
  }, [load]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body: any = { title: form.title, body: form.body, kind: form.kind, scope: form.scope };
      if (form.scope === "route") body.route_id = form.route_id;
      if (form.scope === "trip") body.trip_id = form.trip_id;
      await api.post("/alerts", body);
      push({ kind: "success", title: "Alert sent", body: form.scope === "all" ? "Delivered to all students." : "Delivered to students on the selected scope." });
      setForm({ ...form, title: "", body: "" });
      load();
    } catch (e: any) {
      push({ kind: "error", title: "Send failed", body: e.message });
    } finally {
      setBusy(false);
    }
  }

  if (alerts == null) return <PageLoader label="Loading alerts…" />;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-800">Service alerts</h1>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <Card className="p-4">
          <h2 className="font-semibold text-slate-700 mb-3">Broadcast an alert</h2>
          <form onSubmit={send} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Severity">
                <select className={inputCls} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="critical">Critical</option>
                  <option value="delay">Delay</option>
                  <option value="replacement">Replacement</option>
                  <option value="cancellation">Cancellation</option>
                </select>
              </Field>
              <Field label="Audience">
                <select className={inputCls} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
                  <option value="all">All students</option>
                  <option value="route">One route</option>
                  <option value="trip">One trip</option>
                </select>
              </Field>
            </div>
            {form.scope === "route" && (
              <Field label="Route">
                <select className={inputCls} required value={form.route_id} onChange={(e) => setForm({ ...form, route_id: e.target.value })}>
                  <option value="">Select route…</option>
                  {routes.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </Field>
            )}
            {form.scope === "trip" && (
              <Field label="Trip">
                <select className={inputCls} required value={form.trip_id} onChange={(e) => setForm({ ...form, trip_id: e.target.value })}>
                  <option value="">Select trip…</option>
                  {trips.slice(0, 60).map((t: any) => (
                    <option key={t.id} value={t.id}>{t.trip_date} {t.scheduled_start} · {t.route_name} · {t.bus_reg || "unassigned"}</option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Title"><input className={inputCls} required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Route 3 delayed by approximately 10 minutes" /></Field>
            <Field label="Message"><textarea className={inputCls} rows={3} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Details students should know…" /></Field>
            <Button type="submit" loading={busy} className="w-full">Send alert</Button>
          </form>
        </Card>

        <Card className="p-4">
          <h2 className="font-semibold text-slate-700 mb-3">Sent alerts</h2>
          {alerts.length === 0 ? (
            <EmptyState icon="📣" title="No alerts sent yet" />
          ) : (
            <div className="space-y-2 max-h-[520px] overflow-y-auto">
              {alerts.map((a) => (
                <div key={a.id} className="border border-slate-100 rounded-xl p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-sm text-slate-800">{a.title}</p>
                    <Badge tone={a.kind === "critical" ? "bg-red-100 text-red-700 border-red-200" : a.kind === "warning" || a.kind === "delay" ? "bg-amber-100 text-amber-700 border-amber-200" : ""}>
                      {a.kind}
                    </Badge>
                  </div>
                  {a.body && <p className="text-sm text-slate-500 mt-0.5">{a.body}</p>}
                  <p className="text-[11px] text-slate-400 mt-1">{a.scope} · {fmtAgo(a.createdAt)}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
