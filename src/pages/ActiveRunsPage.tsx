import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronRight,
  ExternalLink,
  PlayCircle,
  RefreshCw,
} from "lucide-react";
import type { ActiveRunsResponse, RunDetail } from "../types";
import { api } from "../api/client";
import { useEnv } from "../api/env";
import { prefectFlowUrl } from "../api/prefect";
import { paginate, usePageSize } from "../api/pagination";
import EmptyState from "../components/EmptyState";
import Spinner from "../components/Spinner";
import Pill, { type PillTone } from "../components/Pill";
import Pagination from "../components/Pagination";

const STATUS_TONE: Record<string, PillTone> = {
  queued: "amber",
  running: "blue",
  completed: "emerald",
  failed: "red",
};

function progressPct(triggeredAt: string, etaMinutes: number | null) {
  if (!etaMinutes || etaMinutes <= 0) return null;
  const elapsedMs = Date.now() - new Date(triggeredAt).getTime();
  const elapsedMin = elapsedMs / 60_000;
  return Math.max(0, Math.min(100, (elapsedMin / etaMinutes) * 100));
}

function timeRemaining(triggeredAt: string, etaMinutes: number | null) {
  if (!etaMinutes || etaMinutes <= 0) return null;
  const elapsedMin = (Date.now() - new Date(triggeredAt).getTime()) / 60_000;
  const remaining = etaMinutes - elapsedMin;
  if (remaining <= 0) return "due";
  if (remaining >= 60) return `${(remaining / 60).toFixed(1)}h`;
  return `${remaining.toFixed(1)}m`;
}

function ProgressBar({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-[12px] text-ink-400">—</span>;
  const color =
    pct >= 90 ? "bg-emerald-500" : pct >= 50 ? "bg-blue-500" : "bg-blue-400";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full bg-ink-100">
        <div
          className={`h-1.5 rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="mono text-[11px] text-ink-600">{pct.toFixed(0)}%</span>
    </div>
  );
}

export default function ActiveRunsPage() {
  const { env } = useEnv();
  const navigate = useNavigate();
  const [data, setData] = useState<ActiveRunsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, force] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("active-runs");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.activeRuns(env));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load active runs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [env]);

  // Tick once a minute so progress bars and "time remaining" stay live without
  // refetching from the server.
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const queuedCount = useMemo(
    () => data?.items.filter((r) => r.status === "queued").length ?? 0,
    [data]
  );
  const runningCount = useMemo(
    () => data?.items.filter((r) => r.status === "running").length ?? 0,
    [data]
  );

  useEffect(() => setPage(1), [env]);
  const visibleItems = useMemo(
    () => paginate(data?.items ?? [], page, pageSize),
    [data, page, pageSize]
  );

  return (
    <div className="px-6 py-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Active runs</h1>
          <p className="mt-1 text-xs text-ink-500">
            Currently in flight from re-trigger actions in <span className="mono">{env}</span>.
            Mark-complete actions don't appear here — they update mongo directly without a flow run.
          </p>
        </div>
        <button onClick={load} className="btn">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </header>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="card px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
            In flight
          </div>
          <div className="mt-1 text-2xl font-semibold text-ink-900">
            {data?.count ?? 0}
          </div>
        </div>
        <div className="card px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
            Running
          </div>
          <div className="mt-1 text-2xl font-semibold text-blue-700">
            {runningCount}
          </div>
        </div>
        <div className="card px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
            Queued
          </div>
          <div className="mt-1 text-2xl font-semibold text-amber-700">
            {queuedCount}
          </div>
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <EmptyState title="Couldn't load active runs" hint={error} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="No runs in flight"
          hint="Trigger a sync from the Failures page to see it here."
          icon={<PlayCircle className="h-6 w-6" />}
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="max-h-[calc(100vh-300px)] overflow-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className="table-th">Triggered</th>
                  <th className="table-th">Org · Integration</th>
                  <th className="table-th">Mode</th>
                  <th className="table-th">Status</th>
                  <th className="table-th">Progress</th>
                  <th className="table-th">ETA / remaining</th>
                  <th className="table-th">Flow run</th>
                  <th className="table-th"></th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((r: RunDetail) => {
                  const pct = progressPct(r.triggered_at, r.eta_minutes);
                  const remain = timeRemaining(r.triggered_at, r.eta_minutes);
                  // Reconstruct URL at render time so a Prefect host change is
                  // a one-line edit in api/prefect.ts.
                  const flowUrl = prefectFlowUrl(env, r.flow_run_id, {
                    app_flag: (r as unknown as { app_flag?: boolean }).app_flag,
                    payment_flag: (r as unknown as { payment_flag?: boolean }).payment_flag,
                  });
                  return (
                    <tr
                      key={r.sync_id}
                      onClick={() => navigate(`/runs/${r.sync_id}`)}
                      className="cursor-pointer border-t border-ink-100 hover:bg-ink-50/40"
                    >
                      <td className="table-td whitespace-nowrap">
                        <div className="text-[12px] text-ink-700">
                          {new Date(r.triggered_at).toLocaleString()}
                        </div>
                        <div className="mono text-[11px] text-ink-500">
                          by {r.triggered_by}
                        </div>
                      </td>
                      <td className="table-td">
                        <div className="font-medium text-ink-900">
                          {r.org_name ?? "—"}
                        </div>
                        <div className="text-[12px] text-ink-500">
                          {r.integration_instance_name}
                          {r.integration_name && (
                            <>
                              <span className="mx-1 text-ink-300">·</span>
                              {r.integration_name}
                            </>
                          )}
                        </div>
                      </td>
                      <td className="table-td mono text-[12px]">{r.mode}</td>
                      <td className="table-td">
                        <Pill tone={STATUS_TONE[r.status] ?? "neutral"}>
                          {r.status}
                        </Pill>
                      </td>
                      <td className="table-td">
                        <ProgressBar pct={pct} />
                      </td>
                      <td className="table-td whitespace-nowrap">
                        <div className="mono text-[12px] text-ink-700">
                          {r.eta_minutes != null
                            ? `${r.eta_minutes.toFixed(1)}m`
                            : "—"}
                        </div>
                        <div className="mono text-[11px] text-ink-500">
                          {remain ? `~${remain} left` : "—"}
                        </div>
                      </td>
                      <td className="table-td">
                        {flowUrl ? (
                          <a
                            href={flowUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[12px] text-blue-700 underline-offset-2 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            open
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-[12px] text-ink-400">—</span>
                        )}
                      </td>
                      <td className="table-td text-right">
                        <ChevronRight className="ml-auto h-4 w-4 text-ink-400" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            total={data.items.length}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
            itemLabel="active runs"
          />
        </div>
      )}
    </div>
  );
}
