import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Button, Card, Field, PageLoader, inputCls, useToast } from "../../components/ui";

const FIELDS: { key: string; label: string; hint: string; min: number; max: number; step?: number }[] = [
  { key: "location_interval_sec", label: "GPS update interval (s)", hint: "How often driver phones push location while a trip is active.", min: 1, max: 30 },
  { key: "location_stale_after_sec", label: "Stale after (s)", hint: "If no fix arrives within this window, the bus shows as stale instead of live.", min: 10, max: 120 },
  { key: "location_max_accuracy_m", label: "Max GPS accuracy error (m)", hint: "Fixes less accurate than this are rejected.", min: 20, max: 500 },
  { key: "location_max_speed_kmh", label: "Max plausible speed (km/h)", hint: "Rejects fixes implying impossible speed or jumps.", min: 40, max: 200 },
  { key: "eta_default_speed_kmh", label: "Fallback ETA speed (km/h)", hint: "Used when no live/historical data exists.", min: 5, max: 60 },
  { key: "eta_min_speed_kmh", label: "Minimum ETA speed (km/h)", hint: "Lower bound so ETAs never balloon unreasonably.", min: 2, max: 20 },
  { key: "occupancy_low_max_pct", label: "LOW occupancy up to (%)", hint: "Seats occupied percentage bands.", min: 10, max: 60 },
  { key: "occupancy_high_min_pct", label: "HIGH occupancy from (%)", hint: "", min: 50, max: 95 },
  { key: "pickup_max_snap_distance_m", label: "Pickup snap tolerance (m)", hint: "Max distance from route to accept a student pickup point.", min: 100, max: 2000 },
];

export default function SettingsPage() {
  const { push } = useToast();
  const [s, setS] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setS(await api.get("/settings"));
  }, []);

  useEffect(() => { load().catch(() => {}); }, [load]);

  async function save() {
    setBusy(true);
    try {
      await api.put("/settings", s);
      push({ kind: "success", title: "Settings saved", body: "Changes apply to new GPS fixes and ETAs immediately." });
    } catch (e: any) {
      push({ kind: "error", title: "Save failed", body: e.message });
    } finally {
      setBusy(false);
    }
  }

  if (!s) return <PageLoader label="Loading settings…" />;

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-slate-800">System settings</h1>
        <p className="text-sm text-slate-500">Runtime-tunable thresholds — no restart needed.</p>
      </div>

      <Card className="p-5">
        <div className="grid sm:grid-cols-2 gap-4">
          {FIELDS.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint}>
              <input
                type="number"
                className={inputCls}
                min={f.min}
                max={f.max}
                step={f.step || 1}
                value={s[f.key]}
                onChange={(e) => setS({ ...s, [f.key]: +e.target.value })}
              />
            </Field>
          ))}
        </div>
        <Button className="mt-4" onClick={save} loading={busy}>Save settings</Button>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold text-slate-700 mb-2">About these knobs</h2>
        <ul className="text-sm text-slate-500 list-disc pl-5 space-y-1.5">
          <li>GPS interval trades battery/data on driver phones against tracking smoothness.</li>
          <li>Stale window drives the student UI: after it elapses, positions show "last updated X ago" instead of LIVE.</li>
          <li>ETA speed bounds keep predictions conservative in traffic and prevent absurd estimates in GPS dead zones.</li>
          <li>Occupancy bands map passenger counts to LOW / MEDIUM / HIGH badges shown to students.</li>
          <li>Pickup tolerance protects route integrity: students can't anchor themselves far away from the actual path.</li>
        </ul>
      </Card>
    </div>
  );
}
