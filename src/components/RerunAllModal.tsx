import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, PlayCircle, X } from "lucide-react";
import type { BulkActionItem, Failure, RecommendedAction } from "../types";
import { api } from "../api/client";
import { useEnv } from "../api/env";
import Modal from "./Modal";
import ActionBadge from "./ActionBadge";
import { useToast } from "./Toast";

interface Props {
  open: boolean;
  onClose: () => void;
  failures: Failure[];
  onCompleted: () => void;
}

type ActionFilter = "all" | "MARK_COMPLETE" | "RETRIGGER";
type ModeFilter = "all" | string;

const fmtMins = (n: number | null | undefined) =>
  n == null ? "—" : `${n.toFixed(1)} min`;

function actionFor(f: Failure): "retrigger" | "mark_complete" | null {
  if (f.recommended_action === "MARK_COMPLETE") return "mark_complete";
  if (f.recommended_action === "RETRIGGER") return "retrigger";
  return null;
}

export default function RerunAllModal({
  open,
  onClose,
  failures,
  onCompleted,
}: Props) {
  const { env } = useEnv();
  const navigate = useNavigate();
  const toast = useToast();
  const [actionFilter, setActionFilter] = useState<ActionFilter>("all");
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const [busy, setBusy] = useState(false);

  // The "safe to act" set: only MARK_COMPLETE and RETRIGGER. Others are
  // explicitly skipped — they never appear here.
  const safe = useMemo(
    () =>
      failures.filter(
        (f) =>
          f.recommended_action === "MARK_COMPLETE" ||
          f.recommended_action === "RETRIGGER"
      ),
    [failures]
  );

  const modes = useMemo(
    () => Array.from(new Set(safe.map((f) => f.mode))).sort(),
    [safe]
  );

  const filtered = useMemo(
    () =>
      safe.filter(
        (f) =>
          (actionFilter === "all" ||
            f.recommended_action === actionFilter) &&
          (modeFilter === "all" || f.mode === modeFilter)
      ),
    [safe, actionFilter, modeFilter]
  );

  const counts = useMemo(() => {
    let mc = 0;
    let rt = 0;
    for (const f of filtered) {
      if (f.recommended_action === "MARK_COMPLETE") mc++;
      else if (f.recommended_action === "RETRIGGER") rt++;
    }
    return { mc, rt, total: mc + rt };
  }, [filtered]);

  const onConfirm = async () => {
    if (counts.total === 0) return;
    setBusy(true);
    try {
      const actions: BulkActionItem[] = filtered
        .map((f) => {
          const a = actionFor(f);
          if (!a) return null;
          return { sync_id: f.sync_id, action: a, failure: f };
        })
        .filter((x): x is BulkActionItem => x !== null);

      const res = await api.rerunAll(env, actions);
      const failed = res.results.filter((r) => !r.ok);
      if (failed.length === 0) {
        toast.success(`Ran ${res.results.length} actions`);
      } else if (failed.length === res.results.length) {
        toast.error(`All ${failed.length} actions failed`);
      } else {
        toast.info(
          `${res.results.length - failed.length} succeeded, ${failed.length} failed`,
          "Check active runs for details."
        );
      }
      onCompleted();
      onClose();
      // After mass action, take the user to where the action shows up:
      // retriggers populate /active-runs; if there are only mark-completes,
      // staying on failures is fine — but /active-runs is the more useful default.
      if (counts.rt > 0) navigate("/active-runs");
    } catch (e) {
      toast.fromError(e, "Bulk action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="xl"
      title={
        <div className="flex items-center gap-2">
          <PlayCircle className="h-5 w-5 text-ink-700" />
          Re-run all safe actions
        </div>
      }
      subtitle={
        <span>
          Will <span className="font-medium text-emerald-700">mark {counts.mc} complete</span>
          {" "}and{" "}
          <span className="font-medium text-blue-700">retrigger {counts.rt}</span>
          {" "}via the{" "}
          <span className="mono">{env}</span> validator.
        </span>
      }
      footer={
        <>
          <button onClick={onClose} className="btn">
            <X className="h-3.5 w-3.5" />
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy || counts.total === 0}
            className="btn-primary"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PlayCircle className="h-4 w-4" />
            )}
            Run all ({counts.total})
          </button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          className="input w-auto"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value as ActionFilter)}
        >
          <option value="all">All actions</option>
          <option value="MARK_COMPLETE">Mark complete</option>
          <option value="RETRIGGER">Retrigger</option>
        </select>
        <select
          className="input w-auto"
          value={modeFilter}
          onChange={(e) => setModeFilter(e.target.value)}
        >
          <option value="all">All modes</option>
          {modes.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-ink-500">
          {filtered.length} of {safe.length} eligible
        </span>
      </div>

      <div className="max-h-[50vh] overflow-auto rounded-md border border-ink-200">
        <table className="min-w-full">
          <thead>
            <tr>
              <th className="table-th">Org · Integration</th>
              <th className="table-th">Mode</th>
              <th className="table-th">Action</th>
              <th className="table-th">ETA</th>
              <th className="table-th">Why</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="table-td text-center text-ink-500">
                  Nothing matches the current filters.
                </td>
              </tr>
            ) : (
              filtered.map((f) => (
                <tr
                  key={f.de_sync_status_id}
                  className="border-t border-ink-100"
                >
                  <td className="table-td">
                    <div className="font-medium text-ink-900">{f.org_name}</div>
                    <div className="text-[12px] text-ink-500">
                      {f.integration_instance_name}
                      <span className="mx-1 text-ink-300">·</span>
                      {f.integration_name}
                    </div>
                    <div className="mono text-[11px] text-ink-400" title="DE sync status _id">
                      {f.de_sync_status_id}
                    </div>
                  </td>
                  <td className="table-td mono text-[12px]">{f.mode}</td>
                  <td className="table-td">
                    <ActionBadge action={f.recommended_action as RecommendedAction} />
                  </td>
                  <td className="table-td whitespace-nowrap">
                    {f.recommended_action === "RETRIGGER"
                      ? fmtMins(f.eta_minutes)
                      : "—"}
                  </td>
                  <td className="table-td max-w-[24rem]">
                    <span
                      className="line-clamp-2 cursor-help text-[12px] text-ink-600"
                      title={f.action_reason}
                    >
                      {f.action_reason}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
