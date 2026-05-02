import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { MemberRole, TeamMember } from "../types";

interface AuthCtx {
  user: TeamMember | null;
  loading: boolean;
  login: (credential: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Self-update: name + designation only. Email/role are protected. */
  updateProfile: (patch: {
    name?: string;
    designation?: string;
  }) => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let msg = body;
    try {
      const j = JSON.parse(body);
      msg = j.error || body;
    } catch {
      /* not json */
    }
    throw new Error(msg || `${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<TeamMember | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await fetchJson<{ user: TeamMember | null }>("/api/auth/me");
      setUser(r.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(
    async (credential: string) => {
      const r = await fetchJson<{ user: TeamMember }>("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential }),
      });
      setUser(r.user);
    },
    []
  );

  const logout = useCallback(async () => {
    await fetchJson<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
    setUser(null);
  }, []);

  const updateProfile = useCallback(
    async (patch: { name?: string; designation?: string }) => {
      const r = await fetchJson<{ user: TeamMember }>("/api/auth/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      setUser(r.user);
    },
    []
  );

  const value = useMemo<AuthCtx>(
    () => ({ user, loading, login, logout, refresh, updateProfile }),
    [user, loading, login, logout, refresh, updateProfile]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Shortcut helpers for role checks. */
export function isAdmin(user: TeamMember | null | undefined): boolean {
  return user?.role === "admin";
}

export function hasRole(
  user: TeamMember | null | undefined,
  ...roles: MemberRole[]
): boolean {
  return !!user && roles.includes(user.role);
}
