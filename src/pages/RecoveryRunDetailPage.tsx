import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Database,
  ExternalLink,
  FileJson,
  History,
  Loader2,
  ShieldCheck,
  ShieldX,
  Undo2,
  XCircle,
} from "lucide-react";
import { useAuth } from "../api/auth";
import { canRecover } from "../api/permissions";
import { useToast } from "../components/Toast";
import RecoveryStateBadge from "../components/RecoveryStateBadge";
import Pill from "../components/Pill";
import EmptyState from "../components/EmptyState";
import { MOCK_RECOVERY_RUNS } from "../data/mockRecoveryRuns";
import type { RecoveryRun, RecoveryStateEvent } from "../types";

function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text);
  }
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString();
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const STEP_TONE: Record<string, string> = {
  PLANNED: "bg-ink-200",
  READY: "bg-ink-200",
  VALIDATOR_PREFLIGHT: "bg-blue-300",
  SNAPSHOT_SAVED: "bg-emerald-300",
  EXECUTING: "bg-blue-400",
  MUTATION_APPLIED: "bg-emerald-400",
  SUCCEEDED: "bg-emerald-500",
  FAILED: "bg-red-500",
  BLOCKED: "bg-amber-500",
  UNDONE: "bg-violet-500",
  POISONED: "bg-red-600",
  SKIPPED: "bg-ink-300",
};

export default function RecoveryRunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const isAdminUser = canRecover(user);

  const run = useMemo(
    () => MOCK_RECOVERY_RUNS.find((r) => r.id === id) ?? null,
    [id]
  );

  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [confirmingUndo, setConfirmingUndo] = useState(false);
  const [undoInFlight, setUndoInFlight] = useState(false);

  if (!run) {
    return (
      <div className="px-6 py-6">
        <Back />
        <EmptyState
          title="Recovery run not found"
          hint="It may have been pruned or the link is wrong."
        />
      </div>
    );
  }

  const driftWarn = run.undo.drift_check?.drift_detected ?? false;
  const canUndo = run.undo.eligible && isAdminUser;

  const onUndo = async () => {
    if (!canUndo) return;
    setUndoInFlight(true);
    // Mock — in the real flow, POST /api/recovery/undo/<id> and re-fetch.
    await new Promise((r) => setTimeout(r, 1200));
    toast.success("Undo completed", "Snapshot restored. State set to UNDONE.");
    setUndoInFlight(false);
    setConfirmingUndo(false);
    // Navigate back to the list to make the state change feel real.
    navigate("/recovery/runs");
  };

  return (
    <div className="px-6 py-6">
      <Back />

      {/* Hero */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={run.action === "MARK_COMPLETE" ? "emerald" : "blue"}>
              {run.action === "MARK_COMPLETE" ? "Mark complete" : "Retrigger"}
            </Pill>
            <RecoveryStateBadge state={run.state} />
            {run.batch_id && (
              <Pill tone="neutral">batch · {run.batch_id.slice(0, 24)}</Pill>
            )}
            <Pill tone={run.env === "prod" ? "red" : "emerald"}>
              env · {run.env}
            </Pill>
          </div>
          <h1 className="mt-2 truncate text-xl font-semibold text-ink-900">
            {run.org_name}
            <span className="mx-2 text-ink-300">·</span>
            <span className="text-ink-700">{run.integration_instance_name}</span>
          </h1>
          <p className="text-sm text-ink-600">
            {run.integration_name}
            <span className="mx-2 text-ink-300">·</span>
            <span className="mono">{run.mode}</span>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-ink-500">
            <span className="mono">{run.id}</span>
            <button
              type="button"
              onClick={() => {
                copyToClipboard(run.id);
                toast.success("Copied recovery id");
              }}
              className="rounded p-0.5 text-ink-400 hover:text-ink-700"
              aria-label="Copy recovery id"
            >
              <Copy className="h-3 w-3" />
            </button>
            <span>·</span>
            <span>by {run.triggered_by.name}</span>
            <span>·</span>
            <span>created {fmt(run.created_at)}</span>
            {run.completed_at && (
              <>
                <span>·</span>
                <span>completed {fmt(run.completed_at)}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          {run.active_run_path && (
            <Link to={run.active_run_path} className="btn">
              <ExternalLink className="h-3.5 w-3.5" />
              View active run
            </Link>
          )}
          {canUndo ? (
            <button
              type="button"
              onClick={() => setConfirmingUndo(true)}
              className="btn-primary"
            >
              <Undo2 className="h-4 w-4" />
              Undo this action
            </button>
          ) : (
            <button
              type="button"
              disabled
              className="btn-primary"
              title={run.undo.reason_if_not ?? "Undo not available"}
            >
              <Undo2 className="h-4 w-4" />
              Undo not available
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* LEFT — Snapshot + mutation + drift */}
        <div className="space-y-3 lg:col-span-2">
          {/* Snapshot card */}
          <section className="card overflow-hidden">
            <header className="flex items-center justify-between border-b border-ink-100 px-4 py-2.5">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                Snapshot
              </h2>
              {run.snapshot ? (
                <Pill tone="emerald">preserved</Pill>
              ) : (
                <Pill tone="neutral">not taken</Pill>
              )}
            </header>
            <div className="px-4 py-3">
              {run.snapshot ? (
                <>
                  <div className="grid grid-cols-1 gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2">
                    <KV label="Saved at" value={fmt(run.snapshot.saved_at)} />
                    <KV label="Size" value={fmtBytes(run.snapshot.size_bytes)} />
                    <KV
                      label="Hash"
                      value={
                        <span className="mono break-all">
                          {run.snapshot.hash}
                        </span>
                      }
                    />
                    <KV
                      label="Path"
                      value={
                        <span className="mono break-all">
                          {run.snapshot.storage_path}
                        </span>
                      }
                    />
                    <KV
                      label="Fields recorded"
                      value={
                        <div className="flex flex-wrap gap-1">
                          {run.snapshot.fields_recorded.map((f) => (
                            <span
                              key={f}
                              className="mono rounded bg-ink-100 px-1.5 py-0.5 text-[11px] text-ink-700"
                            >
                              {f}
                            </span>
                          ))}
                        </div>
                      }
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => setSnapshotOpen((v) => !v)}
                    className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-ink-700 hover:text-ink-900"
                  >
                    {snapshotOpen ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                    {snapshotOpen ? "Hide raw JSON" : "View raw JSON"}
                  </button>

                  {snapshotOpen && (
                    <pre className="mono mt-2 max-h-72 overflow-auto rounded-md border border-ink-200 bg-ink-50 p-3 text-[11px] text-ink-800">
                      {JSON.stringify(mockSnapshotPreImage(run), null, 2)}
                    </pre>
                  )}
                </>
              ) : (
                <p className="text-[12px] text-ink-500">
                  {run.state === "BLOCKED"
                    ? "Action was blocked before any work happened — no snapshot was needed."
                    : run.state === "FAILED"
                    ? "Validator rejected before any mutation was attempted."
                    : "No snapshot recorded for this run."}
                </p>
              )}
            </div>
          </section>

          {/* Mutation card — what we wrote */}
          {run.mutation && (
            <section className="card overflow-hidden">
              <header className="flex items-center justify-between border-b border-ink-100 px-4 py-2.5">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
                  <Database className="h-4 w-4 text-blue-600" />
                  What changed
                </h2>
                <Pill tone="blue">$set</Pill>
              </header>
              <div className="px-4 py-3">
                <table className="w-full text-[12px]">
                  <thead className="text-left text-ink-500">
                    <tr>
                      <th className="pb-1 font-medium">Field</th>
                      <th className="pb-1 font-medium">Before</th>
                      <th className="pb-1 font-medium">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(run.mutation.set).map(([k, v]) => (
                      <tr key={k} className="border-t border-ink-100">
                        <td className="py-1.5 mono text-ink-800">{k}</td>
                        <td className="py-1.5 mono text-ink-500">
                          {String(mockBefore(run, k))}
                        </td>
                        <td className="py-1.5 mono text-ink-900">{String(v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Validator card */}
          {run.validator && (
            <section className="card overflow-hidden">
              <header className="flex items-center justify-between border-b border-ink-100 px-4 py-2.5">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
                  <ShieldX className="h-4 w-4 text-violet-600" />
                  Validator response
                </h2>
                <Pill
                  tone={
                    run.validator.status_code < 300
                      ? "emerald"
                      : run.validator.status_code < 500
                      ? "amber"
                      : "red"
                  }
                >
                  {run.validator.status_code}
                </Pill>
              </header>
              <div className="px-4 py-3 text-[12px]">
                <KV label="Message" value={run.validator.message} />
                {run.validator.flow_run_id && (
                  <KV
                    label="Flow run id"
                    value={
                      <span className="mono break-all">
                        {run.validator.flow_run_id}
                      </span>
                    }
                  />
                )}
                {run.validator.flow_run_url && (
                  <KV
                    label="Prefect"
                    value={
                      <a
                        className="text-blue-700 hover:underline break-all"
                        href={run.validator.flow_run_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {run.validator.flow_run_url}
                      </a>
                    }
                  />
                )}
              </div>
            </section>
          )}

          {/* Drift / undo health */}
          {run.snapshot && (run.state === "SUCCEEDED" || run.state === "UNDONE" || run.state === "POISONED") && (
            <section className="card overflow-hidden">
              <header className="flex items-center justify-between border-b border-ink-100 px-4 py-2.5">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
                  <FileJson className="h-4 w-4 text-amber-600" />
                  Drift check
                </h2>
                {run.undo.drift_check ? (
                  <Pill tone={driftWarn ? "amber" : "emerald"}>
                    {driftWarn ? "drift detected" : "live doc still matches"}
                  </Pill>
                ) : (
                  <Pill tone="neutral">not yet checked</Pill>
                )}
              </header>
              <div className="px-4 py-3 text-[12px]">
                {run.undo.drift_check ? (
                  <>
                    <KV
                      label="Last checked"
                      value={fmt(run.undo.drift_check.checked_at)}
                    />
                    {driftWarn && (
                      <div className="mt-1.5 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-amber-900">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <div>
                            <div className="font-medium">
                              These fields drifted after our write:
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {run.undo.drift_check.drifted_fields.map((f) => (
                                <span
                                  key={f}
                                  className="mono rounded bg-white/60 px-1.5 py-0.5 text-[11px] ring-1 ring-amber-200"
                                >
                                  {f}
                                </span>
                              ))}
                            </div>
                            <div className="mt-1.5 text-[11px] opacity-90">
                              Undo will only restore fields we set. Drifted
                              fields are left alone — you'll see them in the
                              live doc.
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-ink-500">
                    Drift check runs the first time someone opens this page
                    after the write, and again at undo time.
                  </p>
                )}
              </div>
            </section>
          )}
        </div>

        {/* RIGHT — Timeline + Undo panel */}
        <div className="space-y-3">
          <Timeline events={run.state_history} />

          <UndoPanel
            run={run}
            canUndo={canUndo}
            isAdminUser={isAdminUser}
            confirming={confirmingUndo}
            inFlight={undoInFlight}
            onConfirm={onUndo}
            onCancel={() => setConfirmingUndo(false)}
            onAsk={() => setConfirmingUndo(true)}
          />
        </div>
      </div>
    </div>
  );
}

function Back() {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate("/recovery/runs")}
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to recovery activity
    </button>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-1.5 py-0.5">
      <span className="text-[11px] uppercase tracking-wide text-ink-400 min-w-[110px]">
        {label}
      </span>
      <span className="text-ink-800">{value ?? "—"}</span>
    </div>
  );
}

function Timeline({ events }: { events: RecoveryStateEvent[] }) {
  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between border-b border-ink-100 px-4 py-2.5">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
          <History className="h-4 w-4 text-ink-700" />
          Timeline
        </h2>
        <Pill tone="neutral">{events.length} events</Pill>
      </header>
      <ol className="relative px-4 py-3">
        <span className="absolute left-[20px] top-3 bottom-3 w-px bg-ink-200" />
        {events.map((e, i) => {
          const Icon = iconFor(e.state);
          const tone = STEP_TONE[e.state] ?? "bg-ink-300";
          return (
            <li key={i} className="relative mb-3 flex gap-3 pl-1 last:mb-0">
              <div
                className={`relative z-10 mt-0.5 flex h-5 w-5 items-center justify-center rounded-full text-white ${tone}`}
              >
                <Icon className="h-3 w-3" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-ink-900">
                  {labelFor(e.state)}
                </div>
                <div className="text-[10px] text-ink-400">{fmt(e.at)}</div>
                {e.note && (
                  <div className="mt-0.5 text-[12px] text-ink-700">{e.note}</div>
                )}
                {e.by && (
                  <div className="text-[11px] text-ink-500">by {e.by.name}</div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function iconFor(state: string) {
  switch (state) {
    case "PLANNED":
    case "READY":
      return Clock;
    case "VALIDATOR_PREFLIGHT":
      return ShieldX;
    case "SNAPSHOT_SAVED":
      return ShieldCheck;
    case "EXECUTING":
      return Loader2;
    case "MUTATION_APPLIED":
      return Database;
    case "SUCCEEDED":
      return CheckCircle2;
    case "FAILED":
      return XCircle;
    case "BLOCKED":
      return ShieldX;
    case "UNDONE":
      return Undo2;
    case "POISONED":
      return AlertOctagon;
    default:
      return Clock;
  }
}

function labelFor(state: string): string {
  switch (state) {
    case "VALIDATOR_PREFLIGHT":
      return "Validator preflight";
    case "SNAPSHOT_SAVED":
      return "Snapshot saved";
    case "MUTATION_APPLIED":
      return "Mutation applied";
    default:
      return state.charAt(0) + state.slice(1).toLowerCase();
  }
}

function UndoPanel({
  run,
  canUndo,
  isAdminUser,
  confirming,
  inFlight,
  onConfirm,
  onCancel,
  onAsk,
}: {
  run: RecoveryRun;
  canUndo: boolean;
  isAdminUser: boolean;
  confirming: boolean;
  inFlight: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onAsk: () => void;
}) {
  const driftWarn = run.undo.drift_check?.drift_detected ?? false;
  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between border-b border-ink-100 px-4 py-2.5">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
          <Undo2 className="h-4 w-4 text-violet-600" />
          Undo
        </h2>
        {run.undo.eligible ? (
          <Pill tone="violet">eligible</Pill>
        ) : run.state === "UNDONE" ? (
          <Pill tone="violet">already undone</Pill>
        ) : (
          <Pill tone="neutral">not eligible</Pill>
        )}
      </header>
      <div className="px-4 py-3 text-[12px]">
        {run.state === "UNDONE" ? (
          <>
            <p className="text-ink-700">
              Restored on{" "}
              <strong>{run.undo.undone_at && fmt(run.undo.undone_at)}</strong>
              {run.undo.undone_by && (
                <>
                  {" "}
                  by <strong>{run.undo.undone_by.name}</strong>
                </>
              )}
              .
            </p>
            <p className="mt-1 text-ink-500">
              The snapshot is still preserved at{" "}
              <span className="mono break-all">
                {run.snapshot?.storage_path ?? "—"}
              </span>{" "}
              for audit.
            </p>
          </>
        ) : run.undo.eligible ? (
          <>
            <p className="text-ink-700">
              Undo will <strong>$set</strong> the snapshot's pre-image back on
              the live mongo doc — only the {run.snapshot?.fields_recorded.length}{" "}
              field{run.snapshot?.fields_recorded.length === 1 ? "" : "s"} we
              wrote, leaving anything else alone.
            </p>
            {run.undo.eligible_until && (
              <p className="mt-1 text-ink-500">
                Eligible until <strong>{fmt(run.undo.eligible_until)}</strong>
                .
              </p>
            )}
            {driftWarn && (
              <div className="mt-2 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-amber-900">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div>
                    Drift detected. Undo is still safe — we only touch fields
                    we wrote — but the live doc has changed since the action.
                    Drifted fields stay drifted.
                  </div>
                </div>
              </div>
            )}
            {!isAdminUser ? (
              <button type="button" disabled className="btn-primary mt-3 w-full">
                <Undo2 className="h-4 w-4" />
                Admin access required
              </button>
            ) : !confirming ? (
              <button
                type="button"
                onClick={onAsk}
                disabled={!canUndo}
                className="btn-primary mt-3 w-full"
              >
                <Undo2 className="h-4 w-4" />
                Undo this action
              </button>
            ) : (
              <div className="mt-3 rounded-md border border-violet-200 bg-violet-50/60 px-3 py-2.5 text-violet-900">
                <p className="font-medium">Confirm undo</p>
                <p className="mt-1 text-[11px] opacity-90">
                  Restoring snapshot{" "}
                  <span className="mono">{run.snapshot?.hash.slice(0, 18)}…</span>{" "}
                  to live doc <span className="mono">{run.de_sync_status_id}</span>
                  .
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={onConfirm}
                    disabled={inFlight}
                    className="btn-primary flex-1"
                  >
                    {inFlight ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Undo2 className="h-4 w-4" />
                    )}
                    {inFlight ? "Undoing…" : "Yes, undo"}
                  </button>
                  <button
                    type="button"
                    onClick={onCancel}
                    disabled={inFlight}
                    className="btn flex-1"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-ink-700">{run.undo.reason_if_not}</p>
        )}
      </div>
    </section>
  );
}

/* ── mock helpers (UI sample data only) ─────────────────────────────────── */

function mockSnapshotPreImage(run: RecoveryRun): Record<string, unknown> {
  // Reconstruct what the snapshot file would look like — caller wouldn't
  // build this in real life; the server returns it.
  const before: Record<string, unknown> = {
    _id: run.de_sync_status_id,
    syncId: run.sync_id,
    orgId: run.org_id,
    orgIntegrationId: run.org_integration_id,
    mode: run.mode,
    sync_status: "Failed",
    sync_complete: false,
    updatedAt: "2026-05-02T05:08:14.000Z",
    error_reason: "auth: token rejected",
  };
  if (run.action === "RETRIGGER") {
    before.trigger_state = null;
  }
  return before;
}

function mockBefore(run: RecoveryRun, key: string): string {
  // Approximate what a diff column would show for the demo.
  const map: Record<string, string> = {
    sync_status: "Failed",
    sync_complete: "false",
    lastSyncCompletedAt: "—",
    mark_source: "—",
    "trigger_state.flow_run_id": "—",
    "trigger_state.triggered_at": "—",
    updatedAt: "2026-05-02T05:08:14.000Z",
  };
  return map[key] ?? "—";
}
