import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Button, Field, inputCls } from "../components/ui";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const role = await login(email.trim(), pw);
      nav(`/${role}`, { replace: true });
    } catch (e: any) {
      setErr(e.message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full grid place-items-center bg-slate-100 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <span className="w-12 h-12 rounded-2xl bg-brand-600 text-white grid place-items-center text-lg font-bold mx-auto">CT</span>
          <h1 className="text-2xl font-bold mt-3 text-slate-800">Welcome back</h1>
          <p className="text-sm text-slate-500">Sign in to Campus Transit</p>
        </div>
        <form onSubmit={submit} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          <Field label="Email">
            <input className={inputCls} type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@campus.edu" />
          </Field>
          <Field label="Password">
            <input className={inputCls} type="password" required autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••" />
          </Field>
          {err && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>}
          <Button type="submit" loading={busy} className="w-full py-2.5">Sign in</Button>
          <p className="text-center text-sm text-slate-500">
            New student or driver? <Link to="/register" className="text-brand-600 font-semibold">Create an account</Link>
          </p>
        </form>
        <div className="mt-4 text-center text-xs text-slate-400 space-y-1">
          <p>Demo accounts</p>
          <p>aarav@campus.edu / student@123 · raj@campus.edu / driver@123 · admin@campus.edu / admin@123</p>
        </div>
      </div>
    </div>
  );
}
