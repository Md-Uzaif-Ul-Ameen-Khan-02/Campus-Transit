import { HashRouter, Navigate, Outlet, Route, Routes, Link, useLocation } from "react-router-dom";
import { AuthProvider, useAuth, type Role } from "./auth";
import { PageLoader, ToastProvider } from "./components/ui";
import { LiveSocket } from "./lib/ws";
import { useEffect } from "react";
import { api } from "./lib/api";

import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";

import StudentDashboard from "./pages/student/StudentDashboard";
import MyRoutePage from "./pages/student/MyRoute";
import Notifications from "./pages/student/Notifications";
import Profile from "./pages/student/Profile";

import DriverDashboard from "./pages/driver/DriverDashboard";
import DriverHistory from "./pages/driver/DriverHistory";

import AdminDashboard from "./pages/admin/AdminDashboard";
import LiveOps from "./pages/admin/LiveOps";
import BusesPage from "./pages/admin/Buses";
import DriversPage from "./pages/admin/Drivers";
import RoutesPage from "./pages/admin/Routes";
import TripsPage from "./pages/admin/Trips";
import AlertsPage from "./pages/admin/Alerts";
import AnalyticsPage from "./pages/admin/Analytics";
import AuditPage from "./pages/admin/Audit";
import SettingsPage from "./pages/admin/Settings";

function HomeRedirect() {
  const { role, ready } = useAuth();
  if (!ready) return <PageLoader label="Loading Campus Transit…" />;
  if (!role) return <Landing />;
  return <Navigate to={`/${role}`} replace />;
}

function Shell({
  nav,
  brand,
}: {
  nav: { to: string; label: string; icon: string; end?: boolean }[];
  brand: string;
}) {
  const { logout, name, role } = useAuth();
  const loc = useLocation();
  useEffect(() => {
    // One live socket per shell; topics by role.
    const topics =
      role === "admin"
        ? ["bus.location.updated", "trip.started", "trip.ended", "trip.delayed", "trip.replaced", "trip.cancelled", "emergency.triggered", "emergency.resolved", "bus.occupancy.updated"]
        : role === "student"
          ? ["notifications.new", "bus.location.updated", "bus.occupancy.updated", "trip.ended", "trip.replaced", "trip.delayed", "trip.cancelled", "emergency.triggered"]
          : ["trip.replaced", "trip.cancelled"];
    if (role && getTokenSafe()) {
      (window as any).__ctSocket = new LiveSocket(topics);
      (window as any).__ctSocket.connect();
    }
    return () => {
      (window as any).__ctSocket?.close();
      (window as any).__ctSocket = null;
    };
  }, [role]);

  function getTokenSafe() {
    return api && localStorage.getItem("ct_token");
  }

  return (
    <div className="min-h-full flex flex-col">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <Link to={`/${role}`} className="flex items-center gap-2 font-bold text-slate-800">
            <span className="w-8 h-8 rounded-xl bg-brand-600 text-white grid place-items-center text-sm">CT</span>
            <span className="hidden sm:block">Campus Transit</span>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 uppercase">{role}</span>
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  loc.pathname === n.to ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <span className="hidden sm:block text-sm text-slate-500 max-w-[160px] truncate">{name}</span>
            <button onClick={logout} className="text-sm font-semibold text-slate-500 hover:text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50">
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-7xl mx-auto px-4 py-5 pb-24 md:pb-8">
          <Outlet />
        </div>
      </main>

      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 z-40 flex">
        {nav.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            className={`flex-1 flex flex-col items-center py-2 text-[11px] font-medium ${
              loc.pathname === n.to ? "text-brand-600" : "text-slate-500"
            }`}
          >
            <span className="text-lg leading-tight">{n.icon}</span>
            {n.label}
          </Link>
        ))}
      </nav>
      <span className="sr-only">{brand}</span>
    </div>
  );
}

function RequireRole({ role }: { role: Role }) {
  const { ready, role: current } = useAuth();
  if (!ready) return <PageLoader label="Checking your session…" />;
  if (!current) return <Navigate to="/login" replace />;
  if (current !== role) return <Navigate to={`/${current}`} replace />;
  return <Outlet />;
}

const studentNav = [
  { to: "/student", label: "Home", icon: "🏠", end: true },
  { to: "/student/route", label: "My Route", icon: "🛣️" },
  { to: "/student/alerts", label: "Alerts", icon: "🔔" },
  { to: "/student/profile", label: "Profile", icon: "👤" },
];
const driverNav = [
  { to: "/driver", label: "Trip", icon: "🚌", end: true },
  { to: "/driver/history", label: "History", icon: "🕘" },
  { to: "/driver/profile", label: "Profile", icon: "👤" },
];
const adminNav = [
  { to: "/admin", label: "Dashboard", icon: "📊", end: true },
  { to: "/admin/live", label: "Live Ops", icon: "🛰️" },
  { to: "/admin/trips", label: "Trips", icon: "🗓️" },
  { to: "/admin/buses", label: "Buses", icon: "🚌" },
  { to: "/admin/drivers", label: "Drivers", icon: "🧑‍✈️" },
  { to: "/admin/routes", label: "Routes", icon: "🛣️" },
  { to: "/admin/alerts", label: "Alerts", icon: "📣" },
  { to: "/admin/analytics", label: "Analytics", icon: "📈" },
  { to: "/admin/audit", label: "Audit", icon: "🗂️" },
  { to: "/admin/settings", label: "Settings", icon: "⚙️" },
];

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <HashRouter>
          <Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />

            <Route element={<RequireRole role="student" />}>
              <Route path="/student" element={<Shell nav={studentNav} brand="student area" />}>
                <Route index element={<StudentDashboard />} />
                <Route path="route" element={<MyRoutePage />} />
                <Route path="alerts" element={<Notifications />} />
                <Route path="profile" element={<Profile />} />
              </Route>
            </Route>

            <Route element={<RequireRole role="driver" />}>
              <Route path="/driver" element={<Shell nav={driverNav} brand="driver console" />}>
                <Route index element={<DriverDashboard />} />
                <Route path="history" element={<DriverHistory />} />
                <Route path="profile" element={<Profile />} />
              </Route>
            </Route>

            <Route element={<RequireRole role="admin" />}>
              <Route path="/admin" element={<Shell nav={adminNav} brand="admin console" />}>
                <Route index element={<AdminDashboard />} />
                <Route path="live" element={<LiveOps />} />
                <Route path="buses" element={<BusesPage />} />
                <Route path="drivers" element={<DriversPage />} />
                <Route path="routes" element={<RoutesPage />} />
                <Route path="trips" element={<TripsPage />} />
                <Route path="alerts" element={<AlertsPage />} />
                <Route path="analytics" element={<AnalyticsPage />} />
                <Route path="audit" element={<AuditPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </HashRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
