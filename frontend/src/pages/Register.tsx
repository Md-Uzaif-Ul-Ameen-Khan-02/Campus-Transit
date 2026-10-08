import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Button, Field, inputCls } from "../components/ui";

export default function Register() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({
    full_name: "", email: "", phone: "", password: "", role: "student" as "student" | "driver", employee_code: "",
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  function set(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const role = await register(form);
      nav(`/${role}`, { replace: true });
    } catch (e: any) {
      setErr(e.message || "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full grid place-items-center bg-slate-100 px-4 py-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-slate-800">Create your account</h1>
          <p className="text-sm text-slate-500">Students can register directly; drivers receive credentials from the transport office too.</p>
        </div>
        <form onSubmit={submit} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {(["student", "driver"] as const).map((r) => (
              <button
                type="button"
                key={r}
                onClick={() => set("role", r)}
                className={`px-3 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                  form.role === r ? "bg-brand-50 border-brand-500 text-brand-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                {r === "student" ? "🎓 I'm a student" : "🚌 I'm a driver"}
              </button>
            ))}
          </div>
          <Field label="Full name">
            <input className={inputCls} required minLength={2} value={form.full_name} onChange={(e) => set("full_name", e.target.value)} placeholder="Aarav Sharma" />
          </Field>
          <Field label="Email">
            <input className={inputCls} type="email" required value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="you@campus.edu" />
          </Field>
          <Field label="Phone">
            <input className={inputCls} value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="9900000000" />
          </Field>
          {form.role === "driver" && (
            <Field label="Employee code" hint="Provided by the transport office (optional)">
              <input className={inputCls} value={form.employee_code} onChange={(e) => set("employee_code", e.target.value)} placeholder="EMP-000" />
            </Field>
          )}
          <Field label="Password" hint="At least 6 characters">
            <input className={inputCls} type="password" required minLength={6} value={form.password} onChange={(e) => set("password", e.target.value)} />
          </Field>
          {err && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>}
          <Button type="submit" loading={busy} className="w-full py-2.5">Create account</Button>
          <p className="text-center text-sm text-slate-500">
            Already registered? <Link to="/login" className="text-brand-600 font-semibold">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
