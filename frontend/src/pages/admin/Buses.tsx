import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Badge, Button, Card, Field, Modal, PageLoader, StatusBadge, inputCls, useToast, EmptyState } from "../../components/ui";

const EMPTY = { registration_number: "", display_name: "", capacity: 45, vehicle_type: "standard", status: "available", active: true, is_ev: false, accessible: false, notes: "" };

export default function BusesPage() {
  const { push } = useToast();
  const [buses, setBuses] = useState<any[] | null>(null);
  const [edit, setEdit] = useState<any | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [history, setHistory] = useState<{ bus: any; rows: any[] } | null>(null);

  const load = useCallback(async () => {
    setBuses(await api.get("/buses"));
  }, []);

  useEffect(() => { load().catch(() => setBuses([])); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (isNew) await api.post("/buses", edit);
      else await api.patch(`/buses/${edit.id}`, edit);
      push({ kind: "success", title: isNew ? "Bus added" : "Bus updated" });
      setEdit(null);
      load();
    } catch (e: any) {
      push({ kind: "error", title: "Save failed", body: e.message });
    }
  }

  async function setStatus(b: any, status: string) {
    try {
      await api.post(`/buses/${b.id}/status`, { status });
      push({ kind: "success", title: `${b.registration_number} → ${status}` });
      load();
    } catch (e: any) {
      push({ kind: "error", title: "Status change failed", body: e.message });
    }
  }

  async function showHistory(b: any) {
    const rows = await api.get(`/buses/${b.id}/history`);
    setHistory({ bus: b, rows });
  }

  if (buses == null) return <PageLoader label="Loading fleet…" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Buses</h1>
          <p className="text-sm text-slate-500">{buses.length} in fleet · buses are assigned to trips, never to routes</p>
        </div>
        <Button onClick={() => { setEdit({ ...EMPTY }); setIsNew(true); }}>+ Add bus</Button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {buses.map((b) => (
          <Card key={b.id} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-bold text-slate-800">{b.display_name || b.registration_number}</p>
                <p className="text-xs text-slate-400 font-mono">{b.registration_number}</p>
              </div>
              <StatusBadge status={b.status} />
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3">
              <Badge>{b.capacity} seats</Badge>
              <Badge>{b.vehicle_type}</Badge>
              {b.is_ev && <Badge tone="bg-emerald-100 text-emerald-700 border-emerald-200">EV</Badge>}
              {b.accessible && <Badge tone="bg-blue-100 text-blue-700 border-blue-200">♿</Badge>}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3">
              <Button variant="outline" className="text-xs px-2.5 py-1.5" onClick={() => { setEdit({ ...b }); setIsNew(false); }}>Edit</Button>
              <Button variant="outline" className="text-xs px-2.5 py-1.5" onClick={() => showHistory(b)}>History</Button>
              {b.status !== "maintenance" && b.active && (
                <Button variant="outline" className="text-xs px-2.5 py-1.5" onClick={() => setStatus(b, "maintenance")}>Maintenance</Button>
              )}
              {b.status === "maintenance" && (
                <Button variant="outline" className="text-xs px-2.5 py-1.5" onClick={() => setStatus(b, "available")}>Back to service</Button>
              )}
              {b.active && b.status !== "maintenance" && (
                <Button variant="ghost" className="text-xs px-2.5 py-1.5 text-red-600" onClick={() => setStatus(b, "inactive")}>Deactivate</Button>
              )}
              {!b.active && (
                <Button variant="ghost" className="text-xs px-2.5 py-1.5 text-emerald-600" onClick={() => setStatus(b, "available")}>Reactivate</Button>
              )}
            </div>
          </Card>
        ))}
        {buses.length === 0 && (
          <Card className="sm:col-span-2 lg:col-span-3"><EmptyState icon="🚌" title="No buses yet" hint="Add your first bus to get started." /></Card>
        )}
      </div>

      {/* Edit/create modal */}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={isNew ? "Add bus" : `Edit ${edit?.registration_number}`}>
        {edit && (
          <form onSubmit={save} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Registration number"><input className={inputCls} required value={edit.registration_number} onChange={(e) => setEdit({ ...edit, registration_number: e.target.value })} placeholder="KA-01-1234" /></Field>
              <Field label="Display name"><input className={inputCls} value={edit.display_name} onChange={(e) => setEdit({ ...edit, display_name: e.target.value })} placeholder="Bus 102" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Capacity"><input type="number" min={1} max={200} className={inputCls} value={edit.capacity} onChange={(e) => setEdit({ ...edit, capacity: +e.target.value })} /></Field>
              <Field label="Vehicle type">
                <select className={inputCls} value={edit.vehicle_type} onChange={(e) => setEdit({ ...edit, vehicle_type: e.target.value })}>
                  {["standard", "mini", "ev", "accessible"].map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Notes"><input className={inputCls} value={edit.notes || ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={!!edit.is_ev} onChange={(e) => setEdit({ ...edit, is_ev: e.target.checked })} /> Electric</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={!!edit.accessible} onChange={(e) => setEdit({ ...edit, accessible: e.target.checked })} /> Wheelchair accessible</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label>
            </div>
            <Button type="submit" className="w-full">{isNew ? "Add bus" : "Save changes"}</Button>
          </form>
        )}
      </Modal>

      {/* History modal */}
      <Modal open={!!history} onClose={() => setHistory(null)} title={`Trip history — ${history?.bus?.registration_number || ""}`} wide>
        {history && (history.rows.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">No trips recorded for this bus yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-slate-400 border-b"><th className="px-2 py-2">Date</th><th className="px-2 py-2">Route</th><th className="px-2 py-2">Driver</th><th className="px-2 py-2">Status</th></tr></thead>
            <tbody>
              {history.rows.map((r) => (
                <tr key={r.tripId} className="border-b border-slate-50">
                  <td className="px-2 py-2">{r.date} {r.scheduled}</td>
                  <td className="px-2 py-2">{r.route}</td>
                  <td className="px-2 py-2">{r.driver}</td>
                  <td className="px-2 py-2"><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </Modal>
    </div>
  );
}
