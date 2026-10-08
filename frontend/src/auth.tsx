import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, getToken, setToken } from "./lib/api";

export type Role = "student" | "driver" | "admin";

interface AuthState {
  ready: boolean;
  role: Role | null;
  name: string;
  email: string;
  userId: string;
  login: (email: string, password: string) => Promise<Role>;
  register: (data: RegisterData) => Promise<Role>;
  logout: () => void;
  refresh: () => Promise<void>;
}

export interface RegisterData {
  full_name: string;
  email: string;
  phone: string;
  password: string;
  role: "student" | "driver";
  employee_code?: string;
}

const Ctx = createContext<AuthState>(null as any);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [role, setRole] = useState<Role | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState("");

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setRole(null);
      setReady(true);
      return;
    }
    try {
      const me = await api.get("/auth/me");
      setRole(me.role as Role);
      setName(me.full_name);
      setEmail(me.email);
      setUserId(me.id);
    } catch {
      setToken(null);
      setRole(null);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (em: string, pw: string) => {
    const { login } = await import("./lib/api");
    await login(em, pw);
    const me = await api.get("/auth/me");
    setRole(me.role as Role);
    setName(me.full_name);
    setEmail(me.email);
    setUserId(me.id);
    return me.role as Role;
  }, []);

  const register = useCallback(async (data: RegisterData) => {
    const res = await api.post("/auth/register", data);
    setToken(res.access_token);
    setRole(res.role as Role);
    setName(res.full_name);
    setUserId(res.user_id);
    const me = await api.get("/auth/me");
    setEmail(me.email);
    return res.role as Role;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setRole(null);
    setName("");
    setEmail("");
    setUserId("");
  }, []);

  const value = useMemo(
    () => ({ ready, role, name, email, userId, login, register, logout, refresh }),
    [ready, role, name, email, userId, login, register, logout, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
