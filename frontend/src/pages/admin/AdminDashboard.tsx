import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { Badge, Card, PageLoader, SectionTitle, Stat, StatusBadge } from "../../components/ui";
import { fmtAgo, occupancyColor } from "../../lib/format";

export default function AdminDashboard() {
  const [ov, setOv] = useState<any>(null);

  const load = useCallback(async () => {
    setOv(await api.get("/admin/overview"));
  }, []);

  useEffect(() => {
    load().catch(() => {});
    const iv = window.setInterval(load, 8000);
    return () => window.clearInterval(iv);
  }, [load]);

  useEffect(() => {
    const sock = (window as any).__ctSocket;
    if (!sock) return;
    return sock.on((topic: string) => {
      if (["trip.started", "trip.ended", "trip.delayed", "trip.replaced", "emergency.triggered", "emergency.resolved", "bus.location.updated"].includes(topic)) load();
    });
  }, [load]);

  if (!ov) return <PageLoader label="Loading operations overview…" />;

  const t = ov.today;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Today's operations</h1>
          <p className="text-sm text-slate-500">{t.date} · live view refreshes automatically</p>
        </div>
        <Link to="/admin/trips" className="text-sm font-semibold text-brand-600 hover:underline">+ Create trip assignment</Link>
      </div>

      {t.emergency > 0 && (
        <div className="bg-red-600 text-white rounded-2xl px-5 py-4 flex items-center justify-between shadow-lg">
          <p className="font-bold">🚨 {t.emergency} active emergency trip{t.emergency > 1 ? "s" : ""} — respond now</p>
          <Link to="/admin/live" className="text-sm font-semibold underline">Open live map</Link>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Stat label="Fleet" value={ov.totals.buses} sub={`${ov.totals.buses_available} available · ${ov.totals.buses_maintenance} maint.`} />
        <Stat label="Active trips" value={t.activeTrips} sub="live right now" tone="text-emerald-600" />
        <Stat label="Scheduled today" value={t.scheduledTrips} sub="remaining" />
        <Stat label="Completed" value={t.completedTrips} sub="today" />
        <Stat label="Delayed" value={t.delayed} tone={t.delayed ? "text-amber-600" : "text-slate-900"} />
        <Stat label="Students tracking" value={t.studentsTracking} sub="with saved pickup" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="p-4 lg:col-span-2">
          <SectionTitle right={<Link to="/admin/live" className="text-sm font-semibold text-brand-600">Live map →</Link>}>
            Active trips ({ov.activeTripsList.length})
          </SectionTitle>
          {ov.activeTripsList.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">No buses on the road right now.</p>
          ) : (
            <div className="space-y-2">
              {ov.activeTripsList.map((tr: any) => (
                <div key={tr.tripId} className={`rounded-xl border p-3 ${tr.status === "emergency" ? "border-red-300 bg-red-50" : "border-slate-100"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: tr.routeColor }} />
                      <span className="font-bold text-slate-800">{tr.routeName}</span>
                      <span className="text-sm text-slate-500">· {tr.busReg} · {tr.driverName}</span>
                      <StatusBadge status={tr.status} />
                      {tr.source === "demo_sim" && <Badge tone="bg-purple-100 text-purple-700 border-purple-200">DEMO</Badge>}
                      {tr.isStale && <Badge tone="bg-orange-100 text-orange-700 border-orange-200">GPS STALE</Badge>}
                    </div>
                    <span className="text-xs text-slate-400">{tr.lastFixAt ? fmtAgo(tr.lastFixAt) : "no fix yet"}</span>
                  </div>
                  <div className="flex flex-wrap gap-4 mt-2 text-sm text-slate-600">
                    <span>🚀 {tr.speedKmh} km/h</span>
                    <span>👥 <span className={`font-semibold rounded px-1.5 border ${occupancyColor(tr.occupancyLevel)}`}>{tr.occupancy}/{tr.capacity}</span></span>
                    <span>👁 {tr.viewers} tracking</span>
                    {tr.delayMin > 0 && <span className="text-amber-600 font-semibold">+{tr.delayMin} min delay</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <SectionTitle>Drivers</SectionTitle>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">On trip</span><span className="font-bold text-emerald-600">{ov.totals.drivers_on_trip}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Active roster</span><span className="font-bold">{ov.totals.drivers}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Registered students</span><span className="font-bold">{ov.totals.students}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Active routes</span><span className="font-bold">{ov.totals.routes}</span></div>
            </div>
          </Card>
          <Card className="p-4">
            <SectionTitle>Quick actions</SectionTitle>
            <div className="grid gap-2 text-sm">
              <Link to="/admin/trips" className="px-3 py-2 rounded-xl bg-brand-50 text-brand-700 font-semibold hover:bg-brand-100">🗓️ Plan daily assignments</Link>
              <Link to="/admin/alerts" className="px-3 py-2 rounded-xl bg-slate-50 text-slate-700 font-semibold hover:bg-slate-100">📣 Send service alert</Link>
              <Link to="/admin/analytics" className="px-3 py-2 rounded-xl bg-slate-50 text-slate-700 font-semibold hover:bg-slate-100">📈 View analytics</Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
