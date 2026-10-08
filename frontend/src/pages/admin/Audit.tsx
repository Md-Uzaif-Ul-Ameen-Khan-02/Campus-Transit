import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Badge, Card, PageLoader, inputCls, EmptyState } from "../../components/ui";

const ACTION_TONES: Record<string, string> = {
  "emergency.triggered": "bg-red-100 text-red-700 border-red-200",
  "trip.cancelled": "bg-red-50 text-red-600 border-red-200",
  "trip.bus_replaced": "bg-blue-100 text-blue-700 border-blue-200",
  "trip.driver_replaced": "bg-blue-100 text-blue-700 border-blue-200",
  "settings.updated": "bg-purple-100 text-purple-700 border-purple-200",
};

export default function AuditPage() {
  const [logs, setLogs] = useState<any[] | null>(null);
  const [action, setAction] = useState("");

  const load = useCallback(async () => {
    setLogs(await api.get(`/audit?limit=300${action ? `&action=${action}` : ""}`));
  }, [action]);

  useEffect(() => { load().catch(() => setLogs([])); }, [load]);

  if (logs == null) return <PageLoader label="Loading audit trail…" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Audit log</h1>
          <p className="text-sm text-slate-500">Immutable record of administrative and operational actions</p>
        </div>
        <input className={inputCls + " w-56"} placeholder="Filter by action…" value={action} onChange={(e) => setAction(e.target.value)} />
      </div>

      <Card className="p-2">
        {logs.length === 0 ? (
          <EmptyState icon="🗂️" title="No audit entries" />
        ) : (
          <div className="max-h-[70vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-xs uppercase text-slate-400 border-b">
                  <th className="px-3 py-2.5">Time</th>
                  <th className="px-3 py-2.5">Actor</th>
                  <th className="px-3 py-2.5">Action</th>
                  <th className="px-3 py-2.5">Detail</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-3 py-2 text-xs text-slate-400 whitespace-nowrap">{new Date(l.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2 font-medium text-slate-600">{l.actor}</td>
                    <td className="px-3 py-2"><Badge tone={ACTION_TONES[l.action] || ""}>{l.action}</Badge></td>
                    <td className="px-3 py-2 text-slate-600">{l.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
