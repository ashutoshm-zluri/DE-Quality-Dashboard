import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bug as BugIcon,
  ChevronLeft,
  ChevronRight,
  History,
  Menu,
  PlayCircle,
  RotateCw,
  ScrollText,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import EnvPicker from "./EnvPicker";
import ProfileMenu from "./ProfileMenu";
import { useEnv } from "../api/env";

const navItems = [
  { to: "/", label: "Failures", icon: RotateCw, end: true },
  { to: "/active-runs", label: "Active Runs", icon: PlayCircle },
  { to: "/recovery/runs", label: "Recovery", icon: History },
  { to: "/stats", label: "Reliability", icon: BarChart3 },
  { to: "/bad-requests", label: "Bad Requests", icon: AlertTriangle },
  { to: "/releases", label: "Release Tracker", icon: BugIcon },
  { to: "/rca", label: "RCA Docs", icon: ScrollText },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

const STORAGE_KEY = "deQualityPortal.sidebarCollapsed";

export default function Layout() {
  const { env } = useEnv();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  });
  // Mobile drawer is independent of the desktop collapse state.
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  // Auto-close the mobile drawer on route change so users land on the
  // page after tapping a nav item.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Esc closes the drawer.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && setMobileOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  // Sidebar inner — same content for desktop column and mobile drawer
  const sidebarContent = (variant: "desktop" | "mobile") => (
    <>
      {/* Brand + collapse toggle */}
      <div
        className={`mb-4 flex items-center ${
          variant === "desktop" && collapsed
            ? "justify-center"
            : "justify-between gap-2 px-2"
        }`}
      >
        <div
          className={`flex items-center gap-2 ${
            variant === "desktop" && collapsed ? "justify-center" : ""
          }`}
        >
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-ink-900 text-white"
            title="DE-Quality Portal"
          >
            <Activity className="h-4 w-4" />
          </div>
          {!(variant === "desktop" && collapsed) && (
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold leading-tight text-ink-900">
                DE-Quality Portal
              </div>
              <div className="text-[11px] leading-tight text-ink-500">
                Zluri Inc
              </div>
            </div>
          )}
        </div>
        {variant === "mobile" ? (
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
            title="Close menu"
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
        ) : !collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {variant === "desktop" && collapsed && (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="mb-3 flex h-7 w-full items-center justify-center rounded-md text-ink-400 hover:bg-ink-100 hover:text-ink-700"
          title="Expand sidebar"
          aria-label="Expand sidebar"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}

      {/* Env picker */}
      {variant === "mobile" || !collapsed ? (
        <div className="mb-4 px-1">
          <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
            Environment
          </div>
          <EnvPicker />
        </div>
      ) : (
        <div className="mb-3 flex justify-center" title={`Environment: ${env}`}>
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-md text-[11px] font-bold ring-1 ring-inset ${
              env === "prod"
                ? "bg-red-50 text-red-700 ring-red-200"
                : "bg-emerald-50 text-emerald-700 ring-emerald-200"
            }`}
          >
            {env === "prod" ? "P" : "D"}
          </span>
        </div>
      )}

      {/* Nav */}
      <nav className="flex flex-col gap-0.5">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            title={
              variant === "desktop" && collapsed ? item.label : undefined
            }
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition ${
                variant === "desktop" && collapsed ? "justify-center" : ""
              } ${
                isActive
                  ? "bg-ink-100 text-ink-900"
                  : "text-ink-600 hover:bg-ink-50 hover:text-ink-900"
              }`
            }
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {!(variant === "desktop" && collapsed) && (
              <span className="truncate">{item.label}</span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div
        className={`mt-auto border-t border-ink-100 pt-3 ${
          variant === "mobile" || !collapsed ? "px-2" : ""
        }`}
      >
        <ProfileMenu collapsed={variant === "desktop" && collapsed} />
        {(variant === "mobile" || !collapsed) && (
          <div className="mt-3 px-2 text-[11px] leading-relaxed text-ink-500">
            <div className="mb-1 font-medium text-ink-600">Source</div>
            <div className="mono">FAILING_FLOWS_DIR / {env}</div>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <aside
        className={`hidden shrink-0 border-r border-ink-200 bg-white py-4 transition-[width] md:flex md:flex-col ${
          collapsed ? "w-16 px-2" : "w-60 px-3"
        }`}
      >
        {sidebarContent("desktop")}
      </aside>

      <main className="flex-1 overflow-auto">
        {/* Mobile top bar (hamburger + brand) — shown below md only */}
        <div className="flex items-center justify-between border-b border-ink-200 bg-white px-3 py-2 md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-1.5 text-ink-700 hover:bg-ink-100"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-ink-900 text-white">
              <Activity className="h-3.5 w-3.5" />
            </div>
            <div className="text-[13px] font-semibold text-ink-900">
              DE-Quality Portal
            </div>
          </div>
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-md text-[11px] font-bold ring-1 ring-inset ${
              env === "prod"
                ? "bg-red-50 text-red-700 ring-red-200"
                : "bg-emerald-50 text-emerald-700 ring-emerald-200"
            }`}
            title={`Environment: ${env}`}
          >
            {env === "prod" ? "P" : "D"}
          </span>
        </div>

        <Outlet />
      </main>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-ink-900/40 backdrop-blur-[2px]"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 flex h-full w-72 max-w-[85%] flex-col border-r border-ink-200 bg-white px-3 py-4 shadow-2xl">
            {sidebarContent("mobile")}
          </aside>
        </div>
      )}
    </div>
  );
}
