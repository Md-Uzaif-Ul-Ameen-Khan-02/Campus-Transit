import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Badge, Button, Card, EmptyState, Modal, PageLoader, StatusBadge, useToast } from "../../components/ui";
import { RouteMap } from "../../components/map";
import { fmtAgo, occupancyColor } from "../../lib/format";

export default function LiveOps() {
  const { push } = useToast();
  const [live, setLive] = useState<any[] | null>(null);
  const [routes, setRoutes] = useState<any[]>([]);
  const [buses, setBuses] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [sel, setSel] = useState<any>(null);
  const [replaceBusOpen, setReplaceBusOpen] = useState(false);
  const [replaceDriverOpen, setReplaceDriverOpen] = useState(false);

  const load = useCallback(async () => {
    setLive(await api.get("/admin/live"));
  }, []);

  useEffect(() => {
    load();
    api.get("/routes").then(setRoutes).catch(() => {});
    api.get("/buses").then(setBuses).catch(() => {});
    api.get("/drivers").then(setDrivers).catch(() => {});
    const iv = window.setInterval(load, 6000);
    return () => window.clearInterval(iv);
  }, [load]);

  useEffect(() => {
    const sock = (window as any).__ctSocket;
    if (!sock) return;
    return sock.on((topic: string) => {
      if (["bus.location.updated", "trip.started", "trip.ended", "trip.replaced", "emergency.triggered", "emergency.resolved", "bus.occupancy.updated"].includes(topic)) load();
      if (topic === "emergency.triggered") push({ kind: "error", title: "🚨 EMERGENCY", body: "An active trip raised an emergency — check the live map." });
    });
  }, [load, push]);

  // keep selected trip fresh
  useEffect(() => {
    if (sel && live) {
      const fresh = live.find((t) => t.tripId === sel.tripId);
      if (fresh) setSel(fresh);
    }
  }, [live]); // eslint-disable-line

  if (live == null) return <PageLoader label="Connecting to live operations…" />;

  const positioned = live.filter((t) => t.lat != null);
  const allGeometry = routes;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Live operations</h1>
          <p className="text-sm text-slate-500">{live.length} active trip{live.length !== 1 ? "s" : ""} · {positioned.length} with live GPS</p>
        </div>
        <Button variant="outline" onClick={load}>Refresh</Button>
      </div>

      <Card className="p-3">
        {live.length === 0 ? (
          <EmptyState icon="🛰️" title="No active trips" hint="Start a trip from the driver console, or use a demo simulation from the Trips page." />
        ) : (
          <RouteMap
            geometry={(allGeometry.find((r: any) => r.id === (sel?.tripId ? sel.routeId : positioned[0]?.routeId))?.geometry || []) as any}
            height="460px"
            bus={null}
            otherBuses={positioned.map((t) => ({
              lat: t.lat, lng: t.lng, heading: t.heading, label: t.busReg || t.tripId,
            }))}
            color="#2563eb"
          />
        )}
      </Card>

      <div className="grid md:grid-cols-2 gap-3">
        {live.map((t) => (
          <Card key={t.tripId} className={`p-4 cursor-pointer transition-shadow hover:shadow-md ${sel?.tripId === t.tripId ? "ring-2 ring-brand-500" : ""} ${t.status === "emergency" ? "border-red-300 bg-red-50" : ""}`} onClick={() => setSel(t)}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: t.routeColor }} />
                <span className="font-bold text-slate-800 truncate">{t.routeName}</span>
                <StatusBadge status={t.status} />
              </div>
              <span className="text-xs text-slate-400 whitespace-nowrap">{t.lastFixAt ? fmtAgo(t.lastFixAt) : "no fix"}</span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
              <div><p className="text-[11px] text-slate-400 uppercase font-semibold">Bus</p><p className="font-semibold text-slate-700">{t.busReg}</p></div>
              <div><p className="text-[11px] text-slate-400 uppercase font-semibold">Driver</p><p className="font-semibold text-slate-700 truncate">{t.driverName}</p></div>
              <div><p className="text-[11px] text-slate-400 uppercase font-semibold">Speed</p><p className="font-semibold text-slate-700">{t.speedKmh} km/h</p></div>
            </div>
            <div className="mt-2 flex items-center gap-2 flex-wrap text-sm">
              <span className={`rounded border px-1.5 py-0.5 font-semibold ${occupancyColor(t.occupancyLevel)}`}>{t.occupancy}/{t.capacity} pax</span>
              {t.delayMin > 0 && <span className="text-amber-600 font-semibold text-sm">+{t.delayMin} min</span>}
              <span className="text-xs text-slate-400">👁 {t.viewers}</span>
              {t.source === "demo_sim" && <Badge tone="bg-purple-100 text-purple-700 border-purple-200">DEMO</Badge>}
              {t.isStale && <Badge tone="bg-orange-100 text-orange-700 border-orange-200">GPS STALE</Badge>}
            </div>
          </Card>
        ))}
      </div>

      {/* Trip control modal */}
      <Modal open={!!sel} onClose={() => setSel(null)} title={sel ? `${sel.routeName} — ${sel.busReg}` : ""} wide>
        {sel && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div><p className="text-xs text-slate-400 uppercase font-semibold">Status</p><div className="mt-1"><StatusBadge status={sel.status} /></div></div>
              <div><p className="text-xs text-slate-400 uppercase font-semibold">Driver</p><p className="font-semibold">{sel.driverName}</p></div>
              <div><p className="text-xs text-slate-400 uppercase font-semibold">Progress</p><p className="font-semibold">{Math.round((sel.progress || 0) * 100)}%</p></div>
              <div><p className="text-xs text-slate-400 uppercase font-semibold">Last fix</p><p className="font-semibold">{fmtAgo(sel.lastFixAt)}</p></div>
            </div>

            {sel.lat != null && (
              <RouteMap
                geometry={(allGeometry.find((r: any) => r.id === sel.routeId)?.geometry || []) as any}
                bus={{ lat: sel.lat, lng: sel.lng, heading: sel.heading }}
                color={sel.routeColor}
                emergency={sel.status === "emergency"}
                height="300px"
              />
            )}

            {sel.status === "emergency" && (
              <div className="bg-red-50 border border-red-300 rounded-xl p-3 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-red-700">Emergency active: {sel.emergencyType || "unknown"}</p>
                <Button variant="danger" onClick={async () => { await api.post(`/trips/${sel.tripId}/emergency/resolve`); push({ kind: "success", title: "Emergency resolved" }); load(); }}>
                  Resolve emergency
                </Button>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => setReplaceBusOpen(true)}>🔁 Replace bus</Button>
              <Button variant="outline" onClick={() => setReplaceDriverOpen(true)}>🧑‍✈️ Replace driver</Button>
              <Button variant="outline" onClick={async () => { await api.post(`/trips/${sel.tripId}/simulate`, { speed_kmh: 32, from_start: false }); push({ kind: "info", title: "Demo simulation started", body: "Location feeds tagged demo_sim." }); load(); }}>
                ▶ Start demo simulation
              </Button>
              <Button variant="outline" onClick={async () => { await api.post(`/trips/${sel.tripId}/simulate/stop`); push({ kind: "info", title: "Simulation stopped" }); load(); }}>
                ■ Stop simulation
              </Button>
              <Button variant="outline" onClick={() => window.open(`/api/trips/${sel.tripId}/locations?limit=2000`, "_blank")}>📄 GPS trail (JSON)</Button>
              <Button variant="danger" onClick={async () => { if (confirm("Cancel this trip? Students will be notified.")) { await api.post(`/trips/${sel.tripId}/cancel`, {}); push({ kind: "alert", title: "Trip cancelled", body: "Students on this route were notified." }); setSel(null); load(); } }}>
                ✖ Cancel trip
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Replace bus modal */}
      <Modal open={replaceBusOpen} onClose={() => setReplaceBusOpen(false)} title="Replace bus">
        {sel && (
          <ReplaceList
            items={buses.filter((b: any) => b.id !== sel.busId && b.status === "available")}
            labelFn={(b: any) => `${b.display_name || b.registration_number} — ${b.registration_number} (${b.capacity} seats)`}
            onPick={async (id) => {
              try {
                await api.post(`/trips/${sel.tripId}/replace-bus`, { bus_id: id, reason: "Replaced from live ops" });
                push({ kind: "success", title: "Bus replaced", body: "Students on this route were notified automatically." });
                setReplaceBusOpen(false); setSel(null); load();
              } catch (e: any) { push({ kind: "error", title: "Replace failed", body: e.message }); }
            }}
          />
        )}
      </Modal>

      {/* Replace driver modal */}
      <Modal open={replaceDriverOpen} onClose={() => setReplaceDriverOpen(false)} title="Replace driver">
        {sel && (
          <ReplaceList
            items={drivers.filter((d: any) => d.id !== sel.driverId && d.active && !["on_trip", "emergency"].includes(d.status))}
            labelFn={(d: any) => `${d.full_name} (${d.employee_code || "no code"})`}
            onPick={async (id) => {
              try {
                await api.post(`/trips/${sel.tripId}/replace-driver`, { driver_id: id, reason: "Replaced from live ops" });
                push({ kind: "success", title: "Driver replaced" });
                setReplaceDriverOpen(false); setSel(null); load();
              } catch (e: any) { push({ kind: "error", title: "Replace failed", body: e.message }); }
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function ReplaceList({ items, labelFn, onPick }: { items: any[]; labelFn: (x: any) => string; onPick: (id: string) => void }) {
  if (items.length === 0) return <p className="text-sm text-slate-400 py-6 text-center">No available candidates right now.</p>;
  return (
    <div className="space-y-2">
      {items.map((x) => (
        <button key={x.id} onClick={() => onPick(x.id)} className="w-full text-left px-4 py-3 rounded-xl border border-slate-200 hover:border-brand-500 hover:bg-brand-50 text-sm font-medium transition-colors">
          {labelFn(x)}
        </button>
      ))}
    </div>
  );
}
