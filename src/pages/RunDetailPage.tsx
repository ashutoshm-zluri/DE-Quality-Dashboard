import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ExternalLink,
  Hourglass,
  Loader2,
  RefreshCw,
} from "lucide-react";
import type { RunDetail } from "../types";
import { api } from "../api/client";
import { useEnv } from "../api/env";
import { prefectFlowUrl } from "../api/prefect";
import KV from "../components/KV";
import EmptyState from "../components/EmptyState";
import Spinner from "../components/Spinner";

export default function RunDetailPage() {
  const { env } = useEnv();
  const { syncId } = useParams<{ syncId: string }>();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!syncId) return;
    setLoading(true);
    setError(null);
    try {
      setRun(await api.run(env, syncId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load run");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [syncId, env]);

  return (
    <div className="px-6 py-6">
      <Link
        to="/active-runs"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </Link>

      <header className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Run details</h1>
          <p className="mt-1 mono text-xs text-ink-500">{syncId}</p>
        </div>
        <button onClick={load} className="btn">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </header>

      {loading ? (
        <Spinner />
      ) : error ? (
        <EmptyState title="Couldn't load run" hint={error} />
      ) : !run ? (
        <EmptyState title="Run not found" />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <section className="card lg:col-span-2 px-5 py-4">
            <h2 className="mb-2 text-sm font-semibold text-ink-900">Summary</h2>
            <KV label="Sync ID" value={run.sync_id} copy={run.sync_id} mono />
            <KV
              label="DE sync status"
              value={run.de_sync_status_id ?? "—"}
              copy={run.de_sync_status_id ?? undefined}
              mono
            />
            <KV
              label="Org integration"
              value={run.org_integration_id ?? "—"}
              copy={run.org_integration_id ?? undefined}
              mono
            />
            <KV label="Org" value={run.org_name ?? "—"} />
            <KV
              label="Integration"
              value={
                run.integration_instance_name
                  ? `${run.integration_instance_name} (${run.integration_name ?? "?"})`
                  : "—"
              }
            />
            <KV label="Mode" value={run.mode ?? "—"} mono />
            <KV
              label="Triggered at"
              value={new Date(run.triggered_at).toLocaleString()}
            />
            <KV label="Triggered by" value={run.triggered_by} />
            <KV
              label="Status"
              value={
                <span className="inline-flex items-center gap-1.5">
                  <Hourglass className="h-3.5 w-3.5 text-violet-600" />
                  {run.status}
                </span>
              }
            />
            <KV
              label="Validator status"
              value={String(run.validator_status_code ?? "—")}
            />
            <KV
              label="Flow run"
              value={(() => {
                const url = prefectFlowUrl(env, run.flow_run_id);
                return url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-blue-700 underline-offset-2 hover:underline"
                  >
                    {run.flow_run_id}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  "—"
                );
              })()}
              copy={run.flow_run_id ?? undefined}
              mono
            />
            <KV
              label="New step function"
              value={run.new_step_function ?? "—"}
              copy={run.new_step_function ?? undefined}
              mono
            />
            <KV
              label="ETA"
              value={
                run.eta_minutes ? `${run.eta_minutes.toFixed(1)} min` : "—"
              }
            />
            <KV label="ETA basis" value={run.eta_basis ?? "—"} />
            <KV
              label="Expected completion"
              value={
                run.expected_completion_at
                  ? new Date(run.expected_completion_at).toLocaleString()
                  : "—"
              }
            />
          </section>

          <section className="card px-5 py-4">
            <h2 className="mb-2 text-sm font-semibold text-ink-900">Timeline</h2>
            <ol className="relative space-y-3 border-l border-ink-200 pl-4">
              {run.timeline.map((t, i) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[21px] top-1 inline-flex h-3 w-3 items-center justify-center rounded-full bg-white ring-2 ring-ink-300">
                    {run.status === "queued" &&
                      i === run.timeline.length - 1 && (
                        <Loader2 className="h-2 w-2 animate-spin text-ink-500" />
                      )}
                  </span>
                  <div className="text-[11px] mono text-ink-500">
                    {new Date(t.at).toLocaleTimeString()}
                  </div>
                  <div className="text-sm font-medium text-ink-900">
                    {t.event}
                  </div>
                  {t.detail && (
                    <div className="text-xs text-ink-600">{t.detail}</div>
                  )}
                </li>
              ))}
            </ol>
          </section>

          <section className="card lg:col-span-3 px-5 py-4">
            <h2 className="mb-2 text-sm font-semibold text-ink-900">
              Validator event payload
            </h2>
            <pre className="mono max-h-96 overflow-auto rounded-md border border-ink-200 bg-ink-50 p-3 text-[12px] leading-relaxed text-ink-800">
              {JSON.stringify(run.event_payload ?? {}, null, 2)}
            </pre>
          </section>
        </div>
      )}
    </div>
  );
}
