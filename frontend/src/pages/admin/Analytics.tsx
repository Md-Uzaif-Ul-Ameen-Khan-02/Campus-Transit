import { useEffect, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api } from "../../lib/api";
import { Card, PageLoader, SectionTitle, Stat } from "../../components/ui";

const COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#be185d", "#65a30d"];

export default function AnalyticsPage() {
  const [ov, setOv] = useState<any>(null);
  const [routes, setRoutes] = useState<any[]>([]);
  const [delays, setDelays] = useState<any>(null);
  const [occ, setOcc] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    api.get("/analytics/overview?days=14").then(setOv).catch(() => {});
    api.get("/analytics/routes").then(setRoutes).catch(() => {});
    api.get("/analytics/delays?days=14").then(setDelays).catch(() => {});
    api.get("/analytics/occupancy?days=14").then(setOcc).catch(() => {});
    api.get("/analytics/assignment-history?limit=50").then(setHistory).catch(() => {});
  }, []);

  if (!ov) return <PageLoader label="Crunching transport data…" />;

  const tripsPerDay = (ov.tripsPerDay || []).map(([d, c]: [string, number]) => ({ date: d.slice(5), trips: c }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Analytics</h1>
        <p className="text-sm text-slate-500">Last {ov.windowDays} days of transport operations</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label="Total trips" value={ov.totalTrips} />
        <Stat label="Completed" value={ov.completedTrips} />
        <Stat label="On-time" value={`${ov.onTimePct}%`} tone={ov.onTimePct > 85 ? "text-emerald-600" : "text-amber-600"} />
        <Stat label="Avg delay" value={`${ov.avgDelayMin}m`} />
        <Stat label="Max delay" value={`${ov.maxDelayMin}m`} />
        <Stat label="GPS points" value={ov.totalGpsPoints} sub="history retained" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <SectionTitle>Trips per day</SectionTitle>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={tripsPerDay}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" fontSize={11} />
              <YAxis allowDecimals={false} fontSize={11} />
              <Tooltip />
              <Bar dataKey="trips" fill="#2563eb" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <SectionTitle>Average delay by hour</SectionTitle>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={delays?.byHour || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="hour" fontSize={11} tickFormatter={(h) => `${h}:00`} />
              <YAxis fontSize={11} unit="m" />
              <Tooltip />
              <Line type="monotone" dataKey="avgDelay" stroke="#d97706" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <SectionTitle>Average occupancy by hour</SectionTitle>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={occ?.byHour || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="hour" fontSize={11} tickFormatter={(h) => `${h}:00`} />
              <YAxis fontSize={11} unit="%" domain={[0, 100]} />
              <Tooltip />
              <Line type="monotone" dataKey="avgPct" stroke="#16a34a" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <SectionTitle>Route usage & demand</SectionTitle>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={routes} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" allowDecimals={false} fontSize={11} />
              <YAxis type="category" dataKey="name" width={90} fontSize={11} />
              <Tooltip />
              <Bar dataKey="trips" name="trips" radius={[0, 6, 6, 0]}>
                {routes.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3 text-xs">
            {routes.map((r) => (
              <div key={r.routeId} className="border border-slate-100 rounded-lg px-2.5 py-1.5">
                <p className="font-semibold text-slate-700">{r.name}</p>
                <p className="text-slate-400">avg pax {r.avgOccupancy} · avg delay {r.avgDelayMin}m</p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <SectionTitle>Recent assignment changes (audit)</SectionTitle>
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-slate-400 border-b"><th className="px-2 py-2">When</th><th className="px-2 py-2">Change</th><th className="px-2 py-2">Detail</th><th className="px-2 py-2">By</th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-b border-slate-50">
                  <td className="px-2 py-2 text-xs text-slate-400 whitespace-nowrap">{new Date(h.createdAt).toLocaleString()}</td>
                  <td className="px-2 py-2 font-semibold text-slate-600">{h.change}</td>
                  <td className="px-2 py-2">{h.note}</td>
                  <td className="px-2 py-2 text-slate-500">{h.actor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
