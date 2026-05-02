import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle2,
  History,
  Loader2,
  Search,
  ShieldCheck,
  ShieldX,
  Undo2,
  XCircle,
} from "lucide-react";
import type { RecoveryRun, RecoveryState, RecoveryAction } from "../types";
import { paginate, usePageSize } from "../api/pagination";
import { useSessionState } from "../api/storage";
import { MOCK_RECOVERY_RUNS } from "../data/mockRecoveryRuns";
import RecoveryStateBadge from "../components/RecoveryStateBadge";
import Pagination from "../components/Pagination";
import Pill from "../components/Pill";
import EmptyState from "../components/EmptyState";

interface Filters {
  search: string;
  action: "all" | RecoveryAction;
  state: "all" | RecoveryState;
  actor: string;
}

const INITIAL_FILTERS: Filters = {
  search: "",
  action: "all",
  state: "all",
  actor: "all",
};

function fmtRelative(iso: string): string {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const diff = now - t;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} h ago`;
  return `${Math.round(diff / 86_400_000)} d ago`;
}

export default function RecoveryRunsPage() {
  const navigate = useNavigate();
  // Sample data is hardcoded for the mock pass; the real backend will hit
  // GET /api/recovery/runs and return the same shape.
  const [runs, setRuns] = useState<RecoveryRun[]>([]);
  useEffect(() => {
    setRuns(MOCK_RECOVERY_RUNS);
  }, []);

  const [filters, setFilters] = useSessionState<Filters>(
    "recovery.filters",
    INITIAL_FILTERS
  );
  const [page, setPage] = useSessionState<number>("recovery.page", 1);
  const [pageSize, setPageSize] = usePageSize("recovery");

  useEffect(() => setPage(1), [filters, setPage]);

  const actorOptions = useMemo(() => {
    const set = new Map<string, string>();
    for (const r of runs) set.set(r.triggered_by.email, r.triggered_by.name);
    return Array.from(set, ([email, name]) => ({ email, name }));
  }, [runs]);

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return runs
      .slice()
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .filter((r) => {
        if (filters.action !== "all" && r.action !== filters.action) return false;
        if (filters.state !== "all" && r.state !== filters.state) return false;
        if (filters.actor !== "all" && r.triggered_by.email !== filters.actor)
          return false;
        if (!q) return true;
        const hay = [
          r.id,
          r.org_name,
          r.integration_name,
          r.integration_instance_name,
          r.de_sync_status_id,
          r.sync_id,
          r.mode,
          r.triggered_by.email,
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
  }, [runs, filters]);

  const visible = useMemo(
    () => paginate(filtered, page, pageSize),
    [filtered, page, pageSize]
  );

  const kpis = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const isToday = (r: RecoveryRun) => r.created_at.slice(0, 10) === today;
    const todayRuns = runs.filter(isToday);
    const succeeded = todayRuns.filter((r) => r.state === "SUCCEEDED").length;
    const failed = todayRuns.filter(
      (r) => r.state === "FAILED" || r.state === "POISONED"
    ).length;
    const blocked = todayRuns.filter((r) => r.state === "BLOCKED").length;
    const live = runs.filter(
      (r) => r.state === "EXECUTING" || r.state === "PLANNED" || r.state === "READY"
    ).length;
    const undone = todayRuns.filter((r) => r.state === "UNDONE").length;
    const undoEligible = runs.filter((r) => r.undo.eligible).length;
    return { todayRuns: todayRuns.length, succeeded, failed, blocked, live, undone, undoEligible };
  }, [runs]);

  return (
    <div className="px-6 py-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-ink-900">
            <History className="h-5 w-5 text-ink-700" />
            Recovery activity
          </h1>
          <p className="mt-1 text-xs text-ink-500">
            Every mark-complete and retrigger action with its snapshot,
            timeline, and undo state. Sample data — backend wiring pending.
          </p>
        </div>
      </header>

      {/* KPI strip */}
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard
          label="Today"
          value={kpis.todayRuns}
          tone="neutral"
          Icon={History}
        />
        <KpiCard
          label="Succeeded"
          value={kpis.succeeded}
          tone="emerald"
          Icon={CheckCircle2}
        />
        <KpiCard
          label="In flight"
          value={kpis.live}
          tone="blue"
          Icon={Loader2}
        />
        <KpiCard label="Failed" value={kpis.failed} tone="red" Icon={XCircle} />
        <KpiCard
          label="Blocked"
          value={kpis.blocked}
          tone="amber"
          Icon={ShieldX}
        />
        <KpiCard
          label="Undo eligible"
          value={kpis.undoEligible}
          tone="violet"
          Icon={Undo2}
        />
      </div>

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            className="input pl-8"
            placeholder="Search by org, integration, sync id, recovery id…"
            value={filters.search}
            onChange={(e) =>
              setFilters({ ...filters, search: e.target.value })
            }
          />
        </div>
        <select
          className="input w-auto"
          value={filters.action}
          onChange={(e) =>
            setFilters({ ...filters, action: e.target.value as Filters["action"] })
          }
        >
          <option value="all">All actions</option>
          <option value="MARK_COMPLETE">Mark complete</option>
          <option value="RETRIGGER">Retrigger</option>
        </select>
        <select
          className="input w-auto"
          value={filters.state}
          onChange={(e) =>
            setFilters({ ...filters, state: e.target.value as Filters["state"] })
          }
        >
          <option value="all">All states</option>
          <option value="EXECUTING">Executing</option>
          <option value="SUCCEEDED">Succeeded</option>
          <option value="FAILED">Failed</option>
          <option value="BLOCKED">Blocked</option>
          <option value="UNDONE">Undone</option>
          <option value="POISONED">Poisoned</option>
        </select>
        <select
          className="input w-auto"
          value={filters.actor}
          onChange={(e) => setFilters({ ...filters, actor: e.target.value })}
        >
          <option value="all">Any actor</option>
          {actorOptions.map((a) => (
            <option key={a.email} value={a.email}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No recovery runs match the filters"
          hint="Clear the search or change the filters."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border border-ink-200">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className="table-th">When</th>
                  <th className="table-th">Action</th>
                  <th className="table-th">Target</th>
                  <th className="table-th">Mode</th>
                  <th className="table-th">By</th>
                  <th className="table-th">State</th>
                  <th className="table-th">Snapshot</th>
                  <th className="table-th">Undo</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => navigate(`/recovery/runs/${r.id}`)}
                    className="cursor-pointer border-t border-ink-100 transition hover:bg-ink-50/50"
                  >
                    <td className="table-td whitespace-nowrap">
                      <div className="text-[12px] text-ink-700">
                        {fmtRelative(r.created_at)}
                      </div>
                      <div className="mono text-[10px] text-ink-400">
                        {new Date(r.created_at).toLocaleString()}
                      </div>
                    </td>
                    <td className="table-td">
                      <Pill tone={r.action === "MARK_COMPLETE" ? "emerald" : "blue"}>
                        {r.action === "MARK_COMPLETE" ? "Mark complete" : "Retrigger"}
                      </Pill>
                    </td>
                    <td className="table-td">
                      <div className="font-medium text-ink-900">{r.org_name}</div>
                      <div className="text-[12px] text-ink-500">
                        {r.integration_instance_name}
                        <span className="mx-1 text-ink-300">·</span>
                        {r.integration_name}
                      </div>
                      <div className="mono text-[10px] text-ink-400">
                        {r.de_sync_status_id}
                      </div>
                    </td>
                    <td className="table-td mono text-[12px]">{r.mode}</td>
                    <td className="table-td">
                      <div className="text-[12px] text-ink-700">
                        {r.triggered_by.name}
                      </div>
                      <div className="text-[10px] text-ink-400">
                        {r.triggered_by.email}
                      </div>
                    </td>
                    <td className="table-td">
                      <RecoveryStateBadge state={r.state} />
                      {r.undo.drift_check?.drift_detected &&
                        r.state !== "POISONED" && (
                          <div
                            className="mt-1 inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200"
                            title={`Drift on: ${r.undo.drift_check.drifted_fields.join(
                              ", "
                            )}`}
                          >
                            drift
                          </div>
                        )}
                    </td>
                    <td className="table-td">
                      {r.snapshot ? (
                        <div className="inline-flex items-center gap-1 text-[12px] text-emerald-700">
                          <ShieldCheck className="h-3.5 w-3.5" />
                          <span className="mono text-[10px]">
                            {r.snapshot.hash.slice(0, 18)}…
                          </span>
                        </div>
                      ) : (
                        <span className="text-[12px] text-ink-400">none</span>
                      )}
                    </td>
                    <td className="table-td">
                      {r.undo.eligible ? (
                        <Pill tone="violet" Icon={Undo2}>
                          eligible
                        </Pill>
                      ) : r.state === "UNDONE" ? (
                        <Pill tone="violet">already undone</Pill>
                      ) : (
                        <span className="text-[11px] text-ink-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 card overflow-hidden">
            <Pagination
              total={filtered.length}
              page={page}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(s) => {
                setPageSize(s);
                setPage(1);
              }}
              itemLabel="runs"
            />
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
  Icon,
}: {
  label: string;
  value: number;
  tone: "neutral" | "emerald" | "red" | "blue" | "amber" | "violet";
  Icon: React.ComponentType<{ className?: string }>;
}) {
  const ring = {
    neutral: "ring-ink-200",
    emerald: "ring-emerald-200 bg-emerald-50/40",
    red: "ring-red-200 bg-red-50/40",
    blue: "ring-blue-200 bg-blue-50/40",
    amber: "ring-amber-200 bg-amber-50/40",
    violet: "ring-violet-200 bg-violet-50/40",
  }[tone];
  const text = {
    neutral: "text-ink-700",
    emerald: "text-emerald-700",
    red: "text-red-700",
    blue: "text-blue-700",
    amber: "text-amber-700",
    violet: "text-violet-700",
  }[tone];
  return (
    <div className={`card flex flex-col px-3 py-2 ring-1 ring-inset ${ring}`}>
      <span
        className={`flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide ${text}`}
      >
        <Icon className="h-3 w-3" />
        {label}
      </span>
      <span className="mt-1 text-2xl font-semibold text-ink-900">{value}</span>
    </div>
  );
}
