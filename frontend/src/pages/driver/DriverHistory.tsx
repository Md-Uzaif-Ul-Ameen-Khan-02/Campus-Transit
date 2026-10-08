import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Card, PageLoader, StatusBadge, EmptyState } from "../../components/ui";

export default function DriverHistory() {
  const [trips, setTrips] = useState<any[] | null>(null);

  useEffect(() => {
    api.get("/trips?mine=true").then(setTrips).catch(() => setTrips([]));
  }, []);

  if (trips == null) return <PageLoader label="Loading history…" />;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-800">My trip history</h1>
      {trips.length === 0 ? (
        <Card><EmptyState icon="🕘" title="No trips yet" /></Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400 border-b border-slate-100">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Departure</th>
                <th className="px-4 py-3">Route</th>
                <th className="px-4 py-3">Bus</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Peak pax</th>
              </tr>
            </thead>
            <tbody>
              {trips.slice(0, 60).map((t) => (
                <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium text-slate-600">{t.trip_date}</td>
                  <td className="px-4 py-2.5">{t.scheduled_start}</td>
                  <td className="px-4 py-2.5">{t.route_name}</td>
                  <td className="px-4 py-2.5">{t.bus_reg || "—"}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={t.status} /></td>
                  <td className="px-4 py-2.5">{t.occupancy || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
