import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Button, Card, PageLoader, SectionTitle, useToast, inputCls } from "../../components/ui";
import { PickupPickerMap } from "../../components/map";
import { fmtDistance } from "../../lib/format";

interface RouteT {
  id: string;
  name: string;
  code: string;
  color: string;
  length_m: number;
  student_count: number;
  description: string;
}

export default function MyRoutePage() {
  const { push } = useToast();
  const [summary, setSummary] = useState<any>(null);
  const [routes, setRoutes] = useState<RouteT[]>([]);
  const [loading, setLoading] = useState(true);
  const [picker, setPicker] = useState<{ lat: number; lng: number } | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [snapInfo, setSnapInfo] = useState<any>(null);

  const load = useCallback(async () => {
    const [s, rs] = await Promise.all([api.get("/student/summary"), api.get("/routes")]);
    setSummary(s);
    setRoutes(rs);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch((e) => push({ kind: "error", title: "Load failed", body: e.message }));
  }, [load, push]);

  async function selectRoute(routeId: string) {
    setBusy(true);
    try {
      const s = await api.post("/student/route", { route_id: routeId });
      setSummary(s);
      setPicker(null);
      setSnapInfo(null);
      push({ kind: "success", title: `Route saved: ${s.route?.name ?? "none"}`, body: "Now pick your pickup point." });
    } catch (e: any) {
      push({ kind: "error", title: "Could not save route", body: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function handlePick(lat: number, lng: number) {
    setPicker({ lat, lng });
    try {
      const info = await api.post(`/routes/${summary.route.id}/snap`, { lat, lng });
      setSnapInfo(info);
    } catch {
      setSnapInfo(null);
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      push({ kind: "error", title: "Geolocation unavailable", body: "Your browser does not support location." });
      return;
    }
    push({ kind: "info", title: "Finding your location…" });
    navigator.geolocation.getCurrentPosition(
      (pos) => handlePick(pos.coords.latitude, pos.coords.longitude),
      () => push({ kind: "error", title: "Unable to obtain your location", body: "Please enable location permission, or drop a pin on the map instead." }),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function savePickup() {
    if (!picker) return;
    setBusy(true);
    try {
      const res = await api.post("/student/pickup", { lat: picker.lat, lng: picker.lng, label: label || "My pickup point" });
      setSummary(res);
      setSnapInfo(null);
      push({
        kind: "success",
        title: "Pickup point saved",
        body: `Snapped ${Math.round(res.snap.offRouteM)} m from the route · position ${(res.snap.routePosM / 1000).toFixed(2)} km`,
      });
    } catch (e: any) {
      push({ kind: "error", title: "Pickup rejected", body: e.message });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <PageLoader label="Loading routes…" />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">My route & pickup</h1>
        <p className="text-sm text-slate-500">Pick your route, then choose exactly where you board — any point along the way.</p>
      </div>

      <Card className="p-4">
        <SectionTitle>Your selection</SectionTitle>
        {summary.route ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="w-3 h-3 rounded-full" style={{ background: summary.route.color }} />
            <span className="font-semibold text-slate-800">{summary.route.name}</span>
            <span className="text-sm text-slate-400">{fmtDistance(summary.route.lengthM)} route</span>
            {summary.pickup ? (
              <span className="text-sm bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-3 py-1 font-medium">
                📍 {summary.pickup.label} · {(summary.pickup.routePosM / 1000).toFixed(2)} km along route
              </span>
            ) : (
              <span className="text-sm bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-3 py-1 font-medium">No pickup point yet</span>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No route selected yet — choose one below.</p>
        )}
      </Card>

      <Card className="p-4">
        <SectionTitle>Available routes</SectionTitle>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {routes.map((r) => (
            <button
              key={r.id}
              disabled={busy}
              onClick={() => selectRoute(r.id)}
              className={`text-left border rounded-2xl p-4 transition-all hover:shadow-md ${
                summary.route?.id === r.id ? "border-brand-500 bg-brand-50/50 ring-1 ring-brand-500" : "border-slate-200 hover:border-brand-300"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ background: r.color }} />
                <span className="font-bold text-slate-800">{r.name}</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">{r.code} · {fmtDistance(r.length_m)} · {r.student_count} students</p>
              <p className="text-xs text-slate-500 mt-1 line-clamp-2">{r.description}</p>
              {summary.route?.id === r.id && <p className="text-xs font-bold text-brand-600 mt-2">✓ Selected</p>}
            </button>
          ))}
        </div>
      </Card>

      {summary.route && (
        <Card className="p-4">
          <SectionTitle
            right={
              <Button variant="outline" onClick={useMyLocation} className="text-xs">
                📡 Use my current location
              </Button>
            }
          >
            Choose your pickup point
          </SectionTitle>
          <p className="text-xs text-slate-400 mb-3">
            Tap the map to drop a pin anywhere near the route line. It will snap to the closest point on the route.
          </p>
          <PickupPickerMap
            geometry={summary.route.geometry}
            initial={picker}
            onPick={handlePick}
            color={summary.route.color}
          />
          {picker && (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-slate-600">Pin at</span>
                <span className="font-mono text-xs bg-slate-100 rounded px-2 py-0.5">
                  {picker.lat.toFixed(5)}, {picker.lng.toFixed(5)}
                </span>
                {snapInfo && (
                  <span className={`text-xs font-semibold rounded-full px-2 py-0.5 border ${
                    snapInfo.valid ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-600 border-red-200"
                  }`}>
                    {snapInfo.valid
                      ? `${fmtDistance(snapInfo.offRouteM)} from route · km ${(snapInfo.routePosM / 1000).toFixed(2)}`
                      : `${fmtDistance(snapInfo.offRouteM)} from route — too far`}
                  </span>
                )}
                {snapInfo?.nearestLandmark && (
                  <span className="text-xs text-slate-400">near {snapInfo.nearestLandmark.name}</span>
                )}
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  className={inputCls + " flex-1"}
                  placeholder="Label this place (e.g. Home gate, Hero showroom)"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
                <Button onClick={savePickup} loading={busy} disabled={!snapInfo?.valid}>Save pickup point</Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
