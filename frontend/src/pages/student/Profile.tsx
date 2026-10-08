import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../auth";
import { Card, PageLoader, SectionTitle } from "../../components/ui";

export default function Profile() {
  const { name, email, role, userId } = useAuth();
  const [summary, setSummary] = useState<any>(null);
  const [notify, setNotify] = useState(true);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const s = await api.get("/student/summary");
      setSummary(s);
      setNotify(s.notifyEnabled);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (role === "student") load();
    else setLoading(false);
  }, [role, load]);

  async function toggle() {
    const next = !notify;
    setNotify(next);
    await api.post("/student/notifications/toggle", { enabled: next });
  }

  if (loading) return <PageLoader />;

  return (
    <div className="space-y-5 max-w-2xl">
      <h1 className="text-xl font-bold text-slate-800">Profile</h1>

      <Card className="p-5">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-brand-600 text-white grid place-items-center text-xl font-bold">
            {name?.[0]?.toUpperCase() || "?"}
          </div>
          <div>
            <p className="font-bold text-slate-800 text-lg">{name}</p>
            <p className="text-sm text-slate-500">{email}</p>
            <p className="text-xs text-slate-400 mt-0.5">{role} · {userId}</p>
          </div>
        </div>
      </Card>

      {role === "student" && (
        <Card className="p-5">
          <SectionTitle>Commute settings</SectionTitle>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Route</span>
              <span className="font-semibold text-slate-700">{summary?.route?.name || "Not set"}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Pickup point</span>
              <span className="font-semibold text-slate-700">
                {summary?.pickup ? `${summary.pickup.label} (${(summary.pickup.routePosM / 1000).toFixed(2)} km)` : "Not set"}
              </span>
            </div>
          </div>
          <label className="flex items-center justify-between mt-4 cursor-pointer">
            <div>
              <p className="font-medium text-slate-700 text-sm">Approach notifications</p>
              <p className="text-xs text-slate-400">Get alerted when the bus is 10 min, 3 min and 1 min from your pickup.</p>
            </div>
            <button
              role="switch"
              aria-checked={notify}
              onClick={toggle}
              className={`relative w-11 h-6 rounded-full transition-colors ${notify ? "bg-emerald-500" : "bg-slate-300"}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${notify ? "translate-x-5" : ""}`} />
            </button>
          </label>
        </Card>
      )}

      <Card className="p-5">
        <SectionTitle>Privacy</SectionTitle>
        <p className="text-sm text-slate-500 leading-relaxed">
          Location is collected from the driver's phone only while a trip is active, and used solely to show
          live bus positions and your personalized ETA. Tracking stops automatically when the trip ends.
          Your pickup point is visible only to the transport office for planning.
        </p>
      </Card>
    </div>
  );
}
