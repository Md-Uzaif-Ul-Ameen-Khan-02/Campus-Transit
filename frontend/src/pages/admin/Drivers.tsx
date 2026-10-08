import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Badge, Button, Card, Field, Modal, PageLoader, StatusBadge, inputCls, useToast, EmptyState } from "../../components/ui";

const EMPTY = { full_name: "", email: "", phone: "", password: "", employee_code: "", license_no: "", active: true, status: "available" };

export default function DriversPage() {
  const { push } = useToast();
  const [drivers, setDrivers] = useState<any[] | null>(null);
  const [edit, setEdit] = useState<any | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [history, setHistory] = useState<{ drv: any; rows: any[] } | null>(null);

  const load = useCallback(async () => {
    setDrivers(await api.get("/drivers"));
  }, []);

  useEffect(() => { load().catch(() => setDrivers([])); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (isNew) await api.post("/drivers", edit);
      else await api.patch(`/drivers/${edit.id}`, edit);
      push({ kind: "success", title: isNew ? "Driver added" : "Driver updated", body: isNew ? "Share the credentials with the driver for first login." : undefined });
      setEdit(null);
      load();
    } catch (e: any) {
      push({ kind: "error", title: "Save failed", body: e.message });
    }
  }

  async function showHistory(d: any) {
    const rows = await api.get(`/drivers/${d.id}/history`);
    setHistory({ drv: d, rows });
  }

  if (drivers == null) return <PageLoader label="Loading drivers…" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Drivers</h1>
          <p className="text-sm text-slate-500">{drivers.filter((d) => d.active).length} active roster</p>
        </div>
        <Button onClick={() => { setEdit({ ...EMPTY }); setIsNew(true); }}>+ Add driver</Button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {drivers.map((d) => (
          <Card key={d.id} className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-100 grid place-items-center text-lg">🧑‍✈️</div>
                <div>
                  <p className="font-bold text-slate-800">{d.full_name}</p>
                  <p className="text-xs text-slate-400">{d.email}</p>
                </div>
              </div>
              <StatusBadge status={d.status} />
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {d.employee_code && <Badge>EMP {d.employee_code}</Badge>}
              {d.phone && <Badge>{d.phone}</Badge>}
              {!d.active && <Badge tone="bg-red-100 text-red-600 border-red-200">deactivated</Badge>}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3">
              <Button variant="outline" className="text-xs px-2.5 py-1.5" onClick={() => { setEdit({ ...d, password: "" }); setIsNew(false); }}>Edit</Button>
              <Button variant="outline" className="text-xs px-2.5 py-1.5" onClick={() => showHistory(d)}>History</Button>
              <Button
                variant="ghost"
                className={`text-xs px-2.5 py-1.5 ${d.active ? "text-red-600" : "text-emerald-600"}`}
                onClick={async () => {
                  try {
                    await api.patch(`/drivers/${d.id}`, { ...d, password: "", active: !d.active });
                    load();
                  } catch (e: any) { push({ kind: "error", title: "Failed", body: e.message }); }
                }}
              >
                {d.active ? "Deactivate" : "Activate"}
              </Button>
            </div>
          </Card>
        ))}
        {drivers.length === 0 && (
          <Card className="sm:col-span-2 lg:col-span-3"><EmptyState icon="🧑‍✈️" title="No drivers yet" /></Card>
        )}
      </div>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={isNew ? "Add driver" : `Edit ${edit?.full_name}`}>
        {edit && (
          <form onSubmit={save} className="space-y-3">
            <Field label="Full name"><input className={inputCls} required value={edit.full_name} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Email (login)"><input type="email" className={inputCls} required value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
              <Field label="Phone"><input className={inputCls} value={edit.phone || ""} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Employee code"><input className={inputCls} value={edit.employee_code || ""} onChange={(e) => setEdit({ ...edit, employee_code: e.target.value })} /></Field>
              <Field label="License no."><input className={inputCls} value={edit.license_no || ""} onChange={(e) => setEdit({ ...edit, license_no: e.target.value })} /></Field>
            </div>
            <Field label={isNew ? "Password" : "Reset password"} hint={isNew ? "Shown once — share securely" : "Leave blank to keep current"}>
              <input className={inputCls} type="text" value={edit.password || ""} onChange={(e) => setEdit({ ...edit, password: e.target.value })} placeholder={isNew ? "driver@123" : "••••••"} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active roster
            </label>
            <Button type="submit" className="w-full">{isNew ? "Add driver" : "Save changes"}</Button>
          </form>
        )}
      </Modal>

      <Modal open={!!history} onClose={() => setHistory(null)} title={`Trip history — ${history?.drv?.full_name || ""}`} wide>
        {history && (history.rows.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">No trips recorded for this driver yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-slate-400 border-b"><th className="px-2 py-2">Date</th><th className="px-2 py-2">Route</th><th className="px-2 py-2">Bus</th><th className="px-2 py-2">Status</th></tr></thead>
            <tbody>
              {history.rows.map((r) => (
                <tr key={r.tripId} className="border-b border-slate-50">
                  <td className="px-2 py-2">{r.date} {r.scheduled}</td>
                  <td className="px-2 py-2">{r.route}</td>
                  <td className="px-2 py-2">{r.bus}</td>
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
