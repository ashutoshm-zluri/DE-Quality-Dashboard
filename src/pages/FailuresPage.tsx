import { useEffect, useMemo, useState } from "react";
import { Database, Loader2, PlayCircle, RefreshCw } from "lucide-react";
import type { Failure, FailuresResponse } from "../types";
import { api } from "../api/client";
import { useEnv } from "../api/env";
import { useAuth } from "../api/auth";
import { canRecover } from "../api/permissions";
import { paginate, usePageSize } from "../api/pagination";
import { useSessionState } from "../api/storage";
import { useToast } from "../components/Toast";
import FailureTable from "../components/FailureTable";
import FailureDetailModal from "../components/FailureDetailModal";
import FilterBar, { type Filters } from "../components/FilterBar";
import EmptyState from "../components/EmptyState";
import Spinner from "../components/Spinner";
import RerunAllModal from "../components/RerunAllModal";
import Pagination from "../components/Pagination";

const ACTION_TILES: Array<{ key: string; label: string; cls: string }> = [
  { key: "MARK_COMPLETE", label: "Mark complete", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  { key: "RETRIGGER", label: "Retrigger", cls: "bg-blue-50 text-blue-700 ring-blue-200" },
  { key: "TRIGGERED", label: "Triggered", cls: "bg-violet-50 text-violet-700 ring-violet-200" },
  { key: "SKIP_RUNNING", label: "Running", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
  { key: "MANUAL_REVIEW", label: "Manual review", cls: "bg-red-50 text-red-700 ring-red-200" },
  { key: "SKIP_OUT_OF_WINDOW", label: "Out of window", cls: "bg-ink-100 text-ink-600 ring-ink-200" },
];

export default function FailuresPage() {
  const { env } = useEnv();
  const { user } = useAuth();
  const toast = useToast();
  const canAct = canRecover(user);
  const [data, setData] = useState<FailuresResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Failure | null>(null);
  const [rerunOpen, setRerunOpen] = useState(false);
  const [filters, setFilters] = useSessionState<Filters>(
    `failures.filters.${env}`,
    {
      search: "",
      mode: "all",
      status: "all",
      action: "all",
      groupBy: "none",
    }
  );
  const [page, setPage] = useSessionState<number>(`failures.page.${env}`, 1);
  const [pageSize, setPageSize] = usePageSize("failures");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.failures(env));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load failures");
    } finally {
      setLoading(false);
    }
  };

  /** Refresh = hit mongo for in-flight rows, drop now-Completed ones, update
   *  any status that changed. Slower than "re-read file" but always accurate. */
  const refreshFromDb = async () => {
    setRefreshing(true);
    setRefreshNote(null);
    setError(null);
    try {
      const res = await api.refreshStatuses(env);
      setData(res);
      const s = res.refresh_summary;
      if (s) {
        const parts: string[] = [];
        if (s.completed > 0) parts.push(`${s.completed} now Completed (removed)`);
        if (s.status_changed > 0) parts.push(`${s.status_changed} status updated`);
        if (s.runs_completed > 0) parts.push(`${s.runs_completed} runs marked done`);
        setRefreshNote(
          parts.length === 0
            ? `Checked ${s.checked} in-flight; nothing changed.`
            : `Checked ${s.checked} · ${parts.join(" · ")} (${s.duration_s.toFixed(1)}s)`
        );
      }
    } catch (e) {
      toast.fromError(e, "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  // Auto-dismiss the refresh-result banner after 10s.
  useEffect(() => {
    if (!refreshNote) return;
    const t = setTimeout(() => setRefreshNote(null), 10_000);
    return () => clearTimeout(t);
  }, [refreshNote]);

  useEffect(() => {
    load();
    setRefreshNote(null);
  }, [env]);

  const { modeOpts, statusOpts, actionOpts } = useMemo(() => {
    const modes = new Set<string>();
    const statuses = new Set<string>();
    const actions = new Set<string>();
    data?.failures.forEach((f) => {
      modes.add(f.mode);
      statuses.add(f.current_status);
      actions.add(f.recommended_action);
    });
    return {
      modeOpts: Array.from(modes).sort(),
      statusOpts: Array.from(statuses).sort(),
      actionOpts: Array.from(actions).sort(),
    };
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = filters.search.trim().toLowerCase();
    return data.failures.filter((f) => {
      if (filters.mode !== "all" && f.mode !== filters.mode) return false;
      if (filters.status !== "all" && f.current_status !== filters.status) return false;
      if (filters.action !== "all" && f.recommended_action !== filters.action) return false;
      if (!q) return true;
      const hay = [
        f.org_name,
        f.integration_instance_name,
        f.integration_name,
        f.sync_id,
        f.de_sync_status_id,
        f.org_integration_id,
        f.error_reason,
        f.action_reason,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [data, filters]);

  // Reset page when the filter set or env changes — otherwise a tight filter
  // can leave you stranded on page 7 of nothing.
  useEffect(() => setPage(1), [filters, env]);

  // Group-by view shows all rows in their groups (collapsing handles density),
  // so pagination only kicks in for the flat list.
  const visibleRows = useMemo(() => {
    if (filters.groupBy !== "none") return rows;
    return paginate(rows, page, pageSize);
  }, [rows, page, pageSize, filters.groupBy]);

  const safeCount =
    (data?.summary.by_action.MARK_COMPLETE ?? 0) +
    (data?.summary.by_action.RETRIGGER ?? 0);

  return (
    <div className="px-6 py-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Failing syncs</h1>
          {data && (
            <p className="mt-1 text-xs text-ink-500">
              {data.last_refreshed_at ? (
                <>
                  Refreshed{" "}
                  <span className="mono">
                    {new Date(data.last_refreshed_at).toLocaleString()}
                  </span>
                  {" · discovered "}
                  <span className="mono">
                    {new Date(data.generated_at).toLocaleString()}
                  </span>
                </>
              ) : (
                <>
                  Discovered{" "}
                  <span className="mono">
                    {new Date(data.generated_at).toLocaleString()}
                  </span>
                </>
              )}
              {" · run id "}
              <span className="mono">{data.run_id}</span>
              {" · env "}
              <span className="mono">{data.env}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refreshFromDb}
            disabled={!canAct || refreshing}
            className="btn"
            title={
              !canAct
                ? "Admin access required"
                : "Hit mongo for in-flight rows; drop ones that have completed since last cron tick."
            }
          >
            {refreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Database className="h-3.5 w-3.5" />
            )}
            Refresh
          </button>
          <button
            onClick={load}
            className="btn"
            title="Re-read the latest discover output (cheap, no DB call)."
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reload
          </button>
          <button
            onClick={() => setRerunOpen(true)}
            disabled={!canAct || safeCount === 0}
            className="btn-primary"
            title={
              !canAct
                ? "Admin access required"
                : safeCount === 0
                ? "No safe actions available"
                : `Will act on ${safeCount} syncs`
            }
          >
            <PlayCircle className="h-4 w-4" />
            Re-run all ({safeCount})
          </button>
        </div>
      </header>

      {refreshNote && (
        <div className="mb-3 rounded-md border border-blue-200 bg-blue-50/50 px-3 py-2 text-[12px] text-blue-900">
          {refreshNote}
        </div>
      )}

      {data && (
        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {ACTION_TILES.map((t) => (
            <button
              key={t.key}
              onClick={() =>
                setFilters((f) => ({
                  ...f,
                  action: f.action === t.key ? "all" : (t.key as Filters["action"]),
                }))
              }
              className={`card flex flex-col items-start px-3 py-2 text-left ring-1 ring-inset transition hover:translate-y-[-1px] hover:shadow-md ${
                filters.action === t.key ? t.cls + " ring-2" : "ring-ink-100"
              }`}
            >
              <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
                {t.label}
              </span>
              <span className="mt-1 text-2xl font-semibold text-ink-900">
                {data.summary.by_action?.[
                  t.key as keyof typeof data.summary.by_action
                ] ?? 0}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="mb-3">
        <FilterBar
          filters={filters}
          onChange={setFilters}
          modeOptions={modeOpts}
          statusOptions={statusOpts}
          actionOptions={actionOpts}
        />
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <EmptyState title="Couldn't load failures" hint={error} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No failures match the current filters"
          hint="Clear filters or wait for the next discovery tick."
        />
      ) : (
        <>
          <FailureTable
            rows={visibleRows}
            onSelect={setSelected}
            groupBy={filters.groupBy}
          />
          {filters.groupBy === "none" && (
            <Pagination
              total={rows.length}
              page={page}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(s) => {
                setPageSize(s);
                setPage(1);
              }}
              itemLabel="failures"
            />
          )}
        </>
      )}

      <FailureDetailModal
        open={selected !== null}
        failure={selected}
        onClose={() => setSelected(null)}
        onMutated={load}
      />

      {data && (
        <RerunAllModal
          open={rerunOpen}
          onClose={() => setRerunOpen(false)}
          failures={data.failures}
          onCompleted={load}
        />
      )}
    </div>
  );
}
