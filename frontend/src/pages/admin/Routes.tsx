import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { Badge, Button, Card, Field, Modal, PageLoader, inputCls, useToast, EmptyState } from "../../components/ui";
import { fmtDistance } from "../../lib/format";
import L from "leaflet";

export default function RoutesPage() {
  const { push } = useToast();
  const [routes, setRoutes] = useState<any[] | null>(null);
  const [edit, setEdit] = useState<any | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [distribution, setDistribution] = useState<{ route: any; points: any[] } | null>(null);

  const load = useCallback(async () => {
    setRoutes(await api.get("/routes?include_inactive=true"));
  }, []);

  useEffect(() => { load().catch(() => setRoutes([])); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      const body = {
        name: edit.name, code: edit.code, description: edit.description, direction: edit.direction || "outbound",
        color: edit.color, active: edit.active, geometry: edit.geometry || [], landmarks: edit.landmarks || [],
        standard_duration_min: +edit.standard_duration_min || 0,
      };
      if (isNew) await api.post("/routes", body);
      else await api.put(`/routes/${edit.id}`, body);
      push({ kind: "success", title: isNew ? "Route created" : "Route saved" });
      setEdit(null);
      load();
    } catch (e: any) {
      push({ kind: "error", title: "Save failed", body: e.message });
    }
  }

  async function showDistribution(r: any) {
    const points = await api.get(`/admin/pickup-distribution?route_id=${r.id}`);
    setDistribution({ route: r, points });
  }

  if (routes == null) return <PageLoader label="Loading routes…" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Routes</h1>
          <p className="text-sm text-slate-500">Geographic paths — buses and drivers attach via trips, never permanently.</p>
        </div>
        <Button onClick={() => { setEdit({ name: "", code: "", description: "", color: "#2563eb", direction: "outbound", active: true, geometry: [], landmarks: [], standard_duration_min: 45 }); setIsNew(true); }}>
          + Create route
        </Button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {routes.map((r) => (
          <Card key={r.id} className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded-full border-2 border-white shadow" style={{ background: r.color }} />
                <div>
                  <p className="font-bold text-slate-800">{r.name}</p>
                  <p className="text-xs text-slate-400">{r.code || "no code"} · {r.direction}</p>
                </div>
              </div>
              {!r.active && <Badge tone="bg-slate-200 text-slate-500 border-slate-300">inactive</Badge>}
            </div>
            <p className="text-xs text-slate-500 mt-2 line-clamp-2">{r.description}</p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              <Badge>{fmtDistance(r.length_m)}</Badge>
              <Badge>{r.geometry?.length || 0} points</Badge>
              <Badge>{r.student_count} students</Badge>
              {r.standard_duration_min > 0 && <Badge>~{r.standard_duration_min} min</Badge>}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3">
              <Button variant="outline" className="text-xs px-2.5 py-1.5" onClick={() => { setEdit({ ...r, landmarks: r.landmarks || [] }); setIsNew(false); }}>
                {r.geometry?.length ? "Edit & draw" : "Draw geometry"}
              </Button>
              <Button variant="outline" className="text-xs px-2.5 py-1.5" onClick={() => showDistribution(r)}>Demand</Button>
            </div>
          </Card>
        ))}
        {routes.length === 0 && <Card className="sm:col-span-2 lg:col-span-3"><EmptyState icon="🛣️" title="No routes yet" hint="Create a route, then draw its path on the map." /></Card>}
      </div>

      {edit && (
        <RouteEditor route={edit} isNew={isNew} onClose={() => setEdit(null)} onSave={save} onChange={setEdit} />
      )}

      <Modal open={!!distribution} onClose={() => setDistribution(null)} title={`Pickup demand — ${distribution?.route.name || ""}`} wide>
        {distribution && (
          distribution.points.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">No students have saved a pickup on this route yet.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-slate-500">{distribution.points.length} students board along this route:</p>
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs uppercase text-slate-400 border-b"><th className="px-2 py-2">Position</th><th className="px-2 py-2">Label</th><th className="px-2 py-2">Coordinates</th></tr></thead>
                  <tbody>
                    {distribution.points.sort((a, b) => a.routePosM - b.routePosM).map((p, i) => (
                      <tr key={i} className="border-b border-slate-50">
                        <td className="px-2 py-2 font-semibold">{(p.routePosM / 1000).toFixed(2)} km</td>
                        <td className="px-2 py-2">{p.label}</td>
                        <td className="px-2 py-2 font-mono text-xs text-slate-400">{p.lat.toFixed(5)}, {p.lng.toFixed(5)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        )}
      </Modal>
    </div>
  );
}

function RouteEditor({ route, isNew, onClose, onSave, onChange }: any) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const line = useRef<L.Polyline | null>(null);
  const dots = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current).setView([12.9612, 77.6256], 12);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(m);
    dots.current = L.layerGroup().addTo(m);
    map.current = m;
    redraw(route.geometry || []);
    setTimeout(() => m.invalidateSize(), 50);
    return () => { m.remove(); map.current = null; };
  }, []);

  function redraw(pts: [number, number][]) {
    const m = map.current;
    if (!m) return;
    if (line.current) line.current.remove();
    dots.current?.clearLayers();
    if (pts.length >= 2) {
      line.current = L.polyline(pts, { color: route.color || "#2563eb", weight: 4 }).addTo(m);
      m.fitBounds(line.current.getBounds().pad(0.2));
    }
    pts.forEach((p, i) => {
      L.circleMarker(p, { radius: 5, color: "#fff", weight: 2, fillColor: route.color || "#2563eb", fillOpacity: 1 })
        .bindTooltip(`#${i + 1}`, { permanent: false })
        .on("click", () => {
          const next = (route.geometry || []).filter((_: any, j: number) => j !== i);
          onChange({ ...route, geometry: next });
          redraw(next);
        })
        .addTo(dots.current!);
    });
  }

  function addPoint(lat: number, lng: number) {
    const next = [...(route.geometry || []), [lat, lng]];
    onChange({ ...route, geometry: next });
    redraw(next as [number, number][]);
  }

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const handler = (e: L.LeafletMouseEvent) => addPoint(e.latlng.lat, e.latlng.lng);
    m.on("click", handler);
    return () => {
      m.off("click", handler);
    };
  });

  function undo() {
    const next = (route.geometry || []).slice(0, -1);
    onChange({ ...route, geometry: next });
    redraw(next as [number, number][]);
  }

  function clearAll() {
    onChange({ ...route, geometry: [] });
    redraw([]);
  }

  return (
    <Modal open onClose={onClose} title={isNew ? "Create route" : `Edit ${route.name}`} wide>
      <form onSubmit={onSave} className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Name"><input className={inputCls} required value={route.name} onChange={(e) => onChange({ ...route, name: e.target.value })} /></Field>
          <Field label="Code"><input className={inputCls} value={route.code || ""} onChange={(e) => onChange({ ...route, code: e.target.value })} /></Field>
          <Field label="Color"><input type="color" className={inputCls + " h-[38px] p-1"} value={route.color || "#2563eb"} onChange={(e) => onChange({ ...route, color: e.target.value })} /></Field>
          <Field label="Duration (min)"><input type="number" min={0} className={inputCls} value={route.standard_duration_min || 0} onChange={(e) => onChange({ ...route, standard_duration_min: e.target.value })} /></Field>
        </div>
        <Field label="Description"><input className={inputCls} value={route.description || ""} onChange={(e) => onChange({ ...route, description: e.target.value })} /></Field>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-slate-600">
              Click the map to append route points · {route.geometry?.length || 0} points · click a dot to remove it
            </p>
            <div className="flex gap-1.5">
              <Button type="button" variant="outline" className="text-xs px-2 py-1" onClick={undo}>Undo</Button>
              <Button type="button" variant="outline" className="text-xs px-2 py-1" onClick={clearAll}>Clear</Button>
            </div>
          </div>
          <div ref={el} style={{ height: "340px" }} className="rounded-lg overflow-hidden" />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={route.active} onChange={(e) => onChange({ ...route, active: e.target.checked })} /> Route active
        </label>
        <Button type="submit" className="w-full">{isNew ? "Create route" : "Save route"}</Button>
      </form>
    </Modal>
  );
}
