import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type Env = "dev" | "prod";

const STORAGE_KEY = "reRunSyncs.env";

interface Ctx {
  env: Env;
  setEnv: (e: Env) => void;
}

const EnvContext = createContext<Ctx | null>(null);

function readInitial(): Env {
  if (typeof window === "undefined") return "dev";
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "prod" ? "prod" : "dev";
}

export function EnvProvider({ children }: { children: ReactNode }) {
  const [env, setEnvState] = useState<Env>(readInitial);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, env);
  }, [env]);

  const value = useMemo<Ctx>(
    () => ({ env, setEnv: setEnvState }),
    [env]
  );

  return <EnvContext.Provider value={value}>{children}</EnvContext.Provider>;
}

export function useEnv(): Ctx {
  const ctx = useContext(EnvContext);
  if (!ctx) throw new Error("useEnv must be used inside <EnvProvider>");
  return ctx;
}
