import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../auth";
import { Badge, Button, Card, EmptyState, PageLoader, StatusBadge, useToast } from "../../components/ui";
import { RouteMap } from "../../components/map";
import { fmtAgo, fmtDistance, fmtEta, occupancyColor } from "../../lib/format";

interface TrackingBus {
  tripId: string;
  busReg: string;
  busName: string;
  status: string;
  lat: number | null;
  lng: number | null;
  speedKmh: number;
  heading: number;
  routePosM: number;
  occupancy: number;
  occupancyLevel: string;
  capacity: number;
  source: string;
  lastFixAt: string | null;
  isStale: boolean;
  staleAfterSec: number;
  eta: any;
}

interface TrackingData {
  tracking: boolean;
  reason?: string;
  route?: any;
  pickup?: any;
  buses?: TrackingBus[];
  primaryTripId?: string;
  upcoming?: any[];
}

export default function StudentDashboard() {
  const { name } = useAuth();
  const { push } = useToast();
  const [data, setData] = useState<TrackingData | null>(null);
  const [loading, setLoading] = useState(true);
  const seenNotifs = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const t = await api.get("/student/tracking");
      setData(t);
    } catch (e: any) {
      push({ kind: "error", title: "Could not load tracking", body: e.message });
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    load();
    const iv = window.setInterval(load, 10000); // resilient polling alongside WS
    return () => window.clearInterval(iv);
  }, [load]);

  // Real-time updates via the shared socket
  useEffect(() => {
    const sock = (window as any).__ctSocket;
    if (!sock) return;
    return sock.on((topic: string) => {
      if (topic === "bus.location.updated" || topic === "bus.occupancy.updated" || topic === "trip.ended" || topic === "trip.replaced") {
        load();
      }
    });
  }, [load]);

  // Toast on approaching notifications arriving via WS
  useEffect(() => {
    const sock = (window as any).__ctSocket;
    if (!sock) return;
    return sock.on((topic: string, payload: any) => {
      if (topic === "notifications.new" && !seenNotifs.current.has(payload.title + payload.tripId)) {
        seenNotifs.current.add(payload.title + payload.tripId);
        push({ kind: "alert", title: payload.title, body: payload.body });
      }
    });
  }, [push]);

  if (loading) return <PageLoader label="Connecting to live tracking…" />;

  if (!data?.tracking) {
    const noRoute = data?.reason === "no_route_or_pickup" || !data?.route;
    return (
      <div className="space-y-4">
        <Greeting name={name} />
        <Card>
          <EmptyState
            icon="🛣️"
            title={noRoute ? "Set up your route to start tracking" : "No bus is running on your route right now"}
            hint={
              noRoute
                ? "Choose your route and drop a pin at your pickup point — we'll handle the rest."
                : "Check the schedule below for the next departure. You'll get a notification when the trip starts."
            }
            action={
              noRoute ? (
                <Link to="/student/route"><Button>Set up my route</Button></Link>
              ) : undefined
            }
          />
        </Card>
        {data?.upcoming && data.upcoming.length > 0 && (
          <Card className="p-4">
            <h2 className="font-semibold text-slate-700 mb-3">Today's schedule — {data.route?.name}</h2>
            <div className="space-y-2">
              {data.upcoming.map((u: any) => (
                <div key={u.tripId} className="flex items-center justify-between text-sm border border-slate-100 rounded-xl px-3 py-2">
                  <span className="font-semibold text-slate-700">{u.scheduledStart}</span>
                  <span className="text-slate-500">Bus {u.bus} · {u.driver}</span>
                  <StatusBadge status={u.status} />
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    );
  }

  const primary = data.buses![0];
  const others = data.buses!.slice(1);

  return (
    <div className="space-y-4">
      <Greeting name={name} />

      {/* Primary bus card */}
      <Card className="overflow-hidden">
        <div className="p-5 pb-4 flex flex-wrap items-start justify-between gap-3" style={{ borderBottom: "1px solid rgb(241 245 249)" }}>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-slate-800">{primary.busName || primary.busReg}</h1>
              <StatusBadge status={primary.status} />
              {primary.source === "demo_sim" && (
                <Badge tone="bg-purple-100 text-purple-700 border-purple-200">DEMO SIMULATION</Badge>
              )}
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              Route: <span className="font-semibold text-slate-700">{data.route.name}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold px-2 py-1 rounded-lg border ${primary.isStale ? "bg-orange-50 text-orange-600 border-orange-200" : "bg-emerald-50 text-emerald-600 border-emerald-200"}`}>
              {primary.isStale ? `Last updated ${fmtAgo(primary.lastFixAt)}` : "LIVE"}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-slate-100 border-b border-slate-100">
          <div className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold">ETA to your pickup</p>
            <p className="text-2xl font-extrabold text-brand-700 mt-1">{fmtEta(primary.eta)}</p>
            {primary.eta?.distance_m != null && (
              <p className="text-xs text-slate-400 mt-0.5">{fmtDistance(primary.eta.distance_m)} away along route</p>
            )}
          </div>
          <div className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold">Distance</p>
            <p className="text-2xl font-extrabold text-slate-800 mt-1">{fmtDistance(primary.eta?.distance_m)}</p>
          </div>
          <div className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold">Occupancy</p>
            <p className="text-2xl font-extrabold text-slate-800 mt-1 capitalize">
              {primary.occupancyLevel}
              <span className="text-sm font-medium text-slate-400"> {primary.capacity ? `${primary.occupancy}/${primary.capacity}` : ""}</span>
            </p>
          </div>
          <div className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold">Speed</p>
            <p className="text-2xl font-extrabold text-slate-800 mt-1">{Math.round(primary.speedKmh)}<span className="text-sm font-medium text-slate-400"> km/h</span></p>
          </div>
        </div>

        <div className="p-4">
          <RouteMap
            geometry={data.route.geometry}
            pickup={data.pickup}
            bus={primary.lat != null && primary.lng != null ? { lat: primary.lat, lng: primary.lng, heading: primary.heading } : null}
            otherBuses={others.filter((b) => b.lat != null).map((b) => ({ lat: b.lat!, lng: b.lng!, heading: b.heading, label: b.busReg }))}
            color={data.route.color}
            emergency={primary.status === "emergency"}
            height="380px"
          />
          <p className="text-xs text-slate-400 mt-2">
            ETA is an estimate based on live GPS, route position and historical travel times.
            {primary.eta?.method && ` Model: ${primary.eta.method}.`}
          </p>
        </div>
      </Card>

      {/* Other buses on this route */}
      {others.length > 0 && (
        <Card className="p-4">
          <h2 className="font-semibold text-slate-700 mb-3">Also serving {data.route.name}</h2>
          <div className="grid sm:grid-cols-2 gap-2">
            {others.map((b) => (
              <div key={b.tripId} className="flex items-center justify-between border border-slate-100 rounded-xl px-3 py-2.5">
                <div>
                  <p className="font-semibold text-slate-700 text-sm">{b.busName || b.busReg}</p>
                  <p className="text-xs text-slate-400">{fmtDistance(b.eta?.distance_m)} · {Math.round(b.speedKmh)} km/h</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-brand-700">{fmtEta(b.eta)}</p>
                  <span className={`inline-block mt-1 text-[10px] font-bold px-1.5 py-0.5 rounded border capitalize ${occupancyColor(b.occupancyLevel)}`}>
                    {b.occupancyLevel}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="flex gap-2">
        <Link to="/student/route" className="flex-1"><Button variant="outline" className="w-full">Change route / pickup</Button></Link>
        <Link to="/student/alerts" className="flex-1"><Button variant="outline" className="w-full">Alerts & notifications</Button></Link>
      </div>
    </div>
  );
}

function Greeting({ name }: { name: string }) {
  const hour = new Date().getHours();
  const g = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return (
    <div>
      <h1 className="text-xl font-bold text-slate-800">{g}, {name.split(" ")[0]} 👋</h1>
      <p className="text-sm text-slate-500">Here's your commute right now.</p>
    </div>
  );
}
