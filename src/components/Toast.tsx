import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { ApiError } from "../api/client";

type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  detail?: string;
}

interface ToastApi {
  success: (title: string, detail?: string) => void;
  error: (title: string, detail?: string) => void;
  info: (title: string, detail?: string) => void;
  /**
   * Convert any thrown value into a user-friendly toast. Branches on
   * ApiError.status so a 403 reads "You don't have permission" instead of
   * dumping the raw `forbidden` payload.
   */
  fromError: (err: unknown, fallback?: string) => void;
  dismiss: (id: number) => void;
}

const Ctx = createContext<ToastApi | null>(null);
const AUTO_DISMISS_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, title: string, detail?: string) => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, kind, title, detail }]);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss]
  );

  const fromError = useCallback(
    (err: unknown, fallback = "Something went wrong") => {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          return push("error", "Please sign in again", "Your session expired.");
        }
        if (err.status === 403) {
          return push(
            "error",
            "You don't have permission to do this",
            "Ask an admin to grant access."
          );
        }
        if (err.status === 404) {
          return push("error", "Not found", err.message);
        }
        if (err.status === 409) {
          return push("error", "Conflict", err.message);
        }
        if (err.status >= 500) {
          return push(
            "error",
            "Server error",
            "Something failed on our side. Try again."
          );
        }
        return push("error", err.message || fallback);
      }
      if (err instanceof Error) {
        return push("error", fallback, err.message);
      }
      return push("error", fallback);
    },
    [push]
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (title, detail) => push("success", title, detail),
      error: (title, detail) => push("error", title, detail),
      info: (title, detail) => push("info", title, detail),
      fromError,
      dismiss,
    }),
    [push, fromError, dismiss]
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed top-4 right-4 z-[100] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  const { kind, title, detail } = toast;
  const tone =
    kind === "success"
      ? "bg-emerald-50 border-emerald-200 text-emerald-900"
      : kind === "error"
      ? "bg-red-50 border-red-200 text-red-900"
      : "bg-sky-50 border-sky-200 text-sky-900";
  const Icon =
    kind === "success" ? CheckCircle2 : kind === "error" ? AlertCircle : Info;
  const iconTone =
    kind === "success"
      ? "text-emerald-600"
      : kind === "error"
      ? "text-red-600"
      : "text-sky-600";

  // Allow keyboard dismiss when focused.
  useEffect(() => {
    /* nothing — keep static */
  }, []);

  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 shadow-sm ${tone}`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconTone}`} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-5">{title}</div>
        {detail && <div className="mt-0.5 text-xs opacity-80">{detail}</div>}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
