import { useEnv, type Env } from "../api/env";
import { ChevronsUpDown, ShieldCheck, FlaskConical } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const OPTIONS: Array<{ value: Env; label: string; sub: string; cls: string; Icon: any }> = [
  {
    value: "dev",
    label: "Dev",
    sub: "Safe to act on",
    cls: "text-emerald-700 bg-emerald-50 ring-emerald-200",
    Icon: FlaskConical,
  },
  {
    value: "prod",
    label: "Prod",
    sub: "Live customer data",
    cls: "text-red-700 bg-red-50 ring-red-200",
    Icon: ShieldCheck,
  },
];

export default function EnvPicker() {
  const { env, setEnv } = useEnv();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = OPTIONS.find((o) => o.value === env)!;
  const CurrentIcon = current.Icon;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between gap-2 rounded-md border border-ink-200 bg-white px-2 py-1.5 text-left text-sm shadow-sm hover:bg-ink-50`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ring-1 ring-inset ${current.cls}`}
          >
            <CurrentIcon className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[12px] font-semibold text-ink-900">
              {current.label}
            </span>
            <span className="block truncate text-[10px] text-ink-500">
              {current.sub}
            </span>
          </span>
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-ink-400" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-md border border-ink-200 bg-white shadow-lg">
          {OPTIONS.map((opt) => {
            const OptIcon = opt.Icon;
            const active = opt.value === env;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setEnv(opt.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-ink-50 ${
                  active ? "bg-ink-50" : ""
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ring-1 ring-inset ${opt.cls}`}
                >
                  <OptIcon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-semibold text-ink-900">
                    {opt.label}
                    {active && (
                      <span className="ml-1 text-[10px] text-ink-400">·  active</span>
                    )}
                  </span>
                  <span className="block truncate text-[10px] text-ink-500">
                    {opt.sub}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
