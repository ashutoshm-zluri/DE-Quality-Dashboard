import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LogOut, Settings as SettingsIcon, UserRound } from "lucide-react";
import { useAuth } from "../api/auth";
import Pill from "./Pill";

interface Props {
  collapsed?: boolean;
}

export default function ProfileMenu({ collapsed }: Props) {
  const { user, logout } = useAuth();
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

  if (!user) return null;

  const initials = (user.name || user.email)
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 rounded-md border border-ink-200 bg-white px-2 py-1.5 text-left hover:bg-ink-50 ${
          collapsed ? "justify-center" : ""
        }`}
        title={`${user.name} (${user.role})`}
      >
        {user.picture ? (
          <img
            src={user.picture}
            alt={user.name}
            className="h-7 w-7 shrink-0 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-100 text-[11px] font-medium text-ink-700">
            {initials}
          </span>
        )}
        {!collapsed && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-semibold text-ink-900">
              {user.name}
            </span>
            <span className="block truncate text-[10px] text-ink-500">
              {user.email}
            </span>
          </span>
        )}
      </button>

      {open && (
        <div
          className={`absolute z-30 overflow-hidden rounded-md border border-ink-200 bg-white shadow-lg ${
            collapsed
              ? "left-full bottom-0 ml-2 w-56"
              : "bottom-full left-0 right-0 mb-1"
          }`}
        >
          <div className="border-b border-ink-100 px-3 py-2">
            <div className="text-sm font-semibold text-ink-900">
              {user.name}
            </div>
            <div className="mono text-[11px] text-ink-500">{user.email}</div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <Pill
                tone={
                  user.role === "admin"
                    ? "violet"
                    : user.role === "member"
                      ? "blue"
                      : "ink"
                }
              >
                {user.role}
              </Pill>
              {user.designation && (
                <span className="text-[11px] text-ink-500">
                  {user.designation}
                </span>
              )}
            </div>
          </div>
          <Link
            to="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-50"
          >
            <SettingsIcon className="h-3.5 w-3.5" />
            Settings
          </Link>
          <button
            type="button"
            onClick={async () => {
              setOpen(false);
              await logout();
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-red-700 hover:bg-red-50"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
