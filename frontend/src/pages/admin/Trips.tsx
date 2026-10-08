import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Button, Card, Field, Modal, PageLoader, StatusBadge, inputCls, useToast, EmptyState } from "../../components/ui";
import { fmtAgo } from "../../lib/format";

export default function TripsPage() {
  const { push } = useToast();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [trips, setTrips] = useState<any[] | null>(null);
  const [routes, setRoutes] = useState<any[]>([]);
  const [buses, setBuses] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setTrips(await api.get(`/trips?date=${date}`));
  }, [date]);

  useEffect(() => {
    load().catch(() => setTrips([]));
  }, [load]);

  useEffect(() => {
    api.get("/routes").then(setRoutes).catch(() => {});
    api.get("/buses").then(setBuses).catch(() => {});
    api.get("/drivers").then(setDrivers).catch(() => {});
  }, []);

  async function cancel(t: any) {
    if (!confirm(`Cancel the ${t.scheduled_start} trip on ${t.route_name}? Students will be notified.`)) return;
    try {
      await api.post(`/trips/${t.id}/cancel`, { reason: "Cancelled from trips page" });
      push({ kind: "alert", title: "Trip cancelled", body: "Students were notified." });
      load();
    } catch (e: any) {
      push({ kind: "error", title: "Cancel failed", body: e.message });
    }
  }

  if (trips == null) return <PageLoader label="Loading trips…" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Trips & assignments</h1>
          <p className="text-sm text-slate-500">Dynamic daily assignment of buses and drivers to routes.</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" className={inputCls + " w-auto"} value={date} onChange={(e) => setDate(e.target.value)} />
          <Button onClick={() => setCreateOpen(true)}>+ Create trip</Button>
        </div>
      </div>

      <Card className="overflow-x-auto">
        {trips.length === 0 ? (
          <EmptyState icon="🗓️" title="No trips on this date" hint="Create the first assignment for this day." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400 border-b border-slate-100">
                <th className="px-4 py-3">Departure</th>
                <th className="px-4 py-3">Route</th>
                <th className="px-4 py-3">Bus</th>
                <th className="px-4 py-3">Driver</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">GPS</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {trips.map((t) => (
                <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-bold text-slate-700">{t.scheduled_start}<span className="block text-xs font-normal text-slate-400">→ {t.scheduled_end || "?"}</span></td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ background: t.route_color }} />
                      <span className="font-medium text-slate-700">{t.route_name}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5">{t.bus_reg || <span className="text-slate-400">unassigned</span>}</td>
                  <td className="px-4 py-2.5">{t.driver_name || <span className="text-slate-400">unassigned</span>}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={t.status} /></td>
                  <td className="px-4 py-2.5 text-xs text-slate-400">{t.last_fix_at ? fmtAgo(t.last_fix_at) : "—"}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {t.status !== "completed" && t.status !== "cancelled" && (
                      <Button variant="ghost" className="text-red-600 hover:bg-red-50 text-xs px-2 py-1" onClick={() => cancel(t)}>
                        Cancel
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <CreateTripModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        date={date}
        routes={routes}
        buses={buses}
        drivers={drivers}
        onCreated={(msg) => { setCreateOpen(false); push({ kind: "success", title: "Trip created", body: msg }); load(); }}
        onError={(msg) => push({ kind: "error", title: "Validation failed", body: msg })}
      />
    </div>
  );
}

function CreateTripModal({
  open, onClose, date, routes, buses, drivers, onCreated, onError,
}: {
  open: boolean;
  onClose: () => void;
  date: string;
  routes: any[];
  buses: any[];
  drivers: any[];
  onCreated: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState({ route_id: "", bus_id: "", driver_id: "", trip_date: date, scheduled_start: "07:30", scheduled_end: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => setForm((f) => ({ ...f, trip_date: date })), [date]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body: any = {
        route_id: form.route_id,
        trip_date: form.trip_date,
        scheduled_start: form.scheduled_start,
        scheduled_end: form.scheduled_end || undefined,
        status: form.bus_id && form.driver_id ? "assigned" : "scheduled",
      };
      if (form.bus_id) body.bus_id = form.bus_id;
      if (form.driver_id) body.driver_id = form.driver_id;
      await api.post("/trips", body);
      onCreated(`${form.scheduled_start} assignment saved`);
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const usableBuses = buses.filter((b: any) => b.active && !["maintenance", "unavailable", "inactive"].includes(b.status));
  const usableDrivers = drivers.filter((d: any) => d.active && !["unavailable"].includes(d.status));

  return (
    <Modal open={open} onClose={onClose} title="Create trip assignment">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Route">
          <select className={inputCls} required value={form.route_id} onChange={(e) => setForm({ ...form, route_id: e.target.value })}>
            <option value="">Select route…</option>
            {routes.filter((r: any) => r.active).map((r: any) => <option key={r.id} value={r.id}>{r.name} ({r.code})</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <input type="date" className={inputCls} required value={form.trip_date} onChange={(e) => setForm({ ...form, trip_date: e.target.value })} />
          </Field>
          <Field label="Departure time">
            <input type="time" className={inputCls} required value={form.scheduled_start} onChange={(e) => setForm({ ...form, scheduled_start: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bus" hint="Optional — can be assigned later">
            <select className={inputCls} value={form.bus_id} onChange={(e) => setForm({ ...form, bus_id: e.target.value })}>
              <option value="">Unassigned</option>
              {usableBuses.map((b: any) => <option key={b.id} value={b.id}>{b.display_name || b.registration_number} · {b.capacity} seats {b.status !== "available" ? `(${b.status})` : ""}</option>)}
            </select>
          </Field>
          <Field label="Driver" hint="Optional — can be assigned later">
            <select className={inputCls} value={form.driver_id} onChange={(e) => setForm({ ...form, driver_id: e.target.value })}>
              <option value="">Unassigned</option>
              {usableDrivers.map((d: any) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Arrival time" hint="Optional — estimated from route duration if omitted">
          <input type="time" className={inputCls} value={form.scheduled_end} onChange={(e) => setForm({ ...form, scheduled_end: e.target.value })} />
        </Field>
        <p className="text-xs text-slate-400">
          Overlapping bus or driver assignments for the same day are rejected automatically.
        </p>
        <Button type="submit" loading={busy} className="w-full">Create assignment</Button>
      </form>
    </Modal>
  );
}
