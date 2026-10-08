import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../auth";
import { Button, Card, EmptyState, Modal, PageLoader, StatusBadge, inputCls, useToast } from "../../components/ui";
import { fmtAgo } from "../../lib/format";

interface TripT {
  id: string;
  route_name: string;
  bus_reg: string;
  bus_name: string;
  capacity: number;
  scheduled_start: string;
  scheduled_end: string;
  status: string;
  occupancy: number;
  delay_min: number;
  source: string;
  last_fix_at: string | null;
  current_speed: number | null;
}

const DELAY_REASONS = [
  ["traffic", "Traffic congestion"],
  ["mechanical", "Mechanical problem"],
  ["road_blockage", "Road blockage"],
  ["weather", "Weather"],
  ["other", "Other"],
];
const EMERGENCY_KINDS = [
  ["medical", "Medical emergency"],
  ["vehicle", "Vehicle problem"],
  ["accident", "Accident"],
  ["security", "Security issue"],
  ["other", "Other"],
];

export default function DriverDashboard() {
  const { name } = useAuth();
  const { push } = useToast();
  const [trips, setTrips] = useState<TripT[] | null>(null);
  const [trip, setTrip] = useState<TripT | null>(null);
  const [gps, setGps] = useState<"idle" | "connecting" | "connected" | "denied" | "weak" | "offline">("idle");
  const [starting, setStarting] = useState(false);
  const [delayOpen, setDelayOpen] = useState(false);
  const [emgOpen, setEmgOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [occOpen, setOccOpen] = useState(false);
  const [gpsErr, setGpsErr] = useState("");
  const watchId = useRef<number | null>(null);
  const lastSent = useRef(0);
  const sendFail = useRef(0);
  const tripRef = useRef<TripT | null>(null);
  tripRef.current = trip;

  const load = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const list = await api.get(`/trips?mine=true&date=${today}`);
    setTrips(list);
    const active = list.find((t: any) => ["active", "delayed", "emergency"].includes(t.status));
    setTrip(active || list[0] || null);
  }, []);

  useEffect(() => {
    load().catch((e) => push({ kind: "error", title: "Load failed", body: e.message }));
    const iv = window.setInterval(load, 15000);
    return () => window.clearInterval(iv);
  }, [load, push]);

  // Stop the GPS watcher whenever the active trip changes or component unmounts
  useEffect(() => {
    return () => stopWatcher();
  }, []);

  function stopWatcher() {
    if (watchId.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
  }

  async function sendLocation(pos: GeolocationPosition) {
    const t = tripRef.current;
    if (!t) return;
    const now = Date.now();
    const interval = 4000;
    if (now - lastSent.current < interval) return;
    lastSent.current = now;
    try {
      await api.post(`/trips/${t.id}/location`, {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? 0,
        speed: pos.coords.speed ?? 0,
        heading: pos.coords.heading ?? 0,
      });
      setGps("connected");
      sendFail.current = 0;
    } catch (e: any) {
      // validation rejections (jumps/accuracy) shouldn't kill the watcher
      if (e.status === 422) {
        setGps("weak");
        return;
      }
      sendFail.current += 1;
      setGps(sendFail.current >= 3 ? "offline" : "weak");
    }
  }

  function gpsError(err: GeolocationPositionError) {
    if (err.code === err.PERMISSION_DENIED) {
      setGps("denied");
      setGpsErr("Location permission was denied. Enable it in your browser settings to share the bus's live location.");
    } else if (err.code === err.POSITION_UNAVAILABLE) {
      setGps("weak");
      setGpsErr("GPS position unavailable — move to an open area.");
    } else {
      setGps("weak");
      setGpsErr("GPS timeout — retrying…");
    }
  }

  async function startTrip() {
    if (!trip) return;
    setStarting(true);
    try {
      const updated = await api.post(`/trips/${trip.id}/start`);
      setTrip({ ...trip, ...updated } as any);
      if (!navigator.geolocation) {
        setGps("denied");
        setGpsErr("This browser does not support location sharing.");
        return;
      }
      setGps("connecting");
      watchId.current = navigator.geolocation.watchPosition(sendLocation, gpsError, {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 15000,
      });
      push({ kind: "success", title: "Trip started", body: "GPS sharing is now active for this trip." });
    } catch (e: any) {
      push({ kind: "error", title: "Could not start trip", body: e.message });
    } finally {
      setStarting(false);
    }
  }

  async function endTrip() {
    if (!trip) return;
    try {
      await api.post(`/trips/${trip.id}/end`);
      stopWatcher();
      setGps("idle");
      setEndOpen(false);
      push({ kind: "success", title: "Trip completed", body: "Location sharing stopped automatically." });
      load();
    } catch (e: any) {
      push({ kind: "error", title: "Could not end trip", body: e.message });
    }
  }

  async function bump(delta: number) {
    if (!trip) return;
    try {
      const next = Math.max(0, (trip.occupancy || 0) + delta);
      const res = await api.post(`/trips/${trip.id}/occupancy`, { count: next });
      setTrip({ ...trip, occupancy: next });
      push({ kind: "success", title: `Passengers: ${next}/${res.capacity}`, body: `Occupancy ${res.level.toUpperCase()}` });
    } catch (e: any) {
      push({ kind: "error", title: "Update failed", body: e.message });
    }
  }

  if (trips == null) return <PageLoader label="Loading your assignment…" />;

  const isLive = trip && ["active", "delayed", "emergency"].includes(trip.status);

  if (!trip) {
    return (
      <Card>
        <EmptyState icon="😴" title="No trips assigned today" hint="Enjoy the rest — assignments appear here as soon as the transport office schedules you." />
      </Card>
    );
  }

  return (
    <div className="space-y-4 max-w-xl mx-auto">
      <div className="text-center">
        <h1 className="text-xl font-bold text-slate-800">Welcome, {name.split(" ")[0]}</h1>
        <p className="text-sm text-slate-500">Today's assignment</p>
      </div>

      {/* Assignment card */}
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide font-semibold text-slate-400">Route</p>
            <p className="text-lg font-bold text-slate-800">{trip.route_name}</p>
          </div>
          <StatusBadge status={trip.status} />
        </div>
        <div className="grid grid-cols-3 gap-3 mt-4 text-center">
          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-xs text-slate-400 font-semibold uppercase">Bus</p>
            <p className="font-bold text-slate-700 text-sm mt-0.5">{trip.bus_reg || "TBD"}</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-xs text-slate-400 font-semibold uppercase">Departure</p>
            <p className="font-bold text-slate-700 text-sm mt-0.5">{trip.scheduled_start}</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-xs text-slate-400 font-semibold uppercase">Arrival</p>
            <p className="font-bold text-slate-700 text-sm mt-0.5">{trip.scheduled_end || "—"}</p>
          </div>
        </div>

        {!isLive && (
          <div className="mt-5">
            <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl p-3 text-sm mb-3">
              ℹ️ Location access is required to share the bus's live location with students and administrators
              during this trip. Tracking runs <b>only</b> while the trip is active and stops automatically at the end.
            </div>
            <Button className="w-full py-4 text-lg" onClick={startTrip} loading={starting}>
              ▶ START TRIP
            </Button>
          </div>
        )}
      </Card>

      {/* Active trip console */}
      {isLive && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="font-bold text-lg text-slate-800">TRIP ACTIVE</p>
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${
                gps === "connected" ? "bg-emerald-500 live-dot" : gps === "weak" ? "bg-amber-500" : gps === "offline" ? "bg-red-500" : "bg-slate-300"
              }`} />
              <span className="text-sm font-semibold text-slate-600">
                {gps === "connected" ? "GPS: CONNECTED" : gps === "connecting" ? "Starting GPS…" : gps === "weak" ? "GPS: WEAK" : gps === "offline" ? "NETWORK: OFFLINE" : "GPS: OFF"}
              </span>
            </div>
          </div>

          {gpsErr && gps === "denied" && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm mb-3">
              {gpsErr}
            </div>
          )}
          {gps === "offline" && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-sm mb-3">
              You appear offline — location will resume automatically when connectivity returns.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 rounded-xl p-4 text-center">
              <p className="text-xs text-slate-400 font-semibold uppercase">Speed</p>
              <p className="text-3xl font-extrabold text-slate-800">{Math.round((trip as any).speed_kmh || 0)}</p>
              <p className="text-xs text-slate-400">km/h</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-4 text-center">
              <p className="text-xs text-slate-400 font-semibold uppercase">Passengers</p>
              <p className="text-3xl font-extrabold text-slate-800">
                {trip.occupancy}<span className="text-base font-semibold text-slate-400">/{trip.capacity}</span>
              </p>
              <p className="text-xs text-slate-400">last update {fmtAgo(trip.last_fix_at)}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-3">
            <Button variant="outline" onClick={() => bump(-1)} className="py-3 text-base">− Passenger</Button>
            <Button variant="outline" onClick={() => bump(1)} className="py-3 text-base">+ Passenger</Button>
          </div>
          <Button variant="outline" className="w-full mt-2" onClick={() => setOccOpen(true)}>Set exact count</Button>

          <div className="grid grid-cols-2 gap-2 mt-4">
            <Button variant="outline" onClick={() => setDelayOpen(true)}>⏰ Report delay</Button>
            <Button variant="danger" onClick={() => setEmgOpen(true)}>🚨 EMERGENCY</Button>
          </div>
          <Button variant="success" className="w-full mt-2 py-3 text-base" onClick={() => setEndOpen(true)}>
            ■ END TRIP
          </Button>
          {trip.source === "demo_sim" && (
            <p className="text-center text-xs text-purple-600 font-semibold mt-3">DEMO SIMULATION feeds this trip's location</p>
          )}
        </Card>
      )}

      {/* Other today trips */}
      {trips.length > 1 && (
        <Card className="p-4">
          <p className="text-sm font-semibold text-slate-600 mb-2">Other trips today</p>
          <div className="space-y-2">
            {trips.filter((t) => t.id !== trip?.id).map((t) => (
              <div key={t.id} className="flex items-center justify-between text-sm border border-slate-100 rounded-xl px-3 py-2">
                <span className="font-semibold">{t.scheduled_start} · {t.route_name}</span>
                <span className="text-slate-400">{t.bus_reg}</span>
                <StatusBadge status={t.status} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Delay modal */}
      <Modal open={delayOpen} onClose={() => setDelayOpen(false)} title="Report delay">
        <DelayForm tripId={trip.id} onDone={(msg) => { setDelayOpen(false); push({ kind: "success", title: "Delay reported", body: msg }); load(); }} />
      </Modal>

      {/* Emergency modal */}
      <Modal open={emgOpen} onClose={() => setEmgOpen(false)} title="🚨 Trigger emergency">
        <EmergencyForm tripId={trip.id} onDone={() => { setEmgOpen(false); push({ kind: "alert", title: "EMERGENCY triggered", body: "The transport office has been alerted with your live location." }); load(); }} />
      </Modal>

      {/* Exact occupancy modal */}
      <Modal open={occOpen} onClose={() => setOccOpen(false)} title="Set passenger count">
        <OccupancyForm tripId={trip.id} current={trip.occupancy} capacity={trip.capacity} onDone={(n) => { setTrip({ ...trip, occupancy: n }); setOccOpen(false); }} />
      </Modal>

      {/* End trip confirmation */}
      <Modal open={endOpen} onClose={() => setEndOpen(false)} title="End this trip?">
        <p className="text-sm text-slate-600 mb-4">
          GPS sharing will stop, students will see the trip as completed, and the bus returns to the available pool.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setEndOpen(false)}>Cancel</Button>
          <Button variant="success" className="flex-1" onClick={endTrip}>Confirm end trip</Button>
        </div>
      </Modal>
    </div>
  );
}

function DelayForm({ tripId, onDone }: { tripId: string; onDone: (msg: string) => void }) {
  const [reason, setReason] = useState("traffic");
  const [minutes, setMinutes] = useState(10);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-2">
        {DELAY_REASONS.map(([v, lbl]) => (
          <button
            key={v}
            onClick={() => setReason(v)}
            className={`text-left px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
              reason === v ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 hover:bg-slate-50"
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>
      <label className="block text-sm">
        <span className="font-medium text-slate-600">Estimated additional delay: {minutes} min</span>
        <input type="range" min={0} max={60} step={5} value={minutes} onChange={(e) => setMinutes(+e.target.value)} className="w-full mt-2" />
      </label>
      <Button className="w-full" onClick={() => api.post(`/trips/${tripId}/delay`, { reason, minutes }).then(() => onDone(`${minutes} min delay submitted`))}>
        Submit delay report
      </Button>
    </div>
  );
}

function EmergencyForm({ tripId, onDone }: { tripId: string; onDone: () => void }) {
  const [kind, setKind] = useState("vehicle");
  const [note, setNote] = useState("");
  return (
    <div className="space-y-4">
      <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">
        The transport office is notified immediately and your live location is highlighted on their map.
      </div>
      <div className="grid grid-cols-1 gap-2">
        {EMERGENCY_KINDS.map(([v, lbl]) => (
          <button
            key={v}
            onClick={() => setKind(v)}
            className={`text-left px-4 py-3 rounded-xl border text-sm font-medium ${
              kind === v ? "border-red-500 bg-red-50 text-red-700" : "border-slate-200 hover:bg-slate-50"
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>
      <input className={inputCls} placeholder="Optional note (what happened)" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button variant="danger" className="w-full py-3 text-base" onClick={() => api.post(`/trips/${tripId}/emergency`, { kind, note }).then(onDone)}>
        Trigger emergency now
      </Button>
    </div>
  );
}

function OccupancyForm({ tripId, current, capacity, onDone }: { tripId: string; current: number; capacity: number; onDone: (n: number) => void }) {
  const [count, setCount] = useState(current);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center gap-6 py-2">
        <Button variant="outline" onClick={() => setCount(Math.max(0, count - 5))} className="w-14 h-14 text-xl rounded-full">−5</Button>
        <div className="text-center">
          <p className="text-4xl font-extrabold text-slate-800">{count}</p>
          <p className="text-sm text-slate-400">of {capacity} seats</p>
        </div>
        <Button variant="outline" onClick={() => setCount(Math.min(capacity, count + 5))} className="w-14 h-14 text-xl rounded-full">+5</Button>
      </div>
      <Button className="w-full" onClick={() => api.post(`/trips/${tripId}/occupancy`, { count }).then(() => onDone(count))}>
        Save passenger count
      </Button>
    </div>
  );
}
