import { Link } from "react-router-dom";

export default function Landing() {
  return (
    <div className="min-h-full bg-gradient-to-b from-brand-900 via-brand-700 to-brand-600 text-white">
      <header className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold">
          <span className="w-9 h-9 rounded-xl bg-white/15 grid place-items-center backdrop-blur">CT</span>
          Campus Transit
        </div>
        <div className="flex gap-2">
          <Link to="/login" className="px-4 py-2 rounded-xl text-sm font-semibold bg-white text-brand-700 hover:bg-brand-50">Sign in</Link>
          <Link to="/register" className="px-4 py-2 rounded-xl text-sm font-semibold border border-white/40 hover:bg-white/10">Register</Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 pt-14 pb-20">
        <div className="grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest bg-white/10 border border-white/20 rounded-full px-3 py-1 mb-5">
              Smart Campus Transportation
            </p>
            <h1 className="text-4xl sm:text-5xl font-extrabold leading-tight">
              Your bus, your stop,<br />
              <span className="text-amber-300">your own ETA.</span>
            </h1>
            <p className="mt-5 text-white/85 text-lg max-w-xl">
              Live GPS tracking straight from the driver's phone, personalized arrival times for
              <em> your</em> pickup point, live occupancy and instant service alerts — one platform
              for students, drivers and transport administrators.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/login" className="px-6 py-3 rounded-xl bg-white text-brand-700 font-bold hover:bg-brand-50 shadow-lg">
                Sign in to track your bus
              </Link>
              <Link to="/register" className="px-6 py-3 rounded-xl border border-white/50 font-semibold hover:bg-white/10">
                Create an account
              </Link>
            </div>
            <p className="mt-4 text-sm text-white/60">
              Demo: aarav@campus.edu / student@123 · raj@campus.edu (driver) / driver@123 · admin@campus.edu / admin@123
            </p>
          </div>

          <div className="grid gap-4">
            {[
              { icon: "📍", t: "Personalized ETA", d: "Not just 'bus arrives at campus' — when it reaches YOUR pickup point." },
              { icon: "🛰️", t: "Live GPS from driver phone", d: "No hardware needed. Tracking only while the trip is active." },
              { icon: "🔁", t: "Dynamic assignments", d: "Any bus, any driver, any day. Replace mid-trip without losing students." },
              { icon: "📊", t: "Analytics for planners", d: "Delays, demand, occupancy and travel-time history for smarter scheduling." },
            ].map((f) => (
              <div key={f.t} className="bg-white/10 backdrop-blur border border-white/15 rounded-2xl p-4 flex gap-4">
                <span className="text-2xl">{f.icon}</span>
                <div>
                  <h3 className="font-bold">{f.t}</h3>
                  <p className="text-sm text-white/75">{f.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>

      <footer className="text-center text-white/50 text-sm pb-8">
        Built for college campuses · Routes, trips and assignments fully admin-configurable
      </footer>
    </div>
  );
}
